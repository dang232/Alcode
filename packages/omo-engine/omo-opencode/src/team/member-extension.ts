/**
 * Native team member operations: member-side extension identity contract.
 *
 * A team member session carries its identity in the process environment so
 * the member extension can route mailbox traffic without trusting
 * persisted launch inputs. These helpers parse and recognize that identity;
 * the runtime lane sets the variables at spawn and respawn time.
 */

export const MEMBER_IDENTITY_ENV = "OMO_TEAM_MEMBER"
export const MEMBER_TASK_ID_ENV = "OMO_TEAM_MEMBER_TASK_ID"
export const MEMBER_TEAM_CONFIG_ENV = "OMO_TEAM_CONFIG"
export const MEMBER_EXTENSION_BUNDLE_NAME = "omo-member-extension.js"

export type MemberExtensionConfigErrorCode =
  | "missing_identity"
  | "malformed_identity"
  | "missing_config"

export class MemberExtensionConfigError extends Error {
  readonly code: MemberExtensionConfigErrorCode

  constructor(message: string, code: MemberExtensionConfigErrorCode) {
    super(message)
    this.name = "MemberExtensionConfigError"
    this.code = code
  }
}

export type ParsedMemberExtensionEnv = {
  readonly teamRunId: string
  readonly memberName: string
  readonly taskId?: string
  readonly teamConfig?: string
}

const MEMBER_IDENTITY_PATTERN = /^([0-9a-f-]{36})::([a-z0-9-]+)$/

export function isTeamMemberProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[MEMBER_IDENTITY_ENV] !== undefined
}

/**
 * Parses the member identity environment. A missing identity variable is the
 * normal non-member case and yields `undefined`; a present-but-malformed
 * identity (or a missing task/config slot the member needs) throws a typed
 * error so misconfiguration surfaces instead of misrouting.
 */
export function parseMemberExtensionEnv(env: NodeJS.ProcessEnv = process.env): ParsedMemberExtensionEnv | undefined {
  const identity = env[MEMBER_IDENTITY_ENV]
  if (identity === undefined) return undefined

  const match = MEMBER_IDENTITY_PATTERN.exec(identity)
  const teamRunId = match?.[1]
  const memberName = match?.[2]
  if (teamRunId === undefined || memberName === undefined) {
    throw new MemberExtensionConfigError(
      `Malformed ${MEMBER_IDENTITY_ENV} value. Expected '<teamRunId>::<memberName>'.`,
      "malformed_identity",
    )
  }

  const taskId = env[MEMBER_TASK_ID_ENV]
  const teamConfig = env[MEMBER_TEAM_CONFIG_ENV]
  if (taskId === undefined) {
    throw new MemberExtensionConfigError(
      `Missing ${MEMBER_TASK_ID_ENV} for team member '${memberName}'.`,
      "missing_config",
    )
  }
  if (teamConfig === undefined) {
    throw new MemberExtensionConfigError(
      `Missing ${MEMBER_TEAM_CONFIG_ENV} for team member '${memberName}'.`,
      "missing_config",
    )
  }

  return { teamRunId, memberName, taskId, teamConfig }
}

export function formatMemberIdentity(teamRunId: string, memberName: string): string {
  return `${teamRunId}::${memberName}`
}

export function resolveMemberExtensionEntryPath(extensionUrl = import.meta.url): string {
  return new URL(`./${MEMBER_EXTENSION_BUNDLE_NAME}`, extensionUrl).href
}
