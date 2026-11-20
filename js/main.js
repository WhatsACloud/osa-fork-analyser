import { TOTAL_STEPS, analyseFork } from './analysis/analyse.js';
import { FORK_CHECK_CONCURRENCY, MAX_FORKS, MAX_FORKS_SCANNED, SOURCE_URL } from './config.js';
import { downloadCsv, forksToCsv } from './csv.js';
import { $ } from './dom.js';
import { GitHubClient } from './github/client.js';
import { findForksAhead, lookupFork } from './github/forks.js';
import { parseRepoRef, repoKey } from './github/repo.js';
import { mapConcurrent } from './queue.js';
import { resultsStore, sessionStore, settingsStore } from './store.js';
import { renderForkTable } from './ui/forkTable.js';
import { initSettings } from './ui/settings.js';
import { initTheme } from './ui/theme.js';

const ui = {
  repoForm: $('#repo-form'),
  repoInput: $('#repo-input'),
  fetchBtn: $('#fetch-btn'),
  badge: $('#api-badge'),
  addForm: $('#add-fork-form'),
  forkInput: $('#fork-input'),
  addBtn: $('#add-btn'),
  analyseBtn: $('#analyse-btn'),
  stopBtn: $('#stop-btn'),
  csvBtn: $('#csv-btn'),
  clearBtn: $('#clear-btn'),
  status: $('#status'),
  summary: $('#list-summary'),
  intro: $('#intro'),
  tableWrap: $('#table-wrap'),
  tbody: $('#fork-rows'),
};

const state = {
  repo: '',
  /** @type {import('./github/forks.js').ForkRecord[]} */
  forks: [],
  /** @type {Record<string, any>} keyed by lower-cased fork full name */
  results: resultsStore.all(),
  /** @type {Map<string, import('./ui/forkTable.js').LiveStatus>} */
  live: new Map(),
  /** @type {Set<string>} */
  expanded: new Set(),
  /** @type {null | 'fetching' | 'adding' | 'analysing'} */
  busy: null,
  /** @type {AbortController | null} */
  abort: null,
};

let settings = settingsStore.load();
let gh = new GitHubClient(settings.githubToken, updateBadge);

const settingsDialog = initSettings({
  onSave(next) {
    const tokenChanged = next.githubToken !== settings.githubToken;
    settings = next;
    if (tokenChanged) {
      gh = new GitHubClient(settings.githubToken, updateBadge);
      updateBadge(gh);
    }
    setStatus('Settings saved.');
  },
  onClearResults() {
    resultsStore.clear();
    state.results = {};
    setStatus('Cached results cleared.');
    render();
  },
});

// ── Rendering ──────────────────────────────────────────────────────────────

// Coalesces bursts of progress events into one re-render. A timer rather than
// requestAnimationFrame so updates keep landing while the tab is in the background.
let renderPending = false;
function render() {
  if (renderPending) return;
  renderPending = true;
  setTimeout(() => {
    renderPending = false;
    renderNow();
  }, 50);
}

function renderNow() {
  const hasForks = state.forks.length > 0;
  const analysing = state.busy === 'analysing';

  ui.intro.hidden = hasForks;
  ui.tableWrap.hidden = !hasForks;
  ui.fetchBtn.disabled = state.busy !== null;
  ui.repoInput.disabled = state.busy !== null;
  ui.forkInput.disabled = state.busy !== null;
  ui.addBtn.disabled = state.busy !== null;
  ui.analyseBtn.hidden = analysing;
  ui.analyseBtn.disabled = state.busy !== null || !hasForks;
  ui.stopBtn.hidden = !analysing;
  ui.stopBtn.disabled = state.abort?.signal.aborted ?? false;
  ui.csvBtn.disabled = !hasForks;
  ui.clearBtn.disabled = state.busy !== null || !hasForks;

  const analysed = state.forks.filter((f) => state.results[repoKey(f.fullName)]?.status === 'complete');
  const cost = analysed.reduce((sum, f) => sum + (state.results[repoKey(f.fullName)].usage?.costUsd ?? 0), 0);
  ui.summary.textContent = hasForks
    ? `${state.forks.length} fork${state.forks.length === 1 ? '' : 's'} · ${analysed.length} analysed` +
      (cost ? ` · ~$${cost.toFixed(2)} spent` : '')
    : '';

  renderForkTable(ui.tbody, { ...state, busy: state.busy !== null }, {
    onToggle(fork) {
      const key = repoKey(fork.fullName);
      if (!state.expanded.delete(key)) state.expanded.add(key);
      render();
    },
    onReanalyse(fork) {
      runAnalysis([fork]);
    },
    onRemove(fork) {
      const key = repoKey(fork.fullName);
      state.forks = state.forks.filter((f) => repoKey(f.fullName) !== key);
      state.expanded.delete(key);
      saveSession();
      render();
    },
  });
}

