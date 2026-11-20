import { mapConcurrent } from '../queue.js';
import { encodeBranch, parseRepoRef } from './repo.js';

/**
 * @typedef {object} ForkRecord
 * @property {string} fullName
 * @property {string} url
 * @property {string} parent          upstream full name
 * @property {number} stars
 * @property {number | null} aheadBy  commits the fork has that upstream doesn't (null if unknown)
 * @property {number | null} behindBy
 * @property {string} defaultBranch
 * @property {string} pushedAt
 * @property {string} description
 * @property {'fetched' | 'manual'} source
 */

/**
 * Finds up to `max` forks of `ref` that have commits ahead of upstream, most-starred first.
 * Forks never pushed to after creation are skipped without an API call; the rest are
 * checked with a compare request.
 * @param {import('./client.js').GitHubClient} gh
 * @param {import('./repo.js').RepoRef} ref
 * @param {{ max: number, maxScanned: number, concurrency: number,
 *           onProgress?: (p: { scanned: number, checked: number, found: number }) => void }} options
 * @returns {Promise<{ upstream: object, forks: ForkRecord[] }>}
 */
export async function findForksAhead(gh, ref, { max, maxScanned, concurrency, onProgress }) {
  const upstream = await gh.rest(`/repos/${ref.owner}/${ref.repo}`);
  const found = [];
  let scanned = 0;
  let checked = 0;

  for (let page = 1; found.length < max && scanned < maxScanned; page++) {
    const forks = await gh.rest(`/repos/${ref.owner}/${ref.repo}/forks`, {
      sort: 'stargazers',
      per_page: 100,
      page,
    });
    scanned += forks.length;
    const candidates = forks.filter((f) => new Date(f.pushed_at) > new Date(f.created_at));

    // Check in small batches so we stop spending API calls once `max` is reached.
    for (let i = 0; i < candidates.length && found.length < max; i += concurrency) {
      const batch = candidates.slice(i, i + concurrency);
      const compares = await mapConcurrent(batch, concurrency, (f) =>
        compareWithUpstream(gh, upstream, f),
      );
      checked += batch.length;
      batch.forEach((fork, j) => {
        const cmp = compares[j];
        if (cmp && cmp.ahead_by > 0 && found.length < max) {
          found.push(toForkRecord(fork, upstream.full_name, cmp, 'fetched'));
        }
      });
      onProgress?.({ scanned, checked, found: found.length });
    }

    onProgress?.({ scanned, checked, found: found.length });
    if (forks.length < 100) break;
  }

  return { upstream, forks: found };
}

/**
 * Looks up a single fork pasted by the user.
 * @returns {Promise<ForkRecord>}
 */
export async function lookupFork(gh, input) {
  const ref = parseRepoRef(input);
  const repo = await gh.rest(`/repos/${ref.owner}/${ref.repo}`);
  if (!repo.fork || !repo.parent) throw new Error(`${repo.full_name} is not a fork`);
  const cmp = await compareWithUpstream(gh, repo.parent, repo);
  return toForkRecord(repo, repo.parent.full_name, cmp, 'manual');
}

function compareWithUpstream(gh, upstream, fork) {
  const base = encodeBranch(upstream.default_branch);
  const head = `${fork.owner.login}:${fork.name}:${encodeBranch(fork.default_branch)}`;
  return gh.restOrNull(`/repos/${upstream.full_name}/compare/${base}...${head}`, { per_page: 1 });
}

function toForkRecord(fork, parent, cmp, source) {
  return {
    fullName: fork.full_name,
    url: `https://github.com/${fork.full_name}`,
    parent,
    stars: fork.stargazers_count ?? 0,
    aheadBy: cmp?.ahead_by ?? null,
    behindBy: cmp?.behind_by ?? null,
    defaultBranch: fork.default_branch,
    pushedAt: fork.pushed_at,
    description: fork.description ?? '',
    source,
  };
}
