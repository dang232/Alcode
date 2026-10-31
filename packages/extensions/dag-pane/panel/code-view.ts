// Pure Code-view helpers for the dag-pane panel (ulw-slice72-c, no DOM).
//
// The panel's Code view reads the proven service routes from slice72-b:
// `GET /codegraph/index` first (freshness chip), then `GET /codegraph/query`
// for search / symbol / file subjects. Everything here is pure so it stays
// unit-testable in bun:test without a browser; `panel/main.ts` owns fetching
// and painting, these helpers own shaping and rules.

import { isWireRecord, wireString } from './dag-view.ts';

export type CodeItemKind = 'symbol' | 'file' | 'other';

export type CodeTaskRow = { id: string; label: string };

export type CodeIndexStatus =
  | 'disconnected'
  | 'loading'
  | 'error'
  | 'indexing'
  | 'empty'
  | 'stale'
  | 'ready';

export type CodeQueryStatus = 'loading' | 'error' | 'empty' | 'ready';

export type CodeFreshnessChip = {
  revision: string;
  shortRevision: string;
  fingerprint: string;
  shortFingerprint: string;
  freshness: string;
  binding: string;
  /** Single-line chip text: freshness + binding + short revision + short fingerprint. */
  text: string;
};

const BACKTICK_SPAN = /`([^`]+)`/;
const SYMBOL_ID = /^(?:fn|class|const):[^\s`'"]+@[^\s`'"]+/;
const FILE_ID = /^file:[^\s`'"]+/;
// First code-looking token: backtick spans win; otherwise a namespaced
// symbol, a file id, a dotted path, or a snake_case / camelCase word.
// Plain prose words never match, so a label with no code shape answers
// null instead of firing a nonsense search.
const TOKEN_PATTERN = /(?:fn|class|const):[^\s`'"]+|file:[^\s`'"]+|[A-Za-z_][\w$./-]*\.[A-Za-z]{1,4}(?::\d+)?|[A-Za-z_][\w$]*_[\w$]+|[a-z]+[A-Z][\w$]*|[A-Z][a-z]+[A-Z][\w$]*/;

const shortHex = (value: string, length = 8): string => (
  value.length > length ? value.slice(0, length) : value
);

/**
 * The single code token for a task label. A backtick span wins (its first
 * whitespace-separated token); otherwise the first code-looking token in
 * the raw label. Exactly one token or null — never a token list — so the
 * panel fires exactly one `kind=search` query per task-to-code jump.
 * Prose labels with no code shape answer null (honest unavailable).
 */
export const extractCodeToken = (label: string): string | null => {
  const ticked = BACKTICK_SPAN.exec(label);
  if (ticked) {
    const first = ticked[1].trim().split(/\s+/)[0] ?? '';
    const shaped = TOKEN_PATTERN.exec(first);
    return shaped ? shaped[0] : first.length > 0 ? first : null;
  }
  const shaped = TOKEN_PATTERN.exec(label);
  return shaped ? shaped[0] : null;
};

/**
 * Task-to-code rule: navigation fires ONLY from recorded engine rows.
 * `rows` are the run nodes the engine actually reported (what the Run view
 * painted); `selectedId` is the current node selection. A selection that
 * matches a recorded row is navigable (with its single token, which may
 * itself be null for prose labels); anything else — no selection, unknown
 * id, empty rows — is unavailable, and the panel offers normal exploration
 * (manual search + browse) instead of guessing.
 */
export const taskToCodeSource = (
  rows: readonly CodeTaskRow[],
  selectedId: string | null,
): { available: false } | { available: true; row: CodeTaskRow; token: string | null } => {
  if (selectedId === null) {
    return { available: false };
  }
  const row = rows.find((entry) => entry.id === selectedId);
  if (!row) {
    return { available: false };
  }
  return { available: true, row, token: extractCodeToken(row.label) };
};

/** A search query for one token: `GET /codegraph/query?kind=search&q=<token>`. */
export const buildSearchQuery = (
  directory: string,
  token: string,
): { path: string; query: Record<string, string> } => (
  { path: '/codegraph/query', query: { directory, kind: 'search', q: token } }
);

/**
 * A symbol select fires three queries — context + impact + tests — each
 * with the symbol as its subject (`symbol` for context/impact, `target`
 * for tests, mirroring the web route contract).
 */
export const buildSymbolQueries = (
  directory: string,
  symbol: string,
): { path: string; query: Record<string, string> }[] => ([
  { path: '/codegraph/query', query: { directory, kind: 'context', symbol } },
  { path: '/codegraph/query', query: { directory, kind: 'impact', symbol } },
  { path: '/codegraph/query', query: { directory, kind: 'tests', target: symbol } },
]);

/** A file select fires one file query with the `file:<rel>` id as subject. */
export const buildFileQuery = (
  directory: string,
  file: string,
): { path: string; query: Record<string, string> } => (
  { path: '/codegraph/query', query: { directory, kind: 'file', file } }
);

/**
 * Classify a result-row id for select behavior: engine symbol ids
 * (`fn:…@…`, `class:…@…`, `const:…@…`) load context+impact+tests, file ids
 * (`file:…`) load the file projection, anything else renders as-is with no
 * invented follow-up query.
 */
export const classifyCodeItemId = (id: string): CodeItemKind => {
  if (SYMBOL_ID.test(id)) {
    return 'symbol';
  }
  if (FILE_ID.test(id)) {
    return 'file';
  }
  return 'other';
};

export type CodeIndexBody = {
  revision?: unknown;
  fingerprint?: unknown;
  freshness?: unknown;
  binding?: unknown;
  nodeCount?: unknown;
  ready?: unknown;
  indexState?: unknown;
};

// Every job state after `queued` and before a terminal one: the build holds no
// published graph yet, so an index body carrying one of these is in progress.
// `persisting` is included because the graph exists but is not published.
const BUILD_IN_PROGRESS_STATES = new Set(['queued', 'discovering', 'analyzing', 'persisting']);

/**
 * True while the runtime reports a build that has not published. The body is
 * authoritative: `ready` comes from the answer itself, and `indexState.state`
 * names the phase. A body without either field predates the lifecycle and
 * reads as finished, so only a stated build counts.
 */
export const isCodeIndexBuilding = (index: CodeIndexBody): boolean => {
  if (index.ready === false) {
    return true;
  }
  if (!isWireRecord(index.indexState)) {
    return false;
  }
  const state = wireString(index.indexState.state);
  return state !== null && BUILD_IN_PROGRESS_STATES.has(state);
};

/**
 * Freshness chip parts from a `/codegraph/index` body. Missing fields read
 * as `—` (honest, never invented); short forms are the first 8 chars for
 * the one-line chip, full values stay available for the detail rows.
 */
export const formatFreshnessChip = (index: CodeIndexBody): CodeFreshnessChip => {
  const revision = typeof index.revision === 'string' && index.revision.length > 0 ? index.revision : '—';
  const fingerprint = typeof index.fingerprint === 'string' && index.fingerprint.length > 0 ? index.fingerprint : '—';
  const freshness = typeof index.freshness === 'string' && index.freshness.length > 0 ? index.freshness : '—';
  const binding = typeof index.binding === 'string' && index.binding.length > 0 ? index.binding : '—';
  return {
    revision,
    shortRevision: revision === '—' ? '—' : shortHex(revision),
    fingerprint,
    shortFingerprint: fingerprint === '—' ? '—' : shortHex(fingerprint),
    freshness,
    binding,
    text: `${freshness} · ${binding} · rev ${revision === '—' ? '—' : shortHex(revision)} · fp ${fingerprint === '—' ? '—' : shortHex(fingerprint)}`,
  };
};

/**
 * The Code view index state. `connected` is engine reachability from the
 * pane's own `/status` read; a fetch failure is `error`, never an empty
 * success; `stale` still renders the chip plus a refresh offer; `indexing`
 * means the build is still running and has published nothing; `empty` means
 * a finished index answered with zero nodes.
 *
 * A zero-node body only reads as `empty` once the build says it is done. An
 * in-progress body also carries zero nodes (and `freshness: 'unindexed'`), so
 * classifying it as empty told the user "no symbols here" about a directory
 * whose symbols were being extracted at that moment.
 */
export const resolveCodeIndexStatus = (input: {
  connected: boolean;
  error: string | null;
  index: CodeIndexBody | null;
}): CodeIndexStatus => {
  if (!input.connected) {
    return 'disconnected';
  }
  if (input.error !== null) {
    return 'error';
  }
  if (input.index === null) {
    return 'loading';
  }
  // A stale answer is a real published generation being superseded; its chip
  // is the honest report, even while the newer build runs.
  if (input.index.freshness === 'stale') {
    return 'stale';
  }
  if (isCodeIndexBuilding(input.index)) {
    return 'indexing';
  }
  if (typeof input.index.nodeCount === 'number' && input.index.nodeCount === 0) {
    return 'empty';
  }
  return 'ready';
};

/**
 * One query-result state. `unindexed` coverage and zero items are both
 * honest empties; a backend failure is `error`, never a fake empty list.
 * The panel never invents progress, edges, or explanations for any state.
 */
export const resolveCodeQueryStatus = (input: {
  error: string | null;
  result: { coverage?: unknown; items?: unknown } | null;
}): CodeQueryStatus => {
  if (input.error !== null) {
    return 'error';
  }
  if (input.result === null) {
    return 'loading';
  }
  if (input.result.coverage === 'unindexed') {
    return 'empty';
  }
  if (Array.isArray(input.result.items)) {
    return input.result.items.length === 0 ? 'empty' : 'ready';
  }
  return 'empty';
};

export type CodeGraphNodeView = {
  id: string;
  label: string;
  kind: string;
  file: string | null;
  line: number | null;
  subject: boolean;
};

export type CodeGraphEdgeView = {
  from: string;
  to: string;
  kind: string;
  confidence: number;
  /** Call/import sites that produced this one directed edge. */
  sites: number;
};

export type CodeGraphModel = {
  subjectId: string;
  nodes: CodeGraphNodeView[];
  edges: CodeGraphEdgeView[];
  truncated: boolean;
};

const labelFromId = (id: string, max = 20): string => {
  const at = id.indexOf('@');
  const head = at === -1 ? id : id.slice(0, at);
  const colon = head.indexOf(':');
  const tail = colon === -1 ? head : head.slice(colon + 1);
  return tail.length > max ? `${tail.slice(0, max - 1)}…` : tail;
};

/** A file node reads as its basename: the box shows identity, the inspector the full path. */
const baseName = (value: string, max = 20): string => {
  const tail = value.split('/').filter((part) => part.length > 0).pop() ?? value;
  return tail.length > max ? `${tail.slice(0, max - 1)}…` : tail;
};

const wireStringField = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const wireNumberField = (record: Record<string, unknown>, key: string): number | null => {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/**
 * The wire ego-graph (`graph`) carried by a subject-bearing code-graph
 * answer. Null when the answer has no graph — the panel then states the
 * absence instead of drawing an empty canvas. Parallel call sites collapse
 * into one directed edge with a site count; every node and edge still comes
 * from the snapshot the engine indexed, never from a guess.
 */
export const buildCodeGraphModel = (body: { graph?: unknown } | null): CodeGraphModel | null => {
  if (body === null) {
    return null;
  }
  const graph = body.graph;
  if (typeof graph !== 'object' || graph === null || Array.isArray(graph)) {
    return null;
  }
  const record = graph as Record<string, unknown>;
  const subjectId = wireStringField(record, 'subjectId');
  const rawNodes = Array.isArray(record.nodes) ? record.nodes : [];
  const rawEdges = Array.isArray(record.edges) ? record.edges : [];
  if (subjectId === null || rawNodes.length === 0) {
    return null;
  }
  const nodes: CodeGraphNodeView[] = [];
  for (const entry of rawNodes) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const node = entry as Record<string, unknown>;
    const id = wireStringField(node, 'id');
    if (id === null) continue;
    const name = wireStringField(node, 'name');
    const kind = wireStringField(node, 'kind') ?? 'node';
    nodes.push({
      id,
      label: kind === 'file' ? baseName(name ?? id) : name ?? labelFromId(id),
      kind,
      file: wireStringField(node, 'file'),
      line: wireNumberField(node, 'line'),
      subject: node.subject === true,
    });
  }
  if (nodes.length === 0) {
    return null;
  }
  const known = new Set(nodes.map((node) => node.id));
  const merged = new Map<string, CodeGraphEdgeView>();
  for (const entry of rawEdges) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const edge = entry as Record<string, unknown>;
    const from = wireStringField(edge, 'from');
    const to = wireStringField(edge, 'to');
    const kind = wireStringField(edge, 'kind');
    if (from === null || to === null || kind === null) continue;
    if (!known.has(from) || !known.has(to)) continue;
    const key = `${from}|${to}|${kind}`;
    const confidence = wireNumberField(edge, 'confidence') ?? 1;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, { from, to, kind, confidence, sites: 1 });
    } else {
      existing.sites += 1;
      existing.confidence = Math.max(existing.confidence, confidence);
    }
  }
  return {
    subjectId,
    nodes,
    edges: [...merged.values()],
    truncated: record.truncated === true,
  };
};

