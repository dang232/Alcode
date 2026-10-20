import { rm } from "node:fs/promises"
import { join } from "node:path"

import type { TeamModeConfig } from "../../../team-core/src/config.ts"
import { ensureBaseDirs, getRuntimeStateDir } from "../../../team-core/src/team-registry/paths.ts"
import {
  createRuntimeState,
  loadRuntimeState,
  transitionRuntimeState,
} from "../../../team-core/src/team-state-store/store.ts"
import type { RuntimeState, TeamSpec } from "../../../team-core/src/types.ts"
import { upsertTaskSessionState } from "../../../boulder-state/src/storage/task.ts"

import { cancelChildSession } from "../shared/session-lifecycle.ts"
import { validateTeamMembers, type TeamMemberPorts } from "./member-validator.ts"
import { TeamRuntimeError } from "./runtime-errors.ts"
import { findTeamMember } from "./shutdown-helpers.ts"
import {
  spawnTeamMembers,
  type SpawnedMember,
  type SpawnMembersInput,
  type TeamHostClient,
  type TeamMemberModel,
} from "./spawn-members.ts"

export type { TeamHostClient, TeamMemberModel }

export type TeamBounds = {
  readonly maxMembers: number
  readonly maxParallelMembers: number
  readonly maxWallClockMinutes: number
}

const DEFAULT_BOUNDS: TeamBounds = {
  maxMembers: 8,
  maxParallelMembers: 4,
  maxWallClockMinutes: 120,
}

const MS_PER_MINUTE = 60_000

function toTeamCoreConfig(bounds: TeamBounds, teamsBaseDir: string): TeamModeConfig {
  return {
    enabled: true,
    tmux_visualization: false,
    max_members: bounds.maxMembers,
    max_parallel_members: bounds.maxParallelMembers,
    max_wall_clock_minutes: bounds.maxWallClockMinutes,
    base_dir: teamsBaseDir,
    max_messages_per_run: 10000,
    max_member_turns: 500,
    message_payload_max_bytes: 32768,
    recipient_unread_max_bytes: 262144,
    mailbox_poll_interval_ms: 3000,
  }
}

/** Runtime-state root for every native team run: `<stateDir>/teams`. */
export function teamStorageBaseDir(stateDir: string): string {
  return join(stateDir, "teams")
}

export type CreatedTeamMember = {
  readonly name: string
  readonly sessionId: string
  readonly status: SpawnedMember["status"]
  readonly role: { readonly kind: "category"; readonly category: string } | {
    readonly kind: "subagent_type"
    readonly subagentType: string
  }
  readonly model?: TeamMemberModel
}

export type CreateTeamDeps = {
  readonly spec: TeamSpec
  readonly source: "project" | "inline"
  readonly ports: TeamMemberPorts
  readonly parentSessionId: string
  readonly directory: string
  readonly stateDir: string
  readonly client: TeamHostClient
  readonly bounds?: Partial<TeamBounds>
  readonly models?: Readonly<Record<string, TeamMemberModel>>
  readonly planGate?: SpawnMembersInput["planGate"]
  readonly now?: () => number
  /** Project dir holding `.omo/boulder.json`; when set, member sessions are mirrored into durable plan state best-effort. */
  readonly projectDir?: string
  readonly onRollbackCancelFailed?: (memberName: string, error: unknown) => void
}

export type CreateTeamResult = {
  readonly runtimeState: RuntimeState
  readonly members: readonly CreatedTeamMember[]
  /** Non-fatal plan-mirror notes; the team-core state file stays authoritative. */
  readonly planMirrorWarnings: readonly string[]
}

export type DeleteTeamDeps = {
  readonly teamRunId: string
  readonly stateDir: string
  readonly directory: string
  readonly client: TeamHostClient
  readonly parentSessionId?: string
  readonly shutdownReason?: string
}

export type DeleteTeamResult = {
  readonly teamRunId: string
  readonly cancelledSessionIds: readonly string[]
  readonly failed: readonly { readonly memberName: string; readonly message: string }[]
}

/**
 * Creates a team run over real OpenCode child sessions: enforces the
 * member bound before any spawn, seeds team-core runtime state
 * (`creating`), spawns every member as a child session of the lead capped
 * by `maxParallelMembers` under a wall-clock deadline, then either rolls
 * back (cancel spawned members, transition to `failed`) on the first
 * failure or transitions to `active`. The calling session is always the
 * lead sentinel; no member is ever elected lead.
 */
