import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

import {
  PROJECT_KNOWLEDGE_ROOT_ENV_VAR,
  defaultProjectKnowledgeRoot,
  ensureProjectKnowledgeStore,
  resolveProjectKnowledgeRoot,
} from "./store-home"

describe("resolveProjectKnowledgeRoot", () => {
  test("#given no override #when resolved #then the root is the per-user .omo store and never the cwd", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pk-home-cwd-"))
    try {
      const root = resolveProjectKnowledgeRoot({}, cwd)
      expect(root).toBe(join(homedir(), ".omo", "project-knowledge"))
      expect(isAbsolute(root)).toBe(true)
      expect(root.startsWith(resolve(cwd))).toBe(false)
      expect(root.startsWith(resolve(tmpdir()))).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test("#given an absolute override #when resolved #then it wins verbatim", () => {
    const target = join(tmpdir(), "pk-explicit-store")
    expect(resolveProjectKnowledgeRoot({ [PROJECT_KNOWLEDGE_ROOT_ENV_VAR]: target }, "C:/elsewhere")).toBe(target)
  })

  test("#given a relative override #when resolved #then it is anchored to the cwd", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pk-home-rel-"))
    try {
      expect(resolveProjectKnowledgeRoot({ [PROJECT_KNOWLEDGE_ROOT_ENV_VAR]: "store" }, cwd)).toBe(join(cwd, "store"))
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test("#given a blank override #when resolved #then the default applies instead of an empty path", () => {
    expect(resolveProjectKnowledgeRoot({ [PROJECT_KNOWLEDGE_ROOT_ENV_VAR]: "   " }, "C:/x")).toBe(defaultProjectKnowledgeRoot())
  })
})

describe("ensureProjectKnowledgeStore", () => {
  test("#given a missing directory #when ensured #then it is created once and reported", () => {
    const base = mkdtempSync(join(tmpdir(), "pk-store-"))
    const root = join(base, "nested", "project-knowledge")
    try {
      const first = ensureProjectKnowledgeStore(root)
      expect(first.ok).toBe(true)
      expect(first.ok && first.created).toBe(true)
      expect(statSync(root).isDirectory()).toBe(true)

      const second = ensureProjectKnowledgeStore(root)
      expect(second.ok && second.created).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test("#given a path blocked by a regular file #when ensured #then it fails closed without falling back", () => {
    const base = mkdtempSync(join(tmpdir(), "pk-store-blocked-"))
    const blocker = join(base, "not-a-dir")
    mkdirSync(base, { recursive: true })
    writeFileSync(blocker, "x")
    try {
      const result = ensureProjectKnowledgeStore(join(blocker, "store"))
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toBe("unwritable")
      expect(result.root.endsWith(join("not-a-dir", "store"))).toBe(true)
      expect(existsSync(join(base, "project-knowledge"))).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
