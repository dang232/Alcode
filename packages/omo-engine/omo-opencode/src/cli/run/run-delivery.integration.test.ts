import { afterAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { run } from "./runner"
import { createTaskRecordStore } from "../../../../senpi-task/src/store/index"

type JsonBody = string | number | boolean | null | JsonBody[] | { [key: string]: JsonBody }
type SnapshotRecord = { task_id?: string; status?: string }

const SESSION_ID = "ses_stub_delivery_0001"

type Seen = { method: string; path: string }

const roots: string[] = []
const servers: Array<{ stop: () => void }> = []
const originalAgentDir = process.env.OMO_CODING_AGENT_DIR
const originalFlag = process.env.OMO_RUN_DELIVERY_RECORD

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-run-delivery-int-"))
  roots.push(root)
  return root
}

function jsonResponse(body: JsonBody, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function sseFrame(payload: JsonBody): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
}

function startStub(sessionId: string = SESSION_ID) {
  const seen: Seen[] = []
  let sink: ReadableStreamDefaultController<Uint8Array> | null = null
  let promptSeen = false

  const emitRunEvents = () => {
    if (sink === null) return
    sink.enqueue(sseFrame({ type: "session.text.delta", data: { sessionID: SESSION_ID, assistantMessageID: "msg_stub_1", ordinal: 0, delta: "stubbed work" } }))
  }

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const url = new URL(request.url)
      seen.push({ method: request.method, path: url.pathname })

      if (url.pathname === "/api/event") {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            sink = controller
            if (promptSeen) emitRunEvents()
          },
          cancel() {
            sink = null
          },
        })
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        })
      }

      if (request.method === "POST" && url.pathname === "/api/session") {
        return jsonResponse({ data: { id: sessionId, title: "stub" } })
      }

      if (request.method === "POST" && url.pathname === `/api/session/${sessionId}/prompt`) {
        await request.text()
        promptSeen = true
        emitRunEvents()
        return jsonResponse({ data: { status: "accepted" } })
      }

      if (request.method === "POST" && url.pathname.startsWith(`/api/session/${sessionId}/`)) {
        await request.text().catch(() => "")
        promptSeen = true
        emitRunEvents()
        return jsonResponse({ data: {} })
      }

      if (request.method === "GET" && url.pathname === "/api/agent") {
        return jsonResponse({ data: [] })
      }

      if (request.method === "GET" && url.pathname === "/api/session/active") {
        return jsonResponse({ data: {} })
      }

      if (request.method === "GET" && url.pathname === `/api/session/${sessionId}/message`) {
        return jsonResponse({ data: promptSeen ? [{ id: "msg_stub_1", role: "assistant" }] : [] })
      }

      if (request.method === "GET" && url.pathname === `/api/session/${sessionId}`) {
        return jsonResponse({ data: { id: sessionId, title: "stub" } })
      }

      return new Response("", { status: 200 })
    },
  })

  servers.push({ stop: () => server.stop(true) })
  return { baseUrl: `http://127.0.0.1:${server.port}`, seen }
}

function recordsIn(stateDir: string): SnapshotRecord[] {
  const tasksDir = join(stateDir, "tasks")
  let names: string[] = []
  try {
    names = readdirSync(tasksDir).filter((name) => name.endsWith(".json"))
  } catch {
    return []
  }
  // SAFETY: every file here was written by the delivery recorder this test drives.
  return names.map((name) => JSON.parse(readFileSync(join(tasksDir, name), "utf8")) as SnapshotRecord)
}

function prepareRun(label: string) {
  const root = makeRoot()
  const evidenceRoot = process.env.OMO_DELIVERY_EVIDENCE_DIR
  const agentDir = evidenceRoot ? join(evidenceRoot, "agent") : join(root, "agent")
  const project = evidenceRoot ? join(evidenceRoot, "project") : join(root, label)
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(project, { recursive: true })
  process.env.OMO_CODING_AGENT_DIR = agentDir
  const stateDir = createTaskRecordStore({ project_dir: project }).stateDir
  if (evidenceRoot) rmSync(stateDir, { recursive: true, force: true })
  return { project, stateDir }
}

afterAll(() => {
  for (const server of servers) server.stop()
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  if (originalAgentDir === undefined) delete process.env.OMO_CODING_AGENT_DIR
  else process.env.OMO_CODING_AGENT_DIR = originalAgentDir
  if (originalFlag === undefined) delete process.env.OMO_RUN_DELIVERY_RECORD
  else process.env.OMO_RUN_DELIVERY_RECORD = originalFlag
})

describe("run() delivery record against a stubbed host", () => {
  it("records one task through the engine store and terminates it when the run completes", async () => {
    process.env.OMO_RUN_DELIVERY_RECORD = "on"
    const { project, stateDir } = prepareRun("project")
    const stub = startStub()

    const exitCode = await run({
      message: "stubbed run proving the delivery record",
      attach: stub.baseUrl,
      directory: project,
      json: true,
    })

    const seenPaths = stub.seen.map((entry) => `${entry.method} ${entry.path}`)
    expect(seenPaths).toContain("POST /api/session")
    expect(seenPaths.some((path) => path.startsWith(`POST /api/session/${SESSION_ID}/`))).toBe(true)
    expect(exitCode).toBe(0)

    const records = recordsIn(stateDir)
    expect(records).toHaveLength(1)
    const record = records[0] ?? {}
    expect(record["child_session_id"]).toBe(SESSION_ID)
    expect(record["parent_session_id"]).toBe(SESSION_ID)
    expect(record["root_session_id"]).toBe(SESSION_ID)
    expect(record["status"]).toBe("completed")
    expect(record["final_response"]).toBe("completed")
    expect(record["verification_status"]).toBe("unverified")
    expect(record.task_id).toEqual(expect.any(String))

    const evidenceDir = process.env.OMO_DELIVERY_EVIDENCE_DIR
    if (evidenceDir !== undefined) {
      writeFileSync(join(evidenceDir, "c1-record.json"), JSON.stringify(record, null, 1))
    }
  }, 40000)

  it("writes nothing when the delivery-record flag is off", async () => {
    process.env.OMO_RUN_DELIVERY_RECORD = "off"
    const { project, stateDir } = prepareRun("project-off")
    const offSession = "ses_stub_delivery_off_0002"
    const stub = startStub(offSession)

    const exitCode = await run({
      message: "stubbed run with recording disabled",
      attach: stub.baseUrl,
      directory: project,
      json: true,
    })

    expect(exitCode).toBe(0)
    expect(recordsIn(stateDir)).toHaveLength(0)
    expect(
      stub.seen.some((entry) => entry.method === "POST" && entry.path.startsWith(`/api/session/${offSession}/`)),
    ).toBe(true)
  }, 40000)
})
