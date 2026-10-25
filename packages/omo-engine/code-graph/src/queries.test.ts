/**
 * Contract tests for `queries.ts` on the real checkout: the six queries
 * run over a compiler-extracted snapshot of the co-located fixture, so a
 * real symbol resolves to its actual definition plus callers, impact of a
 * changed symbol contains its known callers, candidate tests carry
 * evidence, and an unsupported file type reports unindexed.
 *
 * Precedent: `extract.test.ts` (given/when/then comments, real fixture
 * indexing, 60s timeout for the TypeScript server round-trip).
 */

import { describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexFiles } from "./extract";
import type { GraphSnapshot } from "./extract";
import { computeScopeFingerprint } from "./schema";
import {
  detectChanges,
  findTests,
  impact,
  search,
  symbolContext,
  trace,
  type QueryOptions,
} from "./queries";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "graph-basic");
const TEST_TIMEOUT_MS = 60000;

const PROJECT_ID = "demo-12345678";
const WORKTREE_ID = "wt-queries-test";
const REVISION = "a".repeat(40);

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

function fixture(...names: string[]): string[] {
  return names.map((name) => join(FIXTURE_DIR, name));
}

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-graph-queries-"));
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  return dir;
}

describe("code-graph queries", () => {
  it(
    "#given a real symbol #when symbolContext runs #then it returns its actual definition plus callers",
    () => {
      // given: the real fixture indexed from the checkout
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when
      const result = symbolContext(snapshot, "fn:add@math.ts", options());

      // then: identity, revision binding, and freshness/coverage travel together
      expect(result.projectId).toBe(PROJECT_ID);
      expect(result.worktreeId).toBe(WORKTREE_ID);
      expect(result.revision).toBe(REVISION);
      expect(result.fingerprint).toBe(computeScopeFingerprint(PROJECT_ID, WORKTREE_ID, REVISION));
      expect(result.freshness).toBe("fresh");
      expect(result.coverage).toBe("indexed");

      // then: the actual definition with its source location
      expect(result.definition?.id).toBe("fn:add@math.ts");
      expect(result.definition?.file).toBe("math.ts");
      expect(result.definition?.line).toBe(1);
      expect(result.definition?.confidence).toBe(1);
      expect(result.definition?.evidence.length).toBeGreaterThan(0);

      // then: known callers with evidence, dynamics never proven as items
      expect(result.callers.map((caller) => caller.id)).toContain("fn:run@main.ts");
      const run = result.callers.find((caller) => caller.id === "fn:run@main.ts");
      expect(run?.evidence.some((entry) => entry.edge === "CALLS_STATIC")).toBe(true);
      for (const item of result.items) expect(item.confidence).toBe(1);
      expect(result.items.some((item) => item.id === "unknown")).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a changed symbol #when impact runs #then it contains its known callers",
    () => {
      // given
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when
      const result = impact(snapshot, "fn:add@math.ts", options());

      // then: the subject plus every transitive static caller, bounded
      expect(result.subject?.id).toBe("fn:add@math.ts");
      expect(result.impacted.map((item) => item.id)).toContain("fn:run@main.ts");
      expect(result.items.length).toBeLessThanOrEqual(20);
      expect(result.truncated).toBe(false);
      for (const item of result.impacted) {
        expect(item.file).toMatch(/\.ts$/);
        expect(item.evidence.length).toBeGreaterThan(0);
      }
      expect(result.knowledgeIds).toEqual([]);
      expect(result.unsupported).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a static call chain #when trace runs #then it returns the path with evidence",
    () => {
      // given
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when
      const result = trace(snapshot, "fn:run@main.ts", "fn:add@math.ts", options());

      // then: one static hop with its source ref, endpoints as items
      expect(result.path).toHaveLength(1);
      expect(result.path[0]).toMatchObject({ from: "fn:run@main.ts", to: "fn:add@math.ts", confidence: 1 });
      expect(result.path[0]?.ref).toBe("main.ts:4");
      expect(result.items.map((item) => item.id)).toEqual(["fn:run@main.ts", "fn:add@math.ts"]);
      expect(result.coverage).toBe("indexed");

      // when: no static path exists
      const missing = trace(snapshot, "fn:add@math.ts", "fn:run@main.ts", options());

      // then: indexed with a note, never a guessed path
      expect(missing.path).toEqual([]);
      expect(missing.items).toEqual([]);
      expect(missing.coverage).toBe("indexed");
      expect(missing.unresolved.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a graphed module #when findTests runs #then it returns candidate tests with evidence",
    () => {
      // given
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when: by symbol id and by file path alike
      const bySymbol = findTests(snapshot, "fn:add@math.ts", options());
      const byFile = findTests(snapshot, "math.ts", options());

      // then: the real test file with the import-chain evidence
      for (const result of [bySymbol, byFile]) {
        expect(result.subjectFile).toBe("math.ts");
        expect(result.coverage).toBe("indexed");
        expect(result.candidates.map((item) => item.id)).toContain("file:main.test.ts");
        const candidate = result.candidates.find((item) => item.id === "file:main.test.ts");
        expect(candidate?.evidence.length).toBeGreaterThan(0);
        expect(candidate?.evidence.some((entry) => entry.edge === "TESTS" || entry.edge === "IMPORTS")).toBe(true);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a renamed symbol #when detectChanges runs #then it reports the invalidation with cause",
    () => {
      // given: a baseline plus a variant with add renamed to total
      const dir = copyFixture();
      try {
        const previous = indexFiles([join(dir, "main.ts"), join(dir, "reexport.ts"), join(dir, "main.test.ts")]);
        const mathPath = join(dir, "math.ts");
        writeFileSync(mathPath, readFileSync(mathPath, "utf8").replace("function add(", "function total("));
        const current = indexFiles([join(dir, "main.ts"), join(dir, "reexport.ts"), join(dir, "main.test.ts")]);

        // when
        const result = detectChanges(previous, current, options());

        // then: the stale definition carries SYM-RENAME with a source location
        const stale = result.changes.find((change) => change.id === "fn:add@math.ts");
        expect(stale?.cause).toBe("SYM-RENAME");
        expect(stale?.confidence).toBe(1);
        expect(stale?.file).toBe("math.ts");
        expect(result.items.some((item) => item.id === "fn:add@math.ts")).toBe(true);
        expect(result.freshness).toBe("stale");
        expect(result.coverage).toBe("indexed");
        expect(result.unsupported).toEqual([]);

        // when: nothing changed
        const clean = detectChanges(previous, previous, options());

        // then: fresh with no changes
        expect(clean.changes).toEqual([]);
        expect(clean.freshness).toBe("fresh");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given an unsupported file type #when queries run #then it reports unindexed rather than analyzed",
    () => {
      // given: an empty snapshot is enough — unsupported files are never analyzed
      const opts = options();

      // when
      const tested = findTests({ nodes: [], edges: [] }, "assets/logo.png", opts);
      const context = symbolContext({ nodes: [], edges: [] }, "fn:icon@assets/logo.png", opts);
      const searched = search({ nodes: [], edges: [] }, "assets/logo.png", opts);

      // then
      for (const result of [tested, context, searched]) {
        expect(result.coverage).toBe("unindexed");
        expect(result.items).toEqual([]);
        expect(result.unsupported.length).toBeGreaterThan(0);
        expect(result.projectId).toBe(PROJECT_ID);
        expect(result.worktreeId).toBe(WORKTREE_ID);
      }
      expect(tested.subjectFile).toBeUndefined();
      expect(context.definition).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given many matches #when search runs with a limit #then results stay bounded",
    () => {
      // given
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when
      const result = search(snapshot, "main", options({ limit: 1 }));

      // then: bounded with the cut named, never the whole graph
      expect(result.items).toHaveLength(1);
      expect(result.coverage).toBe("partial");
      expect(result.truncated).toBe(true);
      expect(result.unresolved.some((note) => note.includes("truncated to 1"))).toBe(true);

      // when: the default limit applies
      const unbounded = search(snapshot, "main", options());

      // then
      expect(unbounded.items.length).toBeLessThanOrEqual(20);
    },
    TEST_TIMEOUT_MS,
  );

  it("#given a typo #when search runs #then fuzzy finds the near-miss with its reason", () => {
    // given: a symbol the old substring search could never reach
    const snapshot: GraphSnapshot = {
      nodes: [
        { id: "const:slugify@utils/text.ts", kind: "symbol", file: "utils/text.ts", line: 3, name: "slugify" },
        { id: "file:utils/text.ts", kind: "file", file: "utils/text.ts", line: 1, name: "utils/text.ts" },
      ],
      edges: [],
    };

    // when
    const result = search(snapshot, "slugfy", options());

    // then: the near-miss resolves with an explicit fuzzy reason and tier rank
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.some((item) => item.reason === "fuzzy")).toBe(true);
    const hit = result.items.find((item) => item.id === "const:slugify@utils/text.ts");
    expect(hit?.reason).toBe("fuzzy");
    expect(hit?.rank).toBe(5);
    expect(hit?.file).toBe("utils/text.ts");
    expect(hit?.line).toBe(3);
    expect(hit?.confidence).toBe(1);
    expect(hit?.evidence.length).toBeGreaterThan(0);
  });

  it("#given a camelCase query #when search runs #then every query token must hit and the reason is token", () => {
    // given: one identifier carrying both camel pieces, one carrying only one.
    // The measured defect this pins: with any-token matching, "operations.ts"
    // matched every TypeScript file through its "ts" token and buried the file
    // the user named under unrelated symbols.
    const snapshot: GraphSnapshot = {
      nodes: [
        { id: "const:projectModelSlug@utils/text.ts", kind: "symbol", file: "utils/text.ts", line: 3, name: "projectModelSlug" },
        { id: "const:createProject@api/projects.ts", kind: "symbol", file: "api/projects.ts", line: 7, name: "createProject" },
      ],
      edges: [],
    };

    // when
    const result = search(snapshot, "projectSlug", options());

    // then: the conjunctive hit carries an explicit token reason and tier rank,
    // and a node matching only one piece never appears.
    expect(result.items.length).toBe(1);
    const [only] = result.items;
    expect(only?.id).toBe("const:projectModelSlug@utils/text.ts");
    expect(only?.reason).toBe("token");
    expect(only?.rank).toBe(3);
    expect(only?.confidence).toBe(1);
    expect(only?.evidence.length).toBeGreaterThan(0);
  });

  it("#given exact and prefix candidates #when search runs #then exact-name outranks prefix and ties prefer shorter paths", () => {
    // given: two exact names on different paths plus a longer prefix name
    const snapshot: GraphSnapshot = {
      nodes: [
        { id: "fn:foo@aaa/long-path-file.ts", kind: "symbol", file: "aaa/long-path-file.ts", line: 2, name: "foo" },
        { id: "fn:foo@z.ts", kind: "symbol", file: "z.ts", line: 5, name: "foo" },
        { id: "fn:foobar@z.ts", kind: "symbol", file: "z.ts", line: 9, name: "foobar" },
      ],
      edges: [],
    };

    // when
    const result = search(snapshot, "foo", options());

    // then: exact-name rows come first with the shorter path first, prefix last
    expect(result.items.map((item) => item.id)).toEqual([
      "fn:foo@z.ts",
      "fn:foo@aaa/long-path-file.ts",
      "fn:foobar@z.ts",
    ]);
    expect(result.items[0]?.reason).toBe("exact-name");
    expect(result.items[0]?.rank).toBe(0);
    expect(result.items[1]?.reason).toBe("exact-name");
    expect(result.items[1]?.rank).toBe(0);
    expect(result.items[2]?.reason).toBe("prefix");
    expect(result.items[2]?.rank).toBe(2);
    for (const item of result.items) expect(item.confidence).toBe(1);
  });
});
