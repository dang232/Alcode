import { OpenCode } from "@opencode/client"
import type {
  OpenCodeClient as GeneratedV2Client,
  SessionInfo,
  SessionInboxUser,
  SessionInboxSynthetic,
  SessionMessageInfo,
  SessionCreateInput,
} from "@opencode/client"
import { z } from "zod"
import { findWorkingOpencodeBinary } from "./opencode-binary-resolver"
import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"
import { getServerBasicAuthHeader } from "../../shared/opencode-server-auth"
import type { Todo, ChildSession, SessionStatus, EventPayload } from "./types"

/**
 * opencode-v2-client.ts — engine-side OpenCode 2.x protocol adapter.
 *
 * The managed run path historically spoke the 1.x protocol through
 * `@opencode-ai/sdk` (banner `opencode server listening`, routes under
 * `/session`, `{data, error}` envelopes, `{type, properties}` events).
 * The pinned CLI (2.0.32) speaks 2.x instead (`server listening on ...`,
 * routes under `/api/*`, direct data with thrown tagged errors, flat
 * `{type, data}` events). This module owns that boundary so the rest of
 * the run path keeps its method names, envelope shapes, and gate logic.
 *
 * Why an adapter and not a second client abstraction: every consumer in
 * `cli/run` keeps calling the same engine-shaped surface; the 2.x wire
 * knowledge lives in exactly one module instead of spreading across the
 * poll loop, completion checks, dispatch gate, and lifecycle code.
 */

const MIN_SUPPORTED_MAJOR = 2
const MIN_SUPPORTED_VERSION = "2.0.20"

const BANNER_TIMEOUT_MS = 20_000
const HEALTH_TIMEOUT_MS = 15_000
const HEALTH_POLL_MS = 250

export class V2ProtocolError extends Error {
  readonly status?: number
  readonly code: string
  readonly tag?: string

  constructor(message: string, options?: { status?: number; code?: string; tag?: string; cause?: Error }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = "V2ProtocolError"
    this.status = options?.status
    this.code = options?.code ?? "V2_PROTOCOL_ERROR"
    this.tag = options?.tag
  }
}

export class V2UnsupportedServerError extends V2ProtocolError {
  constructor(version: string) {
    super(`Unsupported OpenCode server version ${version}: Alcode requires OpenCode ${MIN_SUPPORTED_VERSION} or newer (major ${MIN_SUPPORTED_MAJOR}).`, {
      code: "V2_UNSUPPORTED_SERVER",
    })
    this.name = "V2UnsupportedServerError"
  }
}

export class V2ReadinessError extends V2ProtocolError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, { code: "V2_READINESS_TIMEOUT", ...options })
    this.name = "V2ReadinessError"
  }
}

function compareRelease(left: string, right: string): number {
  const parse = (version: string): number[] =>
    version.split(/[-+]/, 1)[0].split(".").map((part) => Number.parseInt(part, 10))
  const leftParts = parse(left)
  const rightParts = parse(right)
  for (let index = 0; index < 3; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (!Number.isNaN(diff) && diff !== 0) return diff
  }
  return 0
}

export function assertSupportedServerVersion(version: string): void {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(version.trim())
  if (!match) {
    throw new V2UnsupportedServerError(version)
  }
  const major = Number.parseInt(match[1] ?? "0", 10)
  if (major !== MIN_SUPPORTED_MAJOR || compareRelease(version, MIN_SUPPORTED_VERSION) < 0) {
    throw new V2UnsupportedServerError(version)
  }
}

export interface ManagedV2Server {
  baseUrl: string
  password?: string
  stop: () => Promise<void>
}

export interface SpawnedServerProcess {
  readonly stdout: ReadableStream<Uint8Array> | undefined
  kill(signal?: NodeJS.Signals): void
  readonly exited: Promise<unknown>
}

