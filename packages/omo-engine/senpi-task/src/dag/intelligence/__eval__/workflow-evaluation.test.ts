import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { indexFiles } from "../../../../../code-graph/src/graph"
import { computeScopeFingerprint } from "../../../../../code-graph/src/schema"
import {
  detectChanges,
  findTests,
  impact,
  search,
  symbolContext,
  type FindTestsResult,
  type ImpactResult,
  type QueryEnvelope,
  type QueryItem,
  type QueryOptions,
  type SymbolContextResult,
} from "../../../../../code-graph/src/queries"
import { recommendGraphAssist } from "../../graph-assist"
import type { DagNodeId } from "../../types"
import {
  buildVerificationRecord,
  runVerificationCommand,
  selectVerificationChecks,
  withRecordClassification,
  type DagChangeScope,
  type DagVerifyCheck,
} from "../../verification"
import { classifyCommandResult, decideRepair, emptyRepairState, failureSignature, recordRepairAttempt } from "../../repair"
import { toGraphAssist } from "../assist"
import { buildNodeContext } from "../node-context"
import { derivePlanHints, renderPlanEvidence } from "../plan-evidence"
import { selectImpactAwareChecks } from "../verification-plan"
import { buildTaskUnderstanding } from "../understanding"
import type {
  DetectChangesEnvelopeInput,
  EvidenceEnvelopeInput,
  EvidenceItemInput,
  FindTestsEnvelopeInput,
  ImpactEnvelopeInput,
  KnowledgeRecordInput,
  SymbolContextEnvelopeInput,
  UnderstandingScope,
} from "../types"

setDefaultTimeout(60000)

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "code-graph", "src", "__fixtures__", "graph-basic")
const PROJECT_ID = "demo-12345678"
const WORKTREE_ID = "wt-workflow-eval"
const REVISION = "a".repeat(40)

const scope: UnderstandingScope = {
  projectId: PROJECT_ID,
  worktreeId: WORKTREE_ID,
  revision: REVISION,
  fingerprint: computeScopeFingerprint(PROJECT_ID, WORKTREE_ID, REVISION),
}

function queryOptions(): QueryOptions {
  return {
    scope: {
      projectId: PROJECT_ID,
      worktreeId: WORKTREE_ID,
      revision: REVISION,
      fingerprint: computeScopeFingerprint(PROJECT_ID, WORKTREE_ID, REVISION),
    },
  }
}

function toItem(item: QueryItem): EvidenceItemInput {
  const base = {
    id: item.id,
    file: item.file,
    line: item.line,
    confidence: item.confidence,
    knowledgeIds: [...item.knowledgeIds],
  }
  return item.name === undefined ? base : { ...base, name: item.name }
}

function baseEnvelope(env: QueryEnvelope): EvidenceEnvelopeInput {
  return {
    projectId: env.projectId,
    worktreeId: env.worktreeId,
    revision: env.revision,
    fingerprint: env.fingerprint,
    freshness: env.freshness,
    coverage: env.coverage,
    truncated: env.truncated,
    knowledgeIds: [...env.knowledgeIds],
    unresolved: [...env.unresolved],
    unsupported: [...env.unsupported],
    items: env.items.map(toItem),
  }
}

const dagNodeId = (value: string): DagNodeId => {
  // SAFETY: DagNodeId is a branded string with no runtime representation; fixtures use literals.
  return value as DagNodeId
}

function symbolContextEnvelope(result: SymbolContextResult): SymbolContextEnvelopeInput {
  return {
    ...baseEnvelope(result),
    definition: result.definition === undefined ? undefined : toItem(result.definition),
    callers: result.callers.map(toItem),
    callees: result.callees.map(toItem),
  }
}

function impactEnvelope(result: ImpactResult): ImpactEnvelopeInput {
  return {
    ...baseEnvelope(result),
    subject: result.subject === undefined ? undefined : toItem(result.subject),
    impacted: result.impacted.map(toItem),
  }
}

function findTestsEnvelope(result: FindTestsResult): FindTestsEnvelopeInput {
  return {
    ...baseEnvelope(result),
    subjectFile: result.subjectFile,
    candidates: result.candidates.map(toItem),
  }
}

