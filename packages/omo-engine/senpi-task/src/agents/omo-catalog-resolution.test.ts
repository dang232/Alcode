import { describe, expect, test } from "bun:test"

import { BUILTIN_AGENTS } from "./builtin/index"
import { OMO_AGENT_CATALOG } from "./omo-catalog"
import { resolveAgent } from "./resolve-agent"
import { listTaskCategories } from "../tools/task/categories"

type FakeModel = {
  readonly provider: string
  readonly id: string
}

const models: readonly FakeModel[] = [
  { provider: "kimi-coding", id: "kimi-for-coding-highspeed" },
  { provider: "anthropic-subscription", id: "claude-fable-5-1" },
  { provider: "chatgpt-subscription", id: "gpt-6-astra" },
  { provider: "openai", id: "gpt-6-luna-fast" },
]

const registry = {
  getAvailable: () => models,
  find: (provider: string, modelId: string) => models.find((m) => m.provider === provider && m.id === modelId),
}

describe("omo catalog runtime mapping", () => {
  test("every senpi catalog agent routes through resolveAgent without not_found", () => {
    const senpiAgents = OMO_AGENT_CATALOG.filter((entry) => entry.edition === "senpi" && entry.kind === "agent")
    expect(senpiAgents.length).toBeGreaterThan(0)
    for (const entry of senpiAgents) {
      const result = resolveAgent(entry.id, BUILTIN_AGENTS, registry)
      expect(result.kind).not.toBe("not_found")
    }
  })

  test("the curated four resolve fully against a stocked registry", () => {
    for (const id of ["explore", "librarian", "plan-consultant", "plan-reviewer"]) {
      const result = resolveAgent(id, BUILTIN_AGENTS, registry)
      expect(result.kind).toBe("resolved")
    }
  })

  test("catalog categories are all listed task categories", () => {
    const listed = new Set(listTaskCategories({ categories: {} }).map((entry) => entry.name))
    const catalogCategories = OMO_AGENT_CATALOG.filter((entry) => entry.kind === "category")
    expect(catalogCategories.length).toBeGreaterThan(0)
    for (const entry of catalogCategories) {
      expect(listed.has(entry.id)).toBe(true)
    }
  })

  test("the explore persona keeps read tools and excludes write tools", () => {
    const result = resolveAgent("explore", BUILTIN_AGENTS, registry)
    if (result.kind !== "resolved") throw new Error(`Expected resolved explore, got ${result.kind}`)
    expect(result.toolAllowlist ?? []).toContain("read")
    expect(result.toolAllowlist ?? []).not.toContain("write")
    expect(result.toolAllowlist ?? []).not.toContain("edit")
  })
})
