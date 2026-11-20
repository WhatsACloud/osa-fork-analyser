import { FETCH_STEPS, fetchForkData } from '../github/forkData.js';
import { classify } from './categoriser.js';
import { extractSignals } from './llm.js';

export const TOTAL_STEPS = FETCH_STEPS + 1;

/**
 * @typedef {object} AnalysisResult
 * @property {'complete'} status
 * @property {string} engineeringLabel
 * @property {string} upstreamLabel
 * @property {string} purposeSummary
 * @property {Array<{ name: string, description: string, comes_from_upstream: boolean, filepaths_modified: string[] }>} featureList
 * @property {Record<string, boolean>} signals
 * @property {{ evidence?: string[], inference?: string[] }} thoughtProcess
 * @property {{ username?: string, profile_summary?: string }} forkCreator
 * @property {Array<{ name: string, description: string, label: string }>} toolsUsed
 * @property {{ inputTokens: number, outputTokens: number, costUsd: number }} usage
 * @property {number} durationMs
 * @property {string} analysedAt  ISO timestamp
 */

/**
 * Full pipeline for one fork: GitHub data → LLM observations → rule-based labels.
 * @param {string} forkFullName
 * @param {{ gh: import('../github/client.js').GitHubClient, openaiKey: string,
 *           onStep?: (label: string, index: number) => void }} deps
 * @returns {Promise<AnalysisResult>}
 */
export async function analyseFork(forkFullName, { gh, openaiKey, onStep }) {
  const start = performance.now();
  const forkData = await fetchForkData(gh, forkFullName, null, onStep);

  onStep?.('Asking the LLM…', TOTAL_STEPS);
  const { extraction, usage } = await extractSignals(forkData, openaiKey);
  const { engineeringLabel, upstreamLabel } = classify(extraction.signals);

  return {
    status: 'complete',
    engineeringLabel,
    upstreamLabel,
    ...extraction,
    usage,
    durationMs: Math.round(performance.now() - start),
    analysedAt: new Date().toISOString(),
  };
}