export interface SpawnManagedV2ServerOptions {
  port: number
  signal?: AbortSignal
  findBinary?: () => Promise<string | null>
  spawnImpl?: (command: string[], options: { stdout: "pipe"; stderr: "pipe" }) => SpawnedServerProcess
  bannerTimeoutMs?: number
  healthTimeoutMs?: number
  fetchImpl?: typeof fetch
}

interface BannerRead {
  url?: string
  password?: string
}

function parseBannerLine(line: string, read: BannerRead): void {
  const listen = /(?:opencode )?server listening on (https?:\/\/\S+)/.exec(line)
  if (listen?.[1] && !read.url) {
    read.url = listen[1].replace(/\/$/, "")
  }
  const password = /^server password (\S+)\s*$/.exec(line.trim())
  if (password?.[1] && !read.password) {
    read.password = password[1]
  }
}

async function readBanner(
  stdout: ReadableStream<Uint8Array> | undefined,
  timeoutMs: number,
): Promise<BannerRead> {
  const read: BannerRead = {}
  if (!stdout) {
    throw new V2ReadinessError("Managed server produced no readable stdout.")
  }
  const reader = stdout.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  const deadline = Date.now() + timeoutMs
  try {
    while (!read.url) {
      if (Date.now() > deadline) {
        throw new V2ReadinessError(
          `Managed server did not print a listening banner within ${timeoutMs}ms.`,
        )
      }
      const remaining = deadline - Date.now()
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("banner read timeout")), Math.max(remaining, 0)),
        ),
      ]).catch(() => null)
      if (!chunk || chunk.done) {
        const lines = pending.split("\n")
        for (const line of lines) parseBannerLine(line, read)
        if (!read.url) {
          throw new V2ReadinessError("Managed server stdout ended before printing a listening banner.")
        }
        break
      }
      pending += decoder.decode(chunk.value, { stream: true })
      const lines = pending.split("\n")
      pending = lines.pop() ?? ""
      for (const line of lines) parseBannerLine(line, read)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // The stream is already closed; release is best-effort.
    }
  }
  return read
}

const serverInfoSchema = z.object({ version: z.string() })

async function waitForHealthyServer(options: {
  baseUrl: string
  password?: string
  timeoutMs: number
  fetchImpl: typeof fetch
}): Promise<string> {
  const baseHeaders = { Accept: "application/json" }
  const auth = options.password
    ? `Basic ${Buffer.from(`opencode:${options.password}`, "utf8").toString("base64")}`
    : getServerBasicAuthHeader()
  const headers = auth ? { ...baseHeaders, Authorization: auth } : baseHeaders

  const deadline = Date.now() + options.timeoutMs
  let lastDetail = "no attempt made"
  while (Date.now() <= deadline) {
    try {
      const response = await options.fetchImpl(`${options.baseUrl}/api/info`, {
        headers,
        signal: AbortSignal.timeout(HEALTH_POLL_MS * 4),
      })
      if (response.status === 401 || response.status === 403) {
        throw new V2ProtocolError(
          `Managed server at ${options.baseUrl} requires auth the engine cannot satisfy (status ${response.status}).`,
          { status: response.status, code: "V2_SERVER_AUTH" },
        )
      }
      if (!response.ok) {
        throw new V2ProtocolError(
          `Managed server health check failed with status ${response.status} at ${options.baseUrl}/api/info.`,
          { status: response.status, code: "V2_SERVER_UNHEALTHY" },
        )
      }
      const parsed = serverInfoSchema.safeParse(await response.json().catch(() => null))
      if (!parsed.success) {
        throw new V2ProtocolError(
          `Managed server at ${options.baseUrl} answered /api/info without a version: not a compatible OpenCode 2.x server.`,
          { code: "V2_SERVER_UNRECOGNIZED" },
        )
      }
      assertSupportedServerVersion(parsed.data.version)
      return parsed.data.version
    } catch (error) {
      if (error instanceof V2ProtocolError) throw error
      lastDetail = error instanceof Error ? error.message : String(error ?? lastDetail)
      await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS))
    }
  }
  throw new V2ReadinessError(
    `Managed server at ${options.baseUrl} did not become API-ready within ${options.timeoutMs}ms (last: ${lastDetail}).`,
  )
}

