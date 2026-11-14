/**
 * delegation-tools.ts — the `task` and `call_omo_agent` tools.
 *
 * These tools own request validation and authority derivation. They do not own
 * orchestration: the task manager and the session API belong to the host, so a
 * missing capability is reported as unavailable rather than emulated. A tool
 * result never claims a child ran when the host did not start one.
 */

import { z } from "zod"

import type { OmoJsonObject, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
import {
  callerFromContext,
  capabilitiesOf,
  delegationError,
  type OmoAuthenticatedCaller,
  type OmoChildSessionRequest,
  type OmoChildSessionRequestDraft,
  type OmoHostCapabilities,
  type OmoTaskRequest,
  type OmoTaskRequestDraft,
  type OmoTaskState,
} from "./host-capabilities.ts"

export const TASK_TOOL_NAME = "task"
export const CALL_OMO_AGENT_TOOL_NAME = "call_omo_agent"

const MAX_PROMPT_CHARS = 200_000

const TaskArgs = z.object({
  description: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
  agent: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  background: z.boolean().optional(),
})

const CallAgentArgs = z.object({
  description: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
  agent: z.string().trim().min(1).optional(),
})

const FORBIDDEN_ARGUMENTS = [
  "sessionID",
  "sessionId",
  "parentID",
  "parentSessionId",
  "parentSessionID",
  "directory",
  "worktree",
  "projectId",
  "projectID",
]

const rejectIdentityArguments = (raw: OmoJsonObject): void => {  for (const field of FORBIDDEN_ARGUMENTS) {
    if (raw[field] !== undefined) {
      throw delegationError("INVALID_ARGUMENT", `${field} is host-derived and may not be supplied by a tool call`)
    }
  }
}

const requireAgentAuthorized = (capabilities: OmoHostCapabilities, agent: string | undefined, what: string): void => {
  if (agent === undefined) return
  const allowed = capabilities.allowedAgents
  if (allowed === undefined) {
    throw delegationError("FORBIDDEN", `${what} may not select an agent: this host publishes no authorized agent set`)
  }
  if (!allowed.includes(agent)) {
    throw delegationError("FORBIDDEN", `${what} may not select agent ${agent}: it is not in the host-authorized set`)
  }
}

const requireHostParent = (handle: { readonly childSessionID?: string; readonly parentSessionID: string }, caller: OmoAuthenticatedCaller): void => {
  if (handle.parentSessionID !== caller.sessionID) {
    throw delegationError("PARENT_ATTRIBUTION_MISMATCH", `the host attributed this result to ${handle.parentSessionID}, not to the calling session`)
  }
  if (handle.childSessionID !== undefined && handle.childSessionID === caller.sessionID) {
    throw delegationError("PARENT_ATTRIBUTION_MISMATCH", "the host returned the calling session as the child")
  }
}

const parse = <T>(schema: z.ZodType<T>, raw: OmoJsonObject, what: string): T => {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const first = result.error.issues[0]
    const where = first === undefined ? "unexpected shape" : `${first.path.join(".") || "value"} ${first.message}`
    throw delegationError("INVALID_ARGUMENT", `${what} arguments are invalid: ${where}`)
  }
  return result.data
}

const TASK_DESCRIPTION =
  "Launch a host-owned task through the canonical task manager. Requires host-authenticated context; the caller session is derived by the host, never from arguments."

const CALL_AGENT_DESCRIPTION =
  "Delegate bounded work to a named helper agent in a genuine native child session. The parent session is derived from host context; the result reports the real child identity and whether its first prompt was submitted."

export interface DelegationToolDeps {
  readonly directory: string
  readonly capabilities?: OmoHostCapabilities
}

export interface DelegationTools {
  readonly task: OmoToolDefinition
  readonly callOmoAgent: OmoToolDefinition
}

