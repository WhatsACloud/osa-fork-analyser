/**
 * Runs `worker` over `items` with at most `limit` in flight, preserving result order.
 * When `signal` aborts, no new items start; in-flight ones finish and skipped slots stay undefined.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<R[]>}
 */
export async function mapConcurrent(items, limit, worker, { signal } = {}) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length && !signal?.aborted) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }

  const runners = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: runners }, run));
  return results;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
