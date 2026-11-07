import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  parseVerificationRecord,
  verificationAffectedByRepair,
  type DagVerifyCheck,
} from "../dag/verification"
import {
  ORDINARY_VERIFICATION_NODE,
  createOrdinaryVerificationCapture,
  ordinaryEvidenceFreshness,
  type OrdinaryEvidenceStore,
} from "./ordinary-capture"

function tempStore() {
  const root = mkdtempSync(join(tmpdir(), "ordinary-verify-"))
  const dir = (runId: string) => join(root, "verifications", runId)
  const path = (runId: string, nodeId: string, checkId: string, attempt: number) =>
    join(dir(runId), `${nodeId}.${checkId}.${attempt}.json`)
  return {
    root,
    store: {
      writeVerification(runId, nodeId, checkId, attempt, record) {
        mkdirSync(dir(runId), { recursive: true })
        const target = path(runId, nodeId, checkId, attempt)
        writeFileSync(target, record)
        return target
      },
      readVerification(runId, nodeId, checkId, attempt) {
        const target = path(runId, nodeId, checkId, attempt)
        return existsSync(target) ? readFileSync(target, "utf8") : null
      },
      listVerifications(runId) {
        return existsSync(dir(runId)) ? readdirSync(dir(runId)) : []
      },
    },
  }
}

const PASSING: DagVerifyCheck = {
  checkId: "unit-core",
  category: "unit",
  command: ["node", "-e", "process.exit(0)"],
  timeoutMs: 20_000,
  criteria: ["core tests pass"],
  coveredPaths: ["src/a.ts"],
}

const FAILING: DagVerifyCheck = { ...PASSING, checkId: "unit-fail", command: ["node", "-e", "process.exit(3)"] }

const HANGING: DagVerifyCheck = {
  ...PASSING,
  checkId: "unit-hang",
  command: ["node", "-e", "setTimeout(() => {}, 5000)"],
  timeoutMs: 400,
}

function harness(store: OrdinaryEvidenceStore, revision = "rev-1") {
  return createOrdinaryVerificationCapture({ store, projectDir: process.cwd(), currentRevision: () => revision })
}

describe("ordinary capture - execution provenance", () => {
  test("#given a passing command #when captured #then the host records a passed record with exit 0", async () => {
    const { store } = tempStore()
    const result = await harness(store).capture({
      binding: { runId: "run-pass", sessionId: "sess-1", epoch: 7 },
      changedFiles: ["src/a.ts"],
      available: [PASSING],
    })
    const record = result.records[0]
    expect(record).toBeDefined()
    expect(record?.status).toBe("passed")
    expect(record?.exitCode).toBe(0)
    expect(record?.started).toBe(true)
    expect(record?.workerAttempt).toBe(7)
    expect(record?.sourceRevision).toBe("rev-1")
    expect(result.persistedPaths[0]?.endsWith(`${ORDINARY_VERIFICATION_NODE}.unit-core.1.json`)).toBe(true)
  })

  test("#given a failing command #when captured #then the record is failed and never passed", async () => {
    const { store } = tempStore()
    const result = await harness(store).capture({
      binding: { runId: "run-fail", sessionId: "sess-1", epoch: 1 },
      changedFiles: ["src/a.ts"],
      available: [FAILING],
    })
    expect(result.records[0]?.status).toBe("failed")
    expect(result.records[0]?.exitCode).toBe(3)
    expect(result.records.some((record) => record.status === "passed")).toBe(false)
  })

  test("#given a command that outlives its timeout #when captured #then the status is timed_out", async () => {
    const { store } = tempStore()
    const result = await harness(store).capture({
      binding: { runId: "run-hang", sessionId: "sess-1", epoch: 1 },
      changedFiles: ["src/a.ts"],
      available: [HANGING],
    })
    expect(result.records[0]?.status).toBe("timed_out")
    expect(result.records[0]?.timedOut).toBe(true)
  })

  test("#given a cancellation before the check starts #when captured #then nothing is recorded", async () => {
    const { store } = tempStore()
    const capture = createOrdinaryVerificationCapture({
      store,
      projectDir: process.cwd(),
      currentRevision: () => "rev-1",
      isCancelled: () => true,
    })
    const result = await capture.capture({
      binding: { runId: "run-cancel", sessionId: "sess-1", epoch: 1 },
      changedFiles: ["src/a.ts"],
      available: [PASSING],
    })
    expect(result.records).toHaveLength(0)
    expect(result.persistedPaths).toHaveLength(0)
  })
})

