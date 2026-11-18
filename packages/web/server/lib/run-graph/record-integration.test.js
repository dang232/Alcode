import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createRecordTaskReader } from "./record-tasks"
import { createRunGraphRuntime } from "./runtime"

const roots = []

const project = () => {
  const root = mkdtempSync(join(tmpdir(), "r1-12-graph-"))
  roots.push(root)
  return root
}

const seedRecord = (root, record) => {
  const directory = join(root, "state", "tasks")
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `${record.task_id}.json`), JSON.stringify(record), "utf8")
}

const seedSnapshot = (root, conversationId, snapshot) => {
  const directory = join(root, ".omo", "dag-runs")
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `${conversationId}.snapshot.json`), JSON.stringify(snapshot), "utf8")
}

const taskRecord = (taskId, extra = {}) => ({
  task_id: taskId,
  status: "running",
  parent_session_id: "ses_1",
  root_session_id: "ses_1",
  created_at: "2026-11-15T00:00:00.000Z",
  ...extra,
})

const runtimeFor = (root, overrides = {}) =>
  createRunGraphRuntime({
    readRecordTasks: createRecordTaskReader({ stateDirOf: () => join(root, "state"), cache: false }),
    readRepairState: () => ({}),
    readAttributionState: () => ({ absent: true, entries: [], byChildSessionId: {}, byTaskId: {}, collisions: [] }),
    readDeliveryState: (input) => input,
    ...overrides,
  })

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("one graph from snapshots and canonical records", () => {
  it("adds the canonical record beside the snapshot's own task", async () => {
    const root = project()
    seedSnapshot(root, "ses_1", { sessionId: "ses_1", tasks: { tasks: [{ task_id: "task_snapshot", node_id: "n1" }] }, dag: { runs: [] } })
    seedRecord(root, taskRecord("st_record"))

    const document = await runtimeFor(root).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks.map((task) => task.task_id)).toEqual(["task_snapshot", "st_record"])
  })

  it("answers a task that has no snapshot at all", async () => {
    const root = project()
    seedRecord(root, taskRecord("st_only_record", { status: "completed", verification_status: "unverified" }))

    const document = await runtimeFor(root).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks).toHaveLength(1)
    expect(document.tasks.tasks[0]).toMatchObject({ task_id: "st_only_record", status: "completed", verification_status: "unverified" })
    expect(document.dag.runs).toEqual([])
  })

  it("keeps a snapshot that has no record", async () => {
    const root = project()
    seedSnapshot(root, "ses_1", { sessionId: "ses_1", tasks: { tasks: [{ task_id: "task_only_snapshot", node_id: "n1" }] }, dag: { runs: [] } })

    const document = await runtimeFor(root).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks).toEqual([{ task_id: "task_only_snapshot", node_id: "n1" }])
  })

  it("links a task to the child session the snapshot already rendered", async () => {
    const root = project()
    seedSnapshot(root, "ses_1", { sessionId: "ses_1", tasks: { tasks: [] }, dag: { runs: [{ run_key: "chat:1", nodes: [{ id: "child-ses" }] }] } })
    seedRecord(root, taskRecord("st_child", { child_session_id: "child-ses" }))

    const document = await runtimeFor(root, {
      readAttributionState: () => ({
        absent: false,
        entries: [],
        byChildSessionId: { "child-ses": { taskId: "st_child", nodeId: "n7" } },
        byTaskId: { st_child: { nodeId: "n7" } },
        collisions: [],
      }),
    }).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks).toHaveLength(1)
    expect(document.tasks.tasks[0]).toMatchObject({ task_id: "st_child", child_session_id: "child-ses", node_id: "n7" })
    expect(document.dag.runs[0].nodes[0]).toMatchObject({ id: "child-ses", task_id: "st_child", node_id: "n7" })
  })

  it("keeps two tasks from one parent distinct", async () => {
    const root = project()
    seedRecord(root, taskRecord("st_a", { created_at: "2026-11-15T00:00:01.000Z" }))
    seedRecord(root, taskRecord("st_b", { created_at: "2026-11-15T00:00:02.000Z" }))

    const document = await runtimeFor(root).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks.map((task) => task.task_id)).toEqual(["st_a", "st_b"])
  })

  it("never shows another project's tasks", async () => {
    const mine = project()
    const theirs = project()
    seedRecord(mine, taskRecord("st_mine"))
    seedRecord(theirs, taskRecord("st_theirs"))

    const document = await runtimeFor(mine).readSnapshot(mine, "ses_1")
    const other = await runtimeFor(theirs).readSnapshot(theirs, "ses_1")

    expect(document.tasks.tasks.map((task) => task.task_id)).toEqual(["st_mine"])
    expect(other.tasks.tasks.map((task) => task.task_id)).toEqual(["st_theirs"])
  })

  it("keeps another conversation in the same project out of this graph", async () => {
    const root = project()
    seedRecord(root, taskRecord("st_mine", { parent_session_id: "ses_1", root_session_id: "ses_1" }))
    seedRecord(root, taskRecord("st_foreign", { parent_session_id: "ses_2", root_session_id: "ses_2" }))

    const document = await runtimeFor(root).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks.map((task) => task.task_id)).toEqual(["st_mine"])
  })

  it("keeps another conversation out even when this one already has a snapshot", async () => {
    const root = project()
    seedSnapshot(root, "ses_1", { sessionId: "ses_1", tasks: { tasks: [] }, dag: { runs: [] } })
    seedRecord(root, taskRecord("st_mine", { parent_session_id: "ses_1", root_session_id: "ses_1" }))
    seedRecord(root, taskRecord("st_foreign", { parent_session_id: "ses_2", root_session_id: "ses_2" }))

    const document = await runtimeFor(root).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks.map((task) => task.task_id)).toEqual(["st_mine"])
  })
})

