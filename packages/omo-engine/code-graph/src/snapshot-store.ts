/**
 * Snapshot store codec: the persisted shape of a served `GraphSnapshot`.
 *
 * `cache.ts` persists a `StoredBaseline` — entities keyed by
 * `(projectId, filePath, symbol)` with content fingerprints. That model cannot
 * represent what the server serves: node ids carry the line
 * (`fn:name@apps/web/src/x.ts:12`), entities carry none, and the content index
 * `searchContent` reads has no baseline counterpart. Converting between them
 * would lose the line numbers the panel opens source with, so this module
 * persists the snapshot itself, split per file.
 *
 * Sharding is what makes the store useful beyond a single blob: one file's
 * shard answers a change to that file, so incremental reuse has a unit to keep
 * or drop, and a large repository's restore is many small parses instead of one
 * 348 MB string.
 *
 * Invariants:
 * - A manifest is the only entry point; an unknown `version` is refused, never
 *   guessed at, and a shard that fails to parse is reported as corrupt.
 * - Shards are grouped by the file their node id belongs to, so a node and its
 *   edges stay together; an edge whose owner file is unknown lands in
 *   `UNATTRIBUTED_SHARD` rather than being dropped.
 * - Joining preserves every node and edge exactly once (order across files is
 *   the manifest's order, which is deterministic).
 */
import type { ContentSkip, FileContentEntry, GraphScopeKey } from "./schema";
import type { DroppedFile, GraphEdge, GraphNode, GraphSnapshot } from "./extract";

export const SNAPSHOT_STORE_VERSION = 1;
export const UNATTRIBUTED_SHARD = "__unattributed__";

export interface SnapshotShard {
  readonly file: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly content?: FileContentEntry;
}

export interface SnapshotManifest {
  readonly version: typeof SNAPSHOT_STORE_VERSION;
  readonly scope: GraphScopeKey;
  readonly observedAtMs: number;
  readonly entryCap: number;
  readonly entryCount: number;
  readonly root: string | null;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly contentTokenCap: number | null;
  readonly contentSkipped: readonly ContentSkip[];
  readonly dropped: readonly DroppedFile[];
  readonly shards: readonly string[];
}

export type ParseSnapshotManifest =
  | { readonly kind: "manifest"; readonly manifest: SnapshotManifest }
  | { readonly kind: "corrupt"; readonly reason: string };

export type ParseSnapshotShard =
  | { readonly kind: "shard"; readonly shard: SnapshotShard }
  | { readonly kind: "corrupt"; readonly reason: string };

