/**
 * Native team member operations: spec and registry failures.
 *
 * A team that fails here is recorded in the registry `errors` list and spawns
 * zero members. Callers distinguish the reserved-name paths (raw `lead`
 * field, a member named `lead`, an unsupported caller-lead option) from schema
 * and member-vocabulary failures via `code`.
 */
export type TeamSpecErrorCode =
  | "RESERVED_LEAD_FIELD"
  | "RESERVED_LEAD_MEMBER"
  | "RESERVED_CALLER_TEAM_LEAD"
  | "INVALID_SPEC"
  | "INVALID_JSON"
  | "TEAM_SPEC_NOT_FOUND"
  | "DUPLICATE_MEMBER_NAME"
  | "MEMBER_LIMIT_EXCEEDED"
  | "UNKNOWN_SUBAGENT_TYPE"
  | "UNRESOLVABLE_CATEGORY"

export class TeamSpecError extends Error {
  readonly code: TeamSpecErrorCode
  readonly teamName: string

  constructor(message: string, code: TeamSpecErrorCode, teamName: string) {
    super(message)
    this.name = "TeamSpecError"
    this.code = code
    this.teamName = teamName
  }
}
