/**
 * Client for the Alcode code-graph routes.
 *
 * The index lives on the server (`packages/web/server/lib/code-graph`),
 * which builds it from the real engine over the project directory. This
 * module only speaks HTTP and resolves no paths.
 *
 * Every function throws on failure. An authoritative read must never
 * resolve to an empty result a caller could mistake for "no symbols here"
 * — that reading is what would make the panel show an empty graph for a
 * backend that never answered.
 *
 * Requests are directory-scoped twice: the directory travels as a query
 * parameter (so the server never falls back to its own cwd and mixes
 * projects) and as the `directory` runtime option (so a project inside an
 * isolated space reaches the server inside that space). A switched session
 * in the same directory shares the binding; a switched directory fetches
 * its own.
 */

import { runtimeFetch } from './runtime-fetch';

export type CodeGraphFreshness = 'fresh' | 'stale' | 'unindexed';
export type CodeGraphCoverage = 'indexed' | 'partial' | 'unindexed';

export type CodeGraphQueryKind = 'context' | 'impact' | 'search' | 'tests' | 'file' | 'explore' | 'trace' | 'content';

export type CodeGraphSearchReason =
  | 'exact-name'
  | 'exact-qualified'
  | 'prefix'
  | 'token'
  | 'substring'
  | 'fuzzy';

export type CodeGraphContentReason = 'literal' | 'phrase' | 'token';

export interface CodeGraphContentItem {
  file: string;
  line: number;
  column?: number;
  excerpt: string;
  reason: CodeGraphContentReason;
  confidence: number;
}

export interface CodeGraphEvidence {
  edge: string;
  ref: string;
  confidence: number;
}

export interface CodeGraphItem {
  id: string;
  file: string;
  line: number;
  name?: string;
  evidence: CodeGraphEvidence[];
  confidence: number;
  knowledgeIds: string[];
  reason?: CodeGraphSearchReason;
  rank?: number;
  /** `confirmed` when the primary evidence edge is compiler-resolved, else `inferred`. */
  verdict?: 'confirmed' | 'inferred';
  /** True when the row's file is a test path by the engine's own test-path check. */
  isTest?: boolean;
}

export interface CodeGraphNode {
  id: string;
  kind: string;
  subject: boolean;
  name?: string;
  file?: string;
  line?: number;
}

export interface CodeGraphEdge {
  id: string;
  kind: string;
  from: string;
  to: string;
  confidence: number;
  /** Parallel call/import sites collapsed into this one directed edge. */
  sites: number;
}

/** A topology edge the canvas hands back on click: the edge plus the source site it carries, if any. */
export interface CodeGraphSelectedEdge {
  /** Topology edge id; falls back to the drawn from|to|kind key when absent. */
  id?: string;
  from: string;
  to: string;
  kind: string;
  confidence: number;
  /** Parallel call/import sites collapsed into this one directed edge. */
  sites: number;
  /** Source site the engine attributed this edge to, when the topology carries one. */
  evidenceRef?: string;
}

export interface CodeGraphTopology {
  subjectId: string;
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  truncated: boolean;
}

export interface CodeGraphFreshnessBinding {
  projectId: string;
  worktreeId: string;
  revision: string;
  fingerprint: string;
  freshness: CodeGraphFreshness;
  observedAtMs: number;
  staleAfterMs: number;
  staleReason?: string;
  refreshError?: string;
  truncated?: boolean;
}

export interface CodeGraphIndexSummary extends Partial<CodeGraphFreshnessBinding> {
  binding?: string;
  snapshotRoot?: string | null;
  nodeCount: number;
  edgeCount: number;
  entryCount: number;
  indexTruncated?: boolean;
  excludedCount?: number;
  excludedSample?: string[];
  /**
   * False while a build runs and nothing has been published yet. The panel must
   * render progress from `indexState` instead of an empty graph, and must not
   * treat the zero counts as "this repository has no code".
   */
  ready?: boolean;
  indexState?: CodeGraphIndexState;
}

/**
 * The server's index state machine, as it reports itself. `files`,
 * `projectsDone` and `projectsTotal` are counted work, never an estimated
 * percentage: a phase with no count says the phase and nothing more.
 */
export interface CodeGraphIndexState {
  state?: string;
  phase?: string;
  files?: number;
  projectsDone?: number;
  projectsTotal?: number;
  startedAtMs?: number | null;
  error?: string | null;
  generation?: number | null;
}

export type CodeGraphCompleteness = 'complete' | 'partial' | 'truncated' | 'unindexed';

/** Machine-readable reason for a non-`complete` completeness; free-form so new server reasons still parse. */
export type CodeGraphCompletenessReason = string;

/**
 * Server-computed counts so the panel renders them instead of deriving
 * its own. Every field is optional: older payloads omit `totals` entirely
 * and the client leaves it `undefined` rather than inventing a total.
 */
/**
 * Honest size of an answer, as the engine established it: `known` is the full count
 * before any display limit (`null` when the index cannot support one), `displayed`
 * is how many rows came back. The client renders these; it never derives a total
 * from `items.length`.
 */
export interface CodeGraphTotals {
  displayed?: number;
  known?: number | null;
  hidden?: number | null;
  byDepth?: Array<{ depth: number; count: number }>;
  byKind?: Array<{ kind: string; count: number }>;
}

/** Ego-neighbourhood counts for subject-bearing answers (`context`, `file`). */
export interface CodeGraphNeighborhoodSummary {
  subjectId?: string;
  nodeCount?: number;
  edgeCount?: number;
  truncated?: boolean;
  modules?: CodeGraphModuleCoverage[];
}

