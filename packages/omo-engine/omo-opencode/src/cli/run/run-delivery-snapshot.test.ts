import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "bun:test"

import { parseSnapshotDoc } from "../../../../../extensions/dag-pane/panel/dag-view.ts"
import {
  DAG_RUNS_DIRNAME,
  DAG_SNAPSHOT_SCHEMA_VERSION,
  writeDeliverySnapshot,
  type DeliverySnapshotRecord,
} from "./run-delivery-snapshot"
import type { SnapshotDocument, SnapshotNode, SnapshotRun } from "./run-snapshot-store"

const roots: string[] = []

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-dag-snapshot-"))
  roots.push(root)
  return root
}

const SESSION = "ses_delivery_snapshot_0001"

function record(patch: Partial<DeliverySnapshotRecord> = {}): DeliverySnapshotRecord {
  return {
    task_id: "st_01a1d300",
    status: "completed",
    child_session_id: SESSION,
    name: "product run",
    task_summary: "direct run",
    model: "local-8317/al-1.4",
    started_at: "2026-11-12T23:39:07.634Z",
    terminal_at: "2026-11-12T23:39:19.259Z",
    ...patch,
  }
}

function snapshotPath(project: string, sessionId = SESSION): string {
  return join(project, ".omo", DAG_RUNS_DIRNAME, `${sessionId}.snapshot.json`)
}

// SAFETY: every read below targets a file this test wrote through writeDeliverySnapshot.
const readDoc = (project: string, sessionId = SESSION): SnapshotDocument =>
  JSON.parse(readFileSync(snapshotPath(project, sessionId), "utf8")) as SnapshotDocument

const rawDoc = (project: string, sessionId = SESSION): string =>
  readFileSync(snapshotPath(project, sessionId), "utf8")

