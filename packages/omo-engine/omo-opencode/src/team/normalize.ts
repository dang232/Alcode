import { normalizeTeamSpecInput } from "../../../team-core/src/team-registry/team-spec-input-normalizer.ts"
import { TeamSpecSchema, type TeamSpec } from "../../../team-core/src/types.ts"

export type TeamSpecErrorCode =
  | "INVALID_SPEC"
  | "RESERVED_LEAD_FIELD"
  | "RESERVED_LEAD_MEMBER"

/**
 * Raised when a raw team spec cannot be normalized into a team-core TeamSpec.
 * Every path that throws spawns zero members.
 */
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

/**
 * Sentinel identity for the calling OpenCode session acting as team lead.
 * It is recorded as leadAgentId and is never a spawnable member.
 */
export const TEAM_LEAD_SENTINEL = "lead"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function coerceStringSpec(rawSpec: unknown, teamName: string): unknown {
  if (typeof rawSpec !== "string") return rawSpec
  try {
    return JSON.parse(rawSpec)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new TeamSpecError(
      `Team '${teamName}' spec is a string that is not valid JSON (${detail}). Pass the spec as an object like { name?, members: [...] }, or as a valid JSON string of that object.`,
      "INVALID_SPEC",
      teamName,
    )
  }
}

function wrapSingleMember(rawSpec: unknown): unknown {
  if (isRecord(rawSpec) && isRecord(rawSpec.members)) {
    return { ...rawSpec, members: [rawSpec.members] }
  }
  return rawSpec
}

function describeReceived(rawSpec: unknown): string {
  if (rawSpec === null) return "null"
  if (Array.isArray(rawSpec)) return "an array"
  if (typeof rawSpec === "object") return "an object"
  return `a ${typeof rawSpec}`
}

function assertNoRawLeadField(rawSpec: unknown, teamName: string): void {
  if (isRecord(rawSpec) && rawSpec.lead !== undefined && rawSpec.lead !== null) {
    throw new TeamSpecError(
      `Team '${teamName}' declares a 'lead' field. '${TEAM_LEAD_SENTINEL}' is reserved for the calling-session sentinel; declare workers under 'members' only.`,
      "RESERVED_LEAD_FIELD",
      teamName,
    )
  }
}

function remapAgentAliasRaw(rawSpec: unknown): unknown {
  if (!isRecord(rawSpec) || !Array.isArray(rawSpec.members)) return rawSpec
  return {
    ...rawSpec,
    members: rawSpec.members.map((member) => {
      if (!isRecord(member)) return member
      const remapped: Record<string, unknown> = { ...member }
      if (typeof remapped.agent === "string" && remapped.subagent_type === undefined) {
        remapped.subagent_type = remapped.agent
      }
      delete remapped.agent
      if (remapped.kind === "agent") {
        remapped.kind = "subagent_type"
      }
      return remapped
    }),
  }
}

function remapAgentAliasKind(members: readonly unknown[]): unknown[] {
  return members.map((member) => {
    if (isRecord(member) && member.kind === "agent") {
      return { ...member, kind: "subagent_type" }
    }
    return member
  })
}

function assertNoReservedMemberName(members: readonly unknown[], teamName: string): void {
  for (const member of members) {
    if (isRecord(member) && member.name === TEAM_LEAD_SENTINEL) {
      throw new TeamSpecError(
        `Team '${teamName}' has a member named '${TEAM_LEAD_SENTINEL}', which is reserved for the calling-session sentinel. Rename the member.`,
        "RESERVED_LEAD_MEMBER",
        teamName,
      )
    }
  }
}

/**
 * Normalizes a raw team spec (an inline object, a single-member object, or a
 * JSON string of either) into a parsed team-core TeamSpec.
 *
 * Pipeline: reject the reserved lead paths, run the team-core input
 * normalizer, map the `agent` kind alias onto `subagent_type`, fill the team
 * name, pin the lead sentinel, then parse with TeamSpecSchema. The team-core
 * roster eligibility check is intentionally not run here; member vocabulary
 * is validated separately against the live OpenCode registries.
 */
export function normalizeTeamSpec(rawSpec: unknown, teamName: string): TeamSpec {
  const coerced = wrapSingleMember(coerceStringSpec(rawSpec, teamName))
  assertNoRawLeadField(coerced, teamName)

  const normalized = normalizeTeamSpecInput(remapAgentAliasRaw(coerced))
  if (!isRecord(normalized)) {
    throw new TeamSpecError(
      `Team '${teamName}' spec must be an object like { name?, members: [...] }; received ${describeReceived(rawSpec)}. Pass the spec as a nested object, or as a valid JSON string of that object.`,
      "INVALID_SPEC",
      teamName,
    )
  }

  const preNormalized: Record<string, unknown> = { ...normalized }
  if (Array.isArray(preNormalized.members)) {
    const members = remapAgentAliasKind(preNormalized.members)
    assertNoReservedMemberName(members, teamName)
    preNormalized.members = members
  }
  preNormalized.name ??= teamName
  preNormalized.leadAgentId = TEAM_LEAD_SENTINEL

  const parsed = TeamSpecSchema.safeParse(preNormalized)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    const detail = firstIssue
      ? `${firstIssue.path.join(".") || "spec"}: ${firstIssue.message}`
      : parsed.error.message
    throw new TeamSpecError(`Invalid team '${teamName}' spec (${detail}).`, "INVALID_SPEC", teamName)
  }

  return parsed.data
}
