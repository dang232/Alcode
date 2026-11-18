import { afterAll, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseTaskId } from "../../../../senpi-task/src/state/id"
import { createTaskRecordStore } from "../../../../senpi-task/src/store/index"
import {
  buildRunDeliveryInput,
  createRunDeliveryRecorder,
  shouldRecordRunDelivery,
} from "./run-delivery-record"

const roots: string[] = []
const originalAgentDir = process.env.OMO_CODING_AGENT_DIR

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-run-delivery-"))
  roots.push(root)
  return root
}

function useAgentDir(root: string): string {
  const agentDir = join(root, "agent")
  mkdirSync(agentDir, { recursive: true })
  process.env.OMO_CODING_AGENT_DIR = agentDir
  return agentDir
}

function makeProject(root: string): string {
  const project = join(root, "project")
  mkdirSync(project, { recursive: true })
  return project
}

const baseFacts = {
  sessionId: "ses_delivery_test",
  agent: "build",
  model: { providerID: "local-8317", modelID: "al-1.4" },
  strategy: "high-assurance",
  graphLevel: 3,
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  if (originalAgentDir === undefined) delete process.env.OMO_CODING_AGENT_DIR
  else process.env.OMO_CODING_AGENT_DIR = originalAgentDir
})

describe("buildRunDeliveryInput", () => {
  it("maps run facts onto the engine record input with no run content", () => {
    const root = makeRoot()
    const input = buildRunDeliveryInput({ ...baseFacts, directory: makeProject(root) })

    expect(Object.keys(input).sort()).toEqual([
      "agent_type",
      "depth",
      "execution_mode",
      "model",
      "name",
      "notify_on_terminal",
      "parent_session_id",
      "root_session_id",
      "task_summary",
    ])
    expect(input.parent_session_id).toBe("ses_delivery_test")
    expect(input.root_session_id).toBe("ses_delivery_test")
    expect(input.depth).toBe(0)
    expect(input.execution_mode).toBe("process")
    expect(input.model).toBe("local-8317/al-1.4")
    expect(input.agent_type).toBe("build")
    expect(input.notify_on_terminal).toBe(false)
  })

  it("records an unspecified model rather than inventing one", () => {
    const root = makeRoot()
    const input = buildRunDeliveryInput({
      sessionId: "ses_no_model",
      directory: makeProject(root),
      agent: "build",
      strategy: "direct",
      graphLevel: 0,
    })
    expect(input.model).toBe("unspecified")
  })
})

describe("shouldRecordRunDelivery", () => {
  it("records only product runs unless the flag overrides", () => {
    expect(shouldRecordRunDelivery({ OMO_PRODUCT_RUN: "1" })).toBe(true)
    expect(shouldRecordRunDelivery({})).toBe(false)
    expect(shouldRecordRunDelivery({ OMO_RUN_DELIVERY_RECORD: "on" })).toBe(true)
    expect(
      shouldRecordRunDelivery({ OMO_PRODUCT_RUN: "1", OMO_RUN_DELIVERY_RECORD: "OFF" }),
    ).toBe(false)
    expect(shouldRecordRunDelivery({ OMO_RUN_DELIVERY_RECORD: "  On  " })).toBe(true)
  })
})

describe("createRunDeliveryRecorder", () => {
  it("writes one record pending -> running -> completed and logs the delivery facts", async () => {
    const root = makeRoot()
    useAgentDir(root)
    const project = makeProject(root)
    const recorder = createRunDeliveryRecorder({ directory: project })
    const store = createTaskRecordStore({ project_dir: project })

    expect(store.stateDir).toBe(recorder.stateDir)

    const started = recorder.start({ ...baseFacts, directory: project })
    expect(started.written).toBe(true)
    if (!started.written) throw new Error(started.reason)

    const running = store.load(parseTaskId(started.taskId))
    expect(running?.status).toBe("running")
    expect(running?.child_session_id).toBe("ses_delivery_test")
    expect(running !== null && Object.hasOwn(running, "verification_status")).toBe(false)

    const finished = await recorder.finish({
      sessionId: "ses_delivery_test",
      exitCode: 0,
      durationMs: 1234,
      changedPaths: ["src/a.ts", "src/b.ts"],
    })
    expect(finished.written).toBe(true)

    const record = store.load(parseTaskId(started.taskId))
    expect(record?.status).toBe("completed")
    expect(record?.final_response).toBe("completed")
    expect(record?.verification_status).toBe("unverified")

    const log = readFileSync(join(recorder.stateDir, "logs", `${started.taskId}.jsonl`), "utf8")
    expect(log).toContain("run_delivery")
    expect(log).toContain("src/a.ts")
    expect(log).toContain("1234")
  })

  it("records a failure as error with a bounded message and never throws", () => {
    const root = makeRoot()
    useAgentDir(root)
    const project = makeProject(root)
    const recorder = createRunDeliveryRecorder({ directory: project })
    const store = createTaskRecordStore({ project_dir: project })

    const started = recorder.start({ ...baseFacts, directory: project })
    if (!started.written) throw new Error(started.reason)

    const failed = recorder.fail(new Error("x".repeat(600)))
    expect(failed.written).toBe(true)

    const record = store.load(parseTaskId(started.taskId))
    expect(record?.status).toBe("error")
    expect(record?.error_message?.length).toBe(512)
  })

  it("projects a failed run into the session snapshot as a failed node", () => {
    const root = makeRoot()
    useAgentDir(root)
    const project = makeProject(root)
    const recorder = createRunDeliveryRecorder({ directory: project })

    const started = recorder.start({ ...baseFacts, directory: project })
    if (!started.written) throw new Error(started.reason)
    const failed = recorder.fail(new Error("boom"))
    expect(failed.written).toBe(true)

    const snapPath = join(project, ".omo", "dag-runs", `${baseFacts.sessionId}.snapshot.json`)
    expect(existsSync(snapPath)).toBe(true)
    const doc = JSON.parse(readFileSync(snapPath, "utf8"))
    expect(doc.dag.runs).toHaveLength(1)
    expect(doc.dag.runs[0].run_id).toBe(started.taskId)
    expect(doc.dag.runs[0].nodes[0].state).toBe("failed")
    expect(doc.dag.runs[0].nodes[0].task_id).toBe(started.taskId)
  })

  it("returns a result union instead of throwing when the state dir is unusable", async () => {
    const root = makeRoot()
    writeFileSync(join(root, "blocker"), "not a directory")
    process.env.OMO_CODING_AGENT_DIR = join(root, "blocker", "agent")
    const project = makeProject(root)
    const recorder = createRunDeliveryRecorder({ directory: project })

    const started = recorder.start({ ...baseFacts, directory: project })
    expect(started.written).toBe(false)

    const finished = await recorder.finish({ sessionId: "ses_unusable", exitCode: 0, durationMs: 1, changedPaths: [] })
    expect(finished.written).toBe(false)
  })
})

