/**
 * persistence.ts — durable storage for the native ULW store.
 *
 * The store itself (`./store.ts`) is process-scoped and in-memory; this
 * module decides what survives the process boundary. Runs, rosters, and
 * receipts persist as ONE versioned JSON snapshot per file, written
 * atomically (temporary file plus rename, the same publish discipline as
 * the code-graph snapshot store): a process crash mid-write leaves the
 * previous complete snapshot in place, never a torn file the next boot
 * mistakes for state.
 *
 * Power-loss durability is explicitly out of scope: no fsync/fdatasync or
 * directory fsync is issued, so an OS crash or power loss may lose the
 * latest publish even after rename returns. The next boot then reads the
 * previous complete snapshot, never a torn write. The product contract is
 * restart recovery across process exits, not power-loss durability, so
 * this window is accepted and documented here instead of hidden.
 *
 * Loading never throws and never claims recovery it cannot prove. A
 * missing file is a clean boot, not an error; a corrupt or versioned
 * snapshot is reported through the load reason and the store starts empty.
 * Interrupted work (dispatched, no receipt) is DERIVED on load from
 * roster-minus-receipts, never persisted as a separate claim, so a stale
 * write cannot invent or erase an interruption.
 */

import { z } from "zod"

import type { OmoJsonObject } from "../plugin-types.ts"
import type {
  UlwChildReceipts,
  UlwChildResultReceipt,
  UlwDispatchRoster,
  UlwRunRecord,
  UlwRunStatus,
} from "./types.ts"

/** Terminal truth wins: a recorded failure must never be overwritten by a concurrent success. */
const STATUS_PRIORITY: readonly UlwRunStatus[] = ["active", "complete", "blocked", "failed"]

function mergeStatus(left: UlwRunStatus, right: UlwRunStatus): UlwRunStatus {
  return STATUS_PRIORITY.indexOf(right) >= STATUS_PRIORITY.indexOf(left) ? right : left
}

function mergeReceipts(
  left: UlwChildReceipts,
  right: UlwChildReceipts,
): UlwChildReceipts {
  const merged: Record<string, UlwChildResultReceipt> = {}
  for (const [goalId, receipt] of Object.entries({ ...left, ...right })) {
    const other = (left[goalId] === receipt ? right : left)[goalId]
    if (other === undefined || receipt.recordedAt >= other.recordedAt) {
      merged[goalId] = { ...receipt }
    } else {
      merged[goalId] = { ...other }
    }
  }
  return merged
}

function unionWorkers(left: readonly string[] = [], right: readonly string[] = []): readonly string[] {
  return [...left, ...right.filter((worker) => !left.includes(worker))]
}

/**
 * Deterministic union of two snapshots for load-merge-save: every run,
 * dispatch, receipt, and dead-worker marker from either side survives.
 * Per-goal receipts keep the latest recording; run status keeps the
 * terminal-most state. Either input may be stale; the merge never invents
 * runs, dispatches, or receipts neither side names.
 */
export function mergePersistedStates(file: PersistedUlwState, memory: PersistedUlwState): PersistedUlwState {
  const runs: PersistedUlwRun[] = []
  const byId = new Map<string, PersistedUlwRun>()
  for (const run of [...file.runs, ...memory.runs]) {
    const kept = byId.get(run.record.id)
    if (kept === undefined) {
      byId.set(run.record.id, {
        record: { ...run.record },
        roster: Object.fromEntries(Object.entries(run.roster).map(([goal, workers]) => [goal, [...workers]] as const)),
        receipts: Object.fromEntries(
          Object.entries(run.receipts).map(([goal, receipt]) => [goal, { ...receipt }] as const),
        ),
        deadWorkers: Object.fromEntries(
          Object.entries(run.deadWorkers).map(([goal, workers]) => [goal, [...workers]] as const),
        ),
      })
      continue
    }
    const roster = { ...kept.roster }
    for (const [goal, workers] of Object.entries(run.roster)) {
      roster[goal] = unionWorkers(roster[goal] ?? [], workers)
    }
    const deadWorkers = { ...kept.deadWorkers }
    for (const [goal, workers] of Object.entries(run.deadWorkers)) {
      deadWorkers[goal] = unionWorkers(deadWorkers[goal] ?? [], workers)
    }
    const receipts = mergeReceipts(kept.receipts, run.receipts)
    const status = mergeStatus(kept.record.status, run.record.status)
    const updatedAt = kept.record.updatedAt >= run.record.updatedAt ? kept.record.updatedAt : run.record.updatedAt
    byId.set(run.record.id, {
      record: { ...kept.record, status, updatedAt },
      roster,
      receipts,
      deadWorkers,
    })
  }
  runs.push(...byId.values())
  // Submission claims follow the newer published snapshot: merge runs only
  // when the file is newer than what memory last saw, so the file already
  // holds every claim accepted before this save. A claim this store accepted
  // concurrently survives via the union; a key both sides claimed resolves
  // to the file's run, so a duplicate can never steal the identity — it
  // resolves to the same run instead.
  const submissionClaims = { ...memory.submissionClaims, ...file.submissionClaims }
  return {
    version: ULW_STORE_SCHEMA_VERSION,
    savedAt: file.savedAt,
    generation: Math.max(file.generation, memory.generation),
    runs,
    submissionClaims,
  }
}

