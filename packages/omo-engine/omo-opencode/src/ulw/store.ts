/**
 * Native ULW run/roster/receipt store.
 *
 * Single-writer rule: this in-memory store is written only by native tools.
 * It holds no file handles and never touches `<repoRoot>/.omo/ulw-loop`
 * (brief.md, goals.json, ledger.jsonl): those files stay CLI-written and
 * are treated as read-only from here. A run that needs to survive the
 * process boundary is re-created by the native tool that owns it; the store
 * never infers state from the CLI loop files.
 */

import { randomUUID } from "node:crypto"

import {
  goalNotDispatchedError,
  goalSessionMismatchError,
  invalidInputError,
  runNotActiveError,
  runNotFoundError,
} from "./errors.ts"
import type {
  CreateUlwRunInput,
  RecordUlwChildResultInput,
  UlwChildReceipts,
  UlwChildResultReceipt,
  UlwChildResultStatus,
  UlwDispatchRoster,
  UlwMissingReceipts,
  UlwRunRecord,
  UlwRunStatus,
} from "./types.ts"

export type UlwStoreOptions = {
  /** Millis source; defaults to `Date.now`. Inject a fixed clock in tests. */
  readonly now?: () => number
  /** Run id source; defaults to `randomUUID`. Inject a counter in tests. */
  readonly newRunId?: () => string
}

type UlwRunState = {
  record: UlwRunRecord
  /** Goal id -> dispatched worker session ids, in dispatch order. */
  roster: Map<string, string[]>
  /** Goal id -> collected child result. At most one receipt per goal. */
  receipts: Map<string, UlwChildResultReceipt>
}

function isoNow(now: () => number): string {
  return new Date(now()).toISOString()
}

type UlwReceiptBase = Pick<UlwChildResultReceipt, "goalId" | "childSessionId" | "status" | "recordedAt">

/** Attaches the optional receipt fields only when present, so absent evidence stays absent. */
function finishReceipt(base: UlwReceiptBase, resultRef: string | undefined, reason: string | undefined): UlwChildResultReceipt {
  if (resultRef !== undefined && reason !== undefined) return { ...base, resultRef, reason }
  if (resultRef !== undefined) return { ...base, resultRef }
  if (reason !== undefined) return { ...base, reason }
  return { ...base }
}

function requireText(value: string, field: string, runId: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw invalidInputError(runId, `ULW ${field} must be a non-empty string.`)
  }
  return trimmed
}

/**
 * In-memory native ULW store: run records, per-run dispatch rosters, and
 * per-goal child-result receipts. One instance owns its runs; runs are
 * isolated by id so one failed goal never blocks an unrelated run.
 */
export class UlwStore {
  private readonly runs = new Map<string, UlwRunState>()
  private readonly now: () => number
  private readonly newRunId: () => string

  constructor(options: UlwStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.newRunId = options.newRunId ?? randomUUID
  }

  /** Creates a run in `active` status and returns its record. */
  createRun(input: CreateUlwRunInput): UlwRunRecord {
    const brief = input.brief.trim()
    if (brief.length === 0) {
      throw invalidInputError("", "ULW run brief must be a non-empty string.")
    }
    const sessionScope = input.sessionScope.trim()
    if (sessionScope.length === 0) {
      throw invalidInputError("", "ULW run sessionScope must be a non-empty string.")
    }
    const now = input.now ?? this.now
    const id = input.id?.trim() || this.newRunId()
    if (this.runs.has(id)) {
      throw invalidInputError(id, `ULW run '${id}' already exists.`)
    }
    const at = isoNow(now)
    const record: UlwRunRecord = { id, brief, sessionScope, status: "active", createdAt: at, updatedAt: at }
    this.runs.set(id, { record, roster: new Map(), receipts: new Map() })
    return record
  }

  /** Returns the run record, or `undefined` for an unknown id. Never throws. */
  getRun(runId: string): UlwRunRecord | undefined {
    return this.runs.get(runId)?.record
  }

  /** Lists every run record in creation order. */
  listRuns(): readonly UlwRunRecord[] {
    return [...this.runs.values()].map((state) => state.record)
  }

