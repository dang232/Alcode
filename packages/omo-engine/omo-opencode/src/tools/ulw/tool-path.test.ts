/**
 * tool-path.test.ts — the existing tool path carries the six ULW tools.
 *
 * `createTools` → `tool-registry.ts` → `plugin-setup.ts`
 * `ctx.tool.transform`: the registry names the tools (still gated by user
 * disables, per-agent denies, and the size cap), `createTools` attaches the
 * real store-backed executes, and the force-denylist is untouched.
 */

import { describe, expect, test } from "bun:test"
import { z } from "zod"

import { OhMyOpenCodeConfigSchema } from "../../config/schema/oh-my-opencode-config.ts"
import { createTools } from "../../create-tools.ts"
import { buildToolRegistry, isForceDisabledTool } from "../../plugin/tool-registry.ts"
import type { OmoPluginContext, OmoToolManagers } from "../../plugin-types.ts"
import { UlwStore } from "../../ulw/store.ts"
import { ULW_TOOL_NAMES } from "./index.ts"
import { setUlwStoreForTests } from "./store-instance.ts"

const EXPECTED_TOOL_NAMES = [
  "ulw_checkpoint",
  "ulw_complete",
  "ulw_dispatch",
  "ulw_evidence",
  "ulw_goal_create",
  "ulw_status",
]

function testManagers(): OmoToolManagers {
  return {
    backgroundManager: {
      shutdown: async () => {},
      noteSubagentBirth: async () => {},
      noteSubagentDeath: async () => {},
    },
    skillMcpManager: {
      disconnectAll: async () => {},
      callSkillTool: async () => ({ output: "", isError: false }),
    },
    modelFallbackControllerAccessor: { current: () => undefined },
  }
}

function testContext(disabledTools: readonly string[] = []): OmoPluginContext {
  const directory = process.platform === "win32" ? "I:/work/project" : "/work/project"
  const pluginConfig = OhMyOpenCodeConfigSchema.parse(
    disabledTools.length === 0 ? {} : { disabled_tools: [...disabledTools] },
  )
  return { directory, pluginConfig }
}

function freshStore(): UlwStore {
  let counter = 0
  return new UlwStore({
    now: () => 1700000000000,
    newRunId: () => `path-run-${(counter += 1)}`,
  })
}

function ctxSession(ctx: OmoPluginContext) {
  return {
    sessionID: "ses_main",
    messageID: "msg_1",
    agent: "test-agent",
    directory: ctx.directory,
    worktree: ctx.directory,
    aborted: () => false,
  }
}

describe("ulw registry names", () => {
  test("#given the default config #when the registry builds #then all six ulw tools are kept", () => {
    // given / when
    const registry = buildToolRegistry({ skills: [] })

    // then
    expect([...ULW_TOOL_NAMES].sort()).toEqual(EXPECTED_TOOL_NAMES)
    for (const name of ULW_TOOL_NAMES) {
      expect(Object.hasOwn(registry, name)).toBe(true)
    }
  })

  test("#given the force-denylist #when checked #then no ulw tool is force-disabled", () => {
    // Existing families stay denied; the ulw prefix is not one of them.
    for (const name of ULW_TOOL_NAMES) {
      expect(isForceDisabledTool(name)).toBe(false)
    }
    expect(isForceDisabledTool("task_dispatch")).toBe(true)
    expect(isForceDisabledTool("teammate")).toBe(true)
    expect(isForceDisabledTool("todo_write")).toBe(true)
    expect(isForceDisabledTool("LspHover")).toBe(true)
    expect(isForceDisabledTool("grep_app_search")).toBe(true)
  })

  test("#given a user disable #when the registry builds #then only that ulw tool drops out", () => {
    // given / when
    const registry = buildToolRegistry({ skills: [], disabledTools: ["ulw_dispatch"] })

    // then
    expect(Object.hasOwn(registry, "ulw_dispatch")).toBe(false)
    for (const name of ULW_TOOL_NAMES) {
      if (name === "ulw_dispatch") continue
      expect(Object.hasOwn(registry, name)).toBe(true)
    }
  })
})

describe("ulw createTools wiring", () => {
  test("#given the default config #when tools assemble #then all six run the real executes", async () => {
    // given
    setUlwStoreForTests(freshStore())
    const ctx = testContext()

    // when
    const created = await createTools(ctx, ctx.pluginConfig, testManagers())

    // then
    for (const name of ULW_TOOL_NAMES) {
      expect(Object.hasOwn(created.filteredTools, name)).toBe(true)
    }
    const goalCreate = created.filteredTools["ulw_goal_create"]
    const outcome = await goalCreate.execute({ brief: "Ship the loop", id: "run-path-1" }, ctxSession(ctx))
    const text = z.string().parse(outcome)
    // SAFETY: ulw_goal_create answers with the run record, which carries the string run id.
    const record = JSON.parse(text) as { id: string }
    expect(record.id).toBe("run-path-1")
    const status = created.filteredTools["ulw_status"]
    const statusOutcome = await status.execute({ runId: "run-path-1" }, ctxSession(ctx))
    expect(z.string().parse(statusOutcome)).toContain("run-path-1")
    setUlwStoreForTests(undefined)
  })

  test("#given a user disable #when tools assemble #then that ulw tool stays out", async () => {
    // given
    setUlwStoreForTests(freshStore())
    const ctx = testContext(["ulw_status"])

    // when
    const created = await createTools(ctx, ctx.pluginConfig, testManagers())

    // then
    expect(Object.hasOwn(created.filteredTools, "ulw_status")).toBe(false)
    for (const name of ULW_TOOL_NAMES) {
      if (name === "ulw_status") continue
      expect(Object.hasOwn(created.filteredTools, name)).toBe(true)
    }
    setUlwStoreForTests(undefined)
  })
})
