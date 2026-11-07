// Repair-attempt state for the run/tasks API.
//
// Read-only projection over two authoritative sources, never over UI state:
//
// - the durable repair attempt store
//   (`<stateDir>/repairs/<taskId>/<attemptId>.json`, senpi-task repair/store.ts)
// - the persisted task record
//   (`<stateDir>/tasks/<taskId>.json`), which carries BOTH the completion
//   gate's `verification_status` and the run's current `notification.run_epoch`.
//
// The gate record is the only source of `verificationStatus`: an attempt's
// own state never contributes to it. Epoch fencing is deliberate - an attempt
// whose epoch differs from the record's current `run_epoch` is not current, so
// it is omitted entirely rather than shown as this run's repair.
//
// This module lives beside the verification host action because that is the
// only build entry allowed to import the engine's TypeScript by relative path:
// `build:verification` bundles routes.js (which re-exports this module) into
// `server/dist/verification-approval.js` for the Node server. The run-graph
// runtime loads that artifact; it never imports the .ts source itself.
//
// Fields the durable attempt record does not persist are reported as empty
// arrays (`hostFacts`, `modelHypotheses`) instead of being inferred from a
// plan or a state - an invented fact is worse than an absent one.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { createRepairAttemptStore } from "../../../../omo-engine/senpi-task/src/repair/store"
import { resolveProjectStateDirectory } from "../../../../omo-engine/senpi-task/src/store/project-state-directory"

const REPAIR_STATE_DIRECTORY = "senpi-task"
const VERIFICATION_STATUSES = ["verified", "unverified", "blocked"]
const CHANGED_FILES_PREFIX = "changedFiles: "
const RERUN_PREFIX = "rerun "

// String-valued read without a typeof test: only a real string primitive
// stringifies to itself, so numbers/objects/arrays all read as absent.
const asString = (value) => (String(value) === value ? value : null)

const isRecord = (value) => value instanceof Object && !Array.isArray(value)

// A task id is a path segment of the attempt store; a separator or a dot
// segment must never escape it.
const isSafeTaskId = (value) => {
  const text = asString(value)
  return text !== null && text.length > 0 && !/[\\/]/.test(text) && text !== "." && text !== ".."
}

const messageOf = (error, fallback) => {
  const text = error instanceof Error ? asString(error.message) : null
  return text !== null && text.length > 0 ? text : fallback
}

const readFailureCode = (error) => (error instanceof Error && "code" in error ? error.code : undefined)

// The engine store treats an unreadable task directory as ENOENT on Windows
// when a parent segment is a file, which would read as "no attempts". Inspect
// the directory first so a broken store is an explicit error, and compare the
// persisted record count with what the store accepted so a corrupt attempt
// file is surfaced instead of silently dropped.
function inspectRepairDirectory(stateDir, taskId) {
  const root = join(stateDir, "repairs")
  let rootStat
  try {
    rootStat = statSync(root)
  } catch (error) {
    if (readFailureCode(error) === "ENOENT") return { absent: true }
    return { error: `repair attempt store unreadable for ${taskId}: ${messageOf(error, "stat failed")}` }
  }
  if (!rootStat.isDirectory()) {
    return { error: `repair attempt store unreadable for ${taskId}: repairs is not a directory` }
  }
  const taskDir = join(root, taskId)
  let taskStat
  try {
    taskStat = statSync(taskDir)
  } catch (error) {
    if (readFailureCode(error) === "ENOENT") return { absent: true }
    return { error: `repair attempt store unreadable for ${taskId}: ${messageOf(error, "stat failed")}` }
  }
  if (!taskStat.isDirectory()) {
    return { error: `repair attempt store unreadable for ${taskId}: the task entry is not a directory` }
  }
  let entries
  try {
    entries = readdirSync(taskDir)
  } catch (error) {
    return { error: `repair attempt store unreadable for ${taskId}: ${messageOf(error, "list failed")}` }
  }
  return { records: entries.filter((entry) => entry.endsWith(".json")).length }
}

// The persisted task record is the epoch + gate authority. A missing record
// with attempts on disk is an error rather than "no repair": without the
// record there is no current epoch to fence against.
function readTaskRecord(stateDir, taskId) {
  const path = join(stateDir, "tasks", `${taskId}.json`)
  let raw
  try {
    raw = readFileSync(path, "utf8")
  } catch (error) {
    if (readFailureCode(error) === "ENOENT") {
      return { error: `repair state: task record missing for ${taskId}` }
    }
    return { error: `repair state: task record unreadable for ${taskId}: ${messageOf(error, "read failed")}` }
  }
  let record
  try {
    record = JSON.parse(raw)
  } catch {
    return { error: `repair state: task record malformed for ${taskId}` }
  }
  if (!isRecord(record) || !isRecord(record.notification)) {
    return { error: `repair state: task record has no run epoch for ${taskId}` }
  }
  const epoch = record.notification.run_epoch
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    return { error: `repair state: task record has no valid run epoch for ${taskId}` }
  }
  const claim = asString(record.verification_status)
  return {
    epoch,
    verificationStatus: claim !== null && VERIFICATION_STATUSES.includes(claim) ? claim : null,
  }
}

