import { describe, expect, test } from "bun:test";
import {
  buildAgentContext,
  estimateTokens,
  renderAgentContext,
  AGENT_CONTEXT_DEFAULT_MAX_BYTES,
  type GraphContextCorrelation,
} from "./agent-context";
import type { QueryEnvelope, QueryItem } from "./queries.ts";

const CORRELATION: GraphContextCorrelation = {
  projectId: "demo-12345678",
  worktreeId: "wt-agent-context",
  revision: "c".repeat(40),
  generation: "gen-7",
  sessionId: "sess-1",
  runId: "run-1",
};

function item(id: string, verdict: "confirmed" | "inferred" = "confirmed"): QueryItem {
  return {
    id,
    file: "a.ts",
    line: 1,
    name: id,
    evidence: [{ edge: "CALLS_STATIC", ref: "a.ts:1", confidence: 1 }],
    confidence: 1,
    knowledgeIds: [],
    verdict,
  };
}

function envelope(overrides: Partial<QueryEnvelope> = {}): QueryEnvelope {
  return {
    projectId: CORRELATION.projectId,
    worktreeId: CORRELATION.worktreeId,
    revision: CORRELATION.revision as string,
    fingerprint: "f".repeat(64),
    freshness: "fresh",
    coverage: "indexed",
    truncated: false,
    knowledgeIds: [],
    unresolved: [],
    unsupported: [],
    items: [],
    totals: { displayed: 0, known: 0, hidden: 0 },
    completeness: "complete",
    ...overrides,
  };
}

