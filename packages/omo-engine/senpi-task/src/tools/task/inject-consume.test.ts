import { describe, expect, test } from "bun:test"

import { buildStartSpec, type InjectedKnowledgeBlock, type InjectedKnowledgeRecord } from "./execute-spec"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"

function knowledgeRecord(overrides: Partial<InjectedKnowledgeRecord> = {}): InjectedKnowledgeRecord {
  return {
    id: "pk-abc123def456",
    category: "source-verified",
    claim: "The worker retries through the existing node retry path.",
    sourceFile: "src/dag/repair.ts",
    sourceRevision: "a".repeat(40),
    fingerprint: "b".repeat(64),
    validatedAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  }
}

function block(records: readonly InjectedKnowledgeRecord[]): InjectedKnowledgeBlock {
  return { records }
}

describe("inject-consume", () => {
  test("#given retrieved knowledge #when building the worker spec #then the claim and provenance reach the ManagerStartSpec prompt", () => {
    // given eligible records from memory-core retrieve -> rank
    const deps = makeDeps(createFakeManager({}))
    const records = [
      knowledgeRecord({ id: "pk-first1111111", claim: "Retry uses the node retry path." }),
      knowledgeRecord({ id: "pk-second222222", claim: "Evidence gates stay fail-closed.", sourceFile: "src/dag/verification.ts" }),
    ]
    // when the spec is built with the block
    const spec = buildStartSpec({ prompt: "do the thing" }, { category: "quick" }, CTX.sessionManager.getSessionId(), deps, CTX.cwd, undefined, block(records))
    // then the worker prompt carries the claims with provenance
    expect(spec.prompt.startsWith("do the thing")).toBe(true)
    expect(spec.prompt).toContain("Retry uses the node retry path.")
    expect(spec.prompt).toContain("Evidence gates stay fail-closed.")
    expect(spec.prompt).toContain("pk-first1111111")
    expect(spec.prompt).toContain("pk-second222222")
    expect(spec.prompt).toContain("untrusted memory")
    expect(spec.prompt).toContain("src/dag/repair.ts")
    // and the spec still routes to the same worker
    expect(spec.category).toBe("quick")
    expect(spec.parent_session_id).toBe("parent-session-1")
    expect(spec.root_session_id).toBe("parent-session-1")
    expect(spec.depth).toBe(1)
  })

  test("#given knowledge and skill content #when building the spec #then skills precede memory content", () => {
    // given a skill prepend plus a knowledge block
    const deps = makeDeps(createFakeManager({}), {
      loadSkills: (names) => ({
        prepend: names.length > 0 ? "SKILL DIRECTIVE\n\n" : "",
        resolved: names,
        missing: [],
      }),
    })
    // when the spec is built with both
    const spec = buildStartSpec(
      { prompt: "do the thing", load_skills: ["reviewer"] },
      { category: "quick" },
      CTX.sessionManager.getSessionId(),
      deps,
      CTX.cwd,
      undefined,
      block([knowledgeRecord()]),
    )
    // then skill content outranks memory content in the prompt
    expect(spec.prompt.indexOf("SKILL DIRECTIVE")).toBeGreaterThanOrEqual(0)
    expect(spec.prompt.indexOf("SKILL DIRECTIVE")).toBeLessThan(spec.prompt.indexOf("untrusted memory"))
    expect(spec.prompt).toContain("SKILL DIRECTIVE\n\ndo the thing")
  })

  test("#given a knowledge block #when building the spec #then every non-prompt field matches the no-knowledge spec", () => {
    // given the same spawn with and without knowledge
    const deps = makeDeps(createFakeManager({}))
    const params = { prompt: "do the thing" } as const
    const target = { category: "quick" } as const
    const baseline = buildStartSpec(params, target, "parent", deps, "/project")
    // when knowledge is injected
    const injected = buildStartSpec(params, target, "parent", deps, "/project", undefined, block([knowledgeRecord()]))
    // then only the prompt changes
    expect({ ...injected, prompt: "" }).toEqual({ ...baseline, prompt: "" })
    expect(injected.prompt.length).toBeGreaterThan(baseline.prompt.length)
  })
})