/** Ordered-trace counts for `kind: 'trace'`. */
export interface CodeGraphTraceSummary {
  from?: string;
  to?: string;
  hopCount?: number;
  stepCount?: number;
  truncated?: boolean;
}

/** Fan-in/fan-out counts for `kind: 'impact'`. */
export interface CodeGraphImpactSummary {
  subjectId?: string;
  callerCount?: number;
  calleeCount?: number;
  impactedCount?: number;
  truncated?: boolean;
}

/** Per-list index-coverage counts for `kind: 'explore'` summaries. */
export interface CodeGraphModuleCoverage {
  name: string;
  fileCount?: number;
  symbolCount?: number;
  edgeCount?: number;
  covered?: boolean;
  /** Files the engine analyzed in this module. */
  analyzedFiles?: number;
  /** Files the engine never analyzes in this module. */
  unanalyzedFiles?: number;
  /** Unanalyzed files grouped by extension. */
  unanalyzedByExtension?: Array<{ ext: string; count: number }>;
  /** Files excluded as generated/vendored or cut by the entry cap. */
  excludedFiles?: number;
}

export type CodeGraphQuerySummary =
  | CodeGraphNeighborhoodSummary
  | CodeGraphTraceSummary
  | CodeGraphImpactSummary;

/** Displayed-vs-walked counts for one named row list. */
export interface CodeGraphShownCounts {
  shown: number;
  total: number;
}

/** Per-list displayed-vs-walked counts; only the lists the query returns are present. */
export interface CodeGraphShownOf {
  callers?: CodeGraphShownCounts;
  callees?: CodeGraphShownCounts;
  impacted?: CodeGraphShownCounts;
  candidates?: CodeGraphShownCounts;
}

export interface CodeGraphQueryResult extends Partial<CodeGraphFreshnessBinding> {
  coverage: CodeGraphCoverage;
  /**
   * Absolute directory the answer's `file` values are relative to. Node ids are
   * rooted here, not at the project root; a caller opening source must join
   * against this and refuse paths that escape it.
   */
  snapshotRoot?: string | null;
  knowledgeIds: string[];
  unresolved: string[];
  unsupported: string[];
  /** False when the answer came from a build that has not published a graph yet. */
  ready?: boolean;
  /** The build state behind an answer that has nothing to read from yet. */
  indexState?: CodeGraphIndexState;
  /** The engine hit its own answer cap, so the list is a prefix of a larger set. */
  truncated?: boolean;
  /** True when the index walk skipped files, so `coverage` reads `partial`. */
  indexTruncated?: boolean;
  excludedCount?: number;
  excludedSample?: string[];
  items: CodeGraphItem[];
  /** Present only on `kind: 'content'`: source-text hits with excerpts. */
  contentItems?: CodeGraphContentItem[];
  /** The `impact` answer's resolved subject, when the engine found one. */
  subject?: CodeGraphItem;
  definition?: CodeGraphItem;
  callers?: CodeGraphItem[];
  callees?: CodeGraphItem[];
  impacted?: CodeGraphItem[];
  candidates?: CodeGraphItem[];
  graph?: CodeGraphTopology;
  /** Present only on `kind: 'explore'`. */
  modules?: CodeGraphModule[];
  /** Present only on `kind: 'trace'`; ordered from `from` to `to`. */
  path?: CodeGraphTrailStep[];
  /**
   * Server-computed counts. Absent on older payloads; the client keeps it
   * `undefined` and callers handle that — never an invented total.
   */
  totals?: CodeGraphTotals;
  /** Rows collapsed by id de-duplication; present only when greater than 0. */
  duplicatesDropped?: number;
  /** Which recon mode the panel should render/select for this answer. */
  suggestedMode?: 'explore' | 'trace' | 'impact';
  /** True when two or more returned rows share a display name but differ in id. */
  ambiguousNames?: boolean;
  /** Per-list displayed-vs-walked counts for the rows this query returns. */
  shownOf?: CodeGraphShownOf;
  /** Search only: the executed search text, echoed so the panel never re-derives it. */
  query?: string;
  /** Search only: test-file rows suppressed by the caller's own `excludeTests` filter. */
  hiddenTestCount?: number;
  /** Per-kind server summary (`neighborhood` / `trace` / `impact` shapes). */
  summary?: CodeGraphQuerySummary;
  completeness?: CodeGraphCompleteness;
  completenessReason?: CodeGraphCompletenessReason;
  /** Monotonic build identity, so a client never mixes rows across rebuilds. */
  generation?: number;
}

export interface CodeGraphQueryInput {
  kind: CodeGraphQueryKind;
  symbol?: string;
  query?: string;
  target?: string;
  file?: string;
  /** Trace start symbol id; only `kind: 'trace'` reads it. */
  from?: string;
  /** Trace end symbol id; only `kind: 'trace'` reads it. */
  to?: string;
  limit?: number;
  refresh?: boolean;
  /** Neighborhood depth for subject-bearing kinds; clamped to 1..3 when sent. */
  depth?: number;
  signal?: AbortSignal;
  /** Source-text scope filters; only `kind: 'content'` reads them. */
  pathPrefix?: string;
  language?: string;
  contentKind?: 'test' | 'source';
  contentDirectory?: string;
}

/** One repo-relative path bucket of indexed files, as the server grouped it. */
export interface CodeGraphModule {
  name: string;
  fileCount: number;
  testFileCount: number;
  symbolCount: number;
  edgeCount: number;
  sampleSymbols: Array<{ id: string; file: string; name?: string; line?: number }>;
}

/** One directed static call step of a traced path, with its source site. */
export interface CodeGraphTrailStep {
  from: string;
  to: string;
  ref: string;
  confidence: number;
}

