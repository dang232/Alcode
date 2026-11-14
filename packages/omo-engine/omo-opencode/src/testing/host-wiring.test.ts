import { describe, expect, it } from "bun:test"

import type { OmoPluginContext } from "../plugin-types.ts"
import { createDelegationTools } from "../tools/delegation/delegation-tools.ts"
import { createPluginModule } from "./create-plugin-module.ts"

interface RecordedCall {
  readonly name: string
  readonly input: Record<string, string>
}

const buildInput = (calls: RecordedCall[]) => ({
  directory: "/workspace",
  worktree: "/workspace",
  client: {
    session: {
      create: async (input: { body: Record<string, string>; query: Record<string, string> }) => {
        calls.push({ name: "create", input: { ...input.body, directory: input.query["directory"] ?? "" } })
        return { data: { id: "ses_child_v1_0001", parentID: input.body["parentID"] } }
      },
      promptAsync: async () => ({ data: {} }),
      prompt: async () => ({ data: {} }),
    },
  },
})

const stubs = () => {
  const captured: { context?: OmoPluginContext } = {}
  const deps = {
    validatePluginConfig: () => ({ valid: true, messages: [] }),
    detectDuplicateOmoPlugin: () => ({ detected: false, duplicatePlugins: [] }),
    loadPluginConfig: () => ({ disabled_hooks: [], disabled_tools: [] }),
    createManagers: () => ({
      backgroundManager: { shutdown: async () => {}, noteSubagentBirth: async () => {}, noteSubagentDeath: async () => {} },
      skillMcpManager: { disconnectAll: async () => {}, callSkillTool: async () => ({ output: "", isError: false }) },
      modelFallbackControllerAccessor: undefined,
      monitorManager: undefined,
      configHandler: async () => {},
    }),
    createTools: async (context: OmoPluginContext) => {
      captured.context = context
      const delegation = createDelegationTools({ directory: context.directory, capabilities: context.hostCapabilities })
      return { filteredTools: { task: delegation.task, call_omo_agent: delegation.callOmoAgent }, mergedSkills: [], availableSkills: [] }
    },
    createHooks: () => ({}),
    createPluginInterface: (_context: OmoPluginContext, _config: unknown, _managers: unknown, _hooks: unknown, createdTools: { filteredTools: Record<string, never> }) => ({ tool: createdTools.filteredTools }),
    createPluginDispose: () => async () => {},
    resolveBundledAgentsDir: () => "/agents",
    log: () => {},
  }
  return { deps, captured }
}

const hostToolContext = {
  sessionID: "ses_caller_v1",
  messageID: "msg_1",
  agent: "build",
  directory: "/workspace",
  worktree: "/workspace",
  abort: { aborted: false },
}

describe("V1 host wiring", () => {
  it("builds a child-session capability from the real client and passes it to the tool factory", async () => {
    const { deps, captured } = stubs()
    const calls: RecordedCall[] = []
    const module = createPluginModule(deps)
    // SAFETY: `server` only reads directory/worktree/client; the remaining PluginInput fields are unused on this path.
    await module.server(buildInput(calls) as never)

    const capabilities = captured.context?.hostCapabilities
    expect(capabilities).toBeDefined()
    const handle = await capabilities!.childSessions!.createAndStart({ title: "delegate", prompt: "do it" }, {
      sessionID: "ses_caller_v1",
      messageID: "msg_1",
      agent: "build",
      directory: "/workspace",
      worktree: "/workspace",
    })
    expect(handle.childSessionID).toBe("ses_child_v1_0001")
    expect(calls[0]).toEqual({ name: "create", input: { parentID: "ses_caller_v1", title: "delegate", directory: "/workspace" } })
  })

  it("authorizes the adapted V1 tool and never claims an unprovable child", async () => {
    const { deps } = stubs()
    const calls: RecordedCall[] = []
    const module = createPluginModule(deps)
    // SAFETY: `server` only reads directory/worktree/client; the remaining PluginInput fields are unused on this path.
    const hooks = await module.server(buildInput(calls) as never)
    const callAgent = hooks.tool?.["call_omo_agent"]
    expect(callAgent).toBeDefined()
    // The stub client cannot satisfy the routed dispatcher, so the first prompt's
    // fate is unprovable: the tool must create the real child, attribute it to the
    // caller, and report unknown rather than claiming a start.
    await expect(callAgent!.execute({ description: "delegate", prompt: "do it" }, hostToolContext)).rejects.toThrow(/CHILD_STATUS_UNKNOWN: session ses_child_v1_0001 exists/)
    expect(calls[0]?.input["parentID"]).toBe("ses_caller_v1")
    expect(calls[0]?.input["title"]).toBe("delegate")
  })

  it("denies the registered tool when the host supplies no session", async () => {
    const { deps } = stubs()
    const calls: RecordedCall[] = []
    const module = createPluginModule(deps)
    // SAFETY: `server` only reads directory/worktree/client; the remaining PluginInput fields are unused on this path.
    const hooks = await module.server(buildInput(calls) as never)
    const callAgent = hooks.tool?.["call_omo_agent"]
    // SAFETY: the adapter forwards an empty sessionID straight through to the tool's context.
    const anonymous = { ...hostToolContext, sessionID: "" } as never
    await expect(callAgent!.execute({ description: "d", prompt: "p" }, anonymous)).rejects.toThrow(/UNAUTHENTICATED/)
    expect(calls).toHaveLength(0)
  })

  it("omits the capability when the host supplies no client", async () => {
    const { deps, captured } = stubs()
    const module = createPluginModule(deps)
    const withoutClient = { directory: "/workspace", worktree: "/workspace" }
    // SAFETY: the module treats a missing client as "no host capability", which is the branch under test.
    await module.server(withoutClient as never)
    expect(captured.context?.hostCapabilities).toBeUndefined()
  })
})