export async function createTeam(deps: CreateTeamDeps): Promise<CreateTeamResult> {
  const bounds: TeamBounds = { ...DEFAULT_BOUNDS, ...deps.bounds }
  if (deps.spec.members.length > bounds.maxMembers) {
    throw new TeamRuntimeError(
      `team '${deps.spec.name}' declares ${deps.spec.members.length} members, exceeding max_members ${bounds.maxMembers}`,
      "bounds_exceeded",
      deps.spec.name,
    )
  }
  validateTeamMembers(deps.spec, deps.ports)

  const baseDir = teamStorageBaseDir(deps.stateDir)
  await ensureBaseDirs(baseDir)
  const config = toTeamCoreConfig(bounds, baseDir)
  const now = deps.now ?? Date.now
  const runtimeState = await createRuntimeState(
    deps.spec,
    deps.parentSessionId,
    deps.source === "project" ? "project" : "user",
    config,
  )
  const teamRunId = runtimeState.teamRunId

  const result = await spawnTeamMembers({
    spec: deps.spec,
    teamRunId,
    parentSessionId: deps.parentSessionId,
    directory: deps.directory,
    client: deps.client,
    maxParallel: bounds.maxParallelMembers,
    deadlineAt: now() + bounds.maxWallClockMinutes * MS_PER_MINUTE,
    now,
    ...(deps.models !== undefined ? { models: deps.models } : {}),
    ...(deps.planGate !== undefined ? { planGate: deps.planGate } : {}),
  })

  if (result.failure !== undefined) {
    await rollbackFailedCreate(teamRunId, result.spawned, deps, config)
    throw result.failure
  }

  const activated = await transitionRuntimeState(
    teamRunId,
    (state) => ({
      ...state,
      status: "active",
      members: state.members.map((member) => {
        const outcome = result.spawned.get(member.name)
        if (outcome === undefined) return member
        return {
          ...member,
          sessionId: outcome.sessionId,
          status: outcome.status,
          ...(outcome.subagent_type !== undefined ? { subagent_type: outcome.subagent_type } : {}),
          ...(outcome.category !== undefined ? { category: outcome.category } : {}),
          ...(outcome.model !== undefined ? { model: outcome.model } : {}),
        }
      }),
    }),
    config,
  )

  const planMirrorWarnings = mirrorMemberPlanState(deps, teamRunId, result.spawned)
  return { runtimeState: activated, members: toCreatedMembers(deps.spec, result.spawned), planMirrorWarnings }
}

function toCreatedMembers(spec: TeamSpec, spawned: ReadonlyMap<string, SpawnedMember>): CreatedTeamMember[] {
  return spec.members.flatMap((member) => {
    const outcome = spawned.get(member.name)
    if (outcome === undefined) return []
    return [{
      name: member.name,
      sessionId: outcome.sessionId,
      status: outcome.status,
      role: member.kind === "category"
        ? { kind: "category" as const, category: member.category }
        : { kind: "subagent_type" as const, subagentType: member.subagent_type },
      ...(outcome.model !== undefined ? { model: outcome.model } : {}),
    }]
  })
}

async function rollbackFailedCreate(
  teamRunId: string,
  spawned: ReadonlyMap<string, SpawnedMember>,
  deps: CreateTeamDeps,
  config: TeamModeConfig,
): Promise<void> {
  for (const member of spawned.values()) {
    try {
      await cancelChildSession(deps.client, {
        parentSessionID: deps.parentSessionId,
        childSessionID: member.sessionId,
        directory: deps.directory,
        reason: `team ${teamRunId} create rollback`,
      })
    } catch (error) {
      deps.onRollbackCancelFailed?.(member.name, error)
    }
  }
  await transitionRuntimeState(teamRunId, (state) => ({ ...state, status: "failed" }), config)
}

/**
 * Best-effort mirror of member sessions into durable boulder plan state so
 * plan dashboards can see team workers. Never throws: a missing or
 * unwritable boulder file yields a warning string instead.
 */
