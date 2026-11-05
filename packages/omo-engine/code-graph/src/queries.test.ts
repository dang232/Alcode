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
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexFiles } from "./extract";
import type { GraphEdge, GraphNode, GraphSnapshot } from "./extract";
import { computeScopeFingerprint } from "./schema";
import {
  detectChanges,
  explore,
  findTests,
  impact,
  routesForHandler,
  screensForSender,
  search,
  symbolContext,
  trace,
  type ImpactSummary,
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
    "#given a wall-clock budget already spent #when impact runs #then the answer says time stopped the walk",
    () => {
      // given
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when: zero budget, so the walk may not start at all
      const result = impact(snapshot, "fn:add@math.ts", { ...options(), maxQueryMs: 0 });

      // then
      expect(result.completeness).toBe("truncated");
      expect(result.completenessReason).toBe("time-budget");
      expect(result.unresolved.some((line) => line.includes("time budget"))).toBe(true);
      expect(result.impacted.length).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given an explored-edge budget #when the walk exceeds it #then the answer says the budget stopped it",
    () => {
      // given
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when: one explored edge is less than this symbol's caller fan-out
      const result = impact(snapshot, "fn:add@math.ts", { ...options(), maxExploredEdges: 1 });

      // then: the cut is named, counted, and never reported as a complete answer
      expect(result.completeness).toBe("truncated");
      expect(result.completenessReason).toBe("edge-budget");
      expect(result.unresolved.some((line) => line.includes("edge budget"))).toBe(true);
      expect(result.impacted.length).toBeLessThanOrEqual(1);
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
    "#given a direct and an indirect test #when findTests runs #then each row reports its own association",
    () => {
      // given: main.test.ts imports main.ts directly; math.ts is reached through it
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when
      const direct = findTests(snapshot, "main.ts", options()).candidates.find((item) => item.id === "file:main.test.ts");
      const indirect = findTests(snapshot, "math.ts", options()).candidates.find((item) => item.id === "file:main.test.ts");

      // then: the same test file is direct for one subject and transitive for the other
      expect(direct?.testDistance).toBe(1);
      expect(direct?.testAssociation).toBe("direct");
      expect(indirect?.testDistance).toBeGreaterThan(1);
      expect(indirect?.testAssociation).toBe("transitive");
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
      // coverage describes the INDEX (this one is whole); the cut is reported by
      // truncated + completeness, so a limit must not read as a partly analysed project.
      expect(result.coverage).toBe("indexed");
      expect(result.completeness).toBe("truncated");
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

describe("code-graph query totals and summaries", () => {
  const sym = (id: string, file: string, line = 1): GraphNode => ({
    id,
    kind: "symbol",
    file,
    line,
    name: id.split("@")[0]?.replace(/^(fn|class|const):/, ""),
  });
  const fileNode = (file: string, isTest = false): GraphNode => {
    const node: GraphNode = {
      id: `file:${file}`,
      kind: "file",
      file,
      line: 1,
      name: file,
    };
    return isTest ? { ...node, isTest: true } : node;
  };
  const staticCall = (from: string, to: string, ref: string, n: number): GraphEdge => ({
    id: `call-${n}`,
    kind: "CALLS_STATIC",
    from,
    to,
    confidence: 1,
    ref,
  });
  const testsEdge = (from: string, to: string, ref: string, n: number): GraphEdge => ({
    id: `tests-${n}`,
    kind: "TESTS",
    from,
    to,
    confidence: 1,
    ref,
  });

  // given: a subject with two static callers in different modules, one covered by a test
  const snapshot: GraphSnapshot = {
    nodes: [
      sym("fn:core@lib/core.ts", "lib/core.ts", 2),
      sym("fn:use@lib/use.ts", "lib/use.ts", 3),
      sym("fn:naked@app/naked.ts", "app/naked.ts", 5),
      fileNode("lib/core.ts"),
      fileNode("lib/use.ts"),
      fileNode("app/naked.ts"),
      fileNode("lib/use.test.ts", true),
    ],
    edges: [
      staticCall("fn:use@lib/use.ts", "fn:core@lib/core.ts", "lib/use.ts:3", 1),
      staticCall("fn:naked@app/naked.ts", "fn:core@lib/core.ts", "app/naked.ts:5", 2),
      testsEdge("file:lib/use.test.ts", "file:lib/use.ts", "lib/use.test.ts:1", 3),
    ],
  };

  it("#given callers #when impact runs #then totals count the whole walked set and the summary is honest", () => {
    // when
    const result = impact(snapshot, "fn:core@lib/core.ts", options());

    // then: every dependent walked before the display cut
    expect(result.totals?.displayed).toBe(2);
    expect(result.totals?.known).toBe(2);
    expect(result.totals?.hidden).toBe(0);
    expect(result.totals?.byDepth).toEqual([{ depth: 1, count: 2 }]);
    expect(result.completeness).toBe("complete");
    expect(result.completenessReason).toBeUndefined();

    // then: the structured summary the client renders verbatim
    const summary: ImpactSummary = result.summary;
    expect(summary.subjectIds).toEqual(["fn:core@lib/core.ts"]);
    expect(summary.dependentFiles).toBe(2);
    expect(summary.dependentSymbols).toBe(2);
    expect(summary.modules).toEqual([
      { module: "app", count: 1 },
      { module: "lib", count: 1 },
    ]);
    expect(summary.testsFound).toBe(0);
    expect(summary.callersWithoutTestPath).toBe(1);
    expect(summary.unresolvedEdges).toBe(0);
    expect(summary.completeness).toBe("complete");
  });

  it("#given callers and callees #when symbolContext runs #then the neighbourhood summary counts the full sets", () => {
    // when
    const result = symbolContext(snapshot, "fn:core@lib/core.ts", options());

    // then: definition plus both callers, all counted before the cut
    expect(result.totals?.displayed).toBe(3);
    expect(result.totals?.known).toBe(3);
    expect(result.totals?.hidden).toBe(0);
    expect(result.totals?.byDepth).toEqual([
      { depth: 0, count: 1 },
      { depth: 1, count: 2 },
    ]);
    expect(result.completeness).toBe("complete");

    // then: the definition leads the ranked rows, the rest follow by id
    expect(result.items.map((item) => item.id)).toEqual([
      "fn:core@lib/core.ts",
      "fn:naked@app/naked.ts",
      "fn:use@lib/use.ts",
    ]);
    expect(result.summary).toEqual({
      subjectId: "fn:core@lib/core.ts",
      depth: 1,
      incoming: 2,
      outgoing: 0,
      tests: 0,
      modulesTouched: ["app", "lib"],
    });
  });

  it("#given a static caller #when trace runs #then the summary names hops and no alternative paths", () => {
    // when
    const result = trace(snapshot, "fn:use@lib/use.ts", "fn:core@lib/core.ts", options());

    // then
    expect(result.summary).toEqual({ found: true, hops: 1, alternativePaths: null });
    expect(result.totals?.displayed).toBe(2);
    expect(result.totals?.known).toBe(2);
    expect(result.totals?.hidden).toBe(0);
    expect(result.completeness).toBe("complete");

    // when: the same node traces to itself
    const self = trace(snapshot, "fn:core@lib/core.ts", "fn:core@lib/core.ts", options());

    // then
    expect(self.summary).toEqual({ found: true, hops: 0, alternativePaths: null, reason: "same-node" });
  });

  it("#given more candidates than the limit #when findTests runs #then totals count every candidate", () => {
    // given: two test files importing the same subject file
    const tested: GraphSnapshot = {
      nodes: [fileNode("src/core.ts"), fileNode("src/a.test.ts", true), fileNode("src/b.test.ts", true)],
      edges: [
        { id: "import-1", kind: "IMPORTS", from: "file:src/a.test.ts", to: "file:src/core.ts", confidence: 1, ref: "src/a.test.ts:1" },
        { id: "import-2", kind: "IMPORTS", from: "file:src/b.test.ts", to: "file:src/core.ts", confidence: 1, ref: "src/b.test.ts:2" },
      ],
    };

    // when
    const result = findTests(tested, "src/core.ts", options({ limit: 1 }));

    // then: one row returned, both candidates counted
    expect(result.candidates).toHaveLength(1);
    expect(result.totals?.displayed).toBe(1);
    expect(result.totals?.known).toBe(2);
    expect(result.totals?.hidden).toBe(1);
    expect(result.completeness).toBe("truncated");
    expect(result.completenessReason).toBe("result-limit");
  });

  it("#given a whole index #when search runs #then totals count every match before the cut", () => {
    // given
    const searched: GraphSnapshot = {
      nodes: [
        sym("fn:alpha@a.ts", "a.ts"),
        sym("fn:alphabet@b.ts", "b.ts"),
        sym("fn:beta@c.ts", "c.ts"),
      ],
      edges: [],
    };

    // when
    const result = search(searched, "alpha", options({ limit: 1 }));

    // then: one row shown, both matches counted with their kinds
    expect(result.items).toHaveLength(1);
    expect(result.totals?.displayed).toBe(1);
    expect(result.totals?.known).toBe(2);
    expect(result.totals?.hidden).toBe(1);
    expect(result.totals?.byKind).toEqual([{ kind: "indexed", count: 1 }]);
    expect(result.completeness).toBe("truncated");
    expect(result.completenessReason).toBe("result-limit");
  });
});

describe("code-graph impact knowledge links and time budget", () => {
  const caller = (n: number): GraphNode => ({
    id: `fn:caller${n}@b.ts`,
    kind: "symbol",
    file: "b.ts",
    line: n,
    name: `caller${n}`,
  });
  const callEdge = (n: number): GraphEdge => ({
    id: `call-${n}`,
    kind: "CALLS_STATIC",
    from: `fn:caller${n}@b.ts`,
    to: "fn:core@a.ts",
    confidence: 1,
    ref: `b.ts:${n}`,
  });
  const wideSnapshot = (callerCount: number): GraphSnapshot => ({
    nodes: [
      { id: "fn:core@a.ts", kind: "symbol", file: "a.ts", line: 1, name: "core" },
      ...Array.from({ length: callerCount }, (_, index) => caller(index + 1)),
      { id: "kl-1", kind: "knowledge-link", file: "notes/pk.md", line: 1, target: "pk-1" },
    ],
    edges: [
      ...Array.from({ length: callerCount }, (_, index) => callEdge(index + 1)),
      { id: "link-1", kind: "LINKS_KNOWLEDGE", from: "fn:caller1@b.ts", to: "kl-1", confidence: 1, ref: "b.ts:1" },
    ],
  });

  it("#given knowledge links #when impact runs #then caller rows carry their record ids", () => {
    // given: one caller linked to a knowledge record, one unlinked
    const snapshot = wideSnapshot(2);

    // when
    const result = impact(snapshot, "fn:core@a.ts", options({ maxDepth: 1, limit: 10 }));

    // then: the linked caller carries pk-1, the unlinked caller carries none
    const linked = result.items.find((item) => item.id === "fn:caller1@b.ts");
    const plain = result.items.find((item) => item.id === "fn:caller2@b.ts");
    expect(linked?.knowledgeIds).toEqual(["pk-1"]);
    expect(plain?.knowledgeIds).toEqual([]);
  });

  it("#given a blown budget inside one wide level #when impact runs #then it stops mid-level with a time-budget note", () => {
    // given: twenty callers behind one subject, and a clock that jumps past
    // the budget mid-level. The jump placement is generous (call 12 of ~22
    // setup-plus-level calls) so stray reads cannot move it out of the level.
    const snapshot = wideSnapshot(20);
    const realNow = Date.now;
    let calls = 0;
    Date.now = () => {
      calls += 1;
      return calls < 12 ? 1000 : 5000;
    };
    try {
      // when
      const result = impact(
        snapshot,
        "fn:core@a.ts",
        options({ maxDepth: 2, maxQueryMs: 500, maxExploredEdges: 100000, limit: 100 }),
      );

      // then: the walk stopped early with the budget named, not silently whole
      expect(result.totals?.known ?? 999).toBeLessThan(20);
      expect(result.unresolved.some((note) => note.includes("time budget"))).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("code-graph explore composed answer", () => {
  const exploreSym = (id: string, file: string, line = 1): GraphNode => ({
    id,
    kind: "symbol",
    file,
    line,
    name: id.split("@")[0]?.replace(/^(fn|class|const):/, ""),
  });
  const exploreFile = (file: string): GraphNode => ({
    id: `file:${file}`,
    kind: "file",
    file,
    line: 1,
    name: file,
  });
  const exploreCall = (from: string, to: string, ref: string, n: number): GraphEdge => ({
    id: `explore-call-${n}`,
    kind: "CALLS_STATIC",
    from,
    to,
    confidence: 1,
    ref,
  });
  const exploreDynamic = (from: string, ref: string, n: number): GraphEdge => ({
    id: `explore-dyn-${n}`,
    kind: "CALLS_UNRESOLVED",
    from,
    to: "unknown",
    confidence: 0.5,
    ref,
    uncertain: true,
  });
  const withExploreContent = (
    snapshot: GraphSnapshot,
    linesByFile: Record<string, string[]>,
  ): GraphSnapshot => ({
    ...snapshot,
    content: {
      tokenCap: 5000,
      files: Object.fromEntries(
        Object.entries(linesByFile).map(([file, lines]) => [
          file,
          {
            file,
            language: "ts",
            isTest: file.endsWith(".test.ts"),
            lines,
            tokens: {},
            tokenCount: 0,
            tokenTruncated: false,
          },
        ]),
      ),
      skipped: [],
    },
  });

  it(
    "#given a real fixture #when explore runs #then one call returns bodies plus paths plus blast radius",
    () => {
      // given: the real fixture indexed from the checkout
      const snapshot = indexFiles(fixture("main.ts", "reexport.ts", "main.test.ts"));

      // when
      const result = explore(snapshot, "add", options());

      // then: the envelope keeps its established fields
      expect(result.subject).toBe("add");
      expect(result.suggestedMode).toBe("explore");
      expect(result.coverage).toBe("indexed");
      expect(result.completeness).toBe("complete");
      for (const item of result.items) expect(item.confidence).toBe(1);

      // then: every definition matched with its verbatim line-numbered body, grouped by file
      expect(result.definitions.map((item) => item.id)).toEqual(["fn:add@math.ts"]);
      const group = result.bodies.find((entry) => entry.file === "math.ts");
      expect(group).toBeDefined();
      const body = group?.bodies.find((entry) => entry.id === "fn:add@math.ts");
      expect(body?.startLine).toBe(1);
      expect(body?.truncated).toBe(false);
      expect(body?.lines.map((entry) => `${entry.line}:${entry.text}`)).toEqual([
        "1:export function add(a: number, b: number): number {",
        "2:  return a + b;",
        "3:}",
      ]);

      // then: the static call path between the hits, with its evidence ref
      expect(result.paths.some((path) => path.found && path.hops.length > 0)).toBe(true);
      const hop = result.paths.flatMap((path) => path.hops).find((entry) => entry.to === "fn:add@math.ts");
      expect(hop?.ref).toBe("main.ts:4");

      // then: the blast-radius summary names the dependents in the same call
      expect(result.blastRadius.subjectIds).toEqual(["fn:add@math.ts"]);
      expect(result.impacted.map((item) => item.id)).toContain("fn:run@main.ts");
      expect(result.blastRadius.dependentSymbols).toBeGreaterThan(0);
      expect(result.blastRadius.modules.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT_MS,
  );

  it("#given one name on two files #when explore runs #then every definition returns its body", () => {
    // given: the same symbol name defined in two files
    const snapshot = withExploreContent(
      {
        nodes: [
          exploreSym("fn:foo@a.ts", "a.ts", 1),
          exploreSym("fn:foo@b.ts", "b.ts", 1),
          exploreFile("a.ts"),
          exploreFile("b.ts"),
        ],
        edges: [],
      },
      {
        "a.ts": ["export function foo(): number {", "  return 1;", "}"],
        "b.ts": ["export function foo(): number {", "  return 2;", "}"],
      },
    );

    // when
    const result = explore(snapshot, "foo", options());

    // then: both definitions, both bodies, ambiguity flagged on the envelope
    expect(result.definitions.map((item) => item.id).sort()).toEqual(["fn:foo@a.ts", "fn:foo@b.ts"]);
    expect(result.bodies.map((group) => group.file).sort()).toEqual(["a.ts", "b.ts"]);
    expect(result.bodies.find((group) => group.file === "a.ts")?.bodies[0]?.lines[1]?.text).toBe("  return 1;");
    expect(result.bodies.find((group) => group.file === "b.ts")?.bodies[0]?.lines[1]?.text).toBe("  return 2;");
    expect(result.ambiguousNames).toBe(true);
    expect(result.coverage).toBe("indexed");
  });

  it("#given only a dynamic call #when explore runs #then dynamics stay in unresolved with no guessed edge", () => {
    // given: the subject only calls an unknown callee; nothing static reaches anywhere
    const snapshot = withExploreContent(
      {
        nodes: [
          exploreSym("fn:loose@d.ts", "d.ts", 2),
          exploreSym("fn:far@e.ts", "e.ts", 1),
          exploreFile("d.ts"),
          exploreFile("e.ts"),
        ],
        edges: [exploreDynamic("fn:loose@d.ts", "d.ts:3", 1)],
      },
      {
        "d.ts": ["// dynamic only", "export function loose(x: any): unknown {", "  return x[Math.random()];", "}"],
        "e.ts": ["export function far(): number {", "  return 7;", "}"],
      },
    );

    // when
    const result = explore(snapshot, "loose", options());

    // then: the dynamic site is disclosed as manual review, never as a proven hop
    expect(result.definitions.map((item) => item.id)).toEqual(["fn:loose@d.ts"]);
    expect(result.unresolved.some((note) => note.includes("d.ts:3") && note.includes("unknown callee"))).toBe(true);
    for (const path of result.paths) {
      expect(path.hops.every((hop) => hop.to !== "unknown")).toBe(true);
    }
    expect(result.paths.some((path) => path.blockedByDynamic)).toBe(false);
    expect(result.items.every((item) => item.id !== "unknown")).toBe(true);
    expect(result.blastRadius.unresolvedEdges).toBe(1);
  });
});

/** Temporary route fixture: directory plus its indexed snapshot. */
interface RouteFixture {
  readonly repo: string;
  readonly snapshot: GraphSnapshot;
}

describe("code-graph routes S8 queries", () => {
  function writeRouteFiles(repo: string, files: Record<string, string>): void {
    for (const [rel, text] of Object.entries(files)) {
      const abs = join(repo, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    }
  }

  function routeRepo(): RouteFixture {
    const repo = mkdtempSync(join(tmpdir(), "code-graph-s8-q-"));
    writeRouteFiles(repo, {
      "server.ts":
        `import express from "express";\n` +
        `export function listUsers(): number {\n` +
        `  return 1;\n` +
        `}\n` +
        `const app = express();\n` +
        `app.get('/users', listUsers);\n`,
      "client.ts":
        `export function loadUsers(): unknown {\n` +
        `  return fetch('/users');\n` +
        `}\n` +
        `export function goDynamic(dest: string): unknown {\n` +
        `  return fetch(dest);\n` +
        `}\n` +
        `export function goMissing(): unknown {\n` +
        `  return fetch('/nope');\n` +
        `}\n`,
    });
    const snapshot = indexFiles([join(repo, "server.ts"), join(repo, "client.ts")]);
    return { repo, snapshot };
  }

  it(
    "#given an express handler #when routesForHandler runs #then it returns the URL pattern with framework tags",
    () => {
      const { repo, snapshot } = routeRepo();
      try {
        const result = routesForHandler(snapshot, "fn:listUsers@server.ts", options());
        expect(result.handlerId).toBe("fn:listUsers@server.ts");
        expect(result.routes.length).toBe(1);
        expect(result.routes[0]?.pattern).toBe("/users");
        expect(result.routes[0]?.framework).toBe("express");
        expect(result.routes[0]?.resolver).toBe("express-route-detector");
        expect(result.coverage).toBe("indexed");
        expect(result.items.some((item) => item.id.includes("/users"))).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a code sender #when screensForSender runs #then one hop reaches the screen confirmed",
    () => {
      const { repo, snapshot } = routeRepo();
      try {
        const result = screensForSender(snapshot, "fn:loadUsers@client.ts", options());
        expect(result.senderId).toBe("fn:loadUsers@client.ts");
        expect(result.screens.length).toBe(1);
        expect(result.screens[0]?.pattern).toBe("/users");
        expect(result.screens[0]?.framework).toBe("express");
        expect(result.screens[0]?.inferred).toBeUndefined();
        expect(result.screens[0]?.handlerIds).toContain("fn:listUsers@server.ts");
        expect(result.items[0]?.verdict).toBe("confirmed");
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given computed and unserved senders #when screensForSender runs #then no screen is guessed and unresolved names review",
    () => {
      const { repo, snapshot } = routeRepo();
      try {
        const computed = screensForSender(snapshot, "fn:goDynamic@client.ts", options());
        expect(computed.screens).toEqual([]);
        expect(computed.unresolved.length).toBeGreaterThan(0);
        expect(computed.items.some((item) => item.id === "unknown")).toBe(false);
        const unserved = screensForSender(snapshot, "fn:goMissing@client.ts", options());
        expect(unserved.screens).toEqual([]);
        expect(unserved.unresolved.length).toBeGreaterThan(0);
        expect(unserved.items.some((item) => item.id === "unknown")).toBe(false);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a markup link #when screensForSender runs #then the hop is inferred not confirmed",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s8-q-markup-"));
      try {
        writeRouteFiles(repo, {
          "app/users/page.tsx": `export default function UsersPage(): number {\n  return 1;\n}\n`,
          "app/nav.tsx":
            `import { Link } from "next/link";\n` +
            `export function Nav(): unknown {\n` +
            `  return <Link href="/users">users</Link>;\n` +
            `}\n`,
        });
        const snapshot = indexFiles([join(repo, "app", "users", "page.tsx"), join(repo, "app", "nav.tsx")], {
          rootDir: repo,
        });
        const result = screensForSender(snapshot, "fn:Nav@app/nav.tsx", options());
        expect(result.screens.length).toBe(1);
        expect(result.screens[0]?.inferred).toBe(true);
        expect(result.items[0]?.verdict).toBe("inferred");
        expect(result.screens[0]?.framework).toBe("next-app");
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a handler with a route #when symbolContext runs #then callers include the URL pattern",
    () => {
      const { repo, snapshot } = routeRepo();
      try {
        const result = symbolContext(snapshot, "fn:listUsers@server.ts", options());
        expect(result.callers.some((caller) => caller.id.includes("/users"))).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a sender and its handler #when trace runs #then the static path crosses the route node",
    () => {
      const { repo, snapshot } = routeRepo();
      try {
        const result = trace(snapshot, "fn:loadUsers@client.ts", "fn:listUsers@server.ts", options());
        expect(result.summary.found).toBe(true);
        expect(result.summary.hops).toBe(2);
        expect(result.path.some((step) => step.to.includes("/users") || step.from.includes("/users"))).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});

describe("code-graph routes S9 queries", () => {
  function writeS9qFiles(repo: string, files: Record<string, string>): void {
    for (const [rel, text] of Object.entries(files)) {
      const abs = join(repo, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    }
  }

  function s9qRepo(): RouteFixture {
    const repo = mkdtempSync(join(tmpdir(), "code-graph-s9-q-"));
    writeS9qFiles(repo, {
      "router.ts":
        `import { createRouter, createWebHistory } from "vue-router";\n` +
        `export function UserView(): number {\n` +
        `  return 2;\n` +
        `}\n` +
        `export const router = createRouter({ history: createWebHistory(), routes: [{ path: "/users/:id", component: UserView }] });\n`,
      "client.ts":
        `export function loadUser(): unknown {\n` +
        `  return fetch("/users/7");\n` +
        `}\n` +
        `export function goDynamic(dest: string): unknown {\n` +
        `  return fetch(dest);\n` +
        `}\n`,
    });
    const snapshot = indexFiles([join(repo, "router.ts"), join(repo, "client.ts")]);
    return { repo, snapshot };
  }

  it(
    "#given a vue handler #when routesForHandler runs #then it returns the pattern with framework tags",
    () => {
      const { repo, snapshot } = s9qRepo();
      try {
        const result = routesForHandler(snapshot, "fn:UserView@router.ts", options());
        expect(result.handlerId).toBe("fn:UserView@router.ts");
        expect(result.routes.length).toBe(1);
        expect(result.routes[0]?.pattern).toBe("/users/:id");
        expect(result.routes[0]?.framework).toBe("vue-router");
        expect(result.routes[0]?.resolver).toBe("vue-router-detector");
        expect(result.coverage).toBe("indexed");
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a vue sender #when screensForSender runs #then one hop reaches the screen confirmed",
    () => {
      const { repo, snapshot } = s9qRepo();
      try {
        const result = screensForSender(snapshot, "fn:loadUser@client.ts", options());
        expect(result.screens.length).toBe(1);
        expect(result.screens[0]?.pattern).toBe("/users/:id");
        expect(result.screens[0]?.framework).toBe("vue-router");
        expect(result.screens[0]?.inferred).toBeUndefined();
        expect(result.screens[0]?.handlerIds).toContain("fn:UserView@router.ts");
        expect(result.items[0]?.verdict).toBe("confirmed");
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given computed and unserved s9 senders #when screensForSender runs #then no screen is guessed",
    () => {
      const { repo, snapshot } = s9qRepo();
      try {
        const computed = screensForSender(snapshot, "fn:goDynamic@client.ts", options());
        expect(computed.screens).toEqual([]);
        expect(computed.unresolved.length).toBeGreaterThan(0);
        expect(computed.items.some((item) => item.id === "unknown")).toBe(false);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a tanstack markup link #when screensForSender runs #then the hop is inferred not confirmed",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s9-q-tanstack-"));
      try {
        writeS9qFiles(repo, {
          "routes.tsx":
            `import { createFileRoute, Link } from "@tanstack/react-router";\n` +
            `export function UsersPage(): number {\n` +
            `  return 1;\n` +
            `}\n` +
            `export const usersRoute = createFileRoute("/users")({ component: UsersPage });\n` +
            `export function Nav(): unknown {\n` +
            `  return <Link to="/users">users</Link>;\n` +
            `}\n`,
        });
        const snapshot = indexFiles([join(repo, "routes.tsx")]);
        const result = screensForSender(snapshot, "fn:Nav@routes.tsx", options());
        expect(result.screens.length).toBe(1);
        expect(result.screens[0]?.inferred).toBe(true);
        expect(result.items[0]?.verdict).toBe("inferred");
        expect(result.screens[0]?.framework).toBe("tanstack-router");
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given an angular sender and handler #when trace runs #then the static path crosses the route node",
    () => {
      const repo = mkdtempSync(join(tmpdir(), "code-graph-s9-q-angular-"));
      try {
        writeS9qFiles(repo, {
          "app.routes.ts":
            `import { RouterModule } from "@angular/router";\n` +
            `export function HomeComponent(): number {\n` +
            `  return 1;\n` +
            `}\n` +
            `const routes = [{ path: "home", component: HomeComponent }];\n` +
            `export const routing = RouterModule.forRoot(routes);\n` +
            `export function go(router: { navigate: (parts: string[]) => unknown }): unknown {\n` +
            `  return router.navigate(["home"]);\n` +
            `}\n`,
        });
        const snapshot = indexFiles([join(repo, "app.routes.ts")]);
        const routed = routesForHandler(snapshot, "fn:HomeComponent@app.routes.ts", options());
        expect(routed.routes.length).toBe(1);
        expect(routed.routes[0]?.framework).toBe("angular");
        const result = trace(snapshot, "fn:go@app.routes.ts", "fn:HomeComponent@app.routes.ts", options());
        expect(result.summary.found).toBe(true);
        expect(result.summary.hops).toBe(2);
        expect(result.path.some((step) => step.to.includes("/home") || step.from.includes("/home"))).toBe(true);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
