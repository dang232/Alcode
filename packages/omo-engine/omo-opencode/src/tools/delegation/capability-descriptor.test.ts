import { afterAll, beforeAll, describe, expect, it } from "bun:test"

import { createHostCapabilities } from "./host-provider.ts"
import {
  createOperationsFromDescriptor,
  createTaskOperationsFromDescriptor,
  readCapabilityDescriptor,
  readCapabilityDescriptorFromEnv,
} from "./capability-descriptor.ts"

interface Recorded {
  readonly path: string
  readonly authorization: string
  readonly body: Record<string, string>
}

const server = (): { url: string; calls: Recorded[]; stop: () => void } => {
  const calls: Recorded[] = []
  const running = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = (await request.json()) as Record<string, string>
      calls.push({ path: url.pathname, authorization: request.headers.get("authorization") ?? "", body })
      if (url.pathname === "/capability/session") {
        return Response.json({ sessionID: "ses_host_child_0001", parentID: body["parentID"] })
      }
      if (url.pathname === "/capability/session/start") return Response.json({ outcome: "accepted" })
      if (url.pathname === "/capability/task") return Response.json({ taskID: "task_host_0001", state: "accepted" })
      if (url.pathname === "/capability/task/output") {
        return Response.json({ taskID: body["taskID"], output: { status: "completed", final_response: "READY" } })
      }
      if (url.pathname === "/capability/session/read") {
        return Response.json({
          kind: "status",
          messages: [{ role: "assistant", text: "done" }],
          final_response: "done",
          tools: [
            { name: "shell", status: "completed", input: '{"command":"cd I:\\\\x"}', output: "DRIVE_MISSING" },
            { name: "execute", input: 7, output: null },
            { input: "nameless calls are dropped" },
          ],
        })
      }
      return new Response("not found", { status: 404 })
    },
  })
  return { url: `http://127.0.0.1:${running.port}`, calls, stop: () => void running.stop(true) }
}

const caller = {
  sessionID: "ses_caller_0001",
  messageID: "msg_1",
  agent: "build",
  directory: "/workspace",
  worktree: "/workspace",
}

describe("descriptor reading", () => {
  it("accepts a well-formed host descriptor", () => {
    const descriptor = readCapabilityDescriptor({
      hostCapabilities: { version: 1, url: "http://127.0.0.1:9999", token: "t0ken", allowedAgents: ["explore"] },
    })
    expect(descriptor?.url).toBe("http://127.0.0.1:9999")
    expect(descriptor?.allowedAgents).toEqual(["explore"])
  })

  it("refuses a non-http scheme in the descriptor url", () => {
    expect(readCapabilityDescriptor({ hostCapabilities: { version: 1, url: "ftp://host.test", token: "t" } })).toBeUndefined()
  })

  it("refuses a descriptor with no token, an empty token, a bad url, or a future version", () => {
    expect(readCapabilityDescriptor({ hostCapabilities: { version: 1, url: "http://x.test" } })).toBeUndefined()
    expect(readCapabilityDescriptor({ hostCapabilities: { version: 1, url: "http://x.test", token: "" } })).toBeUndefined()
    expect(readCapabilityDescriptor({ hostCapabilities: { version: 1, url: "not-a-url", token: "t" } })).toBeUndefined()
    expect(readCapabilityDescriptor({ hostCapabilities: { version: 2, url: "http://x.test", token: "t" } })).toBeUndefined()
    expect(readCapabilityDescriptor(undefined)).toBeUndefined()
    expect(readCapabilityDescriptor({})).toBeUndefined()
  })
})

