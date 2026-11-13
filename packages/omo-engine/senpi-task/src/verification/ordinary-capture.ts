// Host-controlled verification capture for ordinary (non-DAG) child runs.
//
// The trust property this module exists to guarantee: the model never authors a verification record.
// It may ask for checks, but the host selects them with the existing policy, executes them with the
// existing argv runner, derives the status from the real execution result, and writes the record
// itself. No parameter of `capture` carries a status, an exit code, or an output summary.
import { basename } from "node:path"

import {
  buildVerificationRecord,
  checkVerificationFreshness,
  runVerificationCommand,
  selectVerificationChecks,
  serializeVerificationRecord,
  type DagChangeScope,
  type DagSelectedChecks,
  type DagVerificationFreshness,
  type DagVerificationRecord,
  type DagVerifyCheck,
  type DagVerifyRunner,
} from "../dag/verification"
import {
  readCaptureReceipt,
  readEvidenceFile,
  sha256Text,
  verificationReceiptRoot,
  writeCaptureReceipt,
  type CaptureReceiptRecord,
} from "./evidence-store"

// The reserved node segment DAG already uses for run-level checks; an ordinary run has no nodes.
export const ORDINARY_VERIFICATION_NODE = "run"

// Structural port satisfied by the DAG file store, which writes
// `verifications/<runId>/<nodeId>.<checkId>.<attempt>.json`.
export type OrdinaryEvidenceStore = {
  // The evidence tree this store writes into. The capture derives the receipt root as its sibling
  // so the receipt can never be written inside the directory the gate parses as records.
  readonly rootDir: string
  readonly writeVerification: (
    runId: string,
    nodeId: string,
    checkId: string,
    attempt: number,
    record: string,
  ) => string
  readonly readVerification: (
    runId: string,
    nodeId: string,
    checkId: string,
    attempt: number,
  ) => string | null
  readonly listVerifications: (runId: string) => readonly string[]
}

// Resolved by the host from its own task record. A child that sends its own identity cannot reach
// another task's evidence, because the caller of `capture` is the host, not the child. `taskId` is
// the PARENT task record's id and is the evidence namespace; `dagRunId` is traceability only and is
// deliberately never used as a storage key (DAG runs are reused by definition fingerprint).
type OrdinaryRunBinding = {
  readonly taskId: string
  readonly dagRunId?: string
  readonly sessionId: string
  readonly epoch: number
}

type OrdinaryCaptureInput = {
  readonly binding: OrdinaryRunBinding
  readonly changedFiles: readonly string[]
  readonly available: readonly DagVerifyCheck[]
  // The host-owned requirement set. When present the capture runs EXACTLY these checks and never
  // re-selects: a file-scope heuristic must not drop a check the completion gate will demand.
  readonly required?: readonly DagVerifyCheck[]
  // Evidence attempt number in the record filename. The ordinary run writes attempt 1; a post-
  // repair reverification writes the NEXT attempt so the original failed record survives on disk
  // as history instead of being overwritten by the rerun.
  readonly attempt?: number
}

type OrdinaryCaptureResult = {
  readonly selection: DagSelectedChecks
  readonly records: readonly DagVerificationRecord[]
  readonly persistedPaths: readonly string[]
  readonly receiptPath: string
}

export type OrdinaryVerificationCapture = {
  readonly capture: (input: OrdinaryCaptureInput) => Promise<OrdinaryCaptureResult>
}

export type OrdinaryCaptureDeps = {
  readonly store: OrdinaryEvidenceStore
  readonly projectDir: string
  readonly currentRevision: () => string
  readonly runner?: DagVerifyRunner
  readonly isCancelled?: () => boolean
  // Defaults to the evidence store's sibling receipt root; supplied only when a caller keeps its
  // evidence tree somewhere other than the canonical state directory.
  readonly receiptRoot?: string
}

const DOC_PATH = /(\.mdx?$)|(^docs?\/)|(^|\/)readme/i

function scopeFor(changedFiles: readonly string[]): DagChangeScope {
  const isDocsOnly = changedFiles.length > 0 && changedFiles.every((path) => DOC_PATH.test(path.replace(/\\/g, "/")))
  return {
    changedFiles,
    touchesScheduler: false,
    touchesCompletionGate: false,
    touchesWorkerLifecycle: false,
    touchesPersistedState: false,
    isDocsOnly,
  }
}

