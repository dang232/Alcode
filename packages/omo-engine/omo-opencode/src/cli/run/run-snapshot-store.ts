// run-snapshot-store.ts — the one mutation protocol for `.omo/dag-runs/*.snapshot.json`.
// Every writer (delivery projector, chat POST /snapshot, reconciler) goes through
// `mutateRunSnapshot`, so publish mechanics, validation, fencing and the lock are
// defined once instead of per caller.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Type, type Static } from "typebox"
import { Value } from "typebox/value"

import { withTaskRecordLock } from "../../../../senpi-task/src/store/record-lock"

export const DAG_RUNS_DIRNAME = "dag-runs"
export const DAG_SNAPSHOT_SCHEMA_VERSION = 1

/** A node inside a run row. Known fields are typed; a writer may add its own. */
export const SnapshotNodeSchema = Type.Object(
  {
    task_id: Type.Optional(Type.String()),
    state: Type.Optional(Type.String()),
    verification_status: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

/** A run row, keyed by `run_id`. */
export const SnapshotRunSchema = Type.Object(
  {
    run_id: Type.Optional(Type.String()),
    run_key: Type.Optional(Type.String()),
    source: Type.Optional(Type.String()),
    nodes: Type.Optional(Type.Array(SnapshotNodeSchema)),
  },
  { additionalProperties: true },
)

export const SnapshotDocumentSchema = Type.Object(
  {
    schemaVersion: Type.Number(),
    sessionId: Type.String(),
    updatedAt: Type.String(),
    directory: Type.Optional(Type.String()),
    dag: Type.Object({ runs: Type.Array(SnapshotRunSchema) }, { additionalProperties: true }),
    tasks: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: true },
)

const SchemaVersionProbe = Type.Object({ schemaVersion: Type.Number() }, { additionalProperties: true })

export type SnapshotNode = Static<typeof SnapshotNodeSchema>
export type SnapshotRun = Static<typeof SnapshotRunSchema>
export type SnapshotDocument = Static<typeof SnapshotDocumentSchema>

export type SnapshotMutation<T> =
  | { readonly doc: SnapshotDocument; readonly value: T }
  | { readonly refuse: string }

export type SnapshotWrite<T> =
  | { readonly written: true; readonly path: string; readonly value: T }
  | { readonly written: false; readonly reason: string }

export type SnapshotRejectionKind = "malformed" | "foreign" | "unreadable"

export type ExistingSnapshot =
  | { readonly doc: SnapshotDocument | null; readonly raw?: string }
  | { readonly doc: null; readonly reason: string; readonly kind: SnapshotRejectionKind }

export function snapshotPathFor(directory: string, sessionId: string): string {
  return join(directory, ".omo", DAG_RUNS_DIRNAME, `${sessionId.trim()}.snapshot.json`)
}

export function isSafeSessionSegment(sessionId: string): boolean {
  const trimmed = sessionId.trim()
  return trimmed.length > 0 && !/[\\/]/.test(trimmed) && !trimmed.includes("..")
}

const decodeJson = (raw: string): SnapshotDocument | null => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const readFailureCode = (error: Error): string | undefined => {
  if (!("code" in error)) return undefined
  const code = error.code
  return String(code) === code ? code : undefined
}

/**
 * Reads and validates a snapshot. A missing file is an empty document; anything
 * unreadable, unparseable, of another schema version, or without `dag.runs` is a
 * refusal, never an empty document — a writer must not overwrite what it cannot read.
 */
export function readRunSnapshot(path: string, readFile: (path: string) => string): ExistingSnapshot {
  let raw: string
  try {
    raw = readFile(path)
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught))
    const code = readFailureCode(error)
    if (code === "ENOENT" || code === "ENOTDIR") return { doc: null }
    return { doc: null, reason: `existing snapshot is unreadable (${String(code ?? "read failed")})`, kind: "unreadable" }
  }

  const decoded = decodeJson(raw)
  if (decoded === null) return { doc: null, reason: "existing snapshot is not valid JSON", kind: "malformed" }
  if (!Value.Check(SnapshotDocumentSchema, decoded)) {
    const claimed = Value.Check(SchemaVersionProbe, decoded) ? decoded.schemaVersion : null
    return {
      doc: null,
      reason: `existing snapshot does not match the schema (schemaVersion ${String(claimed)})`,
      kind: claimed === DAG_SNAPSHOT_SCHEMA_VERSION ? "malformed" : "foreign",
    }
  }
  // SAFETY: Value.Check above validated `decoded` against SnapshotDocumentSchema.
  return { doc: decoded as SnapshotDocument, raw }
}

