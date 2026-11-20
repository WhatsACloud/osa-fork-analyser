// Everything persisted lives in this browser's localStorage, under these keys.
import { DEFAULT_CONCURRENCY } from './config.js';
import { repoKey } from './github/repo.js';

const KEYS = {
  settings: 'osa.settings',
  results: 'osa.results',
  session: 'osa.session',
  theme: 'osa.theme',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`Could not save ${key} to localStorage`, err);
    return false;
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable: nothing to remove */
  }
}

/** @typedef {{ openaiKey: string, githubToken: string, concurrency: number }} Settings */

export const settingsStore = {
  /** @returns {Settings} */
  load() {
    return { openaiKey: '', githubToken: '', concurrency: DEFAULT_CONCURRENCY, ...read(KEYS.settings, {}) };
  },
  /** @param {Settings} settings */
  save(settings) {
    return write(KEYS.settings, settings);
  },
};

/** Completed analyses, keyed by lower-cased fork full name. */
export const resultsStore = {
  /** @returns {Record<string, import('./analysis/analyse.js').AnalysisResult>} */
  all() {
    return read(KEYS.results, {});
  },
  set(fullName, result) {
    const all = this.all();
    all[repoKey(fullName)] = result;
    return write(KEYS.results, all);
  },
  delete(fullName) {
    const all = this.all();
    delete all[repoKey(fullName)];
    write(KEYS.results, all);
  },
  clear() {
    remove(KEYS.results);
  },
};

/** The repo and fork list on screen, restored on reload. */
export const sessionStore = {
  /** @returns {{ repo: string, forks: import('./github/forks.js').ForkRecord[] }} */
  load() {
    return read(KEYS.session, { repo: '', forks: [] });
  },
  save(session) {
    write(KEYS.session, session);
  },
};

export const themeStore = {
  /** @returns {'light' | 'dark' | null} */
  load() {
    return read(KEYS.theme, null);
  },
  save(theme) {
    write(KEYS.theme, theme);
  },
};