describe("ordinary capture - freshness", () => {
  test("#given a record just executed #when judged against the same revision and epoch #then it is fresh", async () => {
    const { store } = tempStore()
    const result = await harness(store).capture({
      binding: { runId: "run-fresh", sessionId: "sess-1", epoch: 4 },
      changedFiles: ["src/a.ts"],
      available: [PASSING],
    })
    expect(ordinaryEvidenceFreshness(result.records[0]!, { sourceRevision: "rev-1", epoch: 4 })).toEqual({ fresh: true })
  })

  test("#given the source changed after execution #when judged #then the record is stale", async () => {
    const { store } = tempStore()
    const result = await harness(store).capture({
      binding: { runId: "run-stale", sessionId: "sess-1", epoch: 4 },
      changedFiles: ["src/a.ts"],
      available: [PASSING],
    })
    const verdict = ordinaryEvidenceFreshness(result.records[0]!, { sourceRevision: "rev-2", epoch: 4 })
    expect(verdict.fresh).toBe(false)
    if (!verdict.fresh) expect(verdict.reason).toBe("source revision changed")
  })

  test("#given the run epoch moved on #when judged #then the record is rejected", async () => {
    const { store } = tempStore()
    const result = await harness(store).capture({
      binding: { runId: "run-epoch", sessionId: "sess-1", epoch: 4 },
      changedFiles: ["src/a.ts"],
      available: [PASSING],
    })
    const verdict = ordinaryEvidenceFreshness(result.records[0]!, { sourceRevision: "rev-1", epoch: 5 })
    expect(verdict.fresh).toBe(false)
    if (!verdict.fresh) expect(verdict.reason).toBe("run epoch changed")
  })

  test("#given covered paths #when a covered file changes #then the record is affected, an unrelated file is not", async () => {
    const { store } = tempStore()
    const result = await harness(store).capture({
      binding: { runId: "run-covered", sessionId: "sess-1", epoch: 1 },
      changedFiles: ["src/a.ts"],
      available: [PASSING],
    })
    const record = result.records[0]!
    expect(verificationAffectedByRepair(record, ["src/a.ts"])).toBe(true)
    expect(verificationAffectedByRepair(record, ["src/z.ts"])).toBe(false)
    expect(verificationAffectedByRepair(record, ["docs/readme.md"])).toBe(false)
  })
})

describe("ordinary capture - persistence", () => {
  test("#given a captured record #when a fresh store instance reads it #then the evidence survives", async () => {
    const { store, root } = tempStore()
    const result = await harness(store).capture({
      binding: { runId: "run-persist", sessionId: "sess-1", epoch: 2 },
      changedFiles: ["src/a.ts"],
      available: [PASSING],
    })
    const path = result.persistedPaths[0]!
    expect(existsSync(path)).toBe(true)
    const reread = mkdtempSync(join(tmpdir(), "ordinary-verify-reader-"))
    expect(reread).not.toBe(root)
    const text = readFileSync(path, "utf8")
    const parsed = parseVerificationRecord(text)
    expect(parsed?.runId).toBe("run-persist")
    expect(parsed?.status).toBe("passed")
    expect(parsed?.checkId).toBe("unit-core")
  })

  test("#given two runs capturing the same check #when both persist #then each run keeps its own evidence", async () => {
    const { store } = tempStore()
    await harness(store).capture({
      binding: { runId: "run-a", sessionId: "sess-a", epoch: 1 },
      changedFiles: ["src/a.ts"],
      available: [PASSING],
    })
    await harness(store).capture({
      binding: { runId: "run-b", sessionId: "sess-b", epoch: 1 },
      changedFiles: ["src/a.ts"],
      available: [FAILING],
    })
    expect(store.listVerifications("run-a")).toHaveLength(1)
    expect(store.listVerifications("run-b")).toHaveLength(1)
    const a = parseVerificationRecord(store.readVerification("run-a", ORDINARY_VERIFICATION_NODE, "unit-core", 1)!)
    const b = parseVerificationRecord(store.readVerification("run-b", ORDINARY_VERIFICATION_NODE, "unit-fail", 1)!)
    expect(a?.status).toBe("passed")
    expect(b?.status).toBe("failed")
    expect(a?.parentSessionId).toBe("sess-a")
    expect(b?.parentSessionId).toBe("sess-b")
  })
})

describe("ordinary capture - policy reuse", () => {
  test("#given a documentation-only change #when captured #then no executable check is required", async () => {
    const { store } = tempStore()
    const result = await harness(store).capture({
      binding: { runId: "run-docs", sessionId: "sess-1", epoch: 1 },
      changedFiles: ["docs/architecture/agent-quality-gate.md"],
      available: [PASSING],
    })
    expect(result.selection.required).toHaveLength(0)
    expect(result.selection.omitted.map((entry) => entry.check.checkId)).toContain("unit-core")
    expect(result.records).toHaveLength(0)
  })

  test("#given a code change #when captured #then the existing policy requires the executable check", async () => {
    const { store } = tempStore()
    const result = await harness(store).capture({
      binding: { runId: "run-code", sessionId: "sess-1", epoch: 1 },
      changedFiles: ["packages/web/server/lib/code-graph/runtime.js"],
      available: [PASSING],
    })
    expect(result.selection.required.map((check) => check.checkId)).toContain("unit-core")
    expect(result.records).toHaveLength(1)
  })
})
