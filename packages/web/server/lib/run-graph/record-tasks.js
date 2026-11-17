import * as nodeFs from "node:fs"
import { join } from "node:path"

/**
 * Record-derived task rows for the run graph.
 *
 * The graph's own document comes from a run snapshot, so a task started through the capability
 * path — which writes a canonical record and no snapshot — would never appear. This reads those
 * records and hands back the rows the snapshot's `tasks.tasks` list can carry, so the graph can
 * show a task it did not produce. It never invents nodes, edges or a snapshot.
 *
 * Everything here is read-only. The store is the engine's: `<stateDir>/tasks/<task_id>.json`
 * (senpi-task/src/store/record-store.ts:267). A record is authority for execution facts only;
 * topology and rendering identity stay the snapshot's.
 */

export const SUPPORTED_SCHEMA_VERSION = 1

export const DEFAULT_RECORD_LIMIT = 2000

export const MAX_RECORD_BYTES = 4 * 1024 * 1024

/** The canonical lifecycle enum (senpi-task/src/state). Copied, never extended. */
const LIFECYCLE = new Set(["pending", "running", "completed", "error", "cancelled", "interrupted", "lost"])

/** The completion gate's vocabulary. `verified` is only ever a stored claim, never an inference. */
const VERIFICATION = new Set(["verified", "unverified", "blocked"])

/** A record file must be named for its own task id; tombstones (`.json.expunging`) and locks never match. */
const RECORD_FILE = /^[A-Za-z0-9_.-]+\.json$/

const asString = (value) => {
  // A record is untrusted input: `String(value)` on an object whose toString is not callable throws, and one such field
  // must never hide every healthy row behind a 500.
  try {
    return String(value) === value ? value : null
  } catch {
    return null
  }
}

const asNumber = (value) => (Number.isFinite(value) ? value : null)

const isObject = (value) => Object.prototype.toString.call(value) === "[object Object]"

const messageOf = (error) => (error instanceof Error ? error.message : String(error))

const emptyDiagnostics = () => ({
  scanned: 0,
  accepted: 0,
  skipped: 0,
  limitReached: false,
  malformed: [],
  unsupported: [],
  identityMismatch: [],
  duplicates: [],
  symlinked: [],
  unreadable: [],
  unknownVerification: [],
  unattributed: [],
})

// Fields the canonical record owns. Everything else in a task row stays the snapshot's, because topology and rendering
// identity are not things a record can know.
const RECORD_AUTHORITATIVE = [
  "status",
  "parent_session_id",
  "root_session_id",
  "child_session_id",
  "depth",
  "execution_mode",
  "background_mode",
  "model",
  "error_message",
  "failure_kind",
  "failure_reason",
  "verification_status",
  "verification_source",
  "started_at",
  "terminal_at",
  "updated_at",
  "duration_ms",
]

const millisBetween = (from, to) => {
  const start = asString(from)
  const end = asString(to)
  if (start === null || end === null) return null
  const a = Date.parse(start)
  const b = Date.parse(end)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  return b - a
}

/**
 * One record as a graph row. Identity fields are copied verbatim: the graph's node key for a task is the canonical
 * `task_id`, never a generated one, and parent, root and child sessions stay three separate facts.
 */
const rowOf = (record) => {
  if (!isObject(record)) return null
  const taskId = asString(record.task_id)
  if (taskId === null || taskId.length === 0) return null
  const row = { task_id: taskId, status: asString(record.status) ?? "unknown" }
  const put = (key, value) => {
    const text = asString(value)
    if (text !== null && text.length > 0) row[key] = text
  }
  put("name", record.name)
  put("task_summary", record.task_summary)
  put("root_session_id", record.root_session_id)
  put("parent_session_id", record.parent_session_id)
  put("child_session_id", record.child_session_id)
  const depth = asNumber(record.depth)
  if (depth !== null) row.depth = depth
  put("execution_mode", record.execution_mode)
  put("background_mode", record.background_mode)
  put("model", asString(record.effective_model) ?? asString(record.resolved_model) ?? asString(record.model))
  put("error_message", record.error_message)
  put("failure_kind", record.failure_kind)
  put("failure_reason", record.failure_reason)
  // Absence is its own answer. A record without the gate's claim is UNVERIFIED, never verified: execution success and a
  // verification verdict are separate dimensions, and the only thing that can say "verified" is the stored claim.
  const declared = asString(record.verification_status)
  row.verification_status = declared === null ? "unverified" : VERIFICATION.has(declared) ? declared : "unknown"
  row.verification_source = declared === null ? "absent" : "record"
  put("created_at", record.created_at)
  put("started_at", record.started_at)
  put("terminal_at", record.terminal_at)
  put("updated_at", record.updated_at)
  const runStats = isObject(record.run_stats) ? record.run_stats : null
  const runtimeMs = runStats === null ? null : asNumber(runStats.runtime_ms)
  const duration = millisBetween(record.started_at, record.terminal_at)
  if (duration !== null) row.duration_ms = duration
  else if (runtimeMs !== null) row.duration_ms = runtimeMs
  if (runStats !== null) {
    const stats = {}
    const turns = asNumber(runStats.turns)
    const calls = asNumber(runStats.tool_calls)
    if (turns !== null) stats.turns = turns
    if (calls !== null) stats.tool_calls = calls
    if (runtimeMs !== null) stats.runtime_ms = runtimeMs
    if (Object.keys(stats).length > 0) row.run_stats = stats
  }
  return row
}

