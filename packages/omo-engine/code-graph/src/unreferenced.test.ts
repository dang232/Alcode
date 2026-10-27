/**
 * Tests for `findUnreferenced` (`queries.ts`): files and export contracts
 * nobody statically reaches surface as potentially unreferenced, never as
 * proven unused. All snapshots are hand-built (no TypeScript server
 * round-trip) so the fixtures stay small and the ordering pins stay
 * deterministic.
 *
 * Precedent: `queries.contract.test.ts` (given/when/then comments,
 * `options()` scope helper, `computeScopeFingerprint` revision binding).
 */

import { describe, expect, it } from "bun:test";
import type { GraphEdge, GraphNode, GraphSnapshot } from "./extract";
import { computeScopeFingerprint } from "./schema";
import { findUnreferenced, type QueryOptions } from "./queries";

const PROJECT_ID = "demo-12345678";
const WORKTREE_ID = "wt-unreferenced-test";
const REVISION = "c".repeat(40);

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

function fileNode(file: string, isTest = false): GraphNode {
  const node: GraphNode = {
    id: `file:${file}`,
    kind: "file",
    file,
    line: 1,
    name: file,
  };
  return isTest ? { ...node, isTest: true } : node;
}

function importsEdge(from: string, to: string, n: number): GraphEdge {
  return {
    id: `import-${n}`,
    kind: "IMPORTS",
    from: `file:${from}`,
    to: `file:${to}`,
    confidence: 1,
    ref: `${from}:1`,
  };
}

function symbolNode(id: string, file: string, line: number, name: string): GraphNode {
  return { id, kind: "symbol", file, line, name };
}

function contractNode(id: string, file: string, line: number, name: string, target: string): GraphNode {
  return { id, kind: "export-contract", file, line, name, target };
}

function exportsEdge(n: number, file: string, contract: string, line: number): GraphEdge {
  return {
    id: `exports-${n}`,
    kind: "EXPORTS",
    from: `file:${file}`,
    to: contract,
    confidence: 1,
    ref: `${file}:${line}`,
  };
}

function callsEdge(n: number, from: string, to: string, ref: string): GraphEdge {
  return { id: `calls-${n}`, kind: "CALLS_STATIC", from, to, confidence: 1, ref };
}

/**
 * Fixture-shaped snapshot mirroring the phase2 probe graph: main calls
 * handleRequest, handleRequest calls createUser, createUser calls save,
 * each across files. handler.ts also exports formatUnused, which nothing
 * calls even though handler.ts itself is imported. util.ts is imported by
 * nobody.
 */
function fixtureSnapshot(): GraphSnapshot {
  const main = "apps/web/src/main.ts";
  const handler = "apps/web/src/handler.ts";
  const user = "packages/core/src/user.ts";
  const store = "packages/core/src/store.ts";
  const util = "packages/core/src/util.ts";
  const handleRequest = `fn:handleRequest@${handler}`;
  const formatUnused = `fn:formatUnused@${handler}`;
  const createUser = `fn:createUser@${user}`;
  const save = `fn:save@${store}`;
  return {
    nodes: [
      fileNode(main),
      fileNode(handler),
      fileNode(user),
      fileNode(store),
      fileNode(util),
      symbolNode(handleRequest, handler, 3, "handleRequest"),
      symbolNode(formatUnused, handler, 9, "formatUnused"),
      symbolNode(createUser, user, 3, "createUser"),
      symbolNode(save, store, 3, "save"),
      contractNode(`export:handleRequest@${handler}`, handler, 2, "handleRequest", handleRequest),
      contractNode(`export:formatUnused@${handler}`, handler, 2, "formatUnused", formatUnused),
      contractNode(`export:createUser@${user}`, user, 2, "createUser", createUser),
      contractNode(`export:save@${store}`, store, 2, "save", save),
    ],
    edges: [
      exportsEdge(1, handler, `export:handleRequest@${handler}`, 2),
      exportsEdge(2, handler, `export:formatUnused@${handler}`, 2),
      exportsEdge(3, user, `export:createUser@${user}`, 2),
      exportsEdge(4, store, `export:save@${store}`, 2),
      importsEdge(handler, user, 11),
      importsEdge(user, store, 12),
      importsEdge(main, handler, 13),
      callsEdge(1, `file:${main}`, handleRequest, `${main}:5`),
      callsEdge(2, handleRequest, createUser, `${handler}:4`),
      callsEdge(3, createUser, save, `${user}:4`),
    ],
  };
}

