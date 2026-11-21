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

type OmoCapabilityDescriptor = z.infer<typeof HostCapabilityOptions>["hostCapabilities"]

const CreateResponse = z.object({ sessionID: z.string().min(1), parentID: z.string().optional() })
const StartResponse = z.object({ outcome: OutcomeSchema, error: z.string().optional() })
const TaskResponse = z.object({ taskID: z.string().min(1), state: z.enum(["accepted", "running", "completed", "failed", "cancelled", "unknown"]) })
const TaskOutputResponse = z.object({ taskID: z.string().min(1), output: z.unknown() })

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

/**
 * The same descriptor, published by the host that launches this plugin as environment instead of plugin options.
 * OpenCode 2.x accepts only string plugin entries, and skips a `[directory, options]` tuple as malformed in both the
 * config file and the inline config, so the environment is the channel that survives config normalization.
 */
export const readCapabilityDescriptorFromEnv = (
  env: Readonly<Record<string, string | undefined>>,
): OmoCapabilityDescriptor | undefined => {
  const url = env.OMO_CAPABILITY_URL
  const token = env.OMO_CAPABILITY_TOKEN
  if (url === undefined || token === undefined) return undefined
  const allowed = env.OMO_CAPABILITY_ALLOWED_AGENTS
  if (allowed === undefined || allowed.trim().length === 0) {
    return readCapabilityDescriptor({ hostCapabilities: { version: 1, url, token } })
  }
  const allowedAgents = allowed.split(',').map((name) => name.trim()).filter((name) => name.length > 0)
  return readCapabilityDescriptor({ hostCapabilities: { version: 1, url, token, allowedAgents } })
}

interface OperationsDraft {
  createSession: (input: OmoCreateSessionInput) => Promise<OmoCreateSessionResult>
  startSession: (input: OmoStartSessionInput) => Promise<OmoStartSessionResult>
  readonly monitor?: {
    readonly version: number
    readonly start: (
      request: { readonly command: string; readonly filter?: string; readonly timeoutMs?: number },
      caller: { readonly sessionID: string },
    ) => Promise<{ readonly accepted: boolean }>
  }
  readSession?: (input: { readonly sessionID: string; readonly directory: string }) => Promise<{
    readonly kind: "status" | "missing"
    readonly messages?: readonly { readonly role: string; readonly text: string }[]
    readonly tools?: readonly {
      readonly name: string
      readonly status?: string
      readonly input: string
      readonly output: string
    }[]
    readonly finalResponse?: string
    readonly reason?: string
  }>
  allowedAgents?: readonly string[]
}

interface StartBodyDraft {
  sessionID: string
  prompt: string
  directory: string
  agent?: string
}

interface SessionReadDraft {
  kind: "status" | "missing"
  messages?: readonly { readonly role: string; readonly text: string }[]
  tools?: readonly { readonly name: string; readonly status?: string; readonly input: string; readonly output: string }[]
  finalResponse?: string
  reason?: string
}

interface MonitorRequestBody {
  sessionID: string
  command: string
  filter?: string
  timeoutMs?: number
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
  operations.readSession = async (input) => {
    const sent = await post(descriptor, "/capability/session/read", JSON.stringify({ sessionID: input.sessionID, directory: input.directory }))
    if (!sent.ok) throw new Error(`SESSION_READ_FAILED: ${sent.error}`)
    const body = sent.payload
    const messages = Array.isArray(body["messages"])
      ? body["messages"].flatMap((raw) => {
          if (typeof raw !== "object" || raw === null) return []
          const role = raw["role"]
          const text = raw["text"]
          return typeof role === "string" && typeof text === "string" ? [{ role, text }] : []
        })
      : undefined
    const tools = Array.isArray(body["tools"])
      ? body["tools"].flatMap((raw) => {
          if (typeof raw !== "object" || raw === null) return []
          const name = raw["name"]
          const input = raw["input"]
          const output = raw["output"]
          const status = raw["status"]
          if (typeof name !== "string") return []
          return [
            {
              name,
              input: typeof input === "string" ? input : "",
              output: typeof output === "string" ? output : "",
              ...(typeof status === "string" ? { status } : {}),
            },
          ]
        })
      : undefined
    const finalResponse = typeof body["final_response"] === "string" ? body["final_response"] : undefined
    const reason = typeof body["reason"] === "string" ? body["reason"] : undefined
    const draft: SessionReadDraft = {
      kind: body["kind"] === "missing" ? "missing" : "status",
    }
    if (messages !== undefined) draft.messages = messages
    if (tools !== undefined) draft.tools = tools
    if (finalResponse !== undefined) draft.finalResponse = finalResponse
    if (reason !== undefined) draft.reason = reason
    return draft
  }
  operations.monitor = {
    version: 1,
    start: async (request, caller) => {
      const body: MonitorRequestBody = { sessionID: caller.sessionID, command: request.command }
      if (request.filter !== undefined) body.filter = request.filter
      if (request.timeoutMs !== undefined) body.timeoutMs = request.timeoutMs
      const sent = await post(descriptor, "/capability/monitor", JSON.stringify(body))
      if (!sent.ok) throw new Error(`MONITOR_FAILED: ${sent.error}`)
      return { accepted: sent.payload["accepted"] === true }
    },
  }
  if (descriptor.allowedAgents !== undefined) operations.allowedAgents = descriptor.allowedAgents
  return operations
}

interface OmoInjectedTaskOperations {
  readonly taskManager: {
    start: (request: { description: string; prompt: string; agent?: string; category?: string; background?: boolean; parentSessionID: string }) => Promise<{
      taskID: string
      state: "accepted" | "running" | "completed" | "failed" | "cancelled" | "unknown"
    }>
    readOutput: (request: { taskID: string; parentSessionID: string }) => Promise<{ taskID: string; output: unknown }>
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
    readOutput: async (request) => {
      const sent = await post(descriptor, "/capability/task/output", JSON.stringify({ taskID: request.taskID }))
      if (!sent.ok) throw new Error(`TASK_OUTPUT_UNAVAILABLE: ${sent.error}`)
      const parsed = TaskOutputResponse.safeParse(sent.payload)
      if (!parsed.success) throw new Error("INTERNAL: the host returned no usable task output")
      return parsed.data
    },
  },
})
