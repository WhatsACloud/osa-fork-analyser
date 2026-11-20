import {
  GITHUB_INNER_CONCURRENCY,
  OTHER_REPOS_LIMIT,
  SUBMODULE_SCAN_MAX_REPOS,
} from '../config.js';
import { mapConcurrent } from '../queue.js';
import { OWNER_REPOS_QUERY, PROJECT_INFO_QUERY, SUBMODULES_QUERY } from './queries.js';
import { encodeBranch, parseRepoRef } from './repo.js';

export const FETCH_STEPS = 8;

/**
 * Gathers everything the LLM needs to describe a fork: diff vs upstream, commits,
 * PRs/commits sent upstream, submodule usage, org status and the owner's other repos.
 * @param {import('./client.js').GitHubClient} gh
 * @param {string} forkFullName
 * @param {string | null} branch  fork branch to analyse; defaults to the fork's default branch
 * @param {(label: string, index: number) => void} [onStep]
 */
export async function fetchForkData(gh, forkFullName, branch, onStep) {
  const step = (label, index) => onStep?.(label, index);
  const fork = parseRepoRef(forkFullName);

  step('Fetching base repo…', 1);
  const forkRepo = await gh.rest(`/repos/${fork.owner}/${fork.repo}`);
  if (!forkRepo.parent) throw new Error(`${fork.fullName} is not a fork`);
  const baseUrl = forkRepo.parent.html_url;
  const base = parseRepoRef(baseUrl);
  const isOrg = forkRepo.owner.type === 'Organization';

  step('Fetching project info…', 2);
  const projectInfo = await gh.graphql(PROJECT_INFO_QUERY, {
    baseOwner: base.owner,
    baseRepo: base.repo,
    forkOwner: fork.owner,
    forkRepo: fork.repo,
  });
  const forkBranch = branch || projectInfo.fork?.defaultBranchRef?.name;
  const baseBranch = projectInfo.base?.defaultBranchRef?.name;
  if (!forkBranch || !baseBranch) throw new Error('Fork or upstream has no default branch (empty repo?)');

  step('Fetching diff…', 3);
  const compare = await fetchCompare(gh, base, baseBranch, fork, forkBranch);
  const files = (compare.files ?? []).map(({ blob_url, raw_url, contents_url, ...rest }) => rest);

  step('Fetching commits…', 4);
  const commits = await cleanCommits(gh, compare.commits ?? [], fork);

  step('Fetching PRs from upstream…', 5);
  const prs = await getPrsFromFork(gh, commits, base, fork.owner);

  step('Checking upstream commits…', 6);
  const upstreamCommits = await getUpstreamCommitsFromFork(gh, commits, base, fork.owner);
  const commitsOutsidePrs = getCommitsOutsidePrs(prs, commits);

  step('Checking submodules…', 7);
  const submoduleData = await findSubmoduleRepos(gh, fork.owner, fork.repo);

  step('Fetching other repos…', 8);
  const otherRepos = await fetchOwnerRepos(gh, fork.owner, OTHER_REPOS_LIMIT);

  return {
    fork_url: `https://github.com/${fork.fullName}`,
    base_url: baseUrl,
    files,
    commits,
    prs_associated_with_fork: prs,
    upstream_commits_associated_with_fork: upstreamCommits,
    commits_outside_prs: commitsOutsidePrs,
    upstream_relationship_label_data: {
      is_org: isOrg,
      submodule_data: submoduleData,
    },
    project_info: {
      base: projectInfo.base,
      fork: projectInfo.fork,
    },
    other_repos: otherRepos,
  };
}

async function fetchCompare(gh, base, baseBranch, fork, forkBranch) {
  const head = `${fork.owner}:${fork.repo}:${encodeBranch(forkBranch)}`;
  // Upstream often has a branch with the same name as the fork's; prefer comparing against that.
  const sameName = await gh.restOrNull(
    `/repos/${base.fullName}/compare/${encodeBranch(forkBranch)}...${head}`,
  );
  if (sameName) return sameName;
  return gh.rest(`/repos/${base.fullName}/compare/${encodeBranch(baseBranch)}...${head}`);
}

