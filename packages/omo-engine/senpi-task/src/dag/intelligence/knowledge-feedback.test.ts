import { describe, expect, test } from "bun:test"
import type {
  DagAcceptanceVerdict,
  DagVerificationCurrent,
  DagVerificationRecord,
} from "../verification"
import { deriveKnowledgeCandidate } from "./knowledge-feedback"
import type { TaskUnderstanding, UnderstandingSymbol } from "./types"

function symbol(file: string, id: string): UnderstandingSymbol {
  return {
    id,
    file,
    line: 1,
    confidence: 1,
    knowledgeIds: [],
    sources: ["search"],
  }
}

function understanding(overrides: Partial<TaskUnderstanding> = {}): TaskUnderstanding {
  return {
    scope: { projectId: "p", worktreeId: "w", revision: "rev-1", fingerprint: "fp" },
    freshness: "fresh",
    symbols: [symbol("src/known.ts", "sym-1")],
    advisorySymbols: [],
    impacted: [],
    tests: [],
    changes: [],
    constraints: [],
    uncertainties: [],
    queries: [],
    usableForCaution: true,
    truncated: false,
    truncationReasons: [],
    ...overrides,
  }
}

function record(overrides: Partial<DagVerificationRecord> = {}): DagVerificationRecord {
  return {
    schemaVersion: 1,
    runId: "run-1",
    parentSessionId: "ses-parent",
    rootSessionId: "ses-root",
    checkId: "unit-core",
    category: "unit",
    criteria: ["AC-1"],
    command: ["bun", "test"],
    cwd: "/tmp/proj",
    projectDir: "/tmp/proj",
    timeoutMs: 30_000,
    sourceRevision: "rev-1",
    generation: 1,
    repairAttempt: 0,
    startedAt: "2026-10-01T00:00:00.000Z",
    completedAt: "2026-10-01T00:00:10.000Z",
    durationMs: 10,
    started: true,
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    outputSummary: "ok",
    outputBytes: 2,
    coveredPaths: [],
    uncertainEffect: false,
    status: "passed",
    ...overrides,
  }
}

function current(overrides: Partial<DagVerificationCurrent> = {}): DagVerificationCurrent {
  return {
    sourceRevision: "rev-1",
    nodeFingerprints: new Map(),
    generation: 1,
    ...overrides,
  }
}

function accepted(): DagAcceptanceVerdict {
  return { accepted: true, reasons: [] }
}

describe("given a clean accepted pass, when deriving a knowledge candidate", () => {
  test("then it emits a source-verified candidate with sorted evidence and supplied timestamp", () => {
    const seen = understanding()
    const records = [
      record({ checkId: "z-check", completedAt: "2026-10-01T00:00:10.000Z" }),
      record({ checkId: "a-check", completedAt: "2026-10-01T00:00:05.000Z" }),
    ]
    const candidate = deriveKnowledgeCandidate({
      claim: "Retry uses bounded backoff",
      sourceFile: "src/known.ts",
      understanding: seen,
      acceptance: accepted(),
      records,
      current: current(),
      latestAttempts: new Map(),
      at: "2026-10-02T00:00:00.000Z",
    })
    expect(candidate).toEqual({
      claim: "Retry uses bounded backoff",
      sourceFile: "src/known.ts",
      sourceRevision: "rev-1",
      category: "source-verified",
      evidenceCheckIds: ["a-check", "z-check"],
      at: "2026-10-02T00:00:00.000Z",
    })
  })
})

describe("given a clean accepted pass without a supplied timestamp, when deriving a candidate", () => {
  test("then it uses the latest record completedAt deterministically", () => {
    const seen = understanding()
    const records = [
      record({ checkId: "z-check", completedAt: "2026-10-01T00:00:10.000Z" }),
      record({ checkId: "a-check", completedAt: "2026-10-01T00:00:05.000Z" }),
    ]
    const candidate = deriveKnowledgeCandidate({
      claim: "Retry uses bounded backoff",
      sourceFile: "src/known.ts",
      understanding: seen,
      acceptance: accepted(),
      records,
      current: current(),
      latestAttempts: new Map(),
    })
    expect(candidate?.at).toEqual("2026-10-01T00:00:10.000Z")
    expect(candidate?.evidenceCheckIds).toEqual(["a-check", "z-check"])
  })
})

describe("given a rejected acceptance, when deriving a candidate", () => {
  test("then it returns undefined", () => {
    const candidate = deriveKnowledgeCandidate({
      claim: "Retry uses bounded backoff",
      sourceFile: "src/known.ts",
      understanding: understanding(),
      acceptance: { accepted: false, reasons: ["missing verification record for unit-core"] },
      records: [record()],
      current: current(),
      latestAttempts: new Map(),
      at: "2026-10-02T00:00:00.000Z",
    })
    expect(candidate).toBeUndefined()
  })
})