export const CODE_NODE_WIDTH = 168;
export const CODE_NODE_HEIGHT = 44;
export const CODE_COLUMN_GAP = 96;
export const CODE_ROW_GAP = 18;

export type CodeGraphDrawnNode = CodeGraphNodeView & { x: number; y: number; width: number; height: number };
export type CodeGraphDrawnEdge = CodeGraphEdgeView & { x1: number; y1: number; x2: number; y2: number };
export type CodeGraphLayoutSpec = {
  nodes: CodeGraphDrawnNode[];
  edges: CodeGraphDrawnEdge[];
  width: number;
  height: number;
};

/**
 * Three-column dependency layout: callers/importers on the left, the
 * subject in the middle, dependents on the right. Column membership comes
 * from the directed edges themselves, so the picture states which way a
 * relationship points instead of flattening it into a star.
 */
export const codeGraphLayoutSpec = (model: CodeGraphModel): CodeGraphLayoutSpec => {
  const inbound = new Set<string>();
  const outbound = new Set<string>();
  for (const edge of model.edges) {
    if (edge.to === model.subjectId && edge.from !== model.subjectId) inbound.add(edge.from);
    if (edge.from === model.subjectId && edge.to !== model.subjectId) outbound.add(edge.to);
  }
  const left = [...inbound].filter((id) => !outbound.has(id));
  const right = [...outbound].filter((id) => !inbound.has(id));
  // A node reached in both directions (imports plus defines, say) belongs in
  // neither filtered column; it is placed with the dependents so its
  // back-edge crosses the subject instead of disappearing.
  const placed = new Set([...left, ...right, model.subjectId]);
  const rest = model.nodes
    .map((node) => node.id)
    .filter((id) => !placed.has(id));
  right.push(...rest);
  const columns = [left, [model.subjectId], right];
  const rows = Math.max(...columns.map((column) => column.length));
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const nodes: CodeGraphDrawnNode[] = [];
  columns.forEach((column, columnIndex) => {
    const offset = (rows - column.length) / 2;
    column.forEach((id, rowIndex) => {
      const node = byId.get(id);
      if (node === undefined) return;
      nodes.push({
        ...node,
        x: CODE_COLUMN_GAP + columnIndex * (CODE_NODE_WIDTH + CODE_COLUMN_GAP),
        y: CODE_COLUMN_GAP / 2 + (rowIndex + offset) * (CODE_NODE_HEIGHT + CODE_ROW_GAP),
        width: CODE_NODE_WIDTH,
        height: CODE_NODE_HEIGHT,
      });
    });
  });
  const at = new Map(nodes.map((node) => [node.id, node]));
  const edges: CodeGraphDrawnEdge[] = [];
  for (const edge of model.edges) {
    const from = at.get(edge.from);
    const to = at.get(edge.to);
    if (from === undefined || to === undefined) continue;
    edges.push({
      ...edge,
      x1: from.x + from.width,
      y1: from.y + from.height / 2,
      x2: to.x,
      y2: to.y + to.height / 2,
    });
  }
  return {
    nodes,
    edges,
    width: columns.length * (CODE_NODE_WIDTH + CODE_COLUMN_GAP) + CODE_COLUMN_GAP,
    height: rows * (CODE_NODE_HEIGHT + CODE_ROW_GAP) + CODE_COLUMN_GAP,
  };
};