/** On-disk schema version. Bump when the snapshot shape changes; older versions load as a miss. */
export const ULW_STORE_SCHEMA_VERSION = 1

/** Plain-data snapshot of every run the store owns. */
export type PersistedUlwState = {
  readonly version: number
  readonly savedAt: string
  /** Monotonic publish counter; a save that sees a newer file merges instead of overwriting. */
  readonly generation: number
  readonly runs: readonly PersistedUlwRun[]
  readonly submissionClaims: PersistedUlwSubmissionClaims
}

export type PersistedUlwRun = {
  readonly record: UlwRunRecord
  readonly roster: UlwDispatchRoster
  readonly receipts: UlwChildReceipts
  readonly deadWorkers: Readonly<Record<string, readonly string[]>>
}

type PersistedUlwSubmissionClaims = Record<string, string>

export type UlwLoadResult =
  | { readonly ok: true; readonly state: PersistedUlwState }
  | { readonly ok: false; readonly reason: string }

/** Synchronous persistence seam: the store's API is sync, so file IO is sync too. */
export type UlwPersistence = {
  load(): UlwLoadResult
  save(state: PersistedUlwState): void
  /**
   * Locked read-modify-write: loads the current snapshot, lets the caller
   * derive the next one, and publishes it atomically, returning the
   * caller's result. Concurrent writers serialize on the lock instead of
   * silently overwriting each other, so the decision and its publish share
   * one atomic section.
   */
  transact<T>(next: (current: PersistedUlwState | null) => { state: PersistedUlwState; result: T }): T
}

/** How long a lock may be held before it is treated as orphaned by a dead process. */
const ULW_STORE_LOCK_STALE_MS = 30_000

/** Per-acquire token suffix; distinguishes lock holders that share a pid. */
let lockCounter = 0

export type SyncFs = {
  readFileSync(path: string, encoding: "utf8"): string
  writeFileSync(path: string, data: string, encoding: "utf8"): void
  renameSync(tmpPath: string, targetPath: string): void
  rmSync(path: string, options?: { force?: boolean; recursive?: boolean }): void
  mkdirSync(path: string, options?: { recursive?: boolean }): void
  statSync(path: string): { mtimeMs: number }
}