describe("lifecycle, verification and repair stay separate", () => {
  it("keeps a completed task completed across a refresh", async () => {
    const root = project()
    seedRecord(root, taskRecord("st_done", { status: "completed", verification_status: "unverified" }))
    const runtime = runtimeFor(root)

    const first = await runtime.readSnapshot(root, "ses_1")
    const second = await runtime.readSnapshot(root, "ses_1")

    expect(first.tasks.tasks[0].status).toBe("completed")
    expect(second.tasks.tasks).toEqual(first.tasks.tasks)
  })

  it("never shows a failed task as a success", async () => {
    const root = project()
    seedRecord(root, taskRecord("st_failed", { status: "error", error_message: "provider refused" }))

    const document = await runtimeFor(root).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks[0]).toMatchObject({ status: "error", error_message: "provider refused", verification_status: "unverified" })
  })

  it("lets the canonical outcome beat a stale completed snapshot row", async () => {
    const root = project()
    seedSnapshot(root, "ses_1", { sessionId: "ses_1", tasks: { tasks: [{ task_id: "st_1", status: "completed", node_id: "n1" }] }, dag: { runs: [] } })
    seedRecord(root, taskRecord("st_1", { status: "error", error_message: "provider refused" }))

    const document = await runtimeFor(root).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks[0]).toMatchObject({ task_id: "st_1", status: "error", node_id: "n1" })
  })

  it("projects the repair attempt of a record-only task", async () => {
    const root = project()
    seedRecord(root, taskRecord("st_repair", { status: "error" }))

    const document = await runtimeFor(root, {
      readRepairState: ({ taskId }) =>
        taskId === "st_repair"
          ? { repair: { attemptId: "a1", taskId, state: "repaired", verificationStatus: "verified" } }
          : {},
    }).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks[0].repair).toMatchObject({ attemptId: "a1", state: "repaired" })
    expect(document.tasks.tasks[0].status).toBe("error")
  })

  it("projects the repair attempt of a record-only task beside a snapshot", async () => {
    const root = project()
    seedSnapshot(root, "ses_1", { sessionId: "ses_1", tasks: { tasks: [] }, dag: { runs: [] } })
    seedRecord(root, taskRecord("st_repair", { status: "error" }))

    const document = await runtimeFor(root, {
      readRepairState: ({ taskId }) => (taskId === "st_repair" ? { repair: { attemptId: "a2", taskId, state: "applying" } } : {}),
    }).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks[0].repair).toMatchObject({ attemptId: "a2", state: "applying" })
  })

  it("reports a repair store it could not read instead of looking un-repaired", async () => {
    const root = project()
    seedRecord(root, taskRecord("st_repair_error"))

    const document = await runtimeFor(root, {
      readRepairState: () => ({ error: "repair store unreadable" }),
    }).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks[0].repairError).toBe("repair store unreadable")
    expect(document.tasks.tasks[0].repair).toBeUndefined()
  })
})