describe("host capability over the injected endpoint", () => {
  let host: ReturnType<typeof server>
  beforeAll(() => {
    host = server()
  })
  afterAll(() => {
    host.stop()
  })

  const descriptor = () => ({ version: 1 as const, url: host.url, token: "t0ken", allowedAgents: ["explore"] })

  it("creates and starts a child through the host, with the caller as parent", async () => {
    const capabilities = createHostCapabilities(createOperationsFromDescriptor(descriptor()))
    const handle = await capabilities.childSessions!.createAndStart({ title: "child", prompt: "do it" }, caller)
    expect(handle).toEqual({ childSessionID: "ses_host_child_0001", parentSessionID: "ses_caller_0001", started: true, capabilityVersion: 1 })
    expect(host.calls[0]?.path).toBe("/capability/session")
    expect(host.calls[0]?.authorization).toBe("Bearer t0ken")
    expect(host.calls[0]?.body["parentID"]).toBe("ses_caller_0001")
    expect(host.calls[0]?.body["directory"]).toBe("/workspace")
    expect(host.calls[1]?.path).toBe("/capability/session/start")
    expect(host.calls[1]?.body["sessionID"]).toBe("ses_host_child_0001")
  })

  it("refuses an agent the host did not authorize before any request", async () => {
    const before = host.calls.length
    const capabilities = createHostCapabilities(createOperationsFromDescriptor(descriptor()))
    await expect(capabilities.childSessions!.createAndStart({ title: "c", prompt: "p", agent: "oracle" }, caller)).rejects.toThrow(/FORBIDDEN/)
    expect(host.calls.length).toBe(before)
  })

  it("starts a task through the host endpoint with the caller as parent", async () => {
    const capabilities = createHostCapabilities(createTaskOperationsFromDescriptor(descriptor()))
    const handle = await capabilities.tasks!.start({ description: "audit", prompt: "p" }, caller)
    expect(handle).toEqual({ taskID: "task_host_0001", parentSessionID: "ses_caller_0001", state: "accepted", capabilityVersion: 1 })
    const call = host.calls[host.calls.length - 1]
    expect(call?.path).toBe("/capability/task")
    expect(call?.body["parentSessionID"]).toBe("ses_caller_0001")
  })

  it("reads a task's output through the host endpoint with the caller as parent", async () => {
    const capabilities = createHostCapabilities(createTaskOperationsFromDescriptor(descriptor()))
    const read = await capabilities.tasks!.readOutput!({ taskID: "task_host_0001" }, caller)
    expect(read).toEqual({ taskID: "task_host_0001", output: { status: "completed", final_response: "READY" } })
    const call = host.calls[host.calls.length - 1]
    expect(call?.path).toBe("/capability/task/output")
    expect(call?.authorization).toBe("Bearer t0ken")
    expect(call?.body["taskID"]).toBe("task_host_0001")
  })

  it("returns a session's tool evidence so a claim about its shell can be checked", async () => {
    const operations = createOperationsFromDescriptor(descriptor())
    const read = await operations.readSession!({ sessionID: "ses_host_child_0001", directory: "/workspace" })
    expect(read.finalResponse).toBe("done")
    expect(read.tools).toEqual([
      { name: "shell", status: "completed", input: '{"command":"cd I:\\\\x"}', output: "DRIVE_MISSING" },
      { name: "execute", input: "", output: "" },
    ])
  })

  it("reports a host that refuses the read instead of returning empty output", async () => {
    const failing = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: "TASK_MANAGER_UNAVAILABLE", message: "no-manager" }, { status: 503 })
      },
    })
    try {
      const failingDescriptor = { version: 1 as const, url: `http://127.0.0.1:${failing.port}`, token: "t0ken" }
      const capabilities = createHostCapabilities(createTaskOperationsFromDescriptor(failingDescriptor))
      await expect(capabilities.tasks!.readOutput!({ taskID: "task_host_0001" }, caller)).rejects.toThrow(
        /TASK_OUTPUT_UNAVAILABLE/,
      )
    } finally {
      void failing.stop(true)
    }
  })

  it("treats a redirect as a host failure rather than following it with the token", async () => {
    const redirecting = Bun.serve({
      port: 0,
      fetch: () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:1/elsewhere" } }),
    })
    try {
      const capabilities = createHostCapabilities(
        createOperationsFromDescriptor({ version: 1, url: `http://127.0.0.1:${redirecting.port}`, token: "t0ken" }),
      )
      await expect(capabilities.childSessions!.createAndStart({ title: "c", prompt: "p" }, caller)).rejects.toThrow(/SESSION_CREATE_FAILED/)
    } finally {
      redirecting.stop(true)
    }
  })

  it("reports an unreachable host as a failed session, never as a child", async () => {
    const capabilities = createHostCapabilities(createOperationsFromDescriptor({ version: 1, url: "http://127.0.0.1:1", token: "t" }))
    await expect(capabilities.childSessions!.createAndStart({ title: "c", prompt: "p" }, caller)).rejects.toThrow(/SESSION_CREATE_FAILED/)
  })
})

describe("descriptor from the host environment", () => {
  it("reads the descriptor the host publishes as environment", () => {
    const descriptor = readCapabilityDescriptorFromEnv({
      OMO_CAPABILITY_URL: "http://127.0.0.1:57123",
      OMO_CAPABILITY_TOKEN: "token-value",
      OMO_CAPABILITY_ALLOWED_AGENTS: "explore, librarian",
    })

    expect(descriptor?.url).toBe("http://127.0.0.1:57123")
    expect(descriptor?.token).toBe("token-value")
    expect(descriptor?.allowedAgents).toEqual(["explore", "librarian"])
  })

  it("publishes nothing when either half is absent or the url is not http", () => {
    expect(readCapabilityDescriptorFromEnv({ OMO_CAPABILITY_URL: "http://127.0.0.1:1" })).toBeUndefined()
    expect(readCapabilityDescriptorFromEnv({ OMO_CAPABILITY_TOKEN: "t" })).toBeUndefined()
    expect(readCapabilityDescriptorFromEnv({ OMO_CAPABILITY_URL: "ftp://host", OMO_CAPABILITY_TOKEN: "t" })).toBeUndefined()
  })
})
