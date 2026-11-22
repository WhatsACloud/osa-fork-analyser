export const SOURCE_URL = 'https://github.com/WhatsACloud/osa-fork-analyser';

// Fork discovery
export const MAX_FORKS = 50;
export const MAX_FORKS_SCANNED = 1000;
// Parallel "is this fork ahead of upstream?" checks while fetching forks
export const FORK_CHECK_CONCURRENCY = 8;

// Analysis concurrency (forks analysed at once); user-adjustable in settings
export const DEFAULT_CONCURRENCY = 4;
export const MAX_CONCURRENCY = 10;

// Parallel GitHub requests made while analysing a single fork
export const GITHUB_INNER_CONCURRENCY = 4;

export const SUBMODULE_SCAN_MAX_REPOS = 1000;
export const OTHER_REPOS_LIMIT = 5;

export const OPENAI_MODEL = 'gpt-4.1';
// USD per 1M tokens for OPENAI_MODEL; used for the cost estimate only
export const OPENAI_PRICING = { input: 2.0, output: 8.0 };
