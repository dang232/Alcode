/**
 * host-capabilities.ts — the narrow, versioned bridge from a plugin tool to
 * host-owned delegation machinery.
 *
 * A tool never reaches into the engine. It asks this module for a capability;
 * if the host did not supply one, the tool fails closed with an actionable
 * error instead of inventing a child session or a task record.
 *
 * Authority rule: the caller identity comes from `OmoToolContext` (the host's
 * second execute argument). Nothing in a request may name the parent session,
 * the workspace, or the project — those are derived here from the caller.
 */

import { z } from "zod"

import type { OmoToolContext } from "../../plugin-types.ts"

/** Current capability contract version. Bump only with a compatible reader. */
export const HOST_CAPABILITY_VERSION = 1

export interface OmoAuthenticatedCaller {
  readonly sessionID: string
  readonly messageID: string
  readonly agent: string
  readonly directory: string
  readonly worktree: string
}

export interface OmoChildSessionRequest {
  readonly title: string
  readonly prompt: string
  readonly agent?: string
}

/** Mutable builder shape for `OmoChildSessionRequest`. */
export interface OmoChildSessionRequestDraft {
  title: string
  prompt: string
  agent?: string
}

export interface OmoChildSessionHandle {
  readonly childSessionID: string
  readonly parentSessionID: string
  readonly started: boolean
  readonly capabilityVersion: number
}

export interface OmoHostChildSessions {
  readonly version: number
  readonly createAndStart: (
    request: OmoChildSessionRequest,
    caller: OmoAuthenticatedCaller,
  ) => Promise<OmoChildSessionHandle>
}

export type OmoTaskState = "accepted" | "running" | "completed" | "failed" | "cancelled" | "unknown"

export interface OmoTaskRequest {
  readonly description: string
  readonly prompt: string
  readonly agent?: string
  readonly category?: string
  readonly background?: boolean
}

/** Mutable builder shape for `OmoTaskRequest`; optional fields are set only when present. */
export interface OmoTaskRequestDraft {
  description: string
  prompt: string
  agent?: string
  category?: string
  background?: boolean
}

export interface OmoTaskHandle {
  readonly taskID: string
  readonly parentSessionID: string
  readonly state: OmoTaskState
  readonly capabilityVersion: number
}

export interface OmoHostTasks {
  readonly version: number
  readonly start: (request: OmoTaskRequest, caller: OmoAuthenticatedCaller) => Promise<OmoTaskHandle>
}

export interface OmoHostCapabilities {
  readonly version: number
  /** Agents the host accepts for delegated work; absent means selection is unauthorized. */
  readonly allowedAgents?: readonly string[]
  readonly childSessions?: OmoHostChildSessions
  readonly tasks?: OmoHostTasks
}

const CapabilitySchema = z.object({
  version: z.literal(HOST_CAPABILITY_VERSION),
  allowedAgents: z.array(z.string()).optional(),
  childSessions: z.object({ createAndStart: z.function() }).optional(),
  tasks: z.object({ start: z.function() }).optional(),
})

/** A running host can only offer what it was built with; any other shape fails closed. */
export const capabilitiesOf = (source: OmoHostCapabilities | undefined): OmoHostCapabilities => {
  if (source === undefined) return { version: HOST_CAPABILITY_VERSION }
  const parsed = CapabilitySchema.safeParse(source)
  return parsed.success ? source : { version: HOST_CAPABILITY_VERSION }
}

export const callerFromContext = (context: OmoToolContext | undefined): OmoAuthenticatedCaller => {
  if (context === undefined) throw delegationError("UNAUTHENTICATED", "no host context was supplied")
  if (context.authenticated !== true) throw delegationError("UNAUTHENTICATED", "the host did not authenticate this call")
  const sessionID = context.sessionID
  if (sessionID.length === 0 || sessionID === "unknown") {
    throw delegationError("UNAUTHENTICATED", "the host supplied no usable session identity")
  }
  return {
    sessionID,
    messageID: context.messageID,
    agent: context.agent,
    directory: context.directory,
    worktree: context.worktree,
  }
}

export class DelegationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = "DelegationError"
    this.code = code
  }
}

export const delegationError = (code: string, message: string): DelegationError => new DelegationError(code, message)
