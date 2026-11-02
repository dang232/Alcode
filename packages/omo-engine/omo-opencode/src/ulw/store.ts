/**
 * Native ULW run/roster/receipt store.
 *
 * Single-writer rule: this in-memory store is written only by native tools.
 * It holds no file handles and never touches `<repoRoot>/.omo/ulw-loop`
 * (brief.md, goals.json, ledger.jsonl): those files stay CLI-written and
 * are treated as read-only from here.
 *
 * Durability (see `./persistence.ts`): with a `persistence` adapter the
 * store loads one versioned JSON snapshot at construction and saves
 * atomically (temp file plus rename) after every mutation. Production
 * points it at `<dataDir>/ulw/store.json` through `ALCODE_ULW_STORE_FILE`
 * (wired by the web server into the managed OpenCode child env). Recovery
 * derives interruptions from roster-minus-receipts and reconciles them
 * against the host; a run that needs to survive the process boundary is
 * otherwise re-created by the native tool that owns it — never inferred
 * from the CLI loop files, never resurrected as a phantom.
 */

import { randomUUID } from "node:crypto"

import {
  goalNotDispatchedError,
  goalSessionMismatchError,
  invalidInputError,
  runNotActiveError,
  runNotFoundError,
} from "./errors.ts"
import { ULW_STORE_SCHEMA_VERSION, mergePersistedStates } from "./persistence.ts"
import type { PersistedUlwState, UlwPersistence } from "./persistence.ts"
import type {
  CreateUlwRunInput,
  RecordUlwChildResultInput,
  UlwChildReceipts,
  UlwChildResultReceipt,
  UlwChildResultStatus,
  UlwDispatchRoster,
  UlwMissingReceipts,
  UlwOpenRunResult,
  UlwReconciledWorkers,
  UlwRunRecord,
  UlwRunStatus,
} from "./types.ts"

export type UlwStoreOptions = {
  /** Millis source; defaults to `Date.now`. Inject a fixed clock in tests. */
  readonly now?: () => number
  /** Run id source; defaults to `randomUUID`. Inject a counter in tests. */
  readonly newRunId?: () => string
  /**
   * Durable storage; when present the store loads it at construction and
   * saves after every mutation. Absent means process-scoped and in-memory.
   */
  readonly persistence?: UlwPersistence | null
}

/** How the store's durable state loaded: clean boot, recovered runs, or a miss with its reason. */
export type UlwLoadReport =
  | { readonly durable: false; readonly reason: "ephemeral" }
  | { readonly durable: true; readonly reason: "no-store"; readonly recoveredRuns: 0 }
  | { readonly durable: true; readonly reason: "recovered"; readonly recoveredRuns: number }
  | { readonly durable: true; readonly reason: string; readonly recoveredRuns: 0 }

/** Interrupted dispatch: a worker session with no receipt, partitioned by host liveness. */
export type UlwInterruptedWorker = {
  readonly goalId: string
  readonly workerSessionId: string
  /** `dead` workers were confirmed gone; `awaiting` workers may still be alive. */
  readonly state: "awaiting" | "dead"
}

type UlwRunState = {
  record: UlwRunRecord
  /** Goal id -> dispatched worker session ids, in dispatch order. */
  roster: Map<string, string[]>
  /** Goal id -> collected child result. At most one receipt per goal. */
  receipts: Map<string, UlwChildResultReceipt>
  /** Goal id -> worker sessions confirmed gone by reconciliation. */
  deadWorkers: Map<string, string[]>
}

