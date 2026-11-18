import { afterAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { WorkspaceToolError } from "./errors.ts"
import { GLOB_TOOL_NAME, createWorkspaceGlobTool } from "./glob.ts"

const roots: string[] = []

function workspace() {
  const base = mkdtempSync(join(tmpdir(), "omo-workspace-glob-"))
  roots.push(base)
  const root = join(base, "project")
  const outside = join(base, "outside")
  mkdirSync(join(root, "src", "nested"), { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(root, "notes.txt"), "x", "utf8")
  writeFileSync(join(root, "src", "code.ts"), "x", "utf8")
  writeFileSync(join(root, "src", "nested", "deep.ts"), "x", "utf8")
  writeFileSync(join(outside, "secret.txt"), "x", "utf8")
  return { root, outside }
}

type GlobArgs = { pattern: string; path?: string; maxResults?: number };

const glob = async (root: string, args: GlobArgs): Promise<string> => {
  const tool = createWorkspaceGlobTool({ directory: root })
  // SAFETY: GlobArgs is the subset of tool arguments this helper passes; the tool validates them.
  return (await tool.execute(args as never)) as string
}

const refusalOf = async (root: string, args: GlobArgs): Promise<WorkspaceToolError> => {
  try {
    await glob(root, args)
  } catch (error) {
    if (error instanceof WorkspaceToolError) return error
    throw error
  }
  throw new Error("expected the glob tool to refuse")
}

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("native glob tool", () => {
  it("is advertised under the name the catalog publishes", () => {
    expect(GLOB_TOOL_NAME).toBe("glob")
    const tool = createWorkspaceGlobTool({ directory: tmpdir() })
    expect(tool.args.properties).toHaveProperty("pattern")
  })

  it("matches star segments without crossing separators", async () => {
    const { root } = workspace()
    const result = await glob(root, { pattern: "*.txt" })
    expect(result).toContain("1 path(s)")
    expect(result).toContain("notes.txt")
    expect(result).not.toContain("code.ts")
  })

  it("crosses directories only on double star", async () => {
    const { root } = workspace()
    const direct = await glob(root, { pattern: "*.ts" })
    expect(direct).not.toContain("code.ts")
    const recursive = await glob(root, { pattern: "**/*.ts" })
    expect(recursive).toContain(join("src", "code.ts").split("\\").join("/"))
    expect(recursive).toContain(join("src", "nested", "deep.ts").split("\\").join("/"))
  })

  it("matches against the search scope, not the workspace root", async () => {
    const { root } = workspace()
    const scoped = await glob(root, { pattern: "*.ts", path: "src" })
    expect(scoped).toContain("1 path(s)")
    expect(scoped).toContain("code.ts")
    expect(scoped).not.toContain("notes.txt")

    const deep = await glob(root, { pattern: "*.ts", path: "src/nested" })
    expect(deep).toContain("1 path(s)")
    expect(deep).toContain("deep.ts")
  })

  it("never leaves the workspace", async () => {
    const { root } = workspace()
    const result = await glob(root, { pattern: "**/*.txt" })
    expect(result).not.toContain("secret")
  })

  it("skips a linked directory instead of following it out", async () => {
    const { root, outside } = workspace()
    symlinkSync(outside, join(root, "escape"), "junction")
    const result = await glob(root, { pattern: "**/*.txt" })
    expect(result).not.toContain("secret")
    expect(result).toContain("link(s) skipped")
  })

  it("caps the result list and says so", async () => {
    const { root } = workspace()
    const result = await glob(root, { pattern: "**/*.ts", maxResults: 1 })
    expect(result).toContain("1 path(s)")
  })

  it("refuses a traversal that leaves the workspace", async () => {
    const { root } = workspace()
    const error = await refusalOf(root, { pattern: "*.txt", path: "../outside" })
    expect(error.code).toBe("PATH_OUTSIDE_WORKSPACE")
  })

  it("refuses a missing scope instead of answering empty", async () => {
    const { root } = workspace()
    const error = await refusalOf(root, { pattern: "*.txt", path: "nope" })
    expect(error.code).toBe("NOT_FOUND")
  })

  it("reaches a shallow match before descending a directory that sorts first", async () => {
    const { root } = workspace()
    writeFileSync(join(root, "zzz.md"), "x", "utf8")
    mkdirSync(join(root, "aaa"), { recursive: true })
    writeFileSync(join(root, "aaa", "inner.md"), "x", "utf8")

    const listed = await glob(root, { pattern: "**/*.md" })
    const order = listed.split("\n").filter((line) => line.endsWith(".md"))

    // Depth-first descent would walk aaa/ entirely before zzz.md; breadth-first
    // keeps the shallow file first, which is what makes a capped root scan
    // answer instead of returning nothing.
    expect(order.indexOf("zzz.md")).toBeGreaterThan(-1)
    expect(order.indexOf("zzz.md")).toBeLessThan(order.indexOf("aaa/inner.md"))
  })
})
