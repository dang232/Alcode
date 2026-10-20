/**
 * Native team member operations: runtime error vocabulary and lane ports.
 *
 * Coordination with the runtime lane goes through `src/team/runtime.ts`
 * (owned by that lane; never edited here). The ports below are structural on
 * purpose: the runtime lane's manager and session handles satisfy them as long
 * as the shapes line up, so wiring to `runtime.ts` later is a type alias
 * rather than a rewrite.
 */

export type TeamRuntimeErrorCode =
  | "bounds_exceeded"
  | "member_start_rejected"
  | "create_deadline_exceeded"
  | "invalid_delete_state"
  | "sidecar_write_failed"

/**
 * Lifecycle failures distinct from spec normalization (`TeamSpecError`):
 * a bounds rejection before any spawn, a member start the manager refused, a
 * create-deadline breach, an illegal delete transition, and a member-sidecar
 * write failure. Carries the team identifier in play.
 */
export class TeamRuntimeError extends Error {
  readonly code: TeamRuntimeErrorCode
  readonly teamRef: string

  constructor(message: string, code: TeamRuntimeErrorCode, teamRef: string) {
    super(message)
    this.name = "TeamRuntimeError"
    this.code = code
    this.teamRef = teamRef
  }
}

export type MemberRespawnErrorCode =
  | "runtime_unavailable"
  | "runtime_inactive"
  | "member_missing"
  | "task_mapping_mismatch"
  | "session_unavailable"

/**
 * Recovery failures when respawning a lost member. Every path records the
 * member identity (`teamRunId` + `memberName`) so a lost member is never
 * dropped silently: the typed error IS the recorded error.
 */
export class MemberRespawnError extends Error {
  readonly code: MemberRespawnErrorCode
  readonly teamRunId: string
  readonly memberName: string

  constructor(code: MemberRespawnErrorCode, teamRunId: string, memberName: string, options?: { cause?: unknown }) {
    super(`Cannot respawn team member '${memberName}': ${code}`, options)
    this.name = "MemberRespawnError"
    this.code = code
    this.teamRunId = teamRunId
    this.memberName = memberName
  }
}

export type MemberRevivalErrorCode =
  | "runtime_unavailable"
  | "runtime_inactive"
  | "member_missing"
  | "member_not_finished"
  | "session_unavailable"

/**
 * Recovery failures when reviving a finished resident session. Carries the
 * member identity so the caller can record which member failed to revive.
 */
export class MemberRevivalError extends Error {
  readonly code: MemberRevivalErrorCode
  readonly teamRunId: string
  readonly memberName: string

  constructor(code: MemberRevivalErrorCode, teamRunId: string, memberName: string, options?: { cause?: unknown }) {
    super(`Cannot revive team member '${memberName}': ${code}`, options)
    this.name = "MemberRevivalError"
    this.code = code
    this.teamRunId = teamRunId
    this.memberName = memberName
  }
}

/**
 * Native member task lifecycle as observed through the live manager channel.
 * `suspended` covers a paused-but-revivable task; terminal failures collapse
 * to `failed`, `cancelled`, or `lost` at the projection boundary.
 */
export type MemberTaskStatus =
  | "pending"
  | "running"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled"
  | "lost"

export type MemberTaskRecord = {
  readonly status: MemberTaskStatus
  readonly childSessionId?: string
}

/**
 * Live status channel for member tasks. Backed by the runtime lane's manager
 * at wiring time; tests substitute a hand-written fake. A missing record
 * means "unknown", never "idle": the projection leaves such members alone.
 */
export type MemberStatusSource = {
  readonly get: (taskId: string) => MemberTaskRecord | undefined
  readonly getResidentHandle: (taskId: string) => { readonly sessionId: string | undefined } | undefined
}

export type MemberStartSpec = {
  readonly name: string
  readonly prompt: string
  readonly memberName: string
  readonly teamRunId: string
  readonly teamName: string
  readonly cwd?: string
  readonly extensions?: readonly string[]
  readonly memberEnv?: Readonly<Record<string, string>>
}

export type MemberStartOutcome = {
  readonly taskId: string
  readonly sessionId?: string
}

/**
 * Narrow spawn surface the member operations layers need from the runtime
 * lane. The runtime lane's manager satisfies this structurally.
 */
export type TeamMemberManagerPort = {
  readonly start: (spec: MemberStartSpec) => Promise<MemberStartOutcome>
}

export type TeamMemberExtensionConfig = {
  readonly entryPath: string
  readonly inheritedExtensions?: readonly string[]
}

export type SpawnMemberExtensionConfig = TeamMemberExtensionConfig & {
  readonly teamConfig: string
}
