import { describe, expect, it } from "vitest"

import {
  DEFAULT_RECORD_LIMIT,
  mergeRecordTasks,
  rowsForConversation,
  SUPPORTED_SCHEMA_VERSION,
  createRecordTaskReader,
} from "./record-tasks"

const nameOf = (path) => String(path).split(/[\\/]/).pop()

const fakeFs = (files, options = {}) => {
  const reads = []
  const symlinks = options.symlinks ?? []
  const now = options.mtime ?? 1000
  return {
    reads,
    fs: {
      readdirSync: () => Object.keys(files).concat(options.extraNames ?? []),
      readFileSync: (path) => {
        const name = nameOf(path)
        reads.push(name)
        if (!(name in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
        return files[name]
      },
      statSync: (path) => {
        const name = nameOf(path)
        const content = files[name]
        if (content === undefined) throw new Error("ENOENT")
        return { size: content.length, mtimeMs: options.mtimeOf?.[name] ?? now }
      },
      lstatSync: (path) => {
        const name = nameOf(path)
        const content = files[name]
        if (content === undefined) throw new Error("ENOENT")
        return {
          size: content.length,
          mtimeMs: options.mtimeOf?.[name] ?? now,
          ctimeMs: options.ctimeOf?.[name] ?? now,
          isSymbolicLink: () => symlinks.includes(name),
        }
      },
    },
  }
}

const readerOver = (files, options = {}) => {
  const fake = fakeFs(files, options)
  const read = createRecordTaskReader({
    stateDirOf: () => "state",
    fs: fake.fs,
    cache: options.cache ?? false,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.cacheStore === undefined ? {} : { cacheStore: options.cacheStore }),
  })
  return { read, reads: fake.reads }
}

const record = (taskId, status = "running", extra = {}) => JSON.stringify({ task_id: taskId, status, ...extra })

const missingStore = (options = {}) =>
  createRecordTaskReader({
    stateDirOf: () => "state",
    fs: {
      readdirSync: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      },
    },
    cache: false,
    ...options,
  })({ directory: "project" })

describe("record discovery", () => {
  it("returns a row per canonical record and skips non-record files", () => {
    const { read } = readerOver({
      "st_1.json": record("st_1", "completed", { name: "build", task_summary: "did the thing" }),
      "notes.txt": "ignore me",
    })

    const result = read({ directory: "project" })

    expect(result.error).toBeUndefined()
    expect(result.tasks).toEqual([
      { task_id: "st_1", status: "completed", name: "build", task_summary: "did the thing", verification_status: "unverified", verification_source: "absent" },
    ])
    expect(result.diagnostics.accepted).toBe(1)
    expect(result.diagnostics.scanned).toBe(1)
  })

  it("ignores expunging tombstones and lock files", () => {
    const { read } = readerOver({
      "st_1.json": record("st_1"),
      "st_2.json.expunging": record("st_2"),
      "st_3.lock": "{}",
    })

    const result = read({ directory: "project" })

    expect(result.tasks.map((task) => task.task_id)).toEqual(["st_1"])
    expect(result.diagnostics.scanned).toBe(1)
  })

  it("reports an absent store instead of pretending it read zero tasks", () => {
    const result = missingStore()

    expect(result).toMatchObject({ tasks: [], absent: true })
    expect(result.diagnostics.scanned).toBe(0)
    expect(result.error).toBeUndefined()
  })

  it("answers an explicit error when the store cannot be listed at all", () => {
    const read = createRecordTaskReader({
      stateDirOf: () => "state",
      fs: {
        readdirSync: () => {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" })
        },
      },
      cache: false,
    })

    expect(read({ directory: "project" }).error).toBe("record tasks unreadable: EACCES")
  })

  it("refuses to read when no project directory is named", () => {
    const read = createRecordTaskReader({ stateDirOf: () => "state", cache: false })

    expect(read({}).error).toBe("record tasks: a project directory is required")
  })

  it("answers an error when the store resolver itself fails", () => {
    const read = createRecordTaskReader({
      stateDirOf: () => {
        throw new Error("config unreadable")
      },
      cache: false,
    })

    expect(read({ directory: "project" }).error).toContain("config unreadable")
  })
})

