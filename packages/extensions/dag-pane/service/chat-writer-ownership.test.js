// Proves the ownership-table claims against the REAL chat writer in this
// package: `POST /snapshot` replaces the whole project run document, and the
// delivery projection is what makes a delivery row survive that replacement.
// The writer here is the shipped handler, not a simulation of it.
import * as nodeFs from "node:fs"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "bun:test"

import { createDagServiceHandlers } from "./handlers.js"
import { writeDeliverySnapshot } from "../../../omo-engine/omo-opencode/src/cli/run/run-delivery-snapshot.ts"
import { reconcileRunSnapshots } from "../../../omo-engine/omo-opencode/src/cli/run/run-delivery-reconcile.ts"

const roots = []
const SESSION = "ses_chat_writer_ownership_0001"
const TASK = "st_01a1d900"
const UPDATED_AT = "2026-11-13T02:20:00.000Z"

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "dag-chat-writer-"))
  roots.push(root)
  return root
}

function handlersFor(root) {
  return createDagServiceHandlers({
    fs: nodeFs,
    snapshotDir: join(root, "service-snapshots"),
    attributionStateReader: () => ({ index: undefined, skipped: "test" }),
    createBridge: () => ({ probe: async () => ({ available: false }), invoke: () => { throw new Error("not used") } }),
  })
}

function chatDocument() {
  return {
    schemaVersion: 1,
    sessionId: SESSION,
    status: "completed",
    updatedAt: UPDATED_AT,
    dag: {
      runs: [
        {
          run_id: "chat-run-1",
          run_key: "chat-run-1",
          name: "chat turn",
          status: "completed",
          nodes: [{ node_id: "chat-node-1", state: "completed", title: "chat turn" }],
          tasks: [{ task_id: "chat-task-1", state: "completed" }],
        },
      ],
    },
  }
}

function runsOf(project) {
  const doc = JSON.parse(readFileSync(join(project, ".omo", "dag-runs", `${SESSION}.snapshot.json`), "utf8"))
  return doc.dag.runs
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe("the shipped chat writer and the delivery projection", () => {
  it("merges the chat document into the shared file instead of replacing it", async () => {
    const root = makeRoot()
    const project = join(root, "project")
    mkdirSync(join(project, ".omo", "dag-runs"), { recursive: true })

    const delivery = writeDeliverySnapshot({
      directory: project,
      sessionId: SESSION,
      record: {
        task_id: TASK,
        status: "completed",
        child_session_id: SESSION,
        verification_status: "verified",
        exit_code: 0,
      },
      updatedAt: UPDATED_AT,
    })
    expect(delivery.written).toBe(true)
    expect(runsOf(project).map((run) => run.run_id)).toEqual([TASK])

    const response = await handlersFor(root).handleRequest({
      method: "POST",
      path: "/snapshot",
      query: { directory: project },
      body: { directory: project, conversationId: SESSION, snapshot: chatDocument() },
    })
    expect(response.body.ok, JSON.stringify(response.body)).toBe(true)

    const afterChatWrite = runsOf(project)
    // The chat route used to erase the delivery row; the shared merge keeps it
    // and adds the chat row beside it, tagged with its writer.
    const deliveryRow = afterChatWrite.find((run) => run.run_id === TASK)
    expect(deliveryRow).toBeDefined()
    expect(deliveryRow.nodes[0].state).toBe("completed")
    expect(deliveryRow.nodes[0].verification_status).toBe("verified")
    const chatRow = afterChatWrite.find((run) => run.run_id === "chat-run-1")
    expect(chatRow?.source).toBe("chat")

    const reposted = await handlersFor(root).handleRequest({
      method: "POST",
      path: "/snapshot",
      query: { directory: project },
      body: { directory: project, conversationId: SESSION, snapshot: chatDocument() },
    })
    expect(reposted.body.written).toBe(false)
    expect(reposted.body.reason).toBe("unchanged")
    expect(runsOf(project).filter((run) => run.run_id === TASK)).toHaveLength(1)
    expect(runsOf(project).filter((run) => run.run_id === "chat-run-1")).toHaveLength(1)
  }, 30000)

  it("refuses to overwrite a document it cannot read", async () => {
    const root = makeRoot()
    const project = join(root, "project")
    mkdirSync(join(project, ".omo", "dag-runs"), { recursive: true })
    const path = join(project, ".omo", "dag-runs", `${SESSION}.snapshot.json`)
    writeFileSync(path, "{ this is not json", "utf8")

    const result = writeDeliverySnapshot({
      directory: project,
      sessionId: SESSION,
      record: { task_id: TASK, status: "completed", child_session_id: SESSION },
      updatedAt: UPDATED_AT,
    })
    expect(result.written).toBe(false)
    expect(readFileSync(path, "utf8")).toBe("{ this is not json")
  })
})

describe('chat post collision with a delivery row', () => {
  it('keeps the delivery row when a posted chat run reuses its id', async () => {
    const root = makeRoot()
    const project = join(root, 'project')
    mkdirSync(join(project, '.omo', 'dag-runs'), { recursive: true })
    writeDeliverySnapshot({ directory: project, sessionId: SESSION, record: { task_id: TASK, status: 'completed', child_session_id: SESSION, verification_status: 'verified' }, updatedAt: UPDATED_AT })
    const doc = chatDocument()
    doc.dag.runs[0].run_id = TASK
    doc.dag.runs[0].run_key = TASK
    const response = await handlersFor(root).handleRequest({ method: 'POST', path: '/snapshot', query: { directory: project }, body: { directory: project, conversationId: SESSION, snapshot: doc } })
    expect(response.body.ok, JSON.stringify(response.body)).toBe(true)
    const runs = runsOf(project)
    const deliveryRow = runs.filter((run) => run.run_id === TASK)
    expect(deliveryRow).toHaveLength(1)
    expect(deliveryRow[0].source).not.toBe('chat')
    expect(deliveryRow[0].nodes[0].verification_status).toBe('verified')
  }, 30000)
})
