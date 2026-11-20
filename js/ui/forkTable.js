import { el } from '../dom.js';
import { repoKey } from '../github/repo.js';

/**
 * @typedef {{ state: 'queued' } | { state: 'running', label: string, index: number, total: number }} LiveStatus
 *
 * @typedef {object} TableState
 * @property {import('../github/forks.js').ForkRecord[]} forks
 * @property {Record<string, any>} results     keyed by lower-cased full name
 * @property {Map<string, LiveStatus>} live     keyed by lower-cased full name
 * @property {Set<string>} expanded             lower-cased full names with details open
 * @property {boolean} busy
 *
 * @typedef {object} TableHandlers
 * @property {(fork: import('../github/forks.js').ForkRecord) => void} onReanalyse
 * @property {(fork: import('../github/forks.js').ForkRecord) => void} onRemove
 * @property {(fork: import('../github/forks.js').ForkRecord) => void} onToggle
 */

/**
 * @param {HTMLTableSectionElement} tbody
 * @param {TableState} state
 * @param {TableHandlers} handlers
 */
export function renderForkTable(tbody, state, handlers) {
  const rows = state.forks.flatMap((fork) => {
    const key = repoKey(fork.fullName);
    const result = state.results[key];
    const live = state.live.get(key);
    const open = state.expanded.has(key);
    const row = forkRow(fork, result, live, open, state.busy, handlers);
    return open ? [row, detailsRow(fork, result)] : [row];
  });
  tbody.replaceChildren(...rows);
}

function forkRow(fork, result, live, open, busy, handlers) {
  const done = result?.status === 'complete';
  const toggle = () => handlers.onToggle(fork);

  return el(
    'tr',
    {
      class: `fork-row${open ? ' is-open' : ''}`,
      onclick: (e) => {
        if (!e.target.closest('a, button')) toggle();
      },
    },
    el(
      'td',
      { class: 'col-fork' },
      el(
        'div',
        { class: 'fork-cell' },
        el(
          'button',
          {
            class: 'expand',
            'aria-expanded': String(open),
            'aria-label': `${open ? 'Hide' : 'Show'} details for ${fork.fullName}`,
            onclick: toggle,
          },
          '▸',
        ),
        el(
          'div',
          {},
          el('a', { href: fork.url, target: '_blank', rel: 'noopener noreferrer' }, fork.fullName),
          el('div', { class: 'meta' }, forkMeta(fork)),
        ),
      ),
    ),
    el('td', { class: 'col-status' }, statusCell(result, live)),
    el('td', {}, done ? el('span', { class: 'pill pill-eng' }, result.engineeringLabel) : ''),
    el('td', {}, done ? el('span', { class: 'pill pill-up' }, result.upstreamLabel) : ''),
    el('td', { class: 'col-summary' }, done ? result.purposeSummary : ''),
    el(
      'td',
      { class: 'col-actions' },
      el(
        'button',
        {
          class: 'icon-btn',
          title: 'Re-analyse this fork',
          'aria-label': `Re-analyse ${fork.fullName}`,
          disabled: busy,
          onclick: () => handlers.onReanalyse(fork),
        },
        '↻',
      ),
      el(
        'button',
        {
          class: 'icon-btn',
          title: 'Remove from list',
          'aria-label': `Remove ${fork.fullName}`,
          disabled: busy,
          onclick: () => handlers.onRemove(fork),
        },
        '×',
      ),
    ),
  );
}

function forkMeta(fork) {
  const parts = [`★ ${fork.stars}`];
  if (fork.aheadBy !== null) parts.push(`${fork.aheadBy} ahead`);
  if (fork.behindBy !== null) parts.push(`${fork.behindBy} behind`);
  if (fork.source === 'manual') parts.push('added manually');
  return parts.join(' · ');
}

function statusCell(result, live) {
  if (live?.state === 'running') {
    return el(
      'div',
      { class: 'progress', title: live.label },
      el('span', { class: 'progress-label' }, `${live.index}/${live.total} ${live.label}`),
      el('progress', { max: live.total, value: live.index }),
    );
  }
  if (live?.state === 'queued') return el('span', { class: 'status status-queued' }, 'Queued');
  if (result?.status === 'complete') return el('span', { class: 'status status-done' }, 'Done');
  if (result?.status === 'error') {
    return el('span', { class: 'status status-error', title: result.error }, 'Error');
  }
  return el('span', { class: 'status' }, 'Not analysed');
}

function detailsRow(fork, result) {
  return el(
    'tr',
    { class: 'details-row' },
    el('td', { colspan: 6 }, el('div', { class: 'details' }, detailsContent(fork, result))),
  );
}

function detailsContent(fork, result) {
  const description = fork.description
    ? el('p', { class: 'muted' }, fork.description)
    : null;

  if (result?.status === 'error') {
    return [description, el('p', { class: 'error-text' }, result.error)];
  }
  if (result?.status !== 'complete') {
    return [description, el('p', { class: 'muted' }, 'Not analysed yet.')];
  }

  const trueSignals = Object.entries(result.signals ?? {}).filter(([, v]) => v === true);
  const evidence = result.thoughtProcess?.evidence ?? [];
  const inference = result.thoughtProcess?.inference ?? [];
  const { inputTokens = 0, outputTokens = 0, costUsd = 0 } = result.usage ?? {};

  return [
    description,
    section(
      'Features',
      result.featureList.length
        ? el(
            'ul',
            {},
            result.featureList.map((f) =>
              el(
                'li',
                {},
                el('strong', {}, f.name),
                f.comes_from_upstream ? el('span', { class: 'tag' }, 'from upstream') : null,
                f.description && f.description !== f.name ? ` — ${f.description}` : '',
                f.filepaths_modified?.length
                  ? el('div', { class: 'files' }, f.filepaths_modified.join(', '))
                  : null,
              ),
            ),
          )
        : el('p', { class: 'muted' }, 'None reported.'),
    ),
    section(
      'Signals',
      trueSignals.length
        ? el('div', { class: 'chips' }, trueSignals.map(([k]) => el('span', { class: 'chip' }, k)))
        : el('p', { class: 'muted' }, 'No signals were true.'),
    ),
    evidence.length || inference.length
      ? section(
          'Reasoning',
          el(
            'div',
            { class: 'reasoning' },
            el('div', {}, el('h4', {}, 'Evidence'), el('ul', {}, evidence.map((e) => el('li', {}, e)))),
            el('div', {}, el('h4', {}, 'Inference'), el('ul', {}, inference.map((i) => el('li', {}, i)))),
          ),
        )
      : null,
    result.forkCreator?.profile_summary
      ? section(
          'Fork creator',
          el('p', {}, el('strong', {}, result.forkCreator.username ?? ''), ' ', result.forkCreator.profile_summary),
        )
      : null,
    result.toolsUsed?.length
      ? section(
          'Tools used',
          el('ul', {}, result.toolsUsed.map((t) => el('li', {}, el('strong', {}, t.name), ` (${t.label}) — ${t.description}`))),
        )
      : null,
    el(
      'p',
      { class: 'muted small' },
      `Analysed ${new Date(result.analysedAt).toLocaleString()} · ${(result.durationMs / 1000).toFixed(1)}s · ` +
        `${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out tokens · ~$${costUsd.toFixed(4)}`,
    ),
  ];
}

function section(title, body) {
  return el('section', { class: 'detail-section' }, el('h3', {}, title), body);
}
