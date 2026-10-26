/**
 * Explore / Trace / Impact view models, derived only from server payloads.
 *
 * Each mode answers a different question over the SAME query answers, so the
 * three views can never disagree about what the index holds:
 *
 * - Explore groups indexed files into path buckets the server reported.
 * - Trace reads one hop of static calls out of `context` plus the test links.
 * - Impact splits reverse reachability into what the graph confirms and what
 *   an unresolved edge only suggests.
 *
 * Nothing here invents a node, an edge, or a count: a mode with no rows says
 * so through `notes`, and a payload the server could not answer keeps its
 * `coverage` so the caller states the absence instead of drawing an empty
 * success.
 */

import type {
  CodeGraphCoverage,
  CodeGraphItem,
  CodeGraphModule,
  CodeGraphQueryResult,
  CodeGraphTrailStep,
} from '@/lib/codeGraphApi';

export type CodeGraphMode = 'explore' | 'trace' | 'impact';

/** Edge kinds whose presence in evidence makes a row a graph-confirmed fact. */
const CONFIRMED_EDGES = new Set(['CALLS_STATIC', 'IMPORTS', 'TESTS', 'DEFINES', 'EXPORTS']);

export interface CodeGraphModeInput {
  detail: CodeGraphQueryResult | null;
  impact: CodeGraphQueryResult | null;
  tests: CodeGraphQueryResult | null;
  explore: CodeGraphQueryResult | null;
}

export interface CodeGraphModuleView {
  modules: CodeGraphModule[];
  truncated: boolean;
  coverage: CodeGraphCoverage | null;
  notes: string[];
}

export interface CodeGraphTraceView {
  subjectId: string | null;
  incoming: CodeGraphItem[];
  outgoing: CodeGraphItem[];
  tests: CodeGraphItem[];
  coverage: CodeGraphCoverage | null;
  notes: string[];
}

export interface CodeGraphImpactView {
  subjectId: string | null;
  confirmed: CodeGraphItem[];
  inferred: CodeGraphItem[];
  tests: CodeGraphItem[];
  coverage: CodeGraphCoverage | null;
  notes: string[];
}

export interface CodeGraphTrailView {
  steps: CodeGraphTrailStep[];
  coverage: CodeGraphCoverage | null;
  notes: string[];
}

/**
 * A row is graph-confirmed when an edge kind the index resolves supports it
 * and no uncertainty is recorded; anything else is an inference the UI must
 * label as such rather than present as a dependency.
 */
export const isConfirmedRow = (item: CodeGraphItem): boolean => (
  item.confidence >= 1
  && item.evidence.some((entry) => CONFIRMED_EDGES.has(entry.edge) && entry.confidence >= 1)
);

const uniqueById = (items: readonly CodeGraphItem[]): CodeGraphItem[] => {
  const seen = new Set<string>();
  const out: CodeGraphItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
};

const envelopeNotes = (result: CodeGraphQueryResult | null): string[] => {
  if (!result) return [];
  return [...result.unsupported, ...result.unresolved];
};

export const deriveExploreView = (result: CodeGraphQueryResult | null): CodeGraphModuleView => {
  const modules = result?.modules ?? [];
  return {
    modules,
    truncated: result?.truncated === true,
    coverage: result?.coverage ?? null,
    notes: envelopeNotes(result),
  };
};

export const deriveTraceView = (input: Pick<CodeGraphModeInput, 'detail' | 'tests'>): CodeGraphTraceView => {
  const detail = input.detail;
  const incoming = uniqueById(detail?.callers ?? []);
  const outgoing = uniqueById(detail?.callees ?? []);
  const tests = uniqueById(input.tests?.items ?? []);
  const notes = [
    ...envelopeNotes(detail),
    ...envelopeNotes(input.tests),
  ];
  if (detail?.truncated === true && (incoming.length > 0 || outgoing.length > 0)) {
    notes.push('callers or callees were cut at the result limit');
  }
  return {
    subjectId: detail?.definition?.id ?? null,
    incoming,
    outgoing,
    tests,
    coverage: detail?.coverage ?? null,
    notes,
  };
};

export const deriveImpactView = (input: Pick<CodeGraphModeInput, 'impact' | 'tests'>): CodeGraphImpactView => {
  const impacted = uniqueById(input.impact?.impacted ?? []);
  const confirmed: CodeGraphItem[] = [];
  const inferred: CodeGraphItem[] = [];
  for (const item of impacted) {
    (isConfirmedRow(item) ? confirmed : inferred).push(item);
  }
  return {
    subjectId: input.impact?.subject?.id ?? null,
    confirmed,
    inferred,
    tests: uniqueById(input.tests?.items ?? []),
    coverage: input.impact?.coverage ?? null,
    notes: [
      ...envelopeNotes(input.impact),
      ...envelopeNotes(input.tests),
      ...(input.impact?.truncated === true && impacted.length > 0
        ? ['impact rows were cut at the result limit']
        : []),
    ],
  };
};

export const deriveTrailView = (result: CodeGraphQueryResult | null): CodeGraphTrailView => ({
  steps: result?.path ?? [],
  coverage: result?.coverage ?? null,
  notes: envelopeNotes(result),
});

export const modeForPickedId = (id: string | null | undefined): CodeGraphMode => (
  typeof id === 'string' && id.startsWith('file:') ? 'explore' : 'trace'
);

export const resultsMatchQuery = (committed: string | null | undefined, current: string): boolean => (
  (committed ?? '').trim() === current.trim()
);

/**
 * True when two distinct ids answer to the same display name, which is when a
 * bare label stops identifying a row and the caller must say so.
 */
export const hasAmbiguousNames = (items: readonly CodeGraphItem[]): boolean => {
  const byName = new Map<string, string>();
  for (const item of items) {
    const label = item.name ?? item.id;
    const seen = byName.get(label);
    if (seen !== undefined && seen !== item.id) return true;
    byName.set(label, item.id);
  }
  return false;
};