describe("agent-context honesty states", () => {
  test("#given complete empty answer #when built #then NO_RELATIONSHIP", () => {
    const built = buildAgentContext({
      op: "context",
      level: 1,
      envelope: envelope(),
      subjects: [{ kind: "symbol", id: "fn:missing@a.ts" }],
      correlation: CORRELATION,
    });
    expect(built.unanswered).toEqual(["NO_RELATIONSHIP"]);
  });

  test("#given unresolved notes #when built #then UNRESOLVED_RELATIONSHIP", () => {
    const built = buildAgentContext({
      op: "trace",
      level: 1,
      envelope: envelope({ unresolved: ["a.ts:2 calls an unknown callee (manual review, never proven)"] }),
      subjects: [{ kind: "symbol", id: "fn:a@a.ts" }],
      correlation: CORRELATION,
    });
    expect(built.unanswered).toEqual(["UNRESOLVED_RELATIONSHIP"]);
    expect(built.unresolved.length).toBe(1);
  });

  test("#given truncated completeness #when built #then ANALYSIS_INCOMPLETE", () => {
    const built = buildAgentContext({
      op: "impact",
      level: 2,
      envelope: envelope({
        items: [item("fn:a@a.ts")],
        totals: { displayed: 1, known: 5, hidden: 4 },
        completeness: "truncated",
        completenessReason: "result-limit",
        truncated: true,
      }),
      subjects: [{ kind: "symbol", id: "fn:a@a.ts" }],
      correlation: CORRELATION,
    });
    expect(built.unanswered).toEqual(["ANALYSIS_INCOMPLETE"]);
  });

  test("#given stale freshness #when built #then GRAPH_STALE", () => {
    const built = buildAgentContext({
      op: "status",
      level: 0,
      envelope: envelope({ freshness: "stale" }),
      subjects: [{ kind: "file", id: "a.ts" }],
      correlation: CORRELATION,
    });
    expect(built.unanswered).toEqual(["GRAPH_STALE"]);
  });

  test("#given no envelope #when built #then GRAPH_UNAVAILABLE", () => {
    const built = buildAgentContext({
      op: "status",
      level: 0,
      subjects: [{ kind: "file", id: "a.ts" }],
      correlation: CORRELATION,
    });
    expect(built.unanswered).toEqual(["GRAPH_UNAVAILABLE"]);
    expect(built.unavailable?.code).toBe("GRAPH_UNAVAILABLE");
    expect(built.status.queryServable).toBe(false);
  });

  test("#given confirmed evidence items #when built #then VERIFIED_RELATIONSHIP", () => {
    const built = buildAgentContext({
      op: "context",
      level: 2,
      envelope: envelope({
        items: [item("fn:add@a.ts", "confirmed")],
        totals: { displayed: 1, known: 1, hidden: 0 },
      }),
      subjects: [{ kind: "symbol", id: "fn:add@a.ts" }],
      correlation: CORRELATION,
    });
    expect(built.unanswered).toEqual(["VERIFIED_RELATIONSHIP"]);
  });

  test("#given six states #when compared #then unanswered is exactly one flag each", () => {
    const cases = [
      buildAgentContext({ op: "context", level: 1, envelope: envelope(), subjects: [], correlation: CORRELATION }),
      buildAgentContext({ op: "context", level: 1, envelope: envelope({ unresolved: ["note"] }), subjects: [], correlation: CORRELATION }),
      buildAgentContext({ op: "context", level: 1, envelope: envelope({ completeness: "partial", completenessReason: "unresolved-edges" }), subjects: [], correlation: CORRELATION }),
      buildAgentContext({ op: "context", level: 1, envelope: envelope({ freshness: "stale" }), subjects: [], correlation: CORRELATION }),
      buildAgentContext({ op: "context", level: 1, subjects: [], correlation: CORRELATION }),
      buildAgentContext({ op: "context", level: 1, envelope: envelope({ items: [item("x")], totals: { displayed: 1, known: 1, hidden: 0 } }), subjects: [], correlation: CORRELATION }),
    ];
    const flags = cases.map((c) => c.unanswered[0]);
    expect(cases.every((c) => c.unanswered.length === 1)).toBe(true);
    expect(new Set(flags).size).toBe(6);
  });

  test("#given tiny byte budget #when built #then items truncate with bytes flag", () => {
    const items = Array.from({ length: 20 }, (_, n) => item(`fn:use${n}@a.ts`));
    const built = buildAgentContext({
      op: "search",
      level: 3,
      envelope: envelope({
        items,
        totals: { displayed: 20, known: 20, hidden: 0 },
      }),
      subjects: [{ kind: "query", id: "use" }],
      correlation: CORRELATION,
      maxBytes: 400,
    });
    expect(built.items.length).toBeLessThan(20);
    expect(built.budget.truncatedBy).toBe("bytes");
    expect(built.budget.maxBytes).toBe(400);
    const rendered = renderAgentContext(built);
    expect(rendered.omittedItems).toBeGreaterThan(0);
  });

  test("#given same envelope #when rendered twice #then text is deterministic", () => {
    const built = buildAgentContext({
      op: "context",
      level: 2,
      envelope: envelope({
        items: [item("fn:b@b.ts"), item("fn:a@a.ts")],
        totals: { displayed: 2, known: 2, hidden: 0 },
      }),
      subjects: [{ kind: "symbol", id: "fn:a@a.ts" }],
      correlation: CORRELATION,
    });
    const first = renderAgentContext(built);
    const second = renderAgentContext(built);
    expect(second.text).toBe(first.text);
    expect(second.omittedItems).toBe(first.omittedItems);
  });

  test("#given any envelope #when rendered #then block starts with header and prints correlation status flags omitted", () => {
    const built = buildAgentContext({
      op: "tests",
      level: 1,
      envelope: envelope({
        items: [item("fn:a@a.ts")],
        totals: { displayed: 1, known: 1, hidden: 0 },
      }),
      subjects: [{ kind: "symbol", id: "fn:a@a.ts" }],
      correlation: CORRELATION,
    });
    const rendered = renderAgentContext(built);
    expect(rendered.text.startsWith("CODE GRAPH CONTEXT")).toBe(true);
    expect(rendered.text).toContain("gen-7");
    expect(rendered.text).toContain("c".repeat(40));
    expect(rendered.text).toContain("freshness=fresh");
    expect(rendered.text).toContain("VERIFIED_RELATIONSHIP");
    expect(rendered.text).toContain("omittedItems:");
  });

  test("#given text #when tokens estimated #then default budget constant is sane", () => {
    expect(AGENT_CONTEXT_DEFAULT_MAX_BYTES).toBeGreaterThan(0);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});

describe("inferred-only relationships", () => {
  test("labels lower-confidence rows as INFERRED rather than resolved or absent", () => {
    const item = {
      id: "fn:guess@a.ts",
      file: "a.ts",
      line: 3,
      name: "guess",
      evidence: [{ edge: "CALLS_DYNAMIC", ref: "a.ts:3", confidence: 0.4 }],
      confidence: 0.4,
      knowledgeIds: [],
      verdict: "inferred" as const,
    };
    const envelope = buildAgentContext({
      op: "context",
      level: 2,
      envelope: {
        projectId: "p",
        worktreeId: "w",
        revision: "0".repeat(40),
        fingerprint: "f",
        freshness: "fresh",
        coverage: "indexed",
        truncated: false,
        knowledgeIds: [],
        unresolved: [],
        unsupported: [],
        items: [item],
        totals: { displayed: 1, known: 1, hidden: 0 },
        completeness: "complete",
      },
      subjects: [{ kind: "symbol", id: "guess" }],
      correlation: { projectId: "p", worktreeId: "w" },
    });

    expect(envelope.unanswered).toEqual(["INFERRED_RELATIONSHIP"]);
    expect(envelope.unanswered).not.toContain("UNRESOLVED_RELATIONSHIP");
    expect(envelope.unanswered).not.toContain("NO_RELATIONSHIP");
  });
});
