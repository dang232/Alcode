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

export type CodeGraphFreshness = 'fresh' | 'stale';
export type CodeGraphCoverage = 'indexed' | 'partial' | 'unindexed';

export type CodeGraphQueryKind = 'context' | 'impact' | 'search' | 'tests' | 'file' | 'explore' | 'trace';

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

export interface CodeGraphIndexSummary extends CodeGraphFreshnessBinding {
  binding?: string;
  snapshotRoot?: string | null;
  nodeCount: number;
  edgeCount: number;
  entryCount: number;
}

export interface CodeGraphQueryResult extends CodeGraphFreshnessBinding {
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
  /** The engine hit its own answer cap, so the list is a prefix of a larger set. */
  truncated?: boolean;
  items: CodeGraphItem[];
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
  signal?: AbortSignal;
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

const requireDirectory = (directory: string | null | undefined): string => {
  const trimmed = typeof directory === 'string' ? directory.trim() : '';
  if (!trimmed) {
    throw new Error('Code graph needs a project directory');
  }
  return trimmed;
};

const failed = async (response: Response, fallback: string): Promise<never> => {
  let message = '';
  try {
    const payload = (await response.json()) as { error?: unknown } | null;
    if (payload && typeof payload.error === 'string' && payload.error.trim()) {
      message = payload.error.trim();
    }
  } catch {
    // Fall through to the generic message.
  }
  throw new Error(message || `${fallback} (${response.status})`);
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const asStringArray = (value: unknown): string[] => (
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
);

const parseEvidence = (value: unknown): CodeGraphEvidence[] => {
  if (!Array.isArray(value)) return [];
  const out: CodeGraphEvidence[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (typeof entry.edge !== 'string' || typeof entry.ref !== 'string') continue;
    if (typeof entry.confidence !== 'number' || !Number.isFinite(entry.confidence)) continue;
    out.push({ edge: entry.edge, ref: entry.ref, confidence: entry.confidence });
  }
  return out;
};

const parseItem = (value: unknown): CodeGraphItem | null => {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.file !== 'string') return null;
  if (typeof value.line !== 'number' || !Number.isFinite(value.line)) return null;
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)) return null;
  return {
    id: value.id,
    file: value.file,
    line: value.line,
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    evidence: parseEvidence(value.evidence),
    confidence: value.confidence,
    knowledgeIds: asStringArray(value.knowledgeIds),
  };
};

const parseItems = (value: unknown): CodeGraphItem[] => (
  Array.isArray(value)
    ? value.map(parseItem).filter((item): item is CodeGraphItem => item !== null)
    : []
);

const parseGraphNode = (value: unknown): CodeGraphNode | null => {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || !value.id) return null;
  return {
    id: value.id,
    kind: typeof value.kind === 'string' && value.kind ? value.kind : 'node',
    subject: value.subject === true,
    ...(typeof value.name === 'string' && value.name ? { name: value.name } : {}),
    ...(typeof value.file === 'string' && value.file ? { file: value.file } : {}),
    ...(typeof value.line === 'number' && Number.isFinite(value.line) ? { line: value.line } : {}),
  };
};

/**
 * Wire ego-graph carried by subject-bearing answers. Null when the answer
 * carries no drawable topology — the panel states the absence instead of
 * drawing an empty canvas. Parallel sites collapse into one directed edge
 * with a site count; edges with an unknown endpoint are dropped, never
 * given an invented node.
 */
export const parseGraph = (value: unknown): CodeGraphTopology | null => {
  if (!isRecord(value)) return null;
  if (typeof value.subjectId !== 'string' || !value.subjectId) return null;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;
  const nodes: CodeGraphNode[] = [];
  for (const entry of value.nodes) {
    const node = parseGraphNode(entry);
    if (node) nodes.push(node);
  }
  if (nodes.length === 0) return null;
  const known = new Set(nodes.map((node) => node.id));
  const merged = new Map<string, CodeGraphEdge>();
  for (const entry of value.edges) {
    if (!isRecord(entry)) continue;
    const { from, to, kind } = entry;
    if (typeof from !== 'string' || typeof to !== 'string' || typeof kind !== 'string') continue;
    if (!known.has(from) || !known.has(to)) continue;
    const confidence = typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
      ? entry.confidence
      : 1;
    const key = `${from}|${to}|${kind}`;
    const existing = merged.get(key);
    if (existing) {
      existing.sites += 1;
      existing.confidence = Math.max(existing.confidence, confidence);
    } else {
      merged.set(key, {
        id: typeof entry.id === 'string' && entry.id ? entry.id : key,
        kind,
        from,
        to,
        confidence,
        sites: 1,
      });
    }
  }
  return {
    subjectId: value.subjectId,
    nodes,
    edges: [...merged.values()],
    truncated: value.truncated === true,
  };
};

