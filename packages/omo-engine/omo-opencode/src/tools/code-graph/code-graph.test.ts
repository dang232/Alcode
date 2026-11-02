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

import { execFile } from "node:child_process"
import { CODE_GRAPH_NAME, createCodeGraphTool } from "./code-graph.ts"
import type { CanonicalAnswer, CanonicalRuntime, CanonicalSummary } from "./canonical-runtime.ts"
import { createCodeGraphRuntime } from "../../../../../web/server/lib/code-graph/runtime.js"

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

async function makeIsolatedStore(): Promise<string> {
  return mkdtemp(join(tmpdir(), "code-graph-tool-store-"))
}

type ParsedEnvelope = {
  op: string
  status: { coverage: string; queryServable: boolean; generation?: number; reasons: string[] }
  subjects: readonly { kind: string }[]
  items: readonly { id: string; name?: string }[]
  unanswered: readonly string[]
  text: string
}

const parseEnvelope = (raw: unknown): ParsedEnvelope => JSON.parse(raw as string) as ParsedEnvelope

const fakeSummary = (overrides: Partial<CanonicalSummary> = {}): CanonicalSummary => ({
  ready: true,
  generation: 5,
  projectId: "project-test",
  worktreeId: "worktree-test",
  revision: "rev-test",
  fingerprint: "fp-test",
  freshness: "fresh",
  indexTruncated: false,
  nodeCount: 2,
  edgeCount: 1,
  entryCount: 1,
  entryCap: 5000,
  indexState: "ready",
  ...overrides,
})

const fakeEnvelope = (ids: readonly string[], coverage = "indexed"): CanonicalAnswer["envelope"] =>
  ({
    projectId: "project-test",
    worktreeId: "worktree-test",
    revision: "rev-test",
    fingerprint: "fp-test",
    freshness: "fresh",
    coverage,
    truncated: false,
    knowledgeIds: [],
    unresolved: [],
    unsupported: [],
    items: ids.map((id) => ({
      id,
      file: "math.ts",
      line: 1,
      name: id,
      verdict: "verified" as const,
      confidence: 1,
      evidence: [],
      knowledgeIds: [],
    })),
    totals: { displayed: ids.length, known: ids.length, hidden: 0 },
    completeness: "complete",
  }) as unknown as CanonicalAnswer["envelope"]