describe("schema and version policy", () => {
  it("accepts a record at the supported version", () => {
    const { read } = readerOver({
      "st_1.json": record("st_1", "running", { schema_version: SUPPORTED_SCHEMA_VERSION }),
    })

    expect(read({ directory: "project" }).tasks).toHaveLength(1)
  })

  it("marks a future schema version unsupported and never interprets it", () => {
    const { read } = readerOver({
      "st_1.json": record("st_1", "running", { schema_version: SUPPORTED_SCHEMA_VERSION + 1 }),
      "st_2.json": record("st_2", "completed"),
    })

    const result = read({ directory: "project" })

    expect(result.tasks.map((task) => task.task_id)).toEqual(["st_2"])
    expect(result.diagnostics.unsupported).toEqual([
      { file: "st_1.json", reason: `schema_version ${SUPPORTED_SCHEMA_VERSION + 1} is newer than ${SUPPORTED_SCHEMA_VERSION}` },
    ])
  })

  it("treats a non-integer schema version as malformed", () => {
    const { read } = readerOver({ "st_1.json": record("st_1", "running", { schema_version: "1" }) })

    expect(read({ directory: "project" }).diagnostics.malformed[0].file).toBe("st_1.json")
  })

  it("treats a record with no status as malformed", () => {
    const { read } = readerOver({ "st_1.json": JSON.stringify({ task_id: "st_1" }) })

    expect(read({ directory: "project" }).diagnostics.malformed).toEqual([{ file: "st_1.json", reason: "no status" }])
  })

  it("marks an unknown lifecycle value unsupported instead of projecting it", () => {
    const { read } = readerOver({ "st_1.json": record("st_1", "teleported") })

    const result = read({ directory: "project" })

    expect(result.tasks).toEqual([])
    expect(result.diagnostics.unsupported[0].reason).toBe('unknown status "teleported"')
  })

  it("keeps the good records when one file is not JSON at all", () => {
    const { read } = readerOver({
      "st_1.json": "{ this is not json",
      "st_2.json": record("st_2", "completed"),
    })

    const result = read({ directory: "project" })

    expect(result.tasks.map((task) => task.task_id)).toEqual(["st_2"])
    expect(result.diagnostics.malformed[0].file).toBe("st_1.json")
    expect(result.error).toBeUndefined()
  })

  it("keeps the good records when one file cannot be read", () => {
    const fake = fakeFs({ "st_1.json": record("st_1"), "st_2.json": record("st_2", "completed") })
    const read = createRecordTaskReader({
      stateDirOf: () => "state",
      cache: false,
      fs: {
        ...fake.fs,
        readFileSync: (path) => {
          if (nameOf(path) === "st_1.json") throw Object.assign(new Error("EACCES"), { code: "EACCES" })
          return fake.fs.readFileSync(path)
        },
      },
    })

    const result = read({ directory: "project" })

    expect(result.tasks.map((task) => task.task_id)).toEqual(["st_2"])
    expect(result.diagnostics.unreadable[0].file).toBe("st_1.json")
  })

  it("refuses a store whose tasks directory is itself a link", () => {
    const read = createRecordTaskReader({
      stateDirOf: () => "state",
      cache: false,
      fs: {
        readdirSync: () => ["st_1.json"],
        readFileSync: () => record("st_1"),
        statSync: () => ({ size: 10, mtimeMs: 1, ctimeMs: 1, isSymbolicLink: () => true }),
        lstatSync: () => ({ size: 10, mtimeMs: 1, ctimeMs: 1, isSymbolicLink: () => true }),
      },
    })

    expect(read({ directory: "project" }).error).toContain("symbolic link")
  })

  it("refuses a symlinked record rather than following it", () => {
    const { read } = readerOver(
      { "st_1.json": record("st_1"), "st_2.json": record("st_2") },
      { symlinks: ["st_1.json"] },
    )

    const result = read({ directory: "project" })

    expect(result.tasks.map((task) => task.task_id)).toEqual(["st_2"])
    expect(result.diagnostics.symlinked).toEqual([{ file: "st_1.json", reason: "record file is a symbolic link" }])
  })

  it("refuses a record whose file name is not its own task id", () => {
    const { read } = readerOver({ "other.json": record("st_1") })

    const result = read({ directory: "project" })

    expect(result.tasks).toEqual([])
    expect(result.diagnostics.identityMismatch[0].file).toBe("other.json")
  })

  it("reports two files claiming one task id as a conflict", () => {
    const { read } = readerOver({
      "other.json": record("st_1"),
      "st_1.json": record("st_1", "completed"),
    })

    const result = read({ directory: "project" })

    expect(result.tasks.map((task) => task.task_id)).toEqual(["st_1"])
    expect(result.diagnostics.duplicates).toEqual([{ task_id: "st_1", first: "other.json", second: "st_1.json" }])
    expect(result.diagnostics.identityMismatch[0].file).toBe("other.json")
  })
})