const parseBinding = (value: unknown): CodeGraphFreshnessBinding => {
  if (!isRecord(value)) {
    throw new Error('Malformed code graph response');
  }
  if (typeof value.projectId !== 'string' || typeof value.worktreeId !== 'string') {
    throw new Error('Malformed code graph response');
  }
  if (typeof value.revision !== 'string' || typeof value.fingerprint !== 'string') {
    throw new Error('Malformed code graph response');
  }
  if (value.freshness !== 'fresh' && value.freshness !== 'stale') {
    throw new Error('Malformed code graph response');
  }
  if (typeof value.observedAtMs !== 'number' || typeof value.staleAfterMs !== 'number') {
    throw new Error('Malformed code graph response');
  }
  return {
    projectId: value.projectId,
    worktreeId: value.worktreeId,
    revision: value.revision,
    fingerprint: value.fingerprint,
    freshness: value.freshness,
    observedAtMs: value.observedAtMs,
    staleAfterMs: value.staleAfterMs,
    ...(typeof value.staleReason === 'string' ? { staleReason: value.staleReason } : {}),
    ...(typeof value.refreshError === 'string' ? { refreshError: value.refreshError } : {}),
    ...(value.truncated === true ? { truncated: true as const } : {}),
  };
};

const parseModules = (value: unknown): CodeGraphModule[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const out: CodeGraphModule[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (typeof entry.name !== 'string' || !entry.name) continue;
    const count = (key: string): number => (
      typeof entry[key] === 'number' && Number.isFinite(entry[key]) ? entry[key] : 0
    );
    const samples: CodeGraphModule['sampleSymbols'] = [];
    if (Array.isArray(entry.sampleSymbols)) {
      for (const sample of entry.sampleSymbols) {
        if (!isRecord(sample)) continue;
        if (typeof sample.id !== 'string' || typeof sample.file !== 'string') continue;
        samples.push({
          id: sample.id,
          file: sample.file,
          ...(typeof sample.name === 'string' && sample.name ? { name: sample.name } : {}),
          ...(typeof sample.line === 'number' && Number.isFinite(sample.line) ? { line: sample.line } : {}),
        });
      }
    }
    out.push({
      name: entry.name,
      fileCount: count('fileCount'),
      testFileCount: count('testFileCount'),
      symbolCount: count('symbolCount'),
      edgeCount: count('edgeCount'),
      sampleSymbols: samples,
    });
  }
  return out;
};

const parseTrail = (value: unknown): CodeGraphTrailStep[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const out: CodeGraphTrailStep[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (typeof entry.from !== 'string' || typeof entry.to !== 'string') continue;
    if (typeof entry.ref !== 'string') continue;
    out.push({
      from: entry.from,
      to: entry.to,
      ref: entry.ref,
      confidence: typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
        ? entry.confidence
        : 1,
    });
  }
  return out;
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
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isRecord(payload)) {
    return { ok: false, reason: `resolve-failed-${response.status}` };
  }
  return {
    ok: payload.ok === true,
    ...(typeof payload.absolute === 'string' ? { absolute: payload.absolute } : {}),
    ...(typeof payload.projectRelative === 'string' ? { projectRelative: payload.projectRelative } : {}),
    ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
    ...(typeof payload.snapshotRoot === 'string' ? { snapshotRoot: payload.snapshotRoot } : {}),
  };
};

