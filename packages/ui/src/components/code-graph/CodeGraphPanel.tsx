import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { CodeGraphCanvas } from './CodeGraphCanvas';
import { CodeGraphInspector, type CodeGraphInspectorEdge, type CodeGraphInspectorNode, type CodeGraphInspectorTest } from './CodeGraphInspector';
import { CodeGraphLegend } from './CodeGraphLegend';
import { CodeGraphModuleMap } from './CodeGraphModuleMap';
import {
  CodeGraphToolbar,
  type CodeGraphToolbarCompleteness,
  type CodeGraphToolbarFilters,
  type CodeGraphToolbarSubject,
  type CodeGraphToolbarTotals,
} from './CodeGraphToolbar';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/lib/i18n';
import { useUIStore } from '@/stores/useUIStore';
import { graphFilePathForDisplay, resolveGraphFile } from '@/lib/graphFilePath';
import { cn } from '@/lib/utils';
import {
  asStringArray,
  asText,
  fetchCodeGraphIndex,
  cancelCodeGraphIndex,
  isFiniteJsonNumber,
  isJsonArray,
  isJsonRecord,
  isJsonText,
  queryCodeGraph,
  resolveCodeGraphFile,
  type CodeGraphCompleteness,
  type CodeGraphCoverage,
  type CodeGraphEvidence,
  type CodeGraphIndexSummary,
  type CodeGraphItem,
  type CodeGraphJsonField,
  type CodeGraphJsonRecord,
  type CodeGraphJsonValue,
  type CodeGraphQueryResult,
  type CodeGraphSelectedEdge,
  type CodeGraphTotals,
  type CodeGraphTopology,
  type CodeGraphTrailStep,
} from '@/lib/codeGraphApi';
import {
  resolveCodeGraphSubject,
  useCodeGraphDefaultSubject,
  type CodeGraphSubject,
} from '@/lib/codeGraphSubject';
import {
  hasAmbiguousNames,
  modeForPickedId,
  type CodeGraphMode,
} from './codeGraphModes';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';

const WIDE_WORKSPACE_PX = 720;

/** The engine answers at most this many matches, so one request knows the real set. */
const SEARCH_FETCH_LIMIT = 50;
const SEARCH_PAGE_SIZE = 20;

/** Engine `completenessReason` enum -> the i18n key that explains it in the user's language.
 *  The wire value is kebab-case while the catalogues are camelCase. An unknown value falls back to
 *  the generic line, so a protocol string never reaches a reader's screen. */
const completenessReasonKey = (reason: string) => {
  switch (reason) {
    case 'index-truncated': return 'codeGraph.completeness.reason.indexTruncated' as const;
    case 'index-excluded': return 'codeGraph.completeness.reason.indexExcluded' as const;
    case 'depth-budget': return 'codeGraph.completeness.reason.depthBudget' as const;
    case 'edge-budget': return 'codeGraph.completeness.reason.edgeBudget' as const;
    case 'time-budget': return 'codeGraph.completeness.reason.timeBudget' as const;
    case 'result-limit': return 'codeGraph.completeness.reason.resultLimit' as const;
    case 'unresolved-edges': return 'codeGraph.completeness.reason.unresolvedEdges' as const;
    case 'unsupported-files': return 'codeGraph.completeness.reason.unsupportedFiles' as const;
    default: return 'codeGraph.toolbar.completenessPartial' as const;
  }
};

/**
 * Subject queries still page at the old default row count. The retired 20/40
 * row-cap select is gone; traversal breadth is now the `depth` control, and
 * this constant is only the engine's answer cap, never a UI control.
 */
const SUBJECT_FETCH_LIMIT = 20;

const DEFAULT_GRAPH_FILTERS: CodeGraphToolbarFilters = {
  kinds: ['function', 'class', 'interface', 'file'],
  edgeKinds: ['calls', 'defines', 'imports', 'tests'],
  minConfidence: 0,
};

/**
 * Toolbar filter tokens are lowercase groups; engine edge kinds are specific
 * (`CALLS_STATIC`, `CALLS_UNRESOLVED`, `DEFINES`, ...). An unclassified kind
 * maps to null and always stays visible rather than vanishing silently.
 */
const edgeGroupOfKind = (kind: string): string | null => {
  const upper = kind.toUpperCase();
  if (upper.startsWith('CALLS')) return 'calls';
  if (upper === 'DEFINES' || upper === 'EXPORTS') return 'defines';
  if (upper === 'IMPORTS') return 'imports';
  if (upper === 'TESTS') return 'tests';
  return null;
};

/** Test files answer "where is it used" poorly: rank them behind real definitions. */
const isTestPath = (file: string): boolean => (
  /(^|\/)(__tests__|tests?)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
);

/**
 * Server-computed trace/impact answers, read verbatim.
 *
 * The typed query client drops the per-kind `summary` envelope (and the
 * engine's displayed/known/hidden totals) because older payloads omit them.
 * The trace and impact views below need those exact server fields — the
 * ordered `path`, the trace verdict (`found`/`hops`/`alternativePaths`/
 * `reason`), and the impact roll-up (`dependentFiles`, `modules`,
 * `testsFound`, `callersWithoutTestPath`, `unresolvedEdges`,
 * `completeness`) — so they fetch the same route raw and validate only
 * what they render. Nothing here is derived: a field the server did not
 * send stays null and the view states its absence.
 */
interface CodeGraphTraceSummary {
  found: boolean;
  hops: number | null;
  alternativePaths: number | null;
  reason: string | null;
}

interface CodeGraphImpactSummary {
  dependentFiles: number | null;
  dependentSymbols: number | null;
  modules: Array<{ module: string; count: number }>;
  testsFound: number | null;
  callersWithoutTestPath: number | null;
  unresolvedEdges: number | null;
  completeness: string | null;
}

interface CodeGraphTraceAnswer {
  revision: string | null;
  coverage: CodeGraphCoverage | null;
  unresolved: string[];
  unsupported: string[];
  completeness: CodeGraphCompleteness | null;
  completenessReason: string | null;
  truncated: boolean;
  path: CodeGraphTrailStep[];
  summary: CodeGraphTraceSummary | null;
  totals: CodeGraphTotals | null;
}

/** Raw trace/impact query string; only the fields the caller sets travel. */
interface CodeGraphRawQueryParams extends Record<string, string | undefined> {
  directory: string;
  kind: 'trace' | 'impact';
  symbol?: string;
  file?: string;
  from?: string;
  to?: string;
  limit: string;
  depth: string;
}

interface CodeGraphImpactAnswer {
  revision: string | null;
  coverage: CodeGraphCoverage | null;
  unresolved: string[];
  unsupported: string[];
  completeness: CodeGraphCompleteness | null;
  completenessReason: string | null;
  truncated: boolean;
  impacted: CodeGraphItem[];
  shownOf: { impacted: { shown: number; total: number } } | null;
  summary: CodeGraphImpactSummary | null;
  totals: CodeGraphTotals | null;
}

const rawFinite = (value: CodeGraphJsonField): number | null =>
  (isFiniteJsonNumber(value) ? value : null);

const rawEvidence = (value: CodeGraphJsonField): CodeGraphEvidence[] => {
  if (!isJsonArray(value)) return [];
  const out: CodeGraphEvidence[] = [];
  for (const entry of value) {
    if (!isJsonRecord(entry)) continue;
    if (!isJsonText(entry.edge) || !isJsonText(entry.ref)) continue;
    const confidence = rawFinite(entry.confidence);
    if (confidence === null) continue;
    out.push({ edge: entry.edge, ref: entry.ref, confidence });
  }
  return out;
};

const rawItem = (value: CodeGraphJsonField): CodeGraphItem | null => {
  if (!isJsonRecord(value)) return null;
  if (!isJsonText(value.id) || !isJsonText(value.file)) return null;
  const line = rawFinite(value.line);
  const confidence = rawFinite(value.confidence);
  if (line === null || confidence === null) return null;
  const item: CodeGraphItem = {
    id: value.id,
    file: value.file,
    line,
    evidence: rawEvidence(value.evidence),
    confidence,
    knowledgeIds: asStringArray(value.knowledgeIds),
  };
  const name = asText(value.name);
  if (name !== undefined) item.name = name;
  return item;
};

const rawItems = (value: CodeGraphJsonField): CodeGraphItem[] => {
  if (!isJsonArray(value)) return [];
  const out: CodeGraphItem[] = [];
  for (const entry of value) {
    const item = rawItem(entry);
    if (item !== null) out.push(item);
  }
  return out;
};

const rawCoverage = (value: CodeGraphJsonField): CodeGraphCoverage | null => (
  value === 'indexed' || value === 'partial' || value === 'unindexed' ? value : null
);

const rawCompleteness = (value: CodeGraphJsonField): CodeGraphCompleteness | null => (
  value === 'complete' || value === 'partial' || value === 'truncated' || value === 'unindexed' ? value : null
);

const rawTotals = (value: CodeGraphJsonField): CodeGraphTotals | null => {
  if (!isJsonRecord(value)) return null;
  const displayed = rawFinite(value.displayed);
  if (displayed === null) return null;
  const known = value.known === null ? null : rawFinite(value.known);
  const hidden = value.hidden === null ? null : rawFinite(value.hidden);
  if (value.known !== null && known === null) return null;
  if (value.hidden !== null && hidden === null) return null;
  return { displayed, known, hidden };
};

const rawShownOf = (value: CodeGraphJsonField): { impacted: { shown: number; total: number } } | null => {
  if (!isJsonRecord(value)) return null;
  const impacted = isJsonRecord(value.impacted) ? value.impacted : null;
  const shown = impacted ? rawFinite(impacted.shown) : null;
  const total = impacted ? rawFinite(impacted.total) : null;
  if (shown === null || total === null) return null;
  return { impacted: { shown, total } };
};

const parseTraceAnswer = (payload: CodeGraphJsonField): CodeGraphTraceAnswer => {
  const record: CodeGraphJsonRecord = isJsonRecord(payload) ? payload : {};
  const path: CodeGraphTrailStep[] = [];
  if (isJsonArray(record.path)) {
    for (const entry of record.path) {
      if (!isJsonRecord(entry)) continue;
      if (!isJsonText(entry.from) || !isJsonText(entry.to) || !isJsonText(entry.ref)) continue;
      const confidence = rawFinite(entry.confidence);
      path.push({ from: entry.from, to: entry.to, ref: entry.ref, confidence: confidence ?? 1 });
    }
  }
  const summaryRecord = isJsonRecord(record.summary) ? record.summary : null;
  return {
    revision: asText(record.revision) ?? null,
    coverage: rawCoverage(record.coverage),
    unresolved: asStringArray(record.unresolved),
    unsupported: asStringArray(record.unsupported),
    completeness: rawCompleteness(record.completeness),
    completenessReason: asText(record.completenessReason) ?? null,
    truncated: record.truncated === true,
    path,
    summary: summaryRecord && (summaryRecord.found === true || summaryRecord.found === false)
      ? {
        found: summaryRecord.found,
        hops: summaryRecord.hops === null ? null : rawFinite(summaryRecord.hops),
        alternativePaths: summaryRecord.alternativePaths === null ? null : rawFinite(summaryRecord.alternativePaths),
        reason: asText(summaryRecord.reason) ?? null,
      }
      : null,
    totals: rawTotals(record.totals),
  };
};

const parseImpactAnswer = (payload: CodeGraphJsonField): CodeGraphImpactAnswer => {
  const record: CodeGraphJsonRecord = isJsonRecord(payload) ? payload : {};
  const summaryRecord = isJsonRecord(record.summary) ? record.summary : null;
  const modules: Array<{ module: string; count: number }> = [];
  const rawModules = summaryRecord?.modules;
  if (isJsonArray(rawModules)) {
    for (const entry of rawModules) {
      if (!isJsonRecord(entry)) continue;
      if (!isJsonText(entry.module) || !entry.module) continue;
      const count = rawFinite(entry.count);
      if (count === null) continue;
      modules.push({ module: entry.module, count });
    }
  }
  const numeric = (key: string): number | null => {
    if (!summaryRecord) return null;
    return rawFinite(summaryRecord[key]);
  };
  return {
    revision: asText(record.revision) ?? null,
    coverage: rawCoverage(record.coverage),
    unresolved: asStringArray(record.unresolved),
    unsupported: asStringArray(record.unsupported),
    completeness: rawCompleteness(record.completeness),
    completenessReason: asText(record.completenessReason) ?? null,
    truncated: record.truncated === true,
    impacted: rawItems(record.impacted),
    shownOf: rawShownOf(record.shownOf),
    summary: summaryRecord
      ? {
        dependentFiles: numeric('dependentFiles'),
        dependentSymbols: numeric('dependentSymbols'),
        modules,
        testsFound: numeric('testsFound'),
        callersWithoutTestPath: numeric('callersWithoutTestPath'),
        unresolvedEdges: numeric('unresolvedEdges'),
        completeness: asText(summaryRecord.completeness) ?? null,
      }
      : null,
    totals: rawTotals(record.totals),
  };
};

/**
 * The Code Graph workspace, docked as an editor tab.
 *
 * The panel owns every piece of graph state: each row comes from the server
 * route with its freshness binding attached, a directory switch reloads from
 * scratch, and a new search clears the previous subject before its answer can
 * land. Three regions (explorer, graph, inspector) become columns once the
 * panel is wide enough for them and stack in a narrow rail; a failed fetch is
 * an explicit error with a retry, never a fake empty list.
 */
