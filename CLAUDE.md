# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A static GitHub Pages site that finds the forks of a GitHub repo that did real work and
classifies each one. No backend, no framework, no bundler, no runtime dependencies: HTML, CSS
and native ES modules. Users bring their own GitHub token and OpenAI key; everything runs in
the browser and persists in localStorage.

It started as a port of a Python/Flask app (`osa-ai`: `pipeline/github_fetcher.py`,
`llm_extractor.py`, `categoriser.py`). The JS classifier was checked against the Python one on
20k random signal sets with 0 mismatches. The Python app's ground-truth "test runner" was
deliberately left out.

## Commands

```sh
python -m http.server 8000   # serve locally (ES modules don't load from file://)
npm start                     # same, via npx serve
npm test                      # node --test tests/  (Node 20+, no deps)
```

`package.json` exists only for `"type": "module"` (so Node can import the browser modules in
tests) and the two scripts. Don't add dependencies or a build step without the user asking.

## User flow

1. Repo bar (top centre, 70vw on wide screens) → **Fetch forks**: up to `MAX_FORKS` (50)
   forks *ahead of upstream*, most-starred first.
2. Second input: paste a fork URL to add it (must be a fork; deduped case-insensitively).
3. **Analyse**: queues every fork without a cached `complete` result, runs
   `settings.concurrency` (default 4, max 10) at a time. **Stop** aborts the queue; in-flight
   forks finish. Per row: ↻ re-analyse, × remove, click to expand details.
4. **Download CSV**.

## Architecture

```
js/main.js                 app state + all button handlers; the only orchestrator
js/config.js               every tunable constant (limits, model, pricing, SOURCE_URL)
js/queue.js                mapConcurrent(items, limit, worker, {signal}) + sleep
js/store.js                the ONLY module touching localStorage (osa.settings/results/session/theme)
js/csv.js                  forksToCsv, toCsv, downloadCsv
js/dom.js                  el() builder (text nodes only) and $()
js/github/client.js        GitHubClient: rest / restOrNull / graphql, call counter, rate limits, retries
js/github/forks.js         findForksAhead (discovery), lookupFork (manual add); ForkRecord typedef
js/github/forkData.js      fetchForkData: everything sent to the LLM for one fork (8 progress steps)
js/github/queries.js       GraphQL query strings
js/github/repo.js          parseRepoRef, repoKey (lower-cased full name), encodeBranch
js/analysis/analyse.js     analyseFork: fetchForkData → extractSignals → classify; AnalysisResult typedef
js/analysis/llm.js         OpenAI chat completions call, response cleaning/parsing
js/analysis/signals.js     SIGNAL_KEYS (engineering + upstream) and normaliseSignals
js/analysis/categoriser.js rule objects { label, level, score(signals) }, pickLabel, classify
js/ui/forkTable.js         renders the table from state (pure function of state + handlers)
js/ui/settings.js          settings <dialog>
js/ui/theme.js             light/dark toggle
prompts/extract.prompt     LLM prompt, fetched at runtime; editable without touching JS
tests/                     node:test unit tests (categoriser rules, parsing, CSV, queue)
```

### Key behaviours

- **Fork discovery** (`findForksAhead`): pages `/repos/{o}/{r}/forks?sort=stargazers`.
  Forks with `pushed_at <= created_at` were never pushed after forking and are skipped with no
  API call. The rest get one compare request (`per_page=1`) in batches of
  `FORK_CHECK_CONCURRENCY`, stopping as soon as `MAX_FORKS` are found (`MAX_FORKS_SCANNED` caps
  the scan). Order is preserved (most stars first).
- **Labelling**: the LLM only reports boolean signals plus feature list / summary / reasoning;
  it never picks labels. `classify()` does. Among labels with positive scores the highest
  `level` wins, then the higher score, then rule order. `±Infinity` = definitely pick / exclude.
  Fallbacks: `meaningless` and `personal_use_fork`.
- **Caching**: only `status: 'complete'` results are written to localStorage, keyed by
  `repoKey(fullName)`. Errors live only in memory. If a re-analysis fails, the previous good
  result is kept. `resultsStore.set` returns false when storage is full; the UI warns.
- **Session restore**: the repo and fork list are saved in `osa.session`. A `?repo=` URL param
  that differs from the saved repo pre-fills the input instead of restoring the old list.
- **Rendering**: `render()` coalesces updates with a 50 ms `setTimeout`, and boot calls
  `renderNow()` directly. Don't switch to `requestAnimationFrame`: it doesn't fire in
  background tabs or unpainted panes, so the initial render and progress updates stalled.