/**
 * Whether a parsed value is a record this reader may project. Rejecting is explicit: an unknown future version is
 * `unsupported`, a broken shape is `malformed`, and neither ever becomes a task node by default.
 */
const classify = (value) => {
  if (!isObject(value)) return { kind: "malformed", reason: "not a JSON object" }
  const taskId = asString(value.task_id)
  if (taskId === null || taskId.trim().length === 0) return { kind: "malformed", reason: "no task_id" }
  const declared = value.schema_version
  if (declared !== undefined) {
    if (!Number.isInteger(declared) || declared < 1) {
      return { kind: "malformed", reason: "schema_version is not a positive integer" }
    }
    // Never interpret a record from a future schema optimistically: its fields may mean something else.
    if (declared > SUPPORTED_SCHEMA_VERSION) {
      return { kind: "unsupported", reason: `schema_version ${declared} is newer than ${SUPPORTED_SCHEMA_VERSION}` }
    }
  }
  const status = asString(value.status)
  if (status === null) return { kind: "malformed", reason: "no status" }
  if (!LIFECYCLE.has(status)) return { kind: "unsupported", reason: `unknown status "${status}"` }
  return { kind: "accepted", taskId, status }
}

// Parsed records survive a refresh when the file they came from has not moved: the key is the stat triple (size, mtime,
// ctime), so a rewrite that keeps the same length still invalidates. Only successful parses are cached, because a
// transient EACCES must be retried rather than replayed. Bounded so a long-lived server cannot grow it forever.
const CACHE_LIMIT = 8
const recordCache = new Map()

// One lstat per record serves freshness, the symlink refusal and the size cap: three questions, one syscall.
const statOf = (fsImpl, path) => {
  try {
    return fsImpl.lstatSync(path)
  } catch {
    return null
  }
}

const statKeyOf = (stat) => {
  if (stat === null) return "missing"
  const size = asNumber(stat.size) ?? -1
  const mtime = asNumber(stat.mtimeMs) ?? -1
  const ctime = asNumber(stat.ctimeMs) ?? -1
  return `${size}:${mtime}:${ctime}`
}

const parseOne = (fsImpl, path, stat) => {
  if (stat === null) return { kind: "unreadable", reason: "record could not be inspected" }
  // A symlinked record could point anywhere: refuse it rather than read a file the store does not own.
  if (stat.isSymbolicLink?.() === true) return { kind: "symlinked", reason: "record file is a symbolic link" }
  const size = asNumber(stat.size)
  if (size !== null && size > MAX_RECORD_BYTES) {
    return { kind: "unreadable", reason: `record is ${size} bytes, above ${MAX_RECORD_BYTES}` }
  }
  try {
    return { kind: "parsed", value: JSON.parse(fsImpl.readFileSync(path, "utf8")) }
  } catch (error) {
    // A read failure and a bad document are different facts: EACCES means "could not look", a syntax error means the
    // store holds a broken record. Only the second is malformed.
    return error instanceof SyntaxError
      ? { kind: "malformed", reason: `invalid JSON: ${messageOf(error)}` }
      : { kind: "unreadable", reason: messageOf(error) }
  }
}

/**
 * Reads every canonical task record for a project. A store that cannot be read answers an explicit error rather than
 * an empty list, because "no tasks" and "could not look" are different facts. A single bad record is a diagnostic, so
 * one corrupt file can never hide the graph's other tasks.
 */