function setStatus(message, kind = 'info') {
  ui.status.textContent = message;
  ui.status.dataset.kind = kind;
}

function updateBadge(client) {
  const core = client.rateLimits.core;
  ui.badge.textContent = `${client.calls} call${client.calls === 1 ? '' : 's'}`;
  ui.badge.title = core
    ? `GitHub API calls this session. ${core.remaining}/${core.limit} core requests left this hour.`
    : 'GitHub API calls this session';
}

function saveSession() {
  sessionStore.save({ repo: state.repo, forks: state.forks });
}

// ── Actions ────────────────────────────────────────────────────────────────

async function fetchForks(event) {
  event.preventDefault();
  let ref;
  try {
    ref = parseRepoRef(ui.repoInput.value);
  } catch (err) {
    setStatus(err.message, 'error');
    return;
  }
  if (!settings.githubToken) {
    settingsDialog.open('Fetching forks needs a GitHub token: checking each fork uses one API request, and anonymous use is capped at 60 an hour.');
    return;
  }

  state.busy = 'fetching';
  setStatus(`Looking for forks of ${ref.fullName} with commits ahead of upstream…`);
  render();

  try {
    const { upstream, forks } = await findForksAhead(gh, ref, {
      max: MAX_FORKS,
      maxScanned: MAX_FORKS_SCANNED,
      concurrency: FORK_CHECK_CONCURRENCY,
      onProgress: ({ scanned, checked, found }) =>
        setStatus(`Scanned ${scanned} forks, compared ${checked} with upstream, ${found} ahead so far…`),
    });

    const upstreamKey = repoKey(upstream.full_name);
    const fetchedKeys = new Set(forks.map((f) => repoKey(f.fullName)));
    const manual = state.forks.filter(
      (f) => f.source === 'manual' && repoKey(f.parent) === upstreamKey && !fetchedKeys.has(repoKey(f.fullName)),
    );

    state.repo = upstream.full_name;
    state.forks = [...forks, ...manual];
    ui.repoInput.value = upstream.full_name;
    history.replaceState(null, '', `?repo=${encodeURIComponent(upstream.full_name)}`);
    saveSession();

    setStatus(
      forks.length
        ? `Found ${forks.length} fork${forks.length === 1 ? '' : 's'} of ${upstream.full_name} with commits ahead of upstream` +
            (forks.length === MAX_FORKS ? ` (capped at ${MAX_FORKS}, most-starred first).` : '.')
        : `No forks of ${upstream.full_name} have commits ahead of upstream.`,
    );
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    state.busy = null;
    render();
  }
}

async function addFork(event) {
  event.preventDefault();
  const value = ui.forkInput.value.trim();
  if (!value) return;

  let ref;
  try {
    ref = parseRepoRef(value);
  } catch (err) {
    setStatus(err.message, 'error');
    return;
  }
  const isListed = (name) => state.forks.some((f) => repoKey(f.fullName) === repoKey(name));
  if (isListed(ref.fullName)) {
    setStatus(`${ref.fullName} is already in the list.`);
    return;
  }

  state.busy = 'adding';
  setStatus(`Looking up ${ref.fullName}…`);
  render();
  try {
    const fork = await lookupFork(gh, value);
    if (isListed(fork.fullName)) {
      setStatus(`${fork.fullName} is already in the list.`);
    } else {
      state.forks.push(fork);
      ui.forkInput.value = '';
      saveSession();
      setStatus(`Added ${fork.fullName} (fork of ${fork.parent}).`);
    }
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    state.busy = null;
    render();
  }
}

function analyseAll() {
  const pending = state.forks.filter((f) => state.results[repoKey(f.fullName)]?.status !== 'complete');
  if (!pending.length) {
    setStatus('Every fork in the list is already analysed. Use ↻ on a row to re-run one.');
    return;
  }
  runAnalysis(pending);
}

