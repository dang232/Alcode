import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "bun:test"

import { createRunGraphRuntime } from "./runtime.js"
import { createTaskRecordStore } from "../../../../omo-engine/senpi-task/src/store/index"

const roots = []
const originalAgentDir = process.env.OMO_CODING_AGENT_DIR
const SESSION = "ses_reconcile_bundle_0001"
const TASK = "st_01a1d720"

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "run-graph-reconcile-"))
  roots.push(root)
  const project = join(root, "project")
  const agent = join(root, "agent")
  mkdirSync(project, { recursive: true })
  mkdirSync(join(agent, "projects"), { recursive: true })
  process.env.OMO_CODING_AGENT_DIR = agent
  return { project, agent }
}

function writeRecord(project, record) {
  const store = createTaskRecordStore({ project_dir: project })
  mkdirSync(join(store.stateDir, "tasks"), { recursive: true })
  writeFileSync(join(store.stateDir, "tasks", `${record.task_id}.json`), JSON.stringify(record), "utf8")
}

function chatOnlyDocument(project) {
  mkdirSync(join(project, ".omo", "dag-runs"), { recursive: true })
  writeFileSync(
    join(project, ".omo", "dag-runs", `${SESSION}.snapshot.json`),
    JSON.stringify({
      schemaVersion: 1,
      sessionId: SESSION,
      updatedAt: "2026-11-13T02:00:00.000Z",
      directory: project,
      dag: {
        runs: [
          {
            run_id: "ses_chat_0001",
            run_key: "chat:ses_chat_0001",
            name: "chat run",
            status: "completed",
            counts: { pending: 0, running: 0, completed: 1, failed: 0, cancelled: 0 },
            nodes: [{ id: "ses_child_0001", label: "child", state: "completed", attempt: 1, prompt: "p", depends_on: [], started_at: null, completed_at: null }],
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
  if (originalAgentDir === undefined) delete process.env.OMO_CODING_AGENT_DIR
  else process.env.OMO_CODING_AGENT_DIR = originalAgentDir
})

describe("run-graph reconciliation through the built bundle", () => {
  it("restores a delivery row erased by a whole-document replacement", async () => {
    const { project } = makeProject()
    writeRecord(project, { task_id: TASK, status: "completed", child_session_id: SESSION, verification_status: "verified" })
    chatOnlyDocument(project)

    const runtime = createRunGraphRuntime()
    const before = await runtime.readSnapshot(project, SESSION)
    expect(before.dag.runs).toHaveLength(1)

    const reconciled = await runtime.reconcileSnapshots(project)
    expect(reconciled.report.written).toBe(1)
    expect(reconciled.report.failures).toEqual([])

    const after = await runtime.readSnapshot(project, SESSION)
    expect(after.dag.runs).toHaveLength(2)
    const delivery = after.dag.runs.find((run) => run.run_id === TASK)
    expect(delivery).toBeDefined()
    expect(delivery.nodes[0].task_id).toBe(TASK)
    expect(delivery.nodes[0].delivery.status).toBe("completed")
    expect(delivery.nodes[0].delivery.verificationStatus).toBe("verified")

    const persisted = JSON.parse(readFileSync(join(project, ".omo", "dag-runs", `${SESSION}.snapshot.json`), "utf8"))
    expect(persisted.dag.runs).toHaveLength(2)
  })

  it("reports an error when the project directory is missing instead of writing anywhere", async () => {
    const runtime = createRunGraphRuntime()
    const result = await runtime.reconcileSnapshots(join(tmpdir(), "does-not-exist-alcode"))
    expect(result.error).toBeTruthy()
  })

  it("surfaces an unreadable task directory instead of reporting an empty success", async () => {
    const { project } = makeProject()
    const store = createTaskRecordStore({ project_dir: project })
    mkdirSync(store.stateDir, { recursive: true })
    rmSync(join(store.stateDir, "tasks"), { recursive: true, force: true })
    writeFileSync(join(store.stateDir, "tasks"), "not a directory", "utf8")

    const runtime = createRunGraphRuntime()
    const result = await runtime.reconcileSnapshots(project)
    expect(result.error).toBeTruthy()
    expect(result.report).toBeUndefined()
  })

  it("is idempotent through the bundle", async () => {
    const { project } = makeProject()
    writeRecord(project, { task_id: "st_01a1d721", status: "completed", child_session_id: SESSION })
    const runtime = createRunGraphRuntime()
    const first = await runtime.reconcileSnapshots(project)
    const second = await runtime.reconcileSnapshots(project)
    expect(first.report.written).toBe(1)
    expect(second.report.written).toBe(0)
    expect(second.report.skipped).toBe(1)
    const payload = await runtime.readSnapshot(project, SESSION)
    expect(payload.dag.runs).toHaveLength(1)
  })
})
