import { describe, expect, it } from "bun:test"

import type { OmoJsonObject, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
import { CALL_OMO_AGENT_TOOL_NAME, TASK_TOOL_NAME, createDelegationTools, type DelegationTools } from "./delegation-tools.ts"
import {
  HOST_CAPABILITY_VERSION,
  type OmoChildSessionRequest,
  type OmoHostCapabilities,
  type OmoTaskRequest,
} from "./host-capabilities.ts"

const context = (over: Partial<OmoToolContext> = {}): OmoToolContext => ({
  sessionID: "ses_host_0001",
  messageID: "msg_0001",
  agent: "build",
  directory: "/workspace",
  worktree: "/workspace",
  aborted: () => false,
  authenticated: true,
  ...over,
})

interface HostRecorder {
  readonly capabilities: OmoHostCapabilities
  readonly childRequests: OmoChildSessionRequest[]
  readonly taskRequests: OmoTaskRequest[]
  readonly parents: string[]
}

const recordingHost = (over: Partial<OmoHostCapabilities> = {}): HostRecorder => {
  const childRequests: OmoChildSessionRequest[] = []
  const taskRequests: OmoTaskRequest[] = []
  const parents: string[] = []
  const capabilities: OmoHostCapabilities = {
    version: HOST_CAPABILITY_VERSION,
    childSessions: {
      version: HOST_CAPABILITY_VERSION,
      createAndStart: async (request, caller) => {
        childRequests.push(request)
        parents.push(caller.sessionID)
        return { childSessionID: "ses_child_0001", parentSessionID: caller.sessionID, started: true, capabilityVersion: HOST_CAPABILITY_VERSION }
      },
    },
    tasks: {
      version: HOST_CAPABILITY_VERSION,
      start: async (request, caller) => {
        taskRequests.push(request)
        parents.push(caller.sessionID)
        return { taskID: "task_0001", parentSessionID: caller.sessionID, state: "accepted", capabilityVersion: HOST_CAPABILITY_VERSION }
      },
    },
    ...over,
  }
  return { capabilities, childRequests, taskRequests, parents }
}

const tools = (capabilities?: OmoHostCapabilities): DelegationTools => createDelegationTools({ directory: "/workspace", capabilities })

const execute = async (tool: OmoToolDefinition, args: OmoJsonObject, ctx?: OmoToolContext): Promise<string> => String(await tool.execute(args, ctx))

describe("tool identities", () => {
  it("exposes both catalog names", () => {
    expect(TASK_TOOL_NAME).toBe("task")
    expect(CALL_OMO_AGENT_TOOL_NAME).toBe("call_omo_agent")
    const built = tools()
    expect(built.task).toBeDefined()
    expect(built.callOmoAgent).toBeDefined()
  })
})

describe("task tool", () => {
  it("reports an unavailable capability instead of inventing a task", async () => {
    await expect(execute(tools().task, { description: "d", prompt: "p" }, context())).rejects.toThrow(
      /CAPABILITY_UNAVAILABLE: this host exposes no task capability/,
    )
  })

  it("runs through the host task capability with the host-derived parent", async () => {
    const host = recordingHost()
    const out = JSON.parse(await execute(tools(host.capabilities).task, { description: "d", prompt: "p", background: true }, context()))
    expect(out).toEqual({ taskID: "task_0001", parentSessionID: "ses_host_0001", state: "accepted", capabilityVersion: 1 })
    expect(host.taskRequests).toEqual([{ description: "d", prompt: "p", background: true }])
    expect(host.parents).toEqual(["ses_host_0001"])
  })

  it("refuses without host authentication and never reaches the host", async () => {
    const host = recordingHost()
    await expect(execute(tools(host.capabilities).task, { description: "d", prompt: "p" })).rejects.toThrow(/UNAUTHENTICATED/)
    expect(host.taskRequests).toHaveLength(0)
  })

  it("refuses identity smuggled through arguments", async () => {
    const host = recordingHost()
    await expect(execute(tools(host.capabilities).task, { description: "d", prompt: "p", parentSessionID: "ses_other" }, context())).rejects.toThrow(
      /INVALID_ARGUMENT: parentSessionID is host-derived/,
    )
    expect(host.taskRequests).toHaveLength(0)
  })

  it("rejects an invalid prompt", async () => {
    const host = recordingHost()
    await expect(execute(tools(host.capabilities).task, { description: "d", prompt: "  " }, context())).rejects.toThrow(/INVALID_ARGUMENT/)
    expect(host.taskRequests).toHaveLength(0)
  })

  it("refuses when the caller was already aborted", async () => {
    const host = recordingHost()
    await expect(execute(tools(host.capabilities).task, { description: "d", prompt: "p" }, context({ aborted: () => true }))).rejects.toThrow(/CANCELLED/)
    expect(host.taskRequests).toHaveLength(0)
  })

  it("refuses agent selection when the host publishes no authorized set", async () => {
    const host = recordingHost()
    await expect(execute(tools(host.capabilities).task, { description: "d", prompt: "p", agent: "oracle" }, context())).rejects.toThrow(/FORBIDDEN/)
    expect(host.taskRequests).toHaveLength(0)
  })

  it("refuses an agent outside the authorized set", async () => {
    const host = recordingHost({ allowedAgents: ["explore"] })
    await expect(execute(tools(host.capabilities).task, { description: "d", prompt: "p", agent: "oracle" }, context())).rejects.toThrow(/FORBIDDEN/)
    expect(host.taskRequests).toHaveLength(0)
  })

  it("accepts an agent the host authorizes", async () => {
    const host = recordingHost({ allowedAgents: ["explore"] })
    const out = JSON.parse(await execute(tools(host.capabilities).task, { description: "d", prompt: "p", agent: "explore" }, context()))
    expect(out.taskID).toBe("task_0001")
  })

  it("refuses a host that attributes the task to another session", async () => {
    const foreign: OmoHostCapabilities = {
      version: HOST_CAPABILITY_VERSION,
      tasks: {
        version: HOST_CAPABILITY_VERSION,
        start: async () => ({ taskID: "task_x", parentSessionID: "ses_other", state: "accepted", capabilityVersion: 1 }),
      },
    }
    await expect(execute(tools(foreign).task, { description: "d", prompt: "p" }, context())).rejects.toThrow(/PARENT_ATTRIBUTION_MISMATCH/)
  })
})

describe("call_omo_agent tool", () => {
  it("reports an unavailable child-session capability instead of a fabricated child", async () => {
    await expect(execute(tools().callOmoAgent, { description: "d", prompt: "p" }, context())).rejects.toThrow(
      /CAPABILITY_UNAVAILABLE: this host exposes no child-session capability/,
    )
  })

  it("returns the real child identity with the host-derived parent", async () => {
    const host = recordingHost()
    const out = JSON.parse(await execute(tools(host.capabilities).callOmoAgent, { description: "delegate", prompt: "do it" }, context()))
    expect(out).toEqual({ childSessionID: "ses_child_0001", parentSessionID: "ses_host_0001", started: true, capabilityVersion: 1 })
    expect(host.childRequests).toEqual([{ title: "delegate", prompt: "do it" }])
    expect(host.parents).toEqual(["ses_host_0001"])
  })

  it("refuses a smuggled parent identity before any session exists", async () => {
    const host = recordingHost()
    await expect(execute(tools(host.capabilities).callOmoAgent, { description: "d", prompt: "p", sessionID: "ses_forged" }, context())).rejects.toThrow(
      /INVALID_ARGUMENT: sessionID is host-derived/,
    )
    expect(host.childRequests).toHaveLength(0)
  })

  it("refuses when the caller was already aborted", async () => {
    const host = recordingHost()
    await expect(execute(tools(host.capabilities).callOmoAgent, { description: "d", prompt: "p" }, context({ aborted: () => true }))).rejects.toThrow(
      /CANCELLED/,
    )
    expect(host.childRequests).toHaveLength(0)
  })

  it("refuses a legacy unknown session without creating a child", async () => {
    const host = recordingHost()
    await expect(execute(tools(host.capabilities).callOmoAgent, { description: "d", prompt: "p" }, context({ sessionID: "unknown" }))).rejects.toThrow(
      /UNAUTHENTICATED/,
    )
    expect(host.childRequests).toHaveLength(0)
  })

  it("refuses an agent outside the authorized set", async () => {
    const host = recordingHost({ allowedAgents: ["explore"] })
    await expect(execute(tools(host.capabilities).callOmoAgent, { description: "d", prompt: "p", agent: "oracle" }, context())).rejects.toThrow(
      /FORBIDDEN/,
    )
    expect(host.childRequests).toHaveLength(0)
  })

  it("refuses a host that attributes the child to another session", async () => {
    const foreign: OmoHostCapabilities = {
      version: HOST_CAPABILITY_VERSION,
      childSessions: {
        version: HOST_CAPABILITY_VERSION,
        createAndStart: async () => ({
          childSessionID: "ses_child_x",
          parentSessionID: "ses_other",
          started: true,
          capabilityVersion: 1,
        }),
      },
    }
    await expect(execute(tools(foreign).callOmoAgent, { description: "d", prompt: "p" }, context())).rejects.toThrow(/PARENT_ATTRIBUTION_MISMATCH/)
  })

  it("refuses a host that returns the calling session as the child", async () => {
    const selfChild: OmoHostCapabilities = {
      version: HOST_CAPABILITY_VERSION,
      childSessions: {
        version: HOST_CAPABILITY_VERSION,
        createAndStart: async (_request, caller) => ({
          childSessionID: caller.sessionID,
          parentSessionID: caller.sessionID,
          started: true,
          capabilityVersion: 1,
        }),
      },
    }
    await expect(execute(tools(selfChild).callOmoAgent, { description: "d", prompt: "p" }, context())).rejects.toThrow(/PARENT_ATTRIBUTION_MISMATCH/)
  })

  it("does not claim a started child when the host fails to start it", async () => {
    const failing: OmoHostCapabilities = {
      version: HOST_CAPABILITY_VERSION,
      childSessions: {
        version: HOST_CAPABILITY_VERSION,
        createAndStart: async () => {
          throw new Error("PROMPT_SUBMIT_FAILED: session ses_child_0009 exists")
        },
      },
    }
    await expect(execute(tools(failing).callOmoAgent, { description: "d", prompt: "p" }, context())).rejects.toThrow(/PROMPT_SUBMIT_FAILED/)
  })
})