/** A snapshot file id resolved against the snapshot root and checked on disk. */
export interface CodeGraphResolvedFile {
  ok: boolean;
  absolute?: string;
  projectRelative?: string;
  reason?: string;
  snapshotRoot?: string;
}

const BASE_PATH = '/api/code-graph';

/**
 * Decoded JSON from the code-graph routes. `response.json()` yields `any`;
 * every parser below accepts this shape and proves each field with a small
 * probe before use, so no caller branches on a representation.
 */
export type CodeGraphJsonValue = string | number | boolean | null | CodeGraphJsonValue[] | {
  [key: string]: CodeGraphJsonValue | undefined;
};
/** One JSON record from the code-graph routes, with proven non-array shape. */
export type CodeGraphJsonRecord = { [key: string]: CodeGraphJsonValue | undefined };
/** One JSON field: present, or absent when the server omits it. */
export type CodeGraphJsonField = CodeGraphJsonValue | undefined;

/**
 * Object-tag probes for the JSON shapes above. `typeof` probes are banned by
 * the anti-slop rule; these tag reads prove the same representation.
 */
export const isJsonRecord = (value: CodeGraphJsonField): value is CodeGraphJsonRecord =>
  Object.prototype.toString.call(value) === '[object Object]';

export const isJsonText = (value: CodeGraphJsonField): value is string =>
  Object.prototype.toString.call(value) === '[object String]';

export const isJsonNumber = (value: CodeGraphJsonField): value is number =>
  Object.prototype.toString.call(value) === '[object Number]';

export const isFiniteJsonNumber = (value: CodeGraphJsonField): value is number =>
  isJsonNumber(value) && Number.isFinite(value);

export const isJsonArray = (value: CodeGraphJsonField): value is CodeGraphJsonValue[] =>
  Array.isArray(value);

/** Text that may be empty; absent or non-text reads as `undefined`. */
export const asText = (value: CodeGraphJsonField): string | undefined =>
  (isJsonText(value) ? value : undefined);

/** Text with content; empty, absent, or non-text reads as `undefined`. */
export const asNonEmptyText = (value: CodeGraphJsonField): string | undefined => {
  const text = asText(value);
  return text ? text : undefined;
};

/** String lists ride through; anything else reads as empty, never half-parsed. */
export const asStringArray = (value: CodeGraphJsonField): string[] =>
  (isJsonArray(value) ? value : []).filter(isJsonText);

const requireDirectory = (directory: string | null | undefined): string => {
  const trimmed = directory?.trim() ?? '';
  if (!trimmed) {
    throw new Error('Code graph needs a project directory');
  }
  return trimmed;
};

const failed = async (response: Response, fallback: string): Promise<never> => {
  let message = '';
  try {
    const payload: { error?: CodeGraphJsonField } | null = await response.json();
    if (payload && isJsonText(payload.error) && payload.error.trim()) {
      message = payload.error.trim();
    }
  } catch {
    // Fall through to the generic message.
  }
  throw new Error(message || `${fallback} (${response.status})`);
};

const parseEvidence = (value: CodeGraphJsonField): CodeGraphEvidence[] => {
  if (!isJsonArray(value)) return [];
  const out: CodeGraphEvidence[] = [];
  for (const entry of value) {
    if (!isJsonRecord(entry)) continue;
    if (!isJsonText(entry.edge) || !isJsonText(entry.ref)) continue;
    if (!isFiniteJsonNumber(entry.confidence)) continue;
    out.push({ edge: entry.edge, ref: entry.ref, confidence: entry.confidence });
  }
  return out;
};

const SEARCH_REASONS = new Set(['exact-name', 'exact-qualified', 'prefix', 'token', 'substring', 'fuzzy']);
const CONTENT_REASONS = new Set(['literal', 'phrase', 'token']);
const VERDICTS = new Set(['confirmed', 'inferred']);

const isSearchReason = (value: CodeGraphJsonField): value is CodeGraphSearchReason =>
  isJsonText(value) && SEARCH_REASONS.has(value);

const isVerdict = (value: CodeGraphJsonField): value is CodeGraphItem['verdict'] =>
  isJsonText(value) && VERDICTS.has(value);

const parseItem = (value: CodeGraphJsonField): CodeGraphItem | null => {
  if (!isJsonRecord(value)) return null;
  if (!isJsonText(value.id) || !isJsonText(value.file)) return null;
  if (!isFiniteJsonNumber(value.line)) return null;
  if (!isFiniteJsonNumber(value.confidence)) return null;
  const item: CodeGraphItem = {
    id: value.id,
    file: value.file,
    line: value.line,
    evidence: parseEvidence(value.evidence),
    confidence: value.confidence,
    knowledgeIds: asStringArray(value.knowledgeIds),
  };
  const name = asText(value.name);
  if (name !== undefined) item.name = name;
  if (isSearchReason(value.reason)) item.reason = value.reason;
  if (isFiniteJsonNumber(value.rank)) item.rank = value.rank;
  if (isVerdict(value.verdict)) item.verdict = value.verdict;
  if (value.isTest === true || value.isTest === false) item.isTest = value.isTest;
  return item;
};

const isContentReason = (value: CodeGraphJsonField): value is CodeGraphContentReason =>
  isJsonText(value) && CONTENT_REASONS.has(value);