/** The file a node id belongs to: `file:x` is the file itself, `fn:v@x:12` is `x`. */
function fileOfNodeId(id: string): string | null {
  if (id.startsWith("file:")) return id.slice("file:".length);
  const at = id.lastIndexOf("@");
  if (at < 0) return null;
  const withLine = id.slice(at + 1);
  const colon = withLine.lastIndexOf(":");
  const file = colon < 0 ? withLine : withLine.slice(0, colon);
  return file.length > 0 ? file : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function splitSnapshotIntoShards(snapshot: GraphSnapshot): SnapshotShard[] {
  const order: string[] = [];
  const seenInOrder = new Set<string>();
  const nodesByFile = new Map<string, GraphNode[]>();
  const edgesByFile = new Map<string, GraphEdge[]>();
  // One key appears once in the manifest, however many node and edge maps it
  // lands in: a second registration would emit the same shard twice and double
  // the joined totals.
  const register = (key: string) => {
    if (seenInOrder.has(key)) return;
    seenInOrder.add(key);
    order.push(key);
  };
  for (const node of snapshot.nodes) {
    const key = fileOfNodeId(node.id) ?? UNATTRIBUTED_SHARD;
    register(key);
    const bucket = nodesByFile.get(key);
    if (bucket) bucket.push(node);
    else nodesByFile.set(key, [node]);
  }
  for (const edge of snapshot.edges) {
    const key = fileOfNodeId(edge.from) ?? UNATTRIBUTED_SHARD;
    register(key);
    const bucket = edgesByFile.get(key);
    if (bucket) bucket.push(edge);
    else edgesByFile.set(key, [edge]);
  }
  const contentFiles = snapshot.content?.files ?? {};
  for (const file of Object.keys(contentFiles)) {
    if (!nodesByFile.has(file) && !edgesByFile.has(file)) order.push(file);
  }
  return order.map((file) => {
    const nodes = nodesByFile.get(file) ?? [];
    const edges = edgesByFile.get(file) ?? [];
    const content = contentFiles[file];
    return content === undefined ? { file, nodes, edges } : { file, nodes, edges, content };
  });
}

export function createSnapshotManifest(
  snapshot: GraphSnapshot,
  meta: { scope: GraphScopeKey; observedAtMs: number; entryCap: number; entryCount: number },
): SnapshotManifest {
  return {
    version: SNAPSHOT_STORE_VERSION,
    scope: meta.scope,
    observedAtMs: meta.observedAtMs,
    entryCap: meta.entryCap,
    entryCount: meta.entryCount,
    root: snapshot.root ?? null,
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
    contentTokenCap: snapshot.content?.tokenCap ?? null,
    contentSkipped: snapshot.content?.skipped ?? [],
    dropped: snapshot.dropped ?? [],
    shards: splitSnapshotIntoShards(snapshot).map((shard) => shard.file),
  };
}

export function serializeSnapshotShard(shard: SnapshotShard): string {
  return JSON.stringify(shard);
}

export function serializeSnapshotManifest(manifest: SnapshotManifest): string {
  return JSON.stringify(manifest);
}

export function parseSnapshotManifest(text: string): ParseSnapshotManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "corrupt", reason: "manifest is not JSON" };
  }
  if (!isRecord(parsed)) return { kind: "corrupt", reason: "manifest is not an object" };
  if (parsed.version !== SNAPSHOT_STORE_VERSION) {
    return { kind: "corrupt", reason: `unsupported manifest version: ${String(parsed.version)}` };
  }
  const scope = parsed.scope;
  if (!isRecord(scope)) return { kind: "corrupt", reason: "manifest has no scope" };
  const scopeKeys = ["projectId", "worktreeId", "revision", "fingerprint"] as const;
  for (const key of scopeKeys) {
    if (typeof scope[key] !== "string" || String(scope[key]).length === 0) {
      return { kind: "corrupt", reason: `scope.${key} is missing` };
    }
  }
  if (!Array.isArray(parsed.shards) || parsed.shards.some((entry) => typeof entry !== "string")) {
    return { kind: "corrupt", reason: "manifest shards are not a string list" };
  }
  if (!Number.isFinite(parsed.nodeCount) || !Number.isFinite(parsed.edgeCount)) {
    return { kind: "corrupt", reason: "manifest counts are not numbers" };
  }
  return {
    kind: "manifest",
    manifest: {
      version: SNAPSHOT_STORE_VERSION,
      scope: {
        projectId: String(scope.projectId),
        worktreeId: String(scope.worktreeId),
        revision: String(scope.revision),
        fingerprint: String(scope.fingerprint),
      },
      observedAtMs: Number.isFinite(parsed.observedAtMs) ? Number(parsed.observedAtMs) : 0,
      entryCap: Number.isFinite(parsed.entryCap) ? Number(parsed.entryCap) : 0,
      entryCount: Number.isFinite(parsed.entryCount) ? Number(parsed.entryCount) : 0,
      root: typeof parsed.root === "string" ? parsed.root : null,
      nodeCount: Number(parsed.nodeCount),
      edgeCount: Number(parsed.edgeCount),
      contentTokenCap: Number.isFinite(parsed.contentTokenCap) ? Number(parsed.contentTokenCap) : null,
      contentSkipped: Array.isArray(parsed.contentSkipped) ? (parsed.contentSkipped as ContentSkip[]) : [],
      dropped: Array.isArray(parsed.dropped) ? (parsed.dropped as DroppedFile[]) : [],
      shards: parsed.shards as string[],
    },
  };
}

export function parseSnapshotShard(text: string): ParseSnapshotShard {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "corrupt", reason: "shard is not JSON" };
  }
  if (!isRecord(parsed)) return { kind: "corrupt", reason: "shard is not an object" };
  if (typeof parsed.file !== "string") return { kind: "corrupt", reason: "shard has no file" };
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    return { kind: "corrupt", reason: "shard has no node/edge arrays" };
  }
  const shard: SnapshotShard = {
    file: parsed.file,
    nodes: parsed.nodes as GraphNode[],
    edges: parsed.edges as GraphEdge[],
    ...(isRecord(parsed.content) ? { content: parsed.content as unknown as FileContentEntry } : {}),
  };
  return { kind: "shard", shard };
}

/**
 * Rebuilds the snapshot from a manifest and its shards. A shard count that does
 * not match the manifest means the store is torn, which is reported instead of
 * serving a graph with silently missing files.
 */
export function joinSnapshotShards(
  manifest: SnapshotManifest,
  shards: readonly SnapshotShard[],
): { kind: "snapshot"; snapshot: GraphSnapshot } | { kind: "torn"; reason: string } {
  if (shards.length !== manifest.shards.length) {
    return { kind: "torn", reason: `expected ${manifest.shards.length} shards, found ${shards.length}` };
  }
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const files: Record<string, FileContentEntry> = {};
  for (const shard of shards) {
    // Element-wise, never spread: a shard for a large file holds enough nodes to
    // exceed the argument limit, and a spread would throw instead of restoring.
    for (const node of shard.nodes) nodes.push(node);
    for (const edge of shard.edges) edges.push(edge);
    if (shard.content !== undefined) files[shard.file] = shard.content;
  }
  if (nodes.length !== manifest.nodeCount || edges.length !== manifest.edgeCount) {
    return {
      kind: "torn",
      reason: `shard totals ${nodes.length}/${edges.length} do not match manifest ${manifest.nodeCount}/${manifest.edgeCount}`,
    };
  }
  const snapshot: GraphSnapshot = {
    nodes,
    edges,
    ...(manifest.root === null ? {} : { root: manifest.root }),
    ...(manifest.contentTokenCap === null
      ? {}
      : { content: { tokenCap: manifest.contentTokenCap, files, skipped: manifest.contentSkipped } }),
    ...(manifest.dropped.length > 0 ? { dropped: manifest.dropped } : {}),
  };
  return { kind: "snapshot", snapshot };
}