function detectChangesEnvelope(result: ReturnType<typeof detectChanges>): DetectChangesEnvelopeInput {
  return {
    ...baseEnvelope(result),
    changes: result.changes.map((change) => ({
      id: change.id,
      file: change.file,
      line: change.line,
      cause: change.cause,
      confidence: change.confidence,
    })),
  }
}

function knowledge(id: string, overrides: Partial<KnowledgeRecordInput> = {}): KnowledgeRecordInput {
  return {
    id,
    claim: "add() in math.ts is associative and safe to reorder across call sites",
    category: "source-verified",
    sourceFile: "math.ts",
    sourceRevision: REVISION,
    ...overrides,
  }
}

const metrics: Record<string, string | number | boolean> = {}
const tempDirs: string[] = []

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "workflow-eval-"))
  tempDirs.push(dir)
  cpSync(FIXTURE_DIR, dir, { recursive: true })
  return dir
}

function fixtureEntries(dir: string): string[] {
  return [join(dir, "main.ts"), join(dir, "reexport.ts"), join(dir, "main.test.ts")]
}

let pristineDir = ""
let pristineSnapshot: ReturnType<typeof indexFiles> | undefined

beforeAll(() => {
  pristineDir = copyFixture()
  pristineSnapshot = indexFiles(fixtureEntries(pristineDir))
})

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function pristine(): ReturnType<typeof indexFiles> {
  if (pristineSnapshot === undefined) throw new Error("pristine snapshot missing")
  return pristineSnapshot
}

describe("scenario 1: caller bug", () => {
  test("given a bug in add(), when informed, then the caller fn:run@main.ts is evidenced and the node context names main.ts without reexport.ts", () => {
    const snapshot = pristine()
    const options = queryOptions()
    const informed = buildTaskUnderstanding({
      scope,
      queries: {
        symbolContext: symbolContextEnvelope(symbolContext(snapshot, "fn:add@math.ts", options)),
        impact: impactEnvelope(impact(snapshot, "fn:add@math.ts", options)),
        findTests: findTestsEnvelope(findTests(snapshot, "fn:add@math.ts", options)),
      },
    })
    expect(informed.symbols.map((symbol) => symbol.id)).toContain("fn:add@math.ts")
    expect(informed.impacted.map((symbol) => symbol.id)).toContain("fn:run@main.ts")
    const caller = informed.impacted.find((symbol) => symbol.id === "fn:run@main.ts")
    expect(caller?.file).toBe("main.ts")

    const baseline = buildTaskUnderstanding({ scope, queries: {} })
    expect(baseline.symbols).toEqual([])
    expect(baseline.impacted).toEqual([])

    const node = { nodeId: "node-fix-add", prompt: "Fix the off-by-one in add() in math.ts called from main.ts" }
    const informedContext = buildNodeContext({ understanding: informed, node })
    expect(informedContext).toBeDefined()
    expect(informedContext?.text).toContain("main.ts")
    expect(informedContext?.text).not.toContain("reexport.ts")
    expect(buildNodeContext({ understanding: baseline, node })).toBeUndefined()

    metrics.relevantFilesFound = new Set([...informed.symbols, ...informed.impacted].map((symbol) => symbol.file)).size
    expect(metrics.relevantFilesFound).toBe(3)
  })
})

