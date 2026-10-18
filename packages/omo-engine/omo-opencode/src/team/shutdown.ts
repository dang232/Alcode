import { loadRuntimeState, transitionRuntimeState } from "../../../team-core/src/team-state-store/store.ts"
import type { TeamModeConfig as TeamCoreConfig } from "../../../team-core/src/config.ts"
import type { RuntimeState } from "../../../team-core/src/types.ts"

import { TeamRuntimeError } from "./runtime-errors.ts"
import {
  findLatestShutdownRequestIndex,
  findTeamMember,
  isShutdownRequestUnresolved,
} from "./shutdown-helpers.ts"

export type ShutdownMessageKind = "shutdown_request" | "shutdown_approved" | "shutdown_rejected"

/** One shutdown-protocol message the lead emits toward a member. */
export type ShutdownOutboundMessage = {
  readonly to: string
  readonly kind: ShutdownMessageKind
  readonly body: string
}

export type ShutdownMessenger = (message: ShutdownOutboundMessage) => Promise<void>

export type RequestShutdownDeps = {
  readonly config: TeamCoreConfig
  readonly sendMessage: ShutdownMessenger
  readonly now?: () => number
}

export type ApproveShutdownDeps = RequestShutdownDeps & {
  /** Cancels the member's live session; runs after the approval is persisted. */
  readonly cancelMemberSession: (memberName: string, sessionId: string | undefined) => Promise<void>
}

export type RejectShutdownDeps = RequestShutdownDeps

function requireMember(state: RuntimeState, teamRunId: string, memberName: string): void {
  if (findTeamMember(state, memberName) === undefined) {
    throw new TeamRuntimeError(`unknown team member '${memberName}'`, "unknown_member", teamRunId)
  }
}

function requirePendingRequestIndex(state: RuntimeState, teamRunId: string, memberName: string): number {
  const index = findLatestShutdownRequestIndex(state, memberName)
  if (index < 0 || !isShutdownRequestUnresolved(state.shutdownRequests[index])) {
    throw new TeamRuntimeError(`no pending shutdown request for '${memberName}'`, "no_pending_request", teamRunId)
  }
  return index
}

/**
 * Lead asks a member to shut down: delivers a `shutdown_request` message to
 * the member, then records an unresolved request stamped by the lead. A
 * no-op while a request for the member is already pending; a resolved prior
 * request never blocks a fresh one.
 */
export async function requestShutdown(
  teamRunId: string,
  memberName: string,
  deps: RequestShutdownDeps,
): Promise<RuntimeState> {
  const state = await loadRuntimeState(teamRunId, deps.config)
  requireMember(state, teamRunId, memberName)

  const existingIndex = findLatestShutdownRequestIndex(state, memberName)
  if (isShutdownRequestUnresolved(state.shutdownRequests[existingIndex])) return state

  await deps.sendMessage({ to: memberName, kind: "shutdown_request", body: "" })

  const requestedAt = (deps.now ?? Date.now)()
  return transitionRuntimeState(
    teamRunId,
    (current) => {
      const currentIndex = findLatestShutdownRequestIndex(current, memberName)
      if (isShutdownRequestUnresolved(current.shutdownRequests[currentIndex])) return current
      return {
        ...current,
        shutdownRequests: [
          ...current.shutdownRequests,
          { memberId: memberName, requesterName: "lead", requestedAt },
        ],
      }
    },
    deps.config,
  )
}

/**
 * Lead approves a pending shutdown: marks the member `shutdown_approved`
 * (a member that already finished or errored keeps its terminal status),
 * stamps the request approved, cancels the member's session, then notifies
 * the member. A no-op once the request is already approved.
 */
export async function approveShutdown(
  teamRunId: string,
  memberName: string,
  deps: ApproveShutdownDeps,
): Promise<RuntimeState> {
  const state = await loadRuntimeState(teamRunId, deps.config)
  requireMember(state, teamRunId, memberName)
  const requestIndex = requirePendingRequestIndex(state, teamRunId, memberName)
  if (state.shutdownRequests[requestIndex]?.approvedAt !== undefined) return state

  const approvedAt = (deps.now ?? Date.now)()
  const updated = await transitionRuntimeState(
    teamRunId,
    (current) => {
      const currentIndex = findLatestShutdownRequestIndex(current, memberName)
      return {
        ...current,
        members: current.members.map((member) => {
          if (member.name !== memberName || member.status === "completed" || member.status === "errored") return member
          return { ...member, status: "shutdown_approved" }
        }),
        shutdownRequests: current.shutdownRequests.map((request, index) =>
          index === currentIndex ? { ...request, approvedAt } : request,
        ),
      }
    },
    deps.config,
  )

  const sessionId = findTeamMember(updated, memberName)?.sessionId
  await deps.cancelMemberSession(memberName, sessionId)
  await deps.sendMessage({ to: memberName, kind: "shutdown_approved", body: memberName })
  return updated
}

/**
 * Lead rejects a pending shutdown: notifies the member with the reason so
 * it keeps working, then records the rejection while leaving the member's
 * live status untouched. A no-op when the latest request already carries the
 * same rejection reason.
 */
export async function rejectShutdown(
  teamRunId: string,
  memberName: string,
  reason: string,
  deps: RejectShutdownDeps,
): Promise<RuntimeState> {
  const state = await loadRuntimeState(teamRunId, deps.config)
  requireMember(state, teamRunId, memberName)
  const requestIndex = requirePendingRequestIndex(state, teamRunId, memberName)

  const existing = state.shutdownRequests[requestIndex]
  if (existing?.rejectedAt !== undefined && existing.rejectedReason === reason) return state

  await deps.sendMessage({ to: memberName, kind: "shutdown_rejected", body: reason })

  const rejectedAt = (deps.now ?? Date.now)()
  return transitionRuntimeState(
    teamRunId,
    (current) => {
      const currentIndex = findLatestShutdownRequestIndex(current, memberName)
      return {
        ...current,
        shutdownRequests: current.shutdownRequests.map((request, index) =>
          index === currentIndex ? { ...request, rejectedAt, rejectedReason: reason } : request,
        ),
      }
    },
    deps.config,
  )
}

export type { RuntimeState }
