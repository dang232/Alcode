import { describe, expect, test } from "bun:test"
import { EVIDENCE_QUERY_KINDS, type EvidenceEnvelopeInput, type EvidenceItemInput, type KnowledgeRecordInput, type UnderstandingScope } from "./types"
import { buildTaskUnderstanding } from "./understanding"

const scope: UnderstandingScope = { projectId: "proj-a", worktreeId: "wt-1", revision: "r1", fingerprint: "f1" }

function baseEnvelope(): EvidenceEnvelopeInput {
  return {
    projectId: "proj-a",
    worktreeId: "wt-1",
    revision: "r1",
    fingerprint: "f1",
    freshness: "fresh",
    coverage: "indexed",
    truncated: false,
    knowledgeIds: [],
    unresolved: [],
    unsupported: [],
    items: [],
  }
}

function item(id: string, overrides: Partial<EvidenceItemInput> = {}): EvidenceItemInput {
  return { id, file: "math.ts", line: 1, confidence: 1, knowledgeIds: [], ...overrides }
}

function knowledge(id: string, overrides: Partial<KnowledgeRecordInput> = {}): KnowledgeRecordInput {
  return { id, claim: `claim ${id}`, category: "source-verified", sourceFile: "math.ts", sourceRevision: "r1", ...overrides }
}

describe("buildTaskUnderstanding scope exclusion", () => {
  test("given a cross-project envelope, when building, then its items are excluded and answered is false", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: {
        symbolContext: {
          ...baseEnvelope(),
          projectId: "proj-other",
          definition: item("fn:add@math.ts"),
          callers: [],
          callees: [],
        },
        impact: { ...baseEnvelope(), subject: item("fn:add@math.ts"), impacted: [item("fn:use@main.ts", { file: "main.ts" })] },
      },
    })
    expect(result.symbols.map((symbol) => symbol.id)).toEqual(["fn:add@math.ts", "fn:use@main.ts"])
    expect(result.impacted.map((symbol) => symbol.id)).toEqual(["fn:use@main.ts"])
    expect(result.queries.find((observation) => observation.kind === "symbolContext")).toEqual({
      kind: "symbolContext",
      present: true,
      coverage: "indexed",
      truncated: false,
      freshness: "fresh",
      answered: false,
    })
    expect(result.uncertainties.map((uncertainty) => uncertainty.note)).toContain(
      "symbolContext excluded: cross-project evidence (projectId/worktreeId outside scope)",
    )
    expect(result.uncertainties.find((uncertainty) => uncertainty.kind === "cross-project")).toBeDefined()
    expect(result.usableForCaution).toBe(false)
  })

  test("given a worktree mismatch, when building, then a cross-project uncertainty names the query kind", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: { search: { ...baseEnvelope(), worktreeId: "wt-9", items: [item("fn:add@math.ts")] } },
    })
    expect(result.symbols).toEqual([])
    expect(result.advisorySymbols).toEqual([])
    expect(result.uncertainties.map((uncertainty) => uncertainty.note)).toEqual([
      "search excluded: cross-project evidence (projectId/worktreeId outside scope)",
      "symbolContext not queried (no evidence)",
      "impact not queried (no evidence)",
      "findTests not queried (no evidence)",
      "detectChanges not queried (no evidence)",
    ])
    expect(result.usableForCaution).toBe(false)
  })

  test("given a revision mismatch, when building, then a revision-mismatch uncertainty is recorded", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: { search: { ...baseEnvelope(), revision: "r2", items: [item("fn:add@math.ts")] } },
    })
    expect(result.symbols).toEqual([])
    expect(result.advisorySymbols).toEqual([])
    expect(result.uncertainties[0]).toEqual({
      kind: "revision-mismatch",
      note: "search excluded: revision mismatch (revision outside scope)",
    })
    expect(result.usableForCaution).toBe(false)
  })
})