describe("execution outcome lifecycle", () => {
  it("records a non-zero exit as a failed lifecycle, keeping the exit code and verification separate", async () => {
    const root = makeRoot()
    useAgentDir(root)
    const project = makeProject(root)
    const recorder = createRunDeliveryRecorder({ directory: project })
    const started = recorder.start({ ...baseFacts, directory: project })
    expect(started.written).toBe(true)
    if (!started.written) return

    const finished = await recorder.finish({
      sessionId: baseFacts.sessionId,
      exitCode: 1,
      durationMs: 25,
      changedPaths: [],
    })
    expect(finished.written).toBe(true)
    if (!finished.written) return

    const store = createTaskRecordStore({ project_dir: project })
    const record = store.load(parseTaskId(finished.taskId))
    expect(record?.status).toBe("error")
    expect(record?.error_message ?? "").toContain("code 1")
    expect(["verified", "unverified", "blocked"]).toContain(record?.verification_status ?? "missing")

    const snapshotPath = join(project, ".omo", "dag-runs", baseFacts.sessionId + ".snapshot.json")
    const doc = JSON.parse(readFileSync(snapshotPath, "utf8"))
    const node = doc.dag.runs[0].nodes[0]
    expect(node.state).toBe("failed")
    expect(node.exit_code).toBe(1)
  }, 30000)

  it("records a zero exit as a completed lifecycle", async () => {
    const root = makeRoot()
    useAgentDir(root)
    const project = makeProject(root)
    const recorder = createRunDeliveryRecorder({ directory: project })
    const started = recorder.start({ ...baseFacts, sessionId: "ses_delivery_zero", directory: project })
    if (!started.written) throw new Error("record not started")
    const finished = await recorder.finish({ sessionId: "ses_delivery_zero", exitCode: 0, durationMs: 7, changedPaths: [] })
    expect(finished.written).toBe(true)
    if (!finished.written) return
    const store = createTaskRecordStore({ project_dir: project })
    expect(store.load(parseTaskId(finished.taskId))?.status).toBe("completed")
  }, 30000)
})

describe("publication failure is not a task failure", () => {
  it("keeps the record lifecycle when the snapshot cannot be published", async () => {
    const root = makeRoot()
    useAgentDir(root)
    const project = makeProject(root)
    const runsDir = join(project, ".omo", "dag-runs")
    mkdirSync(runsDir, { recursive: true })
    // An unreadable document (a directory where the file belongs) makes the
    // projection refuse; that must stay a publication error, never a failure.
    mkdirSync(join(runsDir, "ses_publication_fail.snapshot.json"), { recursive: true })
    const recorder = createRunDeliveryRecorder({ directory: project })
    const started = recorder.start({ ...baseFacts, sessionId: "ses_publication_fail", directory: project })
    if (!started.written) throw new Error("record not started")
    const finished = await recorder.finish({ sessionId: "ses_publication_fail", exitCode: 0, durationMs: 5, changedPaths: [] })
    expect(finished.written).toBe(true)
    if (!finished.written) return
    expect(finished.snapshotWritten).toBe(false)
    const store = createTaskRecordStore({ project_dir: project })
    expect(store.load(parseTaskId(finished.taskId))?.status).toBe("completed")
  }, 30000)
})
