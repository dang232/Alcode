import { afterAll, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { WorkspaceToolError } from "./errors.ts"
import { WRITE_TOOL_NAME, createWorkspaceWriteTool } from "./write.ts"

const roots: string[] = []

function workspace() {
  const base = mkdtempSync(join(tmpdir(), "omo-workspace-write-"))
  roots.push(base)
  const root = join(base, "project")
  const outside = join(base, "outside")
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(root, "existing.txt"), "before\n", "utf8")
  return { root, outside }
}

type WriteArgs = { path: string; content: string; expectedDigest?: string };

const write = async (root: string, args: WriteArgs): Promise<string> => {
  const tool = createWorkspaceWriteTool({ directory: root })
  // SAFETY: WriteArgs is the subset of tool arguments this helper passes; the tool validates them.
  return (await tool.execute(args as never)) as string
}

const refusalOf = async (root: string, args: WriteArgs): Promise<WorkspaceToolError> => {
  try {
    await write(root, args)
  } catch (error) {
    if (error instanceof WorkspaceToolError) return error
    throw error
  }
  throw new Error("expected the write tool to refuse")
}

const digest = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe("native write tool", () => {
  it("is advertised under the name the catalog publishes", () => {
    expect(WRITE_TOOL_NAME).toBe("write")
    expect(createWorkspaceWriteTool({ directory: tmpdir() }).args.properties).toHaveProperty("content")
  })

  it("creates a real file on disk and reports its digest", async () => {
    const { root } = workspace()
    const result = await write(root, { path: "nested/new.txt", content: "hello\n" })
    expect(result).toContain("created nested/new.txt")
    expect(readFileSync(join(root, "nested", "new.txt"), "utf8")).toBe("hello\n")
    expect(result).toContain(digest("hello\n"))
  })

  it("replaces an existing file and reports unchanged on an identical rewrite", async () => {
    const { root } = workspace()
    await write(root, { path: "existing.txt", content: "after\n" })
    expect(readFileSync(join(root, "existing.txt"), "utf8")).toBe("after\n")
    const again = await write(root, { path: "existing.txt", content: "after\n" })
    expect(again).toContain("unchanged existing.txt")
  })

  it("refuses a stale overwrite when the expected digest does not match", async () => {
    const { root } = workspace()
    const error = await refusalOf(root, { path: "existing.txt", content: "x", expectedDigest: digest("something else") })
    expect(error.code).toBe("INVALID_INPUT")
    expect(readFileSync(join(root, "existing.txt"), "utf8")).toBe("before\n")
  })

  it("accepts the write when the expected digest matches the current content", async () => {
    const { root } = workspace()
    const result = await write(root, { path: "existing.txt", content: "guarded\n", expectedDigest: digest("before\n") })
    expect(result).toContain("updated existing.txt")
    expect(readFileSync(join(root, "existing.txt"), "utf8")).toBe("guarded\n")
  })

  it("refuses a traversal, an absolute outside path and a junction escape", async () => {
    const { root, outside } = workspace()
    expect((await refusalOf(root, { path: "../outside/x.txt", content: "no" })).code).toBe("PATH_OUTSIDE_WORKSPACE")
    expect((await refusalOf(root, { path: join(outside, "x.txt"), content: "no" })).code).toBe("PATH_OUTSIDE_WORKSPACE")
    symlinkSync(outside, join(root, "escape"), "junction")
    expect((await refusalOf(root, { path: "escape/x.txt", content: "no" })).code).toBe("PATH_OUTSIDE_WORKSPACE")
    expect(existsSync(join(outside, "x.txt"))).toBe(false)
  })

  it("refuses content over the bound and a blank path", async () => {
    const { root } = workspace()
    expect((await refusalOf(root, { path: "big.txt", content: "x".repeat(2 * 1024 * 1024 + 1) })).code).toBe("INVALID_INPUT")
    expect((await refusalOf(root, { path: "", content: "x" })).code).toBe("INVALID_INPUT")
  })
})

describe("per-invocation workspace", () => {
  it("writes into the caller's directory, not the load-time one", async () => {
    const { root } = workspace()
    const caller = mkdtempSync(join(tmpdir(), "omo-workspace-write-caller-"))
    roots.push(caller)
    const tool = createWorkspaceWriteTool({ directory: root })
    // SAFETY: the harness calls execute with the tool's own argument shape plus a host context.
    const result = (await tool.execute({ path: "note.txt", content: "caller\n" } as never, { directory: caller } as never)) as string
    expect(result).toContain("created note.txt")
    expect(readFileSync(join(caller, "note.txt"), "utf8")).toBe("caller\n")
    expect(existsSync(join(root, "note.txt"))).toBe(false)
  })
})