describe("buildTaskUnderstanding freshness", () => {
  test("given a stale envelope, when building, then items land in advisory only and freshness is stale", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: {
        symbolContext: {
          ...baseEnvelope(),
          freshness: "stale",
          definition: item("fn:add@math.ts"),
          callers: [item("fn:use@main.ts", { file: "main.ts" })],
          callees: [],
        },
        impact: { ...baseEnvelope(), subject: item("fn:add@math.ts"), impacted: [] },
      },
    })
    expect(result.symbols.map((symbol) => symbol.id)).toEqual(["fn:add@math.ts"])
    expect(result.advisorySymbols.map((symbol) => symbol.id)).toEqual(["fn:add@math.ts", "fn:use@main.ts"])
    expect(result.impacted).toEqual([])
    expect(result.freshness).toBe("stale")
    expect(result.usableForCaution).toBe(false)
  })

  test("given a stale findTests envelope, when building, then candidates are advisory and tests stay empty", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: {
        findTests: { ...baseEnvelope(), freshness: "stale", candidates: [item("fn:test@math.test.ts", { file: "math.test.ts" })] },
      },
    })
    expect(result.tests).toEqual([])
    expect(result.advisorySymbols.map((symbol) => symbol.id)).toEqual(["fn:test@math.test.ts"])
    expect(result.freshness).toBe("stale")
  })

  test("given a stale detectChanges envelope, when building, then invalidation facts are kept but caution is refused", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: {
        detectChanges: {
          ...baseEnvelope(),
          freshness: "stale",
          changes: [{ id: "fn:add@math.ts", file: "math.ts", line: 2, cause: "SRC-EDIT", confidence: 1 }],
        },
      },
    })
    expect(result.changes.map((change) => change.id)).toEqual(["fn:add@math.ts"])
    expect(result.freshness).toBe("stale")
    expect(result.usableForCaution).toBe(false)
  })
})

describe("buildTaskUnderstanding coverage", () => {
  test("given an unindexed envelope, when building, then answered is false with an unindexed uncertainty", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: { findTests: { ...baseEnvelope(), coverage: "unindexed", unresolved: ["math.ts is not in this snapshot"] } },
    })
    expect(result.queries.find((observation) => observation.kind === "findTests")?.answered).toBe(false)
    expect(result.tests).toEqual([])
    expect(result.uncertainties.map((uncertainty) => uncertainty.note)).toContain("findTests unindexed: subject not analyzed (no answer)")
  })

  test("given partial coverage, when building, then a partial uncertainty names what was cut", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: {
        search: { ...baseEnvelope(), coverage: "partial", truncated: true, unresolved: ["truncated to 2 of 5 matches"], items: [item("fn:add@math.ts")] },
      },
    })
    expect(result.queries.find((observation) => observation.kind === "search")?.answered).toBe(true)
    expect(result.symbols.map((symbol) => symbol.id)).toEqual(["fn:add@math.ts"])
    expect(result.uncertainties.map((uncertainty) => uncertainty.note)).toContain("search partial: truncated to 2 of 5 matches")
  })

  test("given a truncated flag, when building, then a partial uncertainty is recorded even on indexed coverage", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: { trace: { ...baseEnvelope(), truncated: true, items: [item("fn:add@math.ts")] } },
    })
    expect(result.uncertainties.map((uncertainty) => uncertainty.note)).toContain("trace partial: answer cut by limit")
  })
})

describe("buildTaskUnderstanding confidence and merge", () => {
  test("given mixed confidence, when building, then confirmed items are symbols and the rest are advisory", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: {
        search: {
          ...baseEnvelope(),
          items: [item("fn:a@math.ts"), item("fn:b@math.ts", { confidence: 0.4 }), item("fn:c@math.ts", { confidence: 0.9 })],
        },
      },
    })
    expect(result.symbols.map((symbol) => symbol.id)).toEqual(["fn:a@math.ts"])
    expect(result.advisorySymbols.map((symbol) => symbol.id)).toEqual(["fn:b@math.ts", "fn:c@math.ts"])
    expect(result.uncertainties.find((uncertainty) => uncertainty.kind === "low-confidence")).toEqual({
      kind: "low-confidence",
      note: "search has 2 low-confidence items (advisory only)",
      symbolIds: ["fn:b@math.ts", "fn:c@math.ts"],
    })
  })

  test("given one id across queries, when building, then the first sighting wins and evidence unions", () => {
    const result = buildTaskUnderstanding({
      scope,
      knowledge: [knowledge("pk-1"), knowledge("pk-2")],
      queries: {
        search: {
          ...baseEnvelope(),
          items: [{ id: "fn:add@math.ts", file: "math.ts", line: 3, name: "add", confidence: 0.4, knowledgeIds: ["pk-1"] }],
        },
        impact: {
          ...baseEnvelope(),
          subject: { id: "fn:add@math.ts", file: "other.ts", line: 9, name: "renamed", confidence: 1, knowledgeIds: ["pk-2"] },
          impacted: [item("fn:use@main.ts", { file: "main.ts", line: 5 })],
        },
      },
    })
    expect(result.symbols[0]).toEqual({
      id: "fn:add@math.ts",
      file: "math.ts",
      line: 3,
      confidence: 1,
      knowledgeIds: ["pk-1", "pk-2"],
      sources: ["search", "impact"],
      name: "add",
    })
    expect(result.symbols.map((symbol) => symbol.id)).toEqual(["fn:add@math.ts", "fn:use@main.ts"])
    expect(result.advisorySymbols.map((symbol) => symbol.id)).toEqual(["fn:add@math.ts"])
    expect(result.impacted.map((symbol) => symbol.id)).toEqual(["fn:use@main.ts"])
  })
})