export const CodeGraphPanel: React.FC<{ directory: string | null | undefined; focusFile?: string | null }> = ({
  directory,
  focusFile,
}) => {
  const { t } = useI18n();
  const [index, setIndex] = React.useState<CodeGraphIndexSummary | null>(null);
  const [indexError, setIndexError] = React.useState<string | null>(null);
  const [indexLoading, setIndexLoading] = React.useState(false);
  const [searchText, setSearchText] = React.useState('');
  const [search, setSearch] = React.useState<CodeGraphQueryResult | null>(null);
  const [searchScope, setSearchScope] = React.useState<'symbols' | 'content'>('symbols');
  const [committedScope, setCommittedScope] = React.useState<'symbols' | 'content'>('symbols');
  const [showTestMatches, setShowTestMatches] = React.useState(false);
  const [matchWindow, setMatchWindow] = React.useState(SEARCH_PAGE_SIZE);
  const [moduleOpen, setModuleOpen] = React.useState<string | null>(null);
  const rankedMatches = React.useMemo(() => {
    const items = search?.items ?? [];
    const visible = showTestMatches ? items : items.filter((item) => !isTestPath(item.file));
    return [...visible].sort((left, right) => {
      const testRank = Number(isTestPath(left.file)) - Number(isTestPath(right.file));
      if (testRank !== 0) return testRank;
      const leftRank = left.rank ?? null;
      const rightRank = right.rank ?? null;
      if (leftRank !== null && rightRank !== null && leftRank !== rightRank) return leftRank - rightRank;
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      return (left.name ?? left.id).localeCompare(right.name ?? right.id);
    });
  }, [search, showTestMatches]);
  const hiddenTestCount = (search?.items.length ?? 0) - rankedMatches.length;
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detailSubjectId, setDetailSubjectId] = React.useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = React.useState<{
    id?: string; from: string; to: string; kind: string; confidence: number; sites: number; evidenceRef?: string;
  } | null>(null);
  const [committedQuery, setCommittedQuery] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<CodeGraphMode>('explore');
  const [explore, setExplore] = React.useState<CodeGraphQueryResult | null>(null);
  const [exploreLoading, setExploreLoading] = React.useState(false);
  const [exploreError, setExploreError] = React.useState<string | null>(null);
  const [trail, setTrail] = React.useState<CodeGraphTraceAnswer | null>(null);
  const [trailLoading, setTrailLoading] = React.useState(false);
  const [trailError, setTrailError] = React.useState<string | null>(null);
  // Trace endpoints: A is seeded from the current subject, B is named by a
  // node click, a search row, or the inspector's trace actions. Both set
  // issues exactly one `kind: 'trace'` query at the current depth.
  const [traceFrom, setTraceFrom] = React.useState<string | null>(null);
  const [traceTo, setTraceTo] = React.useState<string | null>(null);
  // Impact runs: one raw answer per changed symbol the graph knows, plus
  // the aggregate (the primary answer) whose summary the view renders.
  const [impactRuns, setImpactRuns] = React.useState<Array<{ symbol: string; answer: CodeGraphImpactAnswer }>>([]);
  const [impactAggregate, setImpactAggregate] = React.useState<CodeGraphImpactAnswer | null>(null);
  const [impactRunsLoading, setImpactRunsLoading] = React.useState(false);
  const [impactRunsError, setImpactRunsError] = React.useState<string | null>(null);
  const [peek, setPeek] = React.useState<{
    file: string; line: number; text: string | null; error: string | null; loading: boolean;
  } | null>(null);
  const [wide, setWide] = React.useState(false);
  // The inspector's own open state: `<details open>` is a controlled DOM property
  // in React, so binding it straight to the layout width reverted every user
  // toggle on the next render (the detail answer arriving right after a click).
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const [depth, setDepth] = React.useState<1 | 2 | 3>(1);
  const [filters, setFilters] = React.useState<CodeGraphToolbarFilters>(DEFAULT_GRAPH_FILTERS);
  const [subjectChangeFiles, setSubjectChangeFiles] = React.useState<string[]>([]);
  const [viewEpoch, setViewEpoch] = React.useState(0);
  const [inspectorWidth, setInspectorWidth] = React.useState(300);
  /** Committed selection: a node or edge click sets it and opens the inspector; hover never does. */
  const [selection, setSelection] = React.useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);

  const commitSelection = React.useCallback((next: { kind: 'node' | 'edge'; id: string } | null) => {
    setSelection(next);
    // Selecting in a wide-enough panel opens the inspector; below the overlay
    // breakpoint it stays collapsed until the user opens it.
    if (next !== null && containerWidth >= 900) setInspectorOpen(true);
  }, [containerWidth]);

  const clearSelection = React.useCallback(() => {
    // Clearing the selection closes the inspector but keeps the loaded subject
    // answer: re-clicking the node reopens it without refetching.
    setSelection(null);
    setSelectedEdge(null);
  }, []);

  const handleSelectEdge = React.useCallback((edge: CodeGraphSelectedEdge | null) => {
    if (!edge) {
      clearSelection();
      return;
    }
    const next: CodeGraphSelectedEdge = {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      confidence: edge.confidence,
      sites: edge.sites,
    };
    if (edge.evidenceRef !== undefined) next.evidenceRef = edge.evidenceRef;
    setSelectedEdge(next);
    commitSelection({ kind: 'edge', id: edge.id ?? `${edge.from}->${edge.to}|${edge.kind}` });
  }, [clearSelection, commitSelection]);

  // Escape closes the inspector. It never reaches into a dialog, menu, or text field.
  React.useEffect(() => {
    if (!selection) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target;
      if (target instanceof Element
        && target.closest('input, textarea, select, [role="dialog"], [role="menu"], [data-radix-portal]')) return;
      clearSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, clearSelection]);
  const [preview, setPreview] = React.useState<{
    id: string;
    detail: CodeGraphQueryResult | null;
    impact: CodeGraphQueryResult | null;
    file: CodeGraphQueryResult | null;
    tests: CodeGraphQueryResult | null;
  } | null>(null);
  const [detail, setDetail] = React.useState<CodeGraphQueryResult | null>(null);
  const [fileDetail, setFileDetail] = React.useState<CodeGraphQueryResult | null>(null);
  const [impactDetail, setImpactDetail] = React.useState<CodeGraphQueryResult | null>(null);
  const [testsDetail, setTestsDetail] = React.useState<CodeGraphQueryResult | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [sourceError, setSourceError] = React.useState<string | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  // An explicit user selection (search, pick, scope change, focused file)
  // always wins over the default-subject resolver: once set, the resolver
  // never overwrites it. Reset only on directory change.
  const activeGraphRef = React.useRef<CodeGraphTopology | null>(null);
  const explicitRef = React.useRef(false);
  const adoptedRef = React.useRef<{ key: string; subject: CodeGraphSubject } | null>(null);
  const depthRef = React.useRef<1 | 2 | 3>(1);
  const answerCacheRef = React.useRef(new Map<string, CodeGraphQueryResult>());
  const inflightRef = React.useRef(new Map<string, Promise<CodeGraphQueryResult>>());
  // Raw trace/impact answers keep their own generation cache: the typed
  // client drops the summary envelope they render, so they never share it.
  const rawCacheRef = React.useRef(new Map<string, CodeGraphTraceAnswer | CodeGraphImpactAnswer>());
  const rawInflightRef = React.useRef(new Map<string, Promise<CodeGraphTraceAnswer | CodeGraphImpactAnswer>>());
  const revisionRef = React.useRef<string | null>(null);
  const cacheEpochRef = React.useRef(0);
  const requestRef = React.useRef(0);
  const searchRef = React.useRef(0);
  const previewRef = React.useRef(0);
  const exploreRef = React.useRef(0);
  const trailRef = React.useRef(0);
  const impactRef = React.useRef(0);
  const peekRef = React.useRef(0);
  const pendingRef = React.useRef<AbortController | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const inspectorDragRef = React.useRef<{ startX: number; base: number } | null>(null);
  const snapshotRoot = detail?.snapshotRoot ?? fileDetail?.snapshotRoot
    ?? search?.snapshotRoot ?? index?.snapshotRoot ?? null;
  const { subject: defaultSubject, loading: subjectLoading } = useCodeGraphDefaultSubject(directory ?? null);
  depthRef.current = depth;

  const pathRoots = React.useMemo<PathRoots>(() => ({ snapshotRoot, projectRoot: directory ?? null }), [directory, snapshotRoot]);

  const displayPath = React.useCallback((file: string | null | undefined): string => (
    file ? graphFilePathForDisplay({ snapshotRoot, projectRoot: directory, file }) : ''
  ), [directory, snapshotRoot]);

  const trackPending = React.useCallback((controller: AbortController) => {
    pendingRef.current?.abort();
    pendingRef.current = controller;
    return controller.signal;
  }, []);

  // Keys carry no revision: the revision effect below clears the cache on
  // every rebuild, so a cached entry is always from the current generation
  // by construction — and loader identities stay stable when the revision
  // merely arrives, instead of refetching a just-loaded answer.
  // A cached answer belongs to ONE index generation. During a build the server
  // answers queries with the honest "not ready" shape, and caching that under a
  // key that never changes made the panel replay "not ready" forever after the
  // index went Fresh - a blank canvas with a spinner. The generation is part of
  // the key, so a finished build makes every cached answer unreachable and the
  // pending subject query actually refetches.
  const indexStamp = Number(index?.observedAtMs) || 0;
  const indexBuildRef = React.useRef(0);
  const cacheKey = React.useCallback((kind: string, subject: string, queryDepth: number): string => (
    `${kind}|${subject}|${queryDepth}|build:${indexBuildRef.current}`
  ), []);

  // One generation keeps one answer: an identical kind/subject/depth request
  // reuses the loaded answer (or joins it in flight) instead of fetching
  // twice. Refresh bypasses the cache; the epoch guard drops late answers
  // from a generation the cache has already moved past.
  const queryOnce = React.useCallback(async (
    key: string,
    run: () => Promise<CodeGraphQueryResult>,
    bypass: boolean,
    signal: AbortSignal,
  ): Promise<CodeGraphQueryResult> => {
    if (!bypass) {
      const cached = answerCacheRef.current.get(key);
      if (cached) return cached;
      const inflight = inflightRef.current.get(key);
      if (inflight) return inflight;
    }
    const epoch = cacheEpochRef.current;
    const pending = run().then(
      (result) => {
        if (!signal.aborted && cacheEpochRef.current === epoch) answerCacheRef.current.set(key, result);
        inflightRef.current.delete(key);
        return result;
      },
      (error) => {
        inflightRef.current.delete(key);
        throw error;
      },
    );
    inflightRef.current.set(key, pending);
    return pending;
  }, []);

  // The same route, read raw: trace and impact summaries ride the payload
  // but not the typed client, so these answers fetch the identical query
  // string and validate only the fields their views render.
  const queryRaw = React.useCallback(async (
    params: { kind: 'trace' | 'impact'; symbol?: string; from?: string; to?: string; file?: string },
    queryDepth: 1 | 2 | 3,
    signal: AbortSignal,
  ): Promise<CodeGraphJsonValue> => {
    if (!directory) throw new Error('Code graph needs a project directory');
    const query: CodeGraphRawQueryParams = {
      directory,
      kind: params.kind,
      limit: String(SUBJECT_FETCH_LIMIT),
      depth: String(queryDepth),
    };
    if (params.symbol) query.symbol = params.symbol;
    if (params.file) query.file = params.file;
    if (params.from) query.from = params.from;
    if (params.to) query.to = params.to;
    const response = await runtimeFetch('/api/code-graph/query', {
      query,
      directory,
      cache: 'no-store',
      signal,
    });
    const payload: CodeGraphJsonValue = await response.json().catch(() => null);
    if (!response.ok) {
      const error = isJsonRecord(payload) ? asText(payload.error) : undefined;
      const message = error && error.trim()
        ? error.trim()
        : `Failed to query code graph (${response.status})`;
      throw new Error(message);
    }
    return payload;
  }, [directory]);

  // One generation keeps one raw answer, exactly like the typed cache: an
  // identical kind/subject/depth request reuses the loaded answer instead of
  // fetching twice, and the epoch guard drops late answers past a rebuild.
  const queryRawOnce = React.useCallback(async <T extends CodeGraphTraceAnswer | CodeGraphImpactAnswer>(
    key: string,
    run: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> => {
    const cached = rawCacheRef.current.get(key);
    if (cached) {
      // SAFETY: raw answers are cached under the kind that produced them, so the stored shape is the requested T.
      return cached as T;
    }
    const inflight = rawInflightRef.current.get(key);
    if (inflight) {
      // SAFETY: the in-flight promise runs the caller's loader, so its result is the requested T.
      return inflight as Promise<T>;
    }
    const epoch = cacheEpochRef.current;
    const pending = run().then(
      (result) => {
        if (!signal.aborted && cacheEpochRef.current === epoch) rawCacheRef.current.set(key, result);
        rawInflightRef.current.delete(key);
        return result;
      },
      (error) => {
        rawInflightRef.current.delete(key);
        throw error;
      },
    );
    rawInflightRef.current.set(key, pending);
    return pending;
  }, []);

  // Freshness is decided when the index is read, never by a watcher: a checkout
  // can change under an open panel (git switch, an agent writing files). Reading
  // again when the panel regains focus re-checks the content fingerprint, so a
  // stale generation is reported instead of silently served. Bounded to once a
  // minute so window switching never starts a rebuild storm, and the rebuild
  // itself stays explicit because it costs minutes and gigabytes.
  const FOCUS_REVALIDATE_MIN_INTERVAL_MS = 60_000;
  const lastIndexReadAtRef = React.useRef(0);
  const loadIndex = React.useCallback(async (refresh: boolean, signal: AbortSignal) => {
    if (!directory) return;
    setIndexLoading(true);
    setIndexError(null);
    try {
      const summary = await fetchCodeGraphIndex(directory, { refresh, signal });
      if (signal.aborted) return;
      lastIndexReadAtRef.current = Date.now();
      setIndex(summary);
    } catch (error) {
      if (signal.aborted) return;
      setIndex(null);
      setIndexError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!signal.aborted) setIndexLoading(false);
    }
  }, [directory]);

  React.useEffect(() => {
    if (!directory) return undefined;
    const revalidateIndex = () => {
      if (globalThis.document?.visibilityState === 'hidden') return;
      if (Date.now() - lastIndexReadAtRef.current < FOCUS_REVALIDATE_MIN_INTERVAL_MS) return;
      const controller = new AbortController();
      void loadIndex(false, controller.signal);
    };
    window.addEventListener('focus', revalidateIndex);
    document.addEventListener('visibilitychange', revalidateIndex);
    return () => {
      window.removeEventListener('focus', revalidateIndex);
      document.removeEventListener('visibilitychange', revalidateIndex);
    };
  }, [directory, FOCUS_REVALIDATE_MIN_INTERVAL_MS, loadIndex]);

  // Keep the cache key bound to the index generation the panel is looking at.
  React.useEffect(() => {
    indexBuildRef.current = indexStamp;
  }, [indexStamp]);

  const cancelIndexing = React.useCallback(() => {
    if (!directory) return;
    void cancelCodeGraphIndex(directory)
      .catch(() => undefined)
      .finally(() => {
        const controller = new AbortController();
        void loadIndex(false, controller.signal);
      });
  }, [directory, loadIndex]);

  // An index build is a job, not a request: poll its own state until it
  // publishes a generation, fails, or is cancelled. The timer dies with the
  // panel, so a closed view leaves nothing running.
  React.useEffect(() => {
    if (!directory || index === null || index.ready !== false) return undefined;
    const state = index.indexState?.state;
    if (state === 'failed' || state === 'cancelled') return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadIndex(false, controller.signal);
    }, 2500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [directory, index, loadIndex]);

  React.useEffect(() => {
    pendingRef.current?.abort();
    // Every flow that could still answer is invalidated here: an abort only
    // stops a request already in flight, while a generation bump also stops
    // the follow-up request (a preview, a detail, a trail) a resolved answer
    // would otherwise dispatch against the project we just left.
    searchRef.current += 1;
    requestRef.current += 1;
    previewRef.current += 1;
    exploreRef.current += 1;
    trailRef.current += 1;
    impactRef.current += 1;
    peekRef.current += 1;
    const controller = new AbortController();
    pendingRef.current = controller;
    setIndex(null);
    setIndexError(null);
    setSearch(null);
    setSearchError(null);
    setSelectedId(null);
    setDetailSubjectId(null);
    setPreview(null);
    setSelectedEdge(null);
    setDetail(null);
    setFileDetail(null);
    setImpactDetail(null);
    setTestsDetail(null);
    setDetailError(null);
    setSelection(null);
    setCommittedQuery(null);
    setSearchScope('symbols');
    setCommittedScope('symbols');
    setMode('explore');
    setExplore(null);
    setExploreError(null);
    setTrail(null);
    setTrailError(null);
    setTraceFrom(null);
    setTraceTo(null);
    setImpactRuns([]);
    setImpactAggregate(null);
    setImpactRunsError(null);
    setPeek(null);
    setSearchLoading(false);
    setDetailLoading(false);
    setIndexLoading(false);
    setDepth(1);
    setSubjectChangeFiles([]);
    explicitRef.current = false;
    adoptedRef.current = null;
    cacheEpochRef.current += 1;
    answerCacheRef.current.clear();
    inflightRef.current.clear();
    rawCacheRef.current.clear();
    rawInflightRef.current.clear();
    setSearchText('');
    if (directory) {
      void loadIndex(false, controller.signal);
    }
    return () => {
      controller.abort();
      pendingRef.current = null;
    };
  }, [directory, loadIndex]);

  React.useEffect(() => {
    if (!directory || !focusFile) return undefined;
    const controller = new AbortController();
    // A focused file is an explicit direction from the host: the default
    // subject resolver must not overwrite it.
    explicitRef.current = true;
    adoptedRef.current = null;
    setSubjectChangeFiles([]);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setFileDetail(null);
    setImpactDetail(null);
    setTestsDetail(null);
    setSelectedEdge(null);
    setSelection(null);
    const subject = `file:${focusFile}`;
    setSelectedId(subject);
    setDetailSubjectId(subject);
    // A new subject reseeds the trace start; the destination waits for an
    // explicit endpoint.
    setTraceFrom(subject);
    setTraceTo(null);
    setImpactRuns([]);
    setImpactAggregate(null);
    setImpactRunsError(null);
    queryCodeGraph(directory, { kind: 'file', file: focusFile, limit: SUBJECT_FETCH_LIMIT, depth: depthRef.current, refresh: false, signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setFileDetail(result); })
      .catch((error) => { if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [directory, focusFile, indexStamp]);

  const fetchSubject = React.useCallback(async (
    item: Pick<CodeGraphItem, 'id' | 'file'>,
    refresh: boolean,
    signal: AbortSignal,
    queryDepth: 1 | 2 | 3,
  ): Promise<{ detail: CodeGraphQueryResult | null; impact: CodeGraphQueryResult | null; file: CodeGraphQueryResult | null; tests: CodeGraphQueryResult | null }> => {
    if (!directory) return { detail: null, impact: null, file: null, tests: null };
    const fetchTests = async (): Promise<CodeGraphQueryResult | null> => {
      try {
        return await queryOnce(
          cacheKey('tests', item.id, queryDepth),
          () => queryCodeGraph(directory, { kind: 'tests', target: item.id, limit: SUBJECT_FETCH_LIMIT, depth: queryDepth, refresh, signal }),
          refresh,
          signal,
        );
      } catch {
        return null;
      }
    };
    if (item.id.startsWith('file:')) {
      const fileResult = await queryOnce(
        cacheKey('file', item.id, queryDepth),
        () => queryCodeGraph(directory, {
          kind: 'file',
          file: item.file,
          limit: SUBJECT_FETCH_LIMIT,
          depth: queryDepth,
          refresh,
          signal,
        }),
        refresh,
        signal,
      );
      return { detail: null, impact: null, file: fileResult, tests: await fetchTests() };
    }
    const [contextResult, impactResult] = await Promise.all([
      queryOnce(
        cacheKey('context', item.id, queryDepth),
        () => queryCodeGraph(directory, { kind: 'context', symbol: item.id, limit: SUBJECT_FETCH_LIMIT, depth: queryDepth, refresh, signal }),
        refresh,
        signal,
      ),
      queryOnce(
        cacheKey('impact', item.id, queryDepth),
        () => queryCodeGraph(directory, { kind: 'impact', symbol: item.id, limit: SUBJECT_FETCH_LIMIT, depth: queryDepth, refresh, signal }),
        refresh,
        signal,
      ),
    ]);
    return { detail: contextResult, impact: impactResult, file: null, tests: await fetchTests() };
  }, [directory, cacheKey, queryOnce]);

  const runSearch = React.useCallback(async (submitted: string, scope: 'symbols' | 'content', refresh: boolean, signal: AbortSignal, queryDepth: 1 | 2 | 3) => {
    const needle = submitted.trim();
    if (!directory || !needle) return;
    // A submitted search is explicit: it replaces the default subject and the
    // resolver must not bring it back.
    explicitRef.current = true;
    adoptedRef.current = null;
    setSubjectChangeFiles([]);
    const request = searchRef.current + 1;
    searchRef.current = request;
    setSearchLoading(true);
    setSearchError(null);
    setSearch(null);
    setCommittedQuery(needle);
    setCommittedScope(scope);
    setSelectedId(null);
    setDetailSubjectId(null);
    setPreview(null);
    setSelectedEdge(null);
    setSelection(null);
    setDetail(null);
    setFileDetail(null);
    setImpactDetail(null);
    setTestsDetail(null);
    setDetailError(null);
    setTrail(null);
    setTrailError(null);
    setTraceFrom(null);
    setTraceTo(null);
    setImpactRuns([]);
    setImpactAggregate(null);
    setImpactRunsError(null);
    setPeek(null);
    try {
      const kind = scope === 'content' ? 'content' : 'search';
      const result = await queryCodeGraph(directory, { kind, query: needle, limit: SEARCH_FETCH_LIMIT, refresh, signal });
      if (signal.aborted || searchRef.current !== request) return;
      setSearch(result);
      // Honest ambiguity: several candidates for one subject stay a list until
      // the user picks one. Only a single exact hit keeps the auto-preview.
      if (scope !== 'content' && result.items.length === 1) {
        const first = result.items[0];
        if (first) {
          const previewRequest = previewRef.current + 1;
          previewRef.current = previewRequest;
          fetchSubject(first, refresh, signal, queryDepth).then(
            (found) => {
              if (signal.aborted || previewRef.current !== previewRequest || searchRef.current !== request) return;
              setPreview({ id: first.id, ...found });
            },
            () => {},
          );
        }
      }
    } catch (error) {
      if (signal.aborted || searchRef.current !== request) return;
      setSearch(null);
      setSearchError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!signal.aborted && searchRef.current === request) setSearchLoading(false);
    }
  }, [directory, fetchSubject]);

  const selectItem = React.useCallback(async (item: CodeGraphItem, refresh: boolean, signal: AbortSignal, queryDepth: 1 | 2 | 3) => {
    if (!directory) return;
    // A picked row is explicit: it replaces the default subject and the
    // resolver must not bring it back.
    explicitRef.current = true;
    adoptedRef.current = null;
    setSubjectChangeFiles([]);
    const request = requestRef.current + 1;
    requestRef.current = request;
    previewRef.current += 1;
    setSelectedId(item.id);
    setDetailSubjectId(item.id);
    setSelectedEdge(null);
    commitSelection({ kind: 'node', id: item.id });
    // A picked subject reseeds the trace start and drops answers from the
    // previous subject. Reloading the same subject (depth, refresh) keeps
    // the named destination and the loaded answers; the depth-aware effects
    // refetch them instead.
    const subjectChanged = item.id !== detailSubjectId;
    if (subjectChanged) {
      if (item.id !== traceFrom) {
        setTraceFrom(item.id);
        setTraceTo(null);
      }
      setImpactRuns([]);
      setImpactAggregate(null);
      setImpactRunsError(null);
      setTrail(null);
      setTrailError(null);
    }
    // The old preview (if any) belonged to the unselected list: drop it now
    // so the graph never shows a subject the user did not commit to.
    setPreview(null);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setFileDetail(null);
    setImpactDetail(null);
    setTestsDetail(null);
    if (subjectChanged) {
      setTrail(null);
      setTrailError(null);
    }
    try {
      const found = await fetchSubject(item, refresh, signal, queryDepth);
      if (signal.aborted || requestRef.current !== request) return;
      setDetail(found.detail);
      setImpactDetail(found.impact);
      setFileDetail(found.file);
      setTestsDetail(found.tests);
      setPreview(null);
    } catch (error) {
      if (signal.aborted || requestRef.current !== request) return;
      setDetailError(error instanceof Error ? error.message : String(error));
      setPreview(null);
    } finally {
      if (!signal.aborted && requestRef.current === request) setDetailLoading(false);
    }
  }, [directory, fetchSubject, commitSelection, detailSubjectId, traceFrom]);

  // The module listing is depth-independent: it is keyed by revision only,
  // so a mode switch back to explore reuses the loaded answer.
  const loadExplore = React.useCallback(async (refresh: boolean, signal: AbortSignal) => {
    if (!directory) return;
    const request = exploreRef.current + 1;
    exploreRef.current = request;
    setExploreLoading(true);
    setExploreError(null);
    try {
      const result = await queryOnce(
        cacheKey('explore', 'modules', 0),
        () => queryCodeGraph(directory, { kind: 'explore', limit: SUBJECT_FETCH_LIMIT, refresh, signal }),
        refresh,
        signal,
      );
      if (signal.aborted || exploreRef.current !== request) return;
      setExplore(result);
    } catch (error) {
      if (signal.aborted || exploreRef.current !== request) return;
      setExplore(null);
      setExploreError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!signal.aborted && exploreRef.current === request) setExploreLoading(false);
    }
  }, [directory, cacheKey, queryOnce]);

  React.useEffect(() => {
    if (mode !== 'explore' || !directory) return undefined;
    const controller = new AbortController();
    void loadExplore(false, controller.signal);
    return () => controller.abort();
  }, [mode, directory, loadExplore]);

  // Trace endpoints: the inspector's trace actions name a slot. The query
  // effect below fires once both slots hold an endpoint at the current
  // depth; nothing fetches for a single endpoint.
  const handleInspectorTraceFrom = React.useCallback((id: string) => {
    setTraceFrom(id);
    setMode('trace');
  }, []);

  const handleInspectorTraceTo = React.useCallback((id: string) => {
    setTraceTo(id);
    setMode('trace');
  }, []);

  const handleInspectorImpact = React.useCallback((id: string) => {
    // Impact analyzes an adopted subject: when the action names a node that is
    // not selected (the edge's from-node), adopt it first with the existing loader.
    if (id !== selectedId) {
      const node = activeGraphRef.current?.nodes.find((entry) => entry.id === id) ?? null;
      if (node) {
        void selectItem(
          {
            id: node.id,
            file: node.file ?? '',
            line: node.line ?? 0,
            evidence: [],
            confidence: 1,
            knowledgeIds: [],
          },
          false,
          trackPending(new AbortController()),
          depthRef.current,
        ).then(() => setMode('impact'));
        return;
      }
    }
    setMode('impact');
  }, [selectedId, selectItem, trackPending]);

  // The trace start follows the current subject until an endpoint names
  // another. The destination waits for an explicit endpoint.
  React.useEffect(() => {
    if (traceFrom === null && selectedId !== null) setTraceFrom(selectedId);
  }, [traceFrom, selectedId]);

  // Both endpoints set issues exactly one `kind: 'trace'` query at the
  // current depth. A cached kind/subject/depth answer is reused, so mode
  // switches and re-renders never refetch it; a depth change re-queries.
  React.useEffect(() => {
    if (mode !== 'trace' || !directory || traceFrom === null || traceTo === null) return undefined;
    const request = trailRef.current + 1;
    trailRef.current = request;
    const controller = new AbortController();
    const signal = trackPending(controller);
    const from = traceFrom;
    const to = traceTo;
    const queryDepth = depth;
    setTrailLoading(true);
    setTrailError(null);
    void queryRawOnce(
      cacheKey('trace-raw', `${from}>${to}`, queryDepth),
      () => queryRaw({ kind: 'trace', from, to }, queryDepth, signal).then(parseTraceAnswer),
      signal,
    ).then(
      (answer) => {
        if (signal.aborted || trailRef.current !== request) return;
        setTrail(answer);
        setTrailLoading(false);
      },
      (error) => {
        if (signal.aborted || trailRef.current !== request) return;
        setTrail(null);
        setTrailError(error instanceof Error ? error.message : String(error));
        setTrailLoading(false);
      },
    );
    return () => controller.abort();
  }, [mode, directory, traceFrom, traceTo, depth, trackPending, cacheKey, queryRaw, queryRawOnce]);

  // The default subject carries a fresh files array per render (the resolver
  // keys on content, not identity): depend on its joined contents so a
  // re-render with the same tree never refires the impact query. Refiring
  // after every aggregate commit recreates the runs array forever and the
  // summary never settles.
  const defaultChangesKey = defaultSubject.source === 'changes' ? defaultSubject.files.join('\u0000') : defaultSubject.source;
  // Impact answers: the selected symbol gets one aggregate answer; a change
  // set resolves each changed file first and then asks impact per symbol
  // the graph knows, keeping the first answer as the aggregate. One failed
  // file or symbol never erases the unrelated complete answers.
  React.useEffect(() => {
    if (mode !== 'impact' || !directory) return undefined;
    const request = impactRef.current + 1;
    impactRef.current = request;
    const controller = new AbortController();
    const signal = controller.signal;
    const queryDepth = depthRef.current;
    const fail = (message: string): undefined => {
      if (signal.aborted || impactRef.current !== request) return undefined;
      setImpactRuns([]);
      setImpactAggregate(null);
      setImpactRunsError(message);
      setImpactRunsLoading(false);
      return undefined;
    };
    setImpactRunsLoading(true);
    setImpactRunsError(null);
    const changeFiles = subjectChangeFiles.length > 0
      ? subjectChangeFiles
      : (defaultSubject.source === 'changes' ? (defaultChangesKey.length > 0 ? defaultChangesKey.split('\u0000') : []) : []);
    if (selectedId !== null && !selectedId.startsWith('file:')) {
      const symbol = selectedId;
      void queryRawOnce(
        cacheKey('impact-raw', symbol, queryDepth),
        () => queryRaw({ kind: 'impact', symbol }, queryDepth, signal).then(parseImpactAnswer),
        signal,
      ).then(
        (answer) => {
          if (signal.aborted || impactRef.current !== request) return;
          setImpactRuns([{ symbol, answer }]);
          setImpactAggregate(answer);
          setImpactRunsLoading(false);
        },
        (error) => {
          fail(error instanceof Error ? error.message : String(error));
        },
      );
      return () => controller.abort();
    }
    const files = changeFiles.length > 0
      ? changeFiles
      : (selectedId !== null && selectedId.startsWith('file:')
        ? [selectedId.slice('file:'.length)]
        : []);
    if (files.length === 0) {
      setImpactRuns([]);
      setImpactAggregate(null);
      setImpactRunsLoading(false);
      return undefined;
    }
    void (async () => {
      const symbols: string[] = [];
      for (const file of files) {
        if (signal.aborted || impactRef.current !== request) return;
        try {
          const fileAnswer = await queryOnce(
            cacheKey('file', `file:${file}`, queryDepth),
            () => queryCodeGraph(directory, { kind: 'file', file, limit: SUBJECT_FETCH_LIMIT, depth: queryDepth, refresh: false, signal }),
            false,
            signal,
          );
          for (const item of fileAnswer.items) {
            if (!item.id.startsWith('file:') && !symbols.includes(item.id)) symbols.push(item.id);
          }
        } catch {
          // One unreadable file never erases the symbols the graph knew.
        }
      }
      if (signal.aborted || impactRef.current !== request) return;
      if (symbols.length === 0) {
        setImpactRuns([]);
        setImpactAggregate(null);
        setImpactRunsLoading(false);
        return;
      }
      const settled = await Promise.all(symbols.map((symbol) => queryRawOnce(
        cacheKey('impact-raw', symbol, queryDepth),
        () => queryRaw({ kind: 'impact', symbol }, queryDepth, signal).then(parseImpactAnswer),
        signal,
      ).then(
        (answer) => ({ symbol, answer }),
        (): null => null,
      )));
      if (signal.aborted || impactRef.current !== request) return;
      const ok = settled.filter((entry): entry is { symbol: string; answer: CodeGraphImpactAnswer } => entry !== null);
      setImpactRuns(ok);
      setImpactAggregate(ok[0]?.answer ?? null);
      if (ok.length === 0) {
        setImpactRunsError('Failed to query code graph');
      }
      setImpactRunsLoading(false);
    })();
    return () => controller.abort();
  }, [mode, directory, depth, selectedId, subjectChangeFiles, defaultChangesKey, defaultSubject.source, cacheKey, queryOnce, queryRaw, queryRawOnce]);

  const handlePeek = React.useCallback(async (file: string, line: number) => {
    const request = peekRef.current + 1;
    peekRef.current = request;
    if (!directory) {
      setPeek({ file, line, text: null, error: 'Code graph needs a project directory', loading: false });
      return;
    }
    setPeek({ file, line, text: null, error: null, loading: true });
    const resolvedFile = resolveGraphFile({ snapshotRoot, projectRoot: directory, file });
    if (!resolvedFile.ok) {
      setPeek({ file, line, text: null, error: `${resolvedFile.reason}: ${file}`, loading: false });
      return;
    }
    const absolute = resolvedFile.path;
    let firstError: string | null = null;
    try {
      const params = new URLSearchParams({ path: absolute, directory, optional: 'true' });
      const response = await runtimeFetch(`/api/fs/read?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        firstError = `Failed to read ${file} (${response.status})`;
        throw new Error(firstError);
      }
      const text = await response.text();
      if (peekRef.current !== request) return;
      setPeek({ file, line, text, error: null, loading: false });
      return;
    } catch (error) {
      if (firstError === null) firstError = error instanceof Error ? error.message : String(error);
    }
    // Some runtimes expose no HTTP fs routes: fall back to the registered
    // files API, exactly as detectDevServer does. A failed read stays failed.
    const runtimeFiles = getRegisteredRuntimeAPIs()?.files;
    if (runtimeFiles?.readFile) {
      try {
        const result = await runtimeFiles.readFile(absolute, { optional: true });
        if (peekRef.current !== request) return;
        if (result && isJsonText(result.content)) {
          setPeek({ file, line, text: result.content, error: null, loading: false });
          return;
        }
      } catch {
        // Fall through to the recorded error.
      }
    }
    if (peekRef.current !== request) return;
    setPeek({ file, line, text: null, error: firstError, loading: false });
  }, [directory, snapshotRoot]);

  const clearAnswerState = React.useCallback(() => {
    searchRef.current += 1;
    previewRef.current += 1;
    requestRef.current += 1;
    setSearch(null);
    setSearchError(null);
    setSearchLoading(false);
    setSelectedId(null);
    setDetailSubjectId(null);
    setPreview(null);
    setSelectedEdge(null);
    setDetail(null);
    setFileDetail(null);
    setImpactDetail(null);
    setTestsDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    setTrail(null);
    setTrailError(null);
    setPeek(null);
    setSelection(null);
    setSubjectChangeFiles([]);
    setMatchWindow(SEARCH_PAGE_SIZE);
  }, []);

  const retrySearch = React.useCallback(() => {
    void runSearch(searchText, searchScope, false, trackPending(new AbortController()), depthRef.current);
  }, [runSearch, searchText, searchScope, trackPending]);

  const handleScopeChange = React.useCallback((next: 'symbols' | 'content') => {
    if (next === searchScope) return;
    // A scope switch is explicit: it clears the current answers and the
    // resolver must not re-adopt the default behind it.
    explicitRef.current = true;
    adoptedRef.current = null;
    setSearchScope(next);
    setCommittedScope(next);
    clearAnswerState();
  }, [clearAnswerState, searchScope]);

  const handleModeChange = React.useCallback((next: CodeGraphMode) => {
    setMode(next);
  }, []);

  // Adopt the resolved default subject: an active file issues its file
  // query, a change set queries its first file and keeps the full list for
  // the impact view. The module map needs no query here: the explore effect
  // owns that load. Never marks explicit: this is the default, and any
  // later explicit selection still wins over it.
  const adoptDefaultSubject = React.useCallback(async (
    refresh: boolean,
    signal: AbortSignal,
    subject: CodeGraphSubject,
    queryDepth: 1 | 2 | 3,
  ) => {
    if (!directory) return;
    const file = subject.source === 'changes'
      ? (subject.files[0] ?? subject.file)
      : subject.file;
    if ((subject.source !== 'active-file' && subject.source !== 'changes') || !file) return;
    if (subject.source === 'changes') setSubjectChangeFiles(subject.files);
    const subjectId = `file:${file}`;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setFileDetail(null);
    setImpactDetail(null);
    setTestsDetail(null);
    setSelectedEdge(null);
    setPreview(null);
    setSelectedId(subjectId);
    setDetailSubjectId(subjectId);
    // An adopted subject reseeds the trace start like an explicit pick, but
    // reloading the same adopted subject keeps the destination and answers.
    if (subjectId !== detailSubjectId) {
      setTraceFrom(subjectId);
      setTraceTo(null);
      setImpactRuns([]);
      setImpactAggregate(null);
      setImpactRunsError(null);
      setTrail(null);
      setTrailError(null);
    }
    try {
      const result = await queryOnce(
        cacheKey('file', subjectId, queryDepth),
        () => queryCodeGraph(directory, { kind: 'file', file, limit: SUBJECT_FETCH_LIMIT, depth: queryDepth, refresh, signal }),
        refresh,
        signal,
      );
      if (signal.aborted) return;
      setFileDetail(result);
    } catch (error) {
      if (signal.aborted) return;
      setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!signal.aborted) setDetailLoading(false);
    }
  }, [directory, cacheKey, queryOnce, detailSubjectId]);

  // Reload whatever the panel is showing now: the selected subject, the
  // committed search, the adopted default, and the explore listing when its
  // mode is active. Depth changes and refresh both funnel through here.
  const reloadCurrent = React.useCallback(async (refresh: boolean, signal: AbortSignal, queryDepth: 1 | 2 | 3) => {
    if (!directory) return;
    if (selectedId !== null) {
      const adopted = adoptedRef.current;
      const adoptedFile = adopted && (adopted.subject.source === 'active-file' || adopted.subject.source === 'changes')
        ? (adopted.subject.source === 'changes'
          ? (adopted.subject.files[0] ?? adopted.subject.file)
          : adopted.subject.file)
        : null;
      if (adopted && adoptedFile && selectedId === `file:${adoptedFile}`) {
        void adoptDefaultSubject(refresh, signal, adopted.subject, queryDepth);
        return;
      }
      const current = search?.items.find((entry) => entry.id === selectedId)
        ?? activeGraphRef.current?.nodes.find((entry) => entry.id === selectedId);
      if (current) {
        const item: CodeGraphItem = 'evidence' in current
          ? current
          : {
            id: current.id,
            file: current.file ?? '',
            line: current.line ?? 0,
            evidence: [],
            confidence: 1,
            knowledgeIds: [],
          };
        void selectItem(item, refresh, signal, queryDepth);
        return;
      }
    }
    if (searchText.trim()) {
      void runSearch(searchText, searchScope, refresh, signal, queryDepth);
      return;
    }
    if (!explicitRef.current && !subjectLoading) {
      const key = String(directory).trim();
      const saved = useUIStore.getState().codeGraphStateByDirectory[key];
      if (!saved?.query) {
        adoptedRef.current = {
          key: `${directory}|${defaultSubject.source}|${defaultSubject.file ?? defaultSubject.files[0] ?? ''}`,
          subject: defaultSubject,
        };
        if (defaultSubject.source !== 'module-map') {
          void adoptDefaultSubject(refresh, signal, defaultSubject, queryDepth);
        }
      }
    }
    if (mode === 'explore') {
      void loadExplore(refresh, signal);
    }
  }, [adoptDefaultSubject, defaultSubject, directory, loadExplore, mode, runSearch, search, searchText, searchScope, selectItem, selectedId, subjectLoading]);

  const onRefresh = React.useCallback(() => {
    const controller = new AbortController();
    const signal = trackPending(controller);
    void loadIndex(true, signal).then(() => {
      if (signal.aborted) return;
      void reloadCurrent(true, signal, depthRef.current);
    });
  }, [loadIndex, reloadCurrent, trackPending]);

  const handleDepthChange = React.useCallback((next: 1 | 2 | 3) => {
    // Depth walks the traversal, never post-filters rows: a change refetches
    // every subject query at the new depth.
    if (next === depth) return;
    setDepth(next);
    const signal = trackPending(new AbortController());
    void reloadCurrent(false, signal, next);
  }, [depth, reloadCurrent, trackPending]);

  const handleSearchSubmit = React.useCallback((query: string) => {
    // An empty submit is the explicit clear: the old results, selection,
    // preview and details go away and the resolver stays out.
    if (!query.trim()) {
      explicitRef.current = true;
      adoptedRef.current = null;
      setSearchText('');
      setCommittedQuery(null);
      clearAnswerState();
      return;
    }
    setSearchText(query);
    void runSearch(query, searchScope, false, trackPending(new AbortController()), depthRef.current);
  }, [clearAnswerState, runSearch, searchScope, trackPending]);

  const handleFiltersChange = React.useCallback((next: CodeGraphToolbarFilters) => {
    setFilters(next);
  }, []);

  const handleFit = React.useCallback(() => {
    // The canvas fits itself on mount, so remounting it is the fit: pan and
    // zoom return to the whole neighbourhood without touching the selection.
    setViewEpoch((epoch) => epoch + 1);
  }, []);

  const handleResetView = React.useCallback(() => {
    // Reset the view, not the subject: filters back to defaults, transient
    // edge/peek state cleared, canvas refit. The selection and the loaded
    // trace/impact answers survive.
    setFilters(DEFAULT_GRAPH_FILTERS);
    setSelectedEdge(null);
    setPeek(null);
    setViewEpoch((epoch) => epoch + 1);
  }, []);

  const previewGraphRaw = preview?.detail?.graph ?? preview?.file?.graph ?? null;
  const selectedGraphRaw = detail?.graph ?? fileDetail?.graph ?? null;
  const selectedRevision = detail?.revision ?? fileDetail?.revision ?? null;
  // A committed selection owns its graph: the detail was fetched for the
  // committed id, and the topology renders only when its revision still
  // matches the index. Preview renders only for an unambiguous single hit.
  const selectedGraph = selectedGraphRaw && selectedId !== null
    && (index === null || selectedRevision === null || selectedRevision === index.revision)
    ? selectedGraphRaw
    : null;
  const previewGraph = previewGraphRaw && (search?.items.length ?? 0) === 1
    && preview !== null && preview.id === search?.items[0]?.id
    && (index === null || (preview.detail?.revision ?? preview.file?.revision ?? null) === null
      || (preview.detail?.revision ?? preview.file?.revision) === index.revision)
    ? previewGraphRaw
    : null;
  const activeGraph = selectedGraph ?? previewGraph;
  activeGraphRef.current = activeGraph;
  const showingPreview = selectedGraph === null && activeGraph !== null;
  const subjectAnswered = selectedId !== null && !detailLoading && !detailError && (detail !== null || fileDetail !== null);
  const subjectIndexed = (detail !== null && detail.coverage !== 'unindexed')
    || (fileDetail !== null && fileDetail.coverage !== 'unindexed');
  const inspectorNodeData: CodeGraphInspectorNode | null = React.useMemo(() => {
    if (selection?.kind !== 'node' || !activeGraph) return null;
    const target = activeGraph.nodes.find((entry) => entry.id === selection.id) ?? null;
    if (!target) return null;
    const subjectDetail = detailSubjectId !== null && detailSubjectId === selection.id ? detail : null;
    const subjectImpact = detailSubjectId !== null && detailSubjectId === selection.id ? impactDetail : null;
    const incident = activeGraph.edges.filter((edge) => edge.from === target.id || edge.to === target.id);
    const file = target.file ?? subjectDetail?.definition?.file ?? null;
    const line = target.line ?? subjectDetail?.definition?.line ?? null;
    const nodeData: CodeGraphInspectorNode = {
      id: target.id,
      kind: target.kind,
      file,
      line,
      pathLabel: file ? `${displayPath(file)}${line !== null ? `:${line}` : ''}` : target.id,
      confidence: incident.length > 0 ? Math.max(...incident.map((edge) => edge.confidence)) : null,
      incoming: subjectDetail?.callers ?? [],
      outgoing: subjectDetail?.callees ?? [],
      evidence: subjectDetail?.definition?.evidence ?? [],
      tests: (testsDetail?.items ?? []).map((item) => {
        const test: CodeGraphInspectorTest = { id: item.id, file: item.file, line: item.line };
        if (item.name) test.name = item.name;
        return test;
      }),
      impactedCount: subjectImpact?.impacted ? subjectImpact.impacted.length : null,
      impacted: (subjectImpact?.impacted ?? [])
        .filter((entry) => entry.id !== target.id)
        .slice(0, 8)
        .map((entry) => ({ id: entry.id })),
    };
    if (target.name) nodeData.name = target.name;
    return nodeData;
  }, [selection, activeGraph, detail, detailSubjectId, impactDetail, testsDetail, displayPath]);

  const inspectorEdgeData: CodeGraphInspectorEdge | null = React.useMemo(() => {
    if (selection?.kind !== 'edge' || !selectedEdge || !activeGraph) return null;
    const fromNode = activeGraph.nodes.find((entry) => entry.id === selectedEdge.from) ?? null;
    const toNode = activeGraph.nodes.find((entry) => entry.id === selectedEdge.to) ?? null;
    const fromLine = fromNode?.line ?? null;
    const toLine = toNode?.line ?? null;
    const edgeData: CodeGraphInspectorEdge = {
      id: selection.id,
      kind: selectedEdge.kind,
      from: selectedEdge.from,
      to: selectedEdge.to,
      fromPath: fromNode?.file
        ? `${displayPath(fromNode.file)}${fromLine !== null ? `:${fromLine}` : ''}`
        : selectedEdge.from,
      toPath: toNode?.file
        ? `${displayPath(toNode.file)}${toLine !== null ? `:${toLine}` : ''}`
        : selectedEdge.to,
      fromFile: fromNode?.file ?? null,
      fromLine,
      toFile: toNode?.file ?? null,
      toLine,
      confidence: selectedEdge.confidence,
      sites: selectedEdge.sites,
    };
    if (selectedEdge.evidenceRef !== undefined) edgeData.evidenceRef = selectedEdge.evidenceRef;
    return edgeData;
  }, [selection, selectedEdge, activeGraph, displayPath]);

  const selectGraphNode = React.useCallback((id: string) => {
    if (mode === 'trace' && traceFrom !== null && id !== traceFrom) {
      // In trace mode a node click names the destination; the subject (A)
      // stays put and the query effect fires once both slots are set.
      setSelectedEdge(null);
      commitSelection({ kind: 'node', id });
      setTraceTo(id);
      return;
    }
    if (id === selectedId) {
      // Reopening the same subject restores the inspector without refetching.
      setSelectedEdge(null);
      commitSelection({ kind: 'node', id });
      return;
    }
    const node = activeGraphRef.current?.nodes.find((entry) => entry.id === id);
    void selectItem(
      {
        id,
        file: node?.file ?? '',
        line: node?.line ?? 0,
        evidence: [],
        confidence: 1,
        knowledgeIds: [],
      },
      false,
      trackPending(new AbortController()),
      depthRef.current,
    );
  }, [mode, traceFrom, selectedId, selectItem, trackPending, commitSelection]);

  const committedRevision = search?.revision ?? null;
  const revisionMismatch = committedRevision !== null && index !== null && committedRevision !== index.revision;
  const effectiveFreshness = revisionMismatch ? 'stale' : index?.freshness;
  const showStaleBanner = index !== null && (index.freshness === 'stale' || revisionMismatch);
  const indexStateName = index?.indexState?.state ?? 'queued';
  const indexBuilding =
    index !== null && index.ready === false && indexStateName !== 'failed' && indexStateName !== 'cancelled';
  const indexEnded = index !== null && index.ready === false && (indexStateName === 'failed' || indexStateName === 'cancelled');
  const indexProgressLabel = React.useMemo(() => {
    if (index === null || index.ready !== false) return '';
    const state = index.indexState;
    const phase =
      indexStateName === 'discovering'
        ? t('codeGraph.index.state.discovering')
        : indexStateName === 'analyzing'
          ? t('codeGraph.index.state.analyzing')
          : indexStateName === 'persisting'
            ? t('codeGraph.index.state.persisting')
            : indexStateName === 'failed'
              ? t('codeGraph.index.state.failed')
              : indexStateName === 'cancelled'
                ? t('codeGraph.index.state.cancelled')
                : t('codeGraph.index.state.queued');
    const parts = [phase];
    if (typeof state?.projectsTotal === 'number' && state.projectsTotal > 0) {
      parts.push(t('codeGraph.index.projects', { done: String(state.projectsDone ?? 0), total: String(state.projectsTotal) }));
    } else if (typeof state?.files === 'number' && state.files > 0) {
      parts.push(t('codeGraph.index.files', { count: String(state.files) }));
    }
    return parts.join(' · ');
  }, [index, indexStateName, t]);



  const openSourceAt = React.useCallback((file: string, line: number) => {
    if (!directory) return;
    const resolved = resolveGraphFile({ snapshotRoot, projectRoot: directory, file });
    if (!resolved.ok) {
      // A refusal is stated, never papered over by opening a lookalike file.
      setSourceError(`${resolved.reason}: ${file}`);
      return;
    }
    setSourceError(null);
    useUIStore.getState().openContextFileAtLine(directory, resolved.path, line);
    // The join above is correct by construction; this probe adds what it cannot
    // know — whether the file still exists at that path, and whether the index
    // is stale — so a vanished file reads as such instead of as a broken graph.
    void (async () => {
      try {
        const answer = await resolveCodeGraphFile(directory, file);
        if (!answer.ok && answer.reason !== undefined && answer.reason.length > 0) {
          setSourceError(`${answer.reason}: ${file}`);
        }
      } catch {
        // The probe is advisory: the editor has already been asked to open.
      }
    })();
  }, [directory, snapshotRoot]);

  // The toolbar owns kind/edge/confidence filtering; the panel only applies
  // it. Symbol granularity follows the file/symbol split the topology
  // carries, edges follow their lowercase group, and confidence is a floor.
  const showSymbols = filters.kinds.some((kind) => kind !== 'file');
  const showFiles = filters.kinds.includes('file');
  const enabledEdgeGroups = React.useMemo(() => new Set(filters.edgeKinds), [filters.edgeKinds]);
  const minConfidence = filters.minConfidence;
  const filteredGraph = React.useMemo(() => {
    if (!activeGraph) return null;
    const kept = new Set<string>();
    for (const node of activeGraph.nodes) {
      if (node.id === activeGraph.subjectId) kept.add(node.id);
      else if (node.kind === 'file' ? showFiles : showSymbols) kept.add(node.id);
    }
    return {
      ...activeGraph,
      nodes: activeGraph.nodes.filter((node) => kept.has(node.id)),
      edges: activeGraph.edges.filter((edge) => {
        const group = edgeGroupOfKind(edge.kind);
        return (group === null || enabledEdgeGroups.has(group))
          && edge.confidence >= minConfidence
          && kept.has(edge.from)
          && kept.has(edge.to);
      }),
    };
  }, [activeGraph, showSymbols, showFiles, enabledEdgeGroups, minConfidence]);

  // Impact rows: every dependent the raw runs knew, de-duplicated by id.
  // Counts come from the aggregate summary and shownOf below, never from
  // this list's length.
  const impactRows = React.useMemo(() => {
    const seen = new Set<string>();
    const out: CodeGraphItem[] = [];
    for (const run of impactRuns) {
      for (const item of run.answer.impacted) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
    }
    return out;
  }, [impactRuns]);
  // Row totals for the impact answer: "showing N of M" from shownOf or
  // the engine totals while rows are hidden, and the not-available text
  // when the server reports no known total. Never a list length.
  const impactTotalsText: string | null = React.useMemo(() => {
    if (!impactAggregate) return null;
    const shown = impactAggregate.shownOf?.impacted;
    const displayed = impactAggregate.totals?.displayed ?? shown?.shown ?? null;
    const known = impactAggregate.totals?.known ?? shown?.total ?? null;
    if (known === null) return t('codeGraph.toolbar.totalsUnknown');
    if (displayed === null || known - displayed <= 0) return null;
    return t('codeGraph.toolbar.totalsShowing', { displayed, known });
  }, [impactAggregate, t]);
  const hasSubject = selectedId !== null || detail !== null || fileDetail !== null;
  // A preview has a graph but no selection: the inspector opens for a real
  // selection only, so a new search never leaves the previous subject's
  // inspector (or its "Selected node" heading) on screen.


  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || globalThis.ResizeObserver === undefined) return undefined;
    const measure = (width: number) => {
      setWide(width >= WIDE_WORKSPACE_PX);
      setContainerWidth(width);
    };
    measure(root.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // The layout decides the default, the user decides the rest.
  React.useEffect(() => {
    setInspectorOpen(wide);
  }, [wide]);

  const restoredKeyRef = React.useRef<string | null>(null);
  const pendingRestoreRef = React.useRef<string | null>(null);
  const hydratedRef = React.useRef(false);

  // The tab restores what it was showing for this project. An id the snapshot no
  // longer contains is dropped rather than pointed at a stranger with the same name.
  React.useEffect(() => {
    const key = String(directory ?? '').trim();
    // Restore only once the snapshot binding is known: the saved id has to be
    // checked against this snapshot, not against a guess.
    if (!key || !index || restoredKeyRef.current === key) return;
    // Never restore against an index that is still building: the empty answer
    // would consume the pending selection with nothing to find, and the mark
    // below would block the retry. The build poller refreshes the index, so
    // this effect reruns and the restore fires on the first ready generation.
    if (index.ready === false) return;
    restoredKeyRef.current = key;
    const saved = useUIStore.getState().codeGraphStateByDirectory[key];
    if (!saved) {
      hydratedRef.current = true;
      return;
    }
    // SAFETY: persisted tab state predates the mode union; an unknown mode falls back when the next query runs.
    setMode(saved.mode as CodeGraphMode);
    pendingRestoreRef.current = saved.selectedId;
    if (saved.query) {
      setSearchText(saved.query);
      void runSearch(saved.query, 'symbols', false, trackPending(new AbortController()), depthRef.current);
    }
    hydratedRef.current = true;
  }, [directory, index, runSearch, trackPending]);

  React.useEffect(() => {
    const target = pendingRestoreRef.current;
    if (!target || !search) return;
    pendingRestoreRef.current = null;
    const found = search.items.find((item) => item.id === target);
    if (!found) return;
    setMode(modeForPickedId(found.id));
    void selectItem(found, false, trackPending(new AbortController()), depthRef.current);
  }, [search, selectItem, trackPending]);

  React.useEffect(() => {
    const key = String(directory ?? '').trim();
    if (!key || !hydratedRef.current) return;
    useUIStore.getState().setCodeGraphState(key, { mode, query: committedQuery, selectedId });
  }, [directory, mode, committedQuery, selectedId]);

  // A rebuilt index rekeys the answer cache, so rows from the previous
  // generation are never served for the new one.
  React.useEffect(() => {
    const revision = index?.revision ?? null;
    if (revision !== revisionRef.current) {
      revisionRef.current = revision;
      cacheEpochRef.current += 1;
      answerCacheRef.current.clear();
      rawCacheRef.current.clear();
      rawInflightRef.current.clear();
    }
  }, [index?.revision]);

  // Default subject: with no explicit selection yet, the resolved subject
  // becomes the panel subject on mount and on directory change. An explicit
  // selection (or a restorable saved query, or a focused file) always wins:
  // every user-driven loader marks explicitRef, and this effect never runs
  // then. A changed resolver answer re-adopts; an unchanged one keeps the
  // viewport and selection because the adopted key matches.
  React.useEffect(() => {
    if (!directory || focusFile) return undefined;
    if (explicitRef.current || selectedId !== null || committedQuery !== null || subjectLoading) return undefined;
    const saved = useUIStore.getState().codeGraphStateByDirectory[String(directory).trim()];
    if (saved?.query) return undefined;
    const key = `${directory}|${defaultSubject.source}|${defaultSubject.file ?? defaultSubject.files[0] ?? ''}`;
    if (adoptedRef.current?.key === key) return undefined;
    adoptedRef.current = { key, subject: defaultSubject };
    // The module map needs no subject query: the explore effect owns that
    // load, and the module map below renders from its answer.
    if (defaultSubject.source === 'module-map') return undefined;
    const controller = new AbortController();
    const signal = trackPending(controller);
    void adoptDefaultSubject(false, signal, defaultSubject, depthRef.current);
    return () => controller.abort();
  }, [directory, focusFile, defaultSubject, subjectLoading, selectedId, committedQuery, adoptDefaultSubject, trackPending]);

  const activeAnswer = detail ?? fileDetail ?? search ?? explore ?? impactAggregate ?? trail ?? null;

  const toolbarSubject: CodeGraphToolbarSubject | null = React.useMemo(() => {
    if (!directory) return null;
    if (selectedId !== null) {
      // The resolver owns the source vocabulary: an explicit selection
      // classifies as the manual source, never overwritten by the default.
      const kind = selectedId.startsWith('file:') ? 'file' : 'symbol';
      const node = activeGraph?.nodes.find((entry) => entry.id === selectedId);
      const label = kind === 'file'
        ? (node?.file ?? selectedId.slice('file:'.length))
        : (node?.name ?? selectedId);
      const source = resolveCodeGraphSubject(
        { activeFile: null, changedFiles: [], moduleCount: null, manual: { id: selectedId, label, kind } },
        directory,
      ).source;
      return { id: selectedId, label, kind, source };
    }
    // A committed search replaces the subject context; the chip returns when
    // the search is cleared.
    if (committedQuery !== null) return null;
    if (defaultSubject.source === 'active-file' && defaultSubject.file) {
      return { id: `file:${defaultSubject.file}`, label: defaultSubject.file, kind: 'file', source: 'active-file' };
    }
    const firstChange = defaultSubject.source === 'changes'
      ? (defaultSubject.files[0] ?? defaultSubject.file)
      : null;
    if (firstChange) {
      return { id: `file:${firstChange}`, label: firstChange, kind: 'file', source: 'changes' };
    }
    return { id: 'module-map', label: moduleOpen ?? t('codeGraph.explore.title'), kind: 'file', source: 'module-map' };
  }, [directory, selectedId, committedQuery, defaultSubject, activeGraph, moduleOpen, t]);

  // Totals come from the server answer, never from a shortened list. An
  // answer without totals renders no total rather than an invented one.
  const toolbarTotals: CodeGraphToolbarTotals | null = React.useMemo(() => {
    if (activeAnswer === null) return null;
    // Raw answers carry the engine's displayed/known/hidden totals plus
    // per-list shownOf; both are server fields, never list lengths.
    if (activeAnswer === impactAggregate && impactAggregate) {
      const shown = impactAggregate.shownOf?.impacted;
      const displayed = impactAggregate.totals?.displayed ?? shown?.shown ?? null;
      const known = impactAggregate.totals?.known ?? shown?.total ?? null;
      if (displayed === null || known === null) {
        if (known === null && displayed !== null) return { displayed, known, hidden: null };
        return null;
      }
      return { displayed, known, hidden: Math.max(0, known - displayed) };
    }
    if (activeAnswer === trail && trail) {
      const known = trail.totals?.known ?? null;
      return { displayed: trail.path.length, known, hidden: known === null ? null : Math.max(0, known - trail.path.length) };
    }
    const totals = activeAnswer.totals;
    if (!totals) return null;
    let displayed = 0;
    let known: number | null = null;
    if (activeAnswer === detail || activeAnswer === fileDetail) {
      displayed = activeAnswer.graph?.nodes.length ?? activeAnswer.items.length;
      known = totals.known ?? null;
    } else if (activeAnswer === search) {
      if (committedScope === 'content') {
        displayed = activeAnswer.contentItems?.length ?? 0;
        known = totals.known ?? null;
      } else {
        displayed = activeAnswer.items.length;
        known = totals.known ?? null;
      }
    } else if (activeAnswer === explore) {
      displayed = activeAnswer.modules?.length ?? 0;
      known = totals.known ?? null;
    } else if (activeAnswer === trail) {
      // Handled above from the raw trace answer; unreachable here.
      return null;
    }
    return { displayed, known, hidden: known === null ? null : Math.max(0, known - displayed) };
  }, [activeAnswer, committedScope, detail, fileDetail, search, explore, trail, impactAggregate]);

  const toolbarCompleteness: CodeGraphToolbarCompleteness | null = React.useMemo(() => {
    const completeness = activeAnswer?.completeness;
    if (completeness === 'complete' || completeness === 'partial' || completeness === 'truncated') return completeness;
    if (activeAnswer?.truncated === true) return 'truncated';
    return null;
  }, [activeAnswer]);

  const toolbarBusy = indexLoading || searchLoading || detailLoading || exploreLoading || trailLoading || impactRunsLoading;

  // Module-map files ride from the explore answer's sample symbols: the
  // panel groups them per module instead of inventing a file list.
  const filesByModule = React.useMemo<Record<string, Array<{ file: string; isTest?: boolean }>>>(() => {
    const out: Record<string, Array<{ file: string; isTest?: boolean }>> = {};
    for (const module of explore?.modules ?? []) {
      const seen = new Set<string>();
      const rows: Array<{ file: string; isTest?: boolean }> = [];
      for (const sample of module.sampleSymbols ?? []) {
        if (seen.has(sample.file)) continue;
        seen.add(sample.file);
        rows.push({ file: sample.file, isTest: isTestPath(sample.file) });
      }
      out[module.name] = rows;
    }
    return out;
  }, [explore]);

  const handleFocusModule = React.useCallback((name: string) => {
    if (!directory) return;
    setModuleOpen(name);
    const first = explore?.modules?.find((module) => module.name === name)?.sampleSymbols?.[0];
    if (!first) return;
    const focusItem: CodeGraphItem = {
      id: first.id,
      file: first.file,
      line: first.line ?? 1,
      evidence: [],
      confidence: 1,
      knowledgeIds: [],
    };
    if (first.name) focusItem.name = first.name;
    void selectItem(
      focusItem,
      false,
      trackPending(new AbortController()),
      depthRef.current,
    );
  }, [directory, explore, selectItem, trackPending]);

  const handleSelectModuleFile = React.useCallback((file: string) => {
    if (!directory) return;
    void selectItem(
      { id: `file:${file}`, file, line: 1, evidence: [], confidence: 1, knowledgeIds: [] },
      false,
      trackPending(new AbortController()),
      depthRef.current,
    );
  }, [directory, selectItem, trackPending]);

  // Below 900px the inspector is an overlay drawer, never a split pane, so the
  // graph keeps its full width on narrow containers.
  const inspectorOverlay = containerWidth < 900;
  const splitInspector = selection !== null && !inspectorOverlay;
  const userOpenedInspectorRef = React.useRef(false);
  // A panel narrower than the split threshold cannot host the inspector beside
  // the canvas: an open inspector covers the drawing area (measured at 340 px of
  // a 565 px canvas, with the drawn nodes underneath). A selection only opens it
  // in split mode, and a panel that settles narrow closes it again — unless the
  // person opens it themselves, which stays their call.
  React.useEffect(() => {
    if (containerWidth > 0 && containerWidth < 900 && !userOpenedInspectorRef.current) {
      setInspectorOpen(false);
    }
  }, [containerWidth, selection]);
  const gridStyle = wide
    ? {
      gridTemplateColumns: splitInspector
        ? `minmax(200px, 250px) minmax(0, 1fr) ${inspectorWidth}px`
        : 'minmax(200px, 250px) minmax(0, 1fr)',
    }
    : undefined;

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3"
      data-testid="code-graph-workspace"
      data-layout={wide ? 'wide' : 'stacked'}
    >
      <div className="flex items-center gap-2">
        <Icon name="flow-chart" className="size-4 shrink-0" />
        <h2 className="typography-ui-header flex-1 text-foreground">{t('codeGraph.rail.label')}</h2>
        {indexLoading ? <Spinner aria-hidden /> : null}
        <Button variant="outline" size="sm" type="button" onClick={onRefresh} disabled={indexLoading || !directory}>
          {t('codeGraph.refresh')}
        </Button>
      </div>
      {directory ? (
        <CodeGraphToolbar
          directory={directory}
          subject={toolbarSubject}
          mode={mode}
          depth={depth}
          search={searchText}
          scope={searchScope}
          filters={filters}
          totals={toolbarTotals}
          completeness={toolbarCompleteness}
          busy={toolbarBusy}
          onModeChange={handleModeChange}
          onDepthChange={handleDepthChange}
          onSearchSubmit={handleSearchSubmit}
          onScopeChange={handleScopeChange}
          onFiltersChange={handleFiltersChange}
          onRefresh={onRefresh}
          onFit={handleFit}
          onReset={handleResetView}
        />
      ) : null}

      {indexError ? (
        <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-3">
          <p className="typography-ui text-[var(--status-error)]">{t('codeGraph.state.error')}</p>
          <p className="typography-micro mt-1 break-words text-[var(--status-error)]">{indexError}</p>
          <Button variant="outline" size="sm" type="button" className="mt-2" onClick={onRefresh}>
            {t('codeGraph.retry')}
          </Button>
        </div>
      ) : null}

      {indexBuilding || indexEnded ? (
        <div
          className={cn(
            'rounded-md border p-3',
            indexEnded
              ? 'border-[var(--status-error-border)] bg-[var(--status-error-background)]'
              : 'border-[var(--status-info-border)] bg-[var(--status-info-background)]',
          )}
          data-code-graph-index-state={indexStateName}
        >
          <p className="typography-ui text-foreground">{indexProgressLabel}</p>
          {index.indexState?.error ? (
            <p className="typography-micro mt-1 break-words text-[var(--status-error)]">{index.indexState.error}</p>
          ) : null}
          <div className="mt-2 flex gap-2">
            {indexBuilding ? (
              <Button variant="outline" size="sm" type="button" onClick={cancelIndexing}>
                {t('codeGraph.index.cancel')}
              </Button>
            ) : (
              <Button variant="outline" size="sm" type="button" onClick={onRefresh}>
                {t('codeGraph.retry')}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {showStaleBanner && index && index.ready !== false ? (
        <div className="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] p-3">
          <p className="typography-ui text-[var(--status-warning)]">
            {t('codeGraph.freshness.stale')}
            {index.staleReason ? ` · ${index.staleReason}` : ''}
            {revisionMismatch && committedRevision ? ` · ${committedRevision.slice(0, 8)}` : ''}
          </p>
          {index.refreshError ? (
            <p className="typography-micro mt-1 break-words text-[var(--status-warning)]">{index.refreshError}</p>
          ) : null}
          <Button variant="outline" size="sm" type="button" className="mt-2" onClick={onRefresh}>
            {t('codeGraph.refresh')}
          </Button>
        </div>
      ) : null}

      {index && index.ready !== false ? (
        <p className="typography-micro text-muted-foreground">
          <span className={cn(
            'me-2 inline-block rounded px-1.5 py-0.5',
            effectiveFreshness === 'fresh'
              ? 'bg-[var(--status-success-background)] text-[var(--status-success)]'
              : 'bg-[var(--status-warning-background)] text-[var(--status-warning)]',
          )}>
            {effectiveFreshness === 'fresh' ? t('codeGraph.freshness.fresh') : t('codeGraph.freshness.stale')}
          </span>
          {index.nodeCount} / {index.edgeCount} · {(index.revision ?? '').slice(0, 8)}
        </p>
      ) : null}

      <div
        data-testid="code-graph-regions"
        data-regions={wide ? 'three' : 'stacked'}
        className={wide ? 'relative grid min-h-0 flex-1 gap-3' : 'relative flex shrink-0 flex-col gap-3'}
        style={gridStyle}
      >
        <aside
          aria-label={t('codeGraph.section.matches')}
          className="flex min-h-0 min-w-0 shrink-0 flex-col gap-2"
          data-region="explorer"
        >
          {searchLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner aria-hidden />
            </div>
          ) : null}

          {searchError ? (
            <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-3">
              <p className="typography-ui text-[var(--status-error)]">{t('codeGraph.state.error')}</p>
              <p className="typography-micro mt-1 break-words text-[var(--status-error)]">{searchError}</p>
              <Button variant="outline" size="sm" type="button" className="mt-2" onClick={retrySearch}>
                {t('codeGraph.retry')}
              </Button>
            </div>
          ) : null}

          {search && !searchError ? <SearchState result={search} /> : null}
          {search && !searchError && (search.indexTruncated === true || (search.excludedCount ?? 0) > 0) ? (
            <p className="typography-micro text-muted-foreground" data-testid="code-graph-coverage-note">
              {(() => {
                const note = search.unresolved.find((line) => line.includes('exclud') || line.includes('incomplete'));
                if (note) return note;
                return `${search.excludedCount ?? 0} ${t('codeGraph.explorer.files')}`;
              })()}
            </p>
          ) : null}

          {mode === 'explore' ? (
            <section aria-label={t('codeGraph.explore.title')} className="flex flex-col gap-1">
              <SectionTitle>{t('codeGraph.explore.title')}</SectionTitle>
              <p className="typography-micro text-muted-foreground">{t('codeGraph.explore.hint')}</p>
              {exploreLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner aria-hidden />
                </div>
              ) : null}
              {exploreError ? (
                <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-3">
                  <p className="typography-ui text-[var(--status-error)]">{t('codeGraph.state.error')}</p>
                  <p className="typography-micro mt-1 break-words text-[var(--status-error)]">{exploreError}</p>
                </div>
              ) : null}
              {!exploreLoading && exploreError === null && explore ? (
                <CodeGraphModuleMap
                  modules={explore.modules ?? []}
                  expanded={moduleOpen}
                  onToggle={(name) => setModuleOpen((current) => (current === name ? null : name))}
                  onFocusModule={handleFocusModule}
                  onSelectFile={handleSelectModuleFile}
                  filesByModule={filesByModule}
                />
              ) : null}
              {index?.indexState?.partial?.modules?.length ? (
                <div className="rounded-md border border-border p-2" data-testid="code-graph-partial-modules">
                  <p className="typography-micro text-muted-foreground">
                    {t('codeGraph.toolbar.completenessPartial')} — {index.indexState.partial.nodes ?? 0} nodes
                    {(index.indexState.partial.modulesTotal ?? 0) > (index.indexState.partial.modules?.length ?? 0)
                      ? ` · ${index.indexState.partial.modulesTotal} modules`
                      : ''}
                  </p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {index.indexState.partial.modules.map((entry) => (
                      <li key={entry.module} className="flex items-center justify-between gap-2 typography-micro">
                        <span className="truncate">{entry.module}</span>
                        <span className="text-muted-foreground">{entry.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {search && (committedScope === 'symbols' ? search.items.length > 0 : (search.contentItems ?? []).length > 0) ? (
            <section className="rounded-md border border-border p-2" aria-label={t('codeGraph.section.matches')}>
              <p className="typography-ui font-medium" data-testid="code-graph-matches-heading">
                {t('codeGraph.section.matches')}
                {committedQuery !== null && committedQuery !== '' ? ` · "${committedQuery}"` : ''}
                {` (${committedScope === 'content' ? (search.contentItems ?? []).length : rankedMatches.length})`}
              </p>
              {committedScope === 'symbols' ? (
                <React.Fragment>
              {hasAmbiguousNames(search.items) ? (
                <p className="code-graph-ambiguous typography-micro mt-1 text-muted-foreground">
                  {t('codeGraph.results.ambiguous')}
                </p>
              ) : null}
              <label className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showTestMatches}
                  onChange={(event) => setShowTestMatches(event.target.checked)}
                  data-testid="code-graph-show-tests"
                />
                <span className="typography-micro">
                  {t('codeGraph.explorer.tests')}
                  {hiddenTestCount > 0 ? ` (${hiddenTestCount})` : ''}
                </span>
              </label>
              <ul className="mt-1 flex flex-col gap-1">
                {rankedMatches.slice(0, matchWindow).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setMode(modeForPickedId(item.id));
                        void selectItem(item, false, trackPending(new AbortController()), depthRef.current);
                      }}
                      aria-pressed={selectedId === item.id}
                      data-testid={`code-graph-match-${item.id}`}
                      className={cn(
                        'flex w-full flex-col items-stretch gap-0.5 rounded-md px-2 py-1.5 text-start',
                        selectedId === item.id ? 'bg-interactive-selection text-interactive-selection-foreground' : 'hover:bg-interactive-hover',
                      )}
                    >
                      <span className="typography-ui w-full truncate text-start">{item.name ?? item.id}</span>
                      <span className="typography-micro w-full truncate text-start text-muted-foreground">
                        {`${item.id.startsWith('file:') ? t('codeGraph.explorer.files') : t('codeGraph.explorer.symbols')} · ${displayPath(item.file)}:${item.line}`}
                      </span>
                      {item.reason ? (
                        <span className="typography-micro w-fit rounded border border-[var(--surface-border)] px-1 text-muted-foreground" data-testid={`code-graph-match-reason-${item.id}`}>
                          {item.reason}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
              {rankedMatches.length > matchWindow ? (
                <div className="mt-1 flex items-center justify-between gap-2" data-testid="code-graph-matches-more">
                  <span className="typography-micro text-muted-foreground" data-testid="code-graph-matches-count">{`${matchWindow} / ${rankedMatches.length}${search?.truncated ? '+' : ''}`}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => setMatchWindow((current) => current + SEARCH_PAGE_SIZE)}
                  >
                    {t('codeGraph.results.loadMore')}
                  </Button>
                </div>
              ) : null}
                </React.Fragment>
              ) : (
                <React.Fragment>
              <ul className="mt-1 flex flex-col gap-1">
                {(search.contentItems ?? []).slice(0, matchWindow).map((row, rowIndex) => (
                  <li key={`${row.file}:${row.line}:${rowIndex}`}>
                    <button
                      type="button"
                      onClick={() => openSourceAt(row.file, row.line)}
                      data-testid={`code-graph-content-row-${row.file}:${row.line}`}
                      className="flex w-full flex-col items-stretch gap-0.5 rounded-md px-2 py-1.5 text-start hover:bg-interactive-hover"
                    >
                      <span className="typography-ui w-full truncate text-start">{`${displayPath(row.file)}:${row.line}`}</span>
                      <span className="typography-micro w-full break-words text-start text-muted-foreground">
                        {row.excerpt}
                      </span>
                      <span className="typography-micro w-fit rounded border border-[var(--surface-border)] px-1 text-muted-foreground" data-testid={`code-graph-content-reason-${row.file}:${row.line}`}>
                        {row.reason}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {(search.contentItems ?? []).length > matchWindow ? (
                <div className="mt-1 flex items-center justify-between gap-2" data-testid="code-graph-matches-more">
                  <span className="typography-micro text-muted-foreground" data-testid="code-graph-matches-count">{`${matchWindow} / ${(search.contentItems ?? []).length}${search?.truncated ? '+' : ''}`}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => setMatchWindow((current) => current + SEARCH_PAGE_SIZE)}
                  >
                    {t('codeGraph.results.loadMore')}
                  </Button>
                </div>
              ) : null}
                </React.Fragment>
              )}
            </section>
          ) : null}
        </aside>

        <section
          aria-label={t('codeGraph.section.graph')}
          className="relative flex min-h-0 min-w-0 flex-col gap-2"
          data-region="graph"
        >
          {(activeAnswer?.completeness === 'partial' || activeAnswer?.completeness === 'truncated') && activeAnswer ? (
            <div data-testid="code-graph-coverage-banner" className="rounded-md bg-[var(--status-warning-background)] px-2 py-1">
              <p className="typography-micro text-[var(--status-warning)]">
                {t(activeAnswer.completeness === 'truncated' ? 'codeGraph.toolbar.completenessTruncated' : 'codeGraph.toolbar.completenessPartial')}
                {activeAnswer.completenessReason
                  ? ` · ${t(completenessReasonKey(activeAnswer.completenessReason))}`
                  : ''}
                {toolbarTotals && toolbarTotals.known !== null
                  ? ` · ${t('codeGraph.toolbar.totalsShowing', { displayed: toolbarTotals.displayed, known: toolbarTotals.known })}`
                  : ''}
              </p>
            </div>
          ) : null}
          {filteredGraph ? (
            <div
              key={viewEpoch}
              data-testid="code-graph-canvas-wrap"
              onClick={(event) => {
                // An empty-canvas click clears the selection; node and edge
                // picks stop at their own controls and never reach here.
                if (selection === null && selectedEdge === null) return;
                const target = event.target;
                if (target instanceof Element && target.closest('button, path, input')) return;
                clearSelection();
              }}
              className={wide ? 'flex min-h-[360px] flex-1 flex-col' : 'flex h-[320px] shrink-0 flex-col'}>
              <CodeGraphCanvas
                graph={filteredGraph}
                selectedId={selectedId}
                onSelect={selectGraphNode}
                selectedEdge={selectedEdge}
                onSelectEdge={handleSelectEdge}
                preview={showingPreview}
                previewLabel={t('codeGraph.graph.preview')}
                truncatedLabel={t('codeGraph.graph.truncated')}
                edgesLabel={t('codeGraph.graph.edges')}
              />
            </div>
          ) : (
            <div className="flex min-h-64 items-center justify-center rounded-md border border-[var(--surface-border)] p-3">
              {(detailLoading || searchLoading) ? (
                <Spinner aria-hidden />
              ) : subjectAnswered && subjectIndexed ? (
                <p className="typography-micro text-center text-muted-foreground">{t('codeGraph.graph.empty')}</p>
              ) : search && committedScope === 'symbols' && search.items.length > 0 ? (
                <p className="typography-micro text-center text-muted-foreground">{t('codeGraph.graph.selectPrompt')}</p>
              ) : (
                <p className="typography-micro text-center text-muted-foreground">{t('codeGraph.graph.idle')}</p>
              )}
            </div>
          )}

          {filteredGraph ? <CodeGraphLegend /> : null}
          {mode === 'trace' ? (
            <section aria-label={t('codeGraph.mode.trace')} className="flex flex-col gap-1">
              <SectionTitle>{t('codeGraph.trace.path')}</SectionTitle>
              <div data-testid="code-graph-trace-endpoints" className="flex flex-col gap-0.5">
                <p dir="ltr" className="typography-micro truncate text-start text-muted-foreground" data-testid="code-graph-trace-from">{`A · ${traceFrom ?? '—'}`}</p>
                <p dir="ltr" className="typography-micro truncate text-start text-muted-foreground" data-testid="code-graph-trace-to">{`B · ${traceTo ?? '—'}`}</p>
              </div>
              {trailLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner aria-hidden />
                </div>
              ) : null}
              {trailError ? (
                <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-3">
                  <p className="typography-ui text-[var(--status-error)]">{t('codeGraph.state.error')}</p>
                  <p className="typography-micro mt-1 break-words text-[var(--status-error)]">{trailError}</p>
                </div>
              ) : null}
              {trail && traceFrom !== null && traceTo !== null ? (
                <React.Fragment>
                  {trail.summary ? (
                    <div data-testid="code-graph-trace-summary" className="flex flex-col gap-0.5">
                      <p dir="ltr" className="typography-micro break-words text-muted-foreground">
                        {`${String(trail.summary.found)} · ${trail.summary.hops ?? '—'} · ${trail.summary.alternativePaths ?? '—'}${trail.summary.reason ? ` · ${trail.summary.reason}` : ''}`}
                      </p>
                    </div>
                  ) : null}
                  {trail.summary && !trail.summary.found ? (
                    <p className="typography-micro break-words text-muted-foreground" data-testid="code-graph-trace-reason">
                      {trail.summary.reason ?? trail.unresolved[0] ?? t('codeGraph.trace.none')}
                    </p>
                  ) : null}
                  {(!trail.summary || trail.summary.found) && trail.path.length > 0 ? (
                    <div className="flex flex-col gap-0.5" data-testid="code-graph-trail-steps">
                      {trail.path.map((step, stepIndex) => (
                        <p key={`${step.from}-${step.to}-${stepIndex}`} dir="ltr" className="typography-micro break-words text-muted-foreground">
                          {`${step.from} → ${step.to} · ${step.ref} · ${step.confidence.toFixed(2)}`}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {[...trail.unsupported, ...trail.unresolved].map((note) => (
                    <p key={note} className="typography-micro break-words text-muted-foreground">{note}</p>
                  ))}
                </React.Fragment>
              ) : null}
            </section>
          ) : null}

          {mode === 'impact' && hasSubject ? (
            <section aria-label={t('codeGraph.mode.impact')} className="flex flex-col gap-1">
              <SectionTitle>{t('codeGraph.mode.impact')}</SectionTitle>
              {impactRunsLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner aria-hidden />
                </div>
              ) : null}
              {impactRunsError ? (
                <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-3">
                  <p className="typography-ui text-[var(--status-error)]">{t('codeGraph.state.error')}</p>
                  <p className="typography-micro mt-1 break-words text-[var(--status-error)]">{impactRunsError}</p>
                </div>
              ) : null}
              {!impactRunsLoading && !impactRunsError && impactAggregate?.summary ? (
                <div className="flex flex-col gap-0.5" data-testid="code-graph-impact-summary">
                  {/* Wished i18n key: codeGraph.impact.potentialOnly. No new keys
                      may be added, so the mandated "potential impact" wording
                      renders literally beside the closest existing key. */}
                  <p className="typography-micro text-muted-foreground">{`${t('codeGraph.section.impact')} · potential impact`}</p>
                  {impactAggregate.summary.dependentFiles !== null ? (
                    <p dir="ltr" className="typography-micro break-words text-muted-foreground">{`${t('codeGraph.explorer.files')} · ${impactAggregate.summary.dependentFiles}`}</p>
                  ) : null}
                  {impactAggregate.summary.modules.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      <p className="typography-micro text-muted-foreground">{t('codeGraph.explore.title')}</p>
                      <ul className="flex flex-col gap-0.5">
                        {impactAggregate.summary.modules.map((entry) => (
                          <li key={entry.module} dir="ltr" className="typography-micro break-words text-muted-foreground">
                            {`${entry.module} · ${entry.count}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {impactAggregate.summary.testsFound !== null ? (
                    <p dir="ltr" className="typography-micro break-words text-muted-foreground">{`${t('codeGraph.explorer.tests')} · ${impactAggregate.summary.testsFound}`}</p>
                  ) : null}
                  {/* Wished i18n key: codeGraph.impact.noTestPath. Rendered
                      literally per the mandated wording (never "Untested"). */}
                  {impactAggregate.summary.testsFound === 0 ? (
                    <p className="typography-micro break-words text-muted-foreground">No test path identified in the current graph</p>
                  ) : null}
                  {impactAggregate.summary.callersWithoutTestPath !== null ? (
                    <p dir="ltr" className="typography-micro break-words text-muted-foreground">{`${t('codeGraph.section.callers')} · ${impactAggregate.summary.callersWithoutTestPath}`}</p>
                  ) : null}
                  {impactAggregate.summary.unresolvedEdges !== null ? (
                    <p dir="ltr" className="typography-micro break-words text-muted-foreground">{`${t('codeGraph.legend.unresolved')} · ${impactAggregate.summary.unresolvedEdges}`}</p>
                  ) : null}
                  {impactAggregate.summary.completeness !== null ? (
                    <p dir="ltr" className="typography-micro break-words text-muted-foreground">{impactAggregate.summary.completeness}</p>
                  ) : null}
                </div>
              ) : null}
              {!impactRunsLoading && !impactRunsError && !impactAggregate ? (
                <p className="typography-micro text-muted-foreground">{t('codeGraph.impact.none')}</p>
              ) : null}
              {impactRows.length > 0 ? (
                <ul className="flex flex-col gap-0.5" data-testid="code-graph-impact-rows">
                  {impactRows.map((entry) => (
                    <li key={entry.id} dir="ltr" className="typography-micro break-words text-muted-foreground">
                      {`${entry.id} · ${displayPath(entry.file)}:${entry.line}`}
                    </li>
                  ))}
                </ul>
              ) : null}
              {impactAggregate && !impactRunsLoading && !impactRunsError && impactTotalsText ? (
                <p className="typography-micro text-muted-foreground" data-testid="code-graph-impact-totals">{impactTotalsText}</p>
              ) : null}
              {impactAggregate ? [...impactAggregate.unsupported, ...impactAggregate.unresolved].map((note) => (
                <p key={note} className="typography-micro break-words text-muted-foreground">{note}</p>
              )) : null}
              {subjectChangeFiles.length > 0 ? (
                <div className="flex flex-col gap-0.5" data-testid="code-graph-change-subjects">
                  <p className="typography-micro text-muted-foreground">{t('codeGraph.toolbar.subjectChanges')}</p>
                  <ul className="flex flex-col gap-0.5">
                    {subjectChangeFiles.map((file) => (
                      <li key={file}>
                        <button
                          type="button"
                          data-testid={`code-graph-open-change-${file}`}
                          onClick={() => openSourceAt(file, 1)}
                          className="typography-micro w-full break-words text-start text-muted-foreground hover:underline"
                        >
                          {file}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {peek !== null ? (
            <section aria-label={t('codeGraph.section.file')} className="flex flex-col gap-1">
              <SectionTitle>{`${displayPath(peek.file)}:${peek.line}`}</SectionTitle>
              {peek.loading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner aria-hidden />
                </div>
              ) : peek.error ? (
                <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-3">
                  <p className="typography-ui text-[var(--status-error)]">{t('codeGraph.state.error')}</p>
                  <p className="typography-micro mt-1 break-words text-[var(--status-error)]">{peek.error}</p>
                </div>
              ) : (
                <pre className="typography-micro max-h-64 overflow-auto rounded-md border border-border p-2 text-foreground" data-testid="code-graph-peek-text">{peek.text ?? ''}</pre>
              )}
            </section>
          ) : null}

          <div className="flex flex-col gap-1">
            {detail ? <SymbolDetail context={detail} impact={impactDetail} roots={pathRoots} /> : null}
            {fileDetail ? <FileDetail result={fileDetail} roots={pathRoots} /> : null}
          </div>

          {detailLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner aria-hidden />
            </div>
          ) : null}

          {detailError ? (
            <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-3">
              <p className="typography-ui text-[var(--status-error)]">{t('codeGraph.state.error')}</p>
              <p className="typography-micro mt-1 break-words text-[var(--status-error)]">{detailError}</p>
            </div>
          ) : null}
        </section>

        {selection !== null ? (
          <React.Fragment>
            {inspectorOverlay ? (
              <div
                data-testid="code-graph-inspector-backdrop"
                aria-hidden="true"
                onClick={clearSelection}
                className="absolute inset-0 z-10"
              />
            ) : null}
          <aside
            aria-label={t('codeGraph.inspector.title')}
            className={inspectorOverlay
              ? 'absolute end-0 top-0 z-20 flex h-full w-[min(340px,92%)] min-w-0 flex-col'
              : 'relative flex min-w-0 flex-col gap-1'}
            data-region="inspector"
            data-inspector-layout={inspectorOverlay ? 'overlay' : 'split'}
          >
            {!inspectorOverlay && wide ? (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t('codeGraph.inspector.title')}
                className="absolute -start-2 top-0 h-full w-1.5 cursor-col-resize rounded bg-transparent hover:bg-[var(--surface-border)]"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  inspectorDragRef.current = { startX: event.clientX, base: inspectorWidth };
                }}
                onPointerMove={(event) => {
                  const drag = inspectorDragRef.current;
                  if (!drag) return;
                  const next = drag.base - (event.clientX - drag.startX);
                  setInspectorWidth(Math.min(520, Math.max(220, next)));
                }}
                onPointerUp={() => { inspectorDragRef.current = null; }}
                onPointerCancel={() => { inspectorDragRef.current = null; }}
              />
            ) : null}
            <details
              open={inspectorOpen}
              onToggle={(event) => {
                userOpenedInspectorRef.current = event.currentTarget.open;
                setInspectorOpen(event.currentTarget.open);
              }}
              className={inspectorOverlay
                ? 'max-h-full overflow-y-auto rounded-md border border-border bg-[var(--surface-raised)] p-2 shadow-lg'
                : 'rounded-md border border-border p-2'}
            >
              <summary className="typography-ui cursor-pointer font-medium" data-testid="code-graph-inspector-toggle">{t('codeGraph.inspector.title')}</summary>
              <CodeGraphInspector
                selection={selection}
                node={inspectorNodeData}
                edge={inspectorEdgeData}
                onTraceFrom={handleInspectorTraceFrom}
                onTraceTo={handleInspectorTraceTo}
                onImpact={handleInspectorImpact}
                onOpenSource={openSourceAt}
                onPeek={handlePeek}
                onClose={clearSelection}
                sourceError={sourceError}
              />
            </details>
          </aside>
          </React.Fragment>
        ) : null}
      </div>
    </div>
  );
};

interface PathRoots {
  snapshotRoot: string | null;
  projectRoot: string | null;
}

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="typography-ui-header text-foreground">{children}</h3>
);