const runsOf = (doc: SnapshotDocument): SnapshotRun[] => doc.dag.runs
const nodesOf = (run: SnapshotRun | undefined): SnapshotNode[] => run?.nodes ?? []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe("writeDeliverySnapshot", () => {
  it("writes one run and one node for a new delivery record", () => {
    const project = makeProject()
    const result = writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: record(), updatedAt: "2026-11-12T23:39:20.000Z" })
    expect(result.written).toBe(true)

    const doc = readDoc(project)
    expect(doc.schemaVersion).toBe(DAG_SNAPSHOT_SCHEMA_VERSION)
    expect(doc.sessionId).toBe(SESSION)
    const list = runsOf(doc)
    expect(list).toHaveLength(1)
    expect(list[0]?.run_id).toBe("st_01a1d300")
    const nodes = nodesOf(list[0])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.id).toBe(SESSION)
    expect(nodes[0]?.task_id).toBe("st_01a1d300")
    expect(nodes[0]?.state).toBe("completed")
  })

  it("keeps exactly one row and rewrites nothing when the same terminal record is ingested twice", () => {
    const project = makeProject()
    writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: record(), updatedAt: "2026-11-12T23:39:20.000Z" })
    const first = rawDoc(project)
    const second = writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: record(), updatedAt: "2026-11-12T23:40:00.000Z" })

    expect(second.written).toBe(false)
    expect(rawDoc(project)).toBe(first)
    const doc = readDoc(project)
    expect(runsOf(doc)).toHaveLength(1)
    const nodes = nodesOf(runsOf(doc)[0])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.state).toBe("completed")
    expect(nodes[0]?.task_id).toBe("st_01a1d300")
  })

  it("refuses an existing document it cannot read instead of overwriting it", () => {
    const project = makeProject()
    writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: record(), updatedAt: "2026-11-12T23:39:20.000Z" })
    const before = rawDoc(project)
    const unreadable = Object.assign(new Error("denied"), { code: "EACCES" })

    const result = writeDeliverySnapshot({
      directory: project,
      sessionId: SESSION,
      record: record({ status: "error" }),
      updatedAt: "2026-11-12T23:41:00.000Z",
      readFile: () => { throw unreadable },
    })

    expect(result.written).toBe(false)
    expect(rawDoc(project)).toBe(before)
  })

  it("never regresses a finished node when an older event arrives late", () => {
    const project = makeProject()
    writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: record(), updatedAt: "2026-11-12T23:40:00.000Z" })
    writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: record({ status: "running", terminal_at: undefined }), updatedAt: "2026-11-12T23:39:00.000Z" })

    const nodes = nodesOf(runsOf(readDoc(project))[0])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.state).toBe("completed")
  })

  it("advances a running row to its terminal state", () => {
    const project = makeProject()
    writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: record({ status: "running", terminal_at: undefined }), updatedAt: "2026-11-12T23:39:10.000Z" })
    writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: record({ status: "cancelled" }), updatedAt: "2026-11-12T23:39:30.000Z" })

    const nodes = nodesOf(runsOf(readDoc(project))[0])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.state).toBe("cancelled")
  })

  it("keeps an existing run graph identity and its nodes untouched", () => {
    const project = makeProject()
    mkdirSync(join(project, ".omo", DAG_RUNS_DIRNAME), { recursive: true })
    const existing = {
      schemaVersion: 1,
      sessionId: SESSION,
      updatedAt: "2026-11-12T20:00:00.000Z",
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
    }
    writeFileSync(snapshotPath(project), JSON.stringify(existing), "utf8")

    const result = writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: record(), updatedAt: "2026-11-12T23:39:20.000Z" })
    expect(result.written).toBe(true)

    const list = runsOf(readDoc(project))
    expect(list).toHaveLength(2)
    expect(list[0]?.run_id).toBe("ses_chat_0001")
    const keptNodes = nodesOf(list[0])
    expect(keptNodes[0]?.id).toBe("ses_child_0001")
    expect(list[1]?.run_id).toBe("st_01a1d300")
  })

  it("leaves a malformed document untouched and says so", () => {
    const project = makeProject()
    mkdirSync(join(project, ".omo", DAG_RUNS_DIRNAME), { recursive: true })
    writeFileSync(snapshotPath(project), "not json{", "utf8")

    const result = writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: record(), updatedAt: "2026-11-12T23:39:20.000Z" })
    expect(result.written).toBe(false)
    expect(rawDoc(project)).toBe("not json{")
  })

  it("leaves a foreign-schema document untouched", () => {
    const project = makeProject()
    mkdirSync(join(project, ".omo", DAG_RUNS_DIRNAME), { recursive: true })
    const foreign = JSON.stringify({ schemaVersion: 2, sessionId: SESSION, dag: { runs: [] } })
    writeFileSync(snapshotPath(project), foreign, "utf8")

    const result = writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: record(), updatedAt: "2026-11-12T23:39:20.000Z" })
    expect(result.written).toBe(false)
    expect(rawDoc(project)).toBe(foreign)
  })

  it("maps cancelled, interrupted, lost and running records to distinct states", () => {
    const cases: Array<[string, string]> = [
      ["cancelled", "cancelled"],
      ["interrupted", "cancelled"],
      ["lost", "failed"],
      ["error", "failed"],
      ["running", "running"],
      ["pending", "pending"],
    ]
    for (const [status, expected] of cases) {
      const project = makeProject()
      const sessionId = `ses_state_${status}`
      writeDeliverySnapshot({ directory: project, sessionId, record: record({ status, child_session_id: sessionId }), updatedAt: "2026-11-12T23:39:20.000Z" })
      const nodes = nodesOf(runsOf(readDoc(project, sessionId))[0])
      expect(nodes[0]?.state).toBe(expected)
    }
  })

  it("rejects an unsafe session id instead of escaping the runs directory", () => {
    const project = makeProject()
    const result = writeDeliverySnapshot({ directory: project, sessionId: "../escape", record: record(), updatedAt: "2026-11-12T23:39:20.000Z" })
    expect(result.written).toBe(false)
  })

  it("produces a document the DAG panel parser accepts", () => {
    const project = makeProject()
    writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: record(), updatedAt: "2026-11-12T23:39:20.000Z" })

    const outcome = parseSnapshotDoc(JSON.parse(rawDoc(project)))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error.field)
    expect(outcome.view.sessionId).toBe(SESSION)
    expect(outcome.view.runs).toHaveLength(1)
    const run = outcome.view.runs[0]
    expect(run?.runId).toBe("st_01a1d300")
    expect(run?.nodes).toHaveLength(1)
    expect(run?.nodes[0]?.id).toBe(SESSION)
    expect(run?.nodes[0]?.taskId).toBe("st_01a1d300")
    expect(run?.nodes[0]?.state).toBe("completed")
  })

  it("reconstructs the identical document from disk after a restart", () => {
    const project = makeProject()
    writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: record(), updatedAt: "2026-11-12T23:39:20.000Z" })
    const before = rawDoc(project)
    const rebuilt = parseSnapshotDoc(JSON.parse(before))
    const second = writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: record(), updatedAt: "2026-11-12T23:39:20.000Z" })
    expect(second.written).toBe(false)
    const after = rawDoc(project)
    expect(after).toBe(before)
    const replayed = parseSnapshotDoc(JSON.parse(after))
    expect(rebuilt.ok).toBe(true)
    expect(replayed.ok).toBe(true)
    if (!rebuilt.ok || !replayed.ok) throw new Error("parser rejected the reconstructed document")
    expect(replayed.view.runs).toHaveLength(rebuilt.view.runs.length)
    expect(runsOf(readDoc(project))).toHaveLength(1)
  })
})