describe("verification stays independent from lifecycle", () => {
  it("never infers verified from a completed record", () => {
    const { read } = readerOver({ "st_1.json": record("st_1", "completed") })

    const row = read({ directory: "project" }).tasks[0]

    expect(row.status).toBe("completed")
    expect(row.verification_status).toBe("unverified")
    expect(row.verification_source).toBe("absent")
  })

  it("projects a stored verified claim as verified", () => {
    const { read } = readerOver({ "st_1.json": record("st_1", "completed", { verification_status: "verified" }) })

    expect(read({ directory: "project" }).tasks[0]).toMatchObject({ verification_status: "verified", verification_source: "record" })
  })

  it("keeps an unknown verification value unknown and reports it", () => {
    const { read } = readerOver({ "st_1.json": record("st_1", "completed", { verification_status: "probably" }) })

    const result = read({ directory: "project" })

    expect(result.tasks[0].verification_status).toBe("unknown")
    expect(result.diagnostics.unknownVerification).toEqual([{ task_id: "st_1", value: "probably" }])
  })

  it("keeps a failed record failed and carries its error", () => {
    const { read } = readerOver({
      "st_1.json": record("st_1", "error", { error_message: "provider refused", failure_kind: "runner" }),
    })

    expect(read({ directory: "project" }).tasks[0]).toMatchObject({
      status: "error",
      error_message: "provider refused",
      failure_kind: "runner",
      verification_status: "unverified",
    })
  })

  it("keeps a cancelled record cancelled", () => {
    const { read } = readerOver({ "st_1.json": record("st_1", "cancelled") })

    expect(read({ directory: "project" }).tasks[0].status).toBe("cancelled")
  })
})

describe("identity and timings are copied verbatim", () => {
  it("keeps task, parent, root and child identities separate", () => {
    const { read } = readerOver({
      "st_1.json": record("st_1", "running", {
        parent_session_id: "parent-ses",
        root_session_id: "root-ses",
        child_session_id: "child-ses",
        depth: 1,
      }),
    })

    expect(read({ directory: "project" }).tasks[0]).toMatchObject({
      task_id: "st_1",
      parent_session_id: "parent-ses",
      root_session_id: "root-ses",
      child_session_id: "child-ses",
      depth: 1,
    })
  })

  it("derives a duration from the record's own timestamps", () => {
    const { read } = readerOver({
      "st_1.json": record("st_1", "completed", {
        started_at: "2026-11-15T05:06:55.795Z",
        terminal_at: "2026-11-15T05:07:14.073Z",
      }),
    })

    expect(read({ directory: "project" }).tasks[0].duration_ms).toBe(18278)
  })

  it("falls back to run_stats runtime when a timestamp is missing", () => {
    const { read } = readerOver({
      "st_1.json": record("st_1", "completed", { started_at: "2026-11-15T05:06:55.795Z", run_stats: { runtime_ms: 17415, turns: 3 } }),
    })

    expect(read({ directory: "project" }).tasks[0]).toMatchObject({ duration_ms: 17415, run_stats: { runtime_ms: 17415, turns: 3 } })
  })
})