describe("restart, determinism and failure", () => {
  it("does not duplicate a task when a runtime is recreated", async () => {
    const root = project()
    seedRecord(root, taskRecord("st_1", { status: "completed" }))
    seedRecord(root, taskRecord("st_2", { status: "running" }))

    const first = await runtimeFor(root).readSnapshot(root, "ses_1")
    const afterRestart = await runtimeFor(root).readSnapshot(root, "ses_1")

    expect(afterRestart.tasks.tasks.map((task) => task.task_id)).toEqual(["st_1", "st_2"])
    expect(afterRestart.tasks.tasks).toEqual(first.tasks.tasks)
  })

  it("answers byte-identical documents on repeated reads", async () => {
    const root = project()
    seedRecord(root, taskRecord("st_b", { created_at: "2026-11-15T00:00:02.000Z" }))
    seedRecord(root, taskRecord("st_a", { created_at: "2026-11-15T00:00:01.000Z" }))
    const runtime = runtimeFor(root)

    expect(JSON.stringify(await runtime.readSnapshot(root, "ses_1"))).toBe(JSON.stringify(await runtime.readSnapshot(root, "ses_1")))
  })

  it("survives an unreadable record and still serves the rest", async () => {
    const root = project()
    seedRecord(root, taskRecord("st_good", { status: "completed" }))
    writeFileSync(join(root, "state", "tasks", "st_broken.json"), "{ not json", "utf8")

    const document = await runtimeFor(root).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks.map((task) => task.task_id)).toEqual(["st_good"])
    expect(document.tasks.diagnostics.malformed[0].file).toBe("st_broken.json")
  })

  it("publishes a torn record as a diagnostic, never as a task", async () => {
    const root = project()
    seedRecord(root, taskRecord("st_stable", { status: "completed" }))
    const path = join(root, "state", "tasks", "st_torn.json")
    seedRecord(root, taskRecord("st_torn", { status: "completed" }))
    const full = readFileSync(path, "utf8")
    writeFileSync(path, full.slice(0, Math.floor(full.length / 2)), "utf8")

    const document = await runtimeFor(root).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks.map((task) => task.task_id)).toEqual(["st_stable"])
    expect(document.tasks.diagnostics.malformed.map((entry) => entry.file)).toContain("st_torn.json")
  })

  it("picks up an atomic publication on the next read", async () => {
    const root = project()
    seedRecord(root, taskRecord("st_1", { status: "running" }))
    const runtime = runtimeFor(root)
    expect((await runtime.readSnapshot(root, "ses_1")).tasks.tasks[0].status).toBe("running")

    const target = join(root, "state", "tasks", "st_1.json")
    const staging = join(root, "state", "tasks", "st_1.json.staging")
    writeFileSync(staging, JSON.stringify(taskRecord("st_1", { status: "completed" })), "utf8")
    renameSync(staging, target)

    expect((await runtime.readSnapshot(root, "ses_1")).tasks.tasks[0].status).toBe("completed")
  })

  it("says so when the record store could not be read at all", async () => {
    const root = project()
    seedSnapshot(root, "ses_1", { sessionId: "ses_1", tasks: { tasks: [{ task_id: "task_snapshot" }] }, dag: { runs: [] } })

    const document = await runtimeFor(root, { readRecordTasks: () => ({ error: "store unreadable" }) }).readSnapshot(root, "ses_1")

    expect(document.tasks.tasks).toEqual([{ task_id: "task_snapshot" }])
    expect(document.tasks.recordError).toBe("store unreadable")
  })

  it("marks a project with no record store instead of claiming zero tasks", async () => {
    const root = project()
    seedSnapshot(root, "ses_1", { sessionId: "ses_1", tasks: { tasks: [] }, dag: { runs: [] } })

    const document = await runtimeFor(root).readSnapshot(root, "ses_1")

    expect(document.tasks.recordAbsent).toBe(true)
  })

  it("corrects the node claim the panel paints from the record that ran it", async () => {
    const root = project()
    seedSnapshot(root, "ses_1", {
      sessionId: "ses_1",
      tasks: { tasks: [{ task_id: "st_1" }] },
      dag: { runs: [{ run_id: "r1", run_key: "chat:1", nodes: [{ id: "n1", task_id: "st_1", state: "completed", verification_status: "verified" }] }] },
    })
    seedRecord(root, taskRecord("st_1", { status: "completed", verification_status: "unverified" }))

    const document = await runtimeFor(root).readSnapshot(root, "ses_1")

    expect(document.dag.runs[0].nodes[0]).toMatchObject({ verification_status: "unverified", state: "completed" })
    expect(document.tasks.tasks[0].verification_status).toBe("unverified")
  })

  it("still answers 404 when neither source knows the conversation", async () => {
    const root = project()

    expect(await runtimeFor(root).readSnapshot(root, "ses_1")).toMatchObject({ error: "no run snapshot for conversation: ses_1", status: 404, code: "DAG_SNAPSHOT_MISSING" })
  })

  it("does not call an unreadable store a missing conversation", async () => {
    const root = project()

    const result = await runtimeFor(root, { readRecordTasks: () => ({ error: "record tasks unreadable: EACCES" }) }).readSnapshot(root, "ses_1")

    expect(result).toMatchObject({ error: "record tasks unreadable: EACCES", status: 500, code: "DAG_TASK_STORE_UNREADABLE" })
  })

  it("does not call a truncated store a missing conversation", async () => {
    const root = project()
    const rows = [taskRecord("st_1", { parent_session_id: "ses_1", root_session_id: "ses_1" })]

    const result = await runtimeFor(root, {
      readRecordTasks: () => ({ tasks: rows, absent: false, diagnostics: { scanned: 5000, accepted: 1, skipped: 0, limitReached: true } }),
    }).readSnapshot(root, "ses_other")

    expect(result.status).toBe(503)
    expect(result.error).toContain("truncated")
  })

  it("hands back the reader's diagnostics with the document", async () => {
    const root = project()
    seedRecord(root, taskRecord("st_1"))
    writeFileSync(join(root, "state", "tasks", "bad.json"), "[]", "utf8")

    const document = await runtimeFor(root).readSnapshot(root, "ses_1")

    expect(document.tasks.diagnostics).toMatchObject({ scanned: 2, accepted: 1, skipped: 1 })
    expect(document.tasks.diagnostics.malformed).toEqual([{ file: "bad.json", reason: "not a JSON object" }])
  })
})
