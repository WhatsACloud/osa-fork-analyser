import { repoKey } from './github/repo.js';

export const CSV_COLUMNS = [
  'fork_url',
  'upstream',
  'stars',
  'ahead_by',
  'behind_by',
  'status',
  'engineering_label',
  'upstream_relationship_label',
  'purpose_summary',
  'features',
  'error',
  'input_tokens',
  'output_tokens',
  'cost_usd',
  'analysed_at',
];

/**
 * @param {import('./github/forks.js').ForkRecord[]} forks
 * @param {Record<string, object>} results  keyed by lower-cased full name
 */
export function forksToCsv(forks, results) {
  const rows = forks.map((fork) => {
    const r = results[repoKey(fork.fullName)] ?? {};
    return [
      fork.url,
      fork.parent,
      fork.stars,
      fork.aheadBy,
      fork.behindBy,
      r.status ?? 'not_analysed',
      r.engineeringLabel,
      r.upstreamLabel,
      r.purposeSummary,
      (r.featureList ?? []).map((f) => f.name).join('; '),
      r.error,
      r.usage?.inputTokens,
      r.usage?.outputTokens,
      r.usage?.costUsd,
      r.analysedAt,
    ];
  });
  return toCsv([CSV_COLUMNS, ...rows]);
}

export function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Text from repos/LLM could start with a formula character; stop spreadsheets executing it.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename, csv) {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
