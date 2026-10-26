import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  normalizeRepositoryReference,
  resolveProjectIdentity,
  safeProjectSlug,
} from "./identity"

const PROJECT_ID = /^[^\s/]+-[0-9a-f]{8}$/

function gitFor(values: { remote?: string; commonDir?: string }) {
  return (_directory: string, args: readonly string[]): string | undefined => {
    const command = args.join(" ")
    if (command === "config --get remote.origin.url") return values.remote
    if (command === "rev-parse --git-common-dir") return values.commonDir
    return undefined
  }
}

describe("resolveProjectIdentity", () => {
  test("#given one remote and two checkout paths #when resolved #then both yield the same project id", () => {
    const git = gitFor({ remote: "https://github.com/dang232/Alcode.git" })

    const first = resolveProjectIdentity("C:/work/a", { git })
    const second = resolveProjectIdentity("C:/work/b", { git })

    expect(first.projectId).toBe(second.projectId)
    expect(first.kind).toBe("remote")
    expect(first.projectId).toMatch(PROJECT_ID)
  })

  test("#given the same remote written three ways #when normalized #then one reference results", () => {
    const https = normalizeRepositoryReference("https://github.com/dang232/Alcode.git")
    const scp = normalizeRepositoryReference("git@github.com:dang232/Alcode.git")
    const dashed = normalizeRepositoryReference("ssh://git@github.com/dang232/Alcode")

    expect(https).toBe("github.com/dang232/alcode")
    expect(scp).toBe(https)
    expect(dashed).toBe(https)
  })

  test("#given credentials in the remote #when normalized #then they never reach the identity", () => {
    const withSecret = normalizeRepositoryReference("https://user:tok3n@github.com/org/repo.git")

    expect(withSecret).toBe("github.com/org/repo")
    expect(withSecret).not.toContain("tok3n")
  })

  test("#given no remote but one shared git dir #when two worktrees resolve #then they share an id", () => {
    const git = gitFor({ commonDir: "C:/repo/.git" })

    const worktree = resolveProjectIdentity("C:/repo-wt/one", { git })
    const main = resolveProjectIdentity("C:/repo", { git })

    expect(worktree.kind).toBe("git-dir")
    expect(worktree.projectId).toBe(main.projectId)
    expect(worktree.projectId).toMatch(PROJECT_ID)
  })

  test("#given no git metadata at all #when two paths resolve #then identities differ and are path-scoped", () => {
    const git = gitFor({})

    const first = resolveProjectIdentity("C:/one/project", { git })
    const second = resolveProjectIdentity("C:/two/project", { git })

    expect(first.kind).toBe("path")
    expect(second.kind).toBe("path")
    expect(first.projectId).not.toBe(second.projectId)
    expect(first.projectId).toMatch(PROJECT_ID)
  })

  test("#given a real repository without a remote #when a linked worktree resolves #then the main and linked ids match", () => {
    const root = mkdtempSync(join(tmpdir(), "pk-identity-"))
    const main = join(root, "main")
    const linked = join(root, "linked")
    mkdirSync(main, { recursive: true })
    try {
      const git = (directory: string, args: readonly string[]) => {
        try {
          const out = execFileSync("git", ["-C", directory, ...args], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }).trim()
          return out.length === 0 ? undefined : out
        } catch {
          return undefined
        }
      }
      execFileSync("git", ["init", "-q", main], { cwd: root })
      execFileSync(
        "git",
        ["-C", main, "-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"],
        { cwd: root },
      )
      execFileSync("git", ["-C", main, "worktree", "add", "-q", linked], { cwd: root })

      const fromMain = resolveProjectIdentity(main, { git })
      const fromLinked = resolveProjectIdentity(linked, { git })
      expect(fromMain.kind).toBe("git-dir")
      expect(fromLinked.kind).toBe("git-dir")
      expect(fromLinked.projectId).toBe(fromMain.projectId)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given an unrepresentable folder name #when slugged #then the id stays legal", () => {
    expect(safeProjectSlug("Weird / Name.git")).toBe("weird-name-git")
    expect(safeProjectSlug("")).toBe("project")
    expect(`${safeProjectSlug("x y")}-0123abcd`).toMatch(PROJECT_ID)
  })

  test("#given a non-git directory path #when resolved #then it never throws", () => {
    const root = mkdtempSync(join(tmpdir(), "pk-identity-nogit-"))
    try {
      writeFileSync(join(root, "file.txt"), "x")
      expect(() => resolveProjectIdentity(root)).not.toThrow()
      expect(resolveProjectIdentity(root).kind).toBe("path")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
