import { describe, expect, it } from "bun:test"

import type { OmoAuthenticatedCaller } from "./host-capabilities.ts"
import {
  createHostCapabilities,
  type OmoCreateSessionInput,
  type OmoDelegationRuntime,
  type OmoStartSessionInput,
} from "./host-provider.ts"

const caller: OmoAuthenticatedCaller = {
  sessionID: "ses_caller_0001",
  messageID: "msg_0001",
  agent: "build",
  directory: "/workspace",
  worktree: "/workspace",
}

interface Recorder {
  readonly runtime: OmoDelegationRuntime
  readonly created: OmoCreateSessionInput[]
  readonly started: OmoStartSessionInput[]
}

const recorder = (over: Partial<OmoDelegationRuntime> = {}): Recorder => {
  const created: OmoCreateSessionInput[] = []
  const started: OmoStartSessionInput[] = []
  const runtime: OmoDelegationRuntime = {
    createSession: async (input) => {
      created.push(input)
      return { sessionID: "ses_child_0001" }
    },
    startSession: async (input) => {
      started.push(input)
      return { outcome: "accepted" }
    },
    ...over,
  }
  return { runtime, created, started }
}

describe("capability composition", () => {
  it("publishes no child-session capability when the host supplies no session operations", () => {
    expect(createHostCapabilities({}).childSessions).toBeUndefined()
    expect(createHostCapabilities({ allowedAgents: ["explore"] }).childSessions).toBeUndefined()
  })

  it("publishes the task capability alone when only a manager is supplied", () => {
    const capabilities = createHostCapabilities({ taskManager: { start: async () => ({ taskID: "t", state: "accepted" }) } })
    expect(capabilities.childSessions).toBeUndefined()
    expect(capabilities.tasks).toBeDefined()
  })

  it("refuses to create a child when one operation is missing", async () => {
    const partial = createHostCapabilities({ createSession: async () => ({ sessionID: "ses_x" }) })
    expect(partial.childSessions).toBeUndefined()
  })
})

