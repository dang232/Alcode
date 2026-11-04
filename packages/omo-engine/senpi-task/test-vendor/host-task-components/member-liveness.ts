import { parseTeamMemberTaskIdentity } from "../../src/team/liveness-ownership"
import type { TaskRecord, TaskStatus } from "../../src/state"

export type TeamMemberLivenessDetails = {
  readonly memberName: string
  readonly lastKnownState: TaskStatus
  readonly reason?: string
  readonly killed?: boolean
}

export function livenessDetails(record: TaskRecord): TeamMemberLivenessDetails | undefined {
  const memberName = parseTeamMemberTaskIdentity(record)?.memberName
  if (
    memberName === undefined
    || (record.status !== "error" && record.status !== "lost" && record.killed !== true)
  ) {
    return undefined
  }
  // A suspended record (persisted_only/rpc_detached) sits between shutdown and revival: the member
  // is not dead, and reconcile may still revive it, so it must never produce a death event.
  if (record.residency_state === "persisted_only" || record.residency_state === "rpc_detached") return undefined
  return {
    memberName,
    lastKnownState: record.status,
    ...(record.error_message === undefined ? {} : { reason: record.error_message }),
    ...(record.killed === true ? { killed: true } : {}),
  }
}
