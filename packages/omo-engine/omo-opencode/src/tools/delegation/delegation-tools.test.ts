import { describe, expect, it } from "bun:test"

import type { OmoJsonObject, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
import { CALL_OMO_AGENT_TOOL_NAME, TASK_OUTPUT_TOOL_NAME, TASK_TOOL_NAME, createDelegationTools, type DelegationTools } from "./delegation-tools.ts"
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
  readonly outputRequests: string[]
  readonly parents: string[]
}

const recordingHost = (over: Partial<OmoHostCapabilities> = {}): HostRecorder => {
  const childRequests: OmoChildSessionRequest[] = []
  const taskRequests: OmoTaskRequest[] = []
  const outputRequests: string[] = []
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
      readOutput: async (request) => {
        outputRequests.push(request.childSessionID)
        if (request.childSessionID === "ses_missing_0001") {
          return { kind: "missing", sessionID: request.childSessionID, reason: "No such session." }
        }
        return {
          kind: "status",
          sessionID: request.childSessionID,
          messages: [{ role: "assistant", text: "CHILD-OK" }],
          tools: [{ name: "shell", status: "completed", input: '{"command":"dir"}', output: "DRIVE_MISSING" }],
          finalResponse: "CHILD-OK",
        }
      },
    },
    tasks: {
      version: HOST_CAPABILITY_VERSION,
      start: async (request, caller) => {
        taskRequests.push(request)
        parents.push(caller.sessionID)
        return { taskID: "task_0001", parentSessionID: caller.sessionID, state: "accepted", capabilityVersion: HOST_CAPABILITY_VERSION }
      },
      readOutput: async (request) => ({
        taskID: request.taskID,
        output: { status: "completed", final_response: "DELEGATION-OK" },
      }),
      readOutput: async (request, caller) => {
        outputRequests.push(request.taskID)
        parents.push(caller.sessionID)
        return { taskID: request.taskID, output: { status: "completed", final_response: "READY" } }
      },
    },
    ...over,
  }
  return { capabilities, childRequests, taskRequests, outputRequests, parents }
}

const tools = (capabilities?: OmoHostCapabilities): DelegationTools => createDelegationTools({ directory: "/workspace", capabilities })

const execute = async (tool: OmoToolDefinition, args: OmoJsonObject, ctx?: OmoToolContext): Promise<string> => String(await tool.execute(args, ctx))

describe("tool identities", () => {
  it("exposes the catalog names", () => {
    expect(TASK_TOOL_NAME).toBe("task")
    expect(CALL_OMO_AGENT_TOOL_NAME).toBe("call_omo_agent")
    expect(TASK_OUTPUT_TOOL_NAME).toBe("task_output")
    const built = tools()
    expect(built.task).toBeDefined()
    expect(built.callOmoAgent).toBeDefined()
    expect(built.taskOutput).toBeDefined()
    expect(built.monitor).toBeDefined()
  })
})