/** Queues forks and analyses them `settings.concurrency` at a time. */
async function runAnalysis(forks) {
  if (state.busy) return;
  if (!settings.openaiKey || !settings.githubToken) {
    settingsDialog.open('Analysis needs both an OpenAI API key and a GitHub token.');
    return;
  }

  const controller = new AbortController();
  state.busy = 'analysing';
  state.abort = controller;
  for (const f of forks) state.live.set(repoKey(f.fullName), { state: 'queued' });

  let done = 0;
  let failed = 0;
  let cost = 0;
  let lastError = '';
  const progress = () =>
    `Analysing ${forks.length} fork${forks.length === 1 ? '' : 's'}, ${settings.concurrency} at a time: ` +
    `${done} done, ${failed} failed, ~$${cost.toFixed(2)} so far.`;
  setStatus(progress());
  render();

  await mapConcurrent(
    forks,
    settings.concurrency,
    async (fork) => {
      const key = repoKey(fork.fullName);
      const setStep = (label, index) => {
        state.live.set(key, { state: 'running', label, index, total: TOTAL_STEPS });
        render();
      };
      setStep('Starting…', 0);

      try {
        const result = await analyseFork(fork.fullName, { gh, openaiKey: settings.openaiKey, onStep: setStep });
        state.results[key] = result;
        if (!resultsStore.set(fork.fullName, result)) {
          lastError = 'Browser storage is full: new results will be lost on reload. Download the CSV.';
        }
        done++;
        cost += result.usage.costUsd;
      } catch (err) {
        failed++;
        lastError = `${fork.fullName}: ${err.message}`;
        // Keep an earlier good result rather than replacing it with this failure.
        if (state.results[key]?.status !== 'complete') {
          state.results[key] = { status: 'error', error: err.message };
        }
      } finally {
        state.live.delete(key);
        setStatus(progress());
        render();
      }
    },
    { signal: controller.signal },
  );

  for (const f of forks) state.live.delete(repoKey(f.fullName));
  state.busy = null;
  state.abort = null;

  const stopped = controller.signal.aborted ? 'Stopped. ' : '';
  const summary = `${stopped}${done} analysed, ${failed} failed, ~$${cost.toFixed(2)} spent.`;
  setStatus(lastError ? `${summary} Last error: ${lastError}` : summary, failed ? 'error' : 'info');
  render();
}

function stopAnalysis() {
  state.abort?.abort();
  setStatus('Stopping: forks already in progress will finish; the rest are left for the next Analyse.');
  render();
}

function exportCsv() {
  const name = (state.repo || 'forks').replace(/[^A-Za-z0-9_.-]+/g, '_');
  const date = new Date().toISOString().slice(0, 10);
  downloadCsv(`${name}-forks-${date}.csv`, forksToCsv(state.forks, state.results));
}

function clearList() {
  state.forks = [];
  state.expanded.clear();
  saveSession();
  setStatus('List cleared. Cached results are kept and reappear if you add the same forks again.');
  render();
}

// ── Boot ───────────────────────────────────────────────────────────────────

function restoreSession() {
  const saved = sessionStore.load();
  const requested = new URLSearchParams(location.search).get('repo');
  if (requested && repoKey(requested) !== repoKey(saved.repo || '')) {
    ui.repoInput.value = requested;
    return;
  }
  state.repo = saved.repo;
  state.forks = saved.forks ?? [];
  ui.repoInput.value = saved.repo;
}

initTheme($('#theme-toggle'));
document.querySelectorAll('[data-open-settings]').forEach((btn) =>
  btn.addEventListener('click', () => settingsDialog.open()),
);
document.querySelectorAll('[data-source-link]').forEach((a) => a.setAttribute('href', SOURCE_URL));

ui.repoForm.addEventListener('submit', fetchForks);
ui.addForm.addEventListener('submit', addFork);
ui.analyseBtn.addEventListener('click', analyseAll);
ui.stopBtn.addEventListener('click', stopAnalysis);
ui.csvBtn.addEventListener('click', exportCsv);
ui.clearBtn.addEventListener('click', clearList);
window.addEventListener('beforeunload', (e) => {
  if (state.busy === 'analysing') e.preventDefault();
});

restoreSession();
updateBadge(gh);
if (!settings.githubToken || !settings.openaiKey) {
  setStatus('Add your GitHub token and OpenAI key under ⚙ Settings to get started.');
}
renderNow();