export async function spawnManagedV2Server(
  options: SpawnManagedV2ServerOptions,
): Promise<ManagedV2Server> {
  const findBinary = options.findBinary ?? findWorkingOpencodeBinary
  const binaryPath = await findBinary()
  if (!binaryPath) {
    throw new V2ProtocolError(
      `Failed to start server on port ${options.port}: no working OpenCode binary found. Stage the pinned CLI first (for example \`bun run --cwd packages/electron prepare:opencode-cli\`).`,
      { code: "V2_BINARY_UNAVAILABLE" },
    )
  }

  const spawnImpl = options.spawnImpl ?? ((command: string[], spawnOptions: { stdout: "pipe"; stderr: "pipe" }) => spawnWithWindowsHide(command, spawnOptions))
  const proc = spawnImpl([binaryPath, "serve", "--hostname=127.0.0.1", `--port=${options.port}`], {
    stdout: "pipe",
    stderr: "pipe",
  })

  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    try {
      proc.kill()
    } catch {
      // Already exited; fall through to the exit wait.
    }
    await Promise.race([
      proc.exited.catch(() => 1),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ])
  }

  if (options.signal?.aborted) {
    await stop()
    throw new V2ReadinessError("Managed server start aborted before readiness.")
  }
  const abortListener = (): void => {
    void stop()
  }
  options.signal?.addEventListener("abort", abortListener, { once: true })

  try {
    const banner = await readBanner(proc.stdout, options.bannerTimeoutMs ?? BANNER_TIMEOUT_MS)
    if (!banner.url) {
      throw new V2ReadinessError("Managed server printed no listening URL.")
    }
    await waitForHealthyServer({
      baseUrl: banner.url,
      password: banner.password,
      timeoutMs: options.healthTimeoutMs ?? HEALTH_TIMEOUT_MS,
      fetchImpl: options.fetchImpl ?? fetch,
    })
    return { baseUrl: banner.url, password: banner.password, stop }
  } catch (error) {
    await stop()
    if (error instanceof V2UnsupportedServerError) {
      throw error
    }
    if (error instanceof V2ProtocolError) {
      throw new V2ProtocolError(`Failed to start server on port ${options.port}: ${error.message}`, {
        status: error.status,
        code: error.code,
        tag: error.tag,
        cause: error,
      })
    }
    throw error
  } finally {
    options.signal?.removeEventListener("abort", abortListener)
  }
}



const STATUS_BY_TAG = new Map<string, number>([
  ["InvalidRequestError", 400],
  ["InvalidCursorError", 400],
  ["FormInvalidAnswerError", 400],
  ["UnauthorizedError", 401],
  ["ForbiddenError", 403],
  ["SessionNotFoundError", 404],
  ["MessageNotFoundError", 404],
  ["PermissionNotFoundError", 404],
  ["FormNotFoundError", 404],
  ["AgentNotFoundError", 404],
  ["CommandNotFoundError", 404],
  ["SkillNotFoundError", 404],
  ["ProviderNotFoundError", 404],
  ["McpServerNotFoundError", 404],
  ["ProjectNotFoundError", 404],
  ["FileNotFoundError", 404],
  ["PtyNotFoundError", 404],
  ["ShellNotFoundError", 404],
  ["ConflictError", 409],
  ["SessionBusyError", 409],
  ["ServiceUnavailableError", 503],
  ["UnknownError", 500],
])

const taggedErrorSchema = z.object({
  _tag: z.string(),
  message: z.string().optional(),
  ref: z.string().optional(),
})

const clientErrorValidator = z.object({
  name: z.string(),
  reason: z.string().optional(),
  cause: z.unknown().optional(),
})

const unexpectedStatusValidator = z.object({ status: z.number() })

