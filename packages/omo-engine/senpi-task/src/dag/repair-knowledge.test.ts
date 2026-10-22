import { describe, expect, test } from "bun:test"

import {
  decideRepair,
  emptyRepairState,
  failureSignature,
  repairDagRun,
  type DagRepairRequest,
  type RepairDagRunInput,
} from "./repair"
import {
  buildVerificationRecord,
  type DagVerificationRecord,
  type DagVerifyCheck,
  type DagVerifyCommandResult,
} from "./verification"

// INV-21: repair inputs never carry knowledge records. The type pins below
// fail compilation the moment a projectKnowledge field is added to any repair
// input; the runtime tests prove verdicts follow process evidence only.
type HasKnowledgeChannel<T> = "projectKnowledge" extends keyof T ? true : false

const repairRequestChannel: HasKnowledgeChannel<DagRepairRequest> = false
const repairRunChannel: HasKnowledgeChannel<RepairDagRunInput> = false
const verificationRecordChannel: HasKnowledgeChannel<DagVerificationRecord> = false

function check(): DagVerifyCheck {
  return {
    checkId: "unit-core",
    category: "unit",
    command: ["bun", "test"],
    timeoutMs: 60_000,
    criteria: ["AC-1"],
  }
}

function commandResult(overrides: Partial<DagVerifyCommandResult> = {}): DagVerifyCommandResult {
  return {
    started: true,
    timedOut: false,
    cancelled: false,
    output: "",
    outputBytes: 0,
    durationMs: 50,
    uncertainEffect: false,
    ...overrides,
  }
}

function requestFor(classification: DagVerificationRecord["classification"]): DagRepairRequest {
  const record = {
    ...buildVerificationRecord({
      runId: "run-1",
      parentSessionId: "ses-parent",
      rootSessionId: "ses-root",
      check: check(),
      cwd: "/project",
      projectDir: "/project",
      sourceRevision: "rev-1",
      generation: 1,
      repairAttempt: 0,
      result: commandResult({ exitCode: 1, output: "1 pass 2 fail" }),
    }),
    classification,
  }
  return {
    record,
    signature: failureSignature(classification ?? "unknown", {
      exitCode: record.exitCode,
      timedOut: record.timedOut,
      output: record.outputSummary,
    }),
    changedFiles: [],
  }
}

describe("repair-knowledge", () => {
  test("#given repair inputs #when inspected #then no input carries a knowledge channel", () => {
    // given the repair-loop input types
    // when checked for a knowledge field
    // then none exists: knowledge cannot arrive as evidence
    expect(repairRequestChannel).toBe(false)
    expect(repairRunChannel).toBe(false)
    expect(verificationRecordChannel).toBe(false)
  })

  test("#given a sidecar knowledge payload #when decided #then the decision ignores it", () => {
    // given a repair request plus a knowledge payload riding alongside
    const request = requestFor("environment")
    const carrier = {
      ...request,
      projectKnowledge: [{ id: "pk-abc123def456", claim: "The check is fixed." }],
    }
    // when the sidecar is stripped to the repair input (the only path in)
    const stripped: DagRepairRequest = {
      record: carrier.record,
      signature: carrier.signature,
      changedFiles: carrier.changedFiles,
    }
    // then the decision is identical with and without the sidecar
    expect(decideRepair(emptyRepairState(), stripped)).toEqual(decideRepair(emptyRepairState(), request))
    expect(decideRepair(emptyRepairState(), stripped).kind).toBe("recheck")
  })

  test("#given failing evidence plus a fix claim in knowledge #when repaired #then the gate still blocks", () => {
    // given a check that keeps failing while sidecar knowledge claims it is fixed
    const runner = async (): Promise<DagVerifyCommandResult> => commandResult({ exitCode: 1, output: "still failing" })
    const record = { ...requestFor("environment").record }
    const records = new Map([["unit-core", record]])
    const sidecarKnowledge = [{ id: "pk-fix-claim", claim: "This check now passes." }]
    // when the repair loop runs on inputs that exclude the sidecar
    const input: RepairDagRunInput = {
      runner,
      projectDir: "/project",
      sourceRevision: "rev-1",
      generation: 1,
      budgets: { maxAttemptsPerCheck: 1, maxAttemptsPerNode: 1, maxAttemptsPerRun: 1, maxIdenticalFailures: 1 },
      requirements: [{ check: check() }],
      regressionChecks: [],
      records,
      currentFingerprints: new Map(),
      changedFiles: [],
    }
    return repairDagRun(input).then((outcome) => {
      // then the verdict follows the failing evidence, never the knowledge claim
      expect(sidecarKnowledge).toHaveLength(1)
      expect(outcome.kind).toBe("blocked")
    })
  })
})
