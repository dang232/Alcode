/**
 * Contract tests for honest query totals (`queries.ts`): the client never
 * derives a count itself, so every number here is asserted exactly. All
 * snapshots are hand-built (no TypeScript server round-trip) so the
 * fixtures stay small and the ordering pins stay deterministic.
 *
 * Precedent: `queries.test.ts` (given/when/then comments, `options()`
 * scope helper, `computeScopeFingerprint` revision binding).
 */

import { describe, expect, it } from "bun:test";
import type { GraphEdge, GraphNode, GraphSnapshot } from "./extract";
import { computeScopeFingerprint } from "./schema";
import { findTests, impact, search, symbolContext, trace, verdictForEvidenceKind, type QueryOptions } from "./queries";

const PROJECT_ID = "demo-12345678";
const WORKTREE_ID = "wt-queries-contract";
const REVISION = "b".repeat(40);

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

function sym(id: string, file: string, line = 1): GraphNode {
  return { id, kind: "symbol", file, line, name: id.split("@")[0]?.replace(/^(fn|class|const):/, "") };
}

function staticCall(from: string, to: string, ref: string, n: number): GraphEdge {
  return { id: `call-${n}`, kind: "CALLS_STATIC", from, to, confidence: 1, ref };
}

/** 25 dependents of one subject, zero-padded so id order is the rank order. */
function fanOutSnapshot() {
  const subject = "fn:core@lib/core.ts";
  const nodes: GraphNode[] = [sym(subject, "lib/core.ts", 2)];
  const edges: GraphEdge[] = [];
  const dependents: string[] = [];
  for (let n = 0; n < 25; n += 1) {
    const padded = String(n).padStart(2, "0");
    const id = `fn:use${padded}@app/u${padded}.ts`;
    dependents.push(id);
    nodes.push(sym(id, `app/u${padded}.ts`, 3));
    edges.push(staticCall(id, subject, `app/u${padded}.ts:3`, n));
  }
  dependents.sort();
  return { snapshot: { nodes, edges }, subject, dependents };
}

