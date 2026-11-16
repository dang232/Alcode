import { afterAll, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { EDIT_TOOL_NAME, createWorkspaceEditTool } from "./edit.ts"
import { WorkspaceToolError } from "./errors.ts"

const roots: string[] = []

function workspace() {
  const base = mkdtempSync(join(tmpdir(), "omo-workspace-edit-"))
  roots.push(base)
  const root = join(base, "project")
  const outside = join(base, "outside")
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(root, "notes.txt"), "alpha one\nbeta two\nalpha three\n", "utf8")
  writeFileSync(join(outside, "secret.txt"), "not yours\n", "utf8")
  return { root, outside }
}

type EditArgs = { path: string; oldText: string; newText: string; expectedDigest?: string };

const edit = async (root: string, args: EditArgs): Promise<string> => {
  const tool = createWorkspaceEditTool({ directory: root })
  // SAFETY: EditArgs is the subset of tool arguments this helper passes; the tool validates them.
  return (await tool.execute(args as never)) as string
}

const refusalOf = async (root: string, args: EditArgs): Promise<WorkspaceToolError> => {
  try {
    await edit(root, args)
  } catch (error) {
    if (error instanceof WorkspaceToolError) return error
    throw error
  }
  throw new Error("expected the edit tool to refuse")
}

const digestOf = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("native edit tool", () => {
  it("is advertised under the name the catalog publishes", () => {
    expect(EDIT_TOOL_NAME).toBe("edit")
    const tool = createWorkspaceEditTool({ directory: tmpdir() })
    expect(tool.args.properties).toHaveProperty("oldText")
  })

  it("replaces one exact span and reports the new digest", async () => {
    const { root } = workspace()
    const receipt = await edit(root, { path: "notes.txt", oldText: "beta two", newText: "beta 2" })
    expect(receipt).toContain("updated notes.txt")
    expect(readFileSync(join(root, "notes.txt"), "utf8")).toContain("beta 2")
  })

  it("deletes a span when the replacement is empty", async () => {
    const { root } = workspace()
    await edit(root, { path: "notes.txt", oldText: "beta two\n", newText: "" })
    expect(readFileSync(join(root, "notes.txt"), "utf8")).not.toContain("beta")
  })

  it("refuses a missing anchor instead of guessing", async () => {
    const { root } = workspace()
    const error = await refusalOf(root, { path: "notes.txt", oldText: "nope", newText: "x" })
    expect(error.code).toBe("INVALID_INPUT")
    expect(readFileSync(join(root, "notes.txt"), "utf8")).toContain("beta two")
  })

  it("refuses an ambiguous anchor instead of picking one", async () => {
    const { root } = workspace()
    const error = await refusalOf(root, { path: "notes.txt", oldText: "alpha", newText: "x" })
    expect(error.code).toBe("INVALID_INPUT")
    expect(error.message).toContain("exactly once")
    expect(readFileSync(join(root, "notes.txt"), "utf8")).toContain("alpha one")
  })

  it("refuses a stale replacement when the digest moved", async () => {
    const { root } = workspace()
    const error = await refusalOf(root, {
      path: "notes.txt",
      oldText: "beta two",
      newText: "beta 2",
      expectedDigest: digestOf("something else"),
    })
    expect(error.code).toBe("INVALID_INPUT")
    expect(readFileSync(join(root, "notes.txt"), "utf8")).toContain("beta two")
  })

  it("accepts a matching digest and applies the edit", async () => {
    const { root } = workspace()
    const before = readFileSync(join(root, "notes.txt"), "utf8")
    const receipt = await edit(root, {
      path: "notes.txt",
      oldText: "beta two",
      newText: "beta 2",
      expectedDigest: digestOf(before),
    })
    expect(receipt).toContain("updated notes.txt")
  })

  it("refuses a traversal that leaves the workspace", async () => {
    const { root } = workspace()
    const error = await refusalOf(root, { path: "../outside/secret.txt", oldText: "not yours", newText: "x" })
    expect(error.code).toBe("PATH_OUTSIDE_WORKSPACE")
  })

  it("refuses a linked path that resolves outside the workspace", async () => {
    const { root, outside } = workspace()
    symlinkSync(outside, join(root, "escape"), "junction")
    const error = await refusalOf(root, { path: "escape/secret.txt", oldText: "not yours", newText: "x" })
    expect(error.code).toBe("PATH_OUTSIDE_WORKSPACE")
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toContain("not yours")
  })

  it("refuses a missing file instead of creating one", async () => {
    const { root } = workspace()
    const error = await refusalOf(root, { path: "new.txt", oldText: "a", newText: "b" })
    expect(error.code).toBe("NOT_FOUND")
  })
})
