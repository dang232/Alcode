// Canonical evidence storage and the host-owned tree revision for ordinary verification.
//
// The store reuses the layout and record format the DAG gate already writes
// (`<root>/<runId>/<nodeId>.<checkId>.<attempt>.json`, serialized by `serializeVerificationRecord`),
// so there is one evidence format in the product, not two. Writes are temp+rename so a torn write can
// never be mistaken for a record, and a failed write throws instead of reporting success.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { OrdinaryEvidenceStore } from "./ordinary-capture"

function recordPath(root: string, runId: string, nodeId: string, checkId: string, attempt: number): string {
  return join(root, runId, `${nodeId}.${checkId}.${attempt}.json`)
}

// A path segment coming from a caller is rejected rather than normalized: run ids, node ids and check
// ids are host-produced identifiers, and a separator in one of them would escape the run directory.
function segment(value: string, name: string): string {
  if (value.length === 0 || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
    throw new Error(`invalid ${name} for evidence storage: ${JSON.stringify(value)}`)
  }
  return value
}

export function createFileEvidenceStore(rootDir: string): OrdinaryEvidenceStore {
  return {
    writeVerification(runId, nodeId, checkId, attempt, record) {
      const target = recordPath(rootDir, segment(runId, "runId"), segment(nodeId, "nodeId"), segment(checkId, "checkId"), attempt)
      const dir = join(rootDir, runId)
      mkdirSync(dir, { recursive: true })
      const temp = `${target}.${process.pid}.tmp`
      try {
        writeFileSync(temp, record)
        renameSync(temp, target)
      } catch (error) {
        try {
          unlinkSync(temp)
        } catch {
          // The temp file may not exist; the original write error below is the one that matters.
        }
        throw new Error(`failed to persist verification evidence for ${runId}/${checkId}: ${error instanceof Error ? error.message : String(error)}`)
      }
      return target
    },
    readVerification(runId, nodeId, checkId, attempt) {
      try {
        return readFileSync(recordPath(rootDir, runId, nodeId, checkId, attempt), "utf8")
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
        throw error
      }
    },
    listVerifications(runId) {
      return readdirSync(join(rootDir, runId))
    },
  }
}

function git(workspaceDir: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", workspaceDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

// The revision identifies the tree a check actually ran against: the workspace's own HEAD plus a
// digest of its uncommitted state, so an edit invalidates earlier evidence while a different
// workspace with the same commit cannot collide. It covers tracked and untracked working-tree state
// as git reports it; it does NOT cover ignored files, and it throws when the workspace is not a git
// tree rather than inventing a revision.
export function workspaceRevision(workspaceDir: string): string {
  const head = git(workspaceDir, ["rev-parse", "HEAD"]).trim()
  const status = git(workspaceDir, ["status", "--porcelain=v1", "--untracked-files=normal"])
  const digest = createHash("sha256").update(status).digest("hex").slice(0, 16)
  return `${head}+${digest}`
}