function mirrorMemberPlanState(
  deps: CreateTeamDeps,
  teamRunId: string,
  spawned: ReadonlyMap<string, SpawnedMember>,
): string[] {
  if (deps.projectDir === undefined) return []
  const warnings: string[] = []
  for (const member of spawned.values()) {
    try {
      const state = upsertTaskSessionState(deps.projectDir, {
        taskKey: `team-${teamRunId}-${member.name}`,
        taskLabel: member.name,
        taskTitle: `team ${deps.spec.name} member ${member.name}`,
        sessionId: member.sessionId,
        ...(member.subagent_type !== undefined ? { agent: member.subagent_type } : {}),
        ...(member.category !== undefined ? { category: member.category } : {}),
      })
      if (state === null) {
        warnings.push(`member '${member.name}': no boulder plan state to mirror into`)
      }
    } catch (error) {
      warnings.push(`member '${member.name}': plan mirror failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return warnings
}

/** Resolves one member or throws a typed unknown-member error. */
export function requireTeamMember(state: RuntimeState, teamRunId: string, memberName: string): void {
  if (findTeamMember(state, memberName) === undefined) {
    throw new TeamRuntimeError(`unknown team member '${memberName}'`, "unknown_member", teamRunId)
  }
}

const deleteOperations = new Map<string, Promise<DeleteTeamResult>>()

/**
 * Deletes a team run: transitions `active`/`shutdown_requested` to
 * `deleting`, cancels every member session note-first with the shutdown
 * reason, transitions to `deleted`, then removes the team runtime
 * directory. A missing runtime state is an idempotent already-deleted
 * no-op. Concurrent deletes for one team share a single in-flight
 * operation keyed by the resolved runtime directory.
 */
export function deleteTeam(deps: DeleteTeamDeps): Promise<DeleteTeamResult> {
  const key = getRuntimeStateDir(teamStorageBaseDir(deps.stateDir), deps.teamRunId)
  const current = deleteOperations.get(key)
  if (current !== undefined) return current
  const operation = performDeleteTeam(deps).finally(() => deleteOperations.delete(key))
  deleteOperations.set(key, operation)
  return operation
}

async function performDeleteTeam(deps: DeleteTeamDeps): Promise<DeleteTeamResult> {
  const baseDir = teamStorageBaseDir(deps.stateDir)
  const config = toTeamCoreConfig({ ...DEFAULT_BOUNDS }, baseDir)

  let state: RuntimeState | null
  try {
    state = await loadRuntimeState(deps.teamRunId, config)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { teamRunId: deps.teamRunId, cancelledSessionIds: [], failed: [] }
    }
    throw error
  }

  if (state.status === "active" || state.status === "shutdown_requested") {
    state = await transitionRuntimeState(deps.teamRunId, (current) => ({ ...current, status: "deleting" }), config)
  } else if (state.status !== "deleting" && state.status !== "deleted") {
    throw new TeamRuntimeError(
      `team '${deps.teamRunId}' cannot be deleted from status '${state.status}'`,
      "invalid_delete_state",
      deps.teamRunId,
    )
  }

  const parentSessionId = state.leadSessionId ?? deps.parentSessionId
  if (parentSessionId === undefined) {
    throw new TeamRuntimeError(
      `team '${deps.teamRunId}' has no lead session to anchor member cancellation`,
      "missing_lead_session",
      deps.teamRunId,
    )
  }

  const reason = deps.shutdownReason ?? `delete team ${deps.teamRunId}`
  const cancelledSessionIds: string[] = []
  const failed: { memberName: string; message: string }[] = []
  for (const member of state.members) {
    if (member.sessionId === undefined) continue
    try {
      await cancelChildSession(deps.client, {
        parentSessionID: parentSessionId,
        childSessionID: member.sessionId,
        directory: deps.directory,
        reason,
      })
      cancelledSessionIds.push(member.sessionId)
    } catch (error) {
      failed.push({ memberName: member.name, message: error instanceof Error ? error.message : String(error) })
    }
  }

  if (state.status !== "deleted") {
    await transitionRuntimeState(
      deps.teamRunId,
      (current) => (current.status === "deleted" ? current : { ...current, status: "deleted" }),
      config,
    )
  }
  await rm(getRuntimeStateDir(baseDir, deps.teamRunId), { recursive: true, force: true })
  return { teamRunId: deps.teamRunId, cancelledSessionIds, failed }
}

export { TeamRuntimeError }
