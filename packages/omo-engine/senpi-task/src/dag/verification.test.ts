// Evidence-first verification records: statuses, freshness, selection, and the
// fail-closed gate. Each case names the V-number it proves.
import { describe, expect, test } from "bun:test"

import {
  buildVerificationRecord,
  checkVerificationFreshness,
  deriveVerificationStatus,
  evaluateAcceptance,
  isVerificationAccepting,
  parseVerificationRecord,
  readRunVerificationRecords,
  reconcileInterruptedVerifications,
  scrubSecretValues,
  selectVerificationChecks,
  serializeVerificationRecord,
  verificationAffectedByRepair,
  verificationRecordKey,
  withRecordClassification,
  type DagChangeScope,
  type DagVerificationCurrent,
  type DagVerificationRecord,
  type DagVerificationRecordInput,
  type DagVerifyCheck,
  type DagVerifyCommandResult,
} from "./verification"
import type { DagRunId } from "./types"

function check(overrides: Partial<DagVerifyCheck> = {}): DagVerifyCheck {
  return {
    checkId: "unit-core",
    category: "unit",
    command: ["bun", "test", "core.test.ts"],
    timeoutMs: 60_000,
    criteria: ["AC-1"],
    ...overrides,
  }
}

function result(overrides: Partial<DagVerifyCommandResult> = {}): DagVerifyCommandResult {
  return {
    started: true,
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    output: "3 pass 0 fail",
    outputBytes: 14,
    durationMs: 120,
    uncertainEffect: false,
    ...overrides,
  }
}

function current(overrides: Partial<DagVerificationCurrent> = {}): DagVerificationCurrent {
  return { sourceRevision: "rev-1", nodeFingerprints: new Map(), generation: 1, ...overrides }
}

function record(overrides: Partial<DagVerificationRecordInput> = {}): DagVerificationRecord {
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
    result: result(),
    ...overrides,
  })
}

function gateInput(checks: readonly DagVerifyCheck[], records: ReadonlyMap<string, DagVerificationRecord>) {
  const latestAttempts = new Map<string, number>()
  for (const [key, entry] of records) latestAttempts.set(key, entry.repairAttempt)
  return {
    requirements: checks.map((entry) => ({ check: entry })),
    records,
    current: current(),
    latestAttempts,
  }
}

describe("verification statuses", () => {
  test("#given the nine statuses #when asked which accept #then only passed accepts", () => {
    // given all statuses
    // when each is judged
    // then only passed accepts
    expect(isVerificationAccepting("passed")).toBe(true)
    for (const status of ["pending", "running", "failed", "timed_out", "cancelled", "unavailable", "skipped", "stale"] as const) {
      expect(isVerificationAccepting(status)).toBe(false)
    }
  })

  test("#given a genuine zero-exit execution #when derived #then passed (V01 inverse)", () => {
    // given a real completed run
    // when the status derives
    // then it passes
    expect(deriveVerificationStatus(result())).toBe("passed")
  })

  test("#given a nonzero exit #when derived #then failed and the gate blocks with the code (V01)", () => {
    // given a required check exiting nonzero
    const failed = record({ result: result({ exitCode: 3, output: "1 pass 2 fail" }) })
    // when derived and gated
    expect(failed.status).toBe("failed")
    const verdict = evaluateAcceptance(gateInput([check()], new Map([[check().checkId, failed]])))
    // then acceptance is blocked and the exit code is on the record
    expect(verdict.accepted).toBe(false)
    expect(failed.exitCode).toBe(3)
    expect(verdict.reasons.join(" ")).toContain("failed")
  })

  test("#given a check that never started #when derived #then unavailable and the gate blocks (V02)", () => {
    // given a missing executable
    const missing = record({ result: result({ started: false, exitCode: undefined, output: "cannot start" }) })
    // when derived and gated
    expect(missing.status).toBe("unavailable")
    const verdict = evaluateAcceptance(gateInput([check()], new Map([[check().checkId, missing]])))
    // then it never counts as passed
    expect(verdict.accepted).toBe(false)
  })

  test("#given a worker claim with no record #when gated #then blocked as missing (V03)", () => {
    // given no verification record at all
    // when the gate evaluates
    const verdict = evaluateAcceptance(gateInput([check()], new Map()))
    // then acceptance is blocked
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(" ")).toContain("missing verification record")
  })

  test("#given a result without trustworthy completion #when gated #then it stays unverified (V04)", () => {
    // given a started run with no exit code and no timeout
    const hanging = record({ result: result({ exitCode: undefined, output: "" }) })
    // when derived and gated
    expect(hanging.status).toBe("failed")
    const verdict = evaluateAcceptance(gateInput([check()], new Map([[check().checkId, hanging]])))
    expect(verdict.accepted).toBe(false)
  })
})