const EvidenceList: React.FC<{ item: CodeGraphItem }> = ({ item }) => (
  <ul className="flex flex-col gap-0.5">
    {item.evidence.map((entry) => (
      <li key={`${entry.edge}-${entry.ref}`} className="typography-micro break-words text-muted-foreground">
        {`${entry.edge} · ${entry.ref} · ${entry.confidence.toFixed(2)}`}
      </li>
    ))}
    {item.knowledgeIds.map((id) => (
      <li key={id} className="typography-micro break-words text-muted-foreground">{id}</li>
    ))}
  </ul>
);

const ItemRow: React.FC<{ item: CodeGraphItem; roots: PathRoots; badge?: string }> = ({ item, roots, badge }) => (
  <li className="flex flex-col gap-0.5 rounded-md border border-border p-2">
    <span className="typography-ui min-w-0 break-words text-foreground">{item.name ?? item.id}</span>
    <span className="typography-micro w-fit rounded border border-[var(--surface-border)] px-1 text-muted-foreground" data-testid="code-graph-impact-badge">
      {badge ?? (item.confidence >= 1 ? '✓' : '~')}
    </span>
    <span className="typography-micro break-words text-muted-foreground">{`${graphFilePathForDisplay({ ...roots, file: item.file })}:${item.line}`}</span>
    <EvidenceList item={item} />
  </li>
);