describe("scenario 2: test selection", () => {
  test("given a math.ts change, when selecting checks, then the informed plan requires regression-main behind the base checks while the baseline omits it", () => {
    const snapshot = pristine()
    const options = queryOptions()
    const informed = buildTaskUnderstanding({
      scope,
      queries: {
        symbolContext: symbolContextEnvelope(symbolContext(snapshot, "fn:add@math.ts", options)),
        impact: impactEnvelope(impact(snapshot, "fn:add@math.ts", options)),
        findTests: findTestsEnvelope(findTests(snapshot, "fn:add@math.ts", options)),
        detectChanges: detectChangesEnvelope(detectChanges(snapshot, snapshot, options)),
      },
    })
    expect(informed.usableForCaution).toBe(true)

    const changeScope: DagChangeScope = {
      changedFiles: ["math.ts"],
      touchesScheduler: false,
      touchesCompletionGate: false,
      touchesWorkerLifecycle: false,
      touchesPersistedState: false,
      isDocsOnly: false,
    }
    const available: readonly DagVerifyCheck[] = [
      { checkId: "unit-core", category: "unit", command: ["bun", "test", "math.test.ts"], timeoutMs: 5000, criteria: ["unit passes"] },
      { checkId: "regression-main", category: "regression", command: ["bun", "test", "main.test.ts"], timeoutMs: 5000, criteria: ["regression passes"] },
      { checkId: "typecheck-core", category: "typecheck", command: ["bunx", "tsc", "--noEmit"], timeoutMs: 5000, criteria: ["types hold"] },
    ]
    const baselineSelection = selectVerificationChecks(changeScope, available)
    expect(baselineSelection.required.map((check) => check.checkId)).toEqual(["unit-core", "typecheck-core"])
    expect(baselineSelection.omitted.map((entry) => entry.check.checkId)).toContain("regression-main")

    const informedSelection = selectImpactAwareChecks({ scope: changeScope, available, understanding: informed })
    expect(informedSelection.required.map((check) => check.checkId)).toEqual(["unit-core", "typecheck-core", "regression-main"])

    metrics.affectedTestsSelected = informedSelection.required.length
    expect(metrics.affectedTestsSelected).toBe(3)
  })
})

describe("scenario 3: documented rationale", () => {
  test("given a source-verified record, when used, then it is authoritative in node context and plan evidence, while the hypothesis twin is not and leaves write scopes unchanged", () => {
    const snapshot = pristine()
    const options = queryOptions()
    const queries = {
      symbolContext: symbolContextEnvelope(symbolContext(snapshot, "fn:add@math.ts", options)),
      impact: impactEnvelope(impact(snapshot, "fn:add@math.ts", options)),
      findTests: findTestsEnvelope(findTests(snapshot, "fn:add@math.ts", options)),
      detectChanges: detectChangesEnvelope(detectChanges(snapshot, snapshot, options)),
    }
    const verified = buildTaskUnderstanding({ scope, queries, knowledge: [knowledge("k-math-1")] })
    const verifiedConstraint = verified.constraints.find((constraint) => constraint.id === "k-math-1")
    expect(verifiedConstraint?.authoritative).toBe(true)

    const node = { nodeId: "node-fix-add", prompt: "Fix the off-by-one in add() in math.ts called from main.ts" }
    const nodeContext = buildNodeContext({ understanding: verified, node })
    expect(nodeContext?.constraints.some((constraint) => constraint.id === "k-math-1" && constraint.authoritative)).toBe(true)
    const planText = renderPlanEvidence(verified)
    expect(planText).toContain("authoritative constraints:")
    expect(planText).toContain("add() in math.ts is associative")

    const hypothesis = buildTaskUnderstanding({ scope, queries, knowledge: [knowledge("k-math-1", { category: "unverified-hypothesis" })] })
    const hypothesisConstraint = hypothesis.constraints.find((constraint) => constraint.id === "k-math-1")
    expect(hypothesisConstraint?.authoritative).toBe(false)
    expect(renderPlanEvidence(hypothesis)).not.toContain("add() in math.ts is associative")

    const plain = buildTaskUnderstanding({ scope, queries })
    const serialize = (hints: ReturnType<typeof derivePlanHints>): string =>
      JSON.stringify([...hints.writeScopes.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))
    expect(serialize(derivePlanHints(hypothesis, [node]))).toBe(serialize(derivePlanHints(plain, [node])))
  })
})