type FailureInput = Error | { readonly _tag: string; readonly message?: string; readonly ref?: string }

/**
 * Normalize a 2.x client failure. Transport failures rethrow untouched so
 * connection classifiers keep seeing the original code/cause. Declared API
 * failures become V2ProtocolError with the mapped status. Anything else
 * rethrows: the adapter never invents success or swallows a failure.
 */
export function normalizeV2Failure(operation: string, error: FailureInput): never {
  const tagged = taggedErrorSchema.safeParse(error)
  if (tagged.success) {
    const status = STATUS_BY_TAG.get(tagged.data._tag)
    throw new V2ProtocolError(`${operation} failed${status ? ` (${status})` : ""}: ${tagged.data.message ?? tagged.data._tag}`, {
      status,
      tag: tagged.data._tag,
      code: status === 404 ? "V2_ROUTE_MISSING" : "V2_REQUEST_FAILED",
      cause: error instanceof Error ? error : undefined,
    })
  }
  if (error instanceof Error) {
    const parsedClientError = clientErrorValidator.safeParse(error)
    if (parsedClientError.success && parsedClientError.data.name === "ClientError") {
      if (parsedClientError.data.reason === "Transport") {
        const cause = parsedClientError.data.cause
        throw cause instanceof Error ? cause : error
      }
      const parsedStatus = unexpectedStatusValidator.safeParse(parsedClientError.data.cause)
      const status = parsedStatus.success ? parsedStatus.data.status : undefined
      throw new V2ProtocolError(
        `${operation} failed${status ? ` (${status})` : ""}: ${parsedClientError.data.reason ?? "unexpected client failure"}`,
        { status, code: "V2_REQUEST_FAILED", cause: error },
      )
    }
  }
  throw error
}

export type V2Envelope<T> = { data?: T; error?: V2ProtocolError }

async function envelope<T>(operation: string, run: () => Promise<T>): Promise<V2Envelope<T>> {
  try {
    return { data: await run() }
  } catch (error) {
    if (error instanceof V2ProtocolError) return { error }
    try {
      // SAFETY: catch values are narrowed inside normalizeV2Failure by tagged-schema parse and instanceof checks before any field access.
      normalizeV2Failure(operation, error as FailureInput)
    } catch (normalized) {
      if (normalized instanceof V2ProtocolError) return { error: normalized }
      throw normalized
    }
    throw error
  }
}



export interface EngineMessagePart {
  type?: string
  text?: string
}

export interface EngineMessageModel {
  providerID?: string
  modelID?: string
  variant?: string
}

export interface EngineMessage {
  id?: string
  info?: {
    agent?: string
    model?: EngineMessageModel
    role?: string
    time?: { created?: number }
  }
  parts?: EngineMessagePart[]
}

export interface EngineAgent {
  name?: string
  color?: string
}

export interface V2PromptBody {
  agent?: string
  model?: { providerID?: string; modelID?: string }
  tools?: { question?: boolean }
  parts?: Array<{ type?: string; text?: string }>
}

export interface V2EngineSessionClient {
  create(input: {
    body?: {
      id?: string
      parentID?: string
      title?: string
      agent?: string
      model?: { providerID?: string; modelID?: string }
      metadata?: SessionCreateInput["metadata"]
      permission?: Array<{ permission?: string; action?: string; pattern?: string }>
    }
    query?: { directory?: string }
  }): Promise<V2Envelope<SessionInfo>>
  get(input: { path: { id: string }; query?: { directory?: string } }): Promise<V2Envelope<SessionInfo>>
  remove(input: { path: { id: string }; query?: { directory?: string } }): Promise<V2Envelope<null>>
  messages(input: { path: { id: string }; query?: { directory?: string } }): Promise<V2Envelope<EngineMessage[]>>
  status(input: { query?: { directory?: string } }): Promise<V2Envelope<Record<string, SessionStatus>>>
  todo(input: { path: { id: string }; query?: { directory?: string } }): Promise<V2Envelope<Todo[]>>
  children(input: { path: { id: string }; query?: { directory?: string } }): Promise<V2Envelope<ChildSession[]>>
  synthetic(input: {
    sessionID: string
    text: string
    description?: string
    resume?: boolean
    query?: { directory?: string }
  }): Promise<V2Envelope<SessionInboxSynthetic>>
  interrupt(input: { sessionID: string; query?: { directory?: string } }): Promise<V2Envelope<{ interrupted: boolean }>>
  promptAsync(input: {
    path: { id: string }
    body?: V2PromptBody
    query?: { directory?: string }
  }): Promise<V2Envelope<SessionInboxUser>>
}