describe("child-session provider", () => {
  it("derives the parent and the directory from the caller, not from the request", async () => {
    const rec = recorder()
    const capabilities = createHostCapabilities(rec.runtime)
    const handle = await capabilities.childSessions!.createAndStart({ title: "child", prompt: "do it" }, caller)
    expect(handle).toEqual({ childSessionID: "ses_child_0001", parentSessionID: "ses_caller_0001", started: true, capabilityVersion: 1 })
    expect(rec.created).toEqual([{ parentID: "ses_caller_0001", title: "child", directory: "/workspace" }])
    expect(rec.started).toEqual([{ sessionID: "ses_child_0001", prompt: "do it", directory: "/workspace" }])
  })

  it("reports a creation failure with the host reason and starts nothing", async () => {
    const rec = recorder({ createSession: async () => ({ error: "engine rejected the request" }) })
    const capabilities = createHostCapabilities(rec.runtime)
    await expect(capabilities.childSessions!.createAndStart({ title: "c", prompt: "p" }, caller)).rejects.toThrow(
      /SESSION_CREATE_FAILED: engine rejected the request/,
    )
    expect(rec.started).toHaveLength(0)
  })

  it("refuses a host that returns no session identity", async () => {
    const rec = recorder({ createSession: async () => ({}) })
    const capabilities = createHostCapabilities(rec.runtime)
    await expect(capabilities.childSessions!.createAndStart({ title: "c", prompt: "p" }, caller)).rejects.toThrow(/SESSION_CREATE_FAILED/)
    expect(rec.started).toHaveLength(0)
  })

  it("keeps the real child identity when the first prompt is refused", async () => {
    const rec = recorder({ startSession: async () => ({ outcome: "refused", error: "provider unavailable" }) })
    const capabilities = createHostCapabilities(rec.runtime)
    await expect(capabilities.childSessions!.createAndStart({ title: "c", prompt: "p" }, caller)).rejects.toThrow(
      /PROMPT_SUBMIT_FAILED: session ses_child_0001 exists but its first prompt was refused.*provider unavailable/,
    )
  })

  it("never reports started for a child whose prompt never ran", async () => {
    const rec = recorder({ startSession: async () => ({ outcome: "refused" }) })
    const capabilities = createHostCapabilities(rec.runtime)
    await expect(capabilities.childSessions!.createAndStart({ title: "c", prompt: "p" }, caller)).rejects.toThrow(/PROMPT_SUBMIT_FAILED/)
  })

  it("refuses agent selection when the host publishes no authorized set", async () => {
    const rec = recorder()
    const capabilities = createHostCapabilities(rec.runtime)
    await expect(capabilities.childSessions!.createAndStart({ title: "c", prompt: "p", agent: "oracle" }, caller)).rejects.toThrow(/FORBIDDEN/)
    expect(rec.created).toHaveLength(0)
  })

  it("refuses an agent outside the host set", async () => {
    const rec = recorder({ allowedAgents: ["explore"] })
    const capabilities = createHostCapabilities(rec.runtime)
    await expect(capabilities.childSessions!.createAndStart({ title: "c", prompt: "p", agent: "oracle" }, caller)).rejects.toThrow(/FORBIDDEN/)
    expect(rec.created).toHaveLength(0)
  })

  it("reports an unprovable prompt as unknown, never as started or failed", async () => {
    const rec = recorder({ startSession: async () => ({ outcome: "unknown", error: "fetch failed" }) })
    const capabilities = createHostCapabilities(rec.runtime)
    await expect(capabilities.childSessions!.createAndStart({ title: "c", prompt: "p" }, caller)).rejects.toThrow(/CHILD_STATUS_UNKNOWN/)
  })

  it("never treats an unrecognised start outcome as success", async () => {
    // SAFETY: the host seam is typed to the tri-state union; this case forces a value outside it on purpose.
    const rec = recorder({ startSession: async () => ({ outcome: "queued" }) as never })
    const capabilities = createHostCapabilities(rec.runtime)
    await expect(capabilities.childSessions!.createAndStart({ title: "c", prompt: "p" }, caller)).rejects.toThrow(/CHILD_STATUS_UNKNOWN/)
  })

  it("refuses a host that created the child under another parent", async () => {
    const rec = recorder({ createSession: async () => ({ sessionID: "ses_child_0001", parentID: "ses_other" }) })
    const capabilities = createHostCapabilities(rec.runtime)
    await expect(capabilities.childSessions!.createAndStart({ title: "c", prompt: "p" }, caller)).rejects.toThrow(/PARENT_ATTRIBUTION_MISMATCH/)
    expect(rec.started).toHaveLength(0)
  })

  it("publishes the authorized agent set at the capability level the tools read", async () => {
    const capabilities = createHostCapabilities(recorder({ allowedAgents: ["explore"] }).runtime)
    expect(capabilities.allowedAgents).toEqual(["explore"])
  })

  it("forwards an authorized agent to the host start call", async () => {
    const rec = recorder({ allowedAgents: ["explore"] })
    const capabilities = createHostCapabilities(rec.runtime)
    await capabilities.childSessions!.createAndStart({ title: "c", prompt: "p", agent: "explore" }, caller)
    expect(rec.started[0]?.agent).toBe("explore")
  })
})

describe("task provider", () => {
  it("is absent when the runtime supplies no canonical manager", () => {
    expect(createHostCapabilities(recorder().runtime).tasks).toBeUndefined()
  })

  it("passes the host-derived parent to the canonical manager", async () => {
    const calls: Array<{ readonly task: string; readonly parentSessionID: string }> = []
    const rec = recorder({
      taskManager: {
        start: async (request) => {
          calls.push({ task: request.description, parentSessionID: request.parentSessionID })
          return { taskID: "task_0001", state: "accepted" }
        },
      },
    })
    const handle = await createHostCapabilities(rec.runtime).tasks!.start({ description: "audit", prompt: "p" }, caller)
    expect(handle).toEqual({ taskID: "task_0001", parentSessionID: "ses_caller_0001", state: "accepted", capabilityVersion: 1 })
    expect(calls).toEqual([{ task: "audit", parentSessionID: "ses_caller_0001" }])
  })

  it("refuses a manager that returns no task identity", async () => {
    const rec = recorder({ taskManager: { start: async () => ({ taskID: "", state: "accepted" }) } })
    await expect(createHostCapabilities(rec.runtime).tasks!.start({ description: "d", prompt: "p" }, caller)).rejects.toThrow(/INTERNAL/)
  })
})
