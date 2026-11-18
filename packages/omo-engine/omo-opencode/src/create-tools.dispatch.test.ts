import { afterAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTools } from "./create-tools.ts"

const roots: string[] = []

async function dispatched(): Promise<Awaited<ReturnType<typeof createTools>>["filteredTools"]> {
  const root = mkdtempSync(join(tmpdir(), "omo-dispatch-"))
  roots.push(root)
  const config = {} as never
  const created = await createTools({ directory: root, pluginConfig: config } as never, config, {} as never)
  writeFileSync(join(root, "note.txt"), "dispatch proof\n", "utf8")
  return created.filteredTools
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe("native tool dispatch", () => {
  it("gives read, write and bash their real argument schemas instead of an empty one", async () => {
    const tools = await dispatched()
    expect(Object.keys(tools.read?.args.properties ?? {})).toEqual(["path", "offset", "limit"])
    expect(Object.keys(tools.write?.args.properties ?? {})).toEqual(["path", "content", "expectedDigest"])
    expect(Object.keys(tools.bash?.args.properties ?? {})).toEqual(["command", "cwd", "timeoutMs"])
  })

  it("dispatches read to the real implementation, not the unavailable stub", async () => {
    const tools = await dispatched()
    const output = String(await tools.read?.execute({ path: "note.txt" } as never))
    expect(output).toContain("dispatch proof")
    expect(output).not.toContain("tool unavailable")
  })

  it("dispatches write and bash to real implementations", async () => {
    const tools = await dispatched()
    const written = String(await tools.write?.execute({ path: "out.txt", content: "written\n" } as never))
    expect(written).toContain("created out.txt")
    const context = { authenticated: true, sessionID: "ses_dispatch_0001", agent: "build" }
    const ran = String(
      await tools.bash?.execute({ command: process.platform === "win32" ? "echo ok" : "printf 'ok\\n'" } as never, context as never),
    )
    expect(ran).toContain("exit 0")
    expect(ran).toContain("ok")
  })

  it("refuses to run a command when no host context is supplied", async () => {
    const tools = await dispatched()
    await expect(tools.bash?.execute({ command: "echo should-not-run" } as never)).rejects.toThrow(/UNAUTHENTICATED|authenticated/i)
  })

  it("keeps the registry gate: a tool the catalog does not publish is not dispatched", async () => {
    const tools = await dispatched()
    expect(tools.not_a_tool).toBeUndefined()
  })

  it("gives grep, edit and glob their real argument schemas instead of an empty one", async () => {
    const tools = await dispatched()
    expect(Object.keys(tools.grep?.args.properties ?? {})).toEqual(["pattern", "path", "literal", "maxResults"])
    expect(Object.keys(tools.edit?.args.properties ?? {})).toEqual(["path", "oldText", "newText", "expectedDigest"])
    expect(Object.keys(tools.glob?.args.properties ?? {})).toEqual(["pattern", "path", "maxResults"])
  })

  it("dispatches grep, edit and glob to real implementations", async () => {
    const tools = await dispatched()
    const found = String(await tools.grep?.execute({ pattern: "proof" }))
    expect(found).toContain("note.txt:1: dispatch proof")
    expect(found).not.toContain("tool unavailable")
    const receipt = String(
      await tools.edit?.execute({ path: "note.txt", oldText: "dispatch proof", newText: "dispatch proven" }),
    )
    expect(receipt).toContain("updated note.txt")
    expect(receipt).not.toContain("tool unavailable")
    const listed = String(await tools.glob?.execute({ pattern: "**/*.txt" }))
    expect(listed).toContain("note.txt")
    expect(listed).not.toContain("tool unavailable")
  })
})
