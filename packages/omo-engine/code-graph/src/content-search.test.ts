/**
 * Contract tests for indexed source-content search (`searchContent`).
 *
 * The engine's name search (`search` in queries.ts) matches symbol and
 * file names only, so a string that lives solely inside a function body
 * is unreachable through it. These tests index the real `graph-basic`
 * fixture and prove the extraction-time content index closes that gap:
 * body-only literals are found, multi-term queries need every term in
 * one file, limits bound the answer, path filters exclude other files,
 * and a fixture-literal query ranks the fixture file first.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTENT_SEARCH_TIME_BUDGET_MS,
  MAX_CONTENT_TOKENS_PER_FILE,
  indexFiles,
  searchContent,
} from "./extract";
import type { GraphSnapshot } from "./extract";
import { search } from "./queries";
import { computeScopeFingerprint } from "./schema";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "graph-basic");
const TEST_TIMEOUT_MS = 60000;

const PROJECT_ID = "demo-12345678";
const WORKTREE_ID = "wt-content-search";
const REVISION = "c".repeat(40);

function fixture(...names: string[]): string[] {
  return names.map((name) => join(FIXTURE_DIR, name));
}

function scope() {
  return {
    projectId: PROJECT_ID,
    worktreeId: WORKTREE_ID,
    revision: REVISION,
    fingerprint: computeScopeFingerprint(PROJECT_ID, WORKTREE_ID, REVISION),
  };
}

describe("code-graph content search", () => {
  it(
    "#given a literal that exists only inside a function body #when content search runs #then the body line is found with a bounded excerpt",
    () => {
      // given: "handlers[name]" appears only in the runDynamic body, never in a symbol name
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when
      const result = searchContent(snapshot, "handlers[name]");

      // then: the body line is found as a phrase hit at confidence 1
      expect(result.items.length).toBeGreaterThan(0);
      const first = result.items[0];
      expect(first?.file).toBe("main.ts");
      expect(first?.line).toBe(8);
      expect(first?.reason).toBe("phrase");
      expect(first?.confidence).toBe(1);
      expect(first?.column).toBeGreaterThanOrEqual(1);
      expect(first?.excerpt.length).toBeLessThanOrEqual(200);
      expect(first?.excerpt).toContain("handlers[name]");

      // then: the name-only search cannot reach body text (the gap this index closes)
      const named = search(snapshot, "1 + 1", { scope: scope() });
      expect(named.items).toEqual([]);

      // then: every item honours the contract shape
      for (const item of result.items) {
        expect(["literal", "token", "phrase"]).toContain(item.reason);
        expect(item.confidence).toBe(1);
        expect(item.line).toBeGreaterThanOrEqual(1);
        expect(item.excerpt.length).toBeLessThanOrEqual(200);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a two-term query #when the terms live in different files #then no file matches, while same-file terms do",
    () => {
      // given: checkMain lives only in main.test.ts, handlers only in main.ts
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when: the terms never share one file
      const split = searchContent(snapshot, "checkMain handlers");

      // then: all terms must be present in the same file, so nothing matches
      expect(split.items).toEqual([]);
      expect(split.truncated).toBe(false);
      expect(split.coverage).toBe("indexed");

      // when: both terms share main.ts
      const together = searchContent(snapshot, "handler return");

      // then: main.ts lines carrying both terms are returned
      expect(together.items.length).toBeGreaterThan(0);
      for (const item of together.items) {
        expect(item.file).toBe("main.ts");
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given more matches than the limit #when content search runs #then results are bounded and the cut is reported",
    () => {
      // given: \"return\" matches lines across the fixture
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when
      const result = searchContent(snapshot, "return", { limit: 2 });

      // then: the limit is honoured and the cut names itself
      expect(result.items).toHaveLength(2);
      expect(result.truncated).toBe(true);
      expect(result.coverage).toBe("partial");
      expect(result.unresolved.some((note) => note.includes("truncated to 2 of"))).toBe(true);

      // when: the default limit covers the whole fixture answer
      const full = searchContent(snapshot, "return");

      // then: nothing is cut
      expect(full.truncated).toBe(false);
      expect(full.coverage).toBe("indexed");
      expect(full.items.length).toBeGreaterThan(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a pathPrefix filter #when content search runs #then other files are excluded",
    () => {
      // given
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when
      const result = searchContent(snapshot, "return", { pathPrefix: "math" });

      // then: only math.ts answers, even though main.ts also matches
      expect(result.items.length).toBeGreaterThan(0);
      for (const item of result.items) {
        expect(item.file).toBe("math.ts");
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a query built from a fixture literal #when content search runs #then the fixture file ranks first",
    () => {
      // given: the exact body literal from runEval in main.ts
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when
      const result = searchContent(snapshot, "1 + 1");

      // then: the whole-phrase hit in main.ts outranks partial matches elsewhere
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items[0]?.file).toBe("main.ts");
      expect(result.items[0]?.reason).toBe("phrase");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given kind, language, and directory filters #when content search runs #then only matching files answer",
    () => {
      // given
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when: test-only
      const tests = searchContent(snapshot, "run", { kind: "test" });

      // then
      expect(tests.items.length).toBeGreaterThan(0);
      for (const item of tests.items) {
        expect(item.file).toBe("main.test.ts");
      }

      // when: source-only excludes the test file
      const sources = searchContent(snapshot, "run", { kind: "source" });
      expect(sources.items.length).toBeGreaterThan(0);
      for (const item of sources.items) {
        expect(item.file === "main.test.ts").toBe(false);
      }

      // when: an unindexed language is requested
      const unsupported = searchContent(snapshot, "run", { language: "python" });

      // then: reported as unsupported, never analyzed
      expect(unsupported.items).toEqual([]);
      expect(unsupported.coverage).toBe("unindexed");
      expect(unsupported.unsupported.length).toBeGreaterThan(0);

      // when: a directory matches nothing
      const nowhere = searchContent(snapshot, "return", { directory: "no/such/dir" });
      expect(nowhere.items).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a subdirectory fixture #when a directory filter names it #then only that subtree answers",
    () => {
      // given: a helper with a unique literal under sub/
      const dir = mkdtempSync(join(tmpdir(), "code-graph-content-"));
      try {
        writeFileSync(join(dir, "main.ts"), "export function run(): number {\n  return 1;\n}\n");
        mkdirSync(join(dir, "sub"), { recursive: true });
        writeFileSync(
          join(dir, "sub", "helper.ts"),
          "export function quasarHelper(): string {\n  return \"quasar_helper_zzz\";\n}\n",
        );
        const snapshot = indexFiles([join(dir, "main.ts"), join(dir, "sub", "helper.ts")]);

        // when
        const result = searchContent(snapshot, "quasar_helper_zzz", { directory: "sub" });

        // then
        expect(result.items).toHaveLength(1);
        expect(result.items[0]?.file).toBe("sub/helper.ts");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it("#given skipped files in the index #when content search runs #then the skip is counted, never silent", () => {
    // given: a snapshot whose index skipped a binary and an oversized file
    const snapshot: GraphSnapshot = {
      nodes: [],
      edges: [],
      content: {
        tokenCap: MAX_CONTENT_TOKENS_PER_FILE,
        files: {},
        skipped: [
          { file: "assets/blob.bin", reason: "binary", language: "bin", isTest: false },
          { file: "vendor/big.min.js", reason: "too-large", language: "js", isTest: false },
        ],
      },
    };

    // when
    const result = searchContent(snapshot, "anything");

    // then: the counted note names the skip
    expect(result.items).toEqual([]);
    expect(result.unresolved.some((note) => note.includes("skipped 2 file(s)"))).toBe(true);
  });

  it("#given a snapshot without a content index #when content search runs #then it reports unindexed", () => {
    // given: a pre-content-search snapshot shape
    const snapshot: GraphSnapshot = { nodes: [], edges: [] };

    // when
    const result = searchContent(snapshot, "return");

    // then
    expect(result.items).toEqual([]);
    expect(result.coverage).toBe("unindexed");
    expect(result.unresolved.length).toBeGreaterThan(0);
  });

  it(
    "#given the fixture set #when indexed and searched repeatedly #then build and p50 search timings are reported",
    () => {
      // when: index build timing over the existing fixture set
      const buildStart = performance.now();
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));
      const buildMs = performance.now() - buildStart;

      // when: p50 search timing across repeated calls
      const samples: number[] = [];
      for (let round = 0; round < 31; round += 1) {
        const start = performance.now();
        searchContent(snapshot, "return add");
        samples.push(performance.now() - start);
      }
      samples.sort((left, right) => left - right);
      const p50 = samples[Math.floor(samples.length / 2)] ?? 0;

      // then: report timings and hold the search bound
      console.log(`content-index build: ${buildMs.toFixed(1)}ms; searchContent p50: ${p50.toFixed(2)}ms`);
      expect(p50).toBeLessThan(CONTENT_SEARCH_TIME_BUDGET_MS);
    },
    TEST_TIMEOUT_MS,
  );
});