function rerunChecksOf(attempt) {
  if (!isRecord(attempt.plan) || !Array.isArray(attempt.plan.steps)) return []
  const checks = []
  for (const step of attempt.plan.steps) {
    const text = asString(step)
    if (text === null || !text.startsWith(RERUN_PREFIX)) continue
    const checkId = text.slice(RERUN_PREFIX.length).trim()
    if (checkId.length > 0 && !checks.includes(checkId)) checks.push(checkId)
  }
  return checks
}

// The orchestrator records the files an attempt ACTUALLY changed on the
// terminal outcome detail (`changedFiles: a, b`). The plan's `edit <file>`
// steps are planned targets, not changes, so they are never used here.
function changedFilesOf(attempt) {
  if (!isRecord(attempt.outcome)) return []
  const detail = asString(attempt.outcome.detail)
  if (detail === null || !detail.startsWith(CHANGED_FILES_PREFIX)) return []
  const files = []
  for (const entry of detail.slice(CHANGED_FILES_PREFIX.length).split(",")) {
    const file = entry.trim()
    if (file.length > 0 && !files.includes(file)) files.push(file)
  }
  return files
}

function projectRepair(attempt, taskId, verificationStatus) {
  return {
    attemptId: attempt.attemptId,
    taskId,
    epoch: attempt.runEpoch,
    state: attempt.state,
    failedChecks: Array.isArray(attempt.failedCheckIds) ? [...attempt.failedCheckIds] : [],
    rerunChecks: rerunChecksOf(attempt),
    changedFiles: changedFilesOf(attempt),
    verificationStatus,
    hostFacts: [],
    modelHypotheses: [],
    updatedAt: attempt.updatedAt,
  }
}

/**
 * Build the reader the run-graph runtime calls per record.
 *
 * `stateDirOf` is injectable for tests; the default resolves the same
 * per-project senpi-task state directory the engine writes.
 *
 * Returns one of:
 * - `{ repair }` - a current-epoch attempt exists for this task
 * - `{}` - no attempt at all (the payload carries no repair field)
 * - `{ error }` - the store/record could not be read (never "no repair")
 */
export function createRepairStateReader(options = {}) {
  const stateDirOf =
    options.stateDirOf ?? ((directory) => resolveProjectStateDirectory(directory, REPAIR_STATE_DIRECTORY))
  return (input = {}) => {
    const directory = asString(input.directory)
    const taskId = input.taskId
    if (directory === null || directory.trim().length === 0 || !isSafeTaskId(taskId)) {
      return { error: "repair state: a project directory and a task id are required" }
    }
    let stateDir
    try {
      stateDir = stateDirOf(directory)
    } catch (error) {
      return { error: `repair state unavailable: ${messageOf(error, "state directory resolution failed")}` }
    }
    let inspected
    try {
      inspected = inspectRepairDirectory(stateDir, taskId)
    } catch (error) {
      return { error: `repair attempt store unreadable for ${taskId}: ${messageOf(error, "inspect failed")}` }
    }
    if (inspected.error !== undefined) return { error: inspected.error }
    if (inspected.absent === true) return {}
    let attempts
    try {
      attempts = createRepairAttemptStore({ root: join(stateDir, "repairs") }).list(taskId)
    } catch (error) {
      return { error: `repair attempt store unreadable for ${taskId}: ${messageOf(error, "list failed")}` }
    }
    // A record the store skipped is corrupt, not absent: never report the run
    // as having no repair when a persisted attempt file exists on disk.
    if (attempts.length !== inspected.records) {
      const skipped = inspected.records - attempts.length
      return { error: `repair attempt store has ${skipped} unreadable record(s) for ${taskId}` }
    }
    // The store sorts oldest first; a missing task directory reads as [].
    if (attempts.length === 0) return {}
    const record = readTaskRecord(stateDir, taskId)
    if (record.error !== undefined) return { error: record.error }
    // Epoch fence: only an attempt minted for the record's CURRENT run_epoch
    // may be shown; an older attempt is stale, and a newer one is not this
    // run's state either. Never project a mismatched epoch as current.
    const current = attempts.filter((attempt) => attempt.runEpoch === record.epoch)
    if (current.length === 0) return {}
    const attempt = current[current.length - 1]
    return { repair: projectRepair(attempt, taskId, record.verificationStatus) }
  }
}
