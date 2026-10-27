/**
 * Contract tests for `extract.ts` (schema-draft sections 1-3) on a small
 * real fixture: static calls resolve to definitions with callers,
 * unresolved dynamics stay uncertain and are never proven, and a rename or
 * delete invalidates the affected edges.
 */

import { describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** A temp repo with a nested index root (`apps/a`) and a cross-package target (`packages/b`). */
function writeRepoTree() {
  const repo = mkdtempSync(join(tmpdir(), "code-graph-rootdir-"));
  const files = {
    "apps/a/main.ts":
      `import { helper } from "../../packages/b/util";\n` +
      `import { same as sameA } from "./same";\n` +
      `import { same as sameB } from "../../packages/b/same";\n` +
      `import { spaced } from "./my module-ünïcode";\n` +
      `\n` +
      `export function run(): number {\n` +
      `  return helper() + sameA() + sameB() + spaced();\n` +
      `}\n`,
    "apps/a/same.ts": `export function same(): number {\n  return 1;\n}\n`,
    "apps/a/my module-ünïcode.ts": `export function spaced(): number {\n  return 3;\n}\n`,
    "packages/b/util.ts": `export function helper(): number {\n  return 42;\n}\n`,
    "packages/b/same.ts": `export function same(): number {\n  return 2;\n}\n`,
  };
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(repo, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return { repo };
}

function toPosixRoot(repo: string): string {
  const slashed = repo.replace(/\\/g, "/");
  return /^[A-Z]:\//.test(slashed) ? slashed[0].toLowerCase() + slashed.slice(1) : slashed;
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

describe("code-graph extract with rootDir", () => {
  it(
    "#given a nested index root #when rootDir is the repo root #then file ids stay repo-relative POSIX",
    () => {
      // given: only apps/a/main.ts indexed, with the repo root as the id base
      const { repo } = writeRepoTree();
      try {
        // when
        const graph = indexFiles([join(repo, "apps", "a", "main.ts")], { rootDir: repo });

        // then: every id is rooted at the repo, never at the nested index root
        const ids = graph.nodes.map((node) => node.id);
        expect(ids).toContain("file:apps/a/main.ts");
        expect(ids).toContain("file:packages/b/util.ts");
        expect(ids.some((id) => id === "file:main.ts")).toBe(false);
        expect(graph.root).toBe(toPosixRoot(repo));
        expect(graph.dropped).toEqual([]);

        // then: every stored file path is clean POSIX relative (no leading
        // ./, no drive prefix, no .. segment, forward slashes only)
        for (const node of graph.nodes) {
          expect(node.file).not.toContain("\\");
          expect(node.file).not.toMatch(/^[a-zA-Z]:\//);
          expect(node.file.startsWith("./")).toBe(false);
          expect(node.file.split("/")).not.toContain("..");
        }
        for (const edge of graph.edges) {
          expect(edge.ref).not.toContain("\\");
          expect(edge.ref).not.toMatch(/^[a-zA-Z]:\//);
        }

        // then: the content index uses the same id space
        expect(Object.keys(graph.content?.files ?? {})).toContain("apps/a/main.ts");
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a cross-package import #when rootDir is the repo root #then the import and call resolve inside one id space",
    () => {
      // given: apps/a/main.ts importing ../../packages/b/util
      const { repo } = writeRepoTree();
      try {
        // when
        const graph = indexFiles([join(repo, "apps", "a", "main.ts")], { rootDir: repo });

        // then: the compiler's own module resolution crosses packages with
        // no extra resolver — IMPORTS and CALLS_STATIC share the repo ids
        expect(
          graph.edges.some(
            (edge) =>
              edge.kind === "IMPORTS" &&
              edge.from === "file:apps/a/main.ts" &&
              edge.to === "file:packages/b/util.ts" &&
              edge.confidence === 1,
          ),
        ).toBe(true);
        const call = graph.edges.find(
          (edge) =>
            edge.kind === "CALLS_STATIC" &&
            edge.from === "fn:run@apps/a/main.ts" &&
            edge.to === "fn:helper@packages/b/util.ts",
        );
        expect(call).toBeDefined();
        expect(call?.ref).toBe("apps/a/main.ts:7");

        // then: same basenames in different folders stay distinct, no collision
        const ids = graph.nodes.map((node) => node.id);
        expect(ids).toContain("file:apps/a/same.ts");
        expect(ids).toContain("file:packages/b/same.ts");
        expect(ids).toContain("fn:same@apps/a/same.ts");
        expect(ids).toContain("fn:same@packages/b/same.ts");

        // then: spaces and non-ASCII survive normalization byte-identical
        expect(ids).toContain("file:apps/a/my module-ünïcode.ts");
        expect(
          graph.edges.some(
            (edge) =>
              edge.kind === "DEFINES" &&
              edge.from === "file:apps/a/my module-ünïcode.ts" &&
              edge.to === "fn:spaced@apps/a/my module-ünïcode.ts",
          ),
        ).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a file outside rootDir #when indexed #then it is refused with a recorded reason",
    () => {
      // given: the id base narrowed to apps/a, excluding packages/b
      const { repo } = writeRepoTree();
      try {
        // when
        const graph = indexFiles(
          [join(repo, "apps", "a", "main.ts"), join(repo, "packages", "b", "util.ts")],
          { rootDir: join(repo, "apps", "a") },
        );

        // then: outside files are dropped once each with reasons, never re-rooted
        const outsideUtil = `${toPosixRoot(repo)}/packages/b/util.ts`;
        const outsideSame = `${toPosixRoot(repo)}/packages/b/same.ts`;
        expect(graph.dropped).toEqual([
          { file: outsideSame, reason: "outside-root" },
          { file: outsideUtil, reason: "outside-root" },
        ]);
        expect(graph.nodes.some((node) => node.id.includes("packages/b"))).toBe(false);
        expect(graph.edges.some((edge) => edge.ref.includes("packages/b"))).toBe(false);

        // then: the inside file still indexes in the narrowed id space
        expect(graph.nodes.some((node) => node.id === "file:main.ts")).toBe(true);

        // when: every entry sits outside the root
        const empty = indexFiles([join(repo, "packages", "b", "util.ts")], {
          rootDir: join(repo, "apps", "a"),
        });

        // then: an empty graph with the root recorded and the refusal recorded
        expect(empty.nodes).toEqual([]);
        expect(empty.edges).toEqual([]);
        expect(empty.root).toBe(`${toPosixRoot(repo)}/apps/a`);
        expect(empty.dropped).toEqual([{ file: outsideUtil, reason: "outside-root" }]);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given no rootDir #when a nested entry is indexed #then today's commonDir behaviour is unchanged",
    () => {
      // given: a nested entry with no rootDir
      const { repo } = writeRepoTree();
      try {
        // when
        const graph = indexFiles([join(repo, "apps", "a", "main.ts")]);

        // then: legacy identity — root is the entry dir, ids are bare names
        expect(graph.root).toBe(toPosixRoot(join(repo, "apps", "a")));
        expect(graph.nodes.some((node) => node.id === "file:main.ts")).toBe(true);
        expect(graph.dropped).toBeUndefined();
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
