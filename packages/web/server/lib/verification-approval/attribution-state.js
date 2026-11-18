// Attribution state for the run-graph API.
//
// The engine's persisted task record (`<stateDir>/tasks/<taskId>.json`) is the
// only attribution authority: `child_session_id` and `owner {kind, runId,
// nodeId}` are the join keys. Nothing here infers an id from a node label, a
// run document, or UI state, and a field the record does not carry stays absent
// from both indexes instead of being guessed.
//
// This module lives beside the verification host action because that is the
// only build entry allowed to import the engine's TypeScript by relative path:
// `build:verification` bundles routes.js (which re-exports this module) into
// `server/dist/verification-approval.js` for the Node server, and the run-graph
// runtime loads that artifact instead of importing the .ts source itself.
//
// The reader is synchronous; `stateDirOf` and `fs` stay injectable so a test can
// pin the directory and the file system. The default reads the project's merged
// omo config and asks the engine's own `resolveStateDir`, never a parallel default.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { loadOmoConfig } from "../../../../omo-engine/omo-config-core/src/index.ts"
import { resolveStateDir } from "../../../../omo-engine/senpi-task/src/store/state-dir"

const DAG_OWNER_KIND = "dag"
const VERIFICATION_STATUSES = ["verified", "unverified", "blocked"]

// String-valued read without a typeof test: only a real string primitive
// stringifies to itself, so numbers/objects/arrays all read as absent.
const asString = (value) => (String(value) === value ? value : null)

const asId = (value) => {
  const text = asString(value)
  return text !== null && text.length > 0 ? text : null
}

const isRecord = (value) => value instanceof Object && !Array.isArray(value)

const messageOf = (error, fallback) => {
  const text = error instanceof Error ? asString(error.message) : null
  return text !== null && text.length > 0 ? text : fallback
}

const readFailureCode = (error) => (error instanceof Error && "code" in error ? error.code : undefined)

// `absent` distinguishes "this project never wrote task records" from "the
// records were read and yielded nothing"; only the former may read as a clean
// empty answer.
const emptyIndex = (absent) => ({
  absent,
  entries: [],
  byChildSessionId: {},
  byTaskId: {},
  collisions: [],
})

// The persisted completion-gate claim, read exactly like the host terminal reader: the record is
// the only authority. A completed record with no claim reads `unverified` (fail closed), so a posted
// "verified" can never borrow a record that never claimed it. A non-terminal record has no claim.
const verificationOf = (record) => {
  const claim = asString(record.verification_status)
  if (claim !== null && VERIFICATION_STATUSES.includes(claim)) return claim
  return asString(record.status) === "completed" ? "unverified" : null
}

// A persisted record contributes attribution only for what it actually holds.
// A non-DAG owner contributes no node identity at all, and a DAG owner missing
// either id contributes only the one it carries.
const attributionOf = (record) => {
  const taskId = asId(record.task_id)
  if (taskId === null) return null
  const childSessionId = asId(record.child_session_id)
  const owner = isRecord(record.owner) ? record.owner : null
  const dagOwned = owner !== null && owner.kind === DAG_OWNER_KIND
  return {
    taskId,
    childSessionId,
    parentSessionId: asId(record.parent_session_id),
    rootSessionId: asId(record.root_session_id),
    nodeId: dagOwned ? asId(owner.nodeId) : null,
    runId: dagOwned ? asId(owner.runId) : null,
    verificationStatus: verificationOf(record),
  }
}

const entryOf = (attribution) => {
  const entry = { taskId: attribution.taskId }
  if (attribution.childSessionId !== null) entry.childSessionId = attribution.childSessionId
  if (attribution.nodeId !== null) entry.nodeId = attribution.nodeId
  if (attribution.runId !== null) entry.runId = attribution.runId
  if (attribution.verificationStatus !== null) entry.verificationStatus = attribution.verificationStatus
  return entry
}

const byTaskOf = (attribution) => {
  const value = { taskId: attribution.taskId }
  if (attribution.childSessionId !== null) value.childSessionId = attribution.childSessionId
  // Session identity travels with the entry so a writer can prove the task belongs to the conversation it is writing,
  // instead of accepting "this task id exists somewhere in the project" as membership.
  if (attribution.parentSessionId !== null) value.parentSessionId = attribution.parentSessionId
  if (attribution.rootSessionId !== null) value.rootSessionId = attribution.rootSessionId
  if (attribution.nodeId !== null) value.nodeId = attribution.nodeId
  if (attribution.runId !== null) value.runId = attribution.runId
  if (attribution.verificationStatus !== null) value.verificationStatus = attribution.verificationStatus
  return value
}

const byChildSessionOf = (attribution) => {
  const value = { taskId: attribution.taskId }
  if (attribution.nodeId !== null) value.nodeId = attribution.nodeId
  if (attribution.runId !== null) value.runId = attribution.runId
  if (attribution.verificationStatus !== null) value.verificationStatus = attribution.verificationStatus
  return value
}

