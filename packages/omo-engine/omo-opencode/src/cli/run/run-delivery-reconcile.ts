// run-delivery-reconcile.ts — re-derive run-graph rows from the durable records, which stay the
// source of truth when another writer replaces the document or a publish is interrupted.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Type, type Static } from "typebox"
import { Value } from "typebox/value"

import { resolveProjectStateDirectory } from "../../../../senpi-task/src/store/project-state-directory"
import { taskEventLogPath } from "../../../../senpi-task/src/store/event-log"
import { writeDeliverySnapshot, type DeliverySnapshotRecord, type DeliverySnapshotWrite } from "./run-delivery-snapshot"

export type ReconcileFailure = {
  readonly taskId: string
  readonly reason: string
}

export type ReconcileReport = {
  readonly stateDir: string
  readonly scanned: number
  readonly sessions: number
  readonly written: number
  readonly skipped: number
  readonly failures: readonly ReconcileFailure[]
  readonly absent?: boolean
  readonly error?: string
}

const PersistedRecordSchema = Type.Object(
  {
    task_id: Type.String(),
    status: Type.String(),
    child_session_id: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    task_summary: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    started_at: Type.Optional(Type.String()),
    terminal_at: Type.Optional(Type.String()),
    verification_status: Type.Optional(Type.String()),
    final_response: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

const DeliveryEventSchema = Type.Object(
  {
    type: Type.String(),
    payload: Type.Optional(Type.Object({ exitCode: Type.Optional(Type.Number()) }, { additionalProperties: true })),
  },
  { additionalProperties: true },
)

type PersistedRecord = Static<typeof PersistedRecordSchema>

export type RecordScan = {
  readonly records: PersistedRecord[]
  readonly failures: ReconcileFailure[]
  readonly absent?: boolean
  readonly error?: string
}

const NONZERO_MARKER = "completed with non-zero exit"

const decode = (raw: string): Static<typeof PersistedRecordSchema> | null => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const toRecord = (source: PersistedRecord): DeliverySnapshotRecord => {
  const record: DeliverySnapshotRecord = { task_id: source.task_id, status: source.status }
  if (source.child_session_id !== undefined) record.child_session_id = source.child_session_id
  if (source.name !== undefined) record.name = source.name
  if (source.task_summary !== undefined) record.task_summary = source.task_summary
  if (source.model !== undefined) record.model = source.model
  if (source.started_at !== undefined) record.started_at = source.started_at
  if (source.terminal_at !== undefined) record.terminal_at = source.terminal_at
  if (source.verification_status !== undefined) record.verification_status = source.verification_status
  if (source.final_response === NONZERO_MARKER) record.nonzero_exit = true
  return record
}

function readRecords(stateDir: string): RecordScan {
  let names: string[]
  try {
    names = readdirSync(join(stateDir, "tasks")).filter((name) => name.endsWith(".json"))
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught))
    const code = "code" in error ? String(error.code) : undefined
    if (code === "ENOENT") return { records: [], failures: [], absent: true }
    return { records: [], failures: [], error: `task records unreadable: ${error.message}` }
  }

  const records: PersistedRecord[] = []
  const failures: ReconcileFailure[] = []
  for (const name of names.sort()) {
    let raw: string
    try {
      raw = readFileSync(join(stateDir, "tasks", name), "utf8")
    } catch {
      failures.push({ taskId: name, reason: "record file unreadable or malformed" })
      continue
    }
    const decoded = decode(raw)
    if (decoded === null) {
      failures.push({ taskId: name, reason: "record file is not valid JSON" })
      continue
    }
    if (!Value.Check(PersistedRecordSchema, decoded)) {
      failures.push({ taskId: name, reason: "record carries no string task_id or status" })
      continue
    }
    records.push(decoded)
  }
  return { records, failures }
}

function exitCodeOf(stateDir: string, taskId: string): number | undefined {
  let raw: string
  try {
    raw = readFileSync(taskEventLogPath(stateDir, taskId), "utf8")
  } catch {
    return undefined
  }
  let found: number | undefined
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    let decoded: Static<typeof DeliveryEventSchema> | null = null
    try {
      decoded = JSON.parse(line)
    } catch {
      continue
    }
    if (decoded === null || !Value.Check(DeliveryEventSchema, decoded)) continue
    if (decoded.type !== "run_delivery") continue
    const exitCode = decoded.payload?.exitCode
    if (exitCode !== undefined) found = exitCode
  }
  return found
}

export function reconcileRunSnapshots(input: {
  readonly directory: string
  readonly stateDir?: string
  readonly updatedAt: string
  readonly write?: (args: Parameters<typeof writeDeliverySnapshot>[0]) => DeliverySnapshotWrite
}): ReconcileReport {
  const stateDir = input.stateDir ?? resolveProjectStateDirectory(input.directory, "senpi-task")
  const write = input.write ?? writeDeliverySnapshot
  const scan = readRecords(stateDir)
  if (scan.error !== undefined) {
    return { stateDir, scanned: 0, sessions: 0, written: 0, skipped: 0, failures: [], error: scan.error }
  }

  const failures: ReconcileFailure[] = [...scan.failures]
  const sessions = new Set<string>()
  let written = 0
  let skipped = 0

  for (const source of scan.records) {
    const sessionId = source.child_session_id
    if (sessionId === undefined || sessionId.trim().length === 0) {
      failures.push({ taskId: source.task_id, reason: "record names no child session" })
      continue
    }
    sessions.add(sessionId)
    const record = toRecord(source)
    const exitCode = exitCodeOf(stateDir, source.task_id)
    if (exitCode !== undefined) record.exit_code = exitCode
    const outcome = write({ directory: input.directory, sessionId, record, updatedAt: input.updatedAt })
    if (outcome.written) written += 1
    else if (outcome.reason === "snapshot already current") skipped += 1
    else failures.push({ taskId: source.task_id, reason: outcome.reason })
  }

  const report: ReconcileReport = {
    stateDir,
    scanned: scan.records.length,
    sessions: sessions.size,
    written,
    skipped,
    failures,
  }
  return scan.absent === true ? { ...report, absent: true } : report
}
