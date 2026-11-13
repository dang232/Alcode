// Canonical evidence storage and the host-owned tree revision for ordinary verification.
//
// The store reuses the layout and record format the DAG gate already writes
// (`<root>/<runId>/<nodeId>.<checkId>.<attempt>.json`, serialized by `serializeVerificationRecord`),
// so there is one evidence format in the product, not two. Writes are temp+rename so a torn write can
// never be mistaken for a record, and a failed write throws instead of reporting success.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { DAG_VERIFICATION_STATUSES, type DagVerificationStatus } from "../dag/verification"
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
    rootDir,
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

// ---------------------------------------------------------------------------
// Host capture receipts
//
// The receipt is the host's own statement about which evidence files it wrote. It lives OUTSIDE
// the evidence directory (a sibling of `<stateDir>/verifications`) so the gate's directory listing
// can never parse it as a verification record. A record that is not listed here, or whose bytes no
// longer match the recorded digest, was not written by this host capture and is never accepted.
// ---------------------------------------------------------------------------

export type CaptureReceiptRecord = {
  readonly file: string
  readonly sha256: string
  readonly checkId: string
  readonly status: DagVerificationStatus
}

export type CaptureReceipt = {
  readonly taskId: string
  readonly epoch: number
  readonly dagRunId: string
  readonly sourceRevision: string
  readonly records: readonly CaptureReceiptRecord[]
}

export type CaptureReceiptRead =
  | { readonly kind: "found"; readonly receipt: CaptureReceipt }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly reason: string }

// `<stateDir>/verification-receipts` for the canonical `<stateDir>/verifications` evidence root.
// Deriving the sibling keeps one layout for every caller instead of a second path argument that
// could silently point at a different state tree.
export function verificationReceiptRoot(evidenceRoot: string): string {
  return join(dirname(evidenceRoot), "verification-receipts")
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

// Reads one listed evidence file by NAME. The receipt names its files, so the gate must hash the
// exact bytes that name resolves to without re-deriving the (dotted) id segments from it. A name
// that could escape the task directory is rejected, never normalized.
export function readEvidenceFile(rootDir: string, taskId: string, fileName: string): string | null {
  if (fileName.length === 0 || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    return null
  }
  try {
    return readFileSync(join(rootDir, segment(taskId, "taskId"), fileName), "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

function receiptPath(rootDir: string, taskId: string, epoch: number): string {
  return join(rootDir, segment(taskId, "taskId"), `${epoch}.json`)
}

export function writeCaptureReceipt(rootDir: string, receipt: CaptureReceipt): string {
  const target = receiptPath(rootDir, receipt.taskId, receipt.epoch)
  const dir = join(rootDir, receipt.taskId)
  mkdirSync(dir, { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  try {
    writeFileSync(temp, JSON.stringify(receipt))
    renameSync(temp, target)
  } catch (error) {
    try {
      unlinkSync(temp)
    } catch {
      // The temp file may not exist; the original write error below is the one that matters.
    }
    throw new Error(`failed to persist capture receipt for ${receipt.taskId}/${receipt.epoch}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return target
}

// A missing receipt and an unreadable one are different failures, and the gate names both. Neither
// is ever treated as "nothing to check": acceptance requires a receipt the host itself wrote.
export function readCaptureReceipt(rootDir: string, taskId: string, epoch: number): CaptureReceiptRead {
  let raw: string
  try {
    raw = readFileSync(receiptPath(rootDir, taskId, epoch), "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { kind: "missing" }
    return { kind: "invalid", reason: error instanceof Error ? error.message : String(error) }
  }
  let value: unknown
  try {
    // SAFETY: JSON boundary; the envelope is validated field-by-field below before use.
    value = JSON.parse(raw) as unknown
  } catch {
    return { kind: "invalid", reason: "capture receipt is not valid JSON" }
  }
  if (value === null || Array.isArray(value)) return { kind: "invalid", reason: "capture receipt is not an object" }
  // SAFETY: the envelope fields checked below are the ones the gate reads; record entries are
  // validated one by one before any of them is trusted.
  const envelope = value as { readonly taskId?: unknown; readonly epoch?: unknown; readonly dagRunId?: unknown; readonly sourceRevision?: unknown; readonly records?: unknown }
  if (typeof envelope.taskId !== "string" || envelope.taskId.length === 0) return { kind: "invalid", reason: "capture receipt has no task id" }
  if (typeof envelope.epoch !== "number" || !Number.isInteger(envelope.epoch) || envelope.epoch < 0) return { kind: "invalid", reason: "capture receipt has no epoch" }
  if (typeof envelope.dagRunId !== "string") return { kind: "invalid", reason: "capture receipt has no DAG run id" }
  if (typeof envelope.sourceRevision !== "string") return { kind: "invalid", reason: "capture receipt has no source revision" }
  if (!Array.isArray(envelope.records)) return { kind: "invalid", reason: "capture receipt has no record list" }
  const records: CaptureReceiptRecord[] = []
  for (const entry of envelope.records) {
    if (entry === null || Array.isArray(entry)) return { kind: "invalid", reason: "capture receipt record is not an object" }
    // SAFETY: each field is type-checked before it is copied into the typed receipt.
    const record = entry as { readonly file?: unknown; readonly sha256?: unknown; readonly checkId?: unknown; readonly status?: unknown }
    if (typeof record.file !== "string" || record.file.length === 0) return { kind: "invalid", reason: "capture receipt record has no file" }
    if (typeof record.sha256 !== "string" || record.sha256.length === 0) return { kind: "invalid", reason: "capture receipt record has no digest" }
    if (typeof record.checkId !== "string" || record.checkId.length === 0) return { kind: "invalid", reason: "capture receipt record has no check id" }
    if (!isReceiptStatus(record.status)) return { kind: "invalid", reason: "capture receipt record has an unknown status" }
    records.push({ file: record.file, sha256: record.sha256, checkId: record.checkId, status: record.status })
  }
  return {
    kind: "found",
    receipt: {
      taskId: envelope.taskId,
      epoch: envelope.epoch,
      dagRunId: envelope.dagRunId,
      sourceRevision: envelope.sourceRevision,
      records,
    },
  }
}

function isReceiptStatus(value: unknown): value is CaptureReceiptRecord["status"] {
  const statuses: readonly unknown[] = DAG_VERIFICATION_STATUSES
  return statuses.includes(value)
}

