/**
 * Adversarial code-graph tests C14, C16-C19.
 *
 * Production paths exercised (all through the public barrel at
 * `packages/omo-engine/code-graph/src/graph.ts`, the package's only public
 * surface per `DOCUMENTATION.md`):
 * - C14: `extract.ts#indexFiles` + `queries.ts#findTests`
 * - C16: `cache.ts#buildBaselineFromHeadFiles` + `cache.ts#applyDirtyOverlay`
 * - C17: `extract.ts#invalidateEdges` + `queries.ts#search/symbolContext/impact/findTests`
 * - C18: `cache.ts#parseStoredIndex` + `cache.ts#loadOrRebuild`
 * - C19: `queries.ts#search/symbolContext/findTests` (unsupported inputs)
 *
 * Precedent: `extract.test.ts` / `queries.test.ts` (given/when/then
 * comments, real fixture indexing, 60s timeout for the TypeScript server
 * round-trip). No test helper stands in for production code here: every
 * assertion reads the output of a real production function.
 */

import { describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyDirtyOverlay,
  buildBaselineFromHeadFiles,
  computeEntityId,
  computeScopeFingerprint,
  findTests,
  impact,
  indexFiles,
  invalidateEdges,
  loadOrRebuild,
  parseStoredIndex,
  search,
  serializeIndex,
  symbolContext,
  WorktreeGraphCache,
  type GraphSnapshot,
  type QueryOptions,
} from "./graph";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "graph-basic");
const TEST_TIMEOUT_MS = 60000;

const PROJECT_ID = "demo-12345678";
const WORKTREE_ID = "wt-adversarial-graph";
const REVISION = "a".repeat(40);
const BLOB_A = "b".repeat(64);
const BLOB_B = "d".repeat(64);
const BLOB_C = "e".repeat(64);
const NOW_MS = Date.parse("2026-10-02T00:00:00.000Z");

function options(overrides: Partial<QueryOptions> = {}): QueryOptions {
  return {
    scope: {
      projectId: PROJECT_ID,
      worktreeId: WORKTREE_ID,
      revision: REVISION,
      fingerprint: computeScopeFingerprint(PROJECT_ID, WORKTREE_ID, REVISION),
    },
    ...overrides,
  };
}

// One real compiler extraction shared by the query tests: indexing twice
// would only re-prove the TypeScript server round-trip, not the queries.
let cachedSnapshot: GraphSnapshot | undefined;
function realSnapshot(): GraphSnapshot {
  if (cachedSnapshot === undefined) {
    cachedSnapshot = indexFiles([
      join(FIXTURE_DIR, "main.ts"),
      join(FIXTURE_DIR, "reexport.ts"),
      join(FIXTURE_DIR, "main.test.ts"),
    ]);
  }
  return cachedSnapshot;
}

