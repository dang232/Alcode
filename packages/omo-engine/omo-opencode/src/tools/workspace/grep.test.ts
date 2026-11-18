import { afterAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { WorkspaceToolError } from "./errors.ts"
import { GREP_TOOL_NAME, createWorkspaceGrepTool } from "./grep.ts"

const roots: string[] = []

function workspace() {
  const base = mkdtempSync(join(tmpdir(), "omo-workspace-grep-"))
  roots.push(base)
  const root = join(base, "project")
  const outside = join(base, "outside")
  mkdirSync(join(root, "src"), { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(root, "notes.txt"), "alpha one\nbeta two\nalpha three\n", "utf8")
  writeFileSync(join(root, "src", "code.ts"), "const alpha = 1;\n// beta marker\n", "utf8")
  writeFileSync(join(outside, "secret.txt"), "alpha secret\n", "utf8")
  return { root, outside }
}

type GrepArgs = { pattern: string; path?: string; literal?: boolean; maxResults?: number };

const grep = async (root: string, args: GrepArgs): Promise<string> => {
  const tool = createWorkspaceGrepTool({ directory: root })
  // SAFETY: GrepArgs is the subset of tool arguments this helper passes; the tool validates them.
  return (await tool.execute(args as never)) as string
}

const refusalOf = async (root: string, args: GrepArgs): Promise<WorkspaceToolError> => {
  try {
    await grep(root, args)
  } catch (error) {
    if (error instanceof WorkspaceToolError) return error
    throw error
  }
  throw new Error("expected the grep tool to refuse")
}

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("native grep tool", () => {
  it("is advertised under the name the catalog publishes", () => {
    expect(GREP_TOOL_NAME).toBe("grep")
    const tool = createWorkspaceGrepTool({ directory: tmpdir() })
    expect(tool.args.properties).toHaveProperty("pattern")
  })

  it("finds matches as path:line rows under a header", async () => {
    const { root } = workspace()
    const result = await grep(root, { pattern: "alpha" })
    expect(result).toContain("match(es) in")
    expect(result).toContain("notes.txt:1: alpha one")
    expect(result).toContain(`${join("src", "code.ts")}:1: const alpha = 1;`)
  })

  it("never leaves the workspace", async () => {
    const { root } = workspace()
    const result = await grep(root, { pattern: "alpha" })
    expect(result).not.toContain("secret")
  })

  it("matches literally when asked, without regex surprises", async () => {
    const { root } = workspace()
    writeFileSync(join(root, "dots.txt"), "a.c\nabc\n", "utf8")
    const literal = await grep(root, { pattern: "a.c", literal: true })
    expect(literal).toContain("dots.txt:1: a.c")
    expect(literal).not.toContain("dots.txt:2: abc")
  })

  it("refuses an invalid regular expression by naming it", async () => {
    const { root } = workspace()
    const error = await refusalOf(root, { pattern: "([unclosed" })
    expect(error.code).toBe("INVALID_INPUT")
  })

  it("refuses a traversal that leaves the workspace", async () => {
    const { root } = workspace()
    const error = await refusalOf(root, { pattern: "alpha", path: "../outside" })
    expect(error.code).toBe("PATH_OUTSIDE_WORKSPACE")
  })

  it("skips a linked directory instead of following it out", async () => {
    const { root, outside } = workspace()
    symlinkSync(outside, join(root, "escape"), "junction")
    const result = await grep(root, { pattern: "alpha" })
    expect(result).not.toContain("secret")
    expect(result).toContain("link(s) skipped")
  })

  it("caps the result list and says so", async () => {
    const { root } = workspace()
    const result = await grep(root, { pattern: "alpha", maxResults: 1 })
    const rows = result.split("\n").filter((line) => line.includes(":") && line.includes("alpha"))
    expect(rows).toHaveLength(1)
    expect(result).toContain("1 match(es)")
  })

  it("refuses a missing scope instead of answering empty", async () => {
    const { root } = workspace()
    const error = await refusalOf(root, { pattern: "alpha", path: "nope.txt" })
    expect(error.code).toBe("NOT_FOUND")
  })
})
