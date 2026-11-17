import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { createRunGraphRuntime } from "./runtime"

const roots = []

function project(snapshot) {
  const root = mkdtempSync(join(tmpdir(), "run-graph-records-"))
  roots.push(root)
  mkdirSync(join(root, ".omo", "dag-runs"), { recursive: true })
  if (snapshot !== undefined) {
    writeFileSync(join(root, ".omo", "dag-runs", "ses_1.snapshot.json"), JSON.stringify(snapshot), "utf8")
  }
  return root
}

const emptyDecorators = {
  readRepairState: () => ({}),
  readAttributionState: () => ({ absent: true, entries: [], byChildSessionId: {}, byTaskId: {}, collisions: [] }),
  readDeliveryState: (input) => input,
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("run graph reads canonical task records", () => {
  it("adds a task that exists only as a record to the snapshot's task list", async () => {
    const directory = project({ sessionId: "ses_1", tasks: { tasks: [] } })
    const runtime = createRunGraphRuntime({
      ...emptyDecorators,
      readRecordTasks: () => ({ tasks: [{ task_id: "task_record_only", status: "completed", parent_session_id: "ses_1" }], absent: false }),
    })

    const document = await runtime.readSnapshot(directory, "ses_1")

    expect(document.tasks.tasks).toEqual([{ task_id: "task_record_only", status: "completed", parent_session_id: "ses_1" }])
  })

  it("never merges another conversation's records into this one", async () => {
    const directory = project({ sessionId: "ses_1", tasks: { tasks: [] } })
    const runtime = createRunGraphRuntime({
      ...emptyDecorators,
      readRecordTasks: () => ({
        tasks: [
          { task_id: "task_other", status: "completed", parent_session_id: "ses_other" },
          { task_id: "task_mine", status: "running", parent_session_id: "ses_1" },
        ],
        absent: false,
      }),
    })

    const document = await runtime.readSnapshot(directory, "ses_1")

    expect(document.tasks.tasks.map((task) => task.task_id)).toEqual(["task_mine"])
  })

  it("leaves the document untouched when the record reader reports an error", async () => {
    const directory = project({ sessionId: "ses_1", tasks: { tasks: [{ task_id: "task_snapshot" }] } })
    const runtime = createRunGraphRuntime({
      ...emptyDecorators,
      readRecordTasks: () => ({ error: "store unreadable" }),
    })

    const document = await runtime.readSnapshot(directory, "ses_1")

    expect(document.tasks.tasks).toEqual([{ task_id: "task_snapshot" }])
  })

  it("does not invent rows when no record reader is wired", async () => {
    const directory = project({ sessionId: "ses_1", tasks: { tasks: [] } })
    const runtime = createRunGraphRuntime({ ...emptyDecorators })

    const document = await runtime.readSnapshot(directory, "ses_1")

    expect(document.tasks.tasks).toEqual([])
  })
})

describe("a project with records and no snapshot", () => {
  it("answers the record rows instead of 404", async () => {
    const directory = project(undefined)
    const runtime = createRunGraphRuntime({
      ...emptyDecorators,
      readRecordTasks: () => ({ tasks: [{ task_id: "task_record_only", status: "running", parent_session_id: "ses_1" }], absent: false }),
    })

    const document = await runtime.readSnapshot(directory, "ses_1")

    expect(document.tasks.tasks).toEqual([{ task_id: "task_record_only", status: "running", parent_session_id: "ses_1" }])
    expect(document.tasks.parent_session_id).toBe("ses_1")
    expect(document.dag.runs).toEqual([])
  })

  it("keeps the 404 when there is neither a snapshot nor a record", async () => {
    const directory = project(undefined)
    const runtime = createRunGraphRuntime({ ...emptyDecorators, readRecordTasks: () => ({ tasks: [], absent: true }) })

    const result = await runtime.readSnapshot(directory, "ses_1")

    expect(result).toMatchObject({ error: "no run snapshot for conversation: ses_1", status: 404, code: "DAG_SNAPSHOT_MISSING" })
  })
})

describe("record precedence over a stale snapshot row", () => {
  it("the record outvotes a stale snapshot row for execution fields but not for topology", async () => {
    const directory = project({
      sessionId: "ses_1",
      tasks: { tasks: [{ task_id: "task_shared", status: "running", parent_session_id: "ses_1", node_id: "n1", title: "from snapshot" }] },
    })
    const runtime = createRunGraphRuntime({
      ...emptyDecorators,
      readRecordTasks: () => ({
        tasks: [{ task_id: "task_shared", status: "completed", parent_session_id: "ses_1", model: "local-8317/al-1.4", terminal_at: "2026-11-14T14:00:00.000Z" }],
        absent: false,
      }),
    })

    const document = await runtime.readSnapshot(directory, "ses_1")
    const row = document.tasks.tasks[0]

    expect(document.tasks.tasks).toHaveLength(1)
    expect(row.status).toBe("completed")
    expect(row.model).toBe("local-8317/al-1.4")
    expect(row.terminal_at).toBe("2026-11-14T14:00:00.000Z")
    expect(row.node_id).toBe("n1")
    expect(row.title).toBe("from snapshot")
  })
})

describe("per-field provenance", () => {
  it("records where each contract field came from and marks the rest absent", async () => {
    const directory = project({
      sessionId: "ses_1",
      tasks: { tasks: [{ task_id: "task_shared", status: "running", name: "from snapshot", node_id: "n1" }] },
    })
    const runtime = createRunGraphRuntime({
      ...emptyDecorators,
      readRecordTasks: () => ({
        tasks: [{ task_id: "task_shared", status: "completed", parent_session_id: "ses_1", model: "local-8317/al-1.4" }],
        absent: false,
      }),
    })

    const document = await runtime.readSnapshot(directory, "ses_1")
    const provenance = document.tasks.provenance?.task_shared

    expect(provenance).toBeDefined()
    expect(provenance.status).toBe("record")
    expect(provenance.parent_session_id).toBe("record")
    expect(provenance.name).toBe("snapshot")
    expect(provenance.error_message).toBe("absent")
    expect(provenance.node_id).toBeUndefined()
  })
})

describe("conversation membership", () => {
  it("membership follows root, parent and child session", async () => {
    const directory = project({ sessionId: "ses_1", tasks: { tasks: [] } })
    const runtime = createRunGraphRuntime({
      ...emptyDecorators,
      readRecordTasks: () => ({
        tasks: [
          { task_id: "t_parent", status: "running", parent_session_id: "ses_1" },
          { task_id: "t_root", status: "running", root_session_id: "ses_1", parent_session_id: "ses_other" },
          { task_id: "t_child", status: "running", child_session_id: "ses_1" },
          { task_id: "t_foreign", status: "running", parent_session_id: "ses_other", root_session_id: "ses_other" },
        ],
        absent: false,
      }),
    })

    const document = await runtime.readSnapshot(directory, "ses_1")

    expect(document.tasks.tasks.map((task) => task.task_id).sort()).toEqual(["t_child", "t_parent", "t_root"])
  })
  it("corrects a node's stale verified claim after attribution attaches the task id", async () => {
    // The shape the review found: a chat node written before its child finished, so it carries the
    // snapshot's optimistic "verified" and no task_id. Attribution supplies the id afterwards; the claim
    // must then come from the record, never from the snapshot.
    const directory = project({
      schemaVersion: 1,
      sessionId: "ses_1",
      dag: { runs: [{ run_id: "ses_1", run_key: "chat:ses_1", name: "run", status: "completed", nodes: [
        { id: "childA", label: "child", state: "completed", prompt: "p", depends_on: [], verification_status: "verified" },
      ] }] },
      tasks: { tasks: [] },
    })
    const runtime = createRunGraphRuntime({
      readRepairState: () => ({}),
      readAttributionState: () => ({ absent: false, entries: [], byChildSessionId: { childA: { taskId: "st_a" } }, byTaskId: {}, collisions: [] }),
      readDeliveryState: (input) => input,
      readRecordTasks: () => ({
        tasks: [{ task_id: "st_a", status: "completed", parent_session_id: "ses_1", child_session_id: "childA", verification_status: "unverified" }],
        absent: false,
      }),
    })

    const document = await runtime.readSnapshot(directory, "ses_1")

    const node = document.dag.runs[0].nodes[0]
    expect(node.task_id).toBe("st_a")
    expect(node.verification_status).toBe("unverified")
    expect(document.tasks.tasks[0].verification_status).toBe("unverified")
  })
  it("keeps the run graph parseable when the record store cannot be read", async () => {
    // The shape the review found: a snapshot document whose container is null, plus a failed store read.
    // Keeping only a flag would leave the container without an array, and both clients reject a document
    // whose `tasks` has no list - erasing a complete graph over a side store failure.
    const directory = project({
      schemaVersion: 1,
      sessionId: "ses_1",
      dag: { runs: [{ run_id: "ses_1", run_key: "chat:ses_1", name: "run", status: "running", nodes: [] }] },
      tasks: null,
    })
    const runtime = createRunGraphRuntime({
      ...emptyDecorators,
      readRecordTasks: () => ({ error: "record tasks unreadable: EACCES" }),
    })

    const document = await runtime.readSnapshot(directory, "ses_1")

    expect(Array.isArray(document.tasks.tasks)).toBe(true)
    expect(document.tasks.tasks).toEqual([])
    expect(document.tasks.recordError).toBe("record tasks unreadable: EACCES")
    expect(document.dag.runs).toHaveLength(1)
  })

  it("keeps the run graph parseable when no record store exists yet", async () => {
    const directory = project({
      schemaVersion: 1,
      sessionId: "ses_1",
      dag: { runs: [{ run_id: "ses_1", run_key: "chat:ses_1", name: "run", status: "running", nodes: [] }] },
      tasks: null,
    })
    const runtime = createRunGraphRuntime({
      ...emptyDecorators,
      readRecordTasks: () => ({ tasks: [], absent: true }),
    })

    const document = await runtime.readSnapshot(directory, "ses_1")

    expect(document.tasks.tasks).toEqual([])
    expect(document.tasks.recordAbsent).toBe(true)
    expect(document.dag.runs).toHaveLength(1)
  })
})