describe("code-graph query totals contract", () => {
  it("#given 25 dependents and limit 10 #when impact runs #then known is 25, displayed 10, hidden 15", () => {
    // given
    const { snapshot, subject, dependents } = fanOutSnapshot();

    // when
    const result = impact(snapshot, subject, options({ limit: 10 }));

    // then: the whole reachable set walked, only the display cut
    expect(result.totals?.known).toBe(25);
    expect(result.totals?.displayed).toBe(10);
    expect(result.totals?.hidden).toBe(15);
    expect(result.totals?.byDepth).toEqual([{ depth: 1, count: 25 }]);
    expect(result.completeness).toBe("truncated");
    expect(result.completenessReason).toBe("result-limit");
    expect(result.truncated).toBe(true);

    // then: the returned rows are the first 10 of the deterministic rank
    expect(result.impacted.map((item) => item.id)).toEqual(dependents.slice(0, 10));
    expect(result.summary.dependentFiles).toBe(25);
    expect(result.summary.dependentSymbols).toBe(25);
    expect(result.summary.modules).toEqual([{ module: "app", count: 25 }]);
    expect(result.summary.callersWithoutTestPath).toBe(25);
    expect(result.summary.completeness).toBe("truncated");
  });

  it("#given a chain longer than the depth budget #when impact runs #then completeness is truncated with byDepth", () => {
    // given: s3 -> s2 -> s1 -> s0, budget stops after the first hop
    const snapshot: GraphSnapshot = {
      nodes: [
        sym("fn:s0@m.ts", "m.ts", 1),
        sym("fn:s1@m.ts", "m.ts", 2),
        sym("fn:s2@m.ts", "m.ts", 3),
        sym("fn:s3@m.ts", "m.ts", 4),
      ],
      edges: [
        staticCall("fn:s1@m.ts", "fn:s0@m.ts", "m.ts:2", 1),
        staticCall("fn:s2@m.ts", "fn:s1@m.ts", "m.ts:3", 2),
        staticCall("fn:s3@m.ts", "fn:s2@m.ts", "m.ts:4", 3),
      ],
    };

    // when
    const cut = impact(snapshot, "fn:s0@m.ts", options({ maxDepth: 1 }));

    // then: one hop walked, the frontier still holds callers, budget named
    expect(cut.totals?.known).toBe(1);
    expect(cut.totals?.displayed).toBe(1);
    expect(cut.totals?.hidden).toBe(0);
    expect(cut.totals?.byDepth).toEqual([{ depth: 1, count: 1 }]);
    expect(cut.completeness).toBe("truncated");
    expect(cut.completenessReason).toBe("depth-budget");
    expect(cut.summary.completeness).toBe("truncated");
    expect(cut.unresolved.some((note) => note.includes("depth budget 1"))).toBe(true);

    // when: the budget covers the whole chain
    const whole = impact(snapshot, "fn:s0@m.ts", options({ maxDepth: 3 }));

    // then: every hop walked and counted per depth
    expect(whole.totals?.known).toBe(3);
    expect(whole.totals?.byDepth).toEqual([
      { depth: 1, count: 1 },
      { depth: 2, count: 1 },
      { depth: 3, count: 1 },
    ]);
    expect(whole.completeness).toBe("complete");
    expect(whole.completenessReason).toBeUndefined();
  });

  it("#given a partial index #when queries run #then known is null with index-truncated", () => {
    // given: the extractor skipped a binary file, so no total is knowable
    const snapshot: GraphSnapshot = {
      nodes: [sym("fn:core@lib/core.ts", "lib/core.ts", 2), sym("fn:use@lib/use.ts", "lib/use.ts", 3)],
      edges: [staticCall("fn:use@lib/use.ts", "fn:core@lib/core.ts", "lib/use.ts:3", 1)],
      content: {
        tokenCap: 5000,
        files: {},
        skipped: [{ file: "assets/logo.bin", reason: "binary", language: "bin", isTest: false }],
      },
    };

    // when
    const searched = search(snapshot, "core", options());
    const impacted = impact(snapshot, "fn:core@lib/core.ts", options());
    const neighboured = symbolContext(snapshot, "fn:core@lib/core.ts", options());

    // then: rows are still returned, but no query claims a total
    for (const result of [searched, impacted, neighboured]) {
      expect(result.totals?.known).toBeNull();
      expect(result.totals?.hidden).toBeNull();
      expect(result.completeness).toBe("partial");
      expect(result.completenessReason).toBe("index-truncated");
    }
    expect(searched.items.length).toBeGreaterThan(0);
    expect(impacted.impacted.map((item) => item.id)).toEqual(["fn:use@lib/use.ts"]);
  });

  it("#given an unresolved frontier edge #when trace runs #then the reason is blocked-by-unresolved", () => {
    // given: A calls an unknown callee, and no static path reaches B
    const blocked: GraphSnapshot = {
      nodes: [sym("fn:a@a.ts", "a.ts", 1), sym("fn:b@b.ts", "b.ts", 2)],
      edges: [{ id: "u-1", kind: "CALLS_UNRESOLVED", from: "fn:a@a.ts", to: "unknown", confidence: 0.5, ref: "a.ts:1" }],
    };
    const clean: GraphSnapshot = {
      nodes: [sym("fn:a@a.ts", "a.ts", 1), sym("fn:b@b.ts", "b.ts", 2)],
      edges: [],
    };

    // when
    const result = trace(blocked, "fn:a@a.ts", "fn:b@b.ts", options());

    // then: the dynamics on the frontier could complete a path, never a proven absence
    expect(result.summary).toEqual({ found: false, hops: null, alternativePaths: null, reason: "blocked-by-unresolved" });
    expect(result.completeness).toBe("partial");
    expect(result.completenessReason).toBe("unresolved-edges");

    // when: the frontier holds no unresolved edge
    const missing = trace(clean, "fn:a@a.ts", "fn:b@b.ts", options());

    // then: the absence is proven as far as the static graph reaches
    expect(missing.summary).toEqual({ found: false, hops: null, alternativePaths: null, reason: "no-path-in-graph" });
    expect(missing.completeness).toBe("complete");
  });

  it("#given the same input twice #when queries run #then the row order is identical", () => {
    // given
    const { snapshot, subject } = fanOutSnapshot();

    // when
    const firstImpact = impact(snapshot, subject, options({ limit: 10 }));
    const secondImpact = impact(snapshot, subject, options({ limit: 10 }));
    const firstSearch = search(snapshot, "use", options({ limit: 10 }));
    const secondSearch = search(snapshot, "use", options({ limit: 10 }));

    // then: distance asc, confidence desc, kind priority, id asc — no run-to-run drift
    expect(secondImpact.impacted.map((item) => item.id)).toEqual(firstImpact.impacted.map((item) => item.id));
    expect(secondSearch.items.map((item) => item.id)).toEqual(firstSearch.items.map((item) => item.id));
    expect(firstImpact.impacted.map((item) => item.id)).toEqual(
      firstImpact.impacted.map((item) => item.id).slice().sort(),
    );
  });

  it("#given one covered and one uncovered caller #when impact runs #then only the uncovered caller counts", () => {
    // given: c1 is covered by a TESTS edge to its file; c2 sits next to a
    // test file with no edge, which must NOT count as coverage
    const snapshot: GraphSnapshot = {
      nodes: [
        sym("fn:s@src/s.ts", "src/s.ts", 1),
        sym("fn:c1@src/c1.ts", "src/c1.ts", 2),
        sym("fn:c2@src/c2.ts", "src/c2.ts", 3),
        { id: "file:src/c1.test.ts", kind: "file", file: "src/c1.test.ts", line: 1, name: "src/c1.test.ts", isTest: true },
        { id: "file:src/decoy.test.ts", kind: "file", file: "src/decoy.test.ts", line: 1, name: "src/decoy.test.ts", isTest: true },
      ],
      edges: [
        staticCall("fn:c1@src/c1.ts", "fn:s@src/s.ts", "src/c1.ts:2", 1),
        staticCall("fn:c2@src/c2.ts", "fn:s@src/s.ts", "src/c2.ts:3", 2),
        { id: "tests-1", kind: "TESTS", from: "file:src/c1.test.ts", to: "file:src/c1.ts", confidence: 1, ref: "src/c1.test.ts:1" },
      ],
    };

    // when
    const result = impact(snapshot, "fn:s@src/s.ts", options());

    // then: c2 has no TESTS edge to it or its file, the same-directory decoy notwithstanding
    expect(result.totals?.known).toBe(2);
    expect(result.summary.callersWithoutTestPath).toBe(1);
    expect(result.summary.modules).toEqual([{ module: "src", count: 2 }]);
    expect(result.completeness).toBe("complete");
  });
});