export const createRecordTaskReader = (options = {}) => {
  // This module runs under Node inside the server, so it must not import the engine's TypeScript:
  // the caller supplies the same store resolution the verification bundle uses.
  const stateDirOf = options.stateDirOf
  const fsImpl = options.fs === undefined ? nodeFs : { ...nodeFs, ...options.fs }
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_RECORD_LIMIT
  const cacheStore = options.cacheStore ?? recordCache
  const cacheEnabled = options.cache !== false
  return (input = {}) => {
    const directory = asString(input?.directory)
    if (directory === null || directory.trim().length === 0) {
      return { error: "record tasks: a project directory is required" }
    }
    let stateDir
    try {
      stateDir = stateDirOf(directory)
    } catch (error) {
      return { error: `record tasks unavailable: ${messageOf(error)}` }
    }
    if (asString(stateDir) === null || String(stateDir).trim().length === 0) {
      return { error: "record tasks unavailable: the store resolver answered no directory" }
    }
    const tasksDir = join(stateDir, "tasks")
    // A symlinked or junction store directory is followed by readdir/readFile: refuse it rather than enumerate files the
    // store does not own.
    const tasksDirEntry = statOf(fsImpl, tasksDir)
    if (tasksDirEntry !== null && tasksDirEntry.isSymbolicLink?.() === true) {
      return { error: "record tasks unreadable: the store's tasks directory is a symbolic link" }
    }
    let names
    try {
      names = fsImpl.readdirSync(tasksDir)
    } catch (error) {
      if (error?.code === "ENOENT") return { tasks: [], absent: true, diagnostics: emptyDiagnostics() }
      return { error: `record tasks unreadable: ${messageOf(error)}` }
    }
    // Bounded, deterministic enumeration: record files only, sorted, and the NEWEST kept when the store is bigger than the
    // limit. Task ids are monotonic, so the last names are the most recent work - the rows a live graph actually needs.
    const all = names.map(String).filter((name) => RECORD_FILE.test(name)).sort()
    const files = all.length > limit ? all.slice(all.length - limit) : all
    const diagnostics = emptyDiagnostics()
    diagnostics.scanned = all.length
    diagnostics.limitReached = files.length < all.length

    const stats = new Map()
    for (const name of files) stats.set(name, statOf(fsImpl, join(tasksDir, name)))

    const cacheKey = `${stateDir}::${limit}`
    const cached = cacheEnabled ? cacheStore.get(cacheKey) : undefined
    const previous = cached instanceof Map ? cached : new Map()
    const parsed = new Map()
    for (const name of files) {
      const stat = stats.get(name) ?? null
      const key = statKeyOf(stat)
      const known = previous.get(name)
      // A cached parse is reused only while the file is exactly where it was; anything else is read again.
      if (known !== undefined && known.key === key && known.entry.kind === "parsed") {
        parsed.set(name, known.entry)
        continue
      }
      parsed.set(name, parseOne(fsImpl, join(tasksDir, name), stat))
    }
    if (cacheEnabled) {
      const entries = new Map()
      for (const name of files) {
        const entry = parsed.get(name)
        if (entry.kind !== "parsed") continue
        entries.set(name, { key: statKeyOf(stats.get(name) ?? null), entry })
      }
      // Delete before set: re-setting an existing key keeps its original position, which would make this FIFO, not LRU.
      cacheStore.delete(cacheKey)
      cacheStore.set(cacheKey, entries)
      while (cacheStore.size > CACHE_LIMIT) {
        const oldest = cacheStore.keys().next()
        if (oldest.done === true) break
        cacheStore.delete(oldest.value)
      }
    }

    const rows = []
    // Claimed before the file-name check: two files naming one task id are a conflict to report, not a merge to guess.
    const claimed = new Map()
    const report = (bucket, name, reason) => {
      diagnostics.skipped += 1
      diagnostics[bucket].push({ file: name, reason })
    }
    const accepted = []
    for (const name of files) {
      const entry = parsed.get(name)
      if (entry === undefined) {
        report("unreadable", name, "record vanished between listing and read")
        continue
      }
      if (entry.kind === "symlinked" || entry.kind === "unreadable" || entry.kind === "malformed") {
        report(entry.kind, name, entry.reason)
        continue
      }
      const verdict = classify(entry.value)
      if (verdict.kind !== "accepted") {
        report(verdict.kind, name, verdict.reason)
        continue
      }
      accepted.push({ name, verdict, value: entry.value })
    }
    // One task, one claim: a second file for the same id is reported, never silently merged or overwritten. The file
    // named for the id wins; every other claimant is an identity mismatch, because a record must live under its own id.
    for (const claim of accepted) {
      const holders = claimed.get(claim.verdict.taskId)
      if (holders === undefined) claimed.set(claim.verdict.taskId, [claim])
      else holders.push(claim)
    }
    for (const [taskId, holders] of claimed) {
      const canonical = holders.find((claim) => claim.name === `${taskId}.json`)
      if (holders.length > 1 && canonical !== undefined) {
        for (const other of holders) {
          if (other === canonical) continue
          diagnostics.duplicates.push({ task_id: taskId, first: other.name, second: canonical.name })
          diagnostics.skipped += 1
        }
      }
      for (const claim of holders) {
        if (claim !== canonical) {
          diagnostics.identityMismatch.push({ file: claim.name, reason: `file name does not match task_id "${taskId}"` })
          diagnostics.skipped += 1
        }
      }
      if (canonical === undefined) continue
      const row = rowOf(canonical.value)
      if (row === null) {
        report("malformed", canonical.name, "record has no usable identity")
        continue
      }
      const declared = asString(canonical.value?.verification_status)
      if (declared !== null && !VERIFICATION.has(declared)) {
        diagnostics.unknownVerification.push({ task_id: taskId, value: declared })
      }
      // A task nobody can place is still a task, but it has to say so: silence here would read as "belongs to you".
      const placed = asString(canonical.value?.parent_session_id) ?? asString(canonical.value?.root_session_id) ?? asString(canonical.value?.child_session_id)
      if (placed === null || placed.length === 0) diagnostics.unattributed.push({ task_id: taskId })
      rows.push(row)
      diagnostics.accepted += 1
    }
    // Deterministic order independent of directory listing order: creation time, then the canonical id.
    rows.sort((left, right) => {
      const a = asString(left.created_at) ?? ""
      const b = asString(right.created_at) ?? ""
      if (a !== b) return a < b ? -1 : 1
      return left.task_id < right.task_id ? -1 : left.task_id > right.task_id ? 1 : 0
    })
    return { tasks: rows, absent: false, diagnostics }
  }
}

