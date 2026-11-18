import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createFileEvidenceStore, workspaceRevision } from "./evidence-store"

function ledger() {
  const root = join(mkdtempSync(join(tmpdir(), "evidence-store-")), "verifications")
  return { root, store: createFileEvidenceStore(root) }
}

describe("file evidence store", () => {
  test("#given a written record #when a newly constructed store reads it #then the evidence survives reconstruction", () => {
    const { root, store } = ledger()
    const path = store.writeVerification("run-a", "run", "unit-core", 1, '{"status":"passed"}')
    expect(path.startsWith(root)).toBe(true)
    const fresh = createFileEvidenceStore(root)
    expect(fresh.readVerification("run-a", "run", "unit-core", 1)).toBe('{"status":"passed"}')
  })

  test("#given two runs #when each writes #then neither can see the other's evidence", () => {
    const { store } = ledger()
    store.writeVerification("run-a", "run", "unit-core", 1, '{"status":"passed"}')
    store.writeVerification("run-b", "run", "unit-core", 1, '{"status":"failed"}')
    expect(store.listVerifications("run-a")).toEqual(["run.unit-core.1.json"])
    expect(store.listVerifications("run-b")).toEqual(["run.unit-core.1.json"])
    expect(store.readVerification("run-a", "run", "unit-core", 1)).toBe('{"status":"passed"}')
    expect(store.readVerification("run-b", "run", "unit-core", 1)).toBe('{"status":"failed"}')
  })

  test("#given a missing record #when read #then it reports null instead of throwing", () => {
    const { store } = ledger()
    expect(store.readVerification("run-none", "run", "unit-core", 1)).toBeNull()
  })

  test("#given a run id carrying a path separator #when written #then it is rejected rather than escaping the root", () => {
    const { store } = ledger()
    expect(() => store.writeVerification("../escape", "run", "unit-core", 1, "x")).toThrow()
    expect(() => store.writeVerification("run", "run", "../unit", 1, "x")).toThrow()
  })

  test("#given an unwritable destination #when written #then the failure surfaces instead of reporting success", () => {
    const root = join(mkdtempSync(join(tmpdir(), "evidence-locked-")), "verifications")
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, "run-a"), "occupied by a file")
    const store = createFileEvidenceStore(root)
    expect(() => store.writeVerification("run-a", "run", "unit-core", 1, "x")).toThrow()
  })
})

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "workspace-rev-"))
  const run = (args: readonly string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" })
  run(["init"])
  run(["config", "user.email", "qa@example.invalid"])
  run(["config", "user.name", "qa"])
  writeFileSync(join(dir, "a.ts"), "export const a = 1\n")
  run(["add", "."])
  run(["commit", "-m", "initial"])
  return dir
}

describe("workspace revision", () => {
  test("#given an unchanged tree #when read twice #then the revision is stable", () => {
    const dir = gitRepo()
    expect(workspaceRevision(dir)).toBe(workspaceRevision(dir))
  })

  test("#given a relevant file mutation #when read again #then the revision changes", () => {
    const dir = gitRepo()
    const before = workspaceRevision(dir)
    writeFileSync(join(dir, "a.ts"), "export const a = 2\n")
    expect(workspaceRevision(dir)).not.toBe(before)
  })

  test("#given two workspaces at the same commit #when compared #then their revisions differ", () => {
    const one = gitRepo()
    const two = gitRepo()
    writeFileSync(join(two, "b.ts"), "export const b = 1\n")
    expect(workspaceRevision(one)).not.toBe(workspaceRevision(two))
  })

  test("#given a directory that is not a git workspace #when resolved #then it throws instead of inventing a revision", () => {
    const plain = mkdtempSync(join(tmpdir(), "not-a-repo-"))
    expect(() => workspaceRevision(plain)).toThrow()
  })
})
