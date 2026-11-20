import { OPENAI_MODEL, OPENAI_PRICING } from '../config.js';
import { sleep } from '../queue.js';
import { normaliseSignals } from './signals.js';

const PROMPT_URL = new URL('../../prompts/extract.prompt', import.meta.url);
const MAX_RETRIES = 2;

let promptPromise = null;

function loadPrompt() {
  promptPromise ??= fetch(PROMPT_URL).then((res) => {
    if (!res.ok) throw new Error(`Could not load prompt (${res.status})`);
    return res.text();
  });
  promptPromise.catch(() => (promptPromise = null));
  return promptPromise;
}

/**
 * Sends fork data to OpenAI and returns its observations. No labelling happens here.
 * @param {object} forkData  output of fetchForkData()
 * @param {string} apiKey
 */
export async function extractSignals(forkData, apiKey, model = OPENAI_MODEL) {
  const template = await loadPrompt();
  const prompt = `${template}\n\nFORK DATA:\n${JSON.stringify(forkData, null, 2)}`;
  const { content, usage } = await callOpenAI(prompt, apiKey, model);
  const parsed = parseJson(cleanResponse(content));

  return {
    extraction: {
      signals: normaliseSignals(parsed.signals),
      featureList: parsed.feature_list ?? [],
      purposeSummary: parsed.purpose_summary ?? '',
      thoughtProcess: parsed.thought_process ?? {},
      forkCreator: parsed.fork_creator ?? {},
      toolsUsed: parsed.tools_used ?? [],
    },
    usage,
  };
}

async function callOpenAI(prompt, apiKey, model, attempt = 0) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const retryable =
      (res.status === 429 && body.error?.code !== 'insufficient_quota') || res.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 5000 * (attempt + 1));
      return callOpenAI(prompt, apiKey, model, attempt + 1);
    }
    throw new Error(`OpenAI ${res.status}: ${body.error?.message ?? res.statusText}`);
  }

  const inputTokens = body.usage?.prompt_tokens ?? 0;
  const outputTokens = body.usage?.completion_tokens ?? 0;
  const costUsd =
    (inputTokens * OPENAI_PRICING.input + outputTokens * OPENAI_PRICING.output) / 1_000_000;

  return {
    content: body.choices?.[0]?.message?.content ?? '',
    usage: { inputTokens, outputTokens, costUsd: Math.round(costUsd * 1e6) / 1e6 },
  };
}

export function cleanResponse(text) {
  return text
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .replace(/\(\[.*?\]\(.*?\)\)/g, '')
    .trim();
}

export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{.*\}/s);
    if (match) return JSON.parse(match[0]);
    throw new Error(`LLM response is not valid JSON. Starts with: ${text.slice(0, 200)}`);
  }
}