describe("code-graph findUnreferenced", () => {
  it("#given an orphan and a used module #when it runs #then the orphan is a candidate and the used file is not", () => {
    // given: orphan.ts is imported by nobody; used.ts is imported by main.ts
    // (main.ts is entry-like, so it stays out of the candidate list itself)
    const snapshot: GraphSnapshot = {
      nodes: [fileNode("orphan.ts"), fileNode("used.ts"), fileNode("main.ts")],
      edges: [importsEdge("main.ts", "used.ts", 1)],
    };

    // when
    const result = findUnreferenced(snapshot, options());

    // then
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["file:orphan.ts"]);
    const [orphan] = result.candidates;
    expect(orphan?.file).toBe("orphan.ts");
    expect(orphan?.kind).toBe("file");
    expect(orphan?.reason).toBe("no-inbound-edges");
    expect(orphan?.inboundImports).toBe(0);
    expect(orphan?.inboundCalls).toBe(0);
    expect(orphan?.inboundTests).toBe(0);
    expect(orphan?.inboundKnowledge).toBe(0);

    // then: the envelope stays honest on a whole index
    expect(result.coverage).toBe("indexed");
    expect(result.completeness).toBe("complete");
    expect(result.completenessReason).toBeUndefined();
    expect(result.totals).toEqual({ displayed: 1, known: 1, hidden: 0 });
    expect(result.summary.candidatesTotal).toBe(1);
    expect(result.projectId).toBe(PROJECT_ID);
  });

  it("#given an exported-but-never-imported symbol #when it runs #then the reason is only-exported", () => {
    // given: lib.ts defines and exports helper, nothing imports it
    const snapshot: GraphSnapshot = {
      nodes: [
        fileNode("lib.ts"),
        {
          id: "export:helper@lib.ts",
          kind: "export-contract",
          file: "lib.ts",
          line: 2,
          name: "helper",
          target: "fn:helper@lib.ts",
        },
      ],
      edges: [
        {
          id: "exports-1",
          kind: "EXPORTS",
          from: "file:lib.ts",
          to: "export:helper@lib.ts",
          confidence: 1,
          ref: "lib.ts:2",
        },
      ],
    };

    // when
    const result = findUnreferenced(snapshot, options());

    // then: the contract row names the export-only reference, tests add nothing
    const contract = result.candidates.find((candidate) => candidate.id === "export:helper@lib.ts");
    expect(contract?.kind).toBe("symbol");
    expect(contract?.reason).toBe("only-exported");
    expect(contract?.inboundImports).toBe(0);
    expect(contract?.inboundCalls).toBe(0);
    expect(contract?.inboundTests).toBe(0);
  });

  it("#given a test file and an index file #when it runs #then both count as entry-like and never appear", () => {
    // given: a test file reaching plain.ts (TESTS edges never disqualify)
    // plus an entry-basename file, neither of which may surface
    const snapshot: GraphSnapshot = {
      nodes: [fileNode("plain.ts"), fileNode("plain.test.ts", true), fileNode("index.ts")],
      edges: [
        {
          id: "tests-1",
          kind: "TESTS",
          from: "file:plain.test.ts",
          to: "file:plain.ts",
          confidence: 1,
          ref: "plain.test.ts:1",
        },
      ],
    };

    // when
    const result = findUnreferenced(snapshot, options());

    // then
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["file:plain.ts"]);
    expect(result.candidates[0]?.inboundTests).toBe(1);
    expect(result.summary.excludedEntryLike).toBe(2);
    expect(result.summary.analyzedFiles).toBe(3);
    expect(result.summary.unanalyzedNote).toContain("non-TypeScript");
  });

  it("#given the same input twice #when it runs #then the candidate order is identical", () => {
    // given: three orphans plus a referenced module, none entry-like
    const snapshot: GraphSnapshot = {
      nodes: [fileNode("gamma.ts"), fileNode("alpha.ts"), fileNode("beta.ts"), fileNode("used.ts"), fileNode("main.ts")],
      edges: [importsEdge("main.ts", "used.ts", 1)],
    };

    // when
    const first = findUnreferenced(snapshot, options());
    const second = findUnreferenced(snapshot, options());

    // then: inbound total asc, file path asc — no run-to-run drift
    expect(first.candidates.map((candidate) => candidate.id)).toEqual([
      "file:alpha.ts",
      "file:beta.ts",
      "file:gamma.ts",
    ]);
    expect(second.candidates.map((candidate) => candidate.id)).toEqual(
      first.candidates.map((candidate) => candidate.id),
    );
  });

  it("#given three candidates and limit 1 #when it runs #then totals are known 3, displayed 1, hidden 2", () => {
    // given
    const snapshot: GraphSnapshot = {
      nodes: [fileNode("alpha.ts"), fileNode("beta.ts"), fileNode("gamma.ts")],
      edges: [],
    };

    // when
    const result = findUnreferenced(snapshot, options({ limit: 1 }));

    // then
    expect(result.candidates).toHaveLength(1);
    expect(result.totals?.displayed).toBe(1);
    expect(result.totals?.known).toBe(3);
    expect(result.totals?.hidden).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.completeness).toBe("truncated");
    expect(result.completenessReason).toBe("result-limit");
    expect(result.summary.candidatesTotal).toBe(3);
    expect(result.unresolved.some((note) => note.includes("truncated to 1 of 3"))).toBe(true);
  });

  it("#given a truncated index #when it runs #then completeness is partial and the note names unjudgeable content", () => {
    // given: the extractor skipped a binary file, so no answer is whole
    const snapshot: GraphSnapshot = {
      nodes: [fileNode("orphan.ts")],
      edges: [],
      content: {
        tokenCap: 5000,
        files: {},
        skipped: [{ file: "assets/logo.bin", reason: "binary", language: "bin", isTest: false }],
      },
    };

    // when
    const result = findUnreferenced(snapshot, options());

    // then: the row still returns, but the answer admits its bounds
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["file:orphan.ts"]);
    expect(result.coverage).toBe("partial");
    expect(result.completeness).toBe("partial");
    expect(result.completenessReason).toBe("index-truncated");
    expect(result.unresolved.some((note) => note.includes("unanalyzed content cannot be judged"))).toBe(true);
    expect(result.summary.unanalyzedNote).toContain("entry points");
  });

  it("#given the fixture call chain main -> handleRequest -> createUser -> save #when it runs #then no used symbol is a candidate", () => {
    // given: every export on the chain is called through its symbol id,
    // exactly as the extractor wires CALLS_STATIC (see extract.ts recordCall)
    const snapshot = fixtureSnapshot();

    // when
    const result = findUnreferenced(snapshot, options());

    // then: used exports are referenced through their symbol ids, never candidates
    const ids = result.candidates.map((candidate) => candidate.id);
    expect(ids).not.toContain("export:handleRequest@apps/web/src/handler.ts");
    expect(ids).not.toContain("export:createUser@packages/core/src/user.ts");
    expect(ids).not.toContain("export:save@packages/core/src/store.ts");
  });

  it("#given an unused export in an imported file plus an orphan file #when it runs #then the helper is only-exported and the orphan is no-inbound-edges", () => {
    // given: formatUnused is exported from imported handler.ts but never
    // called; util.ts is imported by nobody
    const snapshot = fixtureSnapshot();

    // when
    const result = findUnreferenced(snapshot, options());

    // then: the unused export still surfaces — a file import is not a symbol reference
    const helper = result.candidates.find(
      (candidate) => candidate.id === "export:formatUnused@apps/web/src/handler.ts",
    );
    expect(helper?.kind).toBe("symbol");
    expect(helper?.reason).toBe("only-exported");
    expect(helper?.inboundImports).toBe(0);
    expect(helper?.inboundCalls).toBe(0);

    // then: the genuinely unreferenced file keeps its own reason
    const orphan = result.candidates.find((candidate) => candidate.id === "file:packages/core/src/util.ts");
    expect(orphan?.kind).toBe("file");
    expect(orphan?.reason).toBe("no-inbound-edges");

    // then: only these two rows survive; main.ts stays entry-like, never dead
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      "export:formatUnused@apps/web/src/handler.ts",
      "file:packages/core/src/util.ts",
    ]);
    expect(result.summary.excludedEntryLike).toBe(1);
    expect(result.summary.analyzedFiles).toBe(5);
  });
});
