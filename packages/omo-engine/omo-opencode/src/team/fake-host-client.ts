import type { TeamHostClient } from "./spawn-members.ts"

export type FakePromptBody = {
  readonly agent?: string
  readonly model?: { readonly providerID: string; readonly modelID: string }
  readonly parts?: readonly { readonly type: string; readonly text?: string }[]
}

export type FakeSessionRecord = {
  readonly id: string
  readonly parentID?: string
  readonly title?: string
  readonly directory?: string
  readonly prompts: FakePromptBody[]
}

export type FakeCall = {
  readonly method: "create" | "promptAsync" | "synthetic" | "interrupt"
  readonly args: unknown
}

export type FakeHostClientOptions = {
  readonly createErrorMessage?: string
  readonly promptErrorMessage?: string
  readonly interrupted?: boolean
}

/**
 * Hand-written fake of the OpenCode host session surface (no module
 * mocking): `create` mints genuine unique child ids, `promptAsync`
 * records the opening prompt per session, and `synthetic`/`interrupt`
 * record the note-first cancel order. The client is structurally cast once
 * at this boundary so test call sites stay clean.
 */
let globalSessionCounter = 0

export function createFakeHostClient(options: FakeHostClientOptions = {}): {
  readonly client: TeamHostClient
  readonly sessions: Map<string, FakeSessionRecord>
  readonly calls: FakeCall[]
} {
  const sessions = new Map<string, FakeSessionRecord>()
  const calls: FakeCall[] = []

  const session = {
    create: async (args: { body?: { parentID?: string; title?: string }; query?: { directory?: string } }) => {
      calls.push({ method: "create", args })
      if (options.createErrorMessage !== undefined) {
        return { data: undefined, error: new Error(options.createErrorMessage) }
      }
      globalSessionCounter += 1
      const id = `ses_fake_${globalSessionCounter}`
      sessions.set(id, {
        id,
        ...(args.body?.parentID !== undefined ? { parentID: args.body.parentID } : {}),
        ...(args.body?.title !== undefined ? { title: args.body.title } : {}),
        ...(args.query?.directory !== undefined ? { directory: args.query.directory } : {}),
        prompts: [],
      })
      return {
        data: {
          id,
          projectID: "proj_fake",
          directory: args.query?.directory ?? "",
          title: args.body?.title ?? "",
          version: "1",
          time: { created: Date.now(), updated: Date.now() },
        },
        error: undefined,
      }
    },
    promptAsync: async (args: { path?: { id?: string }; body?: FakePromptBody }) => {
      calls.push({ method: "promptAsync", args })
      if (options.promptErrorMessage !== undefined) {
        throw new Error(options.promptErrorMessage)
      }
      const id = args.path?.id
      const record = id !== undefined ? sessions.get(id) : undefined
      if (record !== undefined && args.body !== undefined) {
        record.prompts.push(args.body)
      }
      return undefined
    },
    synthetic: async (args: unknown) => {
      calls.push({ method: "synthetic", args })
      return {}
    },
    interrupt: async (args: unknown) => {
      calls.push({ method: "interrupt", args })
      return { interrupted: options.interrupted ?? true }
    },
  }

  return { client: { session } as unknown as TeamHostClient, sessions, calls }
}

export function callArgs(call: FakeCall | undefined): Record<string, unknown> {
  return (call?.args ?? {}) as Record<string, unknown>
}
