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
import { z } from "zod"

import { execFile } from "node:child_process"
import { CODE_GRAPH_NAME, createCodeGraphTool } from "./code-graph.ts"
import type { CanonicalAnswer, CanonicalRuntime, CanonicalSummary } from "./canonical-runtime.ts"
import type { OmoToolOutcome } from "../../plugin-types.ts"
import type { CoverageStatus } from "../../../../code-graph/src/index.ts"
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
  status: { coverage: string; queryServable: boolean; generation?: number; reasons: readonly string[] }
  subjects: readonly { kind: string }[]
  items: readonly { id: string; name?: string; confidence?: number; evidence: readonly { ref: string }[] }[]
  unanswered: readonly string[]
  unresolved: readonly { reason: string }[]
  text: string
  budget: { readonly maxBytes: number; readonly bytes: number; readonly estimatedTokens: number; readonly truncatedBy: string }
  explore: {
    subject: string
    definitions: readonly { id: string; file: string; line: number }[]
    bodies: readonly { file: string; bodies: readonly { id: string; startLine: number; truncated: boolean; lines: readonly { line: number; text: string }[] }[] }[]
    paths: readonly { from: string; to: string; found: boolean; hops: readonly { from: string; to: string; ref: string }[]; blockedByDynamic: boolean }[]
    impacted: readonly { id: string }[]
    blastRadius: { subjectIds: readonly string[]; dependentFiles: number; dependentSymbols: number; modules: readonly { module: string }[]; testsFound: number }
  }
}

const OutcomeTextSchema = z.string()

/** Tool answers are JSON strings; anything else fails the test loudly. */
const textOf = (outcome: OmoToolOutcome): string => {
  const parsed = OutcomeTextSchema.safeParse(outcome)
  if (!parsed.success) throw new Error("code_graph execute must answer its JSON string envelope")
  return parsed.data
}

const parseEnvelope = (outcome: OmoToolOutcome): ParsedEnvelope => {
  // SAFETY: textOf guarantees the JSON string the tool rendered; ParsedEnvelope names the
  // fields this suite reads, and every access below stays inside those fields.
  const parsed = JSON.parse(textOf(outcome)) as ParsedEnvelope
  return parsed
}

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

const fakeEnvelope = (ids: readonly string[], coverage: CoverageStatus = "indexed"): CanonicalAnswer["envelope"] => ({
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
    confidence: 1,
    evidence: [],
    knowledgeIds: [],
  })),
  totals: { displayed: ids.length, known: ids.length, hidden: 0 },
  completeness: "complete",
})

const fakeAnswer = (ids: readonly string[], generation: number | null = 5, coverage: CoverageStatus = "indexed"): CanonicalAnswer => ({
  envelope: fakeEnvelope(ids, coverage),
  generation,
  freshness: "fresh",
  coverage,
  ready: true,
})

/** Refusal details the tool raises through refuseArgs. */
interface RefusalDetails {
  readonly code?: string
}

const RefusalDetailsSchema = z.object({ code: z.string().optional() })

async function rejectionOf(promise: Promise<OmoToolOutcome>): Promise<RefusalDetails | undefined> {
  try {
    await promise
    return undefined
  } catch (cause) {
    const parsed = RefusalDetailsSchema.safeParse(cause)
    return parsed.success ? parsed.data : undefined
  }
}

