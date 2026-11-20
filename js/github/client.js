import { sleep } from '../queue.js';

const API_ORIGIN = 'https://api.github.com';
const MAX_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 65_000;

/**
 * Thin wrapper over the GitHub REST + GraphQL APIs.
 * Counts calls, tracks rate limits and waits out short rate-limit windows.
 */
export class GitHubClient {
  /**
   * @param {string} token  personal access token ('' for unauthenticated REST calls)
   * @param {(client: GitHubClient) => void} [onUpdate]  called after every request
   */
  constructor(token, onUpdate) {
    this.token = token;
    this.onUpdate = onUpdate;
    this.calls = 0;
    /** @type {Record<string, { remaining: number, limit: number, reset: number }>} */
    this.rateLimits = {};
  }

  /**
   * GET a REST endpoint and return its JSON. Throws on any non-2xx response.
   * @param {string} path  "/repos/..." or an absolute api.github.com URL
   * @param {Record<string, string | number>} [params]
   */
  async rest(path, params) {
    const res = await this.#get(path, params);
    if (!res.ok) throw await toError(res, path);
    return res.json();
  }

  /** Like rest(), but returns null instead of throwing for 404/422 responses. */
  async restOrNull(path, params) {
    const res = await this.#get(path, params);
    if (res.status === 404 || res.status === 422) return null;
    if (!res.ok) throw await toError(res, path);
    return res.json();
  }

  async graphql(query, variables) {
    if (!this.token) throw new Error('A GitHub token is required for GraphQL requests');
    const res = await this.#request(`${API_ORIGIN}/graphql`, {
      method: 'POST',
      headers: this.#headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw await toError(res, 'graphql');
    const body = await res.json();
    if (body.errors?.length) {
      throw new Error(`GitHub GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    return body.data;
  }

  #get(path, params) {
    const url = new URL(path, API_ORIGIN);
    // Never send the token anywhere but the GitHub API, even if an API response hands us another URL.
    if (url.origin !== API_ORIGIN) throw new Error(`Refusing non-GitHub API URL: ${url.origin}`);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));
    return this.#request(url.toString(), { headers: this.#headers() });
  }

  #headers(extra = {}) {
    const headers = { Accept: 'application/vnd.github+json', ...extra };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  async #request(url, init, attempt = 0) {
    const res = await fetch(url, init);
    this.calls++;
    this.#recordRateLimit(res);
    this.onUpdate?.(this);

    if (attempt < MAX_RETRIES && (await isRateLimited(res))) {
      const wait = retryDelayMs(res);
      if (wait <= MAX_RETRY_WAIT_MS) {
        await sleep(wait);
        return this.#request(url, init, attempt + 1);
      }
    }
    return res;
  }

  #recordRateLimit(res) {
    const resource = res.headers.get('x-ratelimit-resource');
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (!resource || remaining === null) return;
    this.rateLimits[resource] = {
      remaining: Number(remaining),
      limit: Number(res.headers.get('x-ratelimit-limit')),
      reset: Number(res.headers.get('x-ratelimit-reset')) * 1000,
    };
  }
}

async function isRateLimited(res) {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  if (res.headers.get('x-ratelimit-remaining') === '0') return true;
  const body = await res.clone().json().catch(() => ({}));
  return /rate limit/i.test(body.message ?? '');
}

function retryDelayMs(res) {
  const retryAfter = Number(res.headers.get('retry-after'));
  if (retryAfter > 0) return retryAfter * 1000;
  if (res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
    return Math.max(1000, reset - Date.now() + 1000);
  }
  return 60_000;
}

async function toError(res, what) {
  const body = await res.json().catch(() => ({}));
  let message = body.message ?? res.statusText;
  if (res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = new Date(Number(res.headers.get('x-ratelimit-reset')) * 1000);
    message = `rate limit exhausted, resets at ${reset.toLocaleTimeString()}`;
  }
  const error = new Error(`GitHub ${res.status} (${what}): ${message}`);
  error.status = res.status;
  return error;
}
