# Contributing

Thanks for helping. The project is deliberately plain: HTML, CSS and native ES modules, no
framework, no bundler, no runtime dependencies. If you can open a browser and run
`python -m http.server`, you can work on it.

## Getting set up

```sh
git clone <this repo>
cd <this repo>
python -m http.server 8000   # or: npm start
```

Open http://localhost:8000 and add a GitHub token (and an OpenAI key if you want to run
analyses) under ⚙ Settings. Run `npm test` before opening a pull request.

## How a fork gets analysed

```
fetchForkData()  (js/github/forkData.js)    GitHub REST + GraphQL → one JSON blob per fork
      ↓
extractSignals() (js/analysis/llm.js)       blob + prompts/extract.prompt → OpenAI → booleans,
      ↓                                     feature list, summary, reasoning
classify()       (js/analysis/categoriser.js) fixed rules over the booleans → two labels
```

The LLM only observes; it never picks a label. Labels come from the rules, so they are
predictable and testable.

## Common changes

### Change a labelling rule

Edit the rule's `score()` or `level` in `js/analysis/categoriser.js`. The comment at the top of
that file explains how scores and levels combine. Add or update a case in
`tests/categoriser.test.js` that shows the behaviour you want.

### Add a new signal

1. Add the key to `ENGINEERING_SIGNALS` or `UPSTREAM_SIGNALS` in `js/analysis/signals.js`.
2. Describe it in the `signals` object in `prompts/extract.prompt`, in the same style as the others.
3. Use it in a rule in `categoriser.js`, and test that rule.

### Add a new label

Add a rule object to `ENG_RULES` or `UPSTREAM_RULES` in `categoriser.js`. The UI and CSV pick
it up automatically.

### Gather more data about a fork

Add a step to `fetchForkData()` in `js/github/forkData.js` and put the result in the returned
object. Bump `FETCH_STEPS` if you add a progress step. Mention the new field in the prompt so
the LLM knows what it is.

### Change limits, the model or pricing

All in `js/config.js`.

## Conventions

- **Never put untrusted text into `innerHTML`.** Repo descriptions, commit messages and LLM
  output all come from outside. Build elements with `el()` from `js/dom.js`, which only ever
  creates text nodes.
- Only `js/store.js` reads or writes localStorage.
- Only `js/github/client.js` calls the GitHub API, and only `js/analysis/llm.js` calls OpenAI.
- Keep modules small and focused; JSDoc types are welcome (VS Code type-checks them via
  `jsconfig.json`).
- Two-space indentation, single quotes, semicolons (see `.editorconfig`).

## Pull requests

- One change per PR, with a short description of what and why.
- Include a test for logic changes (rules, parsing, CSV, queueing).
- For UI changes, add a screenshot in light and dark mode.