export function createOrdinaryVerificationCapture(deps: OrdinaryCaptureDeps): OrdinaryVerificationCapture {
  const runner: DagVerifyRunner = deps.runner ?? runVerificationCommand
  const receiptRoot = deps.receiptRoot ?? verificationReceiptRoot(deps.store.rootDir)
  return {
    async capture(input) {
      const selection: DagSelectedChecks = input.required === undefined
        ? selectVerificationChecks(scopeFor(input.changedFiles), input.available)
        : requiredSelection(input.required, input.available)
      const records: DagVerificationRecord[] = []
      const persistedPaths: string[] = []
      const attempt = input.attempt ?? 1
      for (const check of selection.required) {
        if (deps.isCancelled?.() === true) break
        // Read the revision immediately before running: the record then names the tree the command
        // actually saw, not a tree from before a concurrent edit.
        const sourceRevision = deps.currentRevision()
        const base = { check, projectDir: deps.projectDir, attempt }
        const result =
          deps.isCancelled === undefined
            ? await runner(base)
            : await runner({ ...base, isCancelled: deps.isCancelled })
        const record = buildVerificationRecord({
          runId: input.binding.dagRunId ?? input.binding.taskId,
          parentSessionId: input.binding.sessionId,
          rootSessionId: input.binding.sessionId,
          // The record schema has no epoch field; `workerAttempt` is the existing per-run attempt
          // counter, so an ordinary run binds its epoch there and freshness rejects a stale one.
          workerAttempt: input.binding.epoch,
          check,
          cwd: check.cwd === undefined ? deps.projectDir : check.cwd,
          projectDir: deps.projectDir,
          sourceRevision,
          generation: 0,
          repairAttempt: 0,
          result,
        })
        const serialized = serializeVerificationRecord(record)
        const path = deps.store.writeVerification(
          input.binding.taskId,
          ORDINARY_VERIFICATION_NODE,
          check.checkId,
          attempt,
          serialized,
        )
        records.push(record)
        persistedPaths.push(path)
      }
      // The receipt is the host's statement that these files are its own. Prior entries for this
      // (task, epoch) survive only while their bytes still match, so a repair's older attempt stays
      // accounted for as history without ever vouching for a rewritten file.
      const prior = readCaptureReceipt(receiptRoot, input.binding.taskId, input.binding.epoch)
      const kept: CaptureReceiptRecord[] = prior.kind === "found"
        ? prior.receipt.records.filter((entry) => {
            const text = readEvidenceFile(deps.store.rootDir, input.binding.taskId, entry.file)
            return text !== null && sha256Text(text) === entry.sha256
          })
        : []
      const written = records.map((record, index): CaptureReceiptRecord => {
        const path = persistedPaths[index]
        return {
          file: path === undefined ? "" : basename(path),
          sha256: sha256Text(serializeVerificationRecord(record)),
          checkId: record.checkId,
          status: record.status,
        }
      }).filter((entry) => entry.file.length > 0)
      const writtenFiles = new Set(written.map((entry) => entry.file))
      const receiptPath = writeCaptureReceipt(receiptRoot, {
        taskId: input.binding.taskId,
        epoch: input.binding.epoch,
        dagRunId: input.binding.dagRunId ?? input.binding.taskId,
        sourceRevision: records.at(-1)?.sourceRevision ?? "",
        records: [...kept.filter((entry) => !writtenFiles.has(entry.file)), ...written],
      })
      return { selection, records, persistedPaths, receiptPath }
    },
  }
}

function requiredSelection(
  required: readonly DagVerifyCheck[],
  available: readonly DagVerifyCheck[],
): DagSelectedChecks {
  const requiredIds = new Set(required.map((check) => check.checkId))
  return {
    required,
    omitted: available
      .filter((check) => !requiredIds.has(check.checkId))
      .map((check) => ({ check, reason: "not in the host-owned requirement set" })),
  }
}

// Provenance, not timestamps - the same rule the DAG gate applies, with the epoch bound through
// `workerAttempt`. An ordinary run passes `generation: 0` because it has no plan revisions.
export function ordinaryEvidenceFreshness(
  record: DagVerificationRecord,
  current: { readonly sourceRevision: string; readonly epoch: number },
): DagVerificationFreshness {
  if (record.workerAttempt !== undefined && record.workerAttempt !== current.epoch) {
    return { fresh: false, reason: "run epoch changed" }
  }
  return checkVerificationFreshness(
    record,
    { sourceRevision: current.sourceRevision, nodeFingerprints: new Map(), generation: 0 },
    record.repairAttempt,
  )
}