describe("buildTaskUnderstanding knowledge", () => {
  test("given superseded records, when building, then they are skipped without uncertainties", () => {
    const result = buildTaskUnderstanding({
      scope,
      knowledge: [knowledge("pk-1", { category: "superseded" }), knowledge("pk-2", { supersededBy: "pk-3" }), knowledge("pk-3")],
    })
    expect(result.constraints.map((constraint) => constraint.id)).toEqual(["pk-3"])
    expect(result.uncertainties).toEqual([
      { kind: "missing-query", note: "symbolContext not queried (no evidence)" },
      { kind: "missing-query", note: "impact not queried (no evidence)" },
      { kind: "missing-query", note: "findTests not queried (no evidence)" },
      { kind: "missing-query", note: "detectChanges not queried (no evidence)" },
    ])
  })

  test("given mixed trust, when building, then only source-verified at the scope revision is authoritative", () => {
    const result = buildTaskUnderstanding({
      scope,
      knowledge: [
        knowledge("pk-a"),
        knowledge("pk-b", { sourceRevision: "r9" }),
        knowledge("pk-c", { category: "previously-verified" }),
      ],
    })
    expect(result.constraints).toEqual([
      {
        id: "pk-a",
        claim: "claim pk-a",
        trust: "source-verified",
        sourceFile: "math.ts",
        sourceRevision: "r1",
        validatedAt: undefined,
        authoritative: true,
      },
      {
        id: "pk-b",
        claim: "claim pk-b",
        trust: "source-verified",
        sourceFile: "math.ts",
        sourceRevision: "r9",
        validatedAt: undefined,
        authoritative: false,
      },
      {
        id: "pk-c",
        claim: "claim pk-c",
        trust: "previously-verified",
        sourceFile: "math.ts",
        sourceRevision: "r1",
        validatedAt: undefined,
        authoritative: false,
      },
    ])
  })

  test("given a foreign-project record, when building, then it is skipped with a cross-project uncertainty", () => {
    const result = buildTaskUnderstanding({ scope, knowledge: [knowledge("pk-x", { projectId: "proj-other" }), knowledge("pk-ok")] })
    expect(result.constraints.map((constraint) => constraint.id)).toEqual(["pk-ok"])
    expect(result.uncertainties.map((uncertainty) => uncertainty.note)).toContain("knowledge pk-x excluded: project scope mismatch")
  })

  test("given referenced but absent knowledge, when building, then one unresolved uncertainty names each id", () => {
    const result = buildTaskUnderstanding({
      scope,
      knowledge: [knowledge("pk-1")],
      queries: {
        search: {
          ...baseEnvelope(),
          knowledgeIds: ["pk-ghost-envelope"],
          items: [item("fn:add@math.ts", { knowledgeIds: ["pk-1", "pk-ghost-item"] })],
        },
      },
    })
    const unresolved = result.uncertainties.filter((uncertainty) => uncertainty.kind === "unresolved")
    expect(unresolved).toEqual([
      {
        kind: "unresolved",
        note: "knowledge pk-ghost-envelope referenced by evidence but absent from input",
        symbolIds: [],
      },
      {
        kind: "unresolved",
        note: "knowledge pk-ghost-item referenced by evidence but absent from input",
        symbolIds: ["fn:add@math.ts"],
      },
    ])
  })
})

describe("buildTaskUnderstanding observations", () => {
  test("given no queries, when building, then every kind reads present false with four missing-query uncertainties", () => {
    const result = buildTaskUnderstanding({ scope })
    expect(result.queries.map((observation) => observation.kind)).toEqual([...EVIDENCE_QUERY_KINDS])
    expect(result.queries.every((observation) => observation.present === false && observation.answered === false)).toBe(true)
    expect(result.uncertainties).toEqual([
      { kind: "missing-query", note: "symbolContext not queried (no evidence)" },
      { kind: "missing-query", note: "impact not queried (no evidence)" },
      { kind: "missing-query", note: "findTests not queried (no evidence)" },
      { kind: "missing-query", note: "detectChanges not queried (no evidence)" },
    ])
    expect(result.freshness).toBe("unknown")
    expect(result.usableForCaution).toBe(false)
  })
})