const SymbolDetail: React.FC<{ context: CodeGraphQueryResult; impact: CodeGraphQueryResult | null; roots: PathRoots }> = ({ context, impact, roots }) => {
  const { t } = useI18n();
  const impacted = (impact?.impacted ?? []).filter((entry) => entry.id !== context.definition?.id);
  const isConfirmedImpact = (entry: CodeGraphItem): boolean => entry.evidence.some((edge) => edge.edge !== 'CALLS_UNRESOLVED' && (edge.confidence ?? 1) >= 1);
  const confirmedImpact = impacted.filter(isConfirmedImpact);
  const inferredImpact = impacted.filter((entry) => !isConfirmedImpact(entry));
  return (
    <div className="flex flex-col gap-2">
      {context.definition ? (
        <section aria-label={t('codeGraph.section.definition')} className="flex flex-col gap-1">
          <h4 className="typography-ui-header text-foreground">{t('codeGraph.section.definition')}</h4>
          <ul className="flex flex-col gap-1">
            <ItemRow item={context.definition} roots={roots} />
          </ul>
        </section>
      ) : null}
      {context.callers && context.callers.length > 0 ? (
        <section aria-label={t('codeGraph.section.callers')} className="flex flex-col gap-1">
          <h4 className="typography-ui-header text-foreground">{t('codeGraph.section.callers')}</h4>
          <ul className="flex flex-col gap-1">
            {context.callers.map((item) => <ItemRow key={item.id} item={item} roots={roots} />)}
          </ul>
        </section>
      ) : null}
      {impacted.length > 0 ? (
        <section aria-label={t('codeGraph.section.impact')} className="flex flex-col gap-1">
          <h4 className="typography-ui-header text-foreground">{t('codeGraph.section.impact')}</h4>
          {confirmedImpact.length > 0 ? (
            <div className="flex flex-col gap-1" data-testid="code-graph-impact-confirmed">
              <p className="typography-micro text-muted-foreground">{`${t('codeGraph.impact.confirmed')} · ${confirmedImpact.length}`}</p>
              <ul className="flex flex-col gap-1">
                {confirmedImpact.map((item) => <ItemRow key={item.id} item={item} roots={roots} badge={item.evidence.map((entry) => entry.edge).join(' · ')} />)}
              </ul>
            </div>
          ) : null}
          {inferredImpact.length > 0 ? (
            <div className="flex flex-col gap-1" data-testid="code-graph-impact-inferred">
              <p className="typography-micro text-muted-foreground">{`${t('codeGraph.impact.inferred')} · ${inferredImpact.length}`}</p>
              <ul className="flex flex-col gap-1">
                {inferredImpact.map((item) => <ItemRow key={item.id} item={item} roots={roots} badge={item.evidence.map((entry) => entry.edge).join(' · ') || '—'} />)}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      <UnresolvedNotes result={context} />
    </div>
  );
};

const FileDetail: React.FC<{ result: CodeGraphQueryResult; roots: PathRoots }> = ({ result, roots }) => {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1">
      <section aria-label={t('codeGraph.section.file')} className="flex flex-col gap-1">
        <h4 className="typography-ui-header text-foreground">{t('codeGraph.section.file')}</h4>
        <ul className="flex flex-col gap-1">
          {result.items.map((item) => <ItemRow key={item.id} item={item} roots={roots} />)}
        </ul>
      </section>
      <UnresolvedNotes result={result} />
    </div>
  );
};

const UnresolvedNotes: React.FC<{ result: CodeGraphQueryResult }> = ({ result }) => {
  if (result.unresolved.length === 0 && result.unsupported.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {[...result.unsupported, ...result.unresolved].map((note) => (
        <p key={note} className="typography-micro break-words text-muted-foreground">{note}</p>
      ))}
    </div>
  );
};

const SearchState: React.FC<{ result: CodeGraphQueryResult }> = ({ result }) => {
  const { t } = useI18n();
  if (result.coverage === 'unindexed' && result.unsupported.length > 0) {
    return (
      <div className="rounded-md border border-border p-3">
        <p className="typography-ui text-muted-foreground">{t('codeGraph.state.unsupported')}</p>
        {result.unsupported.map((note) => (
          <p key={note} className="typography-micro mt-1 break-words text-muted-foreground">{note}</p>
        ))}
      </div>
    );
  }
  if (result.coverage === 'unindexed') {
    return (
      <div className="rounded-md border border-border p-3">
        <p className="typography-ui text-muted-foreground">{t('codeGraph.state.unknown')}</p>
        {result.unresolved.map((note) => (
          <p key={note} className="typography-micro mt-1 break-words text-muted-foreground">{note}</p>
        ))}
      </div>
    );
  }
  const contentCount = result.contentItems?.length ?? 0;
  if (result.items.length === 0 && contentCount === 0) {
    return (
      <div className="rounded-md border border-border p-3">
        <p className="typography-ui text-muted-foreground">{t('codeGraph.state.empty')}</p>
      </div>
    );
  }
  return null;
};
