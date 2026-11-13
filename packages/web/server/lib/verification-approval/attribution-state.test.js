import { describe, expect, it } from "vitest"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { resolveStateDir } from "../../../../omo-engine/senpi-task/src/store/state-dir"

import { createAttributionStateReader } from "./attribution-state"
import { createAttributionStateReader as fromRoutes } from "./routes"

const stateDirOf = () => "state"

function enoent() {
  const error = new Error("ENOENT")
  error.code = "ENOENT"
  return error
}

// In-memory fs: the reader resolves "state/tasks" through the injected resolver,
// so no test touches a real state directory.
function fakeFs(files, { present = true, unreadable = [] } = {}) {
  const tasksDir = join("state", "tasks")
  return {
    statSync(path) {
      if (!present || path !== tasksDir) throw enoent()
      return { isDirectory: () => true }
    },
    readdirSync(path) {
      if (!present || path !== tasksDir) throw enoent()
      return Object.keys(files)
    },
    readFileSync(path) {
      const name = basename(path)
      if (unreadable.includes(name)) {
        const error = new Error("EACCES")
        error.code = "EACCES"
        throw error
      }
      if (!(name in files)) throw enoent()
      return files[name]
    },
  }
}

const read = (files, options) =>
  createAttributionStateReader({ stateDirOf, fs: fakeFs(files, options) })({ directory: "project" })

const dagRecord = (taskId, childSessionId, nodeId, runId) =>
  JSON.stringify({ task_id: taskId, child_session_id: childSessionId, owner: { kind: "dag", runId, nodeId } })