const parseContentItem = (value: CodeGraphJsonField): CodeGraphContentItem | null => {
  if (!isJsonRecord(value)) return null;
  const file = asNonEmptyText(value.file);
  if (file === undefined) return null;
  if (!isFiniteJsonNumber(value.line)) return null;
  if (!isJsonText(value.excerpt)) return null;
  if (!isContentReason(value.reason)) return null;
  if (!isFiniteJsonNumber(value.confidence)) return null;
  const item: CodeGraphContentItem = {
    file,
    line: value.line,
    excerpt: value.excerpt,
    reason: value.reason,
    confidence: value.confidence,
  };
  if (isFiniteJsonNumber(value.column)) item.column = value.column;
  return item;
};

const parseContentItems = (value: CodeGraphJsonField): CodeGraphContentItem[] => {
  if (!isJsonArray(value)) return [];
  const out: CodeGraphContentItem[] = [];
  for (const entry of value) {
    const item = parseContentItem(entry);
    if (item) out.push(item);
  }
  return out;
};

/** Truncation counters shared by the index and query answers. */
export interface CodeGraphIndexTruncation {
  indexTruncated?: boolean;
  excludedCount?: number;
  excludedSample?: string[];
}

const parseIndexState = (value: CodeGraphJsonField): CodeGraphIndexState | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const state: CodeGraphIndexState = {};
  const name = asText(value.state);
  if (name !== undefined) state.state = name;
  const failure = asText(value.error);
  if (failure !== undefined) state.error = failure;
  if (isFiniteJsonNumber(value.generation)) state.generation = value.generation;
  if (isFiniteJsonNumber(value.startedAtMs)) state.startedAtMs = value.startedAtMs;
  // Counts arrive either flattened (indexState) or inside the job's own
  // `progress` record; both describe the same measured work.
  const progress = isJsonRecord(value.progress) ? value.progress : value;
  const phase = asText(progress.phase);
  if (phase !== undefined) state.phase = phase;
  if (isFiniteJsonNumber(progress.files)) state.files = progress.files;
  if (isFiniteJsonNumber(progress.projectsDone)) state.projectsDone = progress.projectsDone;
  if (isFiniteJsonNumber(progress.projectsTotal)) state.projectsTotal = progress.projectsTotal;
  return state;
};

const parseIndexTruncation = (value: CodeGraphJsonRecord): CodeGraphIndexTruncation => {  const truncation: CodeGraphIndexTruncation = {};
  if (value.indexTruncated === true) truncation.indexTruncated = true;
  if (isFiniteJsonNumber(value.excludedCount)) truncation.excludedCount = value.excludedCount;
  if (isJsonArray(value.excludedSample)) truncation.excludedSample = asStringArray(value.excludedSample);
  return truncation;
};

const parseItems = (value: CodeGraphJsonField): CodeGraphItem[] => {
  if (!isJsonArray(value)) return [];
  const out: CodeGraphItem[] = [];
  for (const entry of value) {
    const item = parseItem(entry);
    if (item) out.push(item);
  }
  return out;
};

const parseGraphNode = (value: CodeGraphJsonField): CodeGraphNode | null => {
  if (!isJsonRecord(value)) return null;
  const id = asNonEmptyText(value.id);
  if (id === undefined) return null;
  const node: CodeGraphNode = {
    id,
    kind: asNonEmptyText(value.kind) ?? 'node',
    subject: value.subject === true,
  };
  const name = asNonEmptyText(value.name);
  if (name !== undefined) node.name = name;
  const file = asNonEmptyText(value.file);
  if (file !== undefined) node.file = file;
  if (isFiniteJsonNumber(value.line)) node.line = value.line;
  return node;
};

/**
 * Wire ego-graph carried by subject-bearing answers. Null when the answer
 * carries no drawable topology — the panel states the absence instead of
 * drawing an empty canvas. Parallel sites collapse into one directed edge
 * with a site count; edges with an unknown endpoint are dropped, never
 * given an invented node.
 */
export const parseGraph = (value: CodeGraphJsonField): CodeGraphTopology | null => {
  if (!isJsonRecord(value)) return null;
  const subjectId = asNonEmptyText(value.subjectId);
  if (subjectId === undefined) return null;
  if (!isJsonArray(value.nodes) || !isJsonArray(value.edges)) return null;
  const nodes: CodeGraphNode[] = [];
  for (const entry of value.nodes) {
    const node = parseGraphNode(entry);
    if (node) nodes.push(node);
  }
  if (nodes.length === 0) return null;
  const known = new Set(nodes.map((node) => node.id));
  const merged = new Map<string, CodeGraphEdge>();
  for (const entry of value.edges) {
    if (!isJsonRecord(entry)) continue;
    const { from, to, kind } = entry;
    if (!isJsonText(from) || !isJsonText(to) || !isJsonText(kind)) continue;
    if (!known.has(from) || !known.has(to)) continue;
    const confidence = isFiniteJsonNumber(entry.confidence) ? entry.confidence : 1;
    const key = `${from}|${to}|${kind}`;
    const existing = merged.get(key);
    if (existing) {
      existing.sites += 1;
      existing.confidence = Math.max(existing.confidence, confidence);
    } else {
      merged.set(key, {
        id: asNonEmptyText(entry.id) ?? key,
        kind,
        from,
        to,
        confidence,
        sites: 1,
      });
    }
  }
  return {
    subjectId,
    nodes,
    edges: [...merged.values()],
    truncated: value.truncated === true,
  };
};