export interface V2EngineAppClient {
  agents(directory?: string): Promise<V2Envelope<EngineAgent[]>>
}

export interface V2EngineEventClient {
  subscribe(input?: { signal?: AbortSignal }): AsyncIterable<EventPayload>
}

export interface V2EngineClient {
  readonly session: V2EngineSessionClient
  readonly app: V2EngineAppClient
  readonly event: V2EngineEventClient
}

export interface CreateV2EngineClientOptions {
  baseUrl: string
  password?: string
  fetchImpl?: typeof fetch
}

function authHeaders(password: string | undefined) {
  const header = password
    ? `Basic ${Buffer.from(`opencode:${password}`, "utf8").toString("base64")}`
    : getServerBasicAuthHeader()
  if (!header) return {}
  return { Authorization: header }
}


function mapPermission(
  permission: Array<{ permission?: string; action?: string; pattern?: string }> | undefined,
): Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }> | undefined {
  if (!permission) return undefined
  return permission.map((entry) => ({
    action: entry.permission ?? "question",
    resource: entry.pattern ?? "*",
    effect: entry.action === "deny" ? "deny" : entry.action === "allow" ? "allow" : "ask",
  }))
}

function mapAssistantPart(part: SessionMessageInfo): EngineMessagePart[] {
  if (part.type !== "assistant") return []
  if (!Array.isArray(part.content)) return []
  return part.content.map((item) => {
    if (item.type === "text" || item.type === "reasoning") {
      return { type: item.type, text: item.text }
    }
    return { type: item.type }
  })
}

function mapEngineMessage(record: SessionMessageInfo): EngineMessage {
  if (record.type === "assistant") {
    return {
      id: record.id,
      info: {
        agent: record.agent,
        model: record.model
          ? { providerID: record.model.providerID, modelID: record.model.id, variant: record.model.variant }
          : undefined,
        role: "assistant",
        time: { created: record.time.created },
      },
      parts: mapAssistantPart(record),
    }
  }
  if (record.type === "user") {
    return {
      id: record.id,
      info: { role: "user", time: { created: record.time.created } },
      parts: [],
    }
  }
  return { id: record.id, info: { role: record.type }, parts: [] }
}

const TODO_TOOL_PATTERN = /^todo/i

function readToolText(content: Array<{ type: string; text?: string }>): string | null {
  const texts: string[] = []
  for (const item of content) {
    if (item.type !== "text") continue
    texts.push(item.text)
  }
  return texts.length > 0 ? texts.join("\n") : null
}

const todoItemValidator = z.object({
  id: z.string().optional(),
  content: z.string().optional(),
  title: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
})

const flexibleTodoListValidator = z.array(todoItemValidator).or(z.object({ todos: z.array(todoItemValidator) }))

function parseTodoList(rawText: string, sessionID: string): Todo[] {
  let parsed: z.infer<typeof flexibleTodoListValidator> | null = null
  try {
    const validated = flexibleTodoListValidator.safeParse(JSON.parse(rawText))
    if (validated.success) parsed = validated.data
  } catch {
    parsed = null
  }
  if (!parsed) {
    throw new V2ProtocolError(
      `Session ${sessionID} has todo tool output the engine cannot parse; refusing to treat todos as complete.`,
      { code: "V2_TODO_UNPARSEABLE" },
    )
  }
  const list = Array.isArray(parsed) ? parsed : parsed.todos
  return list.map((entry) => ({
    id: entry.id,
    content: entry.content ?? entry.title ?? "",
    status: entry.status ?? "pending",
    priority: entry.priority ?? "",
  }))
}

