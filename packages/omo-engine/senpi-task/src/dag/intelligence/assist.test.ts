import { describe, expect, test } from "bun:test"
import type { DagNodeId } from "../types"
import type { DagVerifyCheck } from "../verification"

const dagNodeId = (value: string): DagNodeId => {
  // SAFETY: DagNodeId is a branded string with no runtime representation; fixtures use literals.
  return value as DagNodeId
}
import type { EvidenceQueryKind, QueryObservation, TaskUnderstanding, UnderstandingChange, UnderstandingSymbol, UnderstandingScope } from "./types"
import { toGraphAssist } from "./assist"

const scope: UnderstandingScope = { projectId: "proj-a", worktreeId: "wt-1", revision: "r1", fingerprint: "f1" }

function obs(kind: EvidenceQueryKind, overrides: Partial<QueryObservation> = {}): QueryObservation {
  return { kind, present: true, coverage: "indexed", truncated: false, freshness: "fresh", answered: true, ...overrides }
}

function base(): TaskUnderstanding {
  return {
    scope,
    freshness: "fresh",
    symbols: [],
    advisorySymbols: [],
    impacted: [],
    tests: [],
    changes: [],
    constraints: [],
    uncertainties: [],
    queries: [obs("symbolContext"), obs("impact"), obs("detectChanges")],
    usableForCaution: true,
    truncated: false,
    truncationReasons: [],
  }
}

function sym(id: string, overrides: Partial<UnderstandingSymbol> = {}): UnderstandingSymbol {
  return { id, file: "a.ts", line: 1, confidence: 1, knowledgeIds: [], sources: ["impact"], ...overrides }
}

function change(id: string, confidence = 1): UnderstandingChange {
  return { id, file: "a.ts", line: 1, cause: "SRC-EDIT", confidence }
}

function check(checkId: string): DagVerifyCheck {
  return { checkId, category: "unit", command: ["bun", "test"], timeoutMs: 1000, criteria: ["passes"] }
}

describe("toGraphAssist missing evidence", () => {
  test("given usableForCaution false, when projecting, then neighborhood is undefined and inputs pass through", () => {
    const nodeSymbols = new Map<DagNodeId, readonly string[]>([[dagNodeId("n1"), ["fn:add@math.ts"]]])
    const candidateChecks = [check("c1")]
    const result = toGraphAssist({ understanding: { ...base(), usableForCaution: false }, nodeSymbols, candidateChecks })
    expect(result.neighborhood).toBeUndefined()
    expect(result.nodeSymbols).toBe(nodeSymbols)
    expect(result.candidateChecks).toBe(candidateChecks)
  })

  test("given absent detectChanges, when projecting, then neighborhood is undefined and nothing is cleared", () => {
    const candidateChecks = [check("c1")]
    const result = toGraphAssist({
      understanding: { ...base(), queries: [obs("symbolContext"), obs("impact")] },
      candidateChecks,
    })
    expect(result.neighborhood).toBeUndefined()
    expect(result.nodeSymbols).toBeUndefined()
    expect(result.candidateChecks).toBe(candidateChecks)
  })

  test("given unanswered detectChanges, when projecting, then neighborhood is undefined and inputs pass through", () => {
    const nodeSymbols = new Map<DagNodeId, readonly string[]>([[dagNodeId("n1"), ["fn:add@math.ts"]]])
    const result = toGraphAssist({
      understanding: {
        ...base(),
        queries: [obs("symbolContext"), obs("impact"), obs("detectChanges", { coverage: "unindexed", answered: false })],
      },
      nodeSymbols,
    })
    expect(result.neighborhood).toBeUndefined()
    expect(result.nodeSymbols).toBe(nodeSymbols)
  })
})

