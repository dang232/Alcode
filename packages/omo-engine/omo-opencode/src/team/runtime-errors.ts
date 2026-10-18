export type TeamRuntimeErrorCode =
  | "bounds_exceeded"
  | "member_start_rejected"
  | "create_deadline_exceeded"
  | "invalid_delete_state"
  | "missing_lead_session"
  | "shutdown_failed"
  | "unknown_member"
  | "no_pending_request"

/**
 * Raised by the native team runtime for lifecycle failures: bounds
 * rejection before any spawn, a rejected member start, a create-deadline
 * breach, an illegal delete transition, a missing lead session at teardown,
 * a shutdown that could not cancel every member, and the shutdown-handshake
 * failures. Carries the team run in play.
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
