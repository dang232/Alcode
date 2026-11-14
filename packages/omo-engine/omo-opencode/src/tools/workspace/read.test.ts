import { afterAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { WorkspaceToolError } from "./errors.ts"
import { READ_TOOL_NAME, createWorkspaceReadTool } from "./read.ts"

const roots: string[] = []

function workspace(): { root: string; outside: string } {
  const base = mkdtempSync(join(tmpdir(), "omo-workspace-read-"))
  roots.push(base)
  const root = join(base, "project")
  const outside = join(base, "outside")
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(root, "notes.txt"), "alpha\nbeta\ngamma\ndelta\n", "utf8")
  writeFileSync(join(outside, "secret.txt"), "not yours\n", "utf8")
  return { root, outside }
}

const read = async (root: string, args: Record<string, unknown>): Promise<string> => {
  const tool = createWorkspaceReadTool({ directory: root })
  return (await tool.execute(args as never)) as string
}

const refusalOf = async (root: string, args: Record<string, unknown>): Promise<WorkspaceToolError> => {
  try {
    await read(root, args)
  } catch (error) {
    if (error instanceof WorkspaceToolError) return error
    throw error
  }
  throw new Error("expected the read tool to refuse")
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe("native read tool", () => {
  it("is advertised under the name the catalog publishes", () => {
    expect(READ_TOOL_NAME).toBe("read")
    const tool = createWorkspaceReadTool({ directory: tmpdir() })
    expect(tool.args.properties).toHaveProperty("path")
  })

  it("returns a bounded line range of a real workspace file", async () => {
    const { root } = workspace()
    const whole = await read(root, { path: "notes.txt" })
    expect(whole).toContain("alpha")
    expect(whole).toContain("lines 1-4 of 4")
    const slice = await read(root, { path: "notes.txt", offset: 1, limit: 2 })
    expect(slice).toContain("beta")
    expect(slice).toContain("gamma")
    expect(slice).not.toContain("alpha")
  })

  it("refuses a traversal that leaves the workspace", async () => {
    const { root } = workspace()
    const error = await refusalOf(root, { path: "../outside/secret.txt" })
    expect(error.code).toBe("PATH_OUTSIDE_WORKSPACE")
  })

  it("refuses an absolute path outside the workspace", async () => {
    const { root, outside } = workspace()
    const error = await refusalOf(root, { path: join(outside, "secret.txt") })
    expect(error.code).toBe("PATH_OUTSIDE_WORKSPACE")
  })

  it("refuses a junction that resolves outside the workspace", async () => {
    const { root, outside } = workspace()
    symlinkSync(outside, join(root, "escape"), "junction")
    const error = await refusalOf(root, { path: "escape/secret.txt" })
    expect(error.code).toBe("PATH_OUTSIDE_WORKSPACE")
  })

  it("refuses a traversal to a path that does not exist, before any stat", async () => {
    const { root } = workspace()
    const error = await refusalOf(root, { path: "../absent-and-outside.txt" })
    expect(error.code).toBe("PATH_OUTSIDE_WORKSPACE")
  })

  it("refuses a missing file and a directory with distinct codes", async () => {
    const { root } = workspace()
    expect((await refusalOf(root, { path: "absent.txt" })).code).toBe("NOT_FOUND")
    expect((await refusalOf(root, { path: "." })).code).toBe("NOT_A_FILE")
  })

  it("refuses binary content instead of returning mojibake", async () => {
    const { root } = workspace()
    writeFileSync(join(root, "blob.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x00, 0x47]))
    expect((await refusalOf(root, { path: "blob.bin" })).code).toBe("BINARY_CONTENT")
  })

  it("applies the byte bound even when a range is requested", async () => {
    const { root } = workspace()
    const huge = join(root, "huge.txt")
    writeFileSync(huge, "x".repeat(8 * 1024 * 1024 + 1), "utf8")
    const error = await refusalOf(root, { path: "huge.txt", offset: 0, limit: 10 })
    expect(error.code).toBe("TOO_LARGE")
  })

  it("refuses an offset past the last line instead of returning an empty success", async () => {
    const { root } = workspace()
    const error = await refusalOf(root, { path: "notes.txt", offset: 99 })
    expect(error.code).toBe("INVALID_INPUT")
  })

  it("refuses invalid arguments with the caller-fixable code", async () => {
    const { root } = workspace()
    expect((await refusalOf(root, { path: "notes.txt", limit: 0 })).code).toBe("INVALID_INPUT")
    expect((await refusalOf(root, { path: "" })).code).toBe("INVALID_INPUT")
  })
})
