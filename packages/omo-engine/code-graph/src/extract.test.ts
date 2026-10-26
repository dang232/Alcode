/**
 * Contract tests for `extract.ts` (schema-draft sections 1-3) on a small
 * real fixture: static calls resolve to definitions with callers,
 * unresolved dynamics stay uncertain and are never proven, and a rename or
 * delete invalidates the affected edges.
 */

import { describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexFiles, invalidateEdges } from "./extract";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "graph-basic");
const TEST_TIMEOUT_MS = 60000;

function fixture(...names: string[]): string[] {
  return names.map((name) => join(FIXTURE_DIR, name));
}

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-graph-fixture-"));
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  return dir;
}

describe("code-graph extract", () => {
  it(
    "#given a known function #when the fixture is indexed #then it resolves to its definition with callers",
    () => {
      // given
      const entries = fixture("main.ts", "reexport.ts", "main.test.ts");

      // when
      const graph = indexFiles(entries);

      // then: definition with a DEFINES edge at confidence 1.00
      const addId = "fn:add@math.ts";
      expect(graph.nodes.some((node) => node.id === addId && node.kind === "symbol")).toBe(true);
      expect(
        graph.edges.some(
          (edge) =>
            edge.kind === "DEFINES" && edge.from === "file:math.ts" && edge.to === addId && edge.confidence === 1,
        ),
      ).toBe(true);

      // then: static call edge from the caller with a file:line source ref
      const runId = "fn:run@main.ts";
      const call = graph.edges.find(
        (edge) => edge.kind === "CALLS_STATIC" && edge.from === runId && edge.to === addId,
      );
      expect(call).toBeDefined();
      expect(call?.confidence).toBe(1);
      expect(call?.ref).toBe("main.ts:4");
      expect(call?.callSite).toMatch(/^call:main\.ts:4:\d+$/);

      // then: callers of add resolve back to run
      const callers = graph.edges.filter((edge) => edge.kind === "CALLS_STATIC" && edge.to === addId);
      expect(callers.map((edge) => edge.from)).toContain(runId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given static module structure #when the fixture is indexed #then imports, exports, and test links resolve at confidence 1",
    () => {
      // given
      const entries = fixture("main.ts", "reexport.ts", "main.test.ts");

      // when
      const graph = indexFiles(entries);

      // then: static import resolved by the compiler's module resolution
      expect(
        graph.edges.some(
          (edge) =>
            edge.kind === "IMPORTS" &&
            edge.from === "file:main.ts" &&
            edge.to === "file:math.ts" &&
            edge.confidence === 1 &&
            edge.ref === "main.ts:1",
        ),
      ).toBe(true);

      // then: re-export traced to the origin declaration
      const contract = graph.nodes.find((node) => node.id === "export:add@reexport.ts");
      expect(contract?.target).toBe("fn:add@math.ts");
      expect(
        graph.edges.some(
          (edge) => edge.kind === "EXPORTS" && edge.from === "file:reexport.ts" && edge.confidence === 1,
        ),
      ).toBe(true);

      // then: test file statically imports its subject, never guessed
      expect(
        graph.edges.some(
          (edge) =>
            edge.kind === "TESTS" &&
            edge.from === "file:main.test.ts" &&
            edge.to === "file:main.ts" &&
            edge.confidence === 1,
        ),
      ).toBe(true);
      const testFile = graph.nodes.find((node) => node.id === "file:main.test.ts");
      expect(testFile?.isTest).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given dynamic call sites #when the fixture is indexed #then they are recorded uncertain and never proven",
    () => {
      // given
      const entries = fixture("main.ts");

      // when
      const graph = indexFiles(entries);

      // then: computed dispatch and eval stay uncertain, capped at most 0.50
      const dynamicId = "fn:runDynamic@main.ts";
      const evalId = "fn:runEval@main.ts";
      const unresolved = graph.edges.filter((edge) => edge.kind === "CALLS_UNRESOLVED");
      expect(unresolved.length).toBeGreaterThanOrEqual(2);
      for (const edge of unresolved) {
        expect(edge.to).toBe("unknown");
        expect(edge.confidence).toBeLessThanOrEqual(0.5);
        expect(edge.uncertain).toBe(true);
      }
      expect(unresolved.some((edge) => edge.from === dynamicId)).toBe(true);
      expect(unresolved.some((edge) => edge.from === evalId)).toBe(true);

      // then: no dynamic caller is ever recorded as a proven static call
      const provenFromDynamic = graph.edges.filter(
        (edge) => edge.kind === "CALLS_STATIC" && (edge.from === dynamicId || edge.from === evalId),
      );
      expect(provenFromDynamic).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a renamed symbol #when the graph is re-extracted #then the affected edges are invalidated",
    () => {
      // given: a baseline plus a variant with add renamed to total
      const dir = copyFixture();
      try {
        const baseline = indexFiles([join(dir, "main.ts"), join(dir, "reexport.ts"), join(dir, "main.test.ts")]);
        const mathPath = join(dir, "math.ts");
        writeFileSync(mathPath, readFileSync(mathPath, "utf8").replace("function add(", "function total("));
        const renamed = indexFiles([join(dir, "main.ts"), join(dir, "reexport.ts"), join(dir, "main.test.ts")]);

        // when
        const invalidated = invalidateEdges(baseline, renamed);

        // then: the stale definition and its callers carry SYM-RENAME
        const byFrom = new Map(invalidated.map((edge) => [edge.from, edge]));
        expect(byFrom.get("fn:add@math.ts")?.cause).toBe("SYM-RENAME");
        const staleCall = baseline.edges.find(
          (edge) => edge.kind === "CALLS_STATIC" && edge.to === "fn:add@math.ts",
        );
        expect(staleCall).toBeDefined();
        expect(byFrom.get(staleCall?.id ?? "")?.cause).toBe("SYM-RENAME");
        for (const edge of invalidated) {
          expect(edge.kind).toBe("INVALIDATED_BY");
          expect(edge.confidence).toBe(1);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a deleted file #when the graph is re-extracted #then the affected edges are invalidated",
    () => {
      // given: a baseline plus a variant with reexport.ts deleted
      const dir = copyFixture();
      try {
        const baseline = indexFiles([join(dir, "main.ts"), join(dir, "reexport.ts"), join(dir, "main.test.ts")]);
        rmSync(join(dir, "reexport.ts"));
        const afterDelete = indexFiles([join(dir, "main.ts"), join(dir, "math.ts"), join(dir, "main.test.ts")]);

        // when
        const invalidated = invalidateEdges(baseline, afterDelete);

        // then: the file and its edges carry SRC-DELETE at confidence 1.00
        const byFrom = new Map(invalidated.map((edge) => [edge.from, edge]));
        expect(byFrom.get("file:reexport.ts")?.cause).toBe("SRC-DELETE");
        expect(byFrom.get("file:reexport.ts")?.confidence).toBe(1);
        expect(
          invalidated.some(
            (edge) => edge.kind === "INVALIDATED_BY" && edge.cause === "SRC-DELETE" && edge.from !== "file:reexport.ts",
          ),
        ).toBe(true);

        // then: unaffected edges are not invalidated
        const affected = new Set(invalidated.map((edge) => edge.from));
        expect(affected.has("file:math.ts")).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
