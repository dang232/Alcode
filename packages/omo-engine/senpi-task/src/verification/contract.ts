// Shared verification vocabulary, extracted from the DAG evidence-first gate so every completion
// boundary speaks one contract instead of a second, parallel gate.
//
// Only the vocabulary lives here. The rules stay where they already are: `selectVerificationChecks`
// picks required checks from a change scope, `evaluateAcceptance` decides acceptance fail-closed,
// and both keep working for DAG and ULW exactly as before. A second policy would be a second gate.

export const VERIFICATION_STATUSES = [
  "pending",
  "running",
  "passed",
  "failed",
  "timed_out",
  "cancelled",
  "unavailable",
  "skipped",
  "stale",
] as const

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

// Only `passed` accepts. Every other status - including `skipped` and `stale` - blocks
// acceptance. There is no third outcome.
export function isVerificationAccepting(status: VerificationStatus): boolean {
  return status === "passed"
}

export const VERIFICATION_CHECK_CATEGORIES = [
  "unit",
  "integration",
  "typecheck",
  "lint",
  "build",
  "regression",
  "security",
  "schema",
  "session",
  "native",
] as const

export type VerificationCheckCategory = (typeof VERIFICATION_CHECK_CATEGORIES)[number]

// One check the engine must execute and record. `command` is an argv array, never a shell string,
// so no shell injection surface exists. `coveredPaths` scopes freshness: a change touching these
// paths invalidates the record; empty means run-scoped.
export type VerificationCheck = {
  readonly checkId: string
  readonly category: VerificationCheckCategory
  readonly command: readonly string[]
  readonly cwd?: string
  readonly timeoutMs: number
  readonly criteria: readonly string[]
  readonly coveredPaths?: readonly string[]
  readonly idempotent?: boolean
}

export type VerificationCommandResult = {
  readonly started: boolean
  readonly exitCode?: number
  readonly signal?: string
  readonly timedOut: boolean
  readonly cancelled: boolean
  readonly output: string
  readonly outputBytes: number
  readonly durationMs: number
  // True when the command may have changed state before it stopped (timeout or kill after start on
  // a non-idempotent check). A retry must reconcile first.
  readonly uncertainEffect: boolean
}

export type VerificationRunnerInput = {
  readonly check: VerificationCheck
  readonly projectDir: string
  readonly attempt: number
  readonly isCancelled?: () => boolean
}

export type VerificationRunner = (input: VerificationRunnerInput) => Promise<VerificationCommandResult>

// Failure vocabulary shared by the gate and the repair controller. `unknown` blocks acceptance
// exactly like a product defect; it never degrades to noise.
export const FAILURE_CLASSIFICATIONS = [
  "product_defect",
  "environment",
  "provider",
  "timeout",
  "flaky",
  "invalid_contract",
  "malformed_result",
  "unknown",
] as const

export type FailureClassification = (typeof FAILURE_CLASSIFICATIONS)[number]