describe("attribution state reader", () => {
  it("maps a dag-owned record in both directions", () => {
    const result = read({ "task-1.json": dagRecord("task-1", "sess-1", "build", "run-1") })

    expect(result).toEqual({
      absent: false,
      entries: [{ taskId: "task-1", childSessionId: "sess-1", nodeId: "build", runId: "run-1" }],
      byChildSessionId: { "sess-1": { taskId: "task-1", nodeId: "build", runId: "run-1" } },
      byTaskId: {
        "task-1": { taskId: "task-1", childSessionId: "sess-1", nodeId: "build", runId: "run-1" },
      },
      collisions: [],
    })
  })

  it("projects the persisted gate claim and fails closed for a completed record without one", () => {
    const result = read({
      "task-verified.json": JSON.stringify({ task_id: "task-verified", status: "completed", verification_status: "verified" }),
      "task-unclaimed.json": JSON.stringify({ task_id: "task-unclaimed", status: "completed" }),
      "task-blocked.json": JSON.stringify({ task_id: "task-blocked", status: "error", verification_status: "blocked" }),
      "task-running.json": JSON.stringify({ task_id: "task-running", status: "running" }),
    })

    expect(result.byTaskId["task-verified"].verificationStatus).toBe("verified")
    expect(result.byTaskId["task-unclaimed"].verificationStatus).toBe("unverified")
    expect(result.byTaskId["task-blocked"].verificationStatus).toBe("blocked")
    expect("verificationStatus" in result.byTaskId["task-running"]).toBe(false)
    expect(result.entries.find((entry) => entry.taskId === "task-blocked").verificationStatus).toBe("blocked")
  })

  it("treats an unknown persisted claim as absent and still fails closed for a completed record", () => {
    const result = read({
      "task-bogus.json": JSON.stringify({ task_id: "task-bogus", status: "completed", verification_status: "passed" }),
      "task-bogus-error.json": JSON.stringify({ task_id: "task-bogus-error", status: "error", verification_status: "passed" }),
    })

    expect(result.byTaskId["task-bogus"].verificationStatus).toBe("unverified")
    expect("verificationStatus" in result.byTaskId["task-bogus-error"]).toBe(false)
  })

  it("keeps an absent child session and node absent instead of fabricating one", () => {
    const result = read({
      "task-1.json": JSON.stringify({ task_id: "task-1", owner: { kind: "dag", runId: "run-1" } }),
    })

    expect("childSessionId" in result.byTaskId["task-1"]).toBe(false)
    expect("nodeId" in result.byTaskId["task-1"]).toBe(false)
    expect(result.byChildSessionId).toEqual({})
  })

  it("returns an explicit error for a malformed record, never an empty index", () => {
    const result = read({ "task-1.json": "{" })

    expect(result.error).toMatch(/malformed/)
    expect(result.entries).toBeUndefined()
    expect(result.byTaskId).toBeUndefined()
    expect(result.byChildSessionId).toBeUndefined()
  })

  it("returns an explicit error for an unreadable record", () => {
    const result = read({ "task-1.json": dagRecord("task-1", "sess-1", "build", "run-1") }, { unreadable: ["task-1.json"] })

    expect(result.error).toMatch(/unreadable/)
    expect(result.byTaskId).toBeUndefined()
  })

  it("reports two records claiming one child session instead of picking one", () => {
    const result = read({
      "task-1.json": dagRecord("task-1", "sess-1", "build", "run-1"),
      "task-2.json": dagRecord("task-2", "sess-1", "test", "run-1"),
    })

    expect(result.collisions).toEqual([{ childSessionId: "sess-1", taskIds: ["task-1", "task-2"] }])
    expect(result.byChildSessionId).toEqual({})
    expect(Object.keys(result.byTaskId).sort()).toEqual(["task-1", "task-2"])
  })

  it("contributes no node id for a record without a dag owner", () => {
    const result = read({
      "task-1.json": JSON.stringify({
        task_id: "task-1",
        child_session_id: "sess-1",
        owner: { kind: "team", runId: "run-1", nodeId: "build" },
      }),
    })

    expect(result.byTaskId["task-1"]).toEqual({ taskId: "task-1", childSessionId: "sess-1" })
    expect("nodeId" in result.byTaskId["task-1"]).toBe(false)
    expect(result.byChildSessionId["sess-1"]).toEqual({ taskId: "task-1" })
  })

  it("reports a missing task directory as absent, not as an error or a clean empty success", () => {
    const result = read({}, { present: false })

    expect(result).toEqual({ absent: true, entries: [], byChildSessionId: {}, byTaskId: {}, collisions: [] })
  })

  it("is re-exported from the verification bundle entry", () => {
    expect(fromRoutes).toBe(createAttributionStateReader)
  })
})

describe("attribution state directory authority", () => {
  it("finds attribution under a configured non-default task.state_dir", () => {
    const root = mkdtempSync(join(tmpdir(), "attribution-state-dir-"))
    const project = join(root, "project")
    const configured = join(root, "configured-state")
    try {
      mkdirSync(join(project, ".omo"), { recursive: true })
      writeFileSync(
        join(project, ".omo", "omo.jsonc"),
        JSON.stringify({ task: { state_dir: configured } }),
        "utf8",
      )
      mkdirSync(join(configured, "tasks"), { recursive: true })
      writeFileSync(
        join(configured, "tasks", "task-configured.json"),
        dagRecord("task-configured", "sess-configured", "build", "run-1"),
        "utf8",
      )

      // The record exists only under the configured directory. A reader that resolves the default
      // project state directory would answer `absent: true` with no entries.
      const result = createAttributionStateReader()({ directory: project })

      expect(result.error).toBeUndefined()
      expect(result.absent).toBe(false)
      expect(result.entries).toEqual([
        { taskId: "task-configured", childSessionId: "sess-configured", nodeId: "build", runId: "run-1" },
      ])
      expect(result.byTaskId["task-configured"]).toEqual({
        taskId: "task-configured",
        childSessionId: "sess-configured",
        nodeId: "build",
        runId: "run-1",
      })
      expect(configured).not.toBe(resolveStateDir({ project_dir: project }))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
