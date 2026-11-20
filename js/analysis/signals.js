// Boolean observations the LLM reports for each fork (see prompts/extract.prompt).
// The categoriser turns these into labels. Add a key here AND describe it in the prompt.

export const ENGINEERING_SIGNALS = [
  'adds_functionality',
  'removes_functionality',
  'fixes_bug_explicit',
  'fixes_compilation_bug',
  'targets_new_os_or_arch',
  'has_build_tool',
  'only_ci_changes',
  'has_meaningful_doc_change',
  'uploads_to_package_registry',
  'is_translation',
  'improves_performance',
  'is_zero_semantic_change',
  'changes_only_from_upstream_sync',
];

export const UPSTREAM_SIGNALS = [
  'has_prs_to_upstream',
  'has_direct_upstream_commits',
  'has_commits_outside_prs',
  'used_as_submodule_elsewhere',
  'is_academic_context',
  'is_divergent_project',
  'is_org_with_multiple_users',
  'has_likely_vendor_consumers',
];

export const SIGNAL_KEYS = [...ENGINEERING_SIGNALS, ...UPSTREAM_SIGNALS];

/** Fills missing keys with false so the rules always see every signal. */
export function normaliseSignals(raw) {
  const signals = { ...(raw ?? {}) };
  for (const key of SIGNAL_KEYS) {
    if (!(key in signals)) signals[key] = false;
  }
  return signals;
}