describe("code_graph tool", () => {
  it(
    "#given valid search args #when executed #then the JSON envelope carries op, status, budget, unanswered",
    async () => {
      const dir = await makeTempRepo()
      const storeDir = await makeIsolatedStore()
      try {
        const tool = createCodeGraphTool({ directory: dir, storeDir })
        const parsed = parseEnvelope(await tool.execute({ op: "search", subject: "add" }))
        expect(parsed.op).toBe("search")
        expect(parsed.status).toBeDefined()
        expect(parsed.budget).toBeDefined()
        expect(Array.isArray(parsed.unanswered)).toBe(true)
        expect(parsed.text.length).toBeGreaterThan(0)
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
      const error = await rejectionOf(tool.execute({ op: "nope" }))
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
      const error = await rejectionOf(tool.execute({ op: "search", subject: "add", depth: 9 }))
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
      const parsed = parseEnvelope(await tool.execute({ op: "context", subjectKind: "symbol", subject: "add", depth: 1 }))
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
      const parsed = parseEnvelope(await tool.execute({ op: "impact", subjectKind: "changes", depth: 1 }))
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
      expect(Number.isFinite(first.status.generation)).toBe(true)
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
      )
      /** Raw panel answer shape: the envelope itself, not the canonical wrapper. */
      interface PanelAnswer {
        readonly items: readonly { readonly id: string }[]
      }
      const panel: PanelAnswer = await panelRuntime.query(dir, { kind: "search", query: "add", limit: 20 })
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

  it("#given a real repo #when explore runs #then one call returns bodies plus paths plus blast radius", async () => {
    const dir = await makeTempRepo()
    const storeDir = await makeIsolatedStore()
    try {
      await writeFile(
        join(dir, "caller.ts"),
        "import { add } from './math'\nexport const total = add(1, 2)\n",
      )
      const tool = createCodeGraphTool({ directory: dir, storeDir })
      const parsed = parseEnvelope(await tool.execute({ op: "explore", subject: "add" }))
      expect(parsed.status.queryServable).toBe(true)
      expect(parsed.status.reasons).toContain("composed-explore")
      // one call carries all three shapes
      expect(parsed.explore.subject).toBe("add")
      expect(parsed.explore.definitions.map((definition) => definition.id)).toEqual(["fn:add@math.ts"])
      const group = parsed.explore.bodies.find((entry) => entry.file === "math.ts")
      const body = group?.bodies.find((entry) => entry.id === "fn:add@math.ts")
      expect(body?.startLine).toBe(1)
      expect(body?.truncated).toBe(false)
      expect(body?.lines.slice(0, 3).map((entry) => `${entry.line}:${entry.text}`)).toEqual([
        "1:export function add(left: number, right: number): number {",
        "2:  return left + right",
        "3:}",
      ])
      expect(parsed.explore.paths.some((entry) => entry.found && entry.hops.length > 0)).toBe(true)
      const hop = parsed.explore.paths.flatMap((entry) => entry.hops).find((entry) => entry.to === "fn:add@math.ts")
      expect(["math.ts:6", "caller.ts:2"]).toContain(hop?.ref)
      expect(parsed.explore.blastRadius.subjectIds).toEqual(["fn:add@math.ts"])
      expect(parsed.explore.impacted.map((item) => item.id)).toContain("fn:double@math.ts")
      expect(parsed.explore.blastRadius.dependentSymbols).toBeGreaterThan(0)
      expect(parsed.explore.blastRadius.modules.length).toBeGreaterThan(0)
      expect(parsed.text).toContain("EXPLORE subject=add")
      for (const item of parsed.items) expect(item.confidence).toBe(1)
      expect(parsed.items.some((item) => item.id === "unknown")).toBe(false)
    } finally {
      await dispose(storeDir)
      await dispose(dir)
    }
  })

  it("#given one name on two files #when explore runs #then every definition returns its body", async () => {
    const dir = await makeTempRepo()
    const storeDir = await makeIsolatedStore()
    try {
      await writeFile(join(dir, "a.ts"), "export function foo(): number {\n  return 1;\n}\n")
      await writeFile(join(dir, "b.ts"), "export function foo(): number {\n  return 2;\n}\n")
      const tool = createCodeGraphTool({ directory: dir, storeDir })
      const parsed = parseEnvelope(await tool.execute({ op: "explore", subject: "foo" }))
      expect(parsed.explore.definitions.map((definition) => definition.id).sort()).toEqual([
        "fn:foo@a.ts",
        "fn:foo@b.ts",
      ])
      expect(parsed.explore.bodies.map((group) => group.file).sort()).toEqual(["a.ts", "b.ts"])
      expect(parsed.explore.bodies.find((group) => group.file === "a.ts")?.bodies[0]?.lines[1]?.text).toBe("  return 1;")
      expect(parsed.explore.bodies.find((group) => group.file === "b.ts")?.bodies[0]?.lines[1]?.text).toBe("  return 2;")
    } finally {
      await dispose(storeDir)
      await dispose(dir)
    }
  })

  it("#given only a dynamic call #when explore runs #then dynamics stay in unresolved with no guessed edge", async () => {
    const dir = await makeTempRepo()
    const storeDir = await makeIsolatedStore()
    try {
      await writeFile(
        join(dir, "dyn.ts"),
        "export function runDynamic(handlers: Record<string, () => number>, name: string): number {\n  const handler = handlers[name];\n  return handler();\n}\n",
      )
      const tool = createCodeGraphTool({ directory: dir, storeDir })
      const parsed = parseEnvelope(await tool.execute({ op: "explore", subject: "runDynamic" }))
      expect(parsed.explore.definitions.map((definition) => definition.id)).toEqual(["fn:runDynamic@dyn.ts"])
      expect(parsed.unresolved.some((entry) => entry.reason.includes("unknown callee"))).toBe(true)
      for (const entry of parsed.explore.paths) {
        expect(entry.hops.every((hop) => hop.to !== "unknown")).toBe(true)
      }
    } finally {
      await dispose(storeDir)
      await dispose(dir)
    }
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
