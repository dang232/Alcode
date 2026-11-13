import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "bun:test"

import { createRunGraphRuntime } from "./runtime.js"
import { createDeliveryStateReader } from "../verification-approval/delivery-state.js"

const roots = []

function makeStateDir() {
  const root = mkdtempSync(join(tmpdir(), "run-graph-delivery-"))
  roots.push(root)
  mkdirSync(join(root, "tasks"), { recursive: true })
  return root
}

function writeRecord(stateDir, taskId, record) {
  writeFileSync(join(stateDir, "tasks", `${taskId}.json`), JSON.stringify(record), "utf8")
}

function readerFor(stateDir) {
  return createDeliveryStateReader({ stateDirOf: () => stateDir })
}

function makeProject(doc) {
  const root = mkdtempSync(join(tmpdir(), "run-graph-project-"))
  roots.push(root)
  mkdirSync(join(root, ".omo", "dag-runs"), { recursive: true })
  writeFileSync(join(root, ".omo", "dag-runs", `${doc.sessionId}.snapshot.json`), JSON.stringify(doc), "utf8")
  return root
}

function snapshotWith(node) {
  return {
    schemaVersion: 1,
    sessionId: "ses_delivery_0001",
    updatedAt: "2026-11-13T00:00:00.000Z",
    directory: ".",
    dag: {
      runs: [
        {
          run_id: "st_01a1d500",
          run_key: "delivery:st_01a1d500",
          name: "product run",
          status: "completed",
          counts: { pending: 0, running: 0, completed: 1, failed: 0, cancelled: 0 },
          nodes: [node],
          edges: [],
          waves: [{ index: 0, node_ids: [node.id] }],
        },
      ],
    },
    tasks: null,
  }
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe("createDeliveryStateReader", () => {
  it("returns the record's status and verification claim as separate fields", () => {
    const stateDir = makeStateDir()
    writeRecord(stateDir, "st_01a1d500", { task_id: "st_01a1d500", status: "completed", verification_status: "verified", child_session_id: "ses_x", updated_at: "2026-11-13T00:00:00.000Z" })
    const result = readerFor(stateDir)({ directory: "I:/project", taskId: "st_01a1d500" })
    expect(result.delivery.status).toBe("completed")
    expect(result.delivery.verificationStatus).toBe("verified")
    expect(result.delivery.childSessionId).toBe("ses_x")
  })

  it("never turns an unknown verification value into a claim", () => {
    const stateDir = makeStateDir()
    writeRecord(stateDir, "st_01a1d501", { task_id: "st_01a1d501", status: "completed", verification_status: "approved" })
    const result = readerFor(stateDir)({ directory: "I:/project", taskId: "st_01a1d501" })
    expect(result.delivery.verificationStatus).toBeNull()
  })

  it("passes blocked and unverified claims through and reads a missing claim as null", () => {
    const stateDir = makeStateDir()
    writeRecord(stateDir, "st_blocked", { task_id: "st_blocked", status: "completed", verification_status: "blocked" })
    writeRecord(stateDir, "st_unverified", { task_id: "st_unverified", status: "completed", verification_status: "unverified" })
    writeRecord(stateDir, "st_unclaimed", { task_id: "st_unclaimed", status: "completed" })
    const read = (taskId) => readerFor(stateDir)({ directory: "I:/project", taskId })
    expect(read("st_blocked").delivery.verificationStatus).toBe("blocked")
    expect(read("st_unverified").delivery.verificationStatus).toBe("unverified")
    expect(read("st_unclaimed").delivery.verificationStatus).toBeNull()
  })

  it("reports a missing record as absent, not as a delivery", () => {
    const stateDir = makeStateDir()
    const result = readerFor(stateDir)({ directory: "I:/project", taskId: "st_missing" })
    expect(result.absent).toBe(true)
    expect(result.delivery).toBeUndefined()
  })

  it("rejects an unsafe task id and a missing status", () => {
    const stateDir = makeStateDir()
    writeRecord(stateDir, "st_01a1d502", { task_id: "st_01a1d502" })
    expect(readerFor(stateDir)({ directory: "I:/project", taskId: "../escape" }).error).toBeTruthy()
    expect(readerFor(stateDir)({ directory: "I:/project", taskId: "st_01a1d502" }).error).toBeTruthy()
  })
})

describe("run-graph delivery enrichment", () => {
  it("attaches the authoritative delivery to the node that names its task", async () => {
    const doc = snapshotWith({ id: "ses_delivery_0001", label: "run", state: "completed", attempt: 1, prompt: "p", depends_on: [], started_at: null, completed_at: null, task_id: "st_01a1d500" })
    const project = makeProject(doc)
    const runtime = createRunGraphRuntime({
      readRepairState: () => ({}),
      readAttributionState: () => ({ absent: true }),
      readDeliveryState: ({ taskId }) => ({ delivery: { taskId, status: "completed", verificationStatus: "verified" } }),
    })
    const enriched = await runtime.readSnapshot(project, "ses_delivery_0001")
    const node = enriched.dag.runs[0].nodes[0]
    expect(node.delivery.taskId).toBe("st_01a1d500")
    expect(node.delivery.verificationStatus).toBe("verified")
    expect(node.state).toBe("completed")
  })

  it("reports a reader failure instead of an empty delivery", async () => {
    const doc = snapshotWith({ id: "ses_delivery_0001", label: "run", state: "completed", attempt: 1, prompt: "p", depends_on: [], started_at: null, completed_at: null, task_id: "st_01a1d500" })
    const project = makeProject(doc)
    const runtime = createRunGraphRuntime({
      readRepairState: () => ({}),
      readAttributionState: () => ({ absent: true }),
      readDeliveryState: () => ({ error: "store unreadable" }),
    })
    const enriched = await runtime.readSnapshot(project, "ses_delivery_0001")
    expect(enriched.dag.runs[0].nodes[0].deliveryError).toBe("store unreadable")
    expect(enriched.dag.runs[0].nodes[0].delivery).toBeUndefined()
  })

  it("leaves a node without a task id untouched", async () => {
    const doc = snapshotWith({ id: "ses_child", label: "child", state: "completed", attempt: 1, prompt: "p", depends_on: [], started_at: null, completed_at: null })
    const project = makeProject(doc)
    const runtime = createRunGraphRuntime({
      readRepairState: () => ({}),
      readAttributionState: () => ({ absent: true }),
      readDeliveryState: () => {
        throw new Error("must not be called")
      },
    })
    const enriched = await runtime.readSnapshot(project, "ses_delivery_0001")
    expect(enriched.dag.runs[0].nodes[0].delivery).toBeUndefined()
    expect(enriched.dag.runs[0].nodes[0].deliveryError).toBeUndefined()
  })
})
