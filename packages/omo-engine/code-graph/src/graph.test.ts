/**
 * Barrel test for `graph.ts`: the public entrypoint resolves and a
 * two-file index plus `symbolContext` works end to end with source refs.
 *
 * Precedent: `extract.test.ts` (given/when/then comments, real indexing,
 * 60s timeout for the TypeScript server round-trip).
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as graph from "./graph";
import { computeScopeFingerprint } from "./graph";

const TEST_TIMEOUT_MS = 60000;

const PROJECT_ID = "demo-12345678";
const WORKTREE_ID = "wt-graph-test";
const REVISION = "b".repeat(40);

function writeTwoFileFixture() {
  const dir = mkdtempSync(join(tmpdir(), "code-graph-barrel-"));
  writeFileSync(join(dir, "a.ts"), `export function add(a: number, b: number): number {\n  return a + b;\n}\n`);
  writeFileSync(
    join(dir, "b.ts"),
    `import { add } from "./a";\n\nexport function run(): number {\n  return add(1, 2);\n}\n`,
  );
  return { dir, entries: [join(dir, "a.ts"), join(dir, "b.ts")] };
}

describe("code-graph barrel", () => {
  it("#given the barrel #when its exports are read #then the public API of all four modules resolves", () => {
    // given: the barrel module namespace

    // when / then: extraction entrypoints
    expect(graph.indexFiles instanceof Function).toBe(true);
    expect(graph.invalidateEdges instanceof Function).toBe(true);
    expect(graph.isTestPath instanceof Function).toBe(true);

    // when / then: schema entrypoints
    expect(graph.computeFingerprint instanceof Function).toBe(true);
    expect(graph.computeScopeFingerprint instanceof Function).toBe(true);
    expect(graph.computeEntityId instanceof Function).toBe(true);
    expect(graph.isEdgeKind instanceof Function).toBe(true);
    expect(graph.isGraphEntity instanceof Function).toBe(true);
    expect(graph.isGraphEdge instanceof Function).toBe(true);
    expect(graph.STALE_AFTER_MS).toBe(7 * 24 * 60 * 60 * 1000);

    // when / then: cache entrypoints
    expect(graph.WorktreeGraphCache instanceof Function).toBe(true);
    expect(graph.applyDirtyOverlay instanceof Function).toBe(true);
    expect(graph.buildBaselineFromHeadFiles instanceof Function).toBe(true);
    expect(graph.loadOrRebuild instanceof Function).toBe(true);
    expect(graph.parseStoredIndex instanceof Function).toBe(true);
    expect(graph.serializeIndex instanceof Function).toBe(true);

    // when / then: query entrypoints
    expect(graph.symbolContext instanceof Function).toBe(true);
    expect(graph.search instanceof Function).toBe(true);
    expect(graph.impact instanceof Function).toBe(true);
    expect(graph.trace instanceof Function).toBe(true);
    expect(graph.findTests instanceof Function).toBe(true);
    expect(graph.detectChanges instanceof Function).toBe(true);
    expect(graph.DEFAULT_RESULT_LIMIT).toBe(20);
    expect(graph.MAX_RESULT_LIMIT).toBe(50);
  });

  it(
    "#given a two-file fixture #when indexed through the barrel and symbolContext runs #then the definition resolves with callers and source refs",
    () => {
      // given
      const { dir, entries } = writeTwoFileFixture();
      try {
        // when
        const snapshot = graph.indexFiles(entries);
        const result = graph.symbolContext(snapshot, "fn:add@a.ts", {
          scope: {
            projectId: PROJECT_ID,
            worktreeId: WORKTREE_ID,
            revision: REVISION,
            fingerprint: computeScopeFingerprint(PROJECT_ID, WORKTREE_ID, REVISION),
          },
        });

        // then: definition resolves with a file:line source ref
        expect(result.coverage).toBe("indexed");
        expect(result.definition?.id).toBe("fn:add@a.ts");
        expect(result.definition?.file).toBe("a.ts");
        expect(result.definition?.evidence.length).toBeGreaterThan(0);
        for (const evidence of result.definition?.evidence ?? []) {
          expect(evidence.ref).toMatch(/^a\.ts:\d+$/);
        }

        // then: the caller in b.ts is linked with its own source ref
        expect(result.callers.map((caller) => caller.id)).toContain("fn:run@b.ts");
        const caller = result.callers.find((entry) => entry.id === "fn:run@b.ts");
        expect(caller?.evidence[0]?.edge).toBe("CALLS_STATIC");
        expect(caller?.evidence[0]?.ref).toMatch(/^b\.ts:\d+$/);

        // then: envelope items carry source refs too
        expect(result.items.length).toBeGreaterThan(0);
        for (const item of result.items) {
          expect(item.file.length).toBeGreaterThan(0);
          expect(item.line).toBeGreaterThanOrEqual(1);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a nested index root with rootDir #when indexed through the barrel #then queries resolve in the repo id space",
    () => {
      // given: repo/apps/a/b.ts calls repo/apps/a/a.ts, indexed from the nested root
      const dir = mkdtempSync(join(tmpdir(), "code-graph-barrel-rootdir-"));
      try {
        const aPath = join(dir, "apps", "a", "a.ts");
        const bPath = join(dir, "apps", "a", "b.ts");
        mkdirSync(dirname(aPath), { recursive: true });
        writeFileSync(aPath, "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
        writeFileSync(
          bPath,
          "import { add } from \"./a\";\n\nexport function run(): number {\n  return add(1, 2);\n}\n",
        );

        // when
        const snapshot = graph.indexFiles([bPath], { rootDir: dir });
        const result = graph.symbolContext(snapshot, "fn:add@apps/a/a.ts", {
          scope: {
            projectId: PROJECT_ID,
            worktreeId: WORKTREE_ID,
            revision: REVISION,
            fingerprint: computeScopeFingerprint(PROJECT_ID, WORKTREE_ID, REVISION),
          },
        });

        // then: the nested entry keeps its apps/... id and the caller resolves
        expect(snapshot.nodes.some((node) => node.id === "file:apps/a/b.ts")).toBe(true);
        expect(result.coverage).toBe("indexed");
        expect(result.definition?.id).toBe("fn:add@apps/a/a.ts");
        expect(result.definition?.file).toBe("apps/a/a.ts");
        expect(result.callers.map((caller) => caller.id)).toContain("fn:run@apps/a/b.ts");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
