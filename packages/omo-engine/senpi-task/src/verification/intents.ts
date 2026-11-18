// Durable intent for a delegated parent's host-side verification.
//
// The intent exists for exactly one window: after the delegated children settled and before THIS
// writer publishes the parent's terminal record. A process that dies inside that window leaves the
// file behind; the next host re-drives the same capture + gate + fenced terminal from it instead of
// stranding a running parent with no verdict. It is removed only after the terminal write, so a
// second fold that finds a terminal record publishes nothing.
//
// The file carries host state only (parent task id, epoch, run id, the spawn-time catalogue and
// baseline, and the planned node ids). It never carries a verdict, an exit code, or a check result:
// those are produced by the capture and judged by the gate, never restored from disk.
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { DAG_VERIFY_CHECK_CATEGORIES, type DagVerifyCheck } from "../dag/verification"
import type { DagRunId } from "../dag/types"
import type { OrdinaryCatalogue, OrdinaryCheck, OrdinaryCheckProvenance } from "./catalogue"
import type { WorkspaceBaseline } from "./run-provenance"

export type DelegatedVerificationIntent = {
  readonly version: 1
  readonly taskId: string
  readonly epoch: number
  readonly dagRunId: DagRunId
  readonly workspaceDir: string
  readonly catalogue: OrdinaryCatalogue
  readonly baseline: WorkspaceBaseline | null
  // The plan's node ids. Persisted so a re-drive can still prove the run record carries EXACTLY
  // this plan's node set, instead of trusting whatever terminal nodes the record happens to hold.
  readonly plannedNodeIds: readonly string[]
  readonly createdAt: string
}

export type DelegatedVerificationIntentListing = {
  readonly intents: readonly DelegatedVerificationIntent[]
  // File names that could not be read as this schema. Reported, never trusted: an unreadable intent
  // is not an empty one.
  readonly invalid: readonly string[]
}

const INTENT_DIR = "verification-intents"

function segment(value: string, name: string): string {
  if (value.length === 0 || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
    throw new Error(`invalid ${name} for a verification intent: ${JSON.stringify(value)}`)
  }
  return value
}

function object(value: unknown): object | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null
}

function field(value: object, key: string): unknown {
  return key in value ? Reflect.get(value, key) : undefined
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null
}

function textList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null
  const items: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string") return null
    items.push(entry)
  }
  return items
}

function objectList(value: unknown): readonly object[] | null {
  if (!Array.isArray(value)) return null
  const items: object[] = []
  for (const entry of value) {
    const parsed = object(entry)
    if (parsed === null) return null
    items.push(parsed)
  }
  return items
}

function isCategory(value: string): value is DagVerifyCheck["category"] {
  return DAG_VERIFY_CHECK_CATEGORIES.some((category) => category === value)
}

// The brand carries no runtime value: a persisted, non-empty run id is exactly the id the admission
// port reported for this run.
function isDagRunId(value: string): value is DagRunId {
  return value.length > 0
}

function readCheck(value: unknown): DagVerifyCheck | null {
  const raw = object(value)
  if (raw === null) return null
  const checkId = text(field(raw, "checkId"))
  const category = text(field(raw, "category"))
  const command = textList(field(raw, "command"))
  const timeoutMs = field(raw, "timeoutMs")
  const criteria = textList(field(raw, "criteria"))
  if (checkId === null || category === null || !isCategory(category) || command === null || criteria === null) return null
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 0) return null
  const cwd = field(raw, "cwd")
  const coveredPaths = field(raw, "coveredPaths")
  const idempotent = field(raw, "idempotent")
  if (cwd !== undefined && typeof cwd !== "string") return null
  if (coveredPaths !== undefined && textList(coveredPaths) === null) return null
  if (idempotent !== undefined && typeof idempotent !== "boolean") return null
  const covered = coveredPaths === undefined ? undefined : textList(coveredPaths)
  return {
    checkId,
    category,
    command,
    timeoutMs,
    criteria,
    ...(cwd === undefined ? {} : { cwd }),
    ...(covered === null || covered === undefined ? {} : { coveredPaths: covered }),
    ...(idempotent === undefined ? {} : { idempotent }),
  }
}

function readProvenance(value: unknown): OrdinaryCheckProvenance | null {
  const raw = object(value)
  if (raw === null) return null
  const source = text(field(raw, "source"))
  const location = text(field(raw, "location"))
  const reason = text(field(raw, "reason"))
  if (source !== "config" && source !== "manifest") return null
  if (location === null || reason === null) return null
  return { source, location, reason }
}