describe("bounded and deterministic enumeration", () => {
  it("caps the records it parses and says the answer is partial", () => {
    const files = {}
    for (let index = 0; index < 5; index += 1) files[`st_${index}.json`] = record(`st_${index}`)
    const { read } = readerOver(files, { limit: 2 })

    const result = read({ directory: "project" })

    expect(result.tasks.map((task) => task.task_id)).toEqual(["st_3", "st_4"])
    expect(result.diagnostics).toMatchObject({ scanned: 5, limitReached: true, accepted: 2 })
  })

  it("keeps the newest records when a big store is truncated", () => {
    const files = {}
    for (let index = 0; index < 4; index += 1) files[`st_${index}.json`] = record(`st_${index}`, "completed")
    files["st_zz_latest.json"] = record("st_zz_latest", "running")
    const { read } = readerOver(files, { limit: 1 })

    expect(read({ directory: "project" }).tasks.map((task) => task.task_id)).toEqual(["st_zz_latest"])
  })

  it("orders rows by creation time then id, whatever order the directory lists", () => {
    const files = {
      "st_b.json": record("st_b", "running", { created_at: "2026-11-15T00:00:02.000Z" }),
      "st_a.json": record("st_a", "running", { created_at: "2026-11-15T00:00:01.000Z" }),
      "st_c.json": record("st_c", "running", { created_at: "2026-11-15T00:00:01.000Z" }),
    }
    const { read } = readerOver(files, { extraNames: ["st_z.json"] })

    expect(read({ directory: "project" }).tasks.map((task) => task.task_id)).toEqual(["st_a", "st_c", "st_b"])
  })

  it("answers byte-identical rows on a repeated read", () => {
    const { read } = readerOver({
      "st_1.json": record("st_1", "completed", { created_at: "2026-11-15T00:00:01.000Z" }),
      "st_2.json": record("st_2", "running", { created_at: "2026-11-15T00:00:01.000Z" }),
    })

    expect(JSON.stringify(read({ directory: "project" }))).toBe(JSON.stringify(read({ directory: "project" })))
  })

  it("uses the documented default limit", () => {
    expect(DEFAULT_RECORD_LIMIT).toBeGreaterThan(0)
  })
})

describe("cache freshness", () => {
  it("does not re-read files when nothing on disk moved", () => {
    const cacheStore = new Map()
    const { read, reads } = readerOver({ "st_1.json": record("st_1") }, { cache: true, cacheStore })

    read({ directory: "project" })
    const afterFirst = reads.length
    read({ directory: "project" })

    expect(afterFirst).toBe(1)
    expect(reads.length).toBe(afterFirst)
  })

  it("re-reads when only the ctime moves, so a same-length rewrite cannot go stale", () => {
    const cacheStore = new Map()
    const files = { "st_1.json": record("st_1", "running") }
    const first = readerOver(files, { cache: true, cacheStore, mtime: 1000, ctime: 1000 })
    first.read({ directory: "project" })

    files["st_1.json"] = record("st_1", "error")
    const second = readerOver(files, { cache: true, cacheStore, mtime: 1000, ctime: 2000 })

    expect(second.read({ directory: "project" }).tasks[0].status).toBe("error")
    expect(second.reads.length).toBe(1)
  })

  it("retries a record it could not read instead of caching the failure", () => {
    const cacheStore = new Map()
    const files = { "st_1.json": record("st_1", "completed") }
    const fake = fakeFs(files)
    let deny = true
    const read = createRecordTaskReader({
      stateDirOf: () => "state",
      cache: true,
      cacheStore,
      fs: {
        ...fake.fs,
        readFileSync: (path) => {
          if (deny) throw Object.assign(new Error("EACCES"), { code: "EACCES" })
          return fake.fs.readFileSync(path)
        },
      },
    })

    expect(read({ directory: "project" }).diagnostics.unreadable).toHaveLength(1)
    deny = false
    expect(read({ directory: "project" }).tasks.map((task) => task.task_id)).toEqual(["st_1"])
  })
})

