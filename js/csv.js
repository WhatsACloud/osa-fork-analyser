import { parseRepoRef, repoKey } from './github/repo.js';

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

// Everything an expanded fork row shows, plus the minified columns above, so a full
// export round-trips through parseForksCsv() back into the same detail view.
export const FULL_CSV_COLUMNS = [
  ...CSV_COLUMNS.slice(0, -1),
  'duration_ms',
  'signals_json',
  'feature_list_json',
  'thought_process_json',
  'fork_creator_json',
  'tools_used_json',
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

/**
 * Same rows as {@link forksToCsv}, plus every field the expanded fork row shows
 * (signals, full feature list, reasoning, fork creator, tools used) as JSON cells.
 * @param {import('./github/forks.js').ForkRecord[]} forks
 * @param {Record<string, object>} results
 */
export function forksToFullCsv(forks, results) {
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
      r.durationMs,
      jsonCell(r.signals),
      jsonCell(r.featureList),
      jsonCell(r.thoughtProcess),
      jsonCell(r.forkCreator),
      jsonCell(r.toolsUsed),
      r.analysedAt,
    ];
  });
  return toCsv([FULL_CSV_COLUMNS, ...rows]);
}

function jsonCell(value) {
  return value === undefined ? '' : JSON.stringify(value);
}

/**
 * Inverse of {@link forksToCsv} / {@link forksToFullCsv}: reads either format back into
 * a fork list and a results map, so a downloaded CSV can be loaded and viewed again.
 * @param {string} text
 * @returns {{ forks: import('./github/forks.js').ForkRecord[], results: Record<string, object> }}
 */
export function parseForksCsv(text) {
  const table = parseCsv(text).map((row) => row.map(unescapeCsvCell));
  const header = table[0] ?? [];
  const col = Object.fromEntries(header.map((name, i) => [name, i]));
  const isFull = 'signals_json' in col;

  const forks = [];
  const results = {};
  for (const row of table.slice(1)) {
    if (row.every((cell) => cell === '')) continue; // trailing blank line
    const get = (name) => (name in col ? (row[col[name]] ?? '') : '');

    const url = get('fork_url');
    let fullName;
    try {
      fullName = parseRepoRef(url).fullName;
    } catch {
      continue; // not a recognisable fork row, skip it
    }

    forks.push({
      fullName,
      url,
      parent: get('upstream'),
      stars: toNumber(get('stars')) ?? 0,
      aheadBy: toNumber(get('ahead_by')),
      behindBy: toNumber(get('behind_by')),
      defaultBranch: '',
      pushedAt: '',
      description: '',
      source: 'manual',
    });

    const status = get('status');
    if (status === 'complete') {
      results[repoKey(fullName)] = {
        status: 'complete',
        engineeringLabel: get('engineering_label'),
        upstreamLabel: get('upstream_relationship_label'),
        purposeSummary: get('purpose_summary'),
        featureList: isFull
          ? (parseJsonCell(get('feature_list_json')) ?? [])
          : splitFeatureNames(get('features')),
        signals: isFull ? (parseJsonCell(get('signals_json')) ?? {}) : {},
        thoughtProcess: isFull ? (parseJsonCell(get('thought_process_json')) ?? {}) : {},
        forkCreator: isFull ? (parseJsonCell(get('fork_creator_json')) ?? {}) : {},
        toolsUsed: isFull ? (parseJsonCell(get('tools_used_json')) ?? []) : [],
        usage: {
          inputTokens: toNumber(get('input_tokens')) ?? 0,
          outputTokens: toNumber(get('output_tokens')) ?? 0,
          costUsd: toNumber(get('cost_usd')) ?? 0,
        },
        durationMs: toNumber(get('duration_ms')) ?? 0,
        analysedAt: get('analysed_at') || new Date().toISOString(),
      };
    } else if (status === 'error') {
      results[repoKey(fullName)] = { status: 'error', error: get('error') || 'Unknown error' };
    }
  }
  return { forks, results };
}

function splitFeatureNames(joined) {
  return joined
    ? joined
        .split('; ')
        .filter(Boolean)
        .map((name) => ({ name, description: '', comes_from_upstream: false, filepaths_modified: [] }))
    : [];
}

function toNumber(cell) {
  if (cell === '') return null;
  const n = Number(cell);
  return Number.isFinite(n) ? n : null;
}

function parseJsonCell(cell) {
  if (!cell) return undefined;
  try {
    return JSON.parse(cell);
  } catch {
    return undefined;
  }
}

/** Reverses the `'` prefix {@link csvCell} adds before formula-like text. */
function unescapeCsvCell(cell) {
  return cell.length > 1 && cell[0] === "'" && /^[=+\-@\t\r]/.test(cell.slice(1)) ? cell.slice(1) : cell;
}

/**
 * Parses RFC4180-ish CSV text (as produced by {@link toCsv}) into rows of raw string
 * cells: handles quoted fields, doubled-quote escapes, and a leading BOM.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r') {
      // part of a \r\n line ending; the \n below ends the row
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
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