  /** Moves a run to a new status and returns the updated record. Refuses transitions once the run has left `active`: terminal states are terminal. */
  setRunStatus(runId: string, status: UlwRunStatus, now?: () => number): UlwRunRecord {
    const state = this.requireActiveState(runId)
    const at = isoNow(now ?? this.now)
    state.record = { ...state.record, status, updatedAt: at }
    return state.record
  }

  /**
   * Dispatches a goal to a worker session, appending to the goal's roster
   * entry. Repeat dispatches for the same goal accumulate; an identical
   * `(goalId, workerSessionId)` pair is recorded once.
   */
  dispatchGoal(runId: string, goalId: string, workerSessionId: string): readonly string[] {
    const state = this.requireActiveState(runId)
    const goal = requireText(goalId, "goalId", runId)
    const worker = requireText(workerSessionId, "workerSessionId", runId)
    const entry = state.roster.get(goal) ?? []
    if (!entry.includes(worker)) {
      entry.push(worker)
      state.roster.set(goal, entry)
    }
    return [...entry]
  }

  /** Goal ids with at least one dispatch, in first-dispatch order. */
  dispatchedGoalIds(runId: string): readonly string[] {
    return [...this.requireState(runId).roster.keys()]
  }

  /** Frozen copy of the run's dispatch roster. */
  rosterFor(runId: string): UlwDispatchRoster {
    const roster: Record<string, readonly string[]> = {}
    for (const [goalId, workers] of this.requireState(runId).roster) {
      roster[goalId] = [...workers]
    }
    return roster
  }

  /**
   * Records a dispatched child's result under its goal id. The latest
   * recording wins. Throws `GOAL_NOT_DISPATCHED` when the goal was never
   * dispatched, and `GOAL_SESSION_MISMATCH` when the reporting session is
   * not one of the goal's dispatched workers: a receipt must always settle
   * a real dispatch, never a stranger session.
   */
  recordChildResult(
    runId: string,
    goalId: string,
    input: RecordUlwChildResultInput,
  ): UlwChildResultReceipt {
    const state = this.requireActiveState(runId)
    const goal = requireText(goalId, "goalId", runId)
    if (!state.roster.has(goal)) {
      throw goalNotDispatchedError(runId, goal)
    }
    const childSessionId = requireText(input.childSessionId, "childSessionId", runId)
    const dispatched = state.roster.get(goal) ?? []
    if (!dispatched.includes(childSessionId)) {
      throw goalSessionMismatchError(runId, goal, childSessionId)
    }
    const receipt = finishReceipt(
      {
        goalId: goal,
        childSessionId,
        status: input.status ?? "completed",
        recordedAt: isoNow(input.now ?? this.now),
      },
      input.resultRef?.trim() || undefined,
      input.reason?.trim() || undefined,
    )
    state.receipts.set(goal, receipt)
    return receipt
  }

  /** Returns the receipt for a goal, or `undefined` when none was recorded. */
  receiptFor(runId: string, goalId: string): UlwChildResultReceipt | undefined {
    return this.requireState(runId).receipts.get(goalId)
  }

  /** Frozen copy of every receipt in the run, keyed by goal id. */
  receiptsFor(runId: string): UlwChildReceipts {
    const receipts: Record<string, UlwChildResultReceipt> = {}
    for (const [goalId, receipt] of this.requireState(runId).receipts) {
      receipts[goalId] = receipt
    }
    return receipts
  }

  /**
   * Dispatched goal ids with no recorded child result, sorted for a stable
   * refusal message. When `goalIds` is given, only those goals are checked;
   * undispatched ids in the filter are ignored (nothing is pending for them).
   */
  missingReceipts(runId: string, goalIds?: readonly string[]): UlwMissingReceipts {
    const state = this.requireState(runId)
    const candidates =
      goalIds === undefined ? [...state.roster.keys()] : goalIds.filter((goalId) => state.roster.has(goalId))
    return candidates.filter((goalId) => !state.receipts.has(goalId)).sort()
  }

  private requireState(runId: string): UlwRunState {
    const state = this.runs.get(runId)
    if (state === undefined) {
      throw runNotFoundError(runId)
    }
    return state
  }

  private requireActiveState(runId: string): UlwRunState {
    const state = this.requireState(runId)
    if (state.record.status !== "active") {
      throw runNotActiveError(runId, state.record.status)
    }
    return state
  }
}
