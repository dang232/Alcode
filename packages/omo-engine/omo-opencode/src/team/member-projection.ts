/**
 * Native team member operations: live status projection.
 *
 * Member status is projected from the live manager channel (task status plus
 * the best-known child/resident session id) on every refresh. Persisted
 * history is never treated as activity proof: a member with no live record
 * keeps its current status instead of being inferred idle, completed, or
 * gone.
 */
import type { TeamModeConfig } from "../../../team-core/src/config.ts"
import { transitionRuntimeState } from "../../../team-core/src/team-state-store/index.ts"
import type { RuntimeState } from "../../../team-core/src/types.ts"

import { readMemberTaskMap } from "./member-map.ts"
import type { MemberStatusSource, MemberTaskStatus } from "./runtime-types.ts"

export type RuntimeMemberStatus = RuntimeState["members"][number]["status"]

/**
 * Projects a native member task status onto the team-core member status
 * vocabulary: in-flight statuses map straight through, a suspended
 * (paused, revivable) task reads as `idle`, and every terminal-failure
 * status collapses to `errored`.
 */
export function projectMemberStatus(status: MemberTaskStatus): RuntimeMemberStatus {
  switch (status) {
    case "pending":
      return "pending"
    case "running":
      return "running"
    case "suspended":
      return "idle"
    case "completed":
      return "completed"
    case "failed":
    case "cancelled":
    case "lost":
      return "errored"
    default:
      return assertNever(status)
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled member task status: ${String(value)}`)
}

export type RefreshTeamMemberStatusesDeps = {
  readonly manager: MemberStatusSource
  readonly config: TeamModeConfig
  readonly runtimeDir: string
}

/**
 * Re-projects each mapped member's live task status (and best-known session
 * id) into the team-core runtime state under a lock. The runtime status is
 * left unchanged (a self-transition), so this is safe to call whenever the
 * tool layer needs a fresh status snapshot.
 */
export async function refreshTeamMemberStatuses(
  teamRunId: string,
  deps: RefreshTeamMemberStatusesDeps,
): Promise<RuntimeState> {
  const map = await readMemberTaskMap(deps.runtimeDir)
  return transitionRuntimeState(
    teamRunId,
    (state) => ({
      ...state,
      members: state.members.map((member) => {
        const taskId = map[member.name]
        if (taskId === undefined) return member
        const record = deps.manager.get(taskId)
        if (record === undefined) return member
        const sessionId = deps.manager.getResidentHandle(taskId)?.sessionId
          ?? record.childSessionId
          ?? member.sessionId
        return {
          ...member,
          status: projectMemberStatus(record.status),
          ...(sessionId !== undefined ? { sessionId } : {}),
        }
      }),
    }),
    deps.config,
  )
}
