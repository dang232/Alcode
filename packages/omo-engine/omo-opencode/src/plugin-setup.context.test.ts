import { afterAll, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createPluginSetup } from "./plugin-setup.ts"
import type { OmoToolContext, OmoToolDefinition } from "./plugin-types.ts"
import type { OmoDelegationOperations, OmoTaskManagerSeam } from "./tools/delegation/host-provider.ts"

const roots: string[] = []

type RegisteredTool = {
  readonly name: string
  readonly execute: (args: unknown, context: Record<string, unknown>) => Promise<unknown>
}

let pendingDelegation: OmoDelegationOperations | undefined
let pendingTasks: OmoTaskManagerSeam | undefined
let pendingOptions: unknown

async function dispatchThroughSetup(seed?: { sessionID?: string; withChildSessions?: boolean }) {
  const directory = mkdtempSync(join(tmpdir(), "omo-setup-context-"))
  roots.push(directory)
  const registered: RegisteredTool[] = []
  const noop = async () => ({ dispose: () => {} })
  const ctx = {
    location: { directory },
    options: pendingOptions,
    agent: { transform: noop },
    tool: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({
          add: (entry: RegisteredTool) => {
            registered.push(entry)
          },
        })
        return { dispose: () => {} }
      },
      hook: noop,
    },
    session: { hook: noop },
    command: { transform: noop },
    skill: { transform: noop },
    mcp: { transform: noop },
    event: { subscribe: async function* () {} },
    delegation: pendingDelegation,
    tasks: pendingTasks,
    ...(seed?.withChildSessions === true
      ? {
          hostCapabilities: {
            version: 1,
            childSessions: {
              version: 1,
              createAndStart: async (request: { readonly title: string }, caller: { readonly sessionID: string }) => ({
                childSessionID: "ses_child_stub_0001",
                parentSessionID: caller.sessionID,
                started: true,
                capabilityVersion: 1,
              }),
            },
          },
        }
      : {}),
  }
  const setup = createPluginSetup()
  await setup(ctx as never)
  const read = registered.find((entry) => entry.name === "read")
  const bash = registered.find((entry) => entry.name === "bash")
  const task = registered.find((entry) => entry.name === "task")
  const callAgent = registered.find((entry) => entry.name === "call_omo_agent")
  if (read === undefined || bash === undefined) throw new Error("native tools were not registered through the setup layer")
  const hostContext: Record<string, unknown> = { agent: "build", directory }
  if (seed?.sessionID !== undefined) hostContext.sessionID = seed.sessionID
  return { read, bash, delegation: { task, callAgent }, hostContext, directory }
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe("host context at the real dispatch boundary", () => {
  it("registers the native tools through the setup layer", async () => {
    const { read } = await dispatchThroughSetup({ sessionID: "ses_dispatch_0001" })
    expect(typeof read.execute).toBe("function")
  })

  it("dispatches with the host session and the real workspace", async () => {
    const { read, hostContext, directory } = await dispatchThroughSetup({ sessionID: "ses_dispatch_0001" })
    const tool = read as unknown as { execute: (args: never, context: never) => Promise<string> }
    writeFileSync(join(directory, "present.txt"), "dispatched\n", "utf8")
    const result = (await tool.execute({ path: "present.txt" } as never, { ...hostContext, sessionID: "ses_dispatch_0001" } as never)) as unknown
    const text = typeof result === "string" ? result : String((result as { content?: unknown }).content ?? "")
    expect(text).toContain("dispatched")
  })

  it("uses the host session even when tool arguments claim another identity", async () => {
    const { bash } = await dispatchThroughSetup()
    const tool = bash as unknown as { execute: (args: never, context: never) => Promise<unknown> }
    const seen: string[] = []
    await tool.execute(
      { command: "echo hi", sessionID: "ses_forged", parentSessionId: "ses_parent_forged" } as never,
      {
        agent: "build",
        sessionID: "ses_host_0001",
        authenticated: true,
        ask: async (input: { metadata?: { sessionID?: string } }) => {
          seen.push(input.metadata?.sessionID ?? "")
        },
      } as never,
    )
    expect(seen).toEqual(["ses_host_0001"])
  })

  it("executes call_omo_agent through the V2 delegation operations when the host supplies them", async () => {
    const created: Array<{ readonly parentID: string; readonly directory: string }> = []
    pendingDelegation = {
      createSession: async (input) => {
        created.push({ parentID: input.parentID, directory: input.directory })
        return { sessionID: "ses_child_v2_0001", parentID: input.parentID }
      },
      startSession: async () => ({ outcome: "accepted" }),
    }
    try {
      const { delegation } = await dispatchThroughSetup({ sessionID: "ses_dispatch_v2" })
      const context = { agent: "build", sessionID: "ses_dispatch_v2", directory: "/host/project", authenticated: true, aborted: () => false }
      const raw = await delegation.callAgent!.execute({ description: "delegate", prompt: "do it" } as never, context as never)
      const text = typeof raw === "string" ? raw : String((raw as { content?: unknown }).content ?? "")
      expect(JSON.parse(text).childSessionID).toBe("ses_child_v2_0001")
      expect(created).toEqual([{ parentID: "ses_dispatch_v2", directory: "/host/project" }])
    } finally {
      pendingDelegation = undefined
    }
  })

  it("surfaces a refused start through the V2 path", async () => {
    pendingDelegation = {
      createSession: async (input) => ({ sessionID: "ses_child_v2_refused", parentID: input.parentID }),
      startSession: async () => ({ outcome: "refused", error: "gate rejected the prompt" }),
    }
    try {
      const { delegation } = await dispatchThroughSetup({ sessionID: "ses_dispatch_v2" })
      const context = { agent: "build", sessionID: "ses_dispatch_v2", directory: "/host/project", authenticated: true, aborted: () => false }
      await expect(delegation.callAgent!.execute({ description: "d", prompt: "p" } as never, context as never)).rejects.toThrow(/PROMPT_SUBMIT_FAILED/)
    } finally {
      pendingDelegation = undefined
    }
  })

  it("surfaces an unknown start through the V2 path", async () => {
    pendingDelegation = {
      createSession: async (input) => ({ sessionID: "ses_child_v2_unknown", parentID: input.parentID }),
      startSession: async () => ({ outcome: "unknown", error: "fetch failed" }),
    }
    try {
      const { delegation } = await dispatchThroughSetup({ sessionID: "ses_dispatch_v2" })
      const context = { agent: "build", sessionID: "ses_dispatch_v2", directory: "/host/project", authenticated: true, aborted: () => false }
      await expect(delegation.callAgent!.execute({ description: "d", prompt: "p" } as never, context as never)).rejects.toThrow(/CHILD_STATUS_UNKNOWN/)
    } finally {
      pendingDelegation = undefined
    }
  })

  it("executes through the engine-carried descriptor when the host injects one", async () => {
    const calls: string[] = []
    const host = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        const body = (await request.json()) as Record<string, string>
        calls.push(url.pathname)
        if (url.pathname === "/capability/session") return Response.json({ sessionID: "ses_injected_0001", parentID: body["parentID"] })
        if (url.pathname === "/capability/session/start") return Response.json({ outcome: "accepted" })
        if (url.pathname === "/capability/task") return Response.json({ taskID: "task_injected_0001", state: "accepted" })
        return new Response("not found", { status: 404 })
      },
    })
    pendingOptions = { hostCapabilities: { version: 1, url: `http://127.0.0.1:${host.port}`, token: "injected-token" } }
    try {
      const { delegation } = await dispatchThroughSetup({ sessionID: "ses_dispatch_v2" })
      const context = { agent: "build", sessionID: "ses_dispatch_v2", directory: "/host/project", authenticated: true, aborted: () => false }
      const raw = await delegation.callAgent!.execute({ description: "delegate", prompt: "do it" } as never, context as never)
      const text = typeof raw === "string" ? raw : String((raw as { content?: unknown }).content ?? "")
      expect(JSON.parse(text).childSessionID).toBe("ses_injected_0001")
      expect(calls).toEqual(["/capability/session", "/capability/session/start"])
      const taskRaw = await delegation.task!.execute({ description: "audit", prompt: "p" } as never, context as never)
      const taskText = typeof taskRaw === "string" ? taskRaw : String((taskRaw as { content?: unknown }).content ?? "")
      expect(JSON.parse(taskText).taskID).toBe("task_injected_0001")
    } finally {
      pendingOptions = undefined
      host.stop(true)
    }
  })

  it("ignores a malformed descriptor and keeps the tools refusing", async () => {
    pendingOptions = { hostCapabilities: { version: 1, url: "not-a-url", token: "t" } }
    try {
      const { delegation } = await dispatchThroughSetup({ sessionID: "ses_dispatch_v2" })
      const context = { agent: "build", sessionID: "ses_dispatch_v2", authenticated: true, aborted: () => false }
      await expect(delegation.callAgent!.execute({ description: "d", prompt: "p" } as never, context as never)).rejects.toThrow(/CAPABILITY_UNAVAILABLE/)
    } finally {
      pendingOptions = undefined
    }
  })

  it("executes task through the host task seam when the host supplies the canonical manager", async () => {
    const started: string[] = []
    pendingTasks = {
      start: async (request) => {
        started.push(request.parentSessionID)
        return { taskID: "task_v2_0001", state: "accepted" }
      },
    }
    try {
      const { delegation } = await dispatchThroughSetup({ sessionID: "ses_dispatch_v2" })
      const context = { agent: "build", sessionID: "ses_dispatch_v2", directory: "/host/project", authenticated: true, aborted: () => false }
      const raw = await delegation.task!.execute({ description: "audit", prompt: "p" } as never, context as never)
      const text = typeof raw === "string" ? raw : String((raw as { content?: unknown }).content ?? "")
      expect(JSON.parse(text).taskID).toBe("task_v2_0001")
      expect(started).toEqual(["ses_dispatch_v2"])
    } finally {
      pendingTasks = undefined
    }
  })

  it("registers the delegation tools and refuses without a host capability", async () => {
    const { delegation } = await dispatchThroughSetup({ sessionID: "ses_dispatch_0001" })
    const context = { agent: "build", sessionID: "ses_dispatch_0001", authenticated: true, aborted: () => false }
    await expect(delegation.task!.execute({ description: "d", prompt: "p" } as never, context as never)).rejects.toThrow(/CAPABILITY_UNAVAILABLE/)
    await expect(delegation.callAgent!.execute({ description: "d", prompt: "p" } as never, context as never)).rejects.toThrow(/CAPABILITY_UNAVAILABLE/)
  })

  it("dispatches call_omo_agent through a host capability when one is supplied", async () => {
    const { delegation } = await dispatchThroughSetup({ sessionID: "ses_dispatch_0001", withChildSessions: true })
    const context = { agent: "build", sessionID: "ses_dispatch_0001", authenticated: true, aborted: () => false }
    const raw = await delegation.callAgent!.execute({ description: "delegate", prompt: "do it" } as never, context as never)
    const text = typeof raw === "string" ? raw : String((raw as { content?: unknown }).content ?? "")
    const out = JSON.parse(text)
    expect(out.childSessionID).toBe("ses_child_stub_0001")
    expect(out.parentSessionID).toBe("ses_dispatch_0001")
    expect(out.started).toBe(true)
  })

  it("fails closed for the command tool when the host supplies no session", async () => {
    const { bash } = await dispatchThroughSetup()
    const tool = bash as unknown as { execute: (args: never, context: never) => Promise<string> }
    await expect(tool.execute({ command: "echo should-not-run" } as never, { agent: "build" } as never)).rejects.toThrow(/authenticated|UNAUTHENTICATED/i)
  })
})
