import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "bun:test"

import { reconcileRunSnapshots } from "./run-delivery-reconcile"
import type { SnapshotRun } from "./run-snapshot-store"
import { writeDeliverySnapshot } from "./run-delivery-snapshot"

const roots: string[] = []
const SESSION = "ses_reconcile_0001"

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-reconcile-"))
  roots.push(root)
  return root
}

type RecordFixture = {
  task_id: string
  status: string
  child_session_id?: string
  verification_status?: string
  final_response?: string
}

function makeStateDir(records: RecordFixture[]): string {
  const stateDir = join(makeProject(), "state")
  mkdirSync(join(stateDir, "tasks"), { recursive: true })
  for (const record of records) {
    writeFileSync(join(stateDir, "tasks", `${String(record.task_id)}.json`), JSON.stringify(record), "utf8")
  }
  return stateDir
}

function writeDeliveryEvent(stateDir: string, taskId: string, exitCode: number): void {
  mkdirSync(join(stateDir, "logs"), { recursive: true })
  const line = JSON.stringify({ type: "run_delivery", payload: { exitCode, durationMs: 1, changedFiles: [] } })
  writeFileSync(join(stateDir, "logs", `${taskId}.jsonl`), `${line}\n`, "utf8")
}

function snapshotPath(project: string, sessionId = SESSION): string {
  return join(project, ".omo", "dag-runs", `${sessionId}.snapshot.json`)
}

function runs(project: string, sessionId = SESSION): SnapshotRun[] {
  const doc = JSON.parse(readFileSync(snapshotPath(project, sessionId), "utf8"))
  return doc.dag?.runs ?? []
}

