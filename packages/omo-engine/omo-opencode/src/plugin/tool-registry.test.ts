/**
 * tool-registry.test.ts — registry gating for the native tool catalog.
 *
 * Proves `code_graph` travels the same gate as every other entry: present
 * after `buildToolRegistry` with default config, absent when the user
 * disables it.
 */
import { describe, expect, it } from "bun:test"

import { buildToolRegistry } from "./tool-registry.ts"

describe("tool registry code_graph gating", () => {
  it("#given default config #when built #then code_graph is present", () => {
    const registry = buildToolRegistry({ skills: [] })

    expect(registry["code_graph"]).toBeDefined()
  })

  it("#given code_graph disabled #when built #then code_graph is absent", () => {
    const registry = buildToolRegistry({ skills: [], disabledTools: ["code_graph"] })

    expect(registry["code_graph"]).toBeUndefined()
  })
})