describe("scenario 4: two independent changes", () => {
  test("given disjoint edits, when deriving hints, then write scopes stay disjoint and graph assist adds no serialization", () => {
    const snapshot = pristine()
    const options = queryOptions()
    const understanding = buildTaskUnderstanding({
      scope,
      queries: {
        search: baseEnvelope(search(snapshot, "reexport.ts", options)),
        symbolContext: symbolContextEnvelope(symbolContext(snapshot, "fn:add@math.ts", options)),
        impact: impactEnvelope(impact(snapshot, "fn:add@math.ts", options)),
        findTests: findTestsEnvelope(findTests(snapshot, "fn:add@math.ts", options)),
        detectChanges: detectChangesEnvelope(detectChanges(snapshot, snapshot, options)),
      },
    })
    expect(understanding.usableForCaution).toBe(true)

    const nodes = [
      { nodeId: "node-a", prompt: "Fix add() in math.ts" },
      { nodeId: "node-b", prompt: "Refresh the re-export in reexport.ts" },
    ]
    const hints = derivePlanHints(understanding, nodes)
    expect(hints.writeScopes.get("node-a")).toEqual(["math.ts"])
    expect(hints.writeScopes.get("node-b")).toEqual(["reexport.ts"])
    const overlap = (hints.writeScopes.get("node-a") ?? []).filter((file) => (hints.writeScopes.get("node-b") ?? []).includes(file))
    expect(overlap).toEqual([])
    expect(hints.risks).toEqual([])

    const nodeSymbols = new Map<DagNodeId, readonly string[]>([
      [dagNodeId("node-a"), ["fn:add@math.ts"]],
      [dagNodeId("node-b"), ["file:reexport.ts"]],
    ])
    const assist = toGraphAssist({ understanding, nodeSymbols })
    expect(assist.neighborhood).toBeDefined()
    const recommendation = recommendGraphAssist({
      neighborhood: assist.neighborhood,
      admittable: [dagNodeId("node-a"), dagNodeId("node-b")],
      nodeSymbols,
      availableChecks: [],
    })
    expect(recommendation.extraSerialized).toEqual([])
    expect(recommendation.extraChecks).toEqual([])

    metrics.independentPairsParallel = recommendation.extraSerialized.length === 0
    expect(metrics.independentPairsParallel).toBe(true)
  })
})

describe("scenario 5: shared scope", () => {
  test("given two nodes on math.ts, when deriving hints, then scopes intersect and the hints name the shared-file risk", () => {
    const snapshot = pristine()
    const options = queryOptions()
    const understanding = buildTaskUnderstanding({
      scope,
      queries: {
        symbolContext: symbolContextEnvelope(symbolContext(snapshot, "fn:add@math.ts", options)),
        impact: impactEnvelope(impact(snapshot, "fn:add@math.ts", options)),
        findTests: findTestsEnvelope(findTests(snapshot, "fn:add@math.ts", options)),
        detectChanges: detectChangesEnvelope(detectChanges(snapshot, snapshot, options)),
      },
    })
    const hints = derivePlanHints(understanding, [
      { nodeId: "node-math-a", prompt: "Fix add() in math.ts, part A" },
      { nodeId: "node-math-b", prompt: "Fix add() in math.ts, part B" },
    ])
    expect(hints.writeScopes.get("node-math-a")).toEqual(["math.ts"])
    expect(hints.writeScopes.get("node-math-b")).toEqual(["math.ts"])
    expect(hints.risks).toEqual(['shared file "math.ts" across nodes: node-math-a, node-math-b'])

    metrics.sharedScopeConflicts = hints.risks.filter((risk) => risk.includes("shared file")).length
    expect(metrics.sharedScopeConflicts).toBe(1)
  })
})

describe("scenario 6: stale source edit", () => {
  test("given a rewritten math.ts, when the envelope is stale, then caution is refused and graph assist stays undefined", () => {
    const dir = copyFixture()
    const before = indexFiles(fixtureEntries(dir))
    const mathPath = join(dir, "math.ts")
    writeFileSync(mathPath, readFileSync(mathPath, "utf8").replace("function add(", "function total("))
    const after = indexFiles(fixtureEntries(dir))
    const options = queryOptions()

    const stale = detectChanges(before, after, options)
    expect(stale.changes.length).toBeGreaterThan(0)
    expect(stale.changes.some((change) => change.file === "math.ts")).toBe(true)
    expect(stale.freshness).toBe("stale")

    const understanding = buildTaskUnderstanding({
      scope,
      queries: {
        symbolContext: symbolContextEnvelope(symbolContext(before, "fn:add@math.ts", options)),
        impact: impactEnvelope(impact(before, "fn:add@math.ts", options)),
        findTests: findTestsEnvelope(findTests(before, "fn:add@math.ts", options)),
        detectChanges: detectChangesEnvelope(stale),
      },
    })
    expect(understanding.usableForCaution).toBe(false)
    expect(toGraphAssist({ understanding }).neighborhood).toBeUndefined()

    metrics.staleFallback = toGraphAssist({ understanding }).neighborhood === undefined
    expect(metrics.staleFallback).toBe(true)
  })
})

