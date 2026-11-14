import { describe, expect, it } from "bun:test"

import type { OmoToolContext } from "../../plugin-types.ts"
import { HOST_CAPABILITY_VERSION, callerFromContext, capabilitiesOf, type OmoHostCapabilities } from "./host-capabilities.ts"

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

describe("caller identity", () => {
  it("derives the caller from host context alone", () => {
    expect(callerFromContext(context())).toEqual({
      sessionID: "ses_host_0001",
      messageID: "msg_0001",
      agent: "build",
      directory: "/workspace",
      worktree: "/workspace",
    })
  })

  it("refuses a missing context", () => {
    expect(() => callerFromContext(undefined)).toThrow(/UNAUTHENTICATED/)
  })

  it("refuses a context the host did not authenticate", () => {
    expect(() => callerFromContext(context({ authenticated: false }))).toThrow(/UNAUTHENTICATED/)
  })

  it("refuses the legacy unknown sentinel and an empty identity", () => {
    expect(() => callerFromContext(context({ sessionID: "unknown" }))).toThrow(/UNAUTHENTICATED/)
    expect(() => callerFromContext(context({ sessionID: "" }))).toThrow(/UNAUTHENTICATED/)
  })
})

describe("capability envelope", () => {
  const tasks = { version: HOST_CAPABILITY_VERSION, start: async () => ({ taskID: "t", parentSessionID: "s", state: "accepted" as const, capabilityVersion: 1 }) }

  it("accepts a host that speaks the current contract version", () => {
    const source: OmoHostCapabilities = { version: HOST_CAPABILITY_VERSION, tasks }
    expect(capabilitiesOf(source)).toBe(source)
  })

  it("drops a host that speaks another contract version", () => {
    const source: OmoHostCapabilities = { version: 2, tasks }
    expect(capabilitiesOf(source)).toEqual({ version: HOST_CAPABILITY_VERSION })
  })

  it("reports no capability when the host supplied none", () => {
    expect(capabilitiesOf(undefined)).toEqual({ version: HOST_CAPABILITY_VERSION })
  })
})
