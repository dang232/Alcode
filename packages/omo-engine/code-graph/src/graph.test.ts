/**
 * Barrel test for `graph.ts`: the public entrypoint resolves and a
 * two-file index plus `symbolContext` works end to end with source refs.
 *
 * Precedent: `extract.test.ts` (given/when/then comments, real indexing,
 * 60s timeout for the TypeScript server round-trip).
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as graph from "./graph";
import { computeScopeFingerprint } from "./graph";

const TEST_TIMEOUT_MS = 60000;

const PROJECT_ID = "demo-12345678";
const WORKTREE_ID = "wt-graph-test";
const REVISION = "b".repeat(40);

function writeTwoFileFixture(): { dir: string; entries: string[] } {
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
    expect(typeof graph.indexFiles).toBe("function");
    expect(typeof graph.invalidateEdges).toBe("function");
    expect(typeof graph.isTestPath).toBe("function");

    // when / then: schema entrypoints
    expect(typeof graph.computeFingerprint).toBe("function");
    expect(typeof graph.computeScopeFingerprint).toBe("function");
    expect(typeof graph.computeEntityId).toBe("function");
    expect(typeof graph.isEdgeKind).toBe("function");
    expect(typeof graph.isGraphEntity).toBe("function");
    expect(typeof graph.isGraphEdge).toBe("function");
    expect(graph.STALE_AFTER_MS).toBe(7 * 24 * 60 * 60 * 1000);

    // when / then: cache entrypoints
    expect(typeof graph.WorktreeGraphCache).toBe("function");
    expect(typeof graph.applyDirtyOverlay).toBe("function");
    expect(typeof graph.buildBaselineFromHeadFiles).toBe("function");
    expect(typeof graph.loadOrRebuild).toBe("function");
    expect(typeof graph.parseStoredIndex).toBe("function");
    expect(typeof graph.serializeIndex).toBe("function");

    // when / then: query entrypoints
    expect(typeof graph.symbolContext).toBe("function");
    expect(typeof graph.search).toBe("function");
    expect(typeof graph.impact).toBe("function");
    expect(typeof graph.trace).toBe("function");
    expect(typeof graph.findTests).toBe("function");
    expect(typeof graph.detectChanges).toBe("function");
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
});
