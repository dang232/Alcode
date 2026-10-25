import { describe, expect, it } from "bun:test";
import {
  GRAPH_EDGE_KINDS,
  GRAPH_ENTITY_KINDS,
  STALE_AFTER_MS,
  computeEntityId,
  computeScopeFingerprint,
  isEdgeConfidence,
  isEdgeKind,
  maxEdgeConfidence,
  type GraphEdge,
  type GraphScopeKey,
} from "./schema";
import {
  applyDirtyOverlay,
  buildBaselineFromHeadFiles,
  loadOrRebuild,
  parseStoredIndex,
  serializeIndex,
  WorktreeGraphCache,
  type HeadFile,
} from "./cache";

const PROJECT_A = "demo-12345678";
const PROJECT_B = "other-abcdef12";
const WORKTREE_A = "wt-alpha";
const WORKTREE_B = "wt-beta";
const REVISION_A = "a".repeat(40);
const REVISION_B = "c".repeat(40);
const BLOB_A = "b".repeat(64);
const BLOB_B = "d".repeat(64);
const NOW_MS = Date.parse("2026-10-02T00:00:00.000Z");
const KNOWLEDGE_ID = "pk-abcdef012345";

function scopeFor(projectId: string, worktreeId: string, revision: string): GraphScopeKey {
  return {
    projectId,
    worktreeId,
    revision,
    fingerprint: computeScopeFingerprint(projectId, worktreeId, revision),
  };
}

function gatewayFiles(): HeadFile[] {
  return [
    { path: "src/gateway.ts", blobSha256: BLOB_A, symbols: ["fn:retry"] },
    { path: "src/ledger.ts", blobSha256: BLOB_B },
  ];
}

function mustBuild(scope: GraphScopeKey, files: HeadFile[], candidates: GraphEdge[] = []) {
  const result = buildBaselineFromHeadFiles(scope, files, candidates, NOW_MS);
  if (result.kind !== "built") throw new Error(`fixture refused: ${result.reason}`);
  return result.baseline;
}

function gatewayDefinesRetry(): GraphEdge {
  return {
    from: computeEntityId(PROJECT_A, "src/gateway.ts", "file"),
    to: computeEntityId(PROJECT_A, "src/gateway.ts", "fn:retry"),
    kind: "DEFINES",
    confidence: 1,
  };
}

function ledgerLinksRecord(): GraphEdge {
  return {
    from: computeEntityId(PROJECT_A, "src/ledger.ts", "file"),
    to: KNOWLEDGE_ID,
    kind: "LINKS_KNOWLEDGE",
    confidence: 0.9,
  };
}

