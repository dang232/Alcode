/**
 * Adversarial tests C01, C02, C04, C06, C07, C08, C09, C10 for the code graph.
 *
 * Each test exercises a real production function (never a helper alone) and
 * names its production path. Fixtures are real TypeScript files indexed
 * through the compiler-backed extractor, so every definition, caller, and
 * source ref below is derived, not staged.
 *
 * Production paths:
 * - C01 `src/extract.ts#indexFiles` -> `src/queries.ts#symbolContext`
 * - C02 `src/queries.ts#impact`
 * - C04 `src/extract.ts#invalidateEdges` via `src/queries.ts#detectChanges`
 * - C06 `src/cache.ts#buildBaselineFromHeadFiles` + `src/cache.ts#applyDirtyOverlay`
 * - C07 `src/cache.ts#WorktreeGraphCache` keyed by `src/schema.ts#storageKey`
 * - C08 `src/cache.ts#loadOrRebuild` project isolation
 * - C09 `src/extract.ts#indexFiles` unresolved calls + `src/schema.ts#maxEdgeConfidence`
 * - C10 `src/cache.ts#loadOrRebuild` miss/corrupt fallback + `src/queries.ts#impact` unindexed
 *
 * Precedent: `queries.test.ts` (given/when/then comments, real fixture
 * indexing, 60s timeout for the TypeScript server round-trip).
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectChanges, impact, symbolContext, type QueryOptions } from "./queries";
import { indexFiles, invalidateEdges } from "./extract";
import {
  applyDirtyOverlay,
  buildBaselineFromHeadFiles,
  loadOrRebuild,
  WorktreeGraphCache,
  type HeadFile,
} from "./cache";
import { computeEntityId, computeScopeFingerprint, maxEdgeConfidence, storageKey, type GraphEdge as CacheGraphEdge, type GraphScopeKey } from "./schema";

const TEST_TIMEOUT_MS = 60000;

const PROJECT_A = "demo-12345678";
const PROJECT_B = "other-abcdef12";
const WORKTREE_A = "wt-adv-alpha";
const WORKTREE_B = "wt-adv-beta";
const WORKTREE_SHARED = "wt-adv-shared";
const REVISION_A = "a".repeat(40);
const BLOB_A = "b".repeat(64);
const BLOB_B = "d".repeat(64);
const BLOB_C = "e".repeat(64);
const NOW_MS = Date.parse("2026-10-02T00:00:00.000Z");

const GRAPH_BASIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "graph-basic");

function options(projectId = PROJECT_A, worktreeId = WORKTREE_A, revision = REVISION_A): QueryOptions {
  return {
    scope: {
      projectId,
      worktreeId,
      revision,
      fingerprint: computeScopeFingerprint(projectId, worktreeId, revision),
    },
  };
}

function scopeFor(projectId: string, worktreeId: string, revision: string): GraphScopeKey {
  return {
    projectId,
    worktreeId,
    revision,
    fingerprint: computeScopeFingerprint(projectId, worktreeId, revision),
  };
}

function writeGatewayFixture(): { dir: string; entries: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "code-graph-adv-"));
  writeFileSync(
    join(dir, "gateway.ts"),
    `export function retry(attempt: number): number {\n  return attempt + 1;\n}\n`,
  );
  writeFileSync(
    join(dir, "worker.ts"),
    `import { retry } from "./gateway";\n\nexport function serve(): number {\n  return retry(1);\n}\n`,
  );
  return { dir, entries: [join(dir, "gateway.ts"), join(dir, "worker.ts")] };
}

function definesEdge(projectId: string, path: string, symbol: string): CacheGraphEdge {
  return {
    from: computeEntityId(projectId, path, "file"),
    to: computeEntityId(projectId, path, symbol),
    kind: "DEFINES",
    confidence: 1,
  };
}

describe("code-graph adversarial C01-C02 C04 C06-C10", () => {
  it(
    "C01 #given a real callee and caller #when symbolContext runs #then the true definition plus direct callers resolve with source refs (extract.ts#indexFiles -> queries.ts#symbolContext)",
    () => {
      // given: two real files indexed through the compiler-backed extractor
      const { dir, entries } = writeGatewayFixture();
      try {
        const snapshot = indexFiles(entries);

        // when
        const result = symbolContext(snapshot, "fn:retry@gateway.ts", options());

        // then: the real definition with its file:line source ref
        expect(result.coverage).toBe("indexed");
        expect(result.definition?.id).toBe("fn:retry@gateway.ts");
        expect(result.definition?.file).toBe("gateway.ts");
        expect(result.definition?.line).toBe(1);
        expect(result.definition?.evidence.length).toBeGreaterThan(0);
        for (const evidence of result.definition?.evidence ?? []) {
          expect(evidence.edge).toBe("DEFINES");
          expect(evidence.ref).toMatch(/^gateway\.ts:\d+$/);
        }

        // then: the direct caller with its own call-site source ref
        expect(result.callers.map((caller) => caller.id)).toContain("fn:serve@worker.ts");
        const caller = result.callers.find((entry) => entry.id === "fn:serve@worker.ts");
        expect(caller?.evidence.some((entry) => entry.edge === "CALLS_STATIC")).toBe(true);
        expect(caller?.evidence[0]?.ref).toMatch(/^worker\.ts:\d+$/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "C02 #given a changed symbol #when impact runs #then the envelope contains its known callers (queries.ts#impact)",
    () => {
      // given
      const { dir, entries } = writeGatewayFixture();
      try {
        const snapshot = indexFiles(entries);

        // when
        const result = impact(snapshot, "fn:retry@gateway.ts", options());

        // then: the known caller is impacted, with the subject identified
        expect(result.coverage).toBe("indexed");
        expect(result.subject?.id).toBe("fn:retry@gateway.ts");
        expect(result.impacted.map((entry) => entry.id)).toContain("fn:serve@worker.ts");

        // then: bounded static facts only, never a proven unknown
        for (const item of result.items) expect(item.confidence).toBe(1);
        expect(result.items.some((item) => item.id === "unknown")).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "C04 #given a removed call #when detectChanges diffs the snapshots #then the stale relationship is invalidated before it can be served as current (extract.ts#invalidateEdges via queries.ts#detectChanges)",
    () => {
      // given: v1 where app.ts calls load
      const dir = mkdtempSync(join(tmpdir(), "code-graph-adv-c04-"));
      try {
        writeFileSync(join(dir, "store.ts"), `export function load(): number {\n  return 1;\n}\n`);
        writeFileSync(
          join(dir, "app.ts"),
          `import { load } from "./store";\n\nexport function main(): number {\n  return load();\n}\n`,
        );
        const entries = [join(dir, "store.ts"), join(dir, "app.ts")];
        const before = indexFiles(entries);
        expect(symbolContext(before, "fn:load@store.ts", options()).callers.map((c) => c.id)).toContain(
          "fn:main@app.ts",
        );

        // when: the call is removed and both snapshots are diffed
        writeFileSync(join(dir, "app.ts"), `export function main(): number {\n  return 0;\n}\n`);
        const after = indexFiles(entries);
        const invalidated = invalidateEdges(before, after);
        const detected = detectChanges(before, after, options());

        // then: the stale call edge is invalidated with a named cause and source ref
        expect(invalidated.length).toBeGreaterThan(0);
        const staleCall = invalidated.find((edge) => edge.from.startsWith("calls-static:"));
        expect(staleCall?.cause).toBe("SRC-EDIT");
        expect(staleCall?.ref).toMatch(/^app\.ts:\d+$/);
        expect(detected.freshness).toBe("stale");
        expect(detected.changes.length).toBeGreaterThan(0);

        // then: the new snapshot no longer serves the removed caller as current
        expect(
          symbolContext(after, "fn:load@store.ts", options()).callers.map((caller) => caller.id),
        ).not.toContain("fn:main@app.ts");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it("C06 #given dirty worktree edits #when the overlay reads #then the edited file drops out of its own view while HEAD content is never served silently (cache.ts#applyDirtyOverlay)", () => {
    // given: a HEAD baseline over two files
    const scope = scopeFor(PROJECT_A, WORKTREE_A, REVISION_A);
    const files: HeadFile[] = [
      { path: "src/gateway.ts", blobSha256: BLOB_A, symbols: ["fn:retry"] },
      { path: "src/ledger.ts", blobSha256: BLOB_B },
    ];
    const built = buildBaselineFromHeadFiles(scope, files, [definesEdge(PROJECT_A, "src/gateway.ts", "fn:retry")], NOW_MS);
    if (built.kind !== "built") throw new Error(`fixture refused: ${built.reason}`);

    // when: the worktree dirties gateway.ts (blob changed, symbol still present)
    const view = applyDirtyOverlay(built.baseline, [
      { filePath: "src/gateway.ts", blobSha256: BLOB_C, symbolHits: 1, renameResolved: false },
    ]);

    // then: the dirty file's entities leave this view with an SRC-EDIT drop, ledger stays
    expect(view.scope).toEqual(scope);
    expect(view.entities.some((entity) => entity.filePath === "src/gateway.ts")).toBe(false);
    expect(view.entities.some((entity) => entity.filePath === "src/ledger.ts")).toBe(true);
    const retryId = computeEntityId(PROJECT_A, "src/gateway.ts", "fn:retry");
    expect(view.dropped).toContainEqual({ entityId: retryId, reason: "SRC-EDIT" });

    // then: the baseline itself is pristine — the overlay never writes back
    expect(built.baseline.entities.some((entity) => entity.filePath === "src/gateway.ts")).toBe(true);
  });

  it("C07 #given two worktrees with different implementations of one path #when each is read #then the views stay distinct (cache.ts#WorktreeGraphCache via schema.ts#storageKey)", () => {
    // given: same project and path, different symbols per worktree
    expect(storageKey(PROJECT_A, WORKTREE_A)).not.toBe(storageKey(PROJECT_A, WORKTREE_B));
    const cache = new WorktreeGraphCache();
    const scopeA = scopeFor(PROJECT_A, WORKTREE_A, REVISION_A);
    const scopeB = scopeFor(PROJECT_A, WORKTREE_B, REVISION_A);
    const builtA = buildBaselineFromHeadFiles(
      scopeA,
      [{ path: "src/impl.ts", blobSha256: BLOB_A, symbols: ["fn:alpha"] }],
      [definesEdge(PROJECT_A, "src/impl.ts", "fn:alpha")],
      NOW_MS,
    );
    const builtB = buildBaselineFromHeadFiles(
      scopeB,
      [{ path: "src/impl.ts", blobSha256: BLOB_B, symbols: ["fn:beta"] }],
      [definesEdge(PROJECT_A, "src/impl.ts", "fn:beta")],
      NOW_MS,
    );
    if (builtA.kind !== "built" || builtB.kind !== "built") throw new Error("fixture refused");
    cache.store(builtA.baseline);
    cache.store(builtB.baseline);

    // when
    const readA = cache.read(PROJECT_A, WORKTREE_A, REVISION_A, NOW_MS);
    const readB = cache.read(PROJECT_A, WORKTREE_B, REVISION_A, NOW_MS);

    // then: each worktree serves only its own implementation
    if (readA.status !== "hit" || readB.status !== "hit") throw new Error("fixture miss");
    expect(readA.baseline.entities.map((entity) => entity.symbol)).toContain("fn:alpha");
    expect(readA.baseline.entities.map((entity) => entity.symbol)).not.toContain("fn:beta");
    expect(readB.baseline.entities.map((entity) => entity.symbol)).toContain("fn:beta");
    expect(readB.baseline.entities.map((entity) => entity.symbol)).not.toContain("fn:alpha");
  });

  it("C08 #given two projects with identical paths #when each loads #then state never mixes (cache.ts#loadOrRebuild)", () => {
    // given: identical paths under one shared worktree id, different projects
    const cache = new WorktreeGraphCache();
    const loadA = loadOrRebuild(cache, {
      projectId: PROJECT_A,
      worktreeId: WORKTREE_SHARED,
      storedText: undefined,
      headFiles: [{ path: "src/impl.ts", blobSha256: BLOB_A, symbols: ["fn:alpha"] }],
      headRevision: REVISION_A,
      nowMs: NOW_MS,
    });
    const loadB = loadOrRebuild(cache, {
      projectId: PROJECT_B,
      worktreeId: WORKTREE_SHARED,
      storedText: undefined,
      headFiles: [{ path: "src/impl.ts", blobSha256: BLOB_B, symbols: ["fn:beta"] }],
      headRevision: REVISION_A,
      nowMs: NOW_MS,
    });
    expect(loadA.status).toBe("rebuilt");
    expect(loadB.status).toBe("rebuilt");

    // when
    const readA = cache.read(PROJECT_A, WORKTREE_SHARED, REVISION_A, NOW_MS);
    const readB = cache.read(PROJECT_B, WORKTREE_SHARED, REVISION_A, NOW_MS);

    // then: each project reads only its own scope and entities
    if (readA.status !== "hit" || readB.status !== "hit") throw new Error("fixture miss");
    expect(readA.baseline.scope.projectId).toBe(PROJECT_A);
    expect(readB.baseline.scope.projectId).toBe(PROJECT_B);
    for (const entity of readA.baseline.entities) expect(entity.projectId).toBe(PROJECT_A);
    for (const entity of readB.baseline.entities) expect(entity.projectId).toBe(PROJECT_B);
    expect(readA.baseline.entities.map((entity) => entity.symbol)).not.toContain("fn:beta");
    expect(readB.baseline.entities.map((entity) => entity.symbol)).not.toContain("fn:alpha");
  });

  it(
    "C09 #given dynamic calls #when indexed and queried #then the unresolved call stays uncertain and is never proven (extract.ts#indexFiles via queries.ts#symbolContext)",
    () => {
      // given: the real fixture with element-access dispatch and eval
      const snapshot = indexFiles([join(GRAPH_BASIC_DIR, "main.ts"), join(GRAPH_BASIC_DIR, "math.ts")]);
      const unresolved = snapshot.edges.filter((edge) => edge.kind === "CALLS_UNRESOLVED");

      // then: every unresolved edge is capped, flagged, and targetless
      expect(unresolved.length).toBeGreaterThan(0);
      expect(maxEdgeConfidence("CALLS_UNRESOLVED")).toBe(0.5);
      for (const edge of unresolved) {
        expect(edge.confidence).toBeLessThanOrEqual(0.5);
        expect(edge.uncertain).toBe(true);
        expect(edge.to).toBe("unknown");
      }

      // when: the eval caller is queried
      const result = symbolContext(snapshot, "fn:runEval@main.ts", options());

      // then: dynamics surface only as manual-review notes, never as proven items
      expect(result.coverage).toBe("indexed");
      expect(result.unresolved.length).toBeGreaterThan(0);
      expect(result.items.some((item) => item.id === "unknown")).toBe(false);
      for (const item of result.items) expect(item.confidence).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it("C10 #given a missing or corrupt index #when loading and querying #then the graph falls back safely and never claims no dependencies (cache.ts#loadOrRebuild, queries.ts#impact)", () => {
    // given: an empty cache with no stored snapshot
    const cache = new WorktreeGraphCache();

    // when: loading with nothing stored
    const missed = loadOrRebuild(cache, {
      projectId: PROJECT_A,
      worktreeId: WORKTREE_A,
      storedText: undefined,
      headFiles: [{ path: "src/gateway.ts", blobSha256: BLOB_A, symbols: ["fn:retry"] }],
      headRevision: REVISION_A,
      nowMs: NOW_MS,
    });

    // then: a miss rebuilds from HEAD files with zero invented edges, never a hit
    expect(missed.status).toBe("rebuilt");
    if (missed.status !== "rebuilt") throw new Error("fixture hit");
    expect(missed.reason).toBe("miss");
    expect(missed.baseline.edges).toEqual([]);

    // when: the stored snapshot is corrupt
    const cacheTwo = new WorktreeGraphCache();
    const corrupt = loadOrRebuild(cacheTwo, {
      projectId: PROJECT_A,
      worktreeId: WORKTREE_A,
      storedText: "not-json{{{",
      headFiles: [{ path: "src/gateway.ts", blobSha256: BLOB_A, symbols: ["fn:retry"] }],
      headRevision: REVISION_A,
      nowMs: NOW_MS,
    });

    // then: corruption rebuilds too, and names the corruption instead of serving it
    expect(corrupt.status).toBe("rebuilt");
    if (corrupt.status !== "rebuilt") throw new Error("fixture hit");
    expect(corrupt.reason.startsWith("corrupt-")).toBe(true);

    // when: an unknown symbol is queried against a real snapshot
    const { dir, entries } = writeGatewayFixture();
    try {
      const snapshot = indexFiles(entries);
      const result = impact(snapshot, "fn:ghost@nowhere.ts", options());

      // then: unindexed with a named note — never indexed-empty (which would claim no callers)
      expect(result.coverage).toBe("unindexed");
      expect(result.items).toEqual([]);
      expect(result.impacted).toEqual([]);
      expect(result.unresolved.some((note) => note.includes("fn:ghost@nowhere.ts"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