describe("merge into the graph document", () => {
  it("lets the record outvote the snapshot for execution fields and keeps snapshot topology", () => {
    const document = { sessionId: "ses", tasks: { tasks: [{ task_id: "task_a", status: "running", node_id: "n1" }] } }

    const merged = mergeRecordTasks(document, [
      { task_id: "task_a", status: "completed", verification_status: "unverified" },
      { task_id: "task_b", status: "running" },
    ])

    expect(merged.tasks.tasks).toEqual([
      { task_id: "task_a", status: "completed", node_id: "n1", verification_status: "unverified" },
      { task_id: "task_b", status: "running" },
    ])
  })

  it("keeps a failed canonical outcome over a completed snapshot row", () => {
    const document = { tasks: { tasks: [{ task_id: "task_a", status: "completed", node_id: "n1" }] } }

    const merged = mergeRecordTasks(document, [{ task_id: "task_a", status: "error", error_message: "provider refused" }])

    expect(merged.tasks.tasks[0]).toMatchObject({ status: "error", error_message: "provider refused", node_id: "n1" })
  })

  it("does not let a snapshot claim verification the record does not carry", () => {
    const document = { tasks: { tasks: [{ task_id: "task_a", status: "completed", verification_status: "verified" }] } }

    const merged = mergeRecordTasks(document, [{ task_id: "task_a", status: "completed", verification_status: "unverified" }])

    expect(merged.tasks.tasks[0].verification_status).toBe("unverified")
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

  it("keeps a snapshot row that carries no task id", () => {
    const document = { tasks: { tasks: [{ name: "placeholder" }, { task_id: "t1", status: "running" }] } }

    const merged = mergeRecordTasks(document, [{ task_id: "t1", status: "completed" }, { task_id: "t2" }])

    expect(merged.tasks.tasks).toHaveLength(3)
    expect(merged.tasks.tasks[0]).toEqual({ name: "placeholder" })
  })

  it("keeps two snapshot rows that share one task id", () => {
    const document = { tasks: { tasks: [{ task_id: "t1", status: "running" }, { task_id: "t1", status: "pending" }] } }

    const merged = mergeRecordTasks(document, [{ task_id: "t1", status: "completed" }, { task_id: "t2" }])

    expect(merged.tasks.tasks.map((task) => task.task_id)).toEqual(["t1", "t1", "t2"])
  })

  it("names the winner as each field's owner", () => {
    const document = { tasks: { tasks: [{ task_id: "t1", status: "running", name: "from snapshot" }] } }

    const merged = mergeRecordTasks(document, [{ task_id: "t1", status: "completed", name: "from record" }])

    expect(merged.tasks.tasks[0]).toMatchObject({ name: "from snapshot", status: "completed" })
    expect(merged.tasks.provenance.t1.name).toBe("snapshot")
    expect(merged.tasks.provenance.t1.status).toBe("record")
  })

  it("corrects a node's verification claim from the record that executed it", () => {
    const document = {
      tasks: { tasks: [{ task_id: "st_1", status: "completed" }] },
      dag: { runs: [{ run_id: "r1", nodes: [{ id: "n1", task_id: "st_1", state: "completed", verification_status: "verified" }] }] },
    }

    const merged = mergeRecordTasks(document, [{ task_id: "st_1", status: "completed", verification_status: "unverified" }])

    expect(merged.dag.runs[0].nodes[0]).toMatchObject({ verification_status: "unverified", verification_source: "record", state: "completed" })
  })

  it("lets a repaired record replace a stale blocked node claim", () => {
    const document = {
      tasks: { tasks: [] },
      dag: { runs: [{ run_id: "r1", nodes: [{ id: "n1", task_id: "st_1", state: "error", verification_status: "blocked" }] }] },
    }

    const merged = mergeRecordTasks(document, [{ task_id: "st_1", status: "completed", verification_status: "verified" }])

    expect(merged.dag.runs[0].nodes[0].verification_status).toBe("verified")
  })

  it("leaves a node with no record and a node with no task id alone", () => {
    const nodes = [{ id: "n1", state: "completed", verification_status: "verified" }, { id: "n2", task_id: "st_other", verification_status: "blocked" }]
    const document = { tasks: { tasks: [] }, dag: { runs: [{ run_id: "r1", nodes }] } }

    const merged = mergeRecordTasks(document, [{ task_id: "st_1", status: "completed", verification_status: "unverified" }])

    expect(merged.dag.runs[0].nodes).toEqual(nodes)
  })

  it("attaches the reader's diagnostics to the document", () => {
    const diagnostics = { scanned: 3, accepted: 1, skipped: 2, malformed: [{ file: "x.json", reason: "bad" }] }

    const merged = mergeRecordTasks({ tasks: { tasks: [] } }, [{ task_id: "task_a" }], diagnostics)

    expect(merged.tasks.diagnostics).toEqual(diagnostics)
  })
})

describe("conversation membership", () => {
  it("keeps a task that names this conversation as parent, root or child", () => {
    const rows = [
      { task_id: "a", parent_session_id: "ses" },
      { task_id: "b", root_session_id: "ses" },
      { task_id: "c", child_session_id: "ses" },
      { task_id: "d", parent_session_id: "other", root_session_id: "other" },
    ]

    expect(rowsForConversation(rows, "ses").map((row) => row.task_id)).toEqual(["a", "b", "c"])
  })

  it("keeps two tasks from one parent distinct", () => {
    const rows = [
      { task_id: "a", parent_session_id: "ses", root_session_id: "ses" },
      { task_id: "b", parent_session_id: "ses", root_session_id: "ses" },
    ]

    const kept = rowsForConversation(rows, "ses")

    expect(kept).toHaveLength(2)
    expect(kept.map((row) => row.task_id)).toEqual(["a", "b"])
  })
})
