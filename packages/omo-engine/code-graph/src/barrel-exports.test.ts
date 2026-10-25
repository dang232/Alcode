import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as api from "./index"
import type { QueryOptions } from "./index"

const PROJECT_ID = "demo-12345678"
const WORKTREE_ID = "wt-barrel-test"
const REVISION = "a".repeat(40)
const TEST_TIMEOUT_MS = 60000

let dir: string | undefined

afterEach(() => {
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true })
    dir = undefined
  }
})

function options(): QueryOptions {
  return {
    scope: {
      projectId: PROJECT_ID,
      worktreeId: WORKTREE_ID,
      revision: REVISION,
      fingerprint: api.computeScopeFingerprint(PROJECT_ID, WORKTREE_ID, REVISION),
    },
  }
}

describe("code-graph barrel exports", () => {
  test("#given the public barrel #when inspected #then it exposes the documented API", () => {
    expect(api.indexFiles).toBeTypeOf("function")
    expect(api.symbolContext).toBeTypeOf("function")
    expect(api.impact).toBeTypeOf("function")
    expect(api.trace).toBeTypeOf("function")
    expect(api.findTests).toBeTypeOf("function")
    expect(api.detectChanges).toBeTypeOf("function")
    expect(api.search).toBeTypeOf("function")
    expect(api.scopeFromBaseline).toBeTypeOf("function")
    expect(api.loadOrRebuild).toBeTypeOf("function")
    expect(api.WorktreeGraphCache).toBeTypeOf("function")
    expect(api.DEFAULT_RESULT_LIMIT).toBe(20)
  })

  test(
    "#given a two-file fixture indexed through the barrel #when symbolContext runs #then the b.ts caller is listed",
    () => {
      // given: a.ts defines add, b.ts imports and calls it
      dir = mkdtempSync(join(tmpdir(), "code-graph-barrel-"))
      const aPath = join(dir, "a.ts")
      const bPath = join(dir, "b.ts")
      writeFileSync(aPath, "export function add(a: number, b: number) { return a + b }\n")
      writeFileSync(
        bPath,
        "import { add } from \"./a\"\n\nexport function run(): number {\n  return add(1, 2)\n}\n",
      )
      const snapshot = api.indexFiles([aPath, bPath])

      // when
      const result = api.symbolContext(snapshot, "fn:add@a.ts", options())

      // then: the b.ts caller resolves through the barrel query
      expect(result.definition?.id).toBe("fn:add@a.ts")
      expect(result.callers.map((caller) => caller.id)).toContain("fn:run@b.ts")
    },
    TEST_TIMEOUT_MS,
  )
})
