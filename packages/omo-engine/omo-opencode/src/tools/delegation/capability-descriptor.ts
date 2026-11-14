/**
 * capability-descriptor.ts — the engine-carried descriptor that lets the host
 * supply the two delegation capabilities without handing the plugin an SDK
 * client.
 *
 * The descriptor arrives through the V2 setup context's `options` (the engine
 * passes plugin options from the managed config tuple). It names a narrow,
 * token-authenticated endpoint set the host serves; nothing else about the host
 * is reachable from it. A malformed or absent descriptor yields no capability,
 * so the tools refuse instead of guessing.
 */

import { z } from "zod"

import type { OmoJsonValue } from "../../plugin-types.ts"
import type { OmoCreateSessionInput, OmoCreateSessionResult, OmoDelegationOperations, OmoStartSessionInput, OmoStartSessionResult } from "./host-provider.ts"

const OutcomeSchema = z.enum(["accepted", "refused", "unknown"])

const HostCapabilityOptions = z.object({
  hostCapabilities: z.object({
    version: z.literal(1),
    url: z
      .string()
      .url()
      .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
        message: "the host capability url must be http or https",
      }),
    token: z.string().min(1),
    allowedAgents: z.array(z.string()).optional(),
  }),
})

export type OmoCapabilityDescriptor = z.infer<typeof HostCapabilityOptions>["hostCapabilities"]

const CreateResponse = z.object({ sessionID: z.string().min(1), parentID: z.string().optional() })
const StartResponse = z.object({ outcome: OutcomeSchema, error: z.string().optional() })
const TaskResponse = z.object({ taskID: z.string().min(1), state: z.enum(["accepted", "running", "completed", "failed", "cancelled", "unknown"]) })

const TIMEOUT_MS = 30_000

const post = async (descriptor: OmoCapabilityDescriptor, path: string, bodyJson: string): Promise<{ ok: true; payload: z.infer<typeof AnyPayload> } | { ok: false; error: string }> => {
  try {
    const response = await fetch(`${descriptor.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${descriptor.token}` },
      body: bodyJson,
      // A redirect could forward the bearer token or turn a 30x into a probe.
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return { ok: false, error: `host capability endpoint returned ${response.status}` }
    return { ok: true, payload: AnyPayload.parse(await response.json()) }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

const AnyPayload = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())])

/** Read the descriptor the host injected; anything malformed yields nothing. */
export const readCapabilityDescriptor = (options: OmoJsonValue | undefined): OmoCapabilityDescriptor | undefined => {
  const parsed = HostCapabilityOptions.safeParse(options)
  return parsed.success ? parsed.data.hostCapabilities : undefined
}

interface OperationsDraft {
  createSession: (input: OmoCreateSessionInput) => Promise<OmoCreateSessionResult>
  startSession: (input: OmoStartSessionInput) => Promise<OmoStartSessionResult>
  allowedAgents?: readonly string[]
}

interface StartBodyDraft {
  sessionID: string
  prompt: string
  directory: string
  agent?: string
}

export const createOperationsFromDescriptor = (descriptor: OmoCapabilityDescriptor): OmoDelegationOperations => {
  const operations: OperationsDraft = {
    createSession: async (input) => {
      const sent = await post(descriptor, "/capability/session", JSON.stringify({ parentID: input.parentID, title: input.title, directory: input.directory }))
      if (!sent.ok) return { error: sent.error }
      const parsed = CreateResponse.safeParse(sent.payload)
      if (!parsed.success) return { error: "the host returned no usable session identity" }
      return parsed.data.parentID === undefined ? { sessionID: parsed.data.sessionID } : { sessionID: parsed.data.sessionID, parentID: parsed.data.parentID }
    },
    startSession: async (input) => {
      const body: StartBodyDraft = { sessionID: input.sessionID, prompt: input.prompt, directory: input.directory }
      if (input.agent !== undefined) body.agent = input.agent
      const sent = await post(descriptor, "/capability/session/start", JSON.stringify(body))
      if (!sent.ok) return { outcome: "unknown", error: sent.error }
      const parsed = StartResponse.safeParse(sent.payload)
      if (!parsed.success) return { outcome: "unknown", error: "the host returned an unusable start outcome" }
      return parsed.data.error === undefined ? { outcome: parsed.data.outcome } : { outcome: parsed.data.outcome, error: parsed.data.error }
    },
  }
  if (descriptor.allowedAgents !== undefined) operations.allowedAgents = descriptor.allowedAgents
  return operations
}

export interface OmoInjectedTaskOperations {
  readonly taskManager: {
    start: (request: { description: string; prompt: string; agent?: string; category?: string; background?: boolean; parentSessionID: string }) => Promise<{
      taskID: string
      state: "accepted" | "running" | "completed" | "failed" | "cancelled" | "unknown"
    }>
  }
}

export const createTaskOperationsFromDescriptor = (descriptor: OmoCapabilityDescriptor): OmoInjectedTaskOperations => ({
  taskManager: {
    start: async (request) => {
      const sent = await post(descriptor, "/capability/task", JSON.stringify(request))
      if (!sent.ok) throw new Error(`TASK_MANAGER_UNAVAILABLE: ${sent.error}`)
      const parsed = TaskResponse.safeParse(sent.payload)
      if (!parsed.success) throw new Error("INTERNAL: the host returned no usable task identity")
      return parsed.data
    },
  },
})