describe("scenario 7: incomplete evidence", () => {
  test("given an unsupported file, when queried, then the envelope is unindexed, no symbols are invented, and a missing impact query denies clearance", () => {
    const snapshot = pristine()
    const dir = mkdtempSync(join(tmpdir(), "workflow-eval-notes-"))
    tempDirs.push(dir)
    writeFileSync(join(dir, "notes.png"), "not a real png")
    const options = queryOptions()

    const unsupportedTests = findTests(snapshot, "notes.png", options)
    expect(unsupportedTests.coverage).toBe("unindexed")
    expect(unsupportedTests.items).toEqual([])
    expect(unsupportedTests.unsupported.length).toBeGreaterThan(0)

    const unsupportedContext = symbolContext(snapshot, "fn:icon@notes.png", options)
    expect(unsupportedContext.coverage).toBe("unindexed")
    expect(unsupportedContext.items).toEqual([])

    const understanding = buildTaskUnderstanding({
      scope,
      queries: {
        symbolContext: symbolContextEnvelope(unsupportedContext),
        findTests: findTestsEnvelope(unsupportedTests),
        detectChanges: detectChangesEnvelope(detectChanges(snapshot, snapshot, options)),
      },
    })
    expect(understanding.symbols).toEqual([])
    expect(understanding.impacted).toEqual([])
    expect(understanding.uncertainties.some((uncertainty) => uncertainty.kind === "unindexed")).toBe(true)
    expect(toGraphAssist({ understanding }).neighborhood).toBeUndefined()

    metrics.inventedSymbols = understanding.symbols.length
    expect(metrics.inventedSymbols).toBe(0)
  })
})

describe("scenario 8: failing verification and bounded repair", () => {
  test("given a non-zero exit, when recorded and repaired, then the record is honestly failed and repair stays bounded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "workflow-eval-verify-"))
    tempDirs.push(dir)
    const check: DagVerifyCheck = {
      checkId: "failing-check",
      category: "unit",
      command: [process.execPath, "-e", "process.exit(1)"],
      timeoutMs: 5000,
      criteria: ["exits zero"],
    }
    const result = await runVerificationCommand({ check, projectDir: dir, attempt: 0 })
    expect(result.started).toBe(true)
    expect(result.exitCode).toBe(1)

    const record = buildVerificationRecord({
      runId: "workflow-eval-run",
      parentSessionId: "ses-parent",
      rootSessionId: "ses-root",
      check,
      cwd: dir,
      projectDir: dir,
      sourceRevision: REVISION,
      generation: 0,
      repairAttempt: 0,
      result,
    })
    expect(record.status).toBe("failed")

    const classification = classifyCommandResult(result)
    expect(classification).toBe("product_defect")
    const classified = withRecordClassification(record, classification)
    const signature = failureSignature(classified.classification ?? "unknown", {
      exitCode: classified.exitCode,
      signal: classified.signal,
      timedOut: classified.timedOut,
      output: classified.outputSummary,
    })
    const request = { record: classified, signature, changedFiles: [] }
    const first = decideRepair(emptyRepairState(), request)
    expect(first.kind === "recheck" || first.kind === "renode").toBe(true)

    let state = emptyRepairState()
    let decision = decideRepair(state, request)
    let steps = 0
    while (decision.kind === "recheck" || decision.kind === "renode") {
      state = recordRepairAttempt(state, request)
      decision = decideRepair(state, request)
      steps += 1
      expect(steps).toBeLessThanOrEqual(5)
    }
    expect(decision.kind === "blocked" || decision.kind === "exhausted").toBe(true)

    metrics.repairDecision = first.kind
    expect(metrics.repairDecision).toBe("renode")
  })
})

describe("workflow-evaluation metrics", () => {
  test("given all scenarios, when summarizing, then the compact baseline-vs-informed metrics object matches exactly", () => {
    console.log(`workflow-evaluation metrics: ${JSON.stringify(metrics)}`)
    expect(metrics).toEqual({
      relevantFilesFound: 3,
      affectedTestsSelected: 3,
      sharedScopeConflicts: 1,
      independentPairsParallel: true,
      staleFallback: true,
      inventedSymbols: 0,
      repairDecision: "renode",
    })
  })
})
