/**
 * Native ULW run/roster/receipt types.
 *
 * This module is the native counterpart to the CLI-owned loop files under
 * `<repoRoot>/.omo/ulw-loop` (brief.md, goals.json, ledger.jsonl). Those
 * files stay CLI-written: native code treats them as read-only and never
 * writes them. All native writes go through the in-memory store in
 * `./store.ts` (single-writer rule: written only by native tools).
 *
 * Shape summary:
 * - run record: id, brief, session scope, status lifecycle.
 * - dispatch roster: goal id -> worker session ids that were dispatched.
 * - child-result receipts: keyed by goal id, one receipt per dispatched goal.
 * - checkpoint gating (see `./checkpoint.ts`) refuses any goal whose
 *   dispatch has no matching receipt.
 */

/** Lifecycle of a native ULW run record. */
export type UlwRunStatus = "active" | "complete" | "failed" | "blocked"

/**
 * A single native ULW run: the brief being worked, the session scope that
 * owns it, and the current status. The store assigns `createdAt`/`updatedAt`
 * as ISO timestamps; callers may inject `now` for deterministic tests.
 */
export type UlwRunRecord = {
  readonly id: string
  readonly brief: string
  readonly sessionScope: string
  readonly status: UlwRunStatus
  readonly createdAt: string
  readonly updatedAt: string
}

/** Input for creating a run. `id` and `now` are optional test seams. */
export type CreateUlwRunInput = {
  readonly brief: string
  readonly sessionScope: string
  readonly id?: string
  readonly now?: () => number
  /**
   * Pending submission identity claiming this open. When the identity was
   * already accepted, the existing run is returned instead of a duplicate.
   */
  readonly submissionId?: string
}

/**
 * Dispatch roster for one run: each goal id maps to the worker session ids
 * dispatched for it. A goal with zero entries was never dispatched.
 */
export type UlwDispatchRoster = Readonly<Record<string, readonly string[]>>

/** Terminal state recorded for one dispatched child. */
type UlwChildResultStatus = "completed" | "failed"

/**
 * Receipt proving a dispatched child's result was collected. Keyed by goal
 * id in the store, so at most one receipt exists per goal: the latest
 * recording wins.
 */
export type UlwChildResultReceipt = {
  readonly goalId: string
  readonly childSessionId: string
  readonly status: UlwChildResultStatus
  readonly recordedAt: string
  readonly resultRef?: string
  readonly reason?: string
}

/** Input for recording a child result. `recordedAt` is store-assigned. */
/** Every collected child result in a run, keyed by goal id. */
export type UlwChildReceipts = Readonly<Record<string, UlwChildResultReceipt>>

export type RecordUlwChildResultInput = {
  readonly childSessionId: string
  readonly status?: UlwChildResultStatus
  readonly resultRef?: string
  readonly reason?: string
  readonly now?: () => number
}

/** Goal ids whose dispatch has no matching receipt yet. */
export type UlwMissingReceipts = readonly string[]

/** Result of opening a run: the accepted record and whether it already existed. */
export type UlwOpenRunResult = {
  readonly record: UlwRunRecord
  readonly deduped: boolean
}

/** Reconciled workers: still-alive sessions stay recoverable, dead ones need explicit re-dispatch. */
export type UlwReconciledWorkers = {
  readonly alive: readonly string[]
  readonly dead: readonly string[]
}