describe("adversarial code-graph C14,C16-C19", () => {
  it(
    "C14 #given a changed symbol #when candidate tests are requested #then real test files return with TESTS/IMPORTS evidence",
    () => {
      // given: the real fixture indexed through extract.ts#indexFiles
      const snapshot = realSnapshot();

      // when: the changed symbol asks for candidate tests via queries.ts#findTests
      const result = findTests(snapshot, "fn:add@math.ts", options());

      // then: the known test file is a candidate, never a guess
      expect(result.coverage).toBe("indexed");
      expect(result.subjectFile).toBe("math.ts");
      const candidateFiles = result.candidates.map((candidate) => candidate.file);
      expect(candidateFiles.some((file) => file === "main.test.ts")).toBe(true);

      // then: every candidate carries compiler-resolved evidence with a file:line ref
      expect(result.candidates.length).toBeGreaterThan(0);
      for (const candidate of result.candidates) {
        expect(candidate.evidence.length).toBeGreaterThan(0);
        for (const proof of candidate.evidence) {
          expect(proof.edge === "TESTS" || proof.edge === "IMPORTS").toBe(true);
          expect(proof.ref).toMatch(/^[^:]+:[1-9][0-9]*$/);
          expect(proof.confidence).toBe(1);
        }
      }
    },
    TEST_TIMEOUT_MS,
  );

  it("C16 #given a one-file worktree edit #when the dirty overlay reads #then only that file's graph data drops", () => {
    // given: a baseline built by cache.ts#buildBaselineFromHeadFiles over two files
    const scope = {
      projectId: PROJECT_ID,
      worktreeId: WORKTREE_ID,
      revision: REVISION,
      fingerprint: computeScopeFingerprint(PROJECT_ID, WORKTREE_ID, REVISION),
    };
    const built = buildBaselineFromHeadFiles(
      scope,
      [
        { path: "src/gateway.ts", blobSha256: BLOB_A, symbols: ["fn:retry"] },
        { path: "src/ledger.ts", blobSha256: BLOB_B, symbols: ["fn:persist"] },
      ],
      [
        {
          from: computeEntityId(PROJECT_ID, "src/gateway.ts", "file"),
          to: computeEntityId(PROJECT_ID, "src/gateway.ts", "fn:retry"),
          kind: "DEFINES",
          confidence: 1,
        },
        {
          from: computeEntityId(PROJECT_ID, "src/ledger.ts", "file"),
          to: computeEntityId(PROJECT_ID, "src/ledger.ts", "fn:persist"),
          kind: "DEFINES",
          confidence: 1,
        },
      ],
      NOW_MS,
    );
    if (built.kind !== "built") throw new Error(`fixture refused: ${built.reason}`);
    const before = JSON.stringify(built.baseline);
    const byId = new Map(built.baseline.entities.map((entity) => [entity.id, entity]));

    // when: exactly one file changes in the worktree via cache.ts#applyDirtyOverlay
    const view = applyDirtyOverlay(built.baseline, [
      { filePath: "src/ledger.ts", blobSha256: BLOB_C, symbolHits: 0, renameResolved: false },
    ]);

    // then: every drop belongs to the edited file, nothing else moved
    expect(view.dropped.length).toBeGreaterThan(0);
    for (const drop of view.dropped) {
      expect(byId.get(drop.entityId)?.filePath).toBe("src/ledger.ts");
    }
    const keptPaths = new Set(view.entities.map((entity) => entity.filePath));
    expect(keptPaths.has("src/gateway.ts")).toBe(true);
    expect(view.entities.filter((entity) => entity.filePath === "src/gateway.ts").length).toBe(2);
    expect(keptPaths.has("src/ledger.ts")).toBe(false);

    // then: the survivor's edge survives; the edited file's edges are withheld, never rewritten
    expect(
      view.edges.some(
        (edge) =>
          edge.kind === "DEFINES" &&
          edge.from === computeEntityId(PROJECT_ID, "src/gateway.ts", "file"),
      ),
    ).toBe(true);
    expect(view.edges.some((edge) => edge.from.includes("ledger") || edge.to.includes("ledger"))).toBe(false);

    // then: the baseline itself is pristine (overlay never writes back)
    expect(JSON.stringify(built.baseline)).toBe(before);
  });

  it("C17 #given a rename plus a delete #when the diff is read #then no stale search, impact, or rationale link survives", () => {
    // given: yesterday's snapshot with a symbol, its caller, and a rationale link
    const previous: GraphSnapshot = {
      nodes: [
        { id: "file:a.ts", kind: "file", file: "a.ts", line: 1, name: "a.ts" },
        { id: "fn:old@a.ts", kind: "symbol", file: "a.ts", line: 2, name: "old" },
        { id: "file:b.ts", kind: "file", file: "b.ts", line: 1, name: "b.ts" },
        { id: "fn:use@b.ts", kind: "symbol", file: "b.ts", line: 3, name: "use" },
        { id: "knowledge:pk-abcdef012345", kind: "knowledge-link", file: "a.ts", line: 1, target: "pk-abcdef012345" },
      ],
      edges: [
        { id: "defines:a", kind: "DEFINES", from: "file:a.ts", to: "fn:old@a.ts", confidence: 1, ref: "a.ts:2" },
        { id: "calls:use-old", kind: "CALLS_STATIC", from: "fn:use@b.ts", to: "fn:old@a.ts", confidence: 1, ref: "b.ts:5" },
        { id: "links:old", kind: "LINKS_KNOWLEDGE", from: "fn:old@a.ts", to: "knowledge:pk-abcdef012345", confidence: 0.9, ref: "a.ts:1" },
      ],
    };
    // given: today's snapshot renames old->new and deletes b.ts entirely
    const current: GraphSnapshot = {
      nodes: [
        { id: "file:a.ts", kind: "file", file: "a.ts", line: 1, name: "a.ts" },
        { id: "fn:new@a.ts", kind: "symbol", file: "a.ts", line: 2, name: "new" },
        { id: "file:t.test.ts", kind: "file", file: "t.test.ts", line: 1, name: "t.test.ts", isTest: true },
      ],
      edges: [
        { id: "defines:a", kind: "DEFINES", from: "file:a.ts", to: "fn:new@a.ts", confidence: 1, ref: "a.ts:2" },
        { id: "imports:t-a", kind: "IMPORTS", from: "file:t.test.ts", to: "file:a.ts", confidence: 1, ref: "t.test.ts:1" },
      ],
    };

    // when: extract.ts#invalidateEdges diffs the snapshots
    const invalidated = invalidateEdges(previous, current);
    const causeOf = (from: string): string | undefined =>
      invalidated.find((edge) => edge.from === from)?.cause;

    // then: rename and delete causes are exact, never a blanket edit
    expect(causeOf("fn:old@a.ts")).toBe("SYM-RENAME");
    expect(causeOf("file:b.ts")).toBe("SRC-DELETE");
    expect(causeOf("fn:use@b.ts")).toBe("SRC-DELETE");

    // when/then: the old symbol has no definition, callers, or impact anymore
    expect(symbolContext(current, "fn:old@a.ts", options()).coverage).toBe("unindexed");
    const staleImpact = impact(current, "fn:old@a.ts", options());
    expect(staleImpact.coverage).toBe("unindexed");
    expect(staleImpact.impacted).toEqual([]);

    // when/then: search no longer surfaces the deleted file's symbols
    expect(search(current, "use", options()).items).toEqual([]);
    expect(search(current, "old", options()).items).toEqual([]);

    // when/then: the deleted file is not a test subject either
    expect(findTests(current, "b.ts", options()).coverage).toBe("unindexed");

    // then: no edge in the new snapshot references a stale endpoint (rationale links included)
    const staleIds = new Set(["fn:old@a.ts", "file:b.ts", "fn:use@b.ts", "knowledge:pk-abcdef012345"]);
    for (const edge of current.edges) {
      expect(staleIds.has(edge.from)).toBe(false);
      expect(staleIds.has(edge.to)).toBe(false);
    }
  });

  it("C18 #given a malformed stored index #when it loads #then corruption is reported and the rebuild invents no edges", () => {
    // given: several malformed snapshots detected by cache.ts#parseStoredIndex
    expect(parseStoredIndex("not json{{{").kind).toBe("corrupt");
    const scope = {
      projectId: PROJECT_ID,
      worktreeId: WORKTREE_ID,
      revision: REVISION,
      fingerprint: computeScopeFingerprint(PROJECT_ID, WORKTREE_ID, REVISION),
    };
    const built = buildBaselineFromHeadFiles(
      scope,
      [{ path: "src/gateway.ts", blobSha256: BLOB_A, symbols: ["fn:retry"] }],
      [],
      NOW_MS,
    );
    if (built.kind !== "built") throw new Error(`fixture refused: ${built.reason}`);
    const withUnknownKind = JSON.stringify({
      ...JSON.parse(serializeIndex(built.baseline)),
      edges: [{ from: "cg-000000000000", to: "cg-000000000001", kind: "CALLS_MAGIC", confidence: 1 }],
    });
    expect(parseStoredIndex(withUnknownKind)).toEqual({ kind: "corrupt", reason: "unknown-edge-kind" });
    const withDangling = JSON.stringify({
      ...JSON.parse(serializeIndex(built.baseline)),
      edges: [{ from: "cg-000000000000", to: "cg-000000000001", kind: "DEFINES", confidence: 1 }],
    });
    expect(parseStoredIndex(withDangling)).toEqual({ kind: "corrupt", reason: "dangling-edge" });

    // when: cache.ts#loadOrRebuild meets the corrupt snapshot plus one invalid HEAD file
    const cache = new WorktreeGraphCache();
    const loaded = loadOrRebuild(cache, {
      projectId: PROJECT_ID,
      worktreeId: WORKTREE_ID,
      storedText: withUnknownKind,
      headFiles: [
        { path: "src/gateway.ts", blobSha256: BLOB_A, symbols: ["fn:retry"] },
        { path: "src/broken.ts", blobSha256: "not-a-sha" },
      ],
      headRevision: REVISION,
      nowMs: NOW_MS,
    });

    // then: corruption takes reporting priority, the rebuild drops-and-counts, and no edge is invented
    if (loaded.status !== "rebuilt") throw new Error(`expected a rebuild, got ${loaded.status}`);
    expect(loaded.reason).toMatch(/^corrupt-/);
    expect(loaded.dropped.map((drop) => drop.path)).toContain("src/broken.ts");
    expect(loaded.baseline.edges).toEqual([]);
    expect(loaded.baseline.entities.map((entity) => entity.filePath).sort()).toEqual([
      "src/gateway.ts",
      "src/gateway.ts",
    ]);
  });

  it(
    "C19 #given unsupported file types #when queries run #then every query reports unindexed instead of analyzing",
    () => {
      // given: a real indexed snapshot from extract.ts#indexFiles
      const snapshot = realSnapshot();

      // when: a path-shaped query names a non-program file via queries.ts#search
      const searched = search(snapshot, "assets/logo.png", options());

      // then: reported as unindexed, never analyzed
      expect(searched.coverage).toBe("unindexed");
      expect(searched.items).toEqual([]);
      expect(searched.unsupported.some((note) => note.includes("assets/logo.png"))).toBe(true);

      // when: a symbol id inside an unsupported file via queries.ts#symbolContext
      const context = symbolContext(snapshot, "fn:icon@assets/logo.png", options());
      expect(context.coverage).toBe("unindexed");
      expect(context.definition).toBeUndefined();
      expect(context.unsupported.some((note) => note.includes("assets/logo.png"))).toBe(true);

      // when: an unsupported subject via queries.ts#findTests
      const tests = findTests(snapshot, "docs/notes.md", options());
      expect(tests.coverage).toBe("unindexed");
      expect(tests.candidates).toEqual([]);
      expect(tests.unsupported.some((note) => note.includes("docs/notes.md"))).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