function readCatalogue(value: unknown): OrdinaryCatalogue | null {
  const raw = object(value)
  if (raw === null) return null
  const status = text(field(raw, "status"))
  if (status === "none" || status === "unsupported") {
    const reason = text(field(raw, "reason"))
    return reason === null ? null : { status, reason }
  }
  if (status === "invalid") {
    const diagnostics = textList(field(raw, "diagnostics"))
    return diagnostics === null ? null : { status, diagnostics }
  }
  if (status === "approval_required") {
    const pending = textList(field(raw, "pending"))
    const reason = text(field(raw, "reason"))
    return pending === null || reason === null ? null : { status, pending, reason }
  }
  if (status === "configured") {
    const entries = objectList(field(raw, "checks"))
    if (entries === null) return null
    const checks: OrdinaryCheck[] = []
    for (const entry of entries) {
      const check = readCheck(field(entry, "check"))
      const provenance = readProvenance(field(entry, "provenance"))
      if (check === null || provenance === null) return null
      checks.push({ check, provenance })
    }
    return { status, checks }
  }
  return null
}

function readBaseline(value: unknown): WorkspaceBaseline | null | undefined {
  if (value === null) return null
  const raw = object(value)
  if (raw === null) return undefined
  if (field(raw, "version") !== 1) return undefined
  const entries = objectList(field(raw, "entries"))
  if (entries === null) return undefined
  const parsed: { readonly path: string; readonly size: number; readonly mtimeNs: string }[] = []
  for (const entry of entries) {
    const path = text(field(entry, "path"))
    const size = field(entry, "size")
    const mtimeNs = field(entry, "mtimeNs")
    if (path === null || typeof size !== "number" || !Number.isFinite(size)) return undefined
    if (typeof mtimeNs !== "string") return undefined
    parsed.push({ path, size, mtimeNs })
  }
  return { version: 1, entries: parsed }
}

function readIntent(value: unknown): DelegatedVerificationIntent | null {
  const raw = object(value)
  if (raw === null) return null
  if (field(raw, "version") !== 1) return null
  const taskId = text(field(raw, "taskId"))
  const epoch = integer(field(raw, "epoch"))
  const dagRunId = text(field(raw, "dagRunId"))
  const workspaceDir = text(field(raw, "workspaceDir"))
  const createdAt = text(field(raw, "createdAt"))
  const plannedNodeIds = textList(field(raw, "plannedNodeIds"))
  const catalogue = readCatalogue(field(raw, "catalogue"))
  const baseline = readBaseline(field(raw, "baseline"))
  if (taskId === null || epoch === null || dagRunId === null || !isDagRunId(dagRunId)) return null
  if (workspaceDir === null || createdAt === null) return null
  if (plannedNodeIds === null || catalogue === null || baseline === undefined) return null
  return { version: 1, taskId, epoch, dagRunId, workspaceDir, catalogue, baseline, plannedNodeIds, createdAt }
}

export function verificationIntentRoot(stateDir: string): string {
  return join(stateDir, INTENT_DIR)
}

export function verificationIntentPath(stateDir: string, taskId: string, epoch: number): string {
  return join(verificationIntentRoot(stateDir), `${segment(taskId, "taskId")}.${epoch}.json`)
}

export function writeDelegatedVerificationIntent(
  stateDir: string,
  intent: Omit<DelegatedVerificationIntent, "version">,
): string {
  const target = verificationIntentPath(stateDir, intent.taskId, intent.epoch)
  const dir = verificationIntentRoot(stateDir)
  mkdirSync(dir, { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  try {
    writeFileSync(temp, JSON.stringify({ version: 1, ...intent }))
    renameSync(temp, target)
  } catch (error) {
    try {
      unlinkSync(temp)
    } catch {
      // The temp file may not exist; the write error below is the one that matters.
    }
    throw new Error(`failed to persist the delegated verification intent for ${intent.taskId}/${intent.epoch}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return target
}

// Removing an intent that is already gone is the normal post-crash state, never an error.
export function deleteDelegatedVerificationIntent(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  }
}

export function listDelegatedVerificationIntents(stateDir: string): DelegatedVerificationIntentListing {
  const dir = verificationIntentRoot(stateDir)
  let files: string[]
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".json"))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { intents: [], invalid: [] }
    throw error
  }
  const intents: DelegatedVerificationIntent[] = []
  const invalid: string[] = []
  for (const file of [...files].sort()) {
    let raw: string
    try {
      raw = readFileSync(join(dir, file), "utf8")
    } catch {
      invalid.push(file)
      continue
    }
    let parsed: unknown
    try {
      // JSON.parse returns `any`; widening it to unknown keeps every field unread until readIntent
      // validates it, so no parsed value is trusted before it is checked.
      parsed = JSON.parse(raw)
    } catch {
      invalid.push(file)
      continue
    }
    const intent = readIntent(parsed)
    if (intent === null) {
      invalid.push(file)
      continue
    }
    // The file name is the identity. A copied or renamed intent may not re-drive a different
    // (task, epoch) than the one it names.
    if (file !== `${intent.taskId}.${intent.epoch}.json`) {
      invalid.push(file)
      continue
    }
    intents.push(intent)
  }
  return { intents, invalid }
}