describe("verification freshness (V05)", () => {
  test("#given a passing record #when the source revision changes #then the record is stale", () => {
    // given a fresh passing record
    const passed = record()
    expect(checkVerificationFreshness(passed, current(), 0).fresh).toBe(true)
    // when the source moves
    const stale = checkVerificationFreshness(passed, current({ sourceRevision: "rev-2" }), 0)
    // then it no longer counts
    expect(stale).toEqual({ fresh: false, reason: "source revision changed" })
  })

  test("#given a node-scoped record #when the node definition changes #then stale with cause", () => {
    // given a record bound to a node fingerprint
    const scoped = record({ nodeId: "a", nodeFingerprint: "fp-a" })
    // when that node changes
    const stale = checkVerificationFreshness(
      scoped,
      current({ nodeFingerprints: new Map([["a", "fp-b"]]) }),
      0,
    )
    // then the cause names the node
    expect(stale).toEqual({ fresh: false, reason: "node definition changed" })
  })

  test("#given an unrelated file change #when fingerprints hold #then the record stays current", () => {
    // given fingerprints that survive an unrelated edit
    const passed = record()
    // when evaluated against the same fingerprints
    // then freshness holds without re-running
    expect(checkVerificationFreshness(passed, current(), 0).fresh).toBe(true)
  })

  test("#given a superseded attempt #when a newer attempt exists #then the old record is stale", () => {
    // given attempt 0 while attempt 1 is latest
    const old = record({ repairAttempt: 0 })
    const stale = checkVerificationFreshness(old, current(), 1)
    expect(stale).toEqual({ fresh: false, reason: "superseded by a newer attempt" })
  })

  test("#given a passed record without execution proof #when checked #then stale", () => {
    // given a passed status with no execution behind it
    const hollow = { ...record(), started: false, exitCode: undefined }
    const stale = checkVerificationFreshness(hollow, current(), 0)
    expect(stale).toEqual({ fresh: false, reason: "passed without a genuine execution record" })
  })
})

describe("verification records and malformed output (V06)", () => {
  test("#given malformed persisted output #when parsed #then null and the gate reports it", () => {
    // given truncated JSON on disk
    expect(parseVerificationRecord("{not json")).toBeNull()
    expect(parseVerificationRecord(JSON.stringify({ schemaVersion: 2, status: "passed" }))).toBeNull()
    expect(parseVerificationRecord(JSON.stringify({ schemaVersion: 1, status: "bogus" }))).toBeNull()
    // when a store holds one good and one malformed file
    const store = {
      files: new Map<string, string>([
        ["a.unit-core.0.json", serializeVerificationRecord(record({ nodeId: "a", check: check({ checkId: "unit-core" }) }))],
        ["a.broken.0.json", "{truncated"],
      ]),
      writeVerification: () => "",
      readVerification: (_run: DagRunId, node: string, checkId: string, _attempt: number) =>
        store.files.get(`${node}.${checkId}.0.json`) ?? null,
      listVerifications: () => [...store.files.keys()],
    }
    // SAFETY: fixed fixture id; the brand is compile-time only and nothing reads its shape at runtime.
    const read = readRunVerificationRecords(store, "run-1" as DagRunId)
    // then the good record parses and the malformed file is reported, never trusted
    expect(read.records.size).toBe(1)
    expect(read.malformed).toEqual(["a.broken.0.json"])
  })

  test("#given duplicate files for one attempt #when read #then one record, accepted once (V18)", () => {
    // given two files describing the same attempt key
    const body = serializeVerificationRecord(record({ nodeId: "a" }))
    const store = {
      files: new Map<string, string>([["a.unit-core.0.json", body]]),
      writeVerification: () => "",
      readVerification: () => body,
      listVerifications: () => ["a.unit-core.0.json", "a.unit-core.0.json"],
    }
    // SAFETY: fixed fixture id; the brand is compile-time only and nothing reads its shape at runtime.
    const read = readRunVerificationRecords(store, "run-1" as DagRunId)
    // then duplicates collapse to one record, not two successes
    expect(read.records.size).toBe(1)
    expect(read.records.get(verificationRecordKey("a", "unit-core"))).toBeDefined()
  })
})

describe("flaky checks (V10)", () => {
  test("#given inconsistent attempts #when gated #then only the latest attempt counts", () => {
    // given attempt 0 failed and attempt 1 passed
    const failed = record({ repairAttempt: 0, result: result({ exitCode: 1 }) })
    const passed = record({ repairAttempt: 1 })
    const records = new Map([[check().checkId, passed]])
    const verdict = evaluateAcceptance({
      requirements: [{ check: check() }],
      records,
      current: current(),
      latestAttempts: new Map([[check().checkId, 1]]),
    })
    // then the latest pass accepts
    expect(verdict.accepted).toBe(true)
    void failed
  })

  test("#given a pass followed by a fresh failure #when gated #then blocked", () => {
    // given the latest attempt failed
    const failed = record({ repairAttempt: 1, result: result({ exitCode: 1 }) })
    const verdict = evaluateAcceptance({
      requirements: [{ check: check() }],
      records: new Map([[check().checkId, failed]]),
      current: current(),
      latestAttempts: new Map([[check().checkId, 1]]),
    })
    // then one earlier pass does not rescue it
    expect(verdict.accepted).toBe(false)
  })
})

