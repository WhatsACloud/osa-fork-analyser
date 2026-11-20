const OWNER = /^[A-Za-z0-9_-]+$/;
const REPO = /^[A-Za-z0-9_.-]+$/;

/**
 * @typedef {{ owner: string, repo: string, fullName: string }} RepoRef
 */

/**
 * Accepts "owner/repo", "github.com/owner/repo" or a full GitHub URL (extra path segments ignored).
 * @param {string} input
 * @returns {RepoRef}
 */
export function parseRepoRef(input) {
  const parts = String(input ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')
    .filter(Boolean);
  if (/^(www\.)?github\.com$/i.test(parts[0] ?? '')) parts.shift();

  const owner = parts[0] ?? '';
  const repo = (parts[1] ?? '').replace(/\.git$/i, '');
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') {
    throw new Error(`Not a GitHub repository: "${input}"`);
  }
  return { owner, repo, fullName: `${owner}/${repo}` };
}

export function repoKey(fullName) {
  return fullName.toLowerCase();
}

export function encodeBranch(branch) {
  return encodeURIComponent(branch).replace(/%2F/g, '/');
}