/** Publishes `doc` atomically: unique temp file in the same directory, then rename. */
export function publishSnapshot(path: string, doc: SnapshotDocument): SnapshotWrite<SnapshotDocument> {
  const serialized = `${JSON.stringify(doc, null, 1)}\n`
  try {
    mkdirSync(join(path, ".."), { recursive: true })
    const temp = `${path}.${process.pid.toString(36)}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`
    writeFileSync(temp, serialized, "utf8")
    renameSync(temp, path)
    return { written: true, path, value: doc }
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught))
    return { written: false, reason: error.message }
  }
}

/**
 * The single mutation protocol. Acquires the shared record lock for the snapshot
 * path, reads the LATEST document inside the lock, lets the caller mutate it,
 * refuses when the current bytes changed under the merge, then publishes atomically.
 *
 * A caller that only tweaks one row never rebuilds unrelated rows, so a concurrent
 * writer of a different row cannot be erased by this one.
 */
export function mutateRunSnapshot<T>(input: {
  readonly path: string
  readonly updatedAt: string
  readonly mutate: (existing: { readonly doc: SnapshotDocument | null }) => SnapshotMutation<T>
  readonly readFile?: (path: string) => string
  readonly attemptLimit?: number
  readonly replaceMalformed?: boolean
}): SnapshotWrite<T> {
  const readFile = input.readFile ?? ((path: string) => readFileSync(path, "utf8"))
  const attemptLimit = input.attemptLimit ?? 3

  const attemptOnce = (): SnapshotWrite<T> => {
    const existing = readRunSnapshot(input.path, readFile)
    if (existing.doc === null && "reason" in existing) {
      if (!(input.replaceMalformed === true && existing.kind === "malformed")) {
        return { written: false, reason: existing.reason }
      }
    }
    const doc = existing.doc
    const mutation = input.mutate({ doc })
    if ("refuse" in mutation) return { written: false, reason: mutation.refuse }

    const next: SnapshotDocument = { ...mutation.doc, updatedAt: input.updatedAt }
    if (doc !== null && existing.raw !== undefined) {
      const comparable = `${JSON.stringify({ ...next, updatedAt: doc.updatedAt }, null, 1)}\n`
      if (comparable === existing.raw) return { written: false, reason: "snapshot already current" }
    }

    const fresh = readRunSnapshot(input.path, readFile)
    const freshMalformed = input.replaceMalformed === true && fresh.doc === null && "kind" in fresh && fresh.kind === "malformed"
    if (fresh.doc === null && "reason" in fresh && !freshMalformed) return { written: false, reason: fresh.reason }
    if ((fresh.raw ?? "") !== (existing.raw ?? "")) {
      return { written: false, reason: "snapshot changed under the merge" }
    }

    const published = publishSnapshot(input.path, next)
    return published.written
      ? { written: true, path: published.path, value: mutation.value }
      : { written: false, reason: published.reason }
  }

  try {
    for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
      const result = withTaskRecordLock(input.path, attemptOnce)
      if (result.written || result.reason !== "snapshot changed under the merge") return result
    }
    return { written: false, reason: "snapshot kept changing under the merge" }
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught))
    return { written: false, reason: `snapshot lock unavailable: ${error.message}` }
  }
}