describe("selection", () => {
  const available: readonly DagVerifyCheck[] = [
    check({ checkId: "unit-core", category: "unit" }),
    check({ checkId: "typecheck", category: "typecheck", command: ["bun", "run", "typecheck"] }),
    check({ checkId: "lint", category: "lint", command: ["bunx", "oxlint"] }),
    check({ checkId: "build-dag", category: "build", command: ["bun", "run", "build"] }),
    check({ checkId: "regression-dag", category: "regression", command: ["bun", "test", "dag"] }),
    check({ checkId: "native-exec", category: "native", command: ["bun", "test", "e2e"] }),
  ]

  function scope(overrides: Partial<DagChangeScope> = {}): DagChangeScope {
    return {
      changedFiles: ["packages/omo-engine/senpi-task/src/dag/scheduler.ts"],
      touchesScheduler: true,
      touchesCompletionGate: false,
      touchesWorkerLifecycle: false,
      touchesPersistedState: false,
      isDocsOnly: false,
      ...overrides,
    }
  }

  test("#given a scheduler change #when selected #then build regression typecheck and lint are required", () => {
    // given a scheduler change
    const selected = selectVerificationChecks(scope(), available)
    // when the plan is derived
    const ids = selected.required.map((entry) => entry.checkId)
    // then the risky checks are required
    expect(ids).toContain("build-dag")
    expect(ids).toContain("regression-dag")
    expect(ids).toContain("typecheck")
    expect(ids).toContain("lint")
  })

  test("#given docs-only #when selected #then unit and integration are omitted with reasons", () => {
    // given a docs-only change
    const selected = selectVerificationChecks(scope({ isDocsOnly: true, touchesScheduler: false }), available)
    // when the plan is derived
    // then executable checks stay out with a recorded reason
    expect(selected.required.map((entry) => entry.checkId)).not.toContain("unit-core")
    expect(selected.omitted.length).toBeGreaterThan(0)
    for (const omitted of selected.omitted) expect(omitted.reason.length).toBeGreaterThan(0)
  })
})

describe("restart reconciliation (V19)", () => {
  test("#given records left pending by a crash #when reconciled #then reported, never assumed passed", () => {
    // given a mix of settled and interrupted records
    const interrupted = [
      { ...record(), status: "pending" as const },
      { ...record(), status: "running" as const },
      record(),
    ]
    // when reconciled
    const found = reconcileInterruptedVerifications(interrupted)
    // then only the unsettled ones surface
    expect(found).toHaveLength(2)
  })
})

describe("repair invalidation (V17)", () => {
  test("#given a repair touching covered paths #when evaluated #then intersecting records invalidate", () => {
    // given a record covering a path the repair rewrites
    const covered = record({ check: check({ checkId: "unit-a", coveredPaths: ["src/dag"] }) })
    // when the repair touches that path
    expect(verificationAffectedByRepair(covered, ["src/dag/scheduler.ts"])).toBe(true)
    // and an unrelated repair leaves it alone
    expect(verificationAffectedByRepair(covered, ["docs/readme.md"])).toBe(false)
  })

  test("#given a run-scoped record #when files change #then it survives", () => {
    // given a record with no covered paths
    const scoped = record()
    expect(verificationAffectedByRepair(scoped, ["src/dag/scheduler.ts"])).toBe(false)
  })
})

describe("secret redaction (V20)", () => {
  test("#given output carrying credentials #when scrubbed #then values mask and shape stays", () => {
    // given diagnostic output with a secret
    const dirty = 'update failed: api_key="sk-live-12345" for check unit-core'
    // when scrubbed
    const clean = scrubSecretValues(dirty)
    // then the value is gone but the failure shape remains
    expect(clean).not.toContain("sk-live-12345")
    expect(clean).toContain("api_key=")
    expect(clean).toContain("for check unit-core")
  })

  test("#given a record built from tainted output #when classified #then the summary is redacted (V20)", () => {
    // given tainted runner output
    const tainted = record({
      result: result({ output: "token=abc123 failed" }),
      check: check(),
    })
    // when persisted through the record builder
    const classified = withRecordClassification(tainted, "product_defect")
    // then the stored summary carries no credential
    expect(classified.outputSummary).not.toContain("abc123")
  })
})

describe("invalid contract diagnosis (V15)", () => {
  test("#given an invalid test contract #when diagnosed #then the hypothesis records review, not a pass", () => {
    // given a record classified as an invalid contract
    const diagnosed = withRecordClassification(record(), "invalid_contract", "needs-review: assertion pins timestamp")
    // when read back
    expect(diagnosed.classification).toBe("invalid_contract")
    expect(diagnosed.diagnosticRef).toContain("needs-review")
    // and the gate still blocks it
    const verdict = evaluateAcceptance(gateInput([check()], new Map([[check().checkId, diagnosed]])))
    expect(verdict.accepted).toBe(false)
  })
})
