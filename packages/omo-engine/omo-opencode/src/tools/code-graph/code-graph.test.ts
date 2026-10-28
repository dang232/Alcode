/**
 * code-graph.test.ts — the `code_graph` native tool over a real temp repo.
 *
 * Every case drives the real engine (or the cheap status path) against a
 * temp directory holding at least one TypeScript file: valid args return a
 * JSON envelope with op/status/budget/unanswered, invalid args are refused
 * through the shared usage error, and `status` answers queryServable false
 * without indexing.
 */
import { describe, expect, it } from "bun:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CODE_GRAPH_NAME, createCodeGraphTool } from "./code-graph.ts"

const TEST_TIMEOUT_MS = 60000

async function makeTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "code-graph-tool-"))
  await writeFile(
    join(dir, "math.ts"),
    "export function add(left: number, right: number): number {\n  return left + right\n}\n\nexport function double(value: number): number {\n  return add(value, value)\n}\n",
  )
  return dir
}

async function dispose(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  )
}

describe("code_graph tool", () => {
  it(
    "#given valid search args #when executed #then the JSON envelope carries op, status, budget, unanswered",
    async () => {
      const dir = await makeTempRepo()
      try {
        const tool = createCodeGraphTool({ directory: dir })
        const raw = await tool.execute({ op: "search", subject: "add" })
        expect(typeof raw).toBe("string")
        const parsed = JSON.parse(raw as string) as Record<string, unknown>
        expect(parsed["op"]).toBe("search")
        expect(parsed["status"]).toBeDefined()
        expect(parsed["budget"]).toBeDefined()
        expect(Array.isArray(parsed["unanswered"])).toBe(true)
        expect(typeof parsed["text"]).toBe("string")
      } finally {
        await dispose(dir)
      }
    },
    TEST_TIMEOUT_MS,
  )

  it("#given an invalid op #when executed #then the call is refused, never thrown raw", async () => {
    const dir = await makeTempRepo()
    try {
      const tool = createCodeGraphTool({ directory: dir })
      const error = (await rejectionOf(tool.execute({ op: "nope" }))) as { code?: string } | undefined
      expect(error).toBeDefined()
      expect(error?.code).toBe("INVALID_INPUT")
    } finally {
      await dispose(dir)
    }
  })

  it("#given an out-of-range depth #when executed #then the call is refused", async () => {
    const dir = await makeTempRepo()
    try {
      const tool = createCodeGraphTool({ directory: dir })
      const error = (await rejectionOf(tool.execute({ op: "search", subject: "add", depth: 9 }))) as
        | { code?: string }
        | undefined
      expect(error).toBeDefined()
      expect(error?.code).toBe("INVALID_INPUT")
    } finally {
      await dispose(dir)
    }
  })

  it("#given a directory with no snapshot #when status runs #then queryServable is false without indexing", async () => {
    const dir = await makeTempRepo()
    try {
      const tool = createCodeGraphTool({ directory: dir })
      expect(CODE_GRAPH_NAME).toBe("code_graph")
      const raw = await tool.execute({ op: "status" })
      const parsed = JSON.parse(raw as string) as {
        op: string
        status: { coverage: string; queryServable: boolean }
        unanswered: readonly string[]
      }
      expect(parsed.op).toBe("status")
      expect(parsed.status.queryServable).toBe(false)
      expect(parsed.status.coverage).toBe("unindexed")
      expect(parsed.unanswered).toEqual(["GRAPH_UNAVAILABLE"])
    } finally {
      await dispose(dir)
    }
  })

  it("#given a bare symbol name #when context runs #then the name resolves to a node id with evidence", async () => {
    const dir = await makeTempRepo()
    try {
      const tool = createCodeGraphTool({ directory: dir })
      const parsed = JSON.parse(await tool.execute({ op: "context", subjectKind: "symbol", subject: "add", depth: 1 }) as string) as {
        items: readonly { id: string; evidence: readonly { ref: string }[] }[]
      }
      expect(parsed.items.length).toBeGreaterThan(0)
      expect(parsed.items.every((item) => item.id.includes("@") || item.id.startsWith("file:"))).toBe(true)
      expect(parsed.items.some((item) => item.evidence.length > 0)).toBe(true)
    } finally {
      await dispose(dir)
    }
  })

  it("#given a changed file #when impact runs with subjectKind changes #then callers are found without a subject", async () => {
    const dir = await makeTempRepo()
    try {
      await writeFile(join(dir, "caller.ts"), "import { add } from './math'\nexport const total = add(1, 2)\n")
      await Bun.$`git init -q .`.cwd(dir).quiet()
      await Bun.$`git add -A`.cwd(dir).quiet()
      await writeFile(join(dir, "caller.ts"), "import { add } from './math'\nexport const total = add(2, 3)\n")
      const tool = createCodeGraphTool({ directory: dir })
      const parsed = JSON.parse(await tool.execute({ op: "impact", subjectKind: "changes", depth: 1 }) as string) as {
        items: readonly { id: string }[]
        subjects: readonly { kind: string }[]
        status: { queryServable: boolean }
      }
      expect(parsed.status.queryServable).toBe(true)
      expect(parsed.subjects[0]?.kind).toBe("changes")
      expect(parsed.items.length).toBeGreaterThan(0)
    } finally {
      await dispose(dir)
    }
  })
})