/**
 * Adds record rows the document does not already carry, leaving every existing entry untouched.
 * Order is the document's own, then the records that were missing.
 */
export const rowsForConversation = (rows, sessionId) => {
  const wanted = asString(sessionId)
  if (wanted === null || !Array.isArray(rows)) return []
  // Membership is structural: a task belongs to this conversation when it was started by it, descends from it (root),
  // or runs a session that IS this conversation. Any one of the three is enough; a row with none of them is foreign.
  const linksTo = (row) =>
    asString(row?.parent_session_id) === wanted ||
    asString(row?.root_session_id) === wanted ||
    asString(row?.child_session_id) === wanted
  return rows.filter(linksTo)
}

const CONTRACT_FIELDS = [
  "status",
  "root_session_id",
  "name",
  "task_summary",
  "parent_session_id",
  "child_session_id",
  "depth",
  "execution_mode",
  "background_mode",
  "model",
  "error_message",
  "failure_kind",
  "failure_reason",
  "verification_status",
  "started_at",
  "terminal_at",
  "updated_at",
  "duration_ms",
]

// Which layer supplied each contract field for one task row. `absent` is its own state so a reader can tell "the record
// does not carry this" from "nobody looked" (error), and `derived` stays reserved for computed values.
const provenanceOf = (mergedTask, recordRow) => {
  const sources = {}
  for (const field of CONTRACT_FIELDS) {
    const mergedValue = mergedTask === undefined ? undefined : mergedTask[field]
    if (mergedValue === undefined) {
      sources[field] = "absent"
      continue
    }
    // Ownership is decided by the value that survived, not by what a layer happened to carry: naming the record for a
    // field the snapshot kept would misreport exactly the fields where the two disagree.
    if (recordRow !== undefined && recordRow[field] === mergedValue) sources[field] = "record"
    else sources[field] = "snapshot"
  }
  return sources
}

/**
 * The same claim, on the field the panel actually paints.
 *
 * `tasks.tasks[].verification_status` is a row nobody renders; the panel renders `dag.runs[].nodes[]`, and a node keeps
 * whatever the snapshot said when it was written. A task that finished unverified could therefore display "verified", and
 * a repaired task could keep its pre-repair "blocked" verdict. A node is corrected only when the record names it through
 * `task_id`, so topology and node state stay the snapshot's.
 */
