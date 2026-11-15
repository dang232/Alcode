import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Record-derived task rows for the run graph.
 *
 * The graph's own document comes from a run snapshot, so a task started through the capability
 * path — which writes a canonical record and no snapshot — would never appear. This reads those
 * records and hands back the rows the snapshot's `tasks.tasks` list can carry, so the graph can
 * show a task it did not produce. It never invents nodes, edges or a snapshot.
 */

const asString = (value) => (String(value) === value ? value : null)

const asNumber = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null)

// Fields the canonical record owns. Everything else in a task row stays the snapshot's, because topology and rendering
// identity are not things a record can know.
const RECORD_AUTHORITATIVE = [
  "status",
  "parent_session_id",
  "child_session_id",
  "depth",
  "execution_mode",
  "background_mode",
  "model",
  "error_message",
  "started_at",
  "terminal_at",
  "updated_at",
]

const rowOf = (record) => {
  const taskId = asString(record?.task_id)
  if (taskId === null || taskId.length === 0) return null
  const status = asString(record?.status) ?? "unknown"
  const name = asString(record?.name) ?? ""
  const summary = asString(record?.task_summary) ?? ""
  const text = (value) => asString(value)
  const depth = asNumber(record?.depth)
  const model = text(record?.effective_model) ?? text(record?.resolved_model) ?? text(record?.model)
  const present = (value) => value !== null && value !== undefined && value !== ""
  return {
    task_id: taskId,
    status,
    ...(present(name) ? { name } : {}),
    ...(present(summary) ? { task_summary: summary } : {}),
    ...(present(text(record?.root_session_id)) ? { root_session_id: text(record?.root_session_id) } : {}),
    ...(present(text(record?.parent_session_id)) ? { parent_session_id: text(record?.parent_session_id) } : {}),
    ...(present(text(record?.child_session_id)) ? { child_session_id: text(record?.child_session_id) } : {}),
    ...(depth === null ? {} : { depth }),
    ...(present(text(record?.execution_mode)) ? { execution_mode: text(record?.execution_mode) } : {}),
    ...(present(text(record?.background_mode)) ? { background_mode: text(record?.background_mode) } : {}),
    ...(present(model) ? { model } : {}),
    ...(present(text(record?.error_message)) ? { error_message: text(record?.error_message) } : {}),
    ...(present(text(record?.started_at)) ? { started_at: text(record?.started_at) } : {}),
    ...(present(text(record?.terminal_at)) ? { terminal_at: text(record?.terminal_at) } : {}),
    ...(present(text(record?.updated_at)) ? { updated_at: text(record?.updated_at) } : {}),
  }
}

/**
 * Reads every canonical task record for a project. A store that cannot be read answers an explicit
 * error rather than an empty list, because "no tasks" and "could not look" are different facts.
 */
export const createRecordTaskReader = (options = {}) => {
  // This module runs under Node inside the server, so it must not import the engine's TypeScript:
  // the caller supplies the same store resolution the verification bundle uses.
  const stateDirOf = options.stateDirOf
  const fsImpl = options.fs ?? { readdirSync, readFileSync }
  return (input = {}) => {
    const directory = asString(input.directory)
    if (directory === null || directory.trim().length === 0) {
      return { error: "record tasks: a project directory is required" }
    }
    let stateDir
    try {
      stateDir = stateDirOf(directory)
    } catch (error) {
      return { error: `record tasks unavailable: ${error instanceof Error ? error.message : String(error)}` }
    }
    let names
    try {
      names = fsImpl.readdirSync(join(stateDir, "tasks"))
    } catch (error) {
      if (error instanceof Error && error.code === "ENOENT") return { tasks: [], absent: true }
      return { error: `record tasks unreadable: ${error instanceof Error ? error.message : String(error)}` }
    }
    const tasks = []
    for (const name of names) {
      if (!String(name).endsWith(".json")) continue
      try {
        const record = JSON.parse(fsImpl.readFileSync(join(stateDir, "tasks", name), "utf8"))
        const row = rowOf(record)
        if (row !== null) tasks.push(row)
      } catch {
        return { error: `record tasks unreadable: ${name}` }
      }
    }
    return { tasks, absent: false }
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
  "started_at",
  "terminal_at",
  "updated_at",
]

// Which layer supplied each contract field for one task row. `absent` is its own state so a reader can tell "the record
// does not carry this" from "nobody looked" (error), and `derived` stays reserved for computed values.
const provenanceOf = (snapshotTask, recordRow) => {
  const sources = {}
  for (const field of CONTRACT_FIELDS) {
    if (recordRow !== undefined && recordRow[field] !== undefined) sources[field] = "record"
    else if (snapshotTask !== undefined && snapshotTask[field] !== undefined) sources[field] = "snapshot"
    else sources[field] = "absent"
  }
  return sources
}

export const mergeRecordTasks = (document, rows) => {
  if (!(document instanceof Object) || Array.isArray(document)) return document
  if (!Array.isArray(rows) || rows.length === 0) return document
  const container = document.tasks instanceof Object && !Array.isArray(document.tasks) ? document.tasks : {}
  const existing = Array.isArray(container.tasks) ? container.tasks : []
  const byId = new Map()
  const order = []
  for (const task of existing) {
    const id = asString(task?.task_id)
    if (id === null) continue
    byId.set(id, task)
    order.push(id)
  }
  let changed = false
  for (const row of rows) {
    const id = asString(row?.task_id)
    if (id === null) continue
    const current = byId.get(id)
    if (current === undefined) {
      byId.set(id, row)
      order.push(id)
      changed = true
      continue
    }
    // The record is the execution authority: it owns status, attribution, model, timings and errors. The snapshot keeps
    // every field the record cannot know (topology, rendering identity), so a stale snapshot row cannot outvote it.
    const merged = { ...current }
    let mergedChanged = false
    for (const field of RECORD_AUTHORITATIVE) {
      const value = row[field]
      if (value === undefined) continue
      if (merged[field] === value) continue
      merged[field] = value
      mergedChanged = true
    }
    if (mergedChanged) {
      byId.set(id, merged)
      changed = true
    }
  }
  if (!changed) return document
  const provenance = { ...(container.provenance instanceof Object ? container.provenance : {}) }
  for (const id of order) provenance[id] = provenanceOf(byId.get(id), rows.find((row) => asString(row?.task_id) === id))
  return { ...document, tasks: { ...container, tasks: order.map((id) => byId.get(id)), provenance } }
}
