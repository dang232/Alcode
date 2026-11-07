import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DagVerifyCheck } from "../dag/verification"
import { createOrdinaryVerificationCapture, type OrdinaryEvidenceStore } from "./ordinary-capture"
import { createVerificationWorkerTool } from "./verify-tool"
import { resolveWorkerVerificationContext, type WorkerContextSource } from "./worker-context"

function source(overrides: Partial<WorkerContextSource> = {}): WorkerContextSource {
  return {
    task_id: "run-w",
    parent_session_id: "sess-parent",
    status: "running",
    notification: { run_epoch: 2 },
    spawn_spec: { cwd: "D:/elsewhere/worker-clone" },
    ...overrides,
  }
}

describe("worker verification context", () => {
  test("#given a running record with a persisted launch directory #when resolved #then identity and directory come from the record", () => {
    const context = resolveWorkerVerificationContext(source())
    expect(context?.binding.runId).toBe("run-w")
    expect(context?.binding.sessionId).toBe("sess-parent")
    expect(context?.binding.epoch).toBe(2)
    expect(context?.workspaceDir).toBe("D:/elsewhere/worker-clone")
    expect(context?.workspaceDir).not.toBe(process.cwd())
  })

  test("#given a terminal run #when resolved #then no context is offered", () => {
    for (const status of ["completed", "error", "cancelled", "interrupted", "lost"]) {
      expect(resolveWorkerVerificationContext(source({ status }))).toBeNull()
    }
  })

  test("#given no persisted launch directory #when resolved #then it fails closed instead of guessing", () => {
    expect(resolveWorkerVerificationContext(source({ spawn_spec: {} }))).toBeNull()
    expect(resolveWorkerVerificationContext(source({ spawn_spec: { cwd: "" } }))).toBeNull()
    expect(resolveWorkerVerificationContext(source({ spawn_spec: undefined }))).toBeNull()
  })

  test("#given an unusable run epoch #when resolved #then it fails closed", () => {
    expect(resolveWorkerVerificationContext(source({ notification: { run_epoch: -1 } }))).toBeNull()
    expect(resolveWorkerVerificationContext(source({ notification: { run_epoch: 1.5 } }))).toBeNull()
  })
})

function tempStore(): OrdinaryEvidenceStore {
  const root = mkdtempSync(join(tmpdir(), "worker-context-"))
  const dir = (runId: string) => join(root, "verifications", runId)
  return {
    writeVerification(runId, _nodeId, checkId, _attempt, record) {
      mkdirSync(dir(runId), { recursive: true })
      const target = join(dir(runId), `run.${checkId}.1.json`)
      writeFileSync(target, record)
      return target
    },
    readVerification(runId, _nodeId, checkId) {
      const target = join(dir(runId), `run.${checkId}.1.json`)
      return existsSync(target) ? readFileSync(target, "utf8") : null
    },
    listVerifications(runId) {
      return existsSync(dir(runId)) ? readdirSync(dir(runId)) : []
    },
  }
}

const PASSING: DagVerifyCheck = {
  checkId: "unit-core",
  category: "unit",
  command: ["node", "-e", "process.exit(0)"],
  timeoutMs: 20_000,
  criteria: ["core tests pass"],
}

describe("verify tool - unknown provenance", () => {
  test("#given changes the host cannot attribute #when the child requests verification #then it refuses and records nothing", async () => {
    const store = tempStore()
    const capture = createOrdinaryVerificationCapture({
      store,
      projectDir: process.cwd(),
      currentRevision: () => "rev-1",
    })
    const result = await createVerificationWorkerTool({
      capture,
      binding: () => ({ runId: "run-u", sessionId: "sess-u", epoch: 1 }),
      changedFiles: () => null,
      available: () => [PASSING],
    }).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_provenance_unknown")
    expect(result.details.records).toBe(0)
    expect(store.listVerifications("run-u")).toHaveLength(0)
  })
})