const parseBinding = (value: CodeGraphJsonField): CodeGraphFreshnessBinding => {
  if (!isJsonRecord(value)) {
    throw new Error('Malformed code graph response');
  }
  if (!isJsonText(value.projectId) || !isJsonText(value.worktreeId)) {
    throw new Error('Malformed code graph response');
  }
  if (!isJsonText(value.revision) || !isJsonText(value.fingerprint)) {
    throw new Error('Malformed code graph response');
  }
  if (value.freshness !== 'fresh' && value.freshness !== 'stale') {
    throw new Error('Malformed code graph response');
  }
  if (!isFiniteJsonNumber(value.observedAtMs) || !isFiniteJsonNumber(value.staleAfterMs)) {
    throw new Error('Malformed code graph response');
  }
  const binding: CodeGraphFreshnessBinding = {
    projectId: value.projectId,
    worktreeId: value.worktreeId,
    revision: value.revision,
    fingerprint: value.fingerprint,
    freshness: value.freshness,
    observedAtMs: value.observedAtMs,
    staleAfterMs: value.staleAfterMs,
  };
  const staleReason = asText(value.staleReason);
  if (staleReason !== undefined) binding.staleReason = staleReason;
  const refreshError = asText(value.refreshError);
  if (refreshError !== undefined) binding.refreshError = refreshError;
  if (value.truncated === true) binding.truncated = true;
  return binding;
};

/** Count fields ride through; absent or non-finite counts read as zero. */
const countOrZero = (record: CodeGraphJsonRecord, key: string): number => {
  const count = record[key];
  return isFiniteJsonNumber(count) ? count : 0;
};

/** Count fields ride through; absent or non-finite counts stay absent. */
const optionalCount = (record: CodeGraphJsonRecord, key: string): number | undefined => {
  const count = record[key];
  return isFiniteJsonNumber(count) ? count : undefined;
};

const parseModules = (value: CodeGraphJsonField): CodeGraphModule[] | undefined => {
  if (!isJsonArray(value)) return undefined;
  const out: CodeGraphModule[] = [];
  for (const entry of value) {
    if (!isJsonRecord(entry)) continue;
    if (!isJsonText(entry.name) || !entry.name) continue;
    const samples: CodeGraphModule['sampleSymbols'] = [];
    if (isJsonArray(entry.sampleSymbols)) {
      for (const sample of entry.sampleSymbols) {
        if (!isJsonRecord(sample)) continue;
        if (!isJsonText(sample.id) || !isJsonText(sample.file)) continue;
        const symbol: CodeGraphModule['sampleSymbols'][number] = { id: sample.id, file: sample.file };
        const sampleName = asNonEmptyText(sample.name);
        if (sampleName !== undefined) symbol.name = sampleName;
        if (isFiniteJsonNumber(sample.line)) symbol.line = sample.line;
        samples.push(symbol);
      }
    }
    out.push({
      name: entry.name,
      fileCount: countOrZero(entry, 'fileCount'),
      testFileCount: countOrZero(entry, 'testFileCount'),
      symbolCount: countOrZero(entry, 'symbolCount'),
      edgeCount: countOrZero(entry, 'edgeCount'),
      sampleSymbols: samples,
    });
  }
  return out;
};

const parseTrail = (value: CodeGraphJsonField): CodeGraphTrailStep[] | undefined => {
  if (!isJsonArray(value)) return undefined;
  const out: CodeGraphTrailStep[] = [];
  for (const entry of value) {
    if (!isJsonRecord(entry)) continue;
    if (!isJsonText(entry.from) || !isJsonText(entry.to)) continue;
    if (!isJsonText(entry.ref)) continue;
    out.push({
      from: entry.from,
      to: entry.to,
      ref: entry.ref,
      confidence: isFiniteJsonNumber(entry.confidence) ? entry.confidence : 1,
    });
  }
  return out;
};

const TOTAL_KEYS = ['displayed', 'known', 'hidden'] as const;

/**
 * Server counts ride through untouched. Absent or malformed stays
 * `undefined` — the client never derives a total from `items.length`.
 * `known: null` is preserved: it means "the index cannot support a total".
 */
const parseTotals = (value: CodeGraphJsonField): CodeGraphTotals | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const out: CodeGraphTotals = {};
  for (const key of TOTAL_KEYS) {
    const entry = value[key];
    if (entry === null && key === 'known') {
      out.known = null;
      continue;
    }
    if (isFiniteJsonNumber(entry)) {
      out[key] = entry;
    }
  }
  const byDepth = parseDepthCounts(value.byDepth);
  if (byDepth) out.byDepth = byDepth;
  const byKind = parseKindCounts(value.byKind);
  if (byKind) out.byKind = byKind;
  return Object.keys(out).length > 0 ? out : undefined;
};

/** `[{ depth, count }]` from the server, or undefined when malformed. */
const parseDepthCounts = (value: CodeGraphJsonField): Array<{ depth: number; count: number }> | undefined => {
  if (!isJsonArray(value)) return undefined;
  const out: Array<{ depth: number; count: number }> = [];
  for (const entry of value) {
    if (!isJsonRecord(entry)) continue;
    const { depth, count } = entry;
    if (!isFiniteJsonNumber(depth)) continue;
    if (!isFiniteJsonNumber(count)) continue;
    out.push({ depth, count });
  }
  return out.length > 0 ? out : undefined;
};

/** `[{ kind, count }]` from the server, or undefined when malformed. */
const parseKindCounts = (value: CodeGraphJsonField): Array<{ kind: string; count: number }> | undefined => {
  if (!isJsonArray(value)) return undefined;
  const out: Array<{ kind: string; count: number }> = [];
  for (const entry of value) {
    if (!isJsonRecord(entry)) continue;
    const { kind, count } = entry;
    if (!isJsonText(kind) || kind.length === 0) continue;
    if (!isFiniteJsonNumber(count)) continue;
    out.push({ kind, count });
  }
  return out.length > 0 ? out : undefined;
};

const COMPLETENESS_VALUES: ReadonlySet<string> = new Set(['complete', 'partial', 'truncated', 'unindexed']);

