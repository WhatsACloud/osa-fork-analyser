import { MAX_CONCURRENCY } from '../config.js';
import { settingsStore } from '../store.js';

/**
 * Wires the settings <dialog> (API keys + concurrency).
 * @param {{ onSave: (s: import('../store.js').Settings) => void, onClearResults: () => void }} handlers
 */
export function initSettings({ onSave, onClearResults }) {
  const dialog = /** @type {HTMLDialogElement} */ (document.getElementById('settings-dialog'));
  const form = /** @type {HTMLFormElement} */ (dialog.querySelector('form'));
  const notice = dialog.querySelector('#settings-notice');
  const fields = {
    openaiKey: /** @type {HTMLInputElement} */ (form.elements.namedItem('openaiKey')),
    githubToken: /** @type {HTMLInputElement} */ (form.elements.namedItem('githubToken')),
    concurrency: /** @type {HTMLInputElement} */ (form.elements.namedItem('concurrency')),
  };
  fields.concurrency.max = String(MAX_CONCURRENCY);

  function open(message = '') {
    const s = settingsStore.load();
    fields.openaiKey.value = s.openaiKey;
    fields.githubToken.value = s.githubToken;
    fields.concurrency.value = String(s.concurrency);
    notice.textContent = message;
    notice.hidden = !message;
    dialog.showModal();
  }

  form.addEventListener('submit', (e) => {
    if (e.submitter?.value === 'cancel') return;
    const concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(fields.concurrency.value) || 1));
    const settings = {
      openaiKey: fields.openaiKey.value.trim(),
      githubToken: fields.githubToken.value.trim(),
      concurrency,
    };
    settingsStore.save(settings);
    onSave(settings);
  });

  dialog.querySelector('#clear-results').addEventListener('click', () => {
    if (confirm('Delete all cached analysis results from this browser?')) onClearResults();
  });

  dialog.querySelector('#forget-keys').addEventListener('click', () => {
    const settings = { ...settingsStore.load(), openaiKey: '', githubToken: '' };
    settingsStore.save(settings);
    onSave(settings);
    dialog.close();
  });

  return { open };
}
