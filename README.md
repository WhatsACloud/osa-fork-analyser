# OSA Fork Analyser

Find the forks of a GitHub repository that did real work, then classify what each fork
changed and why it exists.

1. Enter a repository (`owner/repo` or its URL) and press **Fetch forks**. You get up to 50
   of its most-starred forks that have commits ahead of upstream. Forks never pushed to after
   being created are skipped.
2. Optionally paste any fork's URL into the second box to add it to the list.
3. Press **Analyse**. Forks are queued and analysed a few at a time (adjustable in Settings).
   For each fork, the app reads its diff, commits, PRs and related repos from GitHub, asks an
   LLM to describe what it sees, and runs fixed rules over that description to pick two labels:
   - **What it changed**: `feature`, `bugfix`, `optimisation`, `system_port`, `build`, `devops`,
     `documentation`, `translation`, `package_registry_upload`, `meaningless`
   - **Why it exists**: `contributing_fork`, `vendor_fork`, `academic_fork`, `personal_use_fork`,
     `divergent_fork`
4. Press **Download CSV** to export the list and results.

It is a static site with no backend. Your GitHub token and OpenAI key are stored in your
browser's localStorage and sent only to `api.github.com` and `api.openai.com`. Results are
cached in localStorage, so re-opening a repository does not pay for the same analysis twice.

## Running locally

ES modules don't load from `file://`, so serve the folder over HTTP. Either:

```sh
python -m http.server 8000
```

or, with Node 20+:

```sh
npm start
```

Then open http://localhost:8000. There is nothing to install and no build step.

You need:

- a **GitHub token**: a classic token with no scopes, or a fine-grained token with read-only
  access to public repositories;
- an **OpenAI API key** (only for Analyse). With the default model (`gpt-4.1`) a fork typically
  costs a few cents, more for forks with very large diffs.

## Tests

```sh
npm test
```

Runs the unit tests in `tests/` with Node's built-in test runner. No dependencies.

## Deploying to GitHub Pages

The site is the folder itself. With this folder as a repository's root: **Settings → Pages →
Build and deployment → Deploy from a branch**, pick the branch and `/ (root)`. The `.nojekyll`
file makes Pages serve the files as-is.

## Project layout

```
index.html                 page markup
css/styles.css             all styles (light + dark tokens at the top)
assets/                    the osa mascot: original drawing, logo, favicon, intro image
prompts/extract.prompt     the LLM prompt: edit this to change what gets observed
js/
  main.js                  app state and the button handlers (fetch, add, analyse, CSV)
  config.js                limits, model and pricing constants
  queue.js                 concurrency helper used everywhere
  store.js                 everything that touches localStorage
  csv.js                   CSV export
  dom.js                   tiny safe element builder
  github/
    client.js              REST + GraphQL wrapper, rate-limit handling
    forks.js               finding forks that are ahead of upstream; looking up one fork
    forkData.js            everything gathered about a fork before analysis
    queries.js             GraphQL queries
    repo.js                parsing "owner/repo" and GitHub URLs
  analysis/
    analyse.js             the per-fork pipeline: GitHub data → LLM → labels
    llm.js                 OpenAI call and response parsing
    signals.js             the list of boolean signals the LLM reports
    categoriser.js         the labelling rules
  ui/
    forkTable.js           the results table
    settings.js            the settings dialog
    theme.js               light/dark toggle
tests/                     node --test unit tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to change the rules, the prompt or the UI.

## License

Apache 2.0, see [LICENSE](LICENSE).