const fakeAnswer = (ids: readonly string[], generation: number | null = 5, coverage = "indexed"): CanonicalAnswer => ({
  envelope: fakeEnvelope(ids, coverage),
  generation,
  freshness: "fresh",
  coverage,
  ready: true,
})

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
      const storeDir = await makeIsolatedStore()
      try {
        const tool = createCodeGraphTool({ directory: dir, storeDir })
        const raw = await tool.execute({ op: "search", subject: "add" })
        expect(typeof raw).toBe("string")
        const parsed = JSON.parse(raw as string) as Record<string, unknown>
        expect(parsed["op"]).toBe("search")
        expect(parsed["status"]).toBeDefined()
        expect(parsed["budget"]).toBeDefined()
        expect(Array.isArray(parsed["unanswered"])).toBe(true)
        expect(typeof parsed["text"]).toBe("string")
      } finally {
        await dispose(storeDir)
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

  it("#given a directory with no snapshot #when status runs #then queryServable is false without blocking on a build", async () => {
    const dir = await makeTempRepo()
    const storeDir = await makeIsolatedStore()
    try {
      const tool = createCodeGraphTool({ directory: dir, storeDir })
      expect(CODE_GRAPH_NAME).toBe("code_graph")
      const raw = await tool.execute({ op: "status" })
      const parsed = parseEnvelope(raw)
      expect(parsed.op).toBe("status")
      expect(parsed.status.queryServable).toBe(false)
      expect(parsed.status.coverage).toBe("unindexed")
      expect(parsed.unanswered).toEqual(["GRAPH_UNAVAILABLE"])
    } finally {
      await dispose(storeDir)
      await dispose(dir)
    }
  })

  it("#given a bare symbol name #when context runs #then the name resolves to a node id with evidence", async () => {
    const dir = await makeTempRepo()
    const storeDir = await makeIsolatedStore()
    try {
      const tool = createCodeGraphTool({ directory: dir, storeDir })
      const parsed = JSON.parse(await tool.execute({ op: "context", subjectKind: "symbol", subject: "add", depth: 1 }) as string) as {
        items: readonly { id: string; evidence: readonly { ref: string }[] }[]
      }
      expect(parsed.items.length).toBeGreaterThan(0)
      expect(parsed.items.every((item) => item.id.includes("@") || item.id.startsWith("file:"))).toBe(true)
      expect(parsed.items.some((item) => item.evidence.length > 0)).toBe(true)
    } finally {
      await dispose(storeDir)
      await dispose(dir)
    }
  })

  it("#given a changed file #when impact runs with subjectKind changes #then callers are found without a subject", async () => {
    const dir = await makeTempRepo()
    const storeDir = await makeIsolatedStore()
    try {
      await writeFile(join(dir, "caller.ts"), "import { add } from './math'\nexport const total = add(1, 2)\n")
      await Bun.$`git init -q .`.cwd(dir).quiet()
      await Bun.$`git add -A`.cwd(dir).quiet()
      await writeFile(join(dir, "caller.ts"), "import { add } from './math'\nexport const total = add(2, 3)\n")
      const tool = createCodeGraphTool({ directory: dir, storeDir })
      const parsed = JSON.parse(await tool.execute({ op: "impact", subjectKind: "changes", depth: 1 }) as string) as {
        items: readonly { id: string }[]
        subjects: readonly { kind: string }[]
        status: { queryServable: boolean }
      }
      expect(parsed.status.queryServable).toBe(true)
      expect(parsed.subjects[0]?.kind).toBe("changes")
      expect(parsed.items.length).toBeGreaterThan(0)
    } finally {
      await dispose(storeDir)
      await dispose(dir)
    }
  })

  it("#given one indexed repo #when search runs twice #then both answers ride the same reused generation", async () => {
    const dir = await makeTempRepo()
    const storeDir = await makeIsolatedStore()
    try {
      const tool = createCodeGraphTool({ directory: dir, storeDir })
      const first = parseEnvelope(await tool.execute({ op: "search", subject: "add" }))
      const second = parseEnvelope(await tool.execute({ op: "search", subject: "double" }))
      expect(first.status.queryServable).toBe(true)
      expect(second.status.queryServable).toBe(true)
      expect(typeof first.status.generation).toBe("number")
      expect(second.status.generation).toBe(first.status.generation)
      const status = parseEnvelope(await tool.execute({ op: "status" }))
      expect(status.status.queryServable).toBe(true)
      expect(status.status.coverage).toBe("indexed")
      expect(status.status.generation).toBe(first.status.generation)
    } finally {
      await dispose(storeDir)
      await dispose(dir)
    }
  })

  it("#given a source edit #when search runs again #then the new generation answers, never a stale mix", async () => {
    const dir = await makeTempRepo()
    const storeDir = await makeIsolatedStore()
    try {
      const tool = createCodeGraphTool({ directory: dir, storeDir })
      const before = parseEnvelope(await tool.execute({ op: "search", subject: "double" }))
      expect(before.items.length).toBeGreaterThan(0)
      await writeFile(
        join(dir, "math.ts"),
        "export function triple(value: number): number {\n  return value * 3\n}\n",
      )
      const after = parseEnvelope(await tool.execute({ op: "search", subject: "triple" }))
      expect(after.items.length).toBeGreaterThan(0)
      expect(after.status.generation).not.toBe(before.status.generation)
      const gone = parseEnvelope(await tool.execute({ op: "search", subject: "double" }))
      expect(gone.status.generation).toBe(after.status.generation)
      expect(gone.items.length).toBe(0)
    } finally {
      await dispose(storeDir)
      await dispose(dir)
    }
  })

  it("#given one indexed repo #when agent and panel query together #then both resolve the same items", async () => {
    const dir = await makeTempRepo()
    const storeDir = await makeIsolatedStore()
    try {
      const tool = createCodeGraphTool({ directory: dir, storeDir })
      const agent = parseEnvelope(await tool.execute({ op: "search", subject: "add" }))
      const panelRuntime = createCodeGraphRuntime(
        { fsPromises: await import("node:fs/promises"), path: await import("node:path"), execFile },
        { storeDir, blockOnRead: false },
      ) as unknown as CanonicalRuntime
      const panel = (await panelRuntime.query(dir, { kind: "search", query: "add", limit: 20 })) as unknown as {
        items: readonly { id: string }[]
      }
      const agentIds = agent.items.map((item) => item.id).sort()
      const panelIds = panel.items.map((item) => item.id).sort()
      expect(agentIds).toEqual(panelIds)
    } finally {
      await dispose(storeDir)
      await dispose(dir)
    }
  })

  it("#given concurrent queries #when they run together #then they share one generation", async () => {
    const dir = await makeTempRepo()
    const storeDir = await makeIsolatedStore()
    try {
      const tool = createCodeGraphTool({ directory: dir, storeDir })
      const [first, second] = await Promise.all([
        tool.execute({ op: "search", subject: "add" }),
        tool.execute({ op: "search", subject: "double" }),
      ])
      expect(parseEnvelope(first).status.generation).toBe(parseEnvelope(second).status.generation)
    } finally {
      await dispose(storeDir)
      await dispose(dir)
    }
  })

  it("#given a partial canonical answer #when search runs #then partial coverage rides through honestly", async () => {
    const runtime: CanonicalRuntime = {
      readIndex: async () => fakeSummary(),
      query: async () => fakeAnswer(["fn:add@math.ts"], 5, "partial"),
    }
    const tool = createCodeGraphTool({ directory: "/nonexistent", runtime })
    const parsed = parseEnvelope(await tool.execute({ op: "search", subject: "add" }))
    expect(parsed.status.queryServable).toBe(true)
    expect(parsed.status.coverage).toBe("partial")
    expect(parsed.status.generation).toBe(5)
  })

  it("#given a failing canonical service #when search runs #then the answer is unavailable, never empty", async () => {
    const runtime: CanonicalRuntime = {
      readIndex: async () => {
        throw new Error("store gone")
      },
      query: async () => {
        throw new Error("unreachable")
      },
    }
    const tool = createCodeGraphTool({ directory: "/nonexistent", runtime })
    const parsed = parseEnvelope(await tool.execute({ op: "search", subject: "add" }))
    expect(parsed.status.queryServable).toBe(false)
    expect(parsed.items).toEqual([])
    expect(parsed.unanswered).toEqual(["GRAPH_UNAVAILABLE"])
  })

  it("#given a generation change mid-operation #when search runs #then the operation restarts once and says so", async () => {
    let reads = 0
    const runtime: CanonicalRuntime = {
      readIndex: async () => {
        reads += 1
        return fakeSummary({ generation: reads === 1 ? 5 : 6 })
      },
      query: async () => fakeAnswer(["fn:add@math.ts"], 6),
    }
    const tool = createCodeGraphTool({ directory: "/nonexistent", runtime })
    const parsed = parseEnvelope(await tool.execute({ op: "search", subject: "add" }))
    expect(parsed.status.queryServable).toBe(true)
    expect(parsed.status.generation).toBe(6)
    expect(parsed.status.reasons).toContain("generation-changed-restarted")
  })
})
