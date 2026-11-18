import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  changedPathsSince,
  snapshotWorkspace,
  workspaceBaselineDigest,
  type WorkspaceBaseline,
} from "./run-provenance"

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  dirs = []
})

function git(dir: string, args: readonly string[]): string {
  // Argv-only: every git invocation passes the arg list directly, never a shell string.
  return execFileSync("git", [...args], { cwd: dir, encoding: "utf8", stdio: "pipe" })
}

function failureOf(run: () => void): Error {
  try {
    run()
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
  // Reaching here means the call did not fail, which every caller treats as a test failure.
  throw new Error("expected the call to throw, but it returned normally")
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "run-provenance-"))
  dirs.push(dir)
  git(dir, ["init", "-q"])
  git(dir, ["config", "user.email", "run-provenance@test.invalid"])
  git(dir, ["config", "user.name", "run-provenance"])
  writeFileSync(join(dir, "tracked.txt"), "hello")
  git(dir, ["add", "tracked.txt"])
  git(dir, ["commit", "-q", "-m", "seed"])
  return dir
}

function nonRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "run-provenance-norepo-"))
  dirs.push(dir)
  return dir
}

describe("run-provenance - host-owned change attribution", () => {
  test("#given a new untracked file #when diffed #then it is reported", () => {
    const dir = initRepo()
    const baseline = snapshotWorkspace(dir)
    writeFileSync(join(dir, "fresh.txt"), "new work")
    expect(changedPathsSince(dir, baseline)).toContain("fresh.txt")
  })

  test("#given a tracked file with new content #when diffed #then the size change is reported", () => {
    const dir = initRepo()
    const baseline = snapshotWorkspace(dir)
    writeFileSync(join(dir, "tracked.txt"), "hello plus much more content")
    expect(changedPathsSince(dir, baseline)).toContain("tracked.txt")
  })

  test("#given a same-length rewrite #when diffed #then the mtimeNs change is reported", () => {
    const dir = initRepo()
    const baseline = snapshotWorkspace(dir)
    // Same byte length ("hello" -> "world") so size alone cannot catch it; only mtimeNs differs.
    writeFileSync(join(dir, "tracked.txt"), "world")
    expect(readFileSync(join(dir, "tracked.txt"), "utf8")).toBe("world")
    // Force a distinct mtime: filesystems with coarse timestamp granularity could otherwise
    // record the same tick for a rewrite that lands within one tick of the baseline snapshot.
    const later = new Date(Date.now() + 5000)
    utimesSync(join(dir, "tracked.txt"), later, later)
    const before = baseline.entries.find((entry) => entry.path === "tracked.txt")
    const after = statSync(join(dir, "tracked.txt"), { bigint: true })
    expect(String(after.size)).toBe(String(before?.size))
    expect(after.mtimeNs.toString()).not.toBe(before?.mtimeNs)
    expect(changedPathsSince(dir, baseline)).toContain("tracked.txt")
  })

  test("#given a deleted tracked file #when diffed #then the deletion is reported", () => {
    const dir = initRepo()
    const baseline = snapshotWorkspace(dir)
    rmSync(join(dir, "tracked.txt"))
    expect(changedPathsSince(dir, baseline)).toContain("tracked.txt")
  })

  test("#given no workspace edits #when diffed #then the change set is empty", () => {
    const dir = initRepo()
    const baseline = snapshotWorkspace(dir)
    expect(changedPathsSince(dir, baseline)).toEqual([])
  })

  test("#given a git-ignored file #when diffed #then it is not reported", () => {
    const dir = initRepo()
    writeFileSync(join(dir, ".gitignore"), "ignored.log\n")
    git(dir, ["add", ".gitignore"])
    git(dir, ["commit", "-q", "-m", "ignore logs"])
    const baseline = snapshotWorkspace(dir)
    writeFileSync(join(dir, "ignored.log"), "noise")
    expect(changedPathsSince(dir, baseline)).toEqual([])
  })

  test("#given a directory outside any git work tree #when snapshotted #then it throws naming the workspace", () => {
    const dir = nonRepo()
    writeFileSync(join(dir, "loose.txt"), "no repo here")
    // A workspace the host cannot snapshot must fail loudly, and the message must name the tree so
    // the operator can tell which directory was unattributable.
    expect(failureOf(() => snapshotWorkspace(dir)).message).toContain(dir)
  })

  test("#given several edits at once #when diffed #then the list is sorted and de-duplicated", () => {
    const dir = initRepo()
    writeFileSync(join(dir, "tracked.txt"), "seed")
    git(dir, ["add", "tracked.txt"])
    git(dir, ["commit", "-q", "-m", "reseed"])
    const baseline = snapshotWorkspace(dir)
    writeFileSync(join(dir, "zebra.txt"), "z")
    writeFileSync(join(dir, "apple.txt"), "a")
    writeFileSync(join(dir, "tracked.txt"), "seed plus more")
    rmSync(join(dir, "tracked.txt"))
    writeFileSync(join(dir, "mango.txt"), "m")
    const changed = changedPathsSince(dir, baseline)
    expect([...changed]).toEqual(["apple.txt", "mango.txt", "tracked.txt", "zebra.txt"])
    expect(new Set(changed).size).toBe(changed.length)
  })

  test("#given two identical snapshots #when digested #then the digest is stable, hex, and 16 chars", () => {
    const dir = initRepo()
    const first: WorkspaceBaseline = snapshotWorkspace(dir)
    const second: WorkspaceBaseline = snapshotWorkspace(dir)
    expect(workspaceBaselineDigest(first)).toBe(workspaceBaselineDigest(second))
    expect(workspaceBaselineDigest(first)).toMatch(/^[0-9a-f]{16}$/)
  })
})
