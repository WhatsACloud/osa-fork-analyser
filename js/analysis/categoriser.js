/*
 * Rule-based categoriser: turns LLM signals into an engineering label and an
 * upstream-relationship label.
 *
 * Each rule is { label, level, score(signals) }. score() returns:
 *   positive  → favour this label (higher = stronger)
 *   negative  → argue against it
 *   S.DEFINITELY / -S.DEFINITELY → definitely pick / definitely exclude
 *
 * Among positively scored labels the highest `level` wins; ties go to the higher score,
 * then to the rule listed first.
 *
 * To add a rule: append an object to ENG_RULES or UPSTREAM_RULES.
 * To change one: edit its score() or level. Add a test in tests/categoriser.test.js.
 */

export const S = {
  WEAK: 0.3,
  MODERATE: 0.6,
  STRONG: 1.0,
  DEFINITELY: Infinity,
};

/** @typedef {{ label: string, level: number, score: (s: Record<string, boolean>) => number }} Rule */

/** @type {Rule[]} */
export const ENG_RULES = [
  {
    label: 'system_port',
    level: 3,
    score: (s) => (s.targets_new_os_or_arch ? S.STRONG : 0),
  },
  {
    label: 'bugfix',
    level: 2,
    score: (s) => {
      if (!s.fixes_bug_explicit) return 0;
      // Compilation fixes belong under 'build'
      return s.fixes_compilation_bug ? -S.MODERATE : S.STRONG;
    },
  },
  {
    label: 'optimisation',
    level: 2.5,
    score: (s) => (s.improves_performance ? S.STRONG : 0),
  },
  {
    label: 'feature',
    level: 2,
    score: (s) => {
      let score = 0;
      if (s.adds_functionality || s.removes_functionality) score += S.STRONG;
      if (s.changes_only_from_upstream_sync) score -= S.STRONG; // features came from upstream
      return score;
    },
  },
  {
    label: 'build',
    level: 1,
    score: (s) => {
      let score = 0;
      if (s.has_build_tool) score += S.STRONG;
      if (s.targets_new_os_or_arch) score -= S.STRONG; // → system_port
      if (s.only_ci_changes) score -= S.STRONG; // → devops
      return score;
    },
  },
  {
    label: 'devops',
    level: 1,
    score: (s) => (s.only_ci_changes ? S.STRONG : 0),
  },
  {
    label: 'documentation',
    level: 3,
    score: (s) => {
      let score = 0;
      if (s.has_meaningful_doc_change) score += S.STRONG;
      if (s.is_zero_semantic_change) score -= S.STRONG; // → meaningless
      return score;
    },
  },
  {
    label: 'meaningless',
    level: 3,
    score: (s) => (s.is_zero_semantic_change ? S.STRONG : 0),
  },
  {
    label: 'package_registry_upload',
    level: 1,
    score: (s) => (s.uploads_to_package_registry ? S.STRONG : 0),
  },
  {
    label: 'translation',
    level: 3,
    score: (s) => (s.is_translation ? S.STRONG : 0),
  },
];

/** @type {Rule[]} */
export const UPSTREAM_RULES = [
  {
    label: 'contributing_fork',
    level: 1,
    score: (s) => {
      if (!(s.has_prs_to_upstream || s.has_direct_upstream_commits)) return 0;
      // Fork expanded beyond what it sent upstream → not purely contributing
      return s.has_commits_outside_prs ? -S.DEFINITELY : S.DEFINITELY;
    },
  },
  {
    label: 'vendor_fork',
    level: 1,
    score: (s) => {
      if (s.is_translation || s.uploads_to_package_registry) return S.DEFINITELY;
      let score = 0;
      if (s.used_as_submodule_elsewhere) score += S.MODERATE;
      if (s.has_likely_vendor_consumers) score += S.STRONG;
      return score;
    },
  },
  {
    label: 'academic_fork',
    level: 1,
    score: (s) => (s.is_academic_context ? S.STRONG : 0),
  },
  {
    label: 'personal_use_fork',
    level: 1,
    score: (s) => {
      let score = S.WEAK; // fallback when nothing else fires
      if (s.is_org_with_multiple_users) score -= S.STRONG;
      return score;
    },
  },
  {
    label: 'divergent_fork',
    level: 1,
    score: (s) => {
      let score = 0;
      if (s.is_divergent_project) score += S.STRONG;
      if (s.is_org_with_multiple_users) score += S.STRONG;
      return score;
    },
  },
];

export const ENGINEERING_LABELS = ENG_RULES.map((r) => r.label);
export const UPSTREAM_LABELS = UPSTREAM_RULES.map((r) => r.label);

/**
 * @param {Rule[]} rules
 * @param {Record<string, boolean>} signals
 * @param {string} fallback
 */
export function pickLabel(rules, signals, fallback) {
  const scored = rules.map((r) => ({ label: r.label, level: r.level, score: r.score(signals) }));
  const allowed = scored.filter((r) => r.score > -S.DEFINITELY);
  const definite = allowed.filter((r) => r.score >= S.DEFINITELY);
  const pool = definite.length ? definite : allowed.filter((r) => r.score > 0);

  const scores = Object.fromEntries(scored.map(({ label, level, score }) => [label, { level, score }]));
  if (!pool.length) return { label: fallback, scores };

  const best = pool.reduce((a, b) =>
    b.level > a.level || (b.level === a.level && b.score > a.score) ? b : a,
  );
  return { label: best.label, scores };
}

export function classify(signals) {
  const eng = pickLabel(ENG_RULES, signals, 'meaningless');
  const upstream = pickLabel(UPSTREAM_RULES, signals, 'personal_use_fork');
  return {
    engineeringLabel: eng.label,
    upstreamLabel: upstream.label,
    engineeringScores: eng.scores,
    upstreamScores: upstream.scores,
  };
}