const buildTaskRequest = (args: z.infer<typeof TaskArgs>): OmoTaskRequest => {
  const request: OmoTaskRequestDraft = {
    description: args.description,
    prompt: args.prompt,
  }
  if (args.agent !== undefined) request.agent = args.agent
  if (args.category !== undefined) request.category = args.category
  if (args.background !== undefined) request.background = args.background
  return request
}

const buildChildRequest = (args: z.infer<typeof CallAgentArgs>): OmoChildSessionRequest => {
  const request: OmoChildSessionRequestDraft = { title: args.description, prompt: args.prompt }
  if (args.agent !== undefined) request.agent = args.agent
  return request
}

const taskResult = (handle: { taskID: string; parentSessionID: string; state: OmoTaskState; capabilityVersion: number }): string =>
  JSON.stringify({
    taskID: handle.taskID,
    parentSessionID: handle.parentSessionID,
    state: handle.state,
    capabilityVersion: handle.capabilityVersion,
  })

const childResult = (handle: { childSessionID: string; parentSessionID: string; started: boolean; capabilityVersion: number }): string =>
  JSON.stringify({
    childSessionID: handle.childSessionID,
    parentSessionID: handle.parentSessionID,
    started: handle.started,
    capabilityVersion: handle.capabilityVersion,
  })

export const createDelegationTools = (deps: DelegationToolDeps): DelegationTools => {
  const capabilities = capabilitiesOf(deps.capabilities)

  const task: OmoToolDefinition = {
    description: TASK_DESCRIPTION,
    args: {
      properties: {
        description: { type: "string", description: "Short label for the task." },
        prompt: { type: "string", description: "Instructions for the task." },
        agent: { type: "string", description: "Agent the host authorizes for this task." },
        category: { type: "string", description: "Category the host routes the task through." },
        background: { type: "boolean", description: "Return as soon as the host accepts the task." },
      },
      required: ["description", "prompt"],
    },
    execute: async (rawArgs: OmoJsonObject, context?: OmoToolContext): Promise<string> => {
      const caller: OmoAuthenticatedCaller = callerFromContext(context)
      if (context?.aborted() === true) {
        throw delegationError("CANCELLED", "the caller was already aborted; no task was started")
      }
      rejectIdentityArguments(rawArgs)
      const args = parse(TaskArgs, rawArgs, "task")
      requireAgentAuthorized(capabilities, args.agent, "task")
      const tasks = capabilities.tasks
      if (tasks === undefined) {
        throw delegationError(
          "CAPABILITY_UNAVAILABLE",
          "this host exposes no task capability (host.tasks.start is missing), so no task was created",
        )
      }
      const handle = await tasks.start(buildTaskRequest(args), caller)
      requireHostParent(handle, caller)
      return taskResult(handle)
    },
  }

  const callOmoAgent: OmoToolDefinition = {
    description: CALL_AGENT_DESCRIPTION,
    args: {
      properties: {
        description: { type: "string", description: "Title for the child session." },
        prompt: { type: "string", description: "Instructions for the child agent." },
        agent: { type: "string", description: "Agent the host authorizes for the child." },
      },
      required: ["description", "prompt"],
    },
    execute: async (rawArgs: OmoJsonObject, context?: OmoToolContext): Promise<string> => {
      const caller = callerFromContext(context)
      if (context?.aborted() === true) {
        throw delegationError("CANCELLED", "the caller was already aborted; no child session was created")
      }
      rejectIdentityArguments(rawArgs)
      const args = parse(CallAgentArgs, rawArgs, "call_omo_agent")
      requireAgentAuthorized(capabilities, args.agent, "call_omo_agent")
      const childSessions = capabilities.childSessions
      if (childSessions === undefined) {
        throw delegationError(
          "CAPABILITY_UNAVAILABLE",
          "this host exposes no child-session capability (session.create/session.prompt are missing), so no child was created",
        )
      }
      const handle = await childSessions.createAndStart(buildChildRequest(args), caller)
      requireHostParent(handle, caller)
      return childResult(handle)
    },
  }

  return { task, callOmoAgent }
}
