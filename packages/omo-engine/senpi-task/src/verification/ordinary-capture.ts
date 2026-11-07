// Host-controlled verification capture for ordinary (non-DAG) child runs.
//
// The trust property this module exists to guarantee: the model never authors a verification record.
// It may ask for checks, but the host selects them with the existing policy, executes them with the
// existing argv runner, derives the status from the real execution result, and writes the record
// itself. No parameter of `capture` carries a status, an exit code, or an output summary.
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

// The reserved node segment DAG already uses for run-level checks; an ordinary run has no nodes.
export const ORDINARY_VERIFICATION_NODE = "run"

// Structural port satisfied by the DAG file store, which writes
// `verifications/<runId>/<nodeId>.<checkId>.<attempt>.json`.
export type OrdinaryEvidenceStore = {
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

// Resolved by the host from its own task record. A child that sends its own runId cannot reach
// another run's evidence, because the caller of `capture` is the host, not the child.
type OrdinaryRunBinding = {
  readonly runId: string
  readonly sessionId: string
  readonly epoch: number
}

type OrdinaryCaptureInput = {
  readonly binding: OrdinaryRunBinding
  readonly changedFiles: readonly string[]
  readonly available: readonly DagVerifyCheck[]
}

type OrdinaryCaptureResult = {
  readonly selection: DagSelectedChecks
  readonly records: readonly DagVerificationRecord[]
  readonly persistedPaths: readonly string[]
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
  return {
    async capture(input) {
      const selection = selectVerificationChecks(scopeFor(input.changedFiles), input.available)
      const records: DagVerificationRecord[] = []
      const persistedPaths: string[] = []
      for (const check of selection.required) {
        if (deps.isCancelled?.() === true) break
        // Read the revision immediately before running: the record then names the tree the command
        // actually saw, not a tree from before a concurrent edit.
        const sourceRevision = deps.currentRevision()
        const base = { check, projectDir: deps.projectDir, attempt: 1 }
        const result =
          deps.isCancelled === undefined
            ? await runner(base)
            : await runner({ ...base, isCancelled: deps.isCancelled })
        const record = buildVerificationRecord({
          runId: input.binding.runId,
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
        const path = deps.store.writeVerification(
          input.binding.runId,
          ORDINARY_VERIFICATION_NODE,
          check.checkId,
          1,
          serializeVerificationRecord(record),
        )
        records.push(record)
        persistedPaths.push(path)
      }
      return { selection, records, persistedPaths }
    },
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
