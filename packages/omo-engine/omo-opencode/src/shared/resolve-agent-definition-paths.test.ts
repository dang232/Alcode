import { describe, test, expect, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveBundledAgentsDir } from "./resolve-agent-definition-paths"

const originalResourcesPath = (process as { resourcesPath?: unknown }).resourcesPath

afterEach(() => {
  if (originalResourcesPath === undefined) {
    delete (process as { resourcesPath?: unknown }).resourcesPath
  } else {
    Object.defineProperty(process, "resourcesPath", { value: originalResourcesPath, configurable: true })
  }
})

describe("resolveBundledAgentsDir", () => {
  test("prefers the staged packaged resources when present", () => {
    const root = mkdtempSync(join(tmpdir(), "alcode-agents-"))
    try {
      const staged = join(root, "omo-engine", "omo-opencode", "agents")
      mkdirSync(staged, { recursive: true })
      Object.defineProperty(process, "resourcesPath", { value: root, configurable: true })
      expect(resolveBundledAgentsDir()).toBe(staged)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("falls back to the source tree when the staged dir is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "alcode-agents-"))
    try {
      Object.defineProperty(process, "resourcesPath", { value: root, configurable: true })
      expect(resolveBundledAgentsDir()).toBe(join(import.meta.dir, "..", "..", "agents"))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("falls back to the source tree without a resources path", () => {
    delete (process as { resourcesPath?: unknown }).resourcesPath
    expect(resolveBundledAgentsDir()).toBe(join(import.meta.dir, "..", "..", "agents"))
  })
})
