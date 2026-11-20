import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanResponse, parseJson } from '../js/analysis/llm.js';
import { toCsv } from '../js/csv.js';
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
