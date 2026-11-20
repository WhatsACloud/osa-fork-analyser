import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from '../js/analysis/categoriser.js';
import { normaliseSignals } from '../js/analysis/signals.js';

const labels = (signals) => {
  const r = classify(normaliseSignals(signals));
  return [r.engineeringLabel, r.upstreamLabel];
};

test('no signals falls back to meaningless / personal_use_fork', () => {
  assert.deepEqual(labels({}), ['meaningless', 'personal_use_fork']);
});

test('higher level wins: system_port beats feature', () => {
  const [eng] = labels({ targets_new_os_or_arch: true, adds_functionality: true });
  assert.equal(eng, 'system_port');
});

test('optimisation (2.5) beats feature and bugfix (2)', () => {
  const [eng] = labels({ improves_performance: true, adds_functionality: true, fixes_bug_explicit: true });
  assert.equal(eng, 'optimisation');
});

test('compilation fix with a build tool is build, not bugfix', () => {
  const [eng] = labels({ fixes_bug_explicit: true, fixes_compilation_bug: true, has_build_tool: true });
  assert.equal(eng, 'build');
});

test('features that only came from upstream sync are not a feature', () => {
  const [eng] = labels({ adds_functionality: true, changes_only_from_upstream_sync: true });
  assert.equal(eng, 'meaningless');
});

test('zero-semantic doc change is meaningless, not documentation', () => {
  const [eng] = labels({ has_meaningful_doc_change: true, is_zero_semantic_change: true });
  assert.equal(eng, 'meaningless');
});

test('CI-only changes are devops even with a build tool', () => {
  const [eng] = labels({ has_build_tool: true, only_ci_changes: true });
  assert.equal(eng, 'devops');
});

test('PRs upstream with nothing else make a contributing fork', () => {
  const [, up] = labels({ has_prs_to_upstream: true, is_divergent_project: true });
  assert.equal(up, 'contributing_fork');
});

test('commits outside PRs block contributing_fork', () => {
  const [, up] = labels({ has_prs_to_upstream: true, has_commits_outside_prs: true, is_divergent_project: true });
  assert.equal(up, 'divergent_fork');
});

test('translation is definitely a vendor fork', () => {
  assert.deepEqual(labels({ is_translation: true }), ['translation', 'vendor_fork']);
});

test('ties at the same level go to the higher score', () => {
  const [, up] = labels({ has_likely_vendor_consumers: true, used_as_submodule_elsewhere: true, is_academic_context: true });
  assert.equal(up, 'vendor_fork');
});

test('org forks are not personal_use', () => {
  const [, up] = labels({ is_org_with_multiple_users: true });
  assert.equal(up, 'divergent_fork');
});