const ReceiptSchema = z
  .object({
    goalId: z.string().min(1),
    childSessionId: z.string().min(1),
    status: z.enum(["completed", "failed"]),
    recordedAt: z.string().min(1),
    resultRef: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict()

const RunSchema = z
  .object({
    record: z
      .object({
        id: z.string().min(1),
        brief: z.string(),
        sessionScope: z.string(),
        status: z.enum(["active", "complete", "failed", "blocked"]),
        createdAt: z.string(),
        updatedAt: z.string(),
      })
      .strict(),
    roster: z.record(z.string(), z.array(z.string())),
    receipts: z.record(z.string(), ReceiptSchema),
    deadWorkers: z.record(z.string(), z.array(z.string())).optional(),
  })
  .strict()
  .superRefine((run, context) => {
    // A receipt must settle a real dispatch, exactly like the live store enforces.
    for (const [goalId, receipt] of Object.entries(run.receipts)) {
      if (!(run.roster[goalId] ?? []).includes(receipt.childSessionId)) {
        context.addIssue({ code: "custom", message: `receipt for '${goalId}' settles no dispatch` })
      }
    }
    // Dead workers are history of real dispatches, never invented ids.
    for (const [goalId, workers] of Object.entries(run.deadWorkers ?? {})) {
      if (!workers.every((worker) => (run.roster[goalId] ?? []).includes(worker))) {
        context.addIssue({ code: "custom", message: `dead worker for '${goalId}' was never dispatched` })
      }
    }
  })

const holderTimestampSchema = z.object({
  at: z.number(),
})

const SnapshotSchema = z
  .object({
    version: z.literal(ULW_STORE_SCHEMA_VERSION),
    savedAt: z.string(),
    generation: z.number().int().nonnegative().default(0),
    runs: z.array(RunSchema),
    submissionClaims: z.record(z.string(), z.string().min(1)).default({}),
  })
  .strict()

/**
 * Validates an untrusted snapshot; returns null when it must not be trusted.
 * The input is the tool boundary's JSON document type; the schema below
 * proves every field before anything is trusted.
 */
export function parsePersistedUlwState(value: OmoJsonObject): PersistedUlwState | null {
  const parsed = SnapshotSchema.safeParse(value)
  if (!parsed.success) return null
  return {
    version: parsed.data.version,
    savedAt: parsed.data.savedAt,
    generation: parsed.data.generation,
    submissionClaims: { ...parsed.data.submissionClaims },
    runs: parsed.data.runs.map((run) => ({
      record: run.record,
      roster: Object.fromEntries(Object.entries(run.roster).map(([goal, workers]) => [goal, [...workers]] as const)),
      receipts: Object.fromEntries(
        Object.entries(run.receipts).map(([goal, receipt]) => [goal, { ...receipt }] as const),
      ),
      deadWorkers: Object.fromEntries(
        Object.entries(run.deadWorkers ?? {}).map(([goal, workers]) => [goal, [...workers]] as const),
      ),
    })),
  }
}

/**
 * File-backed persistence with atomic publish: the snapshot serializes to a
 * sibling temporary file that is renamed over the target, so readers only
 * ever see the previous complete snapshot or the new one — never a half
 * write. Parent directories are created on demand. Save failures throw to
 * the store, which records them without failing the mutation they follow.
 */
export class FileUlwPersistence implements UlwPersistence {
  private readonly fs: SyncFs
  private readonly filePath: string
  private readonly now: () => number

  constructor(options: { fs: SyncFs; filePath: string; now?: () => number }) {
    this.fs = options.fs
    this.filePath = options.filePath
    this.now = options.now ?? Date.now
  }

  load(): UlwLoadResult {
    let text: string
    try {
      text = this.fs.readFileSync(this.filePath, "utf8")
    } catch (error) {
      // SAFETY: only the errno code is read, which exists on NodeJS.ErrnoException and is undefined otherwise.
      const code = (error as NodeJS.ErrnoException)?.code
      if (code === "ENOENT") return { ok: false, reason: "no-store" }
      return { ok: false, reason: `unreadable-store: ${error instanceof Error ? error.message : String(error)}` }
    }
    let parsed: OmoJsonObject
    try {
      // SAFETY: file bytes enter only as the tool boundary's JSON document type; the schema below proves every field before use.
      parsed = JSON.parse(text) as OmoJsonObject
    } catch {
      return { ok: false, reason: "corrupt-store" }
    }
    const state = parsePersistedUlwState(parsed)
    if (state === null) {
      return { ok: false, reason: "corrupt-store" }
    }
    return { ok: true, state }
  }

  save(state: PersistedUlwState): void {
    // All publishes funnel through the lock, including this convenience
    // path: nothing writes the snapshot file without serializing first.
    this.transact<void>(() => ({ state, result: undefined }))
  }

  /**
   * Locked read-modify-write across processes. The lock is a directory:
   * creating it is atomic on POSIX and Windows, so exactly one writer
   * proceeds while the others fail fast with a recorded `store-locked`
   * error instead of silently overwriting each other. A lock older than
   * `ULW_STORE_LOCK_STALE_MS` belongs to a dead process — a live holder
   * only ever holds it across synchronous calls — so the next writer
   * breaks it and proceeds. The lock never blocks: a contended save
   * reports and retries on the next mutation, while memory stays
   * authoritative so no accepted update is lost in-process.
   */
  transact<T>(next: (current: PersistedUlwState | null) => { state: PersistedUlwState; result: T }): T {
    const lastSeparator = Math.max(this.filePath.lastIndexOf("/"), this.filePath.lastIndexOf("\\"))
    if (lastSeparator > 0) {
      this.fs.mkdirSync(this.filePath.slice(0, lastSeparator), { recursive: true })
    }
    const lockDir = `${this.filePath}.lockdir`
    const holderFile = `${lockDir}/holder.json`
    const token = this.acquireLock(lockDir, holderFile)
    try {
      const loaded = this.load()
      const { state, result } = next(loaded.ok ? loaded.state : null)
      this.checkLock(holderFile, token)
      this.publish(state)
      return result
    } finally {
      this.releaseLock(lockDir, holderFile, token)
    }
  }

  private acquireLock(lockDir: string, holderFile: string): string {
    // Uniqueness must survive pid reuse and counter reset after a restart:
    // a delayed writer that outlives the stale timeout must never pass
    // checkLock against a successor that happened to mint the same token.
    const token = `${process.pid}-${lockCounter++}-${Math.random().toString(36).slice(2, 10)}`
    try {
      this.fs.mkdirSync(lockDir)
    } catch (error) {
      // SAFETY: only the errno code is read, which exists on NodeJS.ErrnoException and is undefined otherwise.
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error
      if (!this.breakStaleLock(lockDir, holderFile)) {
        throw new Error(`ulw store locked by another writer: ${lockDir}`)
      }
      try {
        this.fs.mkdirSync(lockDir)
      } catch (retryError) {
        // Another breaker won the mkdir race between our rm and retry:
        // report contention, not a raw EEXIST, so callers retry or resolve.
        // SAFETY: only the errno code is read, which exists on NodeJS.ErrnoException and is undefined otherwise.
        if ((retryError as NodeJS.ErrnoException)?.code === "EEXIST") {
          throw new Error(`ulw store locked by another writer: ${lockDir}`)
        }
        throw retryError
      }
    }
    this.fs.writeFileSync(holderFile, JSON.stringify({ token, at: this.now() }), "utf8")
    return token
  }

  /**
   * Re-reads the holder immediately before publishing. A writer stalled
   * past the stale timeout may have had its lock broken and taken by
   * another writer; publishing anyway would silently clobber that writer's
   * snapshot. Failing here turns the pathological interleaving into a loud
   * retryable error instead of silent loss.
   */
  private checkLock(holderFile: string, token: string): void {
    let current: unknown
    try {
      current = JSON.parse(this.fs.readFileSync(holderFile, "utf8"))
    } catch {
      throw new Error(`ulw store lock lost before publish: ${this.filePath}`)
    }
    const parsed = z.object({ token: z.string() }).safeParse(current)
    if (!parsed.success || parsed.data.token !== token) {
      throw new Error(`ulw store lock lost before publish: ${this.filePath}`)
    }
  }

  /**
   * Releases only the lock this writer still owns. A writer that lost its
   * lock (stalled past the stale timeout while another writer broke and
   * reacquired it) must not delete its successor's live lockdir: an
   * unconditional remove would let a third writer enter while the
   * successor is still inside its critical section, reopening the
   * merge-versus-publication race the pre-publish check just closed.
   */
  private releaseLock(lockDir: string, holderFile: string, token: string): void {
    try {
      let current: unknown
      try {
        current = JSON.parse(this.fs.readFileSync(holderFile, "utf8"))
      } catch {
        return
      }
      const parsed = z.object({ token: z.string() }).safeParse(current)
      if (!parsed.success || parsed.data.token !== token) return
      this.fs.rmSync(lockDir, { force: true, recursive: true })
    } catch {
      // Best-effort release; a stale lock is broken by the next writer.
    }
  }

  private breakStaleLock(lockDir: string, holderFile: string): boolean {
    let at = Number.NaN
    try {
      // The holder file is written by acquireLock above; anything else on
      // disk is untrusted input, so only a validated numeric timestamp counts.
      const holder = holderTimestampSchema.safeParse(JSON.parse(this.fs.readFileSync(holderFile, "utf8")))
      at = holder.success ? holder.data.at : Number.NaN
    } catch {
      at = Number.NaN
    }
    if (Number.isNaN(at)) {
      try {
        at = this.fs.statSync(lockDir).mtimeMs
      } catch {
        return true
      }
    }
    if (this.now() - at <= ULW_STORE_LOCK_STALE_MS) return false
    try {
      this.fs.rmSync(lockDir, { force: true, recursive: true })
    } catch {
      return false
    }
    return true
  }

  private publish(state: PersistedUlwState): void {
    const lastSeparator = Math.max(this.filePath.lastIndexOf("/"), this.filePath.lastIndexOf("\\"))
    if (lastSeparator > 0) {
      this.fs.mkdirSync(this.filePath.slice(0, lastSeparator), { recursive: true })
    }
    const temporary = `${this.filePath}.tmp-${process.pid}`
    // A failed publish must not litter temp files next to the snapshot.
    // A process crash mid-write can still leave one behind; loading only
    // ever reads the target, so a stale temp file is inert, never state.
    try {
      this.fs.writeFileSync(temporary, JSON.stringify({ ...state, savedAt: new Date(this.now()).toISOString() }), "utf8")
      this.fs.renameSync(temporary, this.filePath)
    } catch (error) {
      try {
        this.fs.rmSync(temporary, { force: true })
      } catch {
        // Best-effort cleanup; the original failure travels below.
      }
      throw error
    }
  }
}