export function createV2EngineClient(options: CreateV2EngineClientOptions): V2EngineClient {
  const baseUrl = options.baseUrl.replace(/\/$/, "")
  const headers = { ...authHeaders(options.password) }
  const fetchImpl = options.fetchImpl ?? fetch
  const raw: GeneratedV2Client = OpenCode.make({
    baseUrl,
    headers,
    fetch: (...args: Parameters<typeof fetch>) => fetchImpl(...args),
  })

  const withDir = (directory: string | undefined) => (
    directory ? { headers: { "x-opencode-directory": encodeURIComponent(directory) } } : {}
  )

  const session: V2EngineSessionClient = {
    create: (input) =>
      envelope("session.create", async () => {
        const model = input.body?.model
        const created = await raw.session.create(
          {
            id: input.body?.id,
            parentID: input.body?.parentID,
            title: input.body?.title,
            agent: input.body?.agent,
            model: model?.providerID && model?.modelID
              ? { providerID: model.providerID, id: model.modelID }
              : undefined,
            metadata: input.body?.metadata,
            permissions: mapPermission(input.body?.permission),
            location: input.query?.directory ? { directory: input.query.directory } : undefined,
          },
          withDir(input.query?.directory),
        )
        return created
      }),
    get: (input) =>
      envelope("session.get", () =>
        raw.session.get({ sessionID: input.path.id }, withDir(input.query?.directory)),
      ),
    remove: (input) =>
      envelope("session.remove", async () => {
        await raw.session.remove({ sessionID: input.path.id }, withDir(input.query?.directory))
        return null
      }),
    messages: (input) =>
      envelope("session.messages", async () => {
        const page = await raw.message.list({ sessionID: input.path.id }, withDir(input.query?.directory))
        const records = Array.isArray(page) ? page : page.data ?? []
        return records.map(mapEngineMessage)
      }),
    status: (input) =>
      envelope("session.status", async () => {
        const active = await raw.session.active(withDir(input.query?.directory))
        const statuses: Record<string, SessionStatus> = {}
        for (const id of Object.keys(active ?? {})) {
          if (input.query?.directory) {
            const info = await raw.session.get({ sessionID: id }, withDir(input.query.directory))
            if (!sameDirectory(info.location?.directory, input.query.directory)) continue
          }
          statuses[id] = { type: "busy" }
        }
        return statuses
      }),
    todo: (input) =>
      envelope("session.todo", async () => {
        const page = await raw.message.list(
          { sessionID: input.path.id, limit: 100 },
          withDir(input.query?.directory),
        )
        const records = Array.isArray(page) ? page : page.data ?? []
        let latest: Todo[] | null = null
        for (const record of records) {
          if (record.type !== "assistant" || !Array.isArray(record.content)) continue
          for (const part of record.content) {
            if (part.type !== "tool" || !TODO_TOOL_PATTERN.test(part.name)) continue
            if (part.state.status !== "completed" && part.state.status !== "error") continue
            const text = readToolText(part.state.content ?? [])
            if (text === null) continue
            latest = parseTodoList(text, input.path.id)
          }
        }
        return latest ?? []
      }),
    children: (input) =>
      envelope("session.children", async () => {
        const page = await raw.session.list(
          { parentID: input.path.id, directory: input.query?.directory },
          withDir(input.query?.directory),
        )
        const records = Array.isArray(page) ? page : page.data ?? []
        return records
          .filter((entry) => entry.id !== undefined)
          .map((entry) => ({ id: entry.id }))
      }),
    synthetic: (input) =>
      envelope("session.synthetic", () =>
        raw.session.synthetic(
          {
            sessionID: input.sessionID,
            text: input.text,
            description: input.description,
            resume: input.resume ?? false,
          },
          withDir(input.query?.directory),
        ),
      ),
    interrupt: (input) =>
      envelope("session.interrupt", () =>
        raw.session.interrupt({ sessionID: input.sessionID }, withDir(input.query?.directory)),
      ),
    promptAsync: (input) =>
      envelope("session.promptAsync", async () => {
        const parts = input.body?.parts ?? []
        const earlyText = parts
          .filter((part) => part.type === undefined || part.type === "text")
          .map((part) => part.text)
          .filter((partText) => partText !== undefined)
          .join("\n\n")
        if (!earlyText.trim()) {
          throw new V2ProtocolError("session.promptAsync needs at least one text part.", {
            code: "V2_PROMPT_EMPTY",
          })
        }
        if (input.body?.agent) {
          await raw.session.switchAgent(
            { sessionID: input.path.id, agent: input.body.agent },
            withDir(input.query?.directory),
          )
        }
        const promptModel = input.body?.model
        if (promptModel?.providerID && promptModel?.modelID) {
          await raw.session.switchModel(
            { sessionID: input.path.id, model: { providerID: promptModel.providerID, id: promptModel.modelID } },
            withDir(input.query?.directory),
          )
        }
        const text = earlyText
        const model = input.body?.model
        const sent = await raw.session.prompt(
          {
            sessionID: input.path.id,
            agent: input.body?.agent,
            model: model ? { providerID: model.providerID, id: model.modelID } : undefined,
            text,
          },
          withDir(input.query?.directory),
        )
        return sent
      }),
  }

  const app: V2EngineAppClient = {
    agents: (directory) =>
      envelope("app.agents", async () => {
        const output = await raw.agent.list(
          directory ? { location: { directory } } : undefined,
          withDir(directory),
        )
        const agents = Array.isArray(output) ? output : output.data ?? []
        return agents.map((agent) => ({
          name: agent.name,
          color: agent.color,
        }))
      }),
  }

  const event: V2EngineEventClient = {
    subscribe: (input) => subscribeTranslated(raw, input?.signal),
  }

  return { session, app, event }
}