/** One submission opens exactly one root run: the accepted run id per submission identity. */
type UlwSubmissionClaims = Map<string, string>

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
  private readonly persistence: UlwPersistence | null
  private readonly loadReport: UlwLoadReport
  private lastSaveError: string | null = null
  /** Last generation this store wrote or loaded; a newer file generation triggers a merge, never an overwrite. */
  private generation = 0
  /** Submission identity -> accepted run id. One submission opens exactly one root run. */
  private submissionClaims: UlwSubmissionClaims = new Map()

  constructor(options: UlwStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.newRunId = options.newRunId ?? randomUUID
    this.persistence = options.persistence ?? null
    if (this.persistence === null) {
      this.loadReport = { durable: false, reason: "ephemeral" }
    } else {
      const loaded = this.persistence.load()
      if (!loaded.ok) {
        this.loadReport = { durable: true, reason: loaded.reason, recoveredRuns: 0 }
      } else {
        this.restoreState(loaded.state)
        this.generation = loaded.state.generation
        this.loadReport =
          loaded.state.runs.length === 0
            ? { durable: true, reason: "no-store", recoveredRuns: 0 }
            : { durable: true, reason: "recovered", recoveredRuns: loaded.state.runs.length }
      }
    }
  }

  /** How durable loading went: clean boot, recovered runs, or a miss with its reason. Never throws. */
  getLoadReport(): UlwLoadReport {
    return this.loadReport
  }

  /** The last save failure, or null when every save so far succeeded. Mutations still apply when saving fails. */
  getLastSaveError(): string | null {
    return this.lastSaveError
  }

  /** Creates a run in `active` status and returns its record. */
  createRun(input: CreateUlwRunInput): UlwRunRecord {
    const submissionId = input.submissionId?.trim()
    if (submissionId !== undefined && submissionId.length > 0 && this.submissionClaims.has(submissionId)) {
      throw invalidInputError(
        this.submissionClaims.get(submissionId) ?? "",
        `ULW submission '${submissionId}' was already accepted; open it instead of creating a duplicate run.`,
      )
    }
    const record = this.insertRun(input, submissionId)
    this.save()
    return record
  }

  /** The run id an accepted submission resolved to, or `undefined` when unknown. Never throws. */
  runIdForSubmission(submissionId: string): string | undefined {
    return this.submissionClaims.get(submissionId)
  }

  /**
   * Idempotent run open keyed by pending submission identity. A retried or
   * concurrently delivered submission with an accepted identity returns the
   * same run instead of forking a duplicate; a genuinely new submission
   * creates exactly one run and claims the identity atomically with it.
   * The claim and the run publish in one locked save, so a restart between
   * duplicate deliveries still resolves to the single accepted run.
   */
  openRun(input: CreateUlwRunInput): UlwOpenRunResult {
    const submissionId = input.submissionId?.trim()
    if (submissionId === undefined || submissionId.length === 0) {
      return { record: this.createRun(input), deduped: false }
    }
    if (this.persistence !== null) {
      // Decide and publish atomically: reload under the file lock so a
      // concurrent duplicate that already saved (possibly in another
      // process) is seen before this open mints anything. A newer file is
      // merged, not just adopted, so memory-only claims accepted during an
      // earlier lock failure survive instead of being replaced away — a
      // redelivery then still resolves to the single accepted run.
      // insertRun never saves itself, so the single transact publish is
      // the only write: no nested lock, no partial claim without its run.
      // A contended lock falls back to a lock-free claim read below: when
      // the accepted run is already published, resolve to it instead of
      // failing or forking a duplicate. Only a genuinely unclaimed
      // submission with a live lock holder reports the contention.
      try {
        return this.persistence.transact((current) => {
        if (current !== null && current.generation > this.generation) {
          this.restoreState(mergePersistedStates(current, this.snapshotState()))
          this.generation = current.generation
        }
        const claimed = this.claimedRecord(submissionId)
        if (claimed !== undefined) {
          this.generation += 1
          return {
            state: { ...this.snapshotState(), generation: this.generation },
            result: { record: claimed, deduped: true },
          }
        }
        const record = this.insertRun(input, submissionId)
        this.generation += 1
        return {
          state: { ...this.snapshotState(), generation: this.generation },
          result: { record, deduped: false },
        }
        })
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("locked by another writer")) throw error
        const loaded = this.persistence.load()
        if (loaded.ok) {
          const claimedId = loaded.state.submissionClaims[submissionId]
          const claimed = claimedId === undefined ? undefined : loaded.state.runs.find((run) => run.record.id === claimedId)?.record
          if (claimed !== undefined) return { record: claimed, deduped: true }
        }
        throw error
      }
    }
    const claimed = this.claimedRecord(submissionId)
    if (claimed !== undefined) return { record: claimed, deduped: true }
    const record = this.insertRun(input, submissionId)
    this.save()
    return { record, deduped: false }
  }

  private claimedRecord(submissionId: string): UlwRunRecord | undefined {
    const claimedId = this.submissionClaims.get(submissionId)
    if (claimedId === undefined) return undefined
    return this.runs.get(claimedId)?.record
  }

  /**
   * Validates and inserts a run plus its submission claim without saving.
   * Callers publish exactly once: directly (single save) or through one
   * locked transact publish. Never call save() between insert and publish.
   */
  private insertRun(input: CreateUlwRunInput, submissionId?: string): UlwRunRecord {
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
    this.runs.set(id, { record, roster: new Map(), receipts: new Map(), deadWorkers: new Map() })
    if (submissionId !== undefined && submissionId.length > 0) {
      this.submissionClaims.set(submissionId, id)
    }
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
    this.save()
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
    this.save()
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
    this.save()
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

  /**
   * Plain-data snapshot of every run for persistence. Dead-worker history
   * rides along so a restart keeps the awaiting/dead distinction instead of
   * re-asking the host about sessions it already buried.
   */
  snapshotState(): PersistedUlwState {
    return {
      version: ULW_STORE_SCHEMA_VERSION,
      savedAt: isoNow(this.now),
      generation: this.generation,
      submissionClaims: Object.fromEntries(this.submissionClaims),
      runs: [...this.runs.values()].map((state) => ({
        record: state.record,
        roster: Object.fromEntries([...state.roster.entries()].map(([goal, workers]) => [goal, [...workers]] as const)),
        receipts: Object.fromEntries(
          [...state.receipts.entries()].map(([goal, receipt]) => [goal, { ...receipt }] as const),
        ),
        deadWorkers: Object.fromEntries(
          [...state.deadWorkers.entries()].map(([goal, workers]) => [goal, [...workers]] as const),
        ),
      }))
    }
  }

  private restoreState(state: PersistedUlwState): void {
    this.submissionClaims = new Map(Object.entries(state.submissionClaims ?? {}))
    for (const run of state.runs) {
      this.runs.set(run.record.id, {
        record: run.record,
        roster: new Map(Object.entries(run.roster).map(([goal, workers]) => [goal, [...workers]] as const)),
        receipts: new Map(Object.entries(run.receipts).map(([goal, receipt]) => [goal, { ...receipt }] as const)),
        deadWorkers: new Map(
          Object.entries(run.deadWorkers ?? {}).map(([goal, workers]) => [goal, [...workers]] as const),
        ),
      })
    }
  }

  private save(): void {
    if (this.persistence === null) return
    try {
      // Locked read-merge-write: the file lock serializes writers across
      // processes, and the generation check plus merge covers a writer that
      // mutated between this store's load and its turn. A newer file
      // generation means another writer saved first: merge instead of
      // clobbering its runs, adopt the merged state, and publish with the
      // next generation. A contended lock fails this save fast with a
      // recorded error while memory stays authoritative; the next mutation
      // retries, so no accepted update is silently lost.
      this.persistence.transact((current) => {
        let state = this.snapshotState()
        if (current !== null && current.generation > this.generation) {
          state = mergePersistedStates(current, state)
          this.restoreState(state)
        }
        this.generation += 1
        return { state: { ...state, generation: this.generation }, result: undefined }
      })
      this.lastSaveError = null
    } catch (error) {
      // In-memory state stays authoritative: a failed save is reported,
      // never thrown into the tool path that just mutated the run.
      this.lastSaveError = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * Dispatched workers with no receipt, partitioned by reconciliation:
   * `dead` workers were confirmed gone, `awaiting` workers may still be
   * alive and recoverable. Derived from roster-minus-receipts, so it can
   * never invent work the roster does not name.
   */
  interruptedFor(runId: string): readonly UlwInterruptedWorker[] {
    const state = this.requireState(runId)
    const interrupted: UlwInterruptedWorker[] = []
    for (const [goal, workers] of state.roster) {
      if (state.receipts.has(goal)) continue
      const dead = state.deadWorkers.get(goal) ?? []
      for (const workerSessionId of workers) {
        interrupted.push({ goalId: goal, workerSessionId, state: dead.includes(workerSessionId) ? "dead" : "awaiting" })
      }
    }
    return interrupted
  }

  /**
   * Reconciles interrupted workers against actual host session state.
   * Workers the host confirms gone are recorded dead (persisted); workers
   * still alive stay `awaiting` so their late receipts can settle the goal.
   * Never spawns, never redispatches: recovery is always an explicit
   * re-dispatch with a new worker session, never a silent resurrection.
   */
  reconcileRun(runId: string, isSessionAlive: (workerSessionId: string) => boolean): UlwReconciledWorkers {
    const state = this.requireState(runId)
    const alive: string[] = []
    const dead: string[] = []
    for (const [goal, workers] of state.roster) {
      if (state.receipts.has(goal)) continue
      for (const workerSessionId of workers) {
        // Read the live list per worker: a stale snapshot here drops every
        // newly-dead worker but the last for goals with several workers.
        if ((state.deadWorkers.get(goal) ?? []).includes(workerSessionId)) {
          dead.push(workerSessionId)
          continue
        }
        let aliveNow = false
        try {
          aliveNow = isSessionAlive(workerSessionId) === true
        } catch {
          aliveNow = false
        }
        if (aliveNow) {
          alive.push(workerSessionId)
        } else {
          dead.push(workerSessionId)
          state.deadWorkers.set(goal, [...(state.deadWorkers.get(goal) ?? []), workerSessionId])
        }
      }
    }
    this.save()
    return { alive, dead }
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