describe("code-graph freshness cache", () => {
  it("#given dirty worktree edits #when the overlay reads #then the baseline stays pristine", () => {
    // given
    const cache = new WorktreeGraphCache();
    const scope = scopeFor(PROJECT_A, WORKTREE_A, REVISION_A);
    const baseline = mustBuild(scope, gatewayFiles(), [gatewayDefinesRetry()]);
    cache.store(baseline);
    const before = JSON.stringify(baseline);

    // when (one edit rewrites a file, one deletes a file)
    const view = applyDirtyOverlay(baseline, [
      { filePath: "src/gateway.ts", blobSha256: BLOB_B, symbolHits: 1, renameResolved: false },
      { filePath: "src/ledger.ts", blobSha256: null, symbolHits: 0, renameResolved: false },
    ]);

    // then (the overlay hides the edited and deleted entities with their cases)
    expect(view.entities).toEqual([]);
    expect(view.dropped.map((drop) => drop.reason)).toEqual(["SRC-EDIT", "SRC-EDIT", "SRC-DELETE"]);
    expect(view.edges).toEqual([]);
    // and (the baseline never takes the write: same entities, same edge, same bytes)
    expect(JSON.stringify(baseline)).toBe(before);
    expect(cache.get(PROJECT_A, WORKTREE_A)?.entities).toHaveLength(3);
    expect(cache.get(PROJECT_A, WORKTREE_A)?.edges).toEqual([gatewayDefinesRetry()]);
  });

  it("#given baselines in two worktrees and two projects #when each reads #then results stay separate", () => {
    // given
    const cache = new WorktreeGraphCache();
    cache.store(mustBuild(scopeFor(PROJECT_A, WORKTREE_A, REVISION_A), [
      { path: "src/gateway.ts", blobSha256: BLOB_A },
    ]));
    cache.store(mustBuild(scopeFor(PROJECT_A, WORKTREE_B, REVISION_A), [
      { path: "src/ledger.ts", blobSha256: BLOB_B },
    ]));
    cache.store(mustBuild(scopeFor(PROJECT_B, WORKTREE_A, REVISION_A), [
      { path: "src/gateway.ts", blobSha256: BLOB_A },
    ]));

    // when
    const fromWorktreeA = cache.read(PROJECT_A, WORKTREE_A, REVISION_A, NOW_MS);
    const fromWorktreeB = cache.read(PROJECT_A, WORKTREE_B, REVISION_A, NOW_MS);
    const fromProjectB = cache.read(PROJECT_B, WORKTREE_A, REVISION_A, NOW_MS);

    // then (each scope serves only its own entities)
    if (fromWorktreeA.status !== "hit") throw new Error("expected hit");
    if (fromWorktreeB.status !== "hit") throw new Error("expected hit");
    if (fromProjectB.status !== "hit") throw new Error("expected hit");
    expect(fromWorktreeA.baseline.entities.map((entity) => entity.filePath)).toEqual(["src/gateway.ts"]);
    expect(fromWorktreeB.baseline.entities.map((entity) => entity.filePath)).toEqual(["src/ledger.ts"]);
    expect(fromProjectB.baseline.entities.map((entity) => entity.filePath)).toEqual(["src/gateway.ts"]);
    // and (the same path under another project is another entity)
    expect(fromWorktreeA.baseline.entities[0]?.id).not.toBe(fromProjectB.baseline.entities[0]?.id);
    // and (a miss is empty, never an error and never another scope's data)
    expect(cache.read(PROJECT_B, WORKTREE_B, REVISION_A, NOW_MS)).toEqual({ status: "miss" });
    expect(cache.get("nope-12345678", WORKTREE_A)).toBeUndefined();
  });

  it("#given a changed source #when reads run #then stale data is never served", () => {
    // given
    const cache = new WorktreeGraphCache();
    const baseline = mustBuild(scopeFor(PROJECT_A, WORKTREE_A, REVISION_A), gatewayFiles(), [
      gatewayDefinesRetry(),
      ledgerLinksRecord(),
    ]);
    cache.store(baseline);

    // when (HEAD moved past the pinned revision)
    const moved = cache.read(PROJECT_A, WORKTREE_A, REVISION_B, NOW_MS);

    // then (stale, with no baseline attached)
    expect(moved.status).toBe("stale");
    if (moved.status !== "stale") throw new Error("expected stale");
    expect(moved.reason).toBe("HEAD-MOVE");
    expect("baseline" in moved).toBe(false);

    // when (evidence aged past 7 days at the same HEAD)
    const aged = cache.read(PROJECT_A, WORKTREE_A, REVISION_A, NOW_MS + STALE_AFTER_MS + 1);

    // then
    expect(aged.status).toBe("stale");
    if (aged.status !== "stale") throw new Error("expected stale");
    expect(aged.reason).toBe("EVID-STALE");

    // when (the worktree rewrote a file under the same revision)
    const view = applyDirtyOverlay(baseline, [
      { filePath: "src/gateway.ts", blobSha256: BLOB_B, symbolHits: 1, renameResolved: false },
    ]);

    // then (the edited entities vanish before they can be served stale;
    // the knowledge link from the surviving file stays, its target is external)
    expect(view.entities.map((entity) => entity.filePath)).toEqual(["src/ledger.ts"]);
    expect(view.edges).toEqual([ledgerLinksRecord()]);
    expect(view.dropped.map((drop) => drop.reason)).toEqual(["SRC-EDIT", "SRC-EDIT"]);
  });

  it("#given a corrupted stored index #when it loads #then it is detected and rebuilt with no invented edges", () => {
    // given
    const baseline = mustBuild(scopeFor(PROJECT_A, WORKTREE_A, REVISION_A), gatewayFiles(), [
      gatewayDefinesRetry(),
    ]);
    const stored = serializeIndex(baseline);
    const parsed = parseStoredIndex(stored);
    if (parsed.kind !== "index") throw new Error("fixture index should parse");
    expect(parsed.baseline).toEqual(baseline);

    // when (an unknown kind is smuggled into the snapshot)
    const tamperedKind = JSON.stringify({ ...JSON.parse(stored), edges: [{ ...gatewayDefinesRetry(), kind: "deletes" }] });
    // and (an id is tampered so it no longer derives from its content)
    const tamperedId = JSON.stringify({
      ...JSON.parse(stored),
      entities: [{ ...parsed.baseline.entities[0], id: "cg-000000000000" }],
    });

    // then (both are detected, never loaded)
    expect(parseStoredIndex(tamperedKind)).toEqual({ kind: "corrupt", reason: "unknown-edge-kind" });
    expect(parseStoredIndex(tamperedId)).toEqual({ kind: "corrupt", reason: "id-mismatch" });
    expect(parseStoredIndex(stored.slice(0, 24))).toEqual({ kind: "corrupt", reason: "unparseable" });

    // when (loading through the corrupted snapshot)
    const cache = new WorktreeGraphCache();
    const loaded = loadOrRebuild(cache, {
      projectId: PROJECT_A,
      worktreeId: WORKTREE_A,
      storedText: tamperedKind,
      headFiles: gatewayFiles(),
      headRevision: REVISION_A,
      nowMs: NOW_MS,
    });

    // then (rebuilt from HEAD files: same entities, zero edges — none invented)
    if (loaded.status !== "rebuilt") throw new Error("expected rebuild");
    expect(loaded.reason).toBe("corrupt-unknown-edge-kind");
    expect(loaded.baseline.entities).toHaveLength(3);
    expect(loaded.baseline.edges).toEqual([]);
    expect(loaded.dropped).toEqual([]);
    expect(cache.get(PROJECT_A, WORKTREE_A)?.entities).toHaveLength(3);
  });

  it("#given the binding edge set #when edges validate #then only the eight kinds hold with their confidence rules", () => {
    // given (the exact closed set from schema-draft section 2)
    expect(GRAPH_EDGE_KINDS).toEqual([
      "DEFINES",
      "IMPORTS",
      "CALLS_STATIC",
      "CALLS_UNRESOLVED",
      "EXPORTS",
      "TESTS",
      "LINKS_KNOWLEDGE",
      "INVALIDATED_BY",
    ]);
    expect(GRAPH_ENTITY_KINDS).toEqual(["file", "symbol"]);

    // then (the old vocabulary is rejected, the binding one holds)
    expect(isEdgeKind("contains")).toBe(false);
    expect(isEdgeKind("CALLS_STATIC")).toBe(true);
    // and (unresolved dynamics cap at 0.50 and are never proven)
    expect(maxEdgeConfidence("CALLS_UNRESOLVED")).toBe(0.5);
    expect(maxEdgeConfidence("DEFINES")).toBe(1);
    expect(isEdgeConfidence("CALLS_UNRESOLVED", 0.5)).toBe(true);
    expect(isEdgeConfidence("CALLS_UNRESOLVED", 0.51)).toBe(false);
    expect(isEdgeConfidence("DEFINES", 0.9)).toBe(false);
    expect(isEdgeConfidence("DEFINES", 1)).toBe(true);
    // and (knowledge links inherit the record confidence unchanged)
    expect(isEdgeConfidence("LINKS_KNOWLEDGE", 0.9)).toBe(true);

    // when (candidates mix valid edges with drift, dangling, and over-cap edges)
    const uncertain: GraphEdge = {
      from: computeEntityId(PROJECT_A, "src/gateway.ts", "fn:retry"),
      to: "cg-ffffffffffff",
      kind: "CALLS_UNRESOLVED",
      confidence: 0.5,
    };
    const invalidated: GraphEdge = {
      from: computeEntityId(PROJECT_A, "src/ledger.ts", "file"),
      to: "SRC-EDIT",
      kind: "INVALIDATED_BY",
      confidence: 1,
    };
    const candidates: GraphEdge[] = JSON.parse(
      JSON.stringify([
        gatewayDefinesRetry(),
        { ...gatewayDefinesRetry(), kind: "deletes" },
        {
          from: computeEntityId(PROJECT_A, "src/gateway.ts", "file"),
          to: "cg-ffffffffffff",
          kind: "CALLS_STATIC",
          confidence: 1,
        },
        { ...uncertain, confidence: 0.9 },
        uncertain,
        ledgerLinksRecord(),
        invalidated,
      ]),
    );
    const result = buildBaselineFromHeadFiles(scopeFor(PROJECT_A, WORKTREE_A, REVISION_A), gatewayFiles(), candidates, NOW_MS);

    // then (only rule-passing edges survive; the rest drop with their case)
    if (result.kind !== "built") throw new Error("expected build");
    expect(result.baseline.edges).toEqual([gatewayDefinesRetry(), uncertain, ledgerLinksRecord(), invalidated]);
    expect(result.dropped.map((drop) => drop.reason)).toEqual([
      "unknown-edge-kind",
      "dangling-edge",
      "invalid-confidence",
    ]);
  });
});