describe("code-graph query answer contract (corrections)", () => {
  const unresolvedCall = (from: string, ref: string, n: number): GraphEdge => ({
    id: `unresolved-${n}`,
    kind: "CALLS_UNRESOLVED",
    from,
    to: "unknown",
    confidence: 0.5,
    ref,
  });

  it("#given a dependent test file with its own unresolved call #when impact runs #then completeness stays complete while the site stays disclosed", () => {
    // given: add <- run <- checkMain, where the test file's own test(...)
    // call is unresolved dynamics, not a hidden caller
    const snapshot: GraphSnapshot = {
      nodes: [
        sym("fn:add@math.ts", "math.ts", 1),
        sym("fn:run@main.ts", "main.ts", 4),
        sym("fn:checkMain@main.test.ts", "main.test.ts", 3),
      ],
      edges: [
        staticCall("fn:run@main.ts", "fn:add@math.ts", "main.ts:4", 1),
        staticCall("fn:checkMain@main.test.ts", "fn:run@main.ts", "main.test.ts:3", 2),
        unresolvedCall("fn:checkMain@main.test.ts", "main.test.ts:5", 3),
      ],
    };

    // when
    const result = impact(snapshot, "fn:add@math.ts", options());

    // then: reverse reachability is whole — an unresolved call inside a
    // dependent cannot hide another caller — while the site stays disclosed
    expect(result.completeness).toBe("complete");
    expect(result.completenessReason).toBeUndefined();
    expect(result.summary.completeness).toBe("complete");
    expect(result.summary.unresolvedEdges).toBeGreaterThanOrEqual(1);
    expect(result.unresolved.some((note) => note.includes("main.test.ts:5"))).toBe(true);
    expect(result.coverage).toBe("indexed");
    expect(result.suggestedMode).toBe("impact");
  });

  it("#given static vs unresolved evidence #when rows return #then verdict is confirmed vs inferred", () => {
    // given: one caller over a resolved edge, nothing else resolved
    const snapshot: GraphSnapshot = {
      nodes: [sym("fn:s@s.ts", "s.ts", 1), sym("fn:c@c.ts", "c.ts", 2)],
      edges: [staticCall("fn:c@c.ts", "fn:s@s.ts", "c.ts:2", 1)],
    };

    // when
    const result = symbolContext(snapshot, "fn:s@s.ts", options());

    // then: the caller row is backed by CALLS_STATIC, the definition by presence alone
    const caller = result.callers.find((item) => item.id === "fn:c@c.ts");
    expect(caller?.evidence[0]?.edge).toBe("CALLS_STATIC");
    expect(caller?.verdict).toBe("confirmed");
    expect(result.definition?.verdict).toBe("inferred");

    // then: the contract mapping the panel relies on instead of inventing
    for (const kind of ["DEFINES", "EXPORTS", "IMPORTS", "CALLS_STATIC", "TESTS"]) {
      expect(verdictForEvidenceKind(kind)).toBe("confirmed");
    }
    expect(verdictForEvidenceKind("CALLS_UNRESOLVED")).toBe("inferred");
    expect(verdictForEvidenceKind("indexed")).toBe("inferred");
  });

  it("#given test and source rows #when search runs #then isTest marks only the test-file row", () => {
    // given
    const snapshot: GraphSnapshot = {
      nodes: [sym("fn:run@main.ts", "main.ts", 4), sym("fn:checkMain@main.test.ts", "main.test.ts", 3)],
      edges: [],
    };

    // when
    const result = search(snapshot, "main", options());

    // then: the engine's own test-path rule decides, never a panel regex
    expect(result.items).toHaveLength(2);
    expect(result.items.find((item) => item.id === "fn:checkMain@main.test.ts")?.isTest).toBe(true);
    expect(result.items.find((item) => item.id === "fn:run@main.ts")?.isTest).toBe(false);
  });

  it("#given two nodes sharing a display name #when search runs #then ambiguousNames is true", () => {
    // given: the same display name on two different ids, plus an unrelated row
    const snapshot: GraphSnapshot = {
      nodes: [
        sym("fn:foo@a.ts", "a.ts", 1),
        sym("fn:foo@b.ts", "b.ts", 2),
        sym("fn:bar@c.ts", "c.ts", 3),
      ],
      edges: [],
    };

    // when
    const ambiguous = search(snapshot, "foo", options());

    // then: both same-named rows return and the envelope says so
    expect(ambiguous.items.map((item) => item.id).sort()).toEqual(["fn:foo@a.ts", "fn:foo@b.ts"]);
    expect(ambiguous.ambiguousNames).toBe(true);

    // when: only one row carries the name
    const single = search(snapshot, "bar", options());

    // then: no flag
    expect(single.items).toHaveLength(1);
    expect(single.ambiguousNames).toBeUndefined();
  });

  it("#given a cut answer #when queries run #then shownOf matches totals for the same query", () => {
    // given: three static callers, limit one
    const snapshot: GraphSnapshot = {
      nodes: [
        sym("fn:s@s.ts", "s.ts", 1),
        sym("fn:c1@c1.ts", "c1.ts", 2),
        sym("fn:c2@c2.ts", "c2.ts", 3),
        sym("fn:c3@c3.ts", "c3.ts", 4),
      ],
      edges: [
        staticCall("fn:c1@c1.ts", "fn:s@s.ts", "c1.ts:2", 1),
        staticCall("fn:c2@c2.ts", "fn:s@s.ts", "c2.ts:3", 2),
        staticCall("fn:c3@c3.ts", "fn:s@s.ts", "c3.ts:4", 3),
      ],
    };

    // when
    const impacted = impact(snapshot, "fn:s@s.ts", options({ limit: 1 }));

    // then: the impacted list names what is shown of what was walked
    expect(impacted.shownOf?.impacted).toEqual({ shown: 1, total: 3 });
    expect(impacted.shownOf?.impacted?.shown).toBe(impacted.totals?.displayed);
    expect(impacted.shownOf?.impacted?.total).toBe(impacted.totals?.known);

    // when
    const neighboured = symbolContext(snapshot, "fn:s@s.ts", options({ limit: 1 }));

    // then: caller and callee lists each name their own cut
    expect(neighboured.shownOf?.callers).toEqual({ shown: 1, total: 3 });
    expect(neighboured.shownOf?.callees).toEqual({ shown: 0, total: 0 });

    // given: two candidate tests importing the same subject file
    const tested: GraphSnapshot = {
      nodes: [
        { id: "file:src/core.ts", kind: "file", file: "src/core.ts", line: 1, name: "src/core.ts" },
        { id: "file:src/a.test.ts", kind: "file", file: "src/a.test.ts", line: 1, name: "src/a.test.ts", isTest: true },
        { id: "file:src/b.test.ts", kind: "file", file: "src/b.test.ts", line: 1, name: "src/b.test.ts", isTest: true },
      ],
      edges: [
        { id: "import-1", kind: "IMPORTS", from: "file:src/a.test.ts", to: "file:src/core.ts", confidence: 1, ref: "src/a.test.ts:1" },
        { id: "import-2", kind: "IMPORTS", from: "file:src/b.test.ts", to: "file:src/core.ts", confidence: 1, ref: "src/b.test.ts:2" },
      ],
    };

    // when
    const found = findTests(tested, "src/core.ts", options({ limit: 1 }));

    // then
    expect(found.shownOf?.candidates).toEqual({ shown: 1, total: 2 });
    expect(found.shownOf?.candidates?.shown).toBe(found.totals?.displayed);
    expect(found.shownOf?.candidates?.total).toBe(found.totals?.known);
  });

  it("#given two edges from the same caller #when symbolContext runs #then rows collapse with duplicatesDropped", () => {
    // given: one caller calling twice, so two rows share an id
    const snapshot: GraphSnapshot = {
      nodes: [sym("fn:s@s.ts", "s.ts", 1), sym("fn:c@c.ts", "c.ts", 2)],
      edges: [
        staticCall("fn:c@c.ts", "fn:s@s.ts", "c.ts:2", 1),
        staticCall("fn:c@c.ts", "fn:s@s.ts", "c.ts:9", 2),
      ],
    };

    // when
    const result = symbolContext(snapshot, "fn:s@s.ts", options());

    // then: first row wins, the collapse is counted
    expect(result.items.map((item) => item.id)).toEqual(["fn:s@s.ts", "fn:c@c.ts"]);
    expect(result.duplicatesDropped).toBe(1);

    // when: every row already has its own id
    const clean = symbolContext(
      { nodes: snapshot.nodes, edges: snapshot.edges.slice(0, 1) },
      "fn:s@s.ts",
      options(),
    );

    // then: no flag
    expect(clean.duplicatesDropped).toBeUndefined();
  });

  it("#given test rows and the caller filter #when search runs #then it echoes the query and reports hiddenTestCount pre-ranked", () => {
    // given: an exact-name hit, a source substring hit, and a test substring hit
    const snapshot: GraphSnapshot = {
      nodes: [
        sym("fn:main@util.ts", "util.ts", 1),
        sym("fn:run@main.ts", "main.ts", 4),
        sym("fn:checkMain@main.test.ts", "main.test.ts", 3),
      ],
      edges: [],
    };

    // when: the caller filters test paths itself
    const filtered = search(snapshot, "main", options({ excludeTests: true }));

    // then: the executed text is echoed and the suppressed test row is counted
    expect(filtered.query).toBe("main");
    expect(filtered.hiddenTestCount).toBe(1);
    expect(filtered.items.map((item) => item.id)).toEqual(["fn:main@util.ts", "fn:run@main.ts"]);
    expect(filtered.items.every((item) => item.isTest !== true)).toBe(true);
    expect(filtered.suggestedMode).toBe("explore");

    // then: the surviving page keeps server-side rank order, never panel re-sorts
    const ranks = filtered.items.map((item) => item.rank ?? 0);
    expect([...ranks].sort((left, right) => left - right)).toEqual(ranks);

    // when: no filter
    const unfiltered = search(snapshot, "main", options());

    // then: nothing suppressed, nothing reported
    expect(unfiltered.query).toBe("main");
    expect(unfiltered.hiddenTestCount).toBeUndefined();
    expect(unfiltered.items).toHaveLength(3);
  });

  it("#given each query #when it answers #then suggestedMode names the follow-up mode", () => {
    // given
    const snapshot: GraphSnapshot = {
      nodes: [
        sym("fn:a@a.ts", "a.ts", 1),
        sym("fn:b@b.ts", "b.ts", 2),
        { id: "file:a.ts", kind: "file", file: "a.ts", line: 1, name: "a.ts" },
        { id: "file:a.test.ts", kind: "file", file: "a.test.ts", line: 1, name: "a.test.ts", isTest: true },
      ],
      edges: [
        staticCall("fn:b@b.ts", "fn:a@a.ts", "b.ts:2", 1),
        { id: "import-1", kind: "IMPORTS", from: "file:a.test.ts", to: "file:a.ts", confidence: 1, ref: "a.test.ts:1" },
      ],
    };

    // then: each answer names the mode that produced it
    expect(search(snapshot, "a", options()).suggestedMode).toBe("explore");
    expect(symbolContext(snapshot, "fn:a@a.ts", options()).suggestedMode).toBe("explore");
    expect(impact(snapshot, "fn:a@a.ts", options()).suggestedMode).toBe("impact");
    expect(trace(snapshot, "fn:b@b.ts", "fn:a@a.ts", options()).suggestedMode).toBe("trace");
    expect(findTests(snapshot, "a.ts", options()).suggestedMode).toBe("explore");
  });
});
