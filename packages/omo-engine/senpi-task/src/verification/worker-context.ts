// Host-owned resolution of "which run is this, and which tree did it run in" for verification.
//
// Every field here comes from the persisted task record the host wrote itself: `spawn_spec.cwd` is
// the directory the worker was actually launched in (for an isolated child that is its clone), and
// the epoch is the live run epoch. Nothing accepts a caller-supplied value, so a child request can
// never widen its own scope.

export type WorkerVerificationBinding = {
  readonly runId: string
  readonly sessionId: string
  readonly epoch: number
}

export type WorkerVerificationContext = {
  readonly binding: WorkerVerificationBinding
  readonly workspaceDir: string
}

// The narrow shape this resolver actually reads, so a TaskRecord satisfies it structurally and a
// test can build one without constructing a whole record.
export type WorkerContextSource = {
  readonly task_id: string
  readonly parent_session_id: string
  readonly status: string
  readonly notification: { readonly run_epoch: number }
  readonly spawn_spec?: { readonly cwd?: string }
}

const TERMINAL: ReadonlySet<string> = new Set(["completed", "error", "cancelled", "interrupted", "lost"])

// A terminal run cannot start new verification work, and a record without a persisted launch
// directory never had a proven workspace - both resolve to null rather than to a guess.
export function resolveWorkerVerificationContext(source: WorkerContextSource): WorkerVerificationContext | null {
  if (TERMINAL.has(source.status)) return null
  const workspaceDir = source.spawn_spec?.cwd
  if (workspaceDir === undefined || workspaceDir.length === 0) return null
  const epoch = source.notification.run_epoch
  if (!Number.isInteger(epoch) || epoch < 0) return null
  return {
    binding: { runId: source.task_id, sessionId: source.parent_session_id, epoch },
    workspaceDir,
  }
}
