import type { PluginInput } from "@opencode-ai/plugin"

import type { RuntimeStateMember, TeamSpec } from "../../../team-core/src/types.ts"

import { evaluatePlanGate, invocationGateDenial, type PlanGateInput } from "../guards/plan-gate.ts"
import { resolveGateRoleName } from "../guards/spawn-role-guard.ts"
import { promptAsyncInDirectory } from "../shared/session-route.ts"
import { TeamRuntimeError } from "./runtime-errors.ts"

export type TeamHostClient = PluginInput["client"]

export type TeamMemberModel = {
  readonly providerID: string
  readonly modelID: string
}

export type SpawnedMember = {
  readonly name: string
  readonly sessionId: string
  readonly status: RuntimeStateMember["status"]
  readonly agentType: RuntimeStateMember["agentType"]
  readonly subagent_type?: string
  readonly category?: string
  readonly model?: TeamMemberModel
}

export type SpawnMembersInput = {
  readonly spec: TeamSpec
  readonly teamRunId: string
  /** Lead session that owns the spawned children (recorded as parent). */
  readonly parentSessionId: string
  /** Working directory every session call is stamped with. */
  readonly directory: string
  readonly client: TeamHostClient
  readonly maxParallel: number
  readonly deadlineAt: number
  readonly now?: () => number
  readonly models?: Readonly<Record<string, TeamMemberModel>>
  /** Session facts unlocking plan-gated members; absent means no evidence. */
  readonly planGate?: PlanGateInput
}

export type SpawnMembersResult = {
  readonly spawned: ReadonlyMap<string, SpawnedMember>
  readonly failure?: TeamRuntimeError
}

type TeamSpecMember = TeamSpec["members"][number]

function nowMs(input: SpawnMembersInput): number {
  return (input.now ?? Date.now)()
}

/**
 * Spawns every spec member as a real OpenCode child session of the lead
 * session, capped at `maxParallel` cooperating workers sharing one index
 * and checked against the create deadline before each pull. A member is
 * reported as started only once `session.create` returns a genuine child
 * session id; the opening prompt is then dispatched into that session.
 * The first failure flips a shared flag so the remaining workers drain and
 * the caller rolls back the members already started.
 */
export async function spawnTeamMembers(input: SpawnMembersInput): Promise<SpawnMembersResult> {
  const spawned = new Map<string, SpawnedMember>()
  let failure: TeamRuntimeError | undefined
  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(input.maxParallel, input.spec.members.length))

  const runWorker = async (): Promise<void> => {
    while (failure === undefined) {
      if (nowMs(input) > input.deadlineAt) {
        failure = new TeamRuntimeError(
          `team '${input.spec.name}' creation exceeded its wall-clock deadline`,
          "create_deadline_exceeded",
          input.teamRunId,
        )
        return
      }
      const member = input.spec.members[nextIndex++]
      if (member === undefined) return
      try {
        spawned.set(member.name, await spawnOneMember(input, member))
      } catch (error) {
        failure = toSpawnFailure(input.teamRunId, member.name, error)
        return
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker))
  return failure !== undefined ? { spawned, failure } : { spawned }
}

function toSpawnFailure(teamRunId: string, memberName: string, error: unknown): TeamRuntimeError {
  if (error instanceof TeamRuntimeError) return error
  const detail = error instanceof Error ? error.message : String(error)
  const failure = new TeamRuntimeError(
    `member '${memberName}' failed to start: ${detail}`,
    "member_start_rejected",
    teamRunId,
  )
  failure.cause = error
  return failure
}

/**
 * Dispatch decisions for one member. Gate-only reviewer roles never run as
 * team members, and plan-gated specialists need proven session facts; both
 * rejections happen before any session is created.
 */
function enforceDispatchGuards(input: SpawnMembersInput, member: TeamSpecMember): void {
  if (member.kind !== "subagent_type") return

  let gateRole = false
  try {
    resolveGateRoleName(member.subagent_type)
    gateRole = true
  } catch {
    gateRole = false
  }
  if (gateRole) {
    throw new TeamRuntimeError(
      `member '${member.name}' uses gate-only role '${member.subagent_type}', which cannot run as a team member; dispatch it through the final gate instead`,
      "member_start_rejected",
      input.teamRunId,
    )
  }

  const denial = invocationGateDenial(member.subagent_type)
  if (denial === undefined) return
  const verdict = input.planGate !== undefined ? evaluatePlanGate(input.planGate) : undefined
  if (verdict?.allowed !== true) {
    throw new TeamRuntimeError(
      `member '${member.name}' is plan-gated and cannot start: ${verdict?.reason ?? denial}`,
      "member_start_rejected",
      input.teamRunId,
    )
  }
}

async function spawnOneMember(input: SpawnMembersInput, member: TeamSpecMember): Promise<SpawnedMember> {
  enforceDispatchGuards(input, member)

  const created = await input.client.session.create({
    body: { parentID: input.parentSessionId, title: `team ${input.teamRunId}: ${member.name}` },
    query: { directory: input.directory },
  })
  if (created.error) {
    const detail = created.error instanceof Error ? created.error.message : String(created.error)
    throw new TeamRuntimeError(
      `member '${member.name}' session creation failed: ${detail}`,
      "member_start_rejected",
      input.teamRunId,
    )
  }
  const childSessionId = created.data?.id
  if (!childSessionId) {
    throw new TeamRuntimeError(
      `member '${member.name}' session creation returned no session id`,
      "member_start_rejected",
      input.teamRunId,
    )
  }

  const model = input.models?.[member.name]
  await promptAsyncInDirectory(
    input.client,
    {
      path: { id: childSessionId },
      body: {
        ...(member.kind === "subagent_type" ? { agent: member.subagent_type } : {}),
        ...(model !== undefined ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
        parts: [{ type: "text", text: buildMemberPrompt(input.spec, member) }],
      },
      query: { directory: input.directory },
    },
    input.directory,
  )

  return {
    name: member.name,
    sessionId: childSessionId,
    status: "running",
    agentType: input.spec.leadAgentId === member.name ? "leader" : "general-purpose",
    ...(member.kind === "subagent_type" ? { subagent_type: member.subagent_type } : { category: member.category }),
    ...(model !== undefined ? { model } : {}),
  }
}

// Every member bootstrap frames the coordination protocol first so members
// end their opening turn while staying resident for injected follow-ups.
function buildMemberPrompt(spec: TeamSpec, member: TeamSpecMember): string {
  const role = member.prompt
    ?? `You are team member '${member.name}' in team '${spec.name}'.`
  return [
    `You are '${member.name}', a member of team '${spec.name}' running under the native OpenCode team runtime.`,
    "Work arrives as injected follow-up messages from the lead and other members.",
    "After completing any immediate instructions below, report back to the lead, then end your turn and wait for the next injected message.",
    role,
  ].join("\n\n")
}
