/**
 * Native team member operations: revive finished resident sessions.
 *
 * A member that finished its work (`completed`) but whose session is still
 * resident can be revived back to `running` so the lead can steer more work
 * into the same session instead of spawning a replacement. Revival proves
 * the session through the live session channel: a finished member with no
 * live session is a typed `session_unavailable` error, never an optimistic
 * status flip.
 */
import type { TeamModeConfig } from "../../../team-core/src/config.ts"
import type { TeamSessionContext } from "../../../team-core/src/session-client.ts"
import type { RuntimeState } from "../../../team-core/src/types.ts"
import { sessionExists } from "../../../team-core/src/team-state-store/session-liveness.ts"
import {
  loadRuntimeState,
  transitionRuntimeState,
} from "../../../team-core/src/team-state-store/index.ts"

import { readMemberTaskMap } from "./member-map.ts"
import {
  MemberRevivalError,
  type MemberStatusSource,
} from "./runtime-types.ts"

export type MemberRevivalDeps = {
  readonly sessions: TeamSessionContext
  readonly manager?: MemberStatusSource
  readonly config: TeamModeConfig
  readonly runtimeDir: string
}

export type MemberRevivalResult = {
  readonly memberName: string
  readonly sessionId: string
}

/**
 * Revives a finished (`completed`) resident member session back to `running`.
 * Only `completed` members revive: errored or lost members go through
 * respawn, and live members need no revival.
 */
export async function reviveFinishedResident(
  teamRunId: string,
  memberName: string,
  deps: MemberRevivalDeps,
): Promise<MemberRevivalResult> {
  let runtime: RuntimeState
  try {
    runtime = await loadRuntimeState(teamRunId, deps.config)
  } catch {
    throw new MemberRevivalError("runtime_unavailable", teamRunId, memberName)
  }
  if (runtime.status !== "active" && runtime.status !== "shutdown_requested") {
    throw new MemberRevivalError("runtime_inactive", teamRunId, memberName)
  }
  const member = runtime.members.find((entry) => entry.name === memberName)
  if (member === undefined || member.status === "shutdown_approved") {
    throw new MemberRevivalError("member_missing", teamRunId, memberName)
  }
  if (member.status !== "completed") {
    throw new MemberRevivalError("member_not_finished", teamRunId, memberName)
  }

  const sessionId = await resolveRevivalSessionId(teamRunId, memberName, member.sessionId, deps)
  if (sessionId === undefined) {
    throw new MemberRevivalError("session_unavailable", teamRunId, memberName)
  }

  await transitionRuntimeState(
    teamRunId,
    (state) => ({
      ...state,
      members: state.members.map((entry) => (
        entry.name === memberName
          ? { ...entry, status: "running" as const, sessionId }
          : entry
      )),
    }),
    deps.config,
  )

  return { memberName, sessionId }
}

async function resolveRevivalSessionId(
  teamRunId: string,
  memberName: string,
  knownSessionId: string | undefined,
  deps: MemberRevivalDeps,
): Promise<string | undefined> {
  const candidates: Array<string | undefined> = [knownSessionId]
  if (deps.manager !== undefined) {
    const map = await readMemberTaskMap(deps.runtimeDir)
    const taskId = map[memberName]
    if (taskId !== undefined) {
      candidates.push(
        deps.manager.getResidentHandle(taskId)?.sessionId,
        deps.manager.get(taskId)?.childSessionId,
      )
    }
  }

  for (const candidate of candidates) {
    if (candidate === undefined) continue
    if (await sessionExists(deps.sessions, candidate)) {
      return candidate
    }
  }
  return undefined
}