/** Scope binding plus counts. Read before any symbol query to render freshness first. */
export const fetchCodeGraphIndex = async (
  directory: string | null | undefined,
  options: { signal?: AbortSignal; refresh?: boolean } = {},
): Promise<CodeGraphIndexSummary> => {
  const resolved = requireDirectory(directory);
  const response = await runtimeFetch(`${BASE_PATH}/index`, {
    query: { directory: resolved, ...(options.refresh ? { refresh: '1' } : {}) },
    directory: resolved,
    cache: 'no-store',
    signal: options.signal,
  });
  if (!response.ok) {
    return failed(response, 'Failed to load code graph index');
  }
  const payload = (await response.json()) as Record<string, unknown> | null;
  if (!isRecord(payload)) {
    throw new Error('Malformed code graph response');
  }
  return {
    ...parseBinding(payload),
    ...(typeof payload.binding === 'string' ? { binding: payload.binding } : {}),
    ...(typeof payload.snapshotRoot === 'string' && payload.snapshotRoot
      ? { snapshotRoot: payload.snapshotRoot }
      : {}),
    nodeCount: typeof payload.nodeCount === 'number' ? payload.nodeCount : 0,
    edgeCount: typeof payload.edgeCount === 'number' ? payload.edgeCount : 0,
    entryCount: typeof payload.entryCount === 'number' ? payload.entryCount : 0,
  };
};

/** One engine query with the freshness binding attached to every row. */
export const queryCodeGraph = async (
  directory: string | null | undefined,
  input: CodeGraphQueryInput,
): Promise<CodeGraphQueryResult> => {
  const resolved = requireDirectory(directory);
  const response = await runtimeFetch(`${BASE_PATH}/query`, {
    query: {
      directory: resolved,
      kind: input.kind,
      ...(input.symbol ? { symbol: input.symbol } : {}),
      ...(input.query ? { q: input.query } : {}),
      ...(input.target ? { target: input.target } : {}),
      ...(input.file ? { file: input.file } : {}),
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
      ...(input.limit !== undefined ? { limit: String(input.limit) } : {}),
      ...(input.refresh ? { refresh: '1' } : {}),
    },
    directory: resolved,
    cache: 'no-store',
    signal: input.signal,
  });
  if (!response.ok) {
    return failed(response, 'Failed to query code graph');
  }
  const payload = (await response.json()) as Record<string, unknown> | null;
  if (!isRecord(payload)) {
    throw new Error('Malformed code graph response');
  }
  const coverage = payload.coverage;
  if (coverage !== 'indexed' && coverage !== 'partial' && coverage !== 'unindexed') {
    throw new Error('Malformed code graph response');
  }
  const maybeItems = (key: string): CodeGraphItem[] | undefined => (
    payload[key] === undefined ? undefined : parseItems(payload[key])
  );
  return {
    ...parseBinding(payload),
    coverage,
    ...(typeof payload.snapshotRoot === 'string' && payload.snapshotRoot
      ? { snapshotRoot: payload.snapshotRoot }
      : {}),
    knowledgeIds: asStringArray(payload.knowledgeIds),
    unresolved: asStringArray(payload.unresolved),
    unsupported: asStringArray(payload.unsupported),
    items: parseItems(payload.items),
    ...(maybeItems('callers') ? { callers: maybeItems('callers') } : {}),
    ...(maybeItems('callees') ? { callees: maybeItems('callees') } : {}),
    ...(maybeItems('impacted') ? { impacted: maybeItems('impacted') } : {}),
    ...(maybeItems('candidates') ? { candidates: maybeItems('candidates') } : {}),
    ...(payload.subject !== undefined
      ? (() => {
        const subject = parseItem(payload.subject);
        return subject ? { subject } : {};
      })()
      : {}),
    ...(payload.definition !== undefined
      ? (() => {
        const definition = parseItem(payload.definition);
        return definition ? { definition } : {};
      })()
      : {}),
    ...(() => {
      const graph = parseGraph(payload.graph);
      return graph ? { graph } : {};
    })(),
    ...(() => {
      const modules = parseModules(payload.modules);
      return modules ? { modules } : {};
    })(),
    ...(() => {
      const path = parseTrail(payload.path);
      return path ? { path } : {};
    })(),
  };
};
