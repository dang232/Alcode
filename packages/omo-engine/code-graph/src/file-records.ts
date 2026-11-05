/**
 * Per-file analysis records: the reuse unit for incremental indexing.
 *
 * A record binds one repo-relative file to the content fingerprint it was
 * analyzed from, plus the parser and schema versions that produced it. A
 * rebuild recomputes fingerprints, reuses the shards of unchanged files
 * untouched, and analyzes only the changed set through a subset program.
 * Merging itself lives in lifecycle.rebuildIncremental; this module owns
 * fingerprints, validation, and the persisted records document.
 */
import { createHash } from "node:crypto";

import { SNAPSHOT_STORE_VERSION } from "./snapshot-store";

/**
 * Bump when extraction semantics change (new edge kinds, id shapes, content
 * derivation). Records written under another parser never validate.
 */
export const PARSER_RECORD_VERSION = 1;

/** Records document version. Bump when this shape changes. */
export const FILE_RECORDS_VERSION = 1;

/**
 * Decoded JSON: the boundary type for every untrusted document this module
 * parses. JSON.parse only yields these; the guards below narrow them further.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { readonly [key: string]: JsonValue };

/** Object half of JsonValue: what `isRecord` narrows to. */
type JsonRecord = { readonly [key: string]: JsonValue };

export type FileRecord = {
  /** Repo-relative path with forward slashes, matching shard file keys. */
  readonly file: string;
  /** sha256 hex of the exact bytes analyzed. */
  readonly blob: string;
  /**
   * Byte size and mtimeMs at analysis time: when both still match, reuse
   * skips hashing (git's own racy-clean trust model). Absent on records
   * written before sizes were kept; a hash then decides as before.
   */
  readonly size?: number;
  readonly mtimeMs?: number;
};

export type FileRecordsDoc = {
  readonly version: typeof FILE_RECORDS_VERSION;
  readonly parser: typeof PARSER_RECORD_VERSION;
  readonly schema: typeof SNAPSHOT_STORE_VERSION;
  readonly files: Readonly<Record<string, FileRecord>>;
};

export interface ValidatedFiles {
  readonly reused: ReadonlySet<string>;
  readonly changed: ReadonlySet<string>;
  readonly added: ReadonlySet<string>;
  readonly deleted: ReadonlySet<string>;
}

/** A shard shape sufficient for export-surface comparison. */
export interface SurfaceShard {
  readonly nodes: readonly { readonly id: string; readonly kind: string; readonly target?: string }[];
  readonly edges: readonly { readonly id: string; readonly kind: string }[];
}

/**
 * Deterministic export surface of one file shard: export-contract node
 * identities with alias targets plus export edge identities, sorted. Two
 * snapshots that agree here resolve the file's dependents identically, so
 * importers keep their edges without reanalysis. Line moves, renames,
 * removals, and alias retargets all change the surface; formatting and
 * body-only edits never do. Order across files is the caller's concern.
 */
export function exportSurfaceKey(shard: SurfaceShard): string {
  const parts: string[] = [];
  for (const node of shard.nodes ?? []) {
    if (node.kind === 'export-contract') parts.push(`contract:${node.id}=>${node.target ?? ''}`);
  }
  for (const edge of shard.edges ?? []) {
    if (edge.kind === 'EXPORTS') parts.push(`exports:${edge.id}`);
  }
  return parts.sort().join('\n');
}

export function fingerprintContent(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** sha256 hex of raw file bytes. Bytes, not text: decoding can merge distinct byte sequences. */
export function fingerprintBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Plain-object check without `typeof` (banned by the anti-slop ratchet).
 * `Object(value)` is the identity exactly for objects and functions (every
 * primitive boxes to a fresh wrapper it is not identical to, and nullish
 * values box to `{}`), and functions are excluded because `typeof` classes
 * them apart. Exactly mirrors `typeof value === "object" && value !== null`.
 */
const isRecord = (value: JsonValue | null | undefined): value is JsonRecord =>
  !Array.isArray(value) && value === Object(value) && !(Object(value) instanceof Function);

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Primitive-string check without `typeof`: `String(value)` is the identity
 * exactly for primitive strings (every other input converts to a primitive
 * it is not identical to, including String objects; `String(symbol)` never
 * throws). Exactly mirrors `typeof value === "string"`.
 */
const isHex64 = (value: JsonValue | null | undefined): value is string => {
  const text = String(value);
  return text === value && HEX64.test(text);
};

/** Parse an untrusted records document; corrupt input is refused, never guessed. */
export function parseFileRecordsDoc(value: JsonValue | FileRecordsDoc | null | undefined): FileRecordsDoc | null {
  if (!isRecord(value)) return null;
  if (value.version !== FILE_RECORDS_VERSION) return null;
  if (value.parser !== PARSER_RECORD_VERSION) return null;
  if (value.schema !== SNAPSHOT_STORE_VERSION) return null;
  if (!isRecord(value.files)) return null;
  const files: Record<string, FileRecord> = {};
  for (const [key, entry] of Object.entries(value.files)) {
    // Object.entries keys are always strings; only the empty file name is corrupt.
    if (key.length === 0) return null;
    if (!isRecord(entry)) return null;
    if (entry.file !== key || !isHex64(entry.blob)) return null;
    // Malformed stats fall back to the hash path; only finite numbers
    // enable the fast path, and the blob still decides on any mismatch.
    const size = entry.size;
    const mtimeMs = entry.mtimeMs;
    // SAFETY: Number.isFinite is true only for finite numbers, so both
    // asserted values are numbers here; the range checks stay numeric.
    const stat =
      Number.isFinite(size) &&
      Number.isFinite(mtimeMs) &&
      (size as number) >= 0 &&
      (mtimeMs as number) >= 0
        ? { size: size as number, mtimeMs: mtimeMs as number }
        : undefined;
    files[key] = stat === undefined ? { file: key, blob: entry.blob } : { file: key, blob: entry.blob, ...stat };
  }
  return { version: FILE_RECORDS_VERSION, parser: PARSER_RECORD_VERSION, schema: SNAPSHOT_STORE_VERSION, files };
}

export function serializeFileRecordsDoc(doc: FileRecordsDoc): string {
  const files: Record<string, FileRecord> = {};
  for (const key of Object.keys(doc.files).sort()) {
    const entry = doc.files[key];
    files[key] =
      entry.size !== undefined && entry.mtimeMs !== undefined
        ? { file: entry.file, blob: entry.blob, size: entry.size, mtimeMs: entry.mtimeMs }
        : { file: entry.file, blob: entry.blob };
  }
  return JSON.stringify({ version: doc.version, parser: doc.parser, schema: doc.schema, files });
}

/**
 * Partition current files against validated records. An incompatible or
 * corrupt document validates nothing: every file reads as added and the
 * caller rebuilds fully. Renames surface as a delete plus an add, which is
 * always correct though it reanalyzes both sides.
 */
export function validateFileRecords(
  doc: FileRecordsDoc | null,
  current: ReadonlyMap<string, string>,
): ValidatedFiles {
  const reused = new Set<string>();
  const changed = new Set<string>();
  const added = new Set<string>();
  const deleted = new Set<string>();
  if (doc === null) {
    for (const file of current.keys()) added.add(file);
    return { reused, changed, added, deleted };
  }
  for (const [file, blob] of current) {
    const record = doc.files[file];
    if (record === undefined) added.add(file);
    else if (record.blob === blob) reused.add(file);
    else changed.add(file);
  }
  for (const file of Object.keys(doc.files)) {
    if (!current.has(file)) deleted.add(file);
  }
  return { reused, changed, added, deleted };
}