### Differences from the Python original (intentional)

- PR `merged_at` is read from `pr.pull_request.merged_at` (the Python read a field that search
  results don't have, so merged PRs showed as "rejected").
- The fork's REST response is reused for `is_org` (saves a call).
- The submodule scan stops after `SUBMODULE_SCAN_MAX_REPOS` (1000) repos.
- `response_format: json_object` is sent to OpenAI; the old regex cleanup remains as a fallback.
- GitHub 403/429 rate limits are retried when the wait is ≤65 s. OpenAI 429/5xx are retried
  twice (not `insufficient_quota`).

## Conventions and invariants

- **Never put untrusted text into `innerHTML`.** Repo names and descriptions, commit messages
  and LLM output are all external. Use `el()`, which only makes text nodes. Build link hrefs
  yourself (`https://github.com/${fullName}`), not from API fields.
- `GitHubClient.#get` refuses any URL whose origin isn't `https://api.github.com`, so the
  token can't leak through URLs taken from API responses (e.g. `comments_url`). Keep that check.
- The CSP `<meta>` in `index.html` allows connections only to `self`, `api.github.com` and
  `api.openai.com`, with no inline scripts or styles. Adding a new API host or CDN means
  updating it.
- CSV cells starting with `= + - @` are prefixed with `'` (formula injection).
- Only `store.js` uses localStorage; only `client.js` calls GitHub; only `llm.js` calls OpenAI.
- Colours are CSS custom properties on `:root`, overridden for `[data-theme='dark']` and for
  `prefers-color-scheme: dark` unless `data-theme='light'`. Add new colours to all three blocks.
- **Brand**: the palette comes from the osa mascot drawing: icy screen blue (`--surface`,
  `--accent`), slate-blue eye shading (`--accent-strong`, `--link`), antenna pink (`--pink`,
  upstream pills, the call badge), leg grey and ink outlines (`--ink`). Key controls (search
  bar, primary buttons, badge, mascot card) have 1.5px `--ink` borders to echo the
  hand-drawn lines. Keep new UI pastel and use the ink outline sparingly. The mascot's black
  lines disappear on dark backgrounds, so in dark mode it always sits on a light tile
  (`--logo-bg`, `--mascot-card`).
- **Assets**: `assets/osa-drawing.png` is the original drawing (the source of the others).
  `osa-logo.png` (512², antenna to feet, no signal waves) is the top-bar mark and
  apple-touch icon. `favicon.png` is the same crop at 64². `osa-mascot.png` is the full
  drawing with the "osa!" text, used on the intro card. All have transparent backgrounds,
  made by flood-filling near-white from the image edges so the enclosed white eyes stay
  opaque. Re-crop from `osa-drawing.png` with the same method if the art changes.
- Layout: `.container` and `.topbar-inner` are 70vw; 90vw at ≤1200px; full width with 16px
  gutters at ≤900px. The table scrolls inside `.table-wrap`; the page itself must never scroll
  horizontally.
- Two-space indentation, single quotes, semicolons, JSDoc types (VS Code checks them through
  `jsconfig.json`). Keep comments to the non-obvious "why".

## Common changes

- **Rule tweak / new label**: edit or add a rule object in `categoriser.js`, then add a case to
  `tests/categoriser.test.js`.
- **New signal**: add it to `signals.js`, describe it in `prompts/extract.prompt`, use it in a rule.
- **More fork data**: add a step in `fetchForkData`, bump `FETCH_STEPS`, and mention the new
  field in the prompt.
- **Limits / model / pricing**: `config.js`. `OPENAI_PRICING` is per 1M tokens for
  `OPENAI_MODEL` and is only used for the cost estimate.

## Verifying changes

- Run `npm test`.
- For UI changes, serve the folder and use the browser. Anonymous GitHub REST works for fork
  discovery and manual add on small repos (60 requests/hour), e.g. `payne911/PieMenu`.
- **Don't use the user's real keys.** To exercise Analyse end to end, put fake values in
  `osa.settings` (e.g. `fake-github-test`), reload, then replace `window.fetch` in the page with
  a stub that answers `api.github.com` (repo, GraphQL by query text, compare, commit, search)
  and `api.openai.com` (chat completion JSON with `signals` etc.), with a small delay so the
  progress and concurrency states are visible. Afterwards, remove the `osa.*` keys from
  localStorage.
- Check light and dark mode and a 375px-wide viewport.

## Deploying

GitHub Pages: Settings → Pages → Deploy from a branch → `/ (root)`. `.nojekyll` is present so
files are served as-is. Before deploying from a new repo, update `SOURCE_URL` in `config.js`.
