import { describe, expect, test } from "bun:test"
import type { TaskUnderstanding, UnderstandingChange, UnderstandingSymbol } from "./types"
import { affectedTestPaths, selectImpactAwareChecks } from "./verification-plan"
import {
  selectVerificationChecks,
  type DagChangeScope,
  type DagVerifyCheck,
} from "../verification"

function symbol(file: string, id: string): UnderstandingSymbol {
  return {
    id,
    file,
    line: 1,
    confidence: 1,
    knowledgeIds: [],
    sources: ["findTests"],
  }
}

function change(file: string, id: string): UnderstandingChange {
  return {
    id,
    file,
    line: 1,
    cause: "edit",
    confidence: 1,
  }
}

function understanding(overrides: Partial<TaskUnderstanding> = {}): TaskUnderstanding {
  return {
    scope: { projectId: "p", worktreeId: "w", revision: "rev-1", fingerprint: "fp" },
    freshness: "fresh",
    symbols: [],
    advisorySymbols: [],
    impacted: [],
    tests: [],
    changes: [],
    constraints: [],
    uncertainties: [],
    queries: [],
    usableForCaution: true,
    truncated: false,
    truncationReasons: [],
    ...overrides,
  }
}

function check(overrides: Partial<DagVerifyCheck> = {}): DagVerifyCheck {
  return {
    checkId: "check-1",
    category: "unit",
    command: ["bun", "test"],
    timeoutMs: 30_000,
    criteria: ["AC-1"],
    ...overrides,
  }
}

function scope(overrides: Partial<DagChangeScope> = {}): DagChangeScope {
  return {
    changedFiles: [],
    touchesScheduler: false,
    touchesCompletionGate: false,
    touchesWorkerLifecycle: false,
    touchesPersistedState: false,
    isDocsOnly: false,
    ...overrides,
  }
}

describe("given a usable understanding with tests and changes, when collecting affected test paths", () => {
  test("then it returns sorted unique paths with pattern filtering", () => {
    const seen = understanding({
      usableForCaution: true,
      tests: [symbol("src/b.test.ts", "t-b"), symbol("src/a.spec.ts", "t-a"), symbol("src/b.test.ts", "t-b-dup")],
      changes: [
        change("src/c.test.tsx", "c-1"),
        change("src/plain.ts", "c-2"),
        change("src/d.spec.mjs", "c-3"),
        change("src/notes.test.md", "c-4"),
        change("src/e.test.cjs", "c-5"),
      ],
    })
    expect(affectedTestPaths(seen)).toEqual([
      "src/a.spec.ts",
      "src/b.test.ts",
      "src/c.test.tsx",
      "src/d.spec.mjs",
      "src/e.test.cjs",
    ])
  })
})

describe("given an unusable understanding, when collecting affected test paths", () => {
  test("then it returns an empty list", () => {
    const seen = understanding({
      usableForCaution: false,
      tests: [symbol("src/a.test.ts", "t-a")],
      changes: [change("src/b.test.ts", "c-1")],
    })
    expect(affectedTestPaths(seen)).toEqual([])
  })
})

describe("given a usable understanding with no test evidence, when collecting affected test paths", () => {
  test("then it returns an empty list", () => {
    const seen = understanding({
      usableForCaution: true,
      tests: [],
      changes: [change("src/plain.ts", "c-1")],
    })
    expect(affectedTestPaths(seen)).toEqual([])
  })
})

describe("given a scope and available checks, when the understanding adds no affected paths", () => {
  test("then the impact-aware selection preserves the base selection exactly", () => {
    const current = scope({ touchesScheduler: true })
    const available = [
      check({ checkId: "unit-core", category: "unit", command: ["bun", "test", "src/unit.test.ts"] }),
      check({ checkId: "type-core", category: "typecheck", command: ["bunx", "tsc", "--noEmit"] }),
      check({ checkId: "build-core", category: "build", command: ["bun", "run", "build"] }),
      check({ checkId: "schema-core", category: "schema", command: ["bun", "run", "schema"] }),
    ]
    const seen = understanding({ usableForCaution: true, tests: [], changes: [] })
    const base = selectVerificationChecks(current, available)
    const result = selectImpactAwareChecks({ scope: current, available, understanding: seen })
    expect(result.required.map((entry) => entry.checkId)).toEqual(base.required.map((entry) => entry.checkId))
    expect(result.required).toEqual(base.required)
    expect(result.omitted).toEqual(base.omitted)
    expect(base.required.map((entry) => entry.checkId)).toEqual(["unit-core", "type-core", "build-core"])
    expect(base.omitted.map((entry) => entry.check.checkId)).toEqual(["schema-core"])
  })
})

