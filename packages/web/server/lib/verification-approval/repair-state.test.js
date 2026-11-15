import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { resolveStateDir } from "../../../../omo-engine/senpi-task/src/store/state-dir"

import { createRepairStateReader } from "./repair-state"

const TASK_ID = "task-configured-repair"
const roots = []

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "repair-state-dir-"))
  roots.push(root)
  const project = join(root, "project")
  const configured = join(root, "configured-state")
  mkdirSync(join(project, ".omo"), { recursive: true })
  writeFileSync(join(project, ".omo", "omo.jsonc"), JSON.stringify({ task: { state_dir: configured } }), "utf8")
  return { project, configured }
}

function writeAttempt({ configured, runEpoch }) {
  const attemptId = `${TASK_ID}.e${runEpoch}.r1`
  mkdirSync(join(configured, "tasks"), { recursive: true })
  writeFileSync(
    join(configured, "tasks", `${TASK_ID}.json`),
    JSON.stringify({
      task_id: TASK_ID,
      status: "error",
      verification_status: "unverified",
      notification: { run_epoch: runEpoch, notified_epoch: -1 },
      updated_at: "2026-11-14T00:00:00.000Z",
    }),
    "utf8",
  )
  mkdirSync(join(configured, "repairs", TASK_ID), { recursive: true })
  writeFileSync(
    join(configured, "repairs", TASK_ID, `${attemptId}.json`),
    JSON.stringify({
      attemptId,
      taskId: TASK_ID,
      runEpoch,
      workspaceId: "workspace-1",
      attemptNumber: 1,
      state: "repaired",
      failedCheckIds: ["unit"],
      failedEvidenceIds: ["unit.json"],
      diagnosisRevision: "rev-1",
      createdAt: 1,
      updatedAt: 2,
      plan: { summary: "fix the failing check", steps: ["edit src/a.ts", "rerun unit"], createdAt: 1 },
      outcome: { result: "repaired", detail: "changedFiles: src/a.ts", recordedAt: 2 },
    }),
    "utf8",
  )
  return attemptId
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("repair state directory authority", () => {
  it("finds repair attempts under a configured non-default task.state_dir", () => {
    const { project, configured } = workspace()
    const attemptId = writeAttempt({ configured, runEpoch: 3 })

    // The attempt lives only under the configured directory; resolving the default would report no repair.
    const result = createRepairStateReader()({ directory: project, taskId: TASK_ID })

    expect(result.error).toBeUndefined()
    expect(result.repair?.attemptId).toBe(attemptId)
    expect(result.repair?.epoch).toBe(3)
    expect(configured).not.toBe(resolveStateDir({ project_dir: project }))
  })

  it("reports no repair when the configured directory holds no attempt for this run", () => {
    const { project, configured } = workspace()
    writeAttempt({ configured, runEpoch: 3 })

    // The record's epoch moved to 9, so the epoch-3 attempt is stale and must not be shown.
    writeFileSync(
      join(configured, "tasks", `${TASK_ID}.json`),
      JSON.stringify({
        task_id: TASK_ID,
        status: "error",
        notification: { run_epoch: 9, notified_epoch: -1 },
        updated_at: "2026-11-14T00:00:00.000Z",
      }),
      "utf8",
    )

    const result = createRepairStateReader()({ directory: project, taskId: TASK_ID })

    expect(result.error).toBeUndefined()
    expect(result.repair).toBeUndefined()
  })
})