function chatOnlyDocument(project: string, sessionId = SESSION): void {
  mkdirSync(join(project, ".omo", "dag-runs"), { recursive: true })
  writeFileSync(
    snapshotPath(project, sessionId),
    JSON.stringify({
      schemaVersion: 1,
      sessionId,
      updatedAt: "2026-11-13T01:00:00.000Z",
      directory: project,
      dag: {
        runs: [
          {
            run_id: "ses_chat_0001",
            run_key: "chat:ses_chat_0001",
            name: "chat run",
            status: "completed",
            counts: { pending: 0, running: 0, completed: 1, failed: 0, cancelled: 0 },
            nodes: [
              { id: "ses_child_0001", label: "child", state: "completed", attempt: 1, prompt: "p", depends_on: [], started_at: null, completed_at: null },
            ],
            edges: [],
            waves: [{ index: 0, node_ids: ["ses_child_0001"] }],
          },
        ],
      },
      tasks: null,
    }),
    "utf8",
  )
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe("reconcileRunSnapshots", () => {
  it("restores a delivery row after another writer replaced the whole document", () => {
    const project = makeProject()
    const stateDir = makeStateDir([
      { task_id: "st_01a1d700", status: "completed", child_session_id: SESSION, verification_status: "verified", exit_code: 0 },
    ])
    chatOnlyDocument(project)
    expect(runs(project)).toHaveLength(1)

    const report = reconcileRunSnapshots({ directory: project, stateDir, updatedAt: "2026-11-13T01:05:00.000Z" })

    expect(report.scanned).toBe(1)
    expect(report.written).toBe(1)
    expect(report.failures).toEqual([])
    const after = runs(project)
    expect(after).toHaveLength(2)
    expect(after[0]?.run_id).toBe("ses_chat_0001")
    expect(after[1]?.run_id).toBe("st_01a1d700")
    const nodes = after[1]?.nodes
    expect(nodes[0]?.task_id).toBe("st_01a1d700")
    expect(nodes[0]?.state).toBe("completed")
    expect(nodes[0]?.verification_status).toBe("verified")
  })

  it("is idempotent: a second pass writes nothing and adds no row", () => {
    const project = makeProject()
    const stateDir = makeStateDir([
      { task_id: "st_01a1d701", status: "completed", child_session_id: SESSION },
    ])
    const first = reconcileRunSnapshots({ directory: project, stateDir, updatedAt: "2026-11-13T01:05:00.000Z" })
    const second = reconcileRunSnapshots({ directory: project, stateDir, updatedAt: "2026-11-13T01:06:00.000Z" })
    expect(first.written).toBe(1)
    expect(second.written).toBe(0)
    expect(second.skipped).toBe(1)
    expect(runs(project)).toHaveLength(1)
  })

  it("does not regress a terminal row that a late record would overwrite", () => {
    const project = makeProject()
    const stateDir = makeStateDir([{ task_id: "st_01a1d702", status: "running", child_session_id: SESSION }])
    writeDeliverySnapshot({
      directory: project,
      sessionId: SESSION,
      updatedAt: "2026-11-13T01:00:00.000Z",
      record: { task_id: "st_01a1d702", status: "completed", child_session_id: SESSION },
    })

    const report = reconcileRunSnapshots({ directory: project, stateDir, updatedAt: "2026-11-13T01:07:00.000Z" })

    expect(report.written).toBe(0)
    expect(report.failures.length).toBe(1)
    const nodes = runs(project)[0]?.nodes
    expect(nodes[0]?.state).toBe("completed")
  })

  it("reports an error when the task directory is not readable as a directory", () => {
    const project = makeProject()
    const stateDir = join(makeProject(), "state-broken")
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, "tasks"), "not a directory", "utf8")
    const report = reconcileRunSnapshots({ directory: project, stateDir, updatedAt: "2026-11-13T01:10:00.000Z" })
    expect(report.error).toBeTruthy()
    expect(report.scanned).toBe(0)
    expect(report.written).toBe(0)
  })

  it("reports a corrupt record file as a failure instead of silence", () => {
    const project = makeProject()
    const stateDir = makeStateDir([{ task_id: "st_01a1d705", status: "completed", child_session_id: SESSION }])
    writeFileSync(join(stateDir, "tasks", "st_corrupt.json"), "not json{", "utf8")
    const report = reconcileRunSnapshots({ directory: project, stateDir, updatedAt: "2026-11-13T01:11:00.000Z" })
    expect(report.written).toBe(1)
    expect(report.failures).toEqual([{ taskId: "st_corrupt.json", reason: "record file is not valid JSON" }])
  })

  it("treats a non-zero exit recorded only in final_response as failed without inventing a code", () => {
    const project = makeProject()
    const stateDir = makeStateDir([
      { task_id: "st_01a1d706", status: "completed", child_session_id: SESSION, final_response: "completed with non-zero exit" },
    ])
    reconcileRunSnapshots({ directory: project, stateDir, updatedAt: "2026-11-13T01:12:00.000Z" })
    const nodes = runs(project)[0]?.nodes
    expect(nodes[0]?.state).toBe("failed")
    expect(nodes[0]?.["exit_code"]).toBeUndefined()
  })

  it("reports a record that names no session instead of silently skipping it", () => {
    const project = makeProject()
    const stateDir = makeStateDir([{ task_id: "st_01a1d703", status: "completed" }])
    const report = reconcileRunSnapshots({ directory: project, stateDir, updatedAt: "2026-11-13T01:08:00.000Z" })
    expect(report.written).toBe(0)
    expect(report.failures).toEqual([{ taskId: "st_01a1d703", reason: "record names no child session" }])
  })

  it("fails a non-zero exit even though the record's lifecycle completed", () => {
    const project = makeProject()
    const stateDir = makeStateDir([
      { task_id: "st_01a1d704", status: "completed", child_session_id: SESSION, verification_status: "unverified" },
    ])
    writeDeliveryEvent(stateDir, "st_01a1d704", 3)
    reconcileRunSnapshots({ directory: project, stateDir, updatedAt: "2026-11-13T01:09:00.000Z" })
    const nodes = runs(project)[0]?.nodes
    expect(nodes[0]?.state).toBe("failed")
    expect(nodes[0]?.["exit_code"]).toBe(3)
    expect(nodes[0]?.verification_status).toBe("unverified")
  })
})
