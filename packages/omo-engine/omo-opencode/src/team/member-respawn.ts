/**
 * Native team member operations: respawn lost members.
 *
 * When a member's backing task is lost (failed, cancelled, gone from the
 * live channel, or never mapped), the member can be respawned as a fresh
 * task. The loss is recorded in the respawn result (`recordedError`) and
 * every refusal raises a typed `MemberRespawnError` carrying the member
 * identity, so a lost member is never dropped silently.
 */
import type { TeamModeConfig } from "../../../team-core/src/config.ts"
import {
  loadRuntimeState,
  transitionRuntimeState,
} from "../../../team-core/src/team-state-store/index.ts"
import type { RuntimeState, TeamSpec } from "../../../team-core/src/types.ts"

import {
  MEMBER_IDENTITY_ENV,
  MEMBER_TASK_ID_ENV,
  MEMBER_TEAM_CONFIG_ENV,
  formatMemberIdentity,
} from "./member-extension.ts"
import { assembleMemberExtensions } from "./member-extensions.ts"
import { memberTaskName, readMemberTaskMap, writeMemberTaskMap } from "./member-map.ts"
import {
  MemberRespawnError,
  TeamRuntimeError,
  type MemberStatusSource,
  type MemberTaskStatus,
  type TeamMemberExtensionConfig,
  type TeamMemberManagerPort,
} from "./runtime-types.ts"

export type MemberRespawnDeps = {
  readonly manager: TeamMemberManagerPort & MemberStatusSource
  readonly config: TeamModeConfig
  readonly runtimeDir: string
  readonly spec: TeamSpec
  readonly memberExtension?: TeamMemberExtensionConfig
}

export type RecordedMemberLoss = {
  readonly previousTaskId: string
  readonly status: MemberTaskStatus | "unmapped"
}

export type MemberRespawnResult = {
  /** The backing task id after respawn (a fresh id when respawned, the live id otherwise). */
  readonly taskId: string
  readonly respawned: boolean
  /** The recorded loss. Present exactly when a fresh task replaced a lost one. */
  readonly recordedError?: RecordedMemberLoss
}

export type MemberRespawnLaunch = {
  readonly extensions: readonly string[]
  readonly memberEnv: Readonly<Record<string, string>>
}

type RevivableRecord = {
  readonly name: string | undefined
  readonly task_id: string
}

function buildMemberPrompt(spec: TeamSpec, memberName: string): string {
  const member = spec.members.find((candidate) => candidate.name === memberName)
  const role = member?.prompt ?? `You are team member '${memberName}' in team '${spec.name}'.`
  return [
    `You are '${memberName}', a member of team '${spec.name}' running under the native team runtime.`,
    "Work arrives as injected messages from the lead and other members; coordinate with task_send.",
    "After completing any immediate instructions below, report with task_send, then end your turn. Injected messages revive this resident session with more work.",
    "When you finish assigned work, task_send the lead a summary, then end your turn and wait for an injected message.",
    role,
  ].join("\n\n")
}

function buildTeamConfig(runtime: RuntimeState, config: TeamModeConfig): string {
  return JSON.stringify({
    ...config,
    members: runtime.members.map((member) => member.name),
  })
}

function buildSpawnMemberEnv(runtime: RuntimeState, memberName: string, config: TeamModeConfig): Readonly<Record<string, string>> {
  return {
    [MEMBER_IDENTITY_ENV]: formatMemberIdentity(runtime.teamRunId, memberName),
    [MEMBER_TEAM_CONFIG_ENV]: buildTeamConfig(runtime, config),
  }
}

/**
 * Resolves the trusted respawn launch for a persisted member task record.
 * Persisted launch inputs are never trusted: extensions and identity are
 * rebuilt from the current runtime state and the configured member
 * extension. Throws a typed `MemberRespawnError` (the recorded error) when
 * the member cannot be revived against this runtime.
 */
