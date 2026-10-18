import type { RuntimeState, RuntimeStateMember } from "../../../team-core/src/types.ts"

/**
 * Member statuses safe to tear down at team deletion: a member that
 * finished, was approved for shutdown, or errored out holds no live turn.
 * Any other status means the member may still be working.
 */
export const DELETABLE_MEMBER_STATUSES: ReadonlySet<RuntimeStateMember["status"]> = new Set([
  "completed",
  "shutdown_approved",
  "errored",
])

export function isMemberDeletable(status: RuntimeStateMember["status"]): boolean {
  return DELETABLE_MEMBER_STATUSES.has(status)
}

export function findTeamMember(state: RuntimeState, memberName: string): RuntimeStateMember | undefined {
  return state.members.find((candidate) => candidate.name === memberName)
}

/**
 * Index of the newest shutdown request for a member, scanning newest-first
 * so a fresh request after a resolved one wins. Returns -1 when the member
 * has no request on record.
 */
export function findLatestShutdownRequestIndex(state: RuntimeState, memberName: string): number {
  for (let index = state.shutdownRequests.length - 1; index >= 0; index -= 1) {
    if (state.shutdownRequests[index]?.memberId === memberName) return index
  }
  return -1
}

export function isShutdownRequestUnresolved(
  request: RuntimeState["shutdownRequests"][number] | undefined,
): boolean {
  return request !== undefined && request.approvedAt === undefined && request.rejectedAt === undefined
}