describe("given a non-passed record, when deriving a candidate", () => {
  test("then it returns undefined", () => {
    const candidate = deriveKnowledgeCandidate({
      claim: "Retry uses bounded backoff",
      sourceFile: "src/known.ts",
      understanding: understanding(),
      acceptance: accepted(),
      records: [record({ checkId: "unit-core", status: "failed", exitCode: 1 })],
      current: current(),
      latestAttempts: new Map(),
      at: "2026-10-02T00:00:00.000Z",
    })
    expect(candidate).toBeUndefined()
  })
})

describe("given a stale record, when deriving a candidate", () => {
  test("then it returns undefined", () => {
    const stale = record({ checkId: "unit-core", generation: 0 })
    const candidate = deriveKnowledgeCandidate({
      claim: "Retry uses bounded backoff",
      sourceFile: "src/known.ts",
      understanding: understanding(),
      acceptance: accepted(),
      records: [stale],
      current: current(),
      latestAttempts: new Map(),
      at: "2026-10-02T00:00:00.000Z",
    })
    expect(candidate).toBeUndefined()
  })
})

describe("given a superseded attempt, when deriving a candidate", () => {
  test("then it returns undefined", () => {
    const candidate = deriveKnowledgeCandidate({
      claim: "Retry uses bounded backoff",
      sourceFile: "src/known.ts",
      understanding: understanding(),
      acceptance: accepted(),
      records: [record({ checkId: "unit-core", repairAttempt: 0 })],
      current: current(),
      latestAttempts: new Map([["unit-core", 1]]),
      at: "2026-10-02T00:00:00.000Z",
    })
    expect(candidate).toBeUndefined()
  })
})

describe("given a revision mismatch, when deriving a candidate", () => {
  test("then it returns undefined for a foreign record revision", () => {
    const candidate = deriveKnowledgeCandidate({
      claim: "Retry uses bounded backoff",
      sourceFile: "src/known.ts",
      understanding: understanding(),
      acceptance: accepted(),
      records: [record({ sourceRevision: "rev-2" })],
      current: current(),
      latestAttempts: new Map(),
      at: "2026-10-02T00:00:00.000Z",
    })
    expect(candidate).toBeUndefined()
  })
})

describe("given a foreign understanding revision, when deriving a candidate", () => {
  test("then it returns undefined", () => {
    const seen = understanding({
      scope: { projectId: "p", worktreeId: "w", revision: "rev-2", fingerprint: "fp" },
    })
    const candidate = deriveKnowledgeCandidate({
      claim: "Retry uses bounded backoff",
      sourceFile: "src/known.ts",
      understanding: seen,
      acceptance: accepted(),
      records: [record()],
      current: current(),
      latestAttempts: new Map(),
      at: "2026-10-02T00:00:00.000Z",
    })
    expect(candidate).toBeUndefined()
  })
})

describe("given an unverified source file, when deriving a candidate", () => {
  test("then it returns undefined", () => {
    const candidate = deriveKnowledgeCandidate({
      claim: "Retry uses bounded backoff",
      sourceFile: "src/unknown.ts",
      understanding: understanding(),
      acceptance: accepted(),
      records: [record()],
      current: current(),
      latestAttempts: new Map(),
      at: "2026-10-02T00:00:00.000Z",
    })
    expect(candidate).toBeUndefined()
  })
})

describe("given an empty claim, when deriving a candidate", () => {
  test("then it returns undefined", () => {
    const candidate = deriveKnowledgeCandidate({
      claim: "   ",
      sourceFile: "src/known.ts",
      understanding: understanding(),
      acceptance: accepted(),
      records: [record()],
      current: current(),
      latestAttempts: new Map(),
      at: "2026-10-02T00:00:00.000Z",
    })
    expect(candidate).toBeUndefined()
  })
})

describe("given an over-long claim, when deriving a candidate", () => {
  test("then it returns undefined", () => {
    const candidate = deriveKnowledgeCandidate({
      claim: "x".repeat(501),
      sourceFile: "src/known.ts",
      understanding: understanding(),
      acceptance: accepted(),
      records: [record()],
      current: current(),
      latestAttempts: new Map(),
      at: "2026-10-02T00:00:00.000Z",
    })
    expect(candidate).toBeUndefined()
  })
})

describe("given a source file from an authoritative constraint, when deriving a candidate", () => {
  test("then it emits a candidate", () => {
    const seen = understanding({
      symbols: [],
      constraints: [
        {
          id: "con-1",
          claim: "backoff is bounded",
          trust: "source-verified",
          sourceFile: "src/policy.ts",
          sourceRevision: "rev-1",
          authoritative: true,
        },
      ],
    })
    const candidate = deriveKnowledgeCandidate({
      claim: "Backoff is bounded",
      sourceFile: "src/policy.ts",
      understanding: seen,
      acceptance: accepted(),
      records: [record({ checkId: "unit-core" })],
      current: current(),
      latestAttempts: new Map(),
      at: "2026-10-02T00:00:00.000Z",
    })
    expect(candidate).toEqual({
      claim: "Backoff is bounded",
      sourceFile: "src/policy.ts",
      sourceRevision: "rev-1",
      category: "source-verified",
      evidenceCheckIds: ["unit-core"],
      at: "2026-10-02T00:00:00.000Z",
    })
  })
})
