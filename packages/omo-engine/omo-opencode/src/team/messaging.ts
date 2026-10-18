/**
 * Native team member operations: member inbox delivery.
 *
 * Writes a message to the durable recipient inbox(es) and returns. Recipient
 * polling delivers later, so the send path never reserves, reads, or
 * notifies. Broadcast ("*") remains lead-only, and the lead sentinel is a
 * real inbox recipient.
 */
import { randomUUID } from "node:crypto"

import type { TeamModeConfig } from "../../../team-core/src/config.ts"
import { listUnreadMessages } from "../../../team-core/src/team-mailbox/inbox.ts"
import { ackMessages } from "../../../team-core/src/team-mailbox/ack.ts"
import {
  buildEnvelope as buildPeerMessageEnvelope,
  pollAndBuildInjection,
  type InjectionResult,
} from "../../../team-core/src/team-mailbox/poll.ts"
import { sendMessage } from "../../../team-core/src/team-mailbox/send.ts"
import type { Message } from "../../../team-core/src/types.ts"

import { TEAM_LEAD_SENTINEL } from "./runtime-config.ts"

export { buildPeerMessageEnvelope }
export type { InjectionResult }

export type BuildTeamMessageOptions = {
  readonly now?: () => number
  readonly newMessageId?: () => string
}

export type SendTeamMessageInput = {
  readonly from: string
  /** A member name, the reserved lead sentinel "lead", or "*" for a lead broadcast to every member. */
  readonly to: string
  readonly body: string
  readonly summary?: string
}

export type MessagingEngineDeps = {
  readonly teamRunId: string
  readonly config: TeamModeConfig
  readonly activeMembers: readonly string[]
  readonly now?: () => number
  readonly newMessageId?: () => string
}

export type SendTeamMessageResult =
  | { readonly kind: "to_lead"; readonly messageId: string }
  | { readonly kind: "to_members"; readonly messageId: string; readonly recipients: readonly string[] }

/**
 * Builds a `kind: "message"` team-core `Message` for a team send.
 * `messageId`/`timestamp` are injected (defaulting to
 * `randomUUID`/`Date.now`) so tests stay deterministic. `to` passes through
 * verbatim: a member name, the lead sentinel, or "*".
 */
export function buildTeamMessage(
  input: Pick<SendTeamMessageInput, "from" | "to" | "body" | "summary">,
  options: BuildTeamMessageOptions = {},
): Message {
  const timestamp = (options.now ?? Date.now)()
  const messageId = (options.newMessageId ?? randomUUID)()
  const base: Message = {
    version: 1,
    messageId,
    from: input.from,
    to: input.to,
    kind: "message",
    body: input.body,
    timestamp,
  }
  return input.summary === undefined ? base : { ...base, summary: input.summary }
}

export async function sendTeamMessage(
  input: SendTeamMessageInput,
  deps: MessagingEngineDeps,
): Promise<SendTeamMessageResult> {
  const message = buildTeamMessage(input, {
    ...(deps.now !== undefined ? { now: deps.now } : {}),
    ...(deps.newMessageId !== undefined ? { newMessageId: deps.newMessageId } : {}),
  })
  const isLead = input.from === TEAM_LEAD_SENTINEL

  const sent = await sendMessage(message, deps.teamRunId, deps.config, {
    isLead,
    activeMembers: [...deps.activeMembers],
    ...(input.to === TEAM_LEAD_SENTINEL ? { leadRecipient: TEAM_LEAD_SENTINEL } : {}),
  }).catch((error: unknown) => {
    // team-core does not re-export InvalidRecipientError; key on its stable name instead.
    if (error instanceof Error && error.name === "InvalidRecipientError") {
      const members = [...deps.activeMembers].sort().join(", ")
      // Keep the stable error name so the tool layer still maps this to invalid_recipient.
      throw Object.assign(
        new Error(
          `unknown or inactive team recipient: ${input.to}. Members: ${members}. Use a member name, '${TEAM_LEAD_SENTINEL}', or '*' (lead-only broadcast).`,
          { cause: error },
        ),
        { name: "InvalidRecipientError" },
      )
    }
    throw error
  })

  return input.to === TEAM_LEAD_SENTINEL
    ? { kind: "to_lead", messageId: sent.messageId }
    : { kind: "to_members", messageId: sent.messageId, recipients: sent.deliveredTo }
}

export function listUnreadMemberMessages(
  teamRunId: string,
  memberName: string,
  config: TeamModeConfig,
): Promise<Message[]> {
  return listUnreadMessages(teamRunId, memberName, config)
}

export function ackMemberMessages(
  teamRunId: string,
  memberName: string,
  messageIds: string[],
  config: TeamModeConfig,
): Promise<void> {
  return ackMessages(teamRunId, memberName, messageIds, config)
}

export function pollMemberInbox(
  sessionId: string,
  memberName: string,
  teamRunId: string,
  config: TeamModeConfig,
  turnMarker: string,
): Promise<InjectionResult> {
  return pollAndBuildInjection(sessionId, memberName, teamRunId, config, turnMarker)
}
