import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanResponse, parseJson } from '../js/analysis/llm.js';
import { forksToCsv, forksToFullCsv, parseForksCsv, toCsv } from '../js/csv.js';
import { getCommitsOutsidePrs } from '../js/github/forkData.js';
import { parseRepoRef } from '../js/github/repo.js';
import { mapConcurrent, sleep } from '../js/queue.js';

test('parseRepoRef accepts the usual ways of writing a repo', () => {
  for (const input of [
    'payne911/PieMenu',
    ' payne911/PieMenu/ ',
    'github.com/payne911/PieMenu',
    'https://github.com/payne911/PieMenu',
    'https://www.github.com/payne911/PieMenu.git',
    'https://github.com/payne911/PieMenu/tree/master/src',
  ]) {
    assert.deepEqual(parseRepoRef(input), { owner: 'payne911', repo: 'PieMenu', fullName: 'payne911/PieMenu' }, input);
  }
});

test('parseRepoRef rejects non-GitHub or malformed input', () => {
  for (const input of ['', 'justaname', 'https://gitlab.com/a/b', 'a/..', 'a b/c']) {
    assert.throws(() => parseRepoRef(input), /Not a GitHub repository/, input);
  }
});

test('toCsv quotes and neutralises formula-like text', () => {
  const csv = toCsv([
    ['a', 'has,comma', 'has "quote"', null, 3],
    ['=HYPERLINK("x")', '-cmd', 'line\nbreak', undefined, 0],
  ]);
  assert.equal(
    csv,
    'a,"has,comma","has ""quote""",,3\r\n' + `"'=HYPERLINK(""x"")",'-cmd,"line\nbreak",,0`,
  );
});

const FORK = {
  fullName: 'alice/repo',
  url: 'https://github.com/alice/repo',
  parent: 'upstream/repo',
  stars: 12,
  aheadBy: 3,
  behindBy: 1,
  defaultBranch: 'main',
  pushedAt: '2026-01-01T00:00:00Z',
  description: 'a fork',
  source: 'fetched',
};

const RESULT = {
  status: 'complete',
  engineeringLabel: 'feature',
  upstreamLabel: 'divergent',
  purposeSummary: 'adds a "cool" thing, with commas',
  featureList: [
    { name: 'thing one', description: 'does stuff\nacross lines', comes_from_upstream: false, filepaths_modified: ['a.js', 'b.js'] },
    { name: 'thing two', description: '', comes_from_upstream: true, filepaths_modified: [] },
  ],
  signals: { adds_functionality: true, is_bugfix: false },
  thoughtProcess: { evidence: ['saw a diff'], inference: ['probably a feature'] },
  forkCreator: { username: 'alice', profile_summary: 'an active contributor' },
  toolsUsed: [{ name: 'eslint', description: 'lints code', label: 'build' }],
  usage: { inputTokens: 1000, outputTokens: 200, costUsd: 0.0123 },
  durationMs: 4567,
  analysedAt: '2026-01-02T00:00:00Z',
};

test('forksToCsv / parseForksCsv round-trip the minified columns', () => {
  const csv = forksToCsv([FORK], { 'alice/repo': RESULT });
  const { forks, results } = parseForksCsv(csv);
  assert.equal(forks.length, 1);
  assert.equal(forks[0].fullName, 'alice/repo');
  assert.equal(forks[0].parent, 'upstream/repo');
  assert.equal(forks[0].stars, 12);
  assert.equal(forks[0].aheadBy, 3);

  const r = results['alice/repo'];
  assert.equal(r.status, 'complete');
  assert.equal(r.engineeringLabel, 'feature');
  assert.equal(r.purposeSummary, RESULT.purposeSummary);
  assert.deepEqual(r.featureList.map((f) => f.name), ['thing one', 'thing two']);
  // The minified format drops signals/reasoning/creator/tools — only names survive.
  assert.deepEqual(r.signals, {});
  assert.equal(r.usage.inputTokens, 1000);
  assert.equal(r.usage.costUsd, 0.0123);
});

test('forksToFullCsv / parseForksCsv round-trip every detail field', () => {
  const csv = forksToFullCsv([FORK], { 'alice/repo': RESULT });
  const { results } = parseForksCsv(csv);
  const r = results['alice/repo'];
  assert.deepEqual(r.featureList, RESULT.featureList);
  assert.deepEqual(r.signals, RESULT.signals);
  assert.deepEqual(r.thoughtProcess, RESULT.thoughtProcess);
  assert.deepEqual(r.forkCreator, RESULT.forkCreator);
  assert.deepEqual(r.toolsUsed, RESULT.toolsUsed);
  assert.equal(r.durationMs, 4567);
  assert.equal(r.analysedAt, RESULT.analysedAt);
});

test('parseForksCsv skips unrecognisable rows and reports errors in memory only', () => {
  const csv = forksToCsv(
    [FORK, { ...FORK, fullName: 'bob/broken', url: 'not-a-url', parent: 'upstream/repo' }],
    { 'alice/repo': { status: 'error', error: 'boom' } },
  );
  const { forks, results } = parseForksCsv(csv);
  assert.equal(forks.length, 1); // the row with an unparsable fork_url is skipped
  assert.deepEqual(results['alice/repo'], { status: 'error', error: 'boom' });
});

test('mapConcurrent keeps order and never exceeds the limit', async () => {
  let active = 0;
  let peak = 0;
  const out = await mapConcurrent([5, 1, 4, 2, 3], 2, async (n) => {
    peak = Math.max(peak, ++active);
    await sleep(n * 3);
    active--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30]);
  assert.equal(peak, 2);
});

test('mapConcurrent stops starting new work once aborted', async () => {
  const controller = new AbortController();
  const started = [];
  await mapConcurrent(
    [1, 2, 3, 4, 5],
    1,
    async (n) => {
      started.push(n);
      if (n === 2) controller.abort();
    },
    { signal: controller.signal },
  );
  assert.deepEqual(started, [1, 2]);
});

test('LLM JSON is recovered from fenced or chatty responses', () => {
  assert.deepEqual(parseJson(cleanResponse('```json\n{"a": 1}\n```')), { a: 1 });
  assert.deepEqual(parseJson('Sure! {"a": {"b": 2}} hope that helps'), { a: { b: 2 } });
  assert.throws(() => parseJson('no json here'), /not valid JSON/);
});

test('commits outside PRs are only reported when there are PRs', () => {
  const commits = [{ message: 'a' }, { message: 'b' }];
  assert.deepEqual(getCommitsOutsidePrs([], commits), []);
  assert.deepEqual(getCommitsOutsidePrs([{ commits: [{ message: 'a' }] }], commits), ['b']);
});