const wireEventSchema = z.object({
  type: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
})

type WireEvent = z.infer<typeof wireEventSchema>

function wireString(data: WireEvent["data"], key: string): string | undefined {
  const parsed = z.string().safeParse(data[key])
  return parsed.success ? parsed.data : undefined
}

function sameDirectory(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "")
  return normalize(left) === normalize(right)
}

export function translateV2Event(event: WireEvent): EngineEventPayload[] {
  const data = event.data ?? {}
  const sessionID = wireString(data, "sessionID")
  if (!sessionID) return []
  const base = { sessionID }

  switch (event.type) {
    case "session.status": {
      const status = z.object({ type: z.string() }).safeParse(data.status)
      const statusType = status.success ? status.data.type : "idle"
      const mapped = statusType === "busy" || statusType === "retry" ? statusType : "idle"
      return [{ type: "session.status", properties: { ...base, status: { type: mapped } } }]
    }
    case "session.execution.started":
      return [{ type: "session.status", properties: { ...base, status: { type: "busy" } } }]
    case "session.execution.succeeded":
    case "session.execution.interrupted":
      return [{ type: "session.status", properties: { ...base, status: { type: "idle" } } }]
    case "session.execution.failed": {
      const failure = z.object({ message: z.string() }).safeParse(data.error)
      const message = failure.success ? failure.data.message : "session execution failed"
      return [
        { type: "session.error", properties: { ...base, error: message } },
        { type: "session.status", properties: { ...base, status: { type: "idle" } } },
      ]
    }
    case "session.step.started": {
      const messageID = wireString(data, "assistantMessageID")
      if (!messageID) return []
      return [{
        type: "message.updated",
        properties: { info: { ...base, id: messageID, role: "assistant" } },
      }]
    }
    case "session.text.started": {
      const messageID = wireString(data, "assistantMessageID")
      if (!messageID) return []
      return [{
        type: "message.part.updated",
        properties: {
          info: { ...base, id: messageID, role: "assistant" },
          part: { ...base, id: `${messageID}:text`, messageID, type: "text" },
        },
      }]
    }
    case "session.text.delta": {
      const messageID = wireString(data, "assistantMessageID")
      const delta = wireString(data, "delta")
      if (!messageID || !delta) return []
      return [{
        type: "message.part.delta",
        properties: { ...base, messageID, partID: `${messageID}:text`, field: "text", delta },
      }]
    }
    case "session.text.ended": {
      const messageID = wireString(data, "assistantMessageID")
      if (!messageID) return []
      return [{
        type: "message.part.updated",
        properties: {
          info: { ...base, id: messageID, role: "assistant" },
          part: { ...base, id: `${messageID}:text`, messageID, type: "text", time: { end: Date.now() } },
        },
      }]
    }
    case "session.reasoning.started": {
      const messageID = wireString(data, "assistantMessageID")
      if (!messageID) return []
      return [{
        type: "message.part.updated",
        properties: {
          info: { ...base, id: messageID, role: "assistant" },
          part: { ...base, id: `${messageID}:reasoning`, messageID, type: "reasoning" },
        },
      }]
    }
    case "session.reasoning.delta": {
      const messageID = wireString(data, "assistantMessageID")
      const delta = wireString(data, "delta")
      if (!messageID || !delta) return []
      return [{
        type: "message.part.delta",
        properties: { ...base, messageID, partID: `${messageID}:reasoning`, field: "text", delta },
      }]
    }
    case "session.tool.called": {
      const callID = wireString(data, "id")
      const properties = { ...base, name: "unknown", input: data.input }
      return [{ type: "tool.execute", properties: callID ? { ...properties, id: callID } : properties }]
    }
    case "session.tool.success":
    case "session.tool.failed": {
      const output = readToolTextFromData(data)
      return [{ type: "tool.result", properties: { ...base, output } }]
    }
    default:
      return []
  }
}