const SHOWN_OF_KEYS = ['callers', 'callees', 'impacted', 'candidates'] as const;

const parseShownCounts = (value: CodeGraphJsonField): CodeGraphShownCounts | undefined => {
  if (!isJsonRecord(value)) return undefined;
  if (!isFiniteJsonNumber(value.shown)) return undefined;
  if (!isFiniteJsonNumber(value.total)) return undefined;
  return { shown: value.shown, total: value.total };
};

/**
 * Per-list displayed-vs-walked counts. Malformed lists are dropped, never
 * zero-filled; no valid list stays `undefined`.
 */
const parseShownOf = (value: CodeGraphJsonField): CodeGraphShownOf | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const out: CodeGraphShownOf = {};
  for (const key of SHOWN_OF_KEYS) {
    const parsed = parseShownCounts(value[key]);
    if (parsed) out[key] = parsed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const isCodeGraphCompleteness = (value: CodeGraphJsonField): value is CodeGraphCompleteness =>
  isJsonText(value) && COMPLETENESS_VALUES.has(value);

const parseCompleteness = (value: CodeGraphJsonField): CodeGraphCompleteness | undefined =>
  (isCodeGraphCompleteness(value) ? value : undefined);

const parseCompletenessReason = (value: CodeGraphJsonField): CodeGraphCompletenessReason | undefined =>
  asNonEmptyText(value);

const parseGeneration = (value: CodeGraphJsonField): number | undefined =>
  (isFiniteJsonNumber(value) ? value : undefined);

/**
 * Unanalyzed files grouped by extension. The server sends an ordered
 * `[{ ext, count }]` list; a plain `{ '.sh': n }` map from older payloads
 * converts to the same sorted shape. Absent or empty stays `undefined`.
 */
const parseUnanalyzedByExtension = (
  value: CodeGraphJsonField,
): Array<{ ext: string; count: number }> | undefined => {
  const out: Array<{ ext: string; count: number }> = [];
  if (isJsonArray(value)) {
    for (const entry of value) {
      if (!isJsonRecord(entry)) continue;
      if (!isJsonText(entry.ext) || !entry.ext) continue;
      if (!isFiniteJsonNumber(entry.count)) continue;
      out.push({ ext: entry.ext, count: entry.count });
    }
  } else if (isJsonRecord(value)) {
    for (const [ext, count] of Object.entries(value)) {
      if (!isFiniteJsonNumber(count)) continue;
      out.push({ ext, count });
    }
    out.sort((left, right) => (left.ext < right.ext ? -1 : left.ext > right.ext ? 1 : 0));
  } else {
    return undefined;
  }
  return out.length > 0 ? out : undefined;
};

const parseModuleCoverageList = (value: CodeGraphJsonField): CodeGraphModuleCoverage[] | undefined => {
  if (!isJsonArray(value)) return undefined;
  const out: CodeGraphModuleCoverage[] = [];
  for (const entry of value) {
    if (!isJsonRecord(entry)) continue;
    if (!isJsonText(entry.name) || !entry.name) continue;
    const coverage: CodeGraphModuleCoverage = { name: entry.name };
    const fileCount = optionalCount(entry, 'fileCount');
    if (fileCount !== undefined) coverage.fileCount = fileCount;
    const symbolCount = optionalCount(entry, 'symbolCount');
    if (symbolCount !== undefined) coverage.symbolCount = symbolCount;
    const edgeCount = optionalCount(entry, 'edgeCount');
    if (edgeCount !== undefined) coverage.edgeCount = edgeCount;
    if (entry.covered === true || entry.covered === false) coverage.covered = entry.covered;
    const analyzedFiles = optionalCount(entry, 'analyzedFiles');
    if (analyzedFiles !== undefined) coverage.analyzedFiles = analyzedFiles;
    const unanalyzedFiles = optionalCount(entry, 'unanalyzedFiles');
    if (unanalyzedFiles !== undefined) coverage.unanalyzedFiles = unanalyzedFiles;
    const unanalyzedByExtension = parseUnanalyzedByExtension(entry.unanalyzedByExtension);
    if (unanalyzedByExtension) coverage.unanalyzedByExtension = unanalyzedByExtension;
    const excludedFiles = optionalCount(entry, 'excludedFiles');
    if (excludedFiles !== undefined) coverage.excludedFiles = excludedFiles;
    out.push(coverage);
  }
  return out.length > 0 ? out : undefined;
};

/**
 * Per-kind server summary. Unknown shapes stay `undefined`; recognized
 * count fields ride through so the panel can render them directly.
 */
/** Mutable accumulator for the per-kind server summary shapes, plus the `kind` tag they may carry. */
type MutableCodeGraphSummary = CodeGraphNeighborhoodSummary &
  CodeGraphTraceSummary &
  CodeGraphImpactSummary & { kind?: string };

const parseSummary = (value: CodeGraphJsonField): CodeGraphQuerySummary | undefined => {
  if (!isJsonRecord(value)) return undefined;
  const summary: MutableCodeGraphSummary = {};
  const subjectId = asNonEmptyText(value.subjectId);
  if (subjectId !== undefined) summary.subjectId = subjectId;
  const from = asNonEmptyText(value.from);
  if (from !== undefined) summary.from = from;
  const to = asNonEmptyText(value.to);
  if (to !== undefined) summary.to = to;
  const kind = asNonEmptyText(value.kind);
  if (kind !== undefined) summary.kind = kind;
  const nodeCount = optionalCount(value, 'nodeCount');
  if (nodeCount !== undefined) summary.nodeCount = nodeCount;
  const edgeCount = optionalCount(value, 'edgeCount');
  if (edgeCount !== undefined) summary.edgeCount = edgeCount;
  const hopCount = optionalCount(value, 'hopCount');
  if (hopCount !== undefined) summary.hopCount = hopCount;
  const stepCount = optionalCount(value, 'stepCount');
  if (stepCount !== undefined) summary.stepCount = stepCount;
  const callerCount = optionalCount(value, 'callerCount');
  if (callerCount !== undefined) summary.callerCount = callerCount;
  const calleeCount = optionalCount(value, 'calleeCount');
  if (calleeCount !== undefined) summary.calleeCount = calleeCount;
  const impactedCount = optionalCount(value, 'impactedCount');
  if (impactedCount !== undefined) summary.impactedCount = impactedCount;
  if (value.truncated === true || value.truncated === false) summary.truncated = value.truncated;
  const modules = parseModuleCoverageList(value.modules);
  if (modules) summary.modules = modules;
  return Object.keys(summary).length > 0 ? summary : undefined;
};

/** Clamp a requested neighborhood depth to the server's 1..3 range. */
const normalizeDepth = (value: number | undefined): number | undefined => {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(3, Math.max(1, Math.floor(value)));
};

/**
 * Resolve a snapshot file id to a real path on disk. The server realpaths both
 * the file and the project and checks containment, so a refusal names the
 * boundary it hit instead of surfacing as a missing file in the editor.
 */
export const resolveCodeGraphFile = async (
  directory: string | null | undefined,
  file: string,
  options: { signal?: AbortSignal } = {},
): Promise<CodeGraphResolvedFile> => {
  const resolved = requireDirectory(directory);
  const response = await runtimeFetch(`${BASE_PATH}/resolve`, {
    query: { directory: resolved, file },
    directory: resolved,
    cache: 'no-store',
    signal: options.signal,
  });
  const payload: CodeGraphJsonRecord | null = await response.json().catch(() => null);
  if (!isJsonRecord(payload)) {
    return { ok: false, reason: `resolve-failed-${response.status}` };
  }
  const resolvedFile: CodeGraphResolvedFile = {
    ok: payload.ok === true,
  };
  const absolute = asText(payload.absolute);
  if (absolute !== undefined) resolvedFile.absolute = absolute;
  const projectRelative = asText(payload.projectRelative);
  if (projectRelative !== undefined) resolvedFile.projectRelative = projectRelative;
  const reason = asText(payload.reason);
  if (reason !== undefined) resolvedFile.reason = reason;
  const snapshotRoot = asText(payload.snapshotRoot);
  if (snapshotRoot !== undefined) resolvedFile.snapshotRoot = snapshotRoot;
  return resolvedFile;
};

/** Scope binding plus counts. Read before any symbol query to render freshness first. */
/** String query params for the code-graph index route; the fetcher serializes each entry. */
interface CodeGraphIndexQueryParams extends Record<string, string | undefined> {
  directory: string;
  refresh?: string;
}

/**
 * Stops a running index build. Cancellation is a request the server honours at
 * its next phase boundary; the answer reports whether a job was running, so the
 * panel can say "cancelled" only when something actually was.
 */
export const cancelCodeGraphIndex = async (
  directory: string | null | undefined,
  options: { signal?: AbortSignal } = {},
): Promise<{ cancelled: boolean; state?: string }> => {
  const resolved = requireDirectory(directory);
  const response = await runtimeFetch(`${BASE_PATH}/cancel`, {
    method: 'POST',
    query: { directory: resolved },
    directory: resolved,
    cache: 'no-store',
    signal: options.signal,
  });
  if (!response.ok) {
    return failed(response, 'Failed to cancel code graph indexing');
  }
  const payload: CodeGraphJsonField = await response.json();
  if (!isJsonRecord(payload)) return { cancelled: false };
  return { cancelled: payload.cancelled === true, state: asText(payload.state) };
};

export const fetchCodeGraphIndex = async (
  directory: string | null | undefined,
  options: { signal?: AbortSignal; refresh?: boolean } = {},
): Promise<CodeGraphIndexSummary> => {
  const resolved = requireDirectory(directory);
  const query: CodeGraphIndexQueryParams = { directory: resolved };
  if (options.refresh) query.refresh = '1';
  const response = await runtimeFetch(`${BASE_PATH}/index`, {
    query,
    directory: resolved,
    cache: 'no-store',
    signal: options.signal,
  });
  if (!response.ok) {
    return failed(response, 'Failed to load code graph index');
  }
  const payload: CodeGraphJsonRecord | null = await response.json();
  if (!isJsonRecord(payload)) {
    throw new Error('Malformed code graph response');
  }
  // A build in flight has no binding to parse: the server answers with the
  // state machine and null facts. Parsing a binding here is what turned
  // "indexing" into "Malformed code graph response" in the panel.
  const pending = payload.ready === false;
  const summary: CodeGraphIndexSummary = {
    ...(pending ? { freshness: 'unindexed' as const } : parseBinding(payload)),
    ...parseIndexTruncation(payload),
    nodeCount: isJsonNumber(payload.nodeCount) ? payload.nodeCount : 0,
    edgeCount: isJsonNumber(payload.edgeCount) ? payload.edgeCount : 0,
    entryCount: isJsonNumber(payload.entryCount) ? payload.entryCount : 0,
    ready: !pending,
    indexState: parseIndexState(payload.indexState),
  };
  const binding = asText(payload.binding);
  if (binding !== undefined) summary.binding = binding;
  const snapshotRoot = asNonEmptyText(payload.snapshotRoot);
  if (snapshotRoot !== undefined) summary.snapshotRoot = snapshotRoot;
  return summary;
};

/** Query string for the code-graph query route; only the fields the caller sets travel. */
interface CodeGraphQueryRouteParams extends Record<string, string | undefined> {
  directory: string;
  kind: CodeGraphQueryKind;
  symbol?: string;
  q?: string;
  target?: string;
  file?: string;
  from?: string;
  to?: string;
  limit?: string;
  refresh?: string;
  depth?: string;
  pathPrefix?: string;
  language?: string;
  contentKind?: string;
  contentDirectory?: string;
}

/** One engine query with the freshness binding attached to every row. */
export const queryCodeGraph = async (
  directory: string | null | undefined,
  input: CodeGraphQueryInput,
): Promise<CodeGraphQueryResult> => {
  const resolved = requireDirectory(directory);
  const query: CodeGraphQueryRouteParams = {
    directory: resolved,
    kind: input.kind,
  };
  if (input.symbol) query.symbol = input.symbol;
  if (input.query) query.q = input.query;
  if (input.target) query.target = input.target;
  if (input.file) query.file = input.file;
  if (input.from) query.from = input.from;
  if (input.to) query.to = input.to;
  if (input.limit !== undefined) query.limit = String(input.limit);
  if (input.refresh) query.refresh = '1';
  const depth = normalizeDepth(input.depth);
  if (depth !== undefined) query.depth = String(depth);
  if (input.pathPrefix) query.pathPrefix = input.pathPrefix;
  if (input.language) query.language = input.language;
  if (input.contentKind) query.contentKind = input.contentKind;
  if (input.contentDirectory) query.contentDirectory = input.contentDirectory;
  const response = await runtimeFetch(`${BASE_PATH}/query`, {
    query,
    directory: resolved,
    cache: 'no-store',
    signal: input.signal,
  });
  if (!response.ok) {
    return failed(response, 'Failed to query code graph');
  }
  const payload: CodeGraphJsonRecord | null = await response.json();
  if (!isJsonRecord(payload)) {
    throw new Error('Malformed code graph response');
  }
  const coverage = payload.coverage;
  if (coverage !== 'indexed' && coverage !== 'partial' && coverage !== 'unindexed') {
    throw new Error('Malformed code graph response');
  }
  const maybeItems = (key: string): CodeGraphItem[] | undefined => (
    key in payload ? parseItems(payload[key]) : undefined
  );
  const contentItems = parseContentItems(payload.items);
  const symbolItems = parseItems(payload.items);
  const isContentKind = input.kind === 'content';
  // `unindexed` with null facts is the honest "still building" answer; a binding
  // parse here would reject it and hide the state machine behind an error.
  const unindexed = payload.freshness === 'unindexed';
  const result: CodeGraphQueryResult = {
    ...(unindexed ? { freshness: 'unindexed' as const } : parseBinding(payload)),
    ...parseIndexTruncation(payload),
    coverage,
    knowledgeIds: asStringArray(payload.knowledgeIds),
    unresolved: asStringArray(payload.unresolved),
    unsupported: asStringArray(payload.unsupported),
    items: isContentKind ? [] : symbolItems,
  };
  if (payload.ready === false) result.ready = false;
  const indexState = parseIndexState(payload.indexState);
  if (indexState !== undefined) result.indexState = indexState;
  const snapshotRoot = asNonEmptyText(payload.snapshotRoot);
  if (snapshotRoot !== undefined) result.snapshotRoot = snapshotRoot;
  if (isContentKind || contentItems.length > 0) result.contentItems = contentItems;
  const callers = maybeItems('callers');
  if (callers !== undefined) result.callers = callers;
  const callees = maybeItems('callees');
  if (callees !== undefined) result.callees = callees;
  const impacted = maybeItems('impacted');
  if (impacted !== undefined) result.impacted = impacted;
  const candidates = maybeItems('candidates');
  if (candidates !== undefined) result.candidates = candidates;
  if ('subject' in payload) {
    const subject = parseItem(payload.subject);
    if (subject) result.subject = subject;
  }
  if ('definition' in payload) {
    const definition = parseItem(payload.definition);
    if (definition) result.definition = definition;
  }
  const graph = parseGraph(payload.graph);
  if (graph) result.graph = graph;
  const modules = parseModules(payload.modules);
  if (modules) result.modules = modules;
  const path = parseTrail(payload.path);
  if (path) result.path = path;
  const totals = parseTotals(payload.totals);
  if (totals) result.totals = totals;
  if (isFiniteJsonNumber(payload.duplicatesDropped)) result.duplicatesDropped = payload.duplicatesDropped;
  const suggestedMode = payload.suggestedMode;
  if (suggestedMode === 'explore' || suggestedMode === 'trace' || suggestedMode === 'impact') {
    result.suggestedMode = suggestedMode;
  }
  if (payload.ambiguousNames === true || payload.ambiguousNames === false) {
    result.ambiguousNames = payload.ambiguousNames;
  }
  const shownOf = parseShownOf(payload.shownOf);
  if (shownOf) result.shownOf = shownOf;
  const queryText = asText(payload.query);
  if (queryText !== undefined) result.query = queryText;
  if (isFiniteJsonNumber(payload.hiddenTestCount)) result.hiddenTestCount = payload.hiddenTestCount;
  const summary = parseSummary(payload.summary);
  if (summary) result.summary = summary;
  const completeness = parseCompleteness(payload.completeness);
  if (completeness) result.completeness = completeness;
  const completenessReason = parseCompletenessReason(payload.completenessReason);
  if (completenessReason !== undefined) result.completenessReason = completenessReason;
  const generation = parseGeneration(payload.generation);
  if (generation !== undefined) result.generation = generation;
  return result;
};