const reconcileNodeClaims = (document, rowById) => {
  const dag = isObject(document.dag) ? document.dag : null
  const runs = dag !== null && Array.isArray(dag.runs) ? dag.runs : null
  if (runs === null) return { document, changed: false }
  let changed = false
  const nextRuns = runs.map((run) => {
    if (!isObject(run) || !Array.isArray(run.nodes)) return run
    let runChanged = false
    const nodes = run.nodes.map((node) => {
      if (!isObject(node)) return node
      const taskId = asString(node.task_id)
      if (taskId === null) return node
      const row = rowById.get(taskId)
      if (row === undefined) return node
      const claim = asString(row.verification_status)
      if (claim === null || node.verification_status === claim) return node
      runChanged = true
      return { ...node, verification_status: claim, verification_source: "record" }
    })
    if (!runChanged) return run
    changed = true
    return { ...run, nodes }
  })
  return { document: changed ? { ...document, dag: { ...dag, runs: nextRuns } } : document, changed }
}

/**
 * Correct node verification claims from the record rows, keyed on the task id a node carries *now*.
 *
 * The chat path writes a node before its child finishes, so the attribution index it had at write time
 * often named no task and the node carried no `task_id`. Merging therefore corrected nothing for those
 * nodes. Attribution runs afterwards and attaches the id, which left a node saying "verified" from the
 * snapshot while its own task row said "unverified". Callers replay this after attribution so the label
 * a user reads always comes from the record.
 */
export const reconcileRecordClaims = (document, rows) => {
  if (!isObject(document) || !Array.isArray(rows) || rows.length === 0) return document
  const rowById = new Map()
  for (const row of rows) {
    const id = asString(row?.task_id)
    if (id !== null) rowById.set(id, row)
  }
  return reconcileNodeClaims(document, rowById).document
}

export const mergeRecordTasks = (document, rows, diagnostics) => {
  const withDiagnostics = (value) => {
    if (diagnostics === undefined) return value
    if (!isObject(value) || Array.isArray(value)) return value
    const container = isObject(value.tasks) ? value.tasks : {}
    return { ...value, tasks: { ...container, diagnostics } }
  }
  if (!isObject(document) || Array.isArray(document)) return document
  if (!Array.isArray(rows) || rows.length === 0) return withDiagnostics(document)
  const container = isObject(document.tasks) ? document.tasks : {}
  const existing = Array.isArray(container.tasks) ? container.tasks : []
  const rowById = new Map()
  for (const row of rows) {
    const id = asString(row?.task_id)
    if (id !== null) rowById.set(id, row)
  }
  let changed = false
  // The snapshot's own list is rebuilt position by position, so a row without a task id and two rows sharing one id
  // both survive exactly as the snapshot wrote them. Only a row the record names is refined.
  const mergedTasks = existing.map((task) => {
    const id = asString(task?.task_id)
    if (id === null || !isObject(task)) return task
    const row = rowById.get(id)
    if (row === undefined) return task
    const merged = { ...task }
    let mergedChanged = false
    for (const field of RECORD_AUTHORITATIVE) {
      const value = row[field]
      if (value === undefined) continue
      if (merged[field] === value) continue
      merged[field] = value
      mergedChanged = true
    }
    if (!mergedChanged) return task
    changed = true
    return merged
  })
  const present = new Set()
  for (const task of existing) {
    const id = asString(task?.task_id)
    if (id !== null) present.add(id)
  }
  for (const row of rows) {
    const id = asString(row?.task_id)
    if (id === null || present.has(id)) continue
    present.add(id)
    mergedTasks.push(row)
    changed = true
  }
  let withTasks = document
  if (changed) {
    const provenance = Object.assign({}, isObject(container.provenance) ? container.provenance : null)
    for (const task of mergedTasks) {
      const id = asString(task?.task_id)
      if (id === null) continue
      provenance[id] = provenanceOf(task, rowById.get(id))
    }
    withTasks = { ...document, tasks: { ...container, tasks: mergedTasks, provenance } }
  }
  const reconciled = reconcileNodeClaims(withTasks, rowById)
  if (!changed && !reconciled.changed) return withDiagnostics(document)
  return withDiagnostics(reconciled.document)
}
