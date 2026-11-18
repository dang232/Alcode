// Delivery state for the run-graph API: the persisted task record's status and verification claim.
//
// The record (`<stateDir>/tasks/<taskId>.json`) is the only authority. Delivery status and
// verification status are reported as two separate fields, and a verification value outside the
// engine's vocabulary reads as null instead of being guessed into a claim.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { loadOmoConfig } from "../../../../omo-engine/omo-config-core/src/index.ts"
import { resolveStateDir } from "../../../../omo-engine/senpi-task/src/store/state-dir"

const VERIFICATION_STATUSES = ["verified", "unverified", "blocked"]

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

const isSafeTaskId = (value) => value.length > 0 && !/[\\/]/.test(value) && value !== "." && value !== ".."

const defaultStateDirOf = (directory) => {
  const configured = loadOmoConfig({ cwd: directory }).config.task?.state_dir
  return resolveStateDir(
    configured === undefined
      ? { project_dir: directory }
      : { project_dir: directory, task: { state_dir: configured } },
  )
}

export function createDeliveryStateReader(options = {}) {
  const stateDirOf = options.stateDirOf ?? defaultStateDirOf
  const readFile = options.readFile ?? readFileSync

  return (input = {}) => {
    const directory = asString(input.directory)
    const taskId = asId(input.taskId)
    if (directory === null || directory.trim().length === 0 || taskId === null) {
      return { error: "delivery state: a project directory and a task id are required" }
    }
    if (!isSafeTaskId(taskId)) {
      return { error: "delivery state: the task id is not a safe file segment" }
    }

    let stateDir
    try {
      stateDir = stateDirOf(directory)
    } catch (error) {
      return { error: `delivery state unavailable: ${messageOf(error, "state directory resolution failed")}` }
    }

    let raw
    try {
      raw = readFile(join(stateDir, "tasks", `${taskId}.json`), "utf8")
    } catch (error) {
      const code = readFailureCode(error)
      if (code === "ENOENT" || code === "ENOTDIR") return { absent: true }
      return { error: `delivery state: record unreadable for ${taskId}: ${messageOf(error, "read failed")}` }
    }

    let record
    try {
      record = JSON.parse(raw)
    } catch {
      return { error: `delivery state: record malformed for ${taskId}` }
    }
    if (!isRecord(record)) {
      return { error: `delivery state: record malformed for ${taskId}` }
    }

    const status = asString(record.status)
    if (status === null || status.length === 0) {
      return { error: `delivery state: record ${taskId} carries no status` }
    }
    const claim = asString(record.verification_status)
    const verificationStatus = claim !== null && VERIFICATION_STATUSES.includes(claim) ? claim : null

    return {
      delivery: {
        taskId,
        status,
        verificationStatus,
        childSessionId: asString(record.child_session_id),
        updatedAt: asString(record.updated_at),
      },
    }
  }
}
