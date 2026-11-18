/**
 * host-provider.ts — builds the delegation capabilities a host runtime hands to
 * the plugin.
 *
 * The provider holds no authority of its own: it receives the host's own
 * create-session and start-session operations (in production these are the SDK
 * client and the routed prompt dispatcher), derives the parent from the
 * authenticated caller, and reports exactly what the host returned. A prompt
 * whose fate the host cannot prove is reported as unknown, never as delivered
 * and never as failed.
 */

import { z } from "zod"

import {
  HOST_CAPABILITY_VERSION,
  delegationError,
  type OmoAuthenticatedCaller,
  type OmoChildSessionHandle,
  type OmoChildSessionRequest,
  type OmoHostCapabilities,
  type OmoHostTasks,
  type OmoTaskHandle,
  type OmoTaskRequest,
} from "./host-capabilities.ts"

export interface OmoCreateSessionInput {
  readonly parentID: string
  readonly title: string
  readonly directory: string
}

export interface OmoCreateSessionResult {
  readonly sessionID?: string
  readonly parentID?: string
  readonly error?: string
}

export interface OmoStartSessionInput {
  readonly sessionID: string
  readonly prompt: string
  readonly agent?: string
  readonly directory: string
}

export type OmoStartOutcome = "accepted" | "refused" | "unknown"

export interface OmoStartSessionResult {
  readonly outcome: OmoStartOutcome
  readonly error?: string
}

export interface OmoDelegationRuntime {
  readonly createSession?: (input: OmoCreateSessionInput) => Promise<OmoCreateSessionResult>
  readonly startSession?: (input: OmoStartSessionInput) => Promise<OmoStartSessionResult>
  readonly allowedAgents?: readonly string[]
  readonly taskManager?: OmoTaskManagerSeam
}

/** Mutable builder shape for `OmoDelegationRuntime`; optionals are set only when present. */
export interface OmoDelegationRuntimeDraft {
  createSession?: (input: OmoCreateSessionInput) => Promise<OmoCreateSessionResult>
  startSession?: (input: OmoStartSessionInput) => Promise<OmoStartSessionResult>
  allowedAgents?: readonly string[]
  taskManager?: OmoTaskManagerSeam
}

/** The narrow operation set a V2 host may expose; never the SDK client. */
export interface OmoDelegationOperations {
  readonly createSession: (input: OmoCreateSessionInput) => Promise<OmoCreateSessionResult>
  readonly startSession: (input: OmoStartSessionInput) => Promise<OmoStartSessionResult>
  readonly allowedAgents?: readonly string[]
}

/** The canonical `senpi-task` manager satisfies this; the plugin never builds one. */
export interface OmoTaskManagerSeam {
  readonly start: (request: OmoTaskRequest & { readonly parentSessionID: string }) => Promise<{
    readonly taskID: string
    readonly state: OmoTaskHandle["state"]
  }>
}

interface StartSessionDraft {
  sessionID: string
  prompt: string
  directory: string
  agent?: string
}

interface ChildSessionsDraft {
  version: number
  createAndStart: (
    request: OmoChildSessionRequest,
    caller: OmoAuthenticatedCaller,
  ) => Promise<OmoChildSessionHandle>
}

interface CapabilitiesDraft {
  version: number
  allowedAgents?: readonly string[]
  childSessions?: OmoHostCapabilities["childSessions"]
  tasks?: OmoHostTasks
}

const requireAgent = (allowedAgents: readonly string[] | undefined, agent: string | undefined): void => {
  if (agent === undefined) return
  if (allowedAgents === undefined) {
    throw delegationError("FORBIDDEN", "this host publishes no authorized agent set, so a delegated agent may not be selected")
  }
  if (!allowedAgents.includes(agent)) {
    throw delegationError("FORBIDDEN", `agent ${agent} is not in the host-authorized set`)
  }
}

export const createChildSessions = (runtime: OmoDelegationRuntime): ChildSessionsDraft => ({
  version: HOST_CAPABILITY_VERSION,
  createAndStart: async (request, caller) => {
    const { createSession, startSession } = runtime
    if (createSession === undefined || startSession === undefined) {
      throw delegationError("CAPABILITY_UNAVAILABLE", "this host exposes no session operations")
    }
    requireAgent(runtime.allowedAgents, request.agent)
    const created = await createSession({ parentID: caller.sessionID, title: request.title, directory: caller.directory })
    if (created.error !== undefined) {
      throw delegationError("SESSION_CREATE_FAILED", created.error)
    }
    const childSessionID = created.sessionID
    if (childSessionID === undefined || childSessionID.length === 0) {
      throw delegationError("SESSION_CREATE_FAILED", "the host returned no session identity")
    }
    if (created.parentID !== undefined && created.parentID !== caller.sessionID) {
      throw delegationError("PARENT_ATTRIBUTION_MISMATCH", `the host created ${childSessionID} under ${created.parentID}, not the calling session`)
    }
    const start: StartSessionDraft = { sessionID: childSessionID, prompt: request.prompt, directory: caller.directory }
    if (request.agent !== undefined) start.agent = request.agent
    const started = await startSession(start)
    if (started.outcome === "refused") {
      throw delegationError(
        "PROMPT_SUBMIT_FAILED",
        `session ${childSessionID} exists but its first prompt was refused: ${started.error ?? "no reason given by the host"}`,
      )
    }
    if (started.outcome !== "accepted") {
      throw delegationError(
        "CHILD_STATUS_UNKNOWN",
        `session ${childSessionID} exists; whether its first prompt reached the host is unproven, so no completion is claimed`,
      )
    }
    return { childSessionID, parentSessionID: caller.sessionID, started: true, capabilityVersion: HOST_CAPABILITY_VERSION }
  },
})

const createTasks = (manager: OmoTaskManagerSeam): OmoHostTasks => ({
  version: HOST_CAPABILITY_VERSION,
  start: async (request: OmoTaskRequest, caller: OmoAuthenticatedCaller): Promise<OmoTaskHandle> => {
    if (!z.function().safeParse(manager.start).success) {
      throw delegationError("CAPABILITY_UNAVAILABLE", "this host's task seam exposes no start operation")
    }
    const started = await manager.start({ ...request, parentSessionID: caller.sessionID })
    if (started.taskID.length === 0) {
      throw delegationError("INTERNAL", "the canonical task manager returned no task identity")
    }
    return {
      taskID: started.taskID,
      parentSessionID: caller.sessionID,
      state: started.state,
      capabilityVersion: HOST_CAPABILITY_VERSION,
    }
  },
})

export const createHostCapabilities = (runtime: OmoDelegationRuntime): OmoHostCapabilities => {
  const capabilities: CapabilitiesDraft = { version: HOST_CAPABILITY_VERSION }
  if (runtime.createSession !== undefined && runtime.startSession !== undefined) {
    capabilities.childSessions = createChildSessions(runtime)
  }
  if (runtime.allowedAgents !== undefined) capabilities.allowedAgents = runtime.allowedAgents
  if (runtime.taskManager !== undefined) capabilities.tasks = createTasks(runtime.taskManager)
  return capabilities
}
