// Bounded repair: budgets, classification, the decision table, and the
// owner-driven loop. Each case names the V-number it proves.
import { describe, expect, test } from "bun:test"

import {
  classifyCommandResult,
  decideRepair,
  emptyRepairState,
  failureSignature,
  recordRepairAttempt,
  repairDagRun,
  type DagRepairState,
  type RepairDagRunInput,
} from "./repair"
import {
  buildVerificationRecord,
  verificationRecordKey,
  type DagVerificationRecord,
  type DagVerificationRecordInput,
  type DagVerifyCheck,
  type DagVerifyCommandResult,
  type DagVerifyRunner,
} from "./verification"

function check(overrides: Partial<DagVerifyCheck> = {}): DagVerifyCheck {
  return {
    checkId: "unit-core",
    category: "unit",
    command: ["bun", "test"],
    timeoutMs: 60_000,
    criteria: ["AC-1"],
    ...overrides,
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

function failedRecord(overrides: Partial<DagVerificationRecordInput> = {}): DagVerificationRecord {
  return buildVerificationRecord({
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
    ...overrides,
  })
}

function classified(record: DagVerificationRecord): DagVerificationRecord {
  return { ...record, classification: classifyCommandResult({
    started: record.started,
    exitCode: record.exitCode,
    signal: record.signal,
    timedOut: record.timedOut,
    cancelled: record.cancelled,
    output: record.outputSummary,
    outputBytes: record.outputBytes,
    durationMs: record.durationMs,
    uncertainEffect: record.uncertainEffect,
  }) }
}

function queuedRunner(queue: readonly DagVerifyCommandResult[], calls: DagVerifyCommandResult[] = []): DagVerifyRunner {
  let index = 0
  return async () => {
    const next = queue[Math.min(index, queue.length - 1)]
    index += 1
    calls.push(next)
    return next
  }
}

function repairInput(
  records: ReadonlyMap<string, DagVerificationRecord>,
  runner: DagVerifyRunner,
  overrides: Partial<RepairDagRunInput> = {},
): RepairDagRunInput {
  return {
    runner,
    projectDir: "/project",
    sourceRevision: "rev-1",
    generation: 1,
    requirements: [{ check: check() }],
    regressionChecks: [],
    records,
    currentFingerprints: new Map(),
    changedFiles: [],
    ...overrides,
  }
}

describe("failure classification", () => {
  test("#given nonzero exit #when classified #then product defect", () => {
    // given a plain test failure
    expect(classifyCommandResult(commandResult({ exitCode: 1, output: "assertion failed" }))).toBe("product_defect")
  })

  test("#given a missing binary #when classified #then environment, never product (V02)", () => {
    // given the command never started
    expect(classifyCommandResult(commandResult({ started: false, output: "command not found: bun" }))).toBe("environment")
    expect(classifyCommandResult(commandResult({ exitCode: 127, output: "command not found" }))).toBe("environment")
  })

  test("#given DNS failure output #when classified #then provider (V13)", () => {
    // given a network failure
    expect(classifyCommandResult(commandResult({ exitCode: 1, output: "getaddrinfo ENOTFOUND registry" }))).toBe("provider")
  })

  test("#given a timeout #when classified #then timeout", () => {
    // given the command timed out
    expect(classifyCommandResult(commandResult({ timedOut: true, output: "partial" }))).toBe("timeout")
  })

  test("#given no exit code #when classified #then malformed result (V04)", () => {
    // given a result with no trustworthy completion
    expect(classifyCommandResult(commandResult({ exitCode: undefined, output: "" }))).toBe("malformed_result")
  })
})

describe("failure signatures", () => {
  test("#given identical redacted failures #when signed #then equal; new evidence re-arms", () => {
    // given two failures with the same evidence
    const left = failureSignature("product_defect", { exitCode: 1, output: "same tail" })
    const right = failureSignature("product_defect", { exitCode: 1, output: "same tail" })
    const changed = failureSignature("product_defect", { exitCode: 1, output: "different tail" })
    // when signed
    // then equality tracks the evidence
    expect(left).toBe(right)
    expect(left === changed).toBe(false)
  })
})

describe("repair decisions", () => {
  function requestFor(classification: DagVerificationRecord["classification"]) {
    const record = { ...failedRecord(), classification }
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

  test("#given an environmental failure #when decided #then recheck within budget", () => {
    // given a missing-dependency failure
    const decision = decideRepair(emptyRepairState(), requestFor("environment"))
    // when decided
    // then the check re-runs without touching the worker
    expect(decision.kind).toBe("recheck")
  })

  test("#given a product defect #when decided #then renode through the worker path", () => {
    // given a real test failure
    const decision = decideRepair(emptyRepairState(), requestFor("product_defect"))
    // when decided
    // then the worker re-runs before re-verification
    expect(decision.kind).toBe("renode")
  })

  test("#given an invalid contract #when decided #then blocked for review, never auto-weakened (V15)", () => {
    // given a test contract diagnosed invalid
    const decision = decideRepair(emptyRepairState(), requestFor("invalid_contract"))
    // when decided
    expect(decision.kind).toBe("blocked")
  })

  test("#given a provider outage #when decided #then blocked, live stays unverified (V13)", () => {
    // given no provider
    const decision = decideRepair(emptyRepairState(), requestFor("provider"))
    expect(decision.kind).toBe("blocked")
  })

  test("#given an uncertain side effect #when decided #then blocked until reconciled (V11)", () => {
    // given a timeout that may have mutated state
    const record = { ...failedRecord(), uncertainEffect: true, classification: "timeout" as const }
    const decision = decideRepair(emptyRepairState(), {
      record,
      signature: failureSignature("timeout", { timedOut: true, output: "" }),
      changedFiles: [],
    })
    expect(decision.kind).toBe("blocked")
  })

  test("#given the same signature twice #when decided #then the loop stops (V09)", () => {
    // given one identical failure already recorded, with headroom in the count budgets
    let state: DagRepairState = emptyRepairState({
      maxAttemptsPerCheck: 5,
      maxAttemptsPerNode: 5,
      maxAttemptsPerRun: 5,
      maxIdenticalFailures: 2,
    })
    const request = requestFor("flaky")
    state = recordRepairAttempt(state, request)
    state = recordRepairAttempt(state, request)
    // when the same failure recurs
    const decision = decideRepair(state, request)
    // then no third identical attempt runs
    expect(decision.kind).toBe("blocked")
  })

  test("#given a spent per-check budget #when decided #then exhausted (V12)", () => {
    // given attempts at the limit
    let state: DagRepairState = emptyRepairState({ maxAttemptsPerCheck: 1, maxAttemptsPerNode: 3, maxAttemptsPerRun: 5, maxIdenticalFailures: 5 })
    const request = requestFor("environment")
    state = recordRepairAttempt(state, { ...request, signature: "sig-1" })
    // when deciding again
    const decision = decideRepair(state, { ...request, signature: "sig-2" })
    // then the budget refuses
    expect(decision.kind).toBe("exhausted")
  })
})

describe("repair loop", () => {
  test("#given a flaky check #when repaired #then recheck passes and the gate accepts", () => {
    // given a failed record and a runner that passes on retry
    const calls: DagVerifyCommandResult[] = []
    const runner = queuedRunner([commandResult({ exitCode: 0, output: "pass" })], calls)
    const records = new Map([["unit-core", { ...classified(failedRecord()), classification: "environment" as const }]])
    // when the loop runs with an environmental classification
    return repairDagRun(repairInput(records, runner)).then((outcome) => {
      // then it accepts after one repair attempt
      expect(outcome).toEqual({ kind: "accepted", attempts: 1 })
    })
  })

  test("#given a repair that breaks regression #when repaired #then blocked, never accepted (V08)", () => {
    // given a check that passes on retry while regression fails
    const runner = queuedRunner([
      commandResult({ exitCode: 0, output: "fixed" }),
      commandResult({ exitCode: 1, output: "regression broke" }),
    ])
    const records = new Map([["unit-core", { ...classified(failedRecord()), classification: "environment" as const }]])
    // when the loop runs with a failing regression set
    return repairDagRun(repairInput(records, runner, {
      regressionChecks: [check({ checkId: "regression-dag", category: "regression" })],
    })).then((outcome) => {
      // then acceptance stays blocked
      expect(outcome.kind).toBe("blocked")
    })
  })

  test("#given cancellation mid-repair #when repaired #then blocked with no further dispatch (V14)", () => {
    // given a cancelled run
    let dispatches = 0
    const runner: DagVerifyRunner = async () => {
      dispatches += 1
      return commandResult({ exitCode: 0 })
    }
    const records = new Map([["unit-core", { ...classified(failedRecord()), classification: "environment" as const }]])
    // when the loop runs cancelled
    return repairDagRun(repairInput(records, runner, { isCancelled: () => true })).then((outcome) => {
      // then nothing dispatches and the run stays blocked
      expect(outcome).toEqual({ kind: "blocked", reasons: ["cancelled during repair"] })
      expect(dispatches).toBe(0)
    })
  })

  test("#given one passing and one failing goal #when repaired #then the pass is kept and the run blocks (V16)", () => {
    // given partial parallel success
    const runner = queuedRunner([commandResult({ exitCode: 1, output: "still failing" })])
    const records = new Map([
      ["unit-a", buildVerificationRecord({
        runId: "run-1", parentSessionId: "s", rootSessionId: "s",
        check: check({ checkId: "unit-a" }), cwd: "/p", projectDir: "/p",
        sourceRevision: "rev-1", generation: 1, repairAttempt: 0, result: commandResult({ exitCode: 0 }),
      })],
      ["unit-b", { ...classified(failedRecord({ check: check({ checkId: "unit-b" }) })), classification: "environment" as const }],
    ])
    // when the loop runs with both required
    return repairDagRun(repairInput(records, runner, {
      budgets: { maxAttemptsPerCheck: 1, maxAttemptsPerNode: 1, maxAttemptsPerRun: 1, maxIdenticalFailures: 5 },
      requirements: [{ check: check({ checkId: "unit-a" }) }, { check: check({ checkId: "unit-b" }) }],
    })).then((outcome) => {
      // then the passing goal survives while aggregate acceptance blocks
      expect(outcome.kind).toBe("blocked")
      expect(records.get("unit-a")?.status).toBe("passed")
    })
  })

  test("#given a product defect without a worker path #when repaired #then blocked naming the missing path", () => {
    // given no retryNode hook
    const runner = queuedRunner([commandResult({ exitCode: 0 })])
    const records = new Map([["unit-core", classified(failedRecord())]])
    // when the loop runs
    return repairDagRun(repairInput(records, runner)).then((outcome) => {
      // then it refuses instead of inventing a retry
      expect(outcome.kind).toBe("blocked")
      expect(JSON.stringify(outcome)).toContain("no worker retry path")
    })
  })

  test("#given a product defect with a worker path #when repaired #then the worker re-runs first", () => {
    // given a retry hook
    const retried: string[] = []
    const runner = queuedRunner([commandResult({ exitCode: 0, output: "pass after renode" })])
    const records = new Map([[verificationRecordKey("a", "unit-core"), classified({ ...failedRecord(), nodeId: "a", nodeFingerprint: "fp-a" })]])
    // when the loop runs
    return repairDagRun(repairInput(records, runner, {
      requirements: [{ check: check(), nodeId: "a" }],
      currentFingerprints: new Map([["a", "fp-a"]]),
      retryNode: async (nodeId) => { retried.push(nodeId) },
    })).then((outcome) => {
      // then the worker ran before re-verification and the gate accepted
      expect(retried).toEqual(["a"])
      expect(outcome).toEqual({ kind: "accepted", attempts: 1 })
    })
  })
})