export async function resolveMemberRespawnLaunch(
  record: RevivableRecord,
  teamRunId: string,
  deps: Pick<MemberRespawnDeps, "config" | "runtimeDir" | "memberExtension">,
): Promise<MemberRespawnLaunch> {
  const memberName = record.name ?? "<unknown>"
  let runtime: RuntimeState
  try {
    runtime = await loadRuntimeState(teamRunId, deps.config)
  } catch {
    throw new MemberRespawnError("runtime_unavailable", teamRunId, memberName)
  }
  if (runtime.status !== "active" && runtime.status !== "shutdown_requested") {
    throw new MemberRespawnError("runtime_inactive", teamRunId, memberName)
  }
  const member = runtime.members.find((entry) => entry.name === record.name)
  if (member === undefined || member.status === "shutdown_approved" || record.name === undefined) {
    throw new MemberRespawnError("member_missing", teamRunId, memberName)
  }
  const map = await readMemberTaskMap(deps.runtimeDir)
  if (map[member.name] !== record.task_id) {
    throw new MemberRespawnError("task_mapping_mismatch", teamRunId, member.name)
  }

  const extensions = deps.memberExtension === undefined
    ? []
    : assembleMemberExtensions(deps.memberExtension.entryPath, deps.memberExtension.inheritedExtensions)
  return {
    extensions,
    memberEnv: {
      ...buildSpawnMemberEnv(runtime, member.name, deps.config),
      [MEMBER_TASK_ID_ENV]: record.task_id,
    },
  }
}

const LOST_LIVE_STATUSES: ReadonlySet<MemberTaskStatus> = new Set(["failed", "cancelled", "lost"])

/**
 * Respawns a lost member: validates the runtime, checks the live channel,
 * spawns exactly one replacement task, repoints the sidecar map, and resets
 * the member to `pending` with the new session. A member whose mapped task
 * is still live is left alone (`respawned: false`, no recorded loss).
 */
export async function respawnLostMember(
  teamRunId: string,
  memberName: string,
  deps: MemberRespawnDeps,
): Promise<MemberRespawnResult> {
  let runtime: RuntimeState
  try {
    runtime = await loadRuntimeState(teamRunId, deps.config)
  } catch {
    throw new MemberRespawnError("runtime_unavailable", teamRunId, memberName)
  }
  if (runtime.status !== "active" && runtime.status !== "shutdown_requested") {
    throw new MemberRespawnError("runtime_inactive", teamRunId, memberName)
  }
  const member = runtime.members.find((entry) => entry.name === memberName)
  if (member === undefined || member.status === "shutdown_approved") {
    throw new MemberRespawnError("member_missing", teamRunId, memberName)
  }

  const map = await readMemberTaskMap(deps.runtimeDir)
  const previousTaskId = map[memberName]
  if (previousTaskId !== undefined) {
    const live = deps.manager.get(previousTaskId)
    if (live !== undefined && !LOST_LIVE_STATUSES.has(live.status)) {
      return { taskId: previousTaskId, respawned: false }
    }
  }

  const recordedError: RecordedMemberLoss = {
    previousTaskId: previousTaskId ?? "<unmapped>",
    status: previousTaskId === undefined
      ? "unmapped"
      : (deps.manager.get(previousTaskId)?.status ?? "lost"),
  }

  const specMember = deps.spec.members.find((candidate) => candidate.name === memberName)
  const extensions = deps.memberExtension === undefined
    ? undefined
    : assembleMemberExtensions(deps.memberExtension.entryPath, deps.memberExtension.inheritedExtensions)

  let outcome: { taskId: string; sessionId?: string }
  try {
    outcome = await deps.manager.start({
      name: memberTaskName(runtime.teamRunId, memberName),
      prompt: buildMemberPrompt(deps.spec, memberName),
      memberName,
      teamRunId: runtime.teamRunId,
      teamName: runtime.teamName,
      ...(specMember?.worktreePath !== undefined ? { cwd: specMember.worktreePath } : {}),
      ...(extensions !== undefined ? { extensions } : {}),
      memberEnv: buildSpawnMemberEnv(runtime, memberName, deps.config),
    })
  } catch (error) {
    throw new MemberRespawnError("session_unavailable", runtime.teamRunId, memberName, { cause: error })
  }

  const nextMap = { ...map, [memberName]: outcome.taskId }
  try {
    await writeMemberTaskMap(deps.runtimeDir, nextMap)
  } catch (error) {
    throw new TeamRuntimeError(
      `team '${runtime.teamName}' member sidecar write failed after respawning '${memberName}' as '${outcome.taskId}': ${error instanceof Error ? error.message : String(error)}`,
      "sidecar_write_failed",
      teamRunId,
    )
  }

  await transitionRuntimeState(
    teamRunId,
    (state) => ({
      ...state,
      members: state.members.map((entry) => (
        entry.name === memberName
          ? {
            ...entry,
            status: "pending" as const,
            ...(outcome.sessionId !== undefined ? { sessionId: outcome.sessionId } : {}),
          }
          : entry
      )),
    }),
    deps.config,
  )

  return { taskId: outcome.taskId, respawned: true, recordedError }
}
