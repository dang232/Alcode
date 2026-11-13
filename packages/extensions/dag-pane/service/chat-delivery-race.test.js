// Cross-process proof that the chat route and the delivery projector share one
// protocol: real child processes, the shipped handler and the engine writer,
// racing on one snapshot file.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "bun:test"

const roots = []
const SESSION = "ses_chat_delivery_race_0001"

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "dag-chat-delivery-race-"))
  roots.push(root)
  return root
}

function chatChild(root) {
  const path = join(root, "chat-child.mjs")
  writeFileSync(path, [
    `import * as nodeFs from "node:fs"`,
    `import { createDagServiceHandlers } from "file:///I:/migration/Alwork/packages/extensions/dag-pane/service/handlers.js"`,
    `const [directory, sessionId, runId] = process.argv.slice(2)`,
    `const handlers = createDagServiceHandlers({ fs: nodeFs, snapshotDir: process.env.SNAP_DIR, attributionStateReader: () => ({ index: undefined, skipped: "race" }), createBridge: () => ({ probe: async () => ({ available: false }), invoke: () => { throw new Error("unused") } }) })`,
    `const run = { run_id: runId, run_key: runId, name: runId, status: "completed", nodes: [], edges: [], waves: [] }`,
    `const snapshot = { schemaVersion: 1, sessionId, status: "completed", updatedAt: new Date().toISOString(), dag: { runs: [run] } }`,
    `const response = await handlers.handleRequest({ method: "POST", path: "/snapshot", body: { directory, conversationId: sessionId, snapshot } })`,
    `console.log(JSON.stringify({ status: response.status, body: response.body }))`,
  ].join("\n"), "utf8")
  return path
}

function deliveryChild(root) {
  const path = join(root, "delivery-child.mjs")
  writeFileSync(path, [
    `import { writeDeliverySnapshot } from "file:///I:/migration/Alwork/packages/omo-engine/omo-opencode/src/cli/run/run-delivery-snapshot.ts"`,
    `const [directory, sessionId, taskId] = process.argv.slice(2)`,
    `const result = writeDeliverySnapshot({ directory, sessionId, record: { task_id: taskId, status: "completed", child_session_id: sessionId, verification_status: "verified", exit_code: 0 }, updatedAt: new Date().toISOString() })`,
    `console.log(JSON.stringify(result))`,
  ].join("\n"), "utf8")
  return path
}

async function runChild(script, args, env) {
  const proc = Bun.spawn([process.execPath, script, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } })
  const [o, e] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code: await proc.exited, out: (o + e).trim() }
}

function runsOf(project) {
  const file = join(project, ".omo", "dag-runs", `${SESSION}.snapshot.json`)
  if (!existsSync(file)) return []
  return JSON.parse(readFileSync(file, "utf8")).dag.runs
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe("chat route and delivery projector across processes", () => {
  it("loses no delivery row when chat posts race delivery writes", async () => {
    const root = makeRoot()
    const project = join(root, "project")
    const snapDir = join(root, "service-snapshots")
    mkdirSync(project, { recursive: true })
    const chat = chatChild(root)
    const delivery = deliveryChild(root)

    const taskIds = ["st_race_chat_1", "st_race_chat_2", "st_race_chat_3", "st_race_chat_4"]
    const chats = ["chat-run-a", "chat-run-b"]
    const results = await Promise.all([
      ...taskIds.map((task) => runChild(delivery, [project, SESSION, task], {})),
      ...chats.map((run) => runChild(chat, [project, SESSION, run], { SNAP_DIR: snapDir })),
    ])

    expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0])
    const runs = runsOf(project)
    const ids = runs.map((run) => run.run_id)
    for (const task of taskIds) {
      expect(ids.filter((id) => id === task)).toHaveLength(1)
    }
    const chatRows = runs.filter((run) => run.source === "chat")
    expect(chatRows).toHaveLength(1)
    const deliveryRows = runs.filter((run) => run.source !== "chat")
    expect(deliveryRows).toHaveLength(taskIds.length)
  }, 120000)
})