describe("given an affected test path, when an omitted check mentions it", () => {
  test("then it is appended once after base required checks and removed from omitted", () => {
    const current = scope()
    const available = [
      check({ checkId: "unit-core", category: "unit", command: ["bun", "test", "src/unit.test.ts"] }),
      check({ checkId: "type-core", category: "typecheck", command: ["bunx", "tsc", "--noEmit"] }),
      check({ checkId: "schema-affected", category: "schema", command: ["bun", "test", "src/affected.test.ts"] }),
      check({ checkId: "schema-other", category: "schema", command: ["bun", "test", "src/other.ts"] }),
    ]
    const seen = understanding({
      usableForCaution: true,
      tests: [symbol("src/affected.test.ts", "t-1")],
      changes: [],
    })
    const base = selectVerificationChecks(current, available)
    expect(base.required.map((entry) => entry.checkId)).toEqual(["unit-core", "type-core"])
    expect(base.omitted.map((entry) => entry.check.checkId)).toEqual(["schema-affected", "schema-other"])
    const result = selectImpactAwareChecks({ scope: current, available, understanding: seen })
    expect(result.required.map((entry) => entry.checkId)).toEqual(["unit-core", "type-core", "schema-affected"])
    expect(result.required.slice(0, 2)).toEqual([...base.required])
    expect(result.omitted.map((entry) => entry.check.checkId)).toEqual(["schema-other"])
    expect(result.required.filter((entry) => entry.checkId === "schema-affected")).toHaveLength(1)
  })
})

describe("given an affected test path, when a check mentions only its basename", () => {
  test("then it is still required", () => {
    const current = scope()
    const available = [
      check({ checkId: "unit-core", category: "unit", command: ["bun", "test"] }),
      check({ checkId: "schema-base", category: "schema", command: ["bun", "test", "affected.test.ts"] }),
    ]
    const seen = understanding({
      usableForCaution: true,
      tests: [symbol("src/nested/affected.test.ts", "t-1")],
      changes: [],
    })
    const result = selectImpactAwareChecks({ scope: current, available, understanding: seen })
    expect(result.required.map((entry) => entry.checkId)).toEqual(["unit-core", "schema-base"])
    expect(result.omitted).toEqual([])
  })
})

describe("given an affected test path, when a check command is unrelated", () => {
  test("then it stays omitted", () => {
    const current = scope()
    const available = [
      check({ checkId: "unit-core", category: "unit", command: ["bun", "test"] }),
      check({ checkId: "schema-unrelated", category: "schema", command: ["bun", "run", "schema-check"] }),
    ]
    const seen = understanding({
      usableForCaution: true,
      tests: [symbol("src/affected.test.ts", "t-1")],
      changes: [],
    })
    const result = selectImpactAwareChecks({ scope: current, available, understanding: seen })
    expect(result.required.map((entry) => entry.checkId)).toEqual(["unit-core"])
    expect(result.omitted.map((entry) => entry.check.checkId)).toEqual(["schema-unrelated"])
  })
})

describe("given an unusable understanding, when selecting impact-aware checks", () => {
  test("then it returns the base selection unchanged", () => {
    const current = scope()
    const available = [
      check({ checkId: "unit-core", category: "unit", command: ["bun", "test"] }),
      check({ checkId: "schema-affected", category: "schema", command: ["bun", "test", "src/affected.test.ts"] }),
    ]
    const seen = understanding({
      usableForCaution: false,
      tests: [symbol("src/affected.test.ts", "t-1")],
      changes: [],
    })
    const base = selectVerificationChecks(current, available)
    const result = selectImpactAwareChecks({ scope: current, available, understanding: seen })
    expect(result).toEqual(base)
    expect(result.required.map((entry) => entry.checkId)).toEqual(["unit-core"])
    expect(result.omitted.map((entry) => entry.check.checkId)).toEqual(["schema-affected"])
  })
})
