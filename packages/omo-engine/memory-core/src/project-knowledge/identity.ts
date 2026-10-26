// Stable project identity for project-knowledge records.
//
// Decision (Slice 9.6): identity is derived from the REPOSITORY, never from the
// physical worktree path and never from the records being read.
//
//   remote origin url  -> <slug>-<sha8("remote:<normalized url>")>
//   no remote, git dir -> <slug>-<sha8("common:<realpath of git dir>")>
//   no git at all      -> <slug>-<sha8("path:<realpath of directory>")>   (fail-closed)
//
// Consequences, stated so callers can rely on them:
// - linked worktrees of one repository share one id (same remote / same git dir);
// - separate clones of one remote share one id, i.e. they share knowledge;
// - separate repositories always differ, even under identically named folders;
// - a path with no git metadata never shares knowledge with anything else.
//
// The id shape is constrained by PROJECT_ID in record.ts: `^[^\s/]+-[0-9a-f]{8}$`.

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { basename, resolve } from "node:path"
import { realpathSync } from "node:fs"

export type ProjectIdentityKind = "remote" | "git-dir" | "path"

export type ProjectIdentity = {
  /** `<safe-slug>-<sha256-8>`: legal for `pk-project` and stable per repository. */
  readonly projectId: string
  /** Which source produced the identity; `path` is the fail-closed form. */
  readonly kind: ProjectIdentityKind
  /** Normalized repository reference (remote URL or git dir), absent for `path`. */
  readonly repository?: string
}

export type ProjectIdentityDeps = {
  /** Optional injection point for tests; must behave like `git -C <dir> <args>`. */
  readonly git?: (directory: string, args: readonly string[]) => string | undefined
}

const GIT_TIMEOUT_MS = 5000

function defaultGit(directory: string, args: readonly string[]): string | undefined {
  try {
    const output = execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    })
    const trimmed = output.trim()
    return trimmed.length === 0 ? undefined : trimmed
  } catch {
    // No git binary, not a repository, or a timeout: identity falls back, never throws.
    return undefined
  }
}

/** Lowercase host, drop credentials, scheme, port and the trailing `.git`. */
export function normalizeRepositoryReference(raw: string): string | undefined {
  const value = raw.trim()
  if (value.length === 0) {
    return undefined
  }
  // scp-style `git@host:org/repo.git`
  const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(value)
  if (scp !== null && !value.includes("://")) {
    const [, host = "", path = ""] = scp
    const cleaned = path.replace(/^\/+/, "").replace(/\.git$/i, "").toLowerCase()
    return cleaned.length === 0 ? undefined : `${host.toLowerCase()}/${cleaned}`
  }
  try {
    const url = new URL(value)
    const path = url.pathname.replace(/^\/+/, "").replace(/\.git$/i, "").toLowerCase()
    return path.length === 0 ? undefined : `${url.hostname.toLowerCase()}/${path}`
  } catch {
    const cleaned = value.replace(/^\/+/, "").replace(/\.git$/i, "").toLowerCase()
    return cleaned.length === 0 ? undefined : cleaned
  }
}

/** `PROJECT_ID` forbids whitespace and slashes; everything else is folded to `-`. */
export function safeProjectSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
  return slug.length === 0 ? "project" : slug
}

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 8)
}

function realPath(directory: string): string {
  try {
    return realpathSync.native(directory)
  } catch {
    return resolve(directory)
  }
}

function slugFromRepository(reference: string): string {
  const tail = reference.split("/").filter((part) => part.length > 0).at(-1)
  return safeProjectSlug(tail ?? "project")
}

/**
 * Resolve the project a checkout belongs to. Pure with respect to the record
 * store: it never reads records, so retrieved knowledge cannot re-anchor it.
 */
export function resolveProjectIdentity(
  directory: string,
  deps: ProjectIdentityDeps = {},
): ProjectIdentity {
  const git = deps.git ?? defaultGit
  const absolute = realPath(directory)

  const remote = git(directory, ["config", "--get", "remote.origin.url"])
  const normalized = remote === undefined ? undefined : normalizeRepositoryReference(remote)
  if (normalized !== undefined) {
    return {
      projectId: `${slugFromRepository(normalized)}-${shortHash(`remote:${normalized}`)}`,
      kind: "remote",
      repository: normalized,
    }
  }

  const gitDir = git(directory, ["rev-parse", "--git-common-dir"])
  if (gitDir !== undefined) {
    // `--git-common-dir` may be relative to the directory being inspected.
    const shared = realPath(resolve(directory, gitDir))
    return {
      projectId: `${safeProjectSlug(basename(shared))}-${shortHash(`common:${shared}`)}`,
      kind: "git-dir",
      repository: shared,
    }
  }

  return {
    projectId: `${safeProjectSlug(basename(absolute))}-${shortHash(`path:${absolute}`)}`,
    kind: "path",
  }
}