// A missing task directory is a normal empty result (`absent: true`); anything
// else that prevents listing or reading it is an explicit error. JSON that does
// not parse is never dropped from the index, because a dropped record would
// silently change the attribution the caller sees.
function readTaskRecords(tasksDir, fs) {
  let stat
  try {
    stat = fs.statSync(tasksDir)
  } catch (error) {
    if (readFailureCode(error) === "ENOENT") return { absent: true }
    return { error: `attribution state: task record directory unreadable: ${messageOf(error, "stat failed")}` }
  }
  if (!stat.isDirectory()) {
    return { error: "attribution state: task record path is not a directory" }
  }
  let names
  try {
    names = fs.readdirSync(tasksDir)
  } catch (error) {
    if (readFailureCode(error) === "ENOENT") return { absent: true }
    return { error: `attribution state: task record directory unreadable: ${messageOf(error, "list failed")}` }
  }
  const records = []
  for (const name of names.filter((entry) => asString(entry) !== null && entry.endsWith(".json")).sort()) {
    let raw
    try {
      raw = fs.readFileSync(join(tasksDir, name), "utf8")
    } catch (error) {
      return { error: `attribution state: task record unreadable for ${name}: ${messageOf(error, "read failed")}` }
    }
    let value
    try {
      value = JSON.parse(raw)
    } catch {
      return { error: `attribution state: task record malformed for ${name}` }
    }
    if (!isRecord(value)) {
      return { error: `attribution state: task record malformed for ${name}` }
    }
    records.push({ name, record: value })
  }
  return { records }
}

/**
 * Build the reader the run-graph runtime calls per project.
 *
 * `stateDirOf` and `fs` are injectable for tests; the defaults read the project's merged omo config
 * and resolve the directory through the engine's own `resolveStateDir`, so a project that configures
 * `task.state_dir` is read where the engine writes instead of at the default project directory.
 *
 * Returns one of:
 * - the index `{ absent, entries, byChildSessionId, byTaskId, collisions }`
 * - `{ absent: true, ...empty index }` when the project has no task records
 * - `{ error }` when the records could not be read (never an empty index)
 */
export function createAttributionStateReader(options = {}) {
  const stateDirOf = options.stateDirOf ?? ((directory) => {
    // The engine store resolves its directory as `task.state_dir ?? resolveProjectStateDirectory(...)`
    // (`store/state-dir.ts`). Read the same merged config and call the same resolver: resolving the
    // default here would list a directory the writer never used for a project that configured
    // `task.state_dir`, and report that as an authoritative absence.
    const configured = loadOmoConfig({ cwd: directory }).config.task?.state_dir
    return resolveStateDir(
      configured === undefined
        ? { project_dir: directory }
        : { project_dir: directory, task: { state_dir: configured } },
    )
  })
  const fs = options.fs ?? { readdirSync, readFileSync, statSync }
  return (input = {}) => {
    const directory = asString(input.directory)
    if (directory === null || directory.trim().length === 0) {
      return { error: "attribution state: a project directory is required" }
    }
    let stateDir
    try {
      stateDir = stateDirOf(directory)
    } catch (error) {
      return { error: `attribution state unavailable: ${messageOf(error, "state directory resolution failed")}` }
    }
    let inspected
    try {
      inspected = readTaskRecords(join(stateDir, "tasks"), fs)
    } catch (error) {
      return { error: `attribution state: task records unreadable: ${messageOf(error, "read failed")}` }
    }
    if (inspected.error !== undefined) return { error: inspected.error }
    if (inspected.absent === true) return emptyIndex(true)

    const index = emptyIndex(false)
    const claimsByChildSession = new Map()
    const seenTaskIds = new Set()
    for (const { name, record } of inspected.records) {
      const attribution = attributionOf(record)
      // A record with no persisted task id cannot be attributed; absence stays
      // absence instead of borrowing the file name as an invented id.
      if (attribution === null) continue
      if (seenTaskIds.has(attribution.taskId)) {
        return { error: `attribution state: duplicate task record for ${attribution.taskId} (${name})` }
      }
      seenTaskIds.add(attribution.taskId)
      index.entries.push(entryOf(attribution))
      index.byTaskId[attribution.taskId] = byTaskOf(attribution)
      if (attribution.childSessionId !== null) {
        const claims = claimsByChildSession.get(attribution.childSessionId) ?? []
        claims.push(attribution)
        claimsByChildSession.set(attribution.childSessionId, claims)
      }
    }

    for (const [childSessionId, claims] of claimsByChildSession) {
      if (claims.length === 1) {
        index.byChildSessionId[childSessionId] = byChildSessionOf(claims[0])
        continue
      }
      // Two task records claim one child session: report both instead of
      // letting read order pick the winner.
      index.collisions.push({ childSessionId, taskIds: claims.map((claim) => claim.taskId).sort() })
    }
    return index
  }
}