describe("task tool", () => {
  it("reports an unavailable capability instead of inventing a task", async () => {
    await expect(execute(tools().task, { description: "d", prompt: "p" }, context())).rejects.toThrow(
      /CAPABILITY_UNAVAILABLE: this host exposes no task capability/,
    )
  })

  it("creates a native child with the host-derived parent and the caller's agent", async () => {
    const host = recordingHost()
    const out = JSON.parse(await execute(tools(host.capabilities).task, { description: "d", prompt: "p", background: true }, context()))
    expect(out).toEqual({ taskID: "ses_child_0001", parentSessionID: "ses_host_0001", state: "running", capabilityVersion: 1 })
    expect(host.childRequests).toEqual([{ title: "d", prompt: "p", agent: "build" }])
    expect(host.taskRequests).toEqual([])
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
    expect(out.taskID).toBe("ses_child_0001")
    expect(host.childRequests).toEqual([{ title: "d", prompt: "p", agent: "explore" }])
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

describe("task_output tool", () => {
  it("reads a completed task through the host reader and reports the host output", async () => {
    const host = recordingHost()
    const out = JSON.parse(await execute(tools(host.capabilities).taskOutput, { task_id: "task_0001" }, context()))
    expect(out).toEqual({ taskID: "task_0001", output: { status: "completed", final_response: "READY" } })
    expect(host.outputRequests).toEqual(["task_0001"])
    expect(host.parents).toEqual(["ses_host_0001"])
  })

  it("reports an unavailable capability instead of inventing output", async () => {
    await expect(execute(tools().taskOutput, { task_id: "task_0001" }, context())).rejects.toThrow(
      /CAPABILITY_UNAVAILABLE: this host exposes no task capability/,
    )
  })

  it("names the missing reader when the host publishes start but no read", async () => {
    const host = recordingHost({ tasks: { version: HOST_CAPABILITY_VERSION, start: async (_request, caller) => ({ taskID: "task_0001", parentSessionID: caller.sessionID, state: "accepted", capabilityVersion: HOST_CAPABILITY_VERSION }) } })
    await expect(execute(tools(host.capabilities).taskOutput, { task_id: "task_0001" }, context())).rejects.toThrow(
      /CAPABILITY_UNAVAILABLE: this host publishes no task-output reader/,
    )
  })

  it("refuses an answer attributed to another task", async () => {
    const host = recordingHost({
      tasks: {
        version: HOST_CAPABILITY_VERSION,
        start: async (_request, caller) => ({ taskID: "task_0001", parentSessionID: caller.sessionID, state: "accepted", capabilityVersion: HOST_CAPABILITY_VERSION }),
        readOutput: async () => ({ taskID: "task_other", output: { status: "completed" } }),
      },
    })
    await expect(execute(tools(host.capabilities).taskOutput, { task_id: "task_0001" }, context())).rejects.toThrow(
      /TASK_ATTRIBUTION_MISMATCH/,
    )
  })

  it("rejects a missing task id", async () => {
    const host = recordingHost()
    await expect(execute(tools(host.capabilities).taskOutput, {}, context())).rejects.toThrow(/INVALID_ARGUMENT/)
    expect(host.outputRequests).toEqual([])
  })

  it("declares exactly one argument: task_id", () => {
    const built = tools()
    expect(Object.keys(built.taskOutput.args.properties)).toEqual(["task_id"])
    expect(built.taskOutput.args.required).toEqual(["task_id"])
  })

  it("refuses a parent identity smuggled through arguments", async () => {
    const host = recordingHost()
    await expect(
      execute(tools(host.capabilities).taskOutput, { task_id: "task_0001", parentSessionID: "ses_other" }, context()),
    ).rejects.toThrow(/INVALID_ARGUMENT/)
    expect(host.outputRequests).toEqual([])
  })

  it("refuses when the caller was already aborted", async () => {
    const host = recordingHost()
    await expect(
      execute(tools(host.capabilities).taskOutput, { task_id: "task_0001" }, context({ aborted: () => true })),
    ).rejects.toThrow(/CANCELLED/)
    expect(host.outputRequests).toEqual([])
  })

  it("refuses without host authentication and never reaches the host", async () => {
    const host = recordingHost()
    await expect(
      execute(tools(host.capabilities).taskOutput, { task_id: "task_0001" }, context({ authenticated: false })),
    ).rejects.toThrow(/UNAUTHENTICATED/)
    expect(host.outputRequests).toEqual([])
  })
})

describe("task_output through native and legacy ids", () => {
  it("reads a child session and returns its final response", async () => {
    const host = recordingHost()
    const out = JSON.parse(await execute(tools(host.capabilities).taskOutput, { task_id: "ses_child_0001" }, context()))
    expect(out.output.final_response).toBe("CHILD-OK")
    expect(out.output.messages).toEqual([{ role: "assistant", text: "CHILD-OK" }])
    expect(out.output.tools).toEqual([
      { name: "shell", status: "completed", input: '{"command":"dir"}', output: "DRIVE_MISSING" },
    ])
    expect(host.outputRequests).toEqual(["ses_child_0001"])
  })

  it("refuses a missing child session by name instead of returning an empty answer", async () => {
    const host = recordingHost()
    await expect(execute(tools(host.capabilities).taskOutput, { task_id: "ses_missing_0001" }, context())).rejects.toThrow(
      /TASK_NOT_FOUND/,
    )
  })

  it("still reads a legacy task id through the task host", async () => {
    const host = recordingHost()
    const out = JSON.parse(await execute(tools(host.capabilities).taskOutput, { task_id: "task_0001" }, context()))
    expect(out.taskID).toBe("task_0001")
    expect(out.output.status).toBe("completed")
  })
})

describe("monitor tool", () => {
  it("refuses when the host publishes no monitor", async () => {
    await expect(execute(tools().monitor, { command: "echo hi" }, context())).rejects.toThrow(/CAPABILITY_UNAVAILABLE/)
  })

  it("starts one watch for the calling session and names the wake instead of polling", async () => {
    const calls = []
    const host = recordingHost({
      monitor: {
        version: HOST_CAPABILITY_VERSION,
        start: async (request, caller) => {
          calls.push({ request, sessionID: caller.sessionID })
          return { accepted: true }
        },
      },
    })
    const out = JSON.parse(await execute(tools(host.capabilities).monitor, { command: "echo READY", filter: "READY" }, context()))
    expect(calls).toEqual([{ request: { command: "echo READY", filter: "READY" }, sessionID: "ses_host_0001" }])
    expect(out.accepted).toBe(true)
    expect(String(out.note)).toMatch(/end your turn/)
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

describe("authority parity between task and call_omo_agent", () => {
  const toolsUnderTest = (built) => [
    ["task", built.task, { description: "d", prompt: "p" }],
    ["call_omo_agent", built.callOmoAgent, { description: "d", prompt: "p", agent: undefined }],
  ];

  // Every field a model could use to claim an identity, a workspace or a project scope. Both tools
  // must refuse all of them, for the same reason, before the host is asked to do anything.
  const smuggled = [
    "sessionID",
    "sessionId",
    "parentID",
    "parentSessionId",
    "parentSessionID",
    "directory",
    "worktree",
    "projectId",
    "projectID",
  ];

  for (const field of smuggled) {
    it(`refuses a smuggled ${field} on both tools and never reaches the host`, async () => {
      const host = recordingHost({ allowedAgents: [] });
      const built = tools(host.capabilities);
      for (const [name, tool, base] of toolsUnderTest(built)) {
        await expect(execute(tool, { ...base, [field]: "attacker-value" }, context())).rejects.toThrow(
          new RegExp(`INVALID_ARGUMENT: ${field} is host-derived`),
        );
      }
      expect(host.taskRequests).toHaveLength(0);
      expect(host.childRequests).toHaveLength(0);
    });
  }

  it("starts both tools from the host-derived caller, never from the arguments", async () => {
    const host = recordingHost({ allowedAgents: ["explore"] });
    const built = tools(host.capabilities);
    await execute(built.task, { description: "d", prompt: "p", agent: "explore" }, context());
    await execute(built.callOmoAgent, { description: "d", prompt: "p", agent: "explore" }, context());

    expect(host.parents).toEqual(["ses_host_0001", "ses_host_0001"]);
  });
})