function readToolTextFromData(data: WireEvent["data"]): string {
  const content = Array.isArray(data.content) ? data.content : []
  const texts: string[] = []
  for (const item of content) {
    const textPart = z.object({ type: z.string(), text: z.string() }).safeParse(item)
    if (textPart.success && textPart.data.type === "text") texts.push(textPart.data.text)
  }
  if (texts.length > 0) return texts.join("\n")
  const failure = z.object({ message: z.string() }).safeParse(data.error)
  if (failure.success) return failure.data.message
  try {
    return JSON.stringify(data.content ?? data.error ?? null)
  } catch {
    return ""
  }
}

async function* subscribeTranslated(
  raw: GeneratedV2Client,
  signal: AbortSignal | undefined,
): AsyncIterable<EventPayload> {
  // The shared multiplexer drops every event but session.status when the
  // subscribe call itself carries an abort signal, so subscribe bare and
  // drive teardown from our own abort listener instead. Verified live:
  // signal in subscribe -> only status events arrive; bare subscribe ->
  // the full execution/text/tool stream arrives.
  const stream = await raw.event.subscribe()
  const iterator = stream[Symbol.asyncIterator]()
  if (signal?.aborted) {
    await iterator.return?.()
    return
  }
  const abortListener = (): void => {
    void iterator.return?.()
  }
  signal?.addEventListener("abort", abortListener, { once: true })
  try {
    while (true) {
      const next = await iterator.next()
      if (next.done) break
      if (signal?.aborted) break
      const parsed = wireEventSchema.safeParse(next.value)
      if (!parsed.success) continue
      for (const payload of translateV2Event(parsed.data)) {
        yield payload
      }
    }
  } finally {
    signal?.removeEventListener("abort", abortListener)
  }
}