describe("buildTaskUnderstanding limits", () => {
  test("given over-limit evidence, when building, then every collection is cut in deterministic order", () => {
    const result = buildTaskUnderstanding({
      scope,
      limits: { symbols: 1, impacted: 1, tests: 1, constraints: 1, uncertainties: 1 },
      knowledge: [knowledge("pk-1"), knowledge("pk-2")],
      queries: {
        search: {
          ...baseEnvelope(),
          items: [item("fn:a@s.ts", { file: "s.ts" }), item("fn:b@s.ts", { file: "s.ts" }), item("fn:c@s.ts", { file: "s.ts", confidence: 0.2 }), item("fn:d@s.ts", { file: "s.ts", confidence: 0.3 })],
        },
        impact: {
          ...baseEnvelope(),
          subject: item("fn:a@s.ts", { file: "s.ts" }),
          impacted: [item("fn:x@i.ts", { file: "i.ts" }), item("fn:y@i.ts", { file: "i.ts" })],
        },
        findTests: {
          ...baseEnvelope(),
          candidates: [item("fn:t1@t.ts", { file: "t.ts" }), item("fn:t2@t.ts", { file: "t.ts" })],
        },
      },
    })
    expect(result.symbols.map((symbol) => symbol.id)).toEqual(["fn:a@s.ts"])
    expect(result.advisorySymbols.map((symbol) => symbol.id)).toEqual(["fn:c@s.ts"])
    expect(result.impacted.map((symbol) => symbol.id)).toEqual(["fn:x@i.ts"])
    expect(result.tests.map((symbol) => symbol.id)).toEqual(["fn:t1@t.ts"])
    expect(result.constraints.map((constraint) => constraint.id)).toEqual(["pk-1"])
    expect(result.uncertainties.map((uncertainty) => uncertainty.kind)).toEqual(["low-confidence"])
    expect(result.truncated).toBe(true)
    expect(result.truncationReasons).toEqual([
      "symbols truncated to 1 of 4",
      "advisorySymbols truncated to 1 of 2",
      "impacted truncated to 1 of 2",
      "tests truncated to 1 of 2",
      "constraints truncated to 1 of 2",
      "uncertainties truncated to 1 of 3",
    ])
  })
})

describe("buildTaskUnderstanding usableForCaution", () => {
  test("given matched fresh answered symbolContext and impact, when building, then caution is usable", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: {
        search: { ...baseEnvelope(), items: [item("fn:add@math.ts")] },
        symbolContext: { ...baseEnvelope(), definition: item("fn:add@math.ts"), callers: [], callees: [] },
        impact: { ...baseEnvelope(), subject: item("fn:add@math.ts"), impacted: [] },
        findTests: { ...baseEnvelope(), candidates: [] },
        detectChanges: { ...baseEnvelope(), changes: [] },
        trace: { ...baseEnvelope(), items: [] },
      },
    })
    expect(result.freshness).toBe("fresh")
    expect(result.usableForCaution).toBe(true)
    expect(result.truncated).toBe(false)
    expect(result.truncationReasons).toEqual([])
  })

  test("given an excluded envelope, when building, then caution is refused", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: {
        symbolContext: { ...baseEnvelope(), definition: item("fn:add@math.ts"), callers: [], callees: [] },
        impact: { ...baseEnvelope(), subject: item("fn:add@math.ts"), impacted: [] },
        trace: { ...baseEnvelope(), projectId: "proj-other", items: [item("fn:add@math.ts")] },
      },
    })
    expect(result.usableForCaution).toBe(false)
  })

  test("given stale evidence, when building, then caution is refused", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: {
        symbolContext: { ...baseEnvelope(), freshness: "stale", definition: item("fn:add@math.ts"), callers: [], callees: [] },
        impact: { ...baseEnvelope(), subject: item("fn:add@math.ts"), impacted: [] },
      },
    })
    expect(result.usableForCaution).toBe(false)
  })

  test("given missing symbolContext, when building, then caution is refused", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: { impact: { ...baseEnvelope(), subject: item("fn:add@math.ts"), impacted: [] } },
    })
    expect(result.usableForCaution).toBe(false)
  })

  test("given missing impact, when building, then caution is refused", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: {
        symbolContext: { ...baseEnvelope(), definition: item("fn:add@math.ts"), callers: [], callees: [] },
      },
    })
    expect(result.usableForCaution).toBe(false)
  })

  test("given an unanswered impact observation, when building, then caution is refused", () => {
    const result = buildTaskUnderstanding({
      scope,
      queries: {
        symbolContext: { ...baseEnvelope(), definition: item("fn:add@math.ts"), callers: [], callees: [] },
        impact: { ...baseEnvelope(), coverage: "unindexed" },
      },
    })
    expect(result.queries.find((observation) => observation.kind === "impact")?.answered).toBe(false)
    expect(result.usableForCaution).toBe(false)
  })
})