describe("toGraphAssist neighborhood", () => {
  test("given changes, when projecting, then only confident changes become changed symbols", () => {
    const result = toGraphAssist({
      understanding: {
        ...base(),
        symbols: [sym("fn:a@m.ts")],
        impacted: [],
        changes: [change("fn:a@m.ts"), change("fn:b@m.ts", 0.3), change("fn:a@m.ts")],
      },
    })
    expect(result.neighborhood?.changedSymbols).toEqual(["fn:a@m.ts"])
    expect(result.neighborhood?.impactedBy.get("fn:a@m.ts")).toEqual([])
    expect(result.neighborhood?.unresolvedSymbols).toEqual([])
  })

  test("given a subject match, when projecting, then impacted items carry copied confidence and resolved flags", () => {
    const result = toGraphAssist({
      understanding: {
        ...base(),
        symbols: [sym("fn:a@m.ts")],
        impacted: [sym("fn:x@m.ts"), sym("fn:y@b.ts", { file: "b.ts", confidence: 0.7 })],
        changes: [change("fn:a@m.ts")],
      },
    })
    expect(result.neighborhood?.impactedBy.get("fn:a@m.ts")).toEqual([
      { symbol: "fn:x@m.ts", confidence: 1, resolved: true },
      { symbol: "fn:y@b.ts", confidence: 0.7, resolved: false },
    ])
  })

  test("given a non-subject change with indexed impact, when projecting, then the entry is known empty", () => {
    const result = toGraphAssist({
      understanding: {
        ...base(),
        symbols: [sym("fn:a@m.ts")],
        impacted: [sym("fn:x@m.ts")],
        changes: [change("fn:a@m.ts"), change("fn:other@b.ts", 1)],
      },
    })
    expect(result.neighborhood?.changedSymbols).toEqual(["fn:a@m.ts", "fn:other@b.ts"])
    expect(result.neighborhood?.impactedBy.get("fn:a@m.ts")).toEqual([{ symbol: "fn:x@m.ts", confidence: 1, resolved: true }])
    expect(result.neighborhood?.impactedBy.get("fn:other@b.ts")).toEqual([])
  })

  test("given a non-subject change with partial impact, when projecting, then the entry is omitted as unknown", () => {
    const result = toGraphAssist({
      understanding: {
        ...base(),
        symbols: [sym("fn:a@m.ts")],
        impacted: [sym("fn:x@m.ts")],
        changes: [change("fn:a@m.ts"), change("fn:other@b.ts", 1)],
        queries: [obs("symbolContext"), obs("impact", { coverage: "partial", truncated: true }), obs("detectChanges")],
      },
    })
    expect(result.neighborhood?.impactedBy.get("fn:a@m.ts")).toEqual([{ symbol: "fn:x@m.ts", confidence: 1, resolved: true }])
    expect(result.neighborhood?.impactedBy.has("fn:other@b.ts")).toBe(false)
  })

  test("given an unanswered impact observation, when projecting, then the non-subject entry is omitted as unknown", () => {
    const result = toGraphAssist({
      understanding: {
        ...base(),
        symbols: [],
        impacted: [sym("fn:x@m.ts")],
        changes: [change("fn:other@b.ts", 1)],
        queries: [obs("symbolContext"), obs("impact", { coverage: "unindexed", answered: false }), obs("detectChanges")],
      },
    })
    expect(result.neighborhood?.changedSymbols).toEqual(["fn:other@b.ts"])
    expect(result.neighborhood?.impactedBy.has("fn:other@b.ts")).toBe(false)
  })

  test("given unresolved and low-confidence uncertainties, when projecting, then their symbol ids union", () => {
    const result = toGraphAssist({
      understanding: {
        ...base(),
        changes: [change("fn:a@m.ts")],
        uncertainties: [
          { kind: "unresolved", note: "knowledge pk-1 referenced by evidence but absent from input", symbolIds: ["fn:u@m.ts"] },
          { kind: "low-confidence", note: "search has 2 low-confidence items (advisory only)", symbolIds: ["fn:l@m.ts", "fn:u@m.ts"] },
          { kind: "partial", note: "search partial: answer cut by limit", symbolIds: ["fn:p@m.ts"] },
        ],
      },
    })
    expect(result.neighborhood?.unresolvedSymbols).toEqual(["fn:u@m.ts", "fn:l@m.ts"])
  })

  test("given no confident changes, when projecting, then the neighborhood is defined but empty", () => {
    const result = toGraphAssist({ understanding: { ...base(), changes: [change("fn:a@m.ts", 0.2)] } })
    expect(result.neighborhood?.changedSymbols).toEqual([])
    expect(result.neighborhood?.impactedBy.size).toBe(0)
  })

  test("given a full neighborhood, when projecting, then node symbols and checks pass through by reference", () => {
    const nodeSymbols = new Map<DagNodeId, readonly string[]>([[dagNodeId("n1"), ["fn:a@m.ts"]]])
    const candidateChecks = [check("c1"), check("c2")]
    const result = toGraphAssist({
      understanding: { ...base(), symbols: [sym("fn:a@m.ts")], changes: [change("fn:a@m.ts")] },
      nodeSymbols,
      candidateChecks,
    })
    expect(result.neighborhood).toBeDefined()
    expect(result.nodeSymbols).toBe(nodeSymbols)
    expect(result.candidateChecks).toBe(candidateChecks)
  })
})
