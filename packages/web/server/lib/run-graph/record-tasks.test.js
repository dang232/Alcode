import { describe, expect, it } from "vitest"

import { createRecordTaskReader, mergeRecordTasks } from "./record-tasks"

const readerOver = (files, options = {}) =>
  createRecordTaskReader({
    stateDirOf: () => "state",
    fs: {
      readdirSync: () => {
        if (options.missing === true) {
          const error = new Error("ENOENT")
          error.code = "ENOENT"
          throw error
        }
        return Object.keys(files)
      },
      readFileSync: (path) => {
        if (options.unreadable === path) throw new Error("EACCES")
        const name = String(path).split(/[\\/]/).pop()
        if (!(name in files)) throw new Error("ENOENT")
        return files[name]
      },
    },
  })({ directory: "project" })

const record = (taskId, status = "running", extra = {}) =>
  JSON.stringify({ task_id: taskId, status, ...extra })

describe("record task reader", () => {
  it("returns a row per canonical record and skips non-record files", () => {
    const result = readerOver({
      "task_1.json": record("task_1", "completed", { name: "build", task_summary: "did the thing" }),
      "notes.txt": "ignore me",
    })

    expect(result.error).toBeUndefined()
    expect(result.tasks).toEqual([{ task_id: "task_1", status: "completed", name: "build", task_summary: "did the thing" }])
  })

  it("reports an absent store instead of pretending it read zero tasks", () => {
    const result = readerOver({}, { missing: true })

    expect(result).toEqual({ tasks: [], absent: true })
  })

  it("answers an explicit error when a record cannot be read", () => {
    const broken = createRecordTaskReader({
      stateDirOf: () => "state",
      fs: {
        readdirSync: () => ["task_1.json"],
        readFileSync: () => {
          throw new Error("EACCES")
        },
      },
    })({ directory: "project" })

    expect(broken.error).toBe("record tasks unreadable: task_1.json")
  })
})

describe("merge into the graph document", () => {
  it("lets the record outvote the snapshot for execution fields and appends unknown tasks", () => {
    const document = { sessionId: "ses", tasks: { tasks: [{ task_id: "task_a", status: "running", node_id: "n1" }] } }

    const merged = mergeRecordTasks(document, [
      { task_id: "task_a", status: "completed" },
      { task_id: "task_b", status: "running" },
    ])

    expect(merged.tasks.tasks).toEqual([
      { task_id: "task_a", status: "completed", node_id: "n1" },
      { task_id: "task_b", status: "running" },
    ])
  })

  it("returns the document unchanged when it already names every record", () => {
    const document = { tasks: { tasks: [{ task_id: "task_a" }] } }

    expect(mergeRecordTasks(document, [{ task_id: "task_a" }])).toBe(document)
  })

  it("carries the record rows into a document that has no tasks section at all", () => {
    const merged = mergeRecordTasks({ sessionId: "ses" }, [{ task_id: "task_z", status: "completed" }])

    expect(merged.tasks.tasks).toEqual([{ task_id: "task_z", status: "completed" }])
    expect(merged.sessionId).toBe("ses")
  })
})