async function cleanCommits(gh, commits, fork) {
  return mapConcurrent(commits, GITHUB_INNER_CONCURRENCY, async (commit) => {
    const message = commit.commit.message;
    if (message.toLowerCase().includes('merge')) return { message };
    const author =
      commit.author?.login ?? `${commit.commit.author.name} <${commit.commit.author.email}>`;
    const details = await gh.rest(`/repos/${fork.fullName}/commits/${commit.sha}`);
    return { author, message, stats: details.stats };
  });
}

async function getPrsFromFork(gh, forkCommits, base, forkOwner) {
  const data = await gh.rest('/search/issues', {
    q: `repo:${base.fullName} is:pr author:${forkOwner}`,
  });

  const prs = await mapConcurrent(data.items ?? [], GITHUB_INNER_CONCURRENCY, async (pr) => {
    const [comments, prCommits] = await Promise.all([
      gh.rest(pr.comments_url),
      gh.rest(`/repos/${base.fullName}/pulls/${pr.number}/commits`),
    ]);
    const mergedAt = pr.pull_request?.merged_at ?? null;
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      created_at: pr.created_at,
      merged_at: mergedAt,
      status: mergedAt ? 'merged' : pr.state === 'closed' ? 'rejected' : pr.state,
      commits: prCommits.map((c) => ({ message: c.commit.message })),
      comments: comments.map((c) => ({
        body: c.body,
        user: { login: c.user?.login ?? 'ghost', type: c.user?.type ?? 'User' },
      })),
    };
  });

  const forkMessages = new Set(forkCommits.map((c) => c.message));
  return prs.filter((pr) => pr.commits.some((c) => forkMessages.has(c.message)));
}

async function getUpstreamCommitsFromFork(gh, forkCommits, base, forkOwner) {
  const data = await gh.rest('/search/commits', { q: `repo:${base.fullName} author:${forkOwner}` });
  const upstreamMessages = new Set((data.items ?? []).map((c) => c.commit.message));
  const forkMessages = new Set(forkCommits.map((c) => c.message));
  return [...upstreamMessages].filter((m) => forkMessages.has(m));
}

export function getCommitsOutsidePrs(prs, forkCommits) {
  if (!prs.length) return [];
  const prMessages = new Set(prs.flatMap((pr) => pr.commits.map((c) => c.message)));
  return forkCommits.map((c) => c.message).filter((m) => !prMessages.has(m));
}

async function findSubmoduleRepos(gh, login, forkName) {
  const target = `${login}/${forkName}`.toLowerCase();
  const relative = `../${forkName.toLowerCase()}`;
  const found = new Set();
  let after = null;
  let scanned = 0;

  while (scanned < SUBMODULE_SCAN_MAX_REPOS) {
    const data = await gh.graphql(SUBMODULES_QUERY, { login, after });
    const repos = data.repositoryOwner?.repositories;
    if (!repos) break;
    for (const r of repos.nodes) {
      const text = r.object?.text?.toLowerCase();
      if (text && (text.includes(target) || text.includes(relative))) found.add(`${login}/${r.name}`);
    }
    scanned += repos.nodes.length;
    if (!repos.pageInfo.hasNextPage) break;
    after = repos.pageInfo.endCursor;
  }

  return found.size
    ? { is_submodule: true, fork_submodule_repos: [...found] }
    : { is_submodule: false };
}

async function fetchOwnerRepos(gh, username, limit) {
  const repos = [];
  let after = null;
  while (repos.length < limit) {
    const data = await gh.graphql(OWNER_REPOS_QUERY, {
      username,
      count: Math.min(50, limit - repos.length),
      after,
    });
    const owner = data.repositoryOwner;
    if (!owner) break;
    for (const repo of owner.repositories.nodes) {
      const refs = repo.refs.nodes;
      const dates = refs.map((b) => b.target?.committedDate).filter(Boolean).sort();
      repos.push({
        name: repo.url,
        description: repo.description,
        archived: repo.isArchived,
        branches: refs.map((b) => b.name),
        last_updated: dates.at(-1) ?? null,
      });
    }
    if (!owner.repositories.pageInfo.hasNextPage) break;
    after = owner.repositories.pageInfo.endCursor;
  }
  return repos.slice(0, limit);
}
