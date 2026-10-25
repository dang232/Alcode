// Pure rationale helpers for the dag-pane panel (ulw-slice72-c, no DOM).
//
// The rationale section reads the proven service routes from slice72-b:
// `GET /rationale/projects` (which projectIds exist in the HEAD tree) then
// one `GET /rationale?projectId=…&q=<task label>` per project. Everything
// here is pure so it stays unit-testable in bun:test without a browser;
// `panel/main.ts` owns fetching and painting, these helpers own shaping,
// badges, and the render-nothing-when-empty rule.

export type RationaleBadge = 'SUPERSEDED' | 'UNVERIFIED' | 'STALE-EVIDENCE' | 'ENV-SPECIFIC';

export type RationaleRecordView = {
  id?: unknown;
  claim?: unknown;
  kind?: unknown;
  standing?: unknown;
  confidence?: unknown;
  sourceFile?: unknown;
  sourceSymbol?: unknown;
  observedAt?: unknown;
  validationMethod?: unknown;
  invalidationConditions?: unknown;
  notes?: unknown;
  freshness?: unknown;
};

export type RationaleStatus = 'disconnected' | 'loading' | 'error' | 'empty' | 'ready';

/** Build the discovery query: `GET /rationale/projects?directory=…`. */
export const buildRationaleProjectsQuery = (
  directory: string,
): { path: string; query: Record<string, string> } => (
  { path: '/rationale/projects', query: { directory } }
);

/** Build one rank query per project: the task label travels as `q`. */
export const buildRationaleQuery = (
  directory: string,
  projectId: string,
  taskLabel: string,
): { path: string; query: Record<string, string> } => (
  { path: '/rationale', query: { directory, projectId, q: taskLabel } }
);

/**
 * The render gate: the section renders NOTHING when `ranked` is empty —
 * no header, no container, no generated fallback text. Persisted records
 * stay in their bordered recorded container, separate from any generated
 * text, and an empty rank simply leaves no container behind.
 */
export const shouldRenderRationale = (ranked: readonly unknown[] | null | undefined): boolean => (
  Array.isArray(ranked) && ranked.length > 0
);

/**
 * Kind/standing badges for one ranked record. The badge ids are engine
 * case language (kept literal, never localized):
 * - SUPERSEDED when the stored kind or the effective standing is superseded
 * - UNVERIFIED when the effective standing is unverified-hypothesis
 * - STALE-EVIDENCE when the standing demoted to previously-verified or the
 *   freshness evaluation applied EVID-STALE (or any demotion)
 * - ENV-SPECIFIC when the kind or standing is environment-specific
 * Order is fixed (as listed) so badge rows read identically in every locale.
 */
export const rationaleBadgesFor = (record: RationaleRecordView): RationaleBadge[] => {
  const badges: RationaleBadge[] = [];
  if (record.kind === 'superseded' || record.standing === 'superseded') {
    badges.push('SUPERSEDED');
  }
  if (record.standing === 'unverified-hypothesis') {
    badges.push('UNVERIFIED');
  }
  const freshness = record.freshness !== null && typeof record.freshness === 'object' && !Array.isArray(record.freshness)
    ? record.freshness as { demoted?: unknown; appliedCase?: unknown }
    : null;
  if (
    record.standing === 'previously-verified'
    || freshness?.appliedCase === 'EVID-STALE'
    || freshness?.demoted === true
  ) {
    badges.push('STALE-EVIDENCE');
  }
  if (record.kind === 'environment-specific' || record.standing === 'environment-specific') {
    badges.push('ENV-SPECIFIC');
  }
  return badges;
};

const textOf = (value: unknown): string | null => (
  typeof value === 'string' && value.length > 0 ? value : null
);

/**
 * Provenance rows for one record: record id, source file/symbol,
 * observedAt, validationMethod, confidence, invalidation conditions, and
 * freshness. Missing fields read as `—`; confidence renders with at most
 * two decimals; nothing is invented when the record omits a field.
 */
export const formatRationaleProvenance = (
  record: RationaleRecordView,
): [string, string][] => {
  const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
    ? String(Math.round(record.confidence * 100) / 100)
    : '—';
  const conditions = Array.isArray(record.invalidationConditions)
    ? record.invalidationConditions.filter((entry): entry is string => typeof entry === 'string').join(', ')
    : '';
  const freshness = record.freshness !== null && typeof record.freshness === 'object' && !Array.isArray(record.freshness)
    ? record.freshness as { demoted?: unknown; appliedCase?: unknown }
    : null;
  const freshnessText = freshness === null
    ? '—'
    : freshness.demoted === true
      ? `demoted${typeof freshness.appliedCase === 'string' && freshness.appliedCase.length > 0 ? ` ${freshness.appliedCase}` : ''}`
      : typeof freshness.appliedCase === 'string' && freshness.appliedCase.length > 0
        ? freshness.appliedCase
        : 'current';
  return [
    ['record', textOf(record.id) ?? '—'],
    ['source', `${textOf(record.sourceFile) ?? '—'} · ${textOf(record.sourceSymbol) ?? '—'}`],
    ['observedAt', textOf(record.observedAt) ?? '—'],
    ['validationMethod', textOf(record.validationMethod) ?? '—'],
    ['confidence', confidence],
    ['invalidation', conditions.length > 0 ? conditions : '—'],
    ['freshness', freshnessText],
  ];
};

/**
 * The rationale section state. Empty means the caller renders nothing at
 * all (see `shouldRenderRationale`); every other state owns its honest
 * loading / disconnected / error rendering and never fabricates records.
 */
export const resolveRationaleStatus = (input: {
  connected: boolean;
  error: string | null;
  loaded: boolean;
  ranked: readonly unknown[] | null;
}): RationaleStatus => {
  if (!input.connected) {
    return 'disconnected';
  }
  if (input.error !== null) {
    return 'error';
  }
  if (!input.loaded || input.ranked === null) {
    return 'loading';
  }
  return shouldRenderRationale(input.ranked) ? 'ready' : 'empty';
};
