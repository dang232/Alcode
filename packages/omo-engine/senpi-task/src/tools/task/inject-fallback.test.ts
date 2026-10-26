import { describe, expect, test } from "bun:test"

import { buildStartSpec, type InjectedKnowledgeBlock, type InjectedKnowledgeRecord } from "./execute-spec"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"

function knowledgeRecord(overrides: Partial<InjectedKnowledgeRecord> = {}): InjectedKnowledgeRecord {
  return {
    id: "pk-abc123def456",
    category: "source-verified",
    claim: "Evidence gates stay fail-closed.",
    sourceFile: "src/dag/verification.ts",
    sourceRevision: "c".repeat(40),
    fingerprint: "d".repeat(64),
    validatedAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  }
}

function buildSpec(block: InjectedKnowledgeBlock | undefined) {
  const deps = makeDeps(createFakeManager({}))
  return buildStartSpec({ prompt: "do the thing" }, { category: "quick" }, CTX.sessionManager.getSessionId(), deps, CTX.cwd, undefined, block)
}

describe("inject-fallback", () => {
  test("#given absent memory #when building the spec #then the output is byte-identical to today", () => {
    // given no knowledge block at all (repo absent, cache miss, ranker empty)
    // when the spec is built with and without the optional input
    const withAbsent = buildSpec(undefined)
    const baseline = buildStartSpec({ prompt: "do the thing" }, { category: "quick" }, CTX.sessionManager.getSessionId(), makeDeps(createFakeManager({})), CTX.cwd)
    // then every byte matches: no placeholder, no leak about repo state
    expect(withAbsent).toEqual(baseline)
    expect(JSON.stringify(withAbsent)).toBe(JSON.stringify(baseline))
    expect(withAbsent.prompt.includes("untrusted memory")).toBe(false)
    expect(withAbsent.prompt.includes("Project knowledge")).toBe(false)
  })

  test("#given zero eligible records #when building the spec #then the output is byte-identical to absent", () => {
    // given an empty block (nothing eligible after filtering)
    // when the spec is built
    const spec = buildSpec({ records: [] })
    // then it reads exactly like absent memory
    expect(spec).toEqual(buildSpec(undefined))
  })

  test("#given a throwing memory subsystem #when the call site falls back #then the spawn proceeds with undefined", () => {
    // given a retrieve -> rank path that throws
    let catches = 0
    const loadKnowledge = (): InjectedKnowledgeBlock => {
      throw new Error("memory repo absent")
    }
    let block: InjectedKnowledgeBlock | undefined
    try {
      block = loadKnowledge()
    } catch {
      // Fail-closed to no-knowledge: counted once, never fail the spawn.
      catches += 1
      block = undefined
    }
    // when the spec is built with the fallback
    const spec = buildSpec(block)
    // then the spawn proceeds byte-identical to the no-memory path
    expect(catches).toBe(1)
    expect(spec).toEqual(buildSpec(undefined))
  })

  test("#given env-mismatched records filtered out #when building the spec #then filtered reads as absent", () => {
    // given retrieved records all filtered by an environment mismatch
    // (ENV-CHANGE: filtered before the block is built, never marked)
    const retrieved = [
      { record: knowledgeRecord({ id: "pk-env-1" }), runScope: "staging" },
      { record: knowledgeRecord({ id: "pk-env-2" }), runScope: "staging" },
    ]
    const eligible = retrieved.filter((entry) => entry.runScope === "production").map((entry) => entry.record)
    // when the spec is built from the eligible set
    const spec = buildSpec({ records: eligible })
    // then the worker cannot distinguish filtered from absent
    expect(eligible).toHaveLength(0)
    expect(spec).toEqual(buildSpec(undefined))
    expect(spec.prompt.includes("pk-env-1")).toBe(false)
  })
})
