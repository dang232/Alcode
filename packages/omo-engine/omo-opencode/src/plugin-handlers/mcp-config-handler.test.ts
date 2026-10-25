import { describe, expect, test } from "bun:test"

import { applyMcpConfig } from "./mcp-config-handler"
import type { OmoHostConfig } from "../plugin-types"

// The host MCP map is the only place a local server (and therefore a filesystem or
// memory root) can be attached to a session. `disabled_mcps` is the plugin's gate for
// that map, and Slice 9.4 found it had no test at all, so a regression could silently
// re-expose every configured server.
function host(mcp: Record<string, unknown>): OmoHostConfig {
  // SAFETY: the handler only reads and rewrites `mcp`; the remaining host fields are
  // irrelevant to this unit and are left absent on purpose.
  return { mcp } as OmoHostConfig
}

describe("applyMcpConfig", () => {
  test("#given a disabled name #when applied #then exactly that server is removed and the rest survive", () => {
    const config = host({
      agentmemory: { type: "local", command: ["npx", "@agentmemory/mcp"] },
      figma: { type: "local", command: ["npx", "figma-developer-mcp"] },
    })

    applyMcpConfig({ hostConfig: config, pluginConfig: { disabled_mcps: ["agentmemory"] } })

    expect(Object.keys(config.mcp ?? {})).toEqual(["figma"])
    expect(config.mcp?.figma).toEqual({ type: "local", command: ["npx", "figma-developer-mcp"] })
  })

  test("#given no disabled list #when applied #then every server stays attached", () => {
    const config = host({ filesystem: { type: "local", command: ["npx", "server-filesystem"] } })

    applyMcpConfig({ hostConfig: config, pluginConfig: {} })

    expect(Object.keys(config.mcp ?? {})).toEqual(["filesystem"])
  })

  test("#given a disabled name that is not configured #when applied #then nothing else is dropped", () => {
    const config = host({
      memory: { type: "local", command: ["npx", "server-memory"] },
      railway: { type: "local", command: ["railway", "mcp"] },
    })

    applyMcpConfig({ hostConfig: config, pluginConfig: { disabled_mcps: ["missing"] } })

    expect(Object.keys(config.mcp ?? {}).sort()).toEqual(["memory", "railway"])
  })

  test("#given a non-object entry #when applied #then it is dropped instead of passing through", () => {
    const config = host({ good: { type: "local", command: ["x"] }, bad: "not-a-server" })

    applyMcpConfig({ hostConfig: config, pluginConfig: {} })

    expect(Object.keys(config.mcp ?? {})).toEqual(["good"])
  })

  test("#given an applied map #when applied again #then the result is stable", () => {
    const config = host({ a: { type: "local", command: ["x"] }, b: { type: "local", command: ["y"] } })
    const pluginConfig = { disabled_mcps: ["a"] }

    applyMcpConfig({ hostConfig: config, pluginConfig })
    const once = { ...config.mcp }
    applyMcpConfig({ hostConfig: config, pluginConfig })

    expect(config.mcp).toEqual(once)
  })
})
