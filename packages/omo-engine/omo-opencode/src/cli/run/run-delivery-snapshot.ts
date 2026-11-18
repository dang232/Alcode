// run-delivery-snapshot.ts — the delivery projector's view of the run snapshot.
// The mutation protocol (lock, validation, fencing, atomic publish) lives in
// run-snapshot-store.ts; this file only derives a delivery row and merges it.

import { readFileSync } from "node:fs"

import {
  DAG_RUNS_DIRNAME,
  DAG_SNAPSHOT_SCHEMA_VERSION,
  isSafeSessionSegment,
  mutateRunSnapshot,
  snapshotPathFor,
  type SnapshotDocument,
  type SnapshotNode,
  type SnapshotRun,
} from "./run-snapshot-store"

export { DAG_RUNS_DIRNAME, DAG_SNAPSHOT_SCHEMA_VERSION }

export const DELIVERY_RUN_KEY_PREFIX = "delivery:"

const PROMPT_LIMIT = 400

export type DeliverySnapshotRecord = {
  task_id: string
  status: string
  child_session_id?: string
  name?: string
  task_summary?: string
  model?: string
  started_at?: string
  terminal_at?: string
  exit_code?: number
  nonzero_exit?: boolean
  verification_status?: string
}

export type DeliverySnapshotWrite =
  | { readonly written: true; readonly path: string }
  | { readonly written: false; readonly reason: string }

export type RunCounts = {
  pending: number
  running: number
  completed: number
  failed: number
  cancelled: number
}

export type WireRun = {
  run_id: string
  run_key: string
  name: string
  status: string
  counts: RunCounts
  nodes: SnapshotNode[]
  edges: Array<{ from: string; to: string }>
  waves: Array<{ index: number; node_ids: string[] }>
}

function nodeStateOf(status: string): string {
  switch (status) {
    case "completed":
      return "completed"
    case "failed":
    case "error":
    case "lost":
      return "failed"
    case "cancelled":
    case "interrupted":
      return "cancelled"
    case "running":
      return "running"
    default:
      return "pending"
  }
}

function runStatusOf(state: string): string {
  if (state === "failed") return "failed"
  if (state === "cancelled") return "cancelled"
  if (state === "completed") return "completed"
  return "running"
}

const TERMINAL_STATES = ["completed", "failed", "cancelled"]

const isTerminalState = (state: string): boolean => TERMINAL_STATES.includes(state)

function countsOf(nodes: readonly SnapshotNode[]): RunCounts {
  const counts: RunCounts = { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 }
  for (const node of nodes) {
    const state = node.state ?? "pending"
    if (state === "failed") counts.failed += 1
    else if (state === "cancelled") counts.cancelled += 1
    else if (state === "completed") counts.completed += 1
    else if (state === "running") counts.running += 1
    else counts.pending += 1
  }
  return counts
}

/** A non-zero execution exit fails the delivery even when the turn itself finished. */
export function deliveryStateOf(record: DeliverySnapshotRecord): string {
  if (record.nonzero_exit === true) return "failed"
  if (record.exit_code !== undefined && record.exit_code !== 0) return "failed"
  return nodeStateOf(record.status)
}

function labelOf(record: DeliverySnapshotRecord): string {
  const name = (record.name ?? "").trim()
  const summary = (record.task_summary ?? "").trim()
  if (name.length > 0 && summary.length > 0) return `${name} — ${summary}`
  if (name.length > 0) return name
  if (summary.length > 0) return summary
  return record.task_id
}

export function deliveryRunOf(record: DeliverySnapshotRecord, sessionId: string): WireRun {
  const state = deliveryStateOf(record)
  const node: SnapshotNode = {
    id: sessionId,
    label: labelOf(record),
    state,
    attempt: 1,
    prompt: (record.task_summary ?? labelOf(record)).slice(0, PROMPT_LIMIT),
    depends_on: [],
    started_at: record.started_at ?? null,
    completed_at: record.terminal_at ?? null,
    task_id: record.task_id,
  }
  if (record.exit_code !== undefined) node.exit_code = record.exit_code
  if (record.verification_status !== undefined) node.verification_status = record.verification_status
  return {
    run_id: record.task_id,
    run_key: `${DELIVERY_RUN_KEY_PREFIX}${record.task_id}`,
    name: labelOf(record),
    status: runStatusOf(state),
    counts: countsOf([node]),
    nodes: [node],
    edges: [],
    waves: [{ index: 0, node_ids: [sessionId] }],
  }
}

function mergeDeliveryRuns(
  doc: SnapshotDocument | null,
  deliveryRun: WireRun,
): { runs: SnapshotRun[] } | { refuse: string } {
  const runs: SnapshotRun[] = doc === null ? [] : [...doc.dag.runs]
  const position = runs.findIndex((run) => run.run_id === deliveryRun.run_id)
  if (position !== -1) {
    // A finished row never goes back to running: an out-of-order or repeated event
    // for the same task cannot undo a terminal state it already reached.
    const priorState = runs[position].nodes?.[0]?.state ?? ""
    if (isTerminalState(priorState) && !isTerminalState(deliveryRun.nodes[0].state ?? "pending")) {
      return { refuse: `terminal state ${priorState} already recorded for ${deliveryRun.run_id}` }
    }
    runs[position] = deliveryRun
  } else {
    runs.push(deliveryRun)
  }
  return { runs }
}

export function writeDeliverySnapshot(input: {
  readonly directory: string
  readonly sessionId: string
  readonly record: DeliverySnapshotRecord
  readonly updatedAt: string
  readonly readFile?: (path: string) => string
}): DeliverySnapshotWrite {
  const sessionId = input.sessionId.trim()
  if (!isSafeSessionSegment(sessionId)) {
    return { written: false, reason: "session id is not a safe file segment" }
  }
  if (input.record.task_id.trim().length === 0) {
    return { written: false, reason: "record has no task id" }
  }
  const path = snapshotPathFor(input.directory, sessionId)
  const readFile = input.readFile ?? ((target: string) => readFileSync(target, "utf8"))

  const result = mutateRunSnapshot<WireRun>({
    path,
    updatedAt: input.updatedAt,
    readFile,
    mutate: ({ doc }) => {
      const deliveryRun = deliveryRunOf(input.record, sessionId)
      const merged = mergeDeliveryRuns(doc, deliveryRun)
      if ("refuse" in merged) return merged
      const base: SnapshotDocument =
        doc ?? { schemaVersion: DAG_SNAPSHOT_SCHEMA_VERSION, sessionId, updatedAt: input.updatedAt, dag: { runs: [] } }
      const next: SnapshotDocument = {
        ...base,
        schemaVersion: DAG_SNAPSHOT_SCHEMA_VERSION,
        sessionId,
        updatedAt: input.updatedAt,
        directory: input.directory,
        dag: { ...base.dag, runs: merged.runs },
        tasks: base.tasks ?? null,
      }
      return { doc: next, value: deliveryRun }
    },
  })

  return result.written ? { written: true, path: result.path } : { written: false, reason: result.reason }
}
