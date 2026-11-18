// Host-owned "which files changed since this run started" attribution for ordinary-worker verification.
//
// Trust property: this attribution is produced by the host from the workspace itself, never from
// worker-supplied paths. It is a CONSERVATIVE SUPERSET in a shared tree (a sibling's edit is
// attributed too, so it selects more checks, never fewer) and exact in an isolated clone.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { statSync } from "node:fs"
import { join } from "node:path"

export type WorkspaceBaseline = {
  readonly version: 1
  readonly entries: readonly { readonly path: string; readonly size: number; readonly mtimeNs: string }[]
}

function listTrackedAndUntracked(workspaceDir: string): string[] {
  let output: string
  try {
    // Argv-only: the workspace dir travels as a `-C` value, never through a shell string, so a
    // hostile path cannot become a command.
    output = execFileSync("git", ["-C", workspaceDir, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
      stdio: "pipe",
    })
  } catch (error) {
    // Never return an empty baseline for an unattributable tree: an empty baseline would
    // silently attribute nothing and read as "no changes", failing verification closed-ness.
    throw new Error(
      `cannot snapshot workspace ${workspaceDir}: not inside a git work tree or git failed (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  return output
    .split("\0")
    .filter((entry) => entry.length > 0)
    .sort()
}

export function snapshotWorkspace(workspaceDir: string): WorkspaceBaseline {
  const entries = listTrackedAndUntracked(workspaceDir).map((path) => {
    try {
      const stat = statSync(join(workspaceDir, path), { bigint: true })
      return { path, size: Number(stat.size), mtimeNs: stat.mtimeNs.toString() }
    } catch {
      // Git listed the path but it vanished before stat (deleted between calls): keep it with a
      // sentinel so the deletion is still attributable instead of silently dropping the path.
      return { path, size: 0, mtimeNs: "0" }
    }
  })
  return { version: 1, entries }
}

export function changedPathsSince(workspaceDir: string, baseline: WorkspaceBaseline): readonly string[] {
  const current = snapshotWorkspace(workspaceDir)
  const before = new Map(baseline.entries.map((entry) => [entry.path, entry] as const))
  const after = new Map(current.entries.map((entry) => [entry.path, entry] as const))
  const changed = new Set<string>()
  for (const [path, entry] of before) {
    const now = after.get(path)
    if (now === undefined || now.size !== entry.size || now.mtimeNs !== entry.mtimeNs) {
      changed.add(path)
    }
  }
  for (const path of after.keys()) {
    if (!before.has(path)) {
      changed.add(path)
    }
  }
  return [...changed].sort()
}

export function workspaceBaselineDigest(baseline: WorkspaceBaseline): string {
  const records = [...baseline.entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${entry.path}\0${entry.size}\0${entry.mtimeNs}`)
    .join("\n")
  return createHash("sha256").update(records, "utf8").digest("hex").slice(0, 16)
}
