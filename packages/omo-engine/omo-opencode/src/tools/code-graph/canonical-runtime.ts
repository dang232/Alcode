/**
 * canonical-runtime.ts — the `code_graph` agent tool's bridge to the one
 * canonical Code Graph service.
 *
 * The tool used to walk the repository and build a throwaway engine graph
 * per query. It now shares the server-side runtime
 * (`packages/web/server/lib/code-graph/runtime.js`) and its persisted
 * generations: same implementation, same store directory, same generation
 * manifests as the panel. No HTTP hop (the server may be absent in agent
 * contexts), no new manifest, snapshot format, or discovery pipeline.
 *
 * Every answer crossing this boundary is shape-checked before use: the
 * runtime is untyped JavaScript, so trust ends at validation, never at
 * import. Validation runs through zod schemas (the same I/O-boundary
 * decoding the tool args use), never through ad hoc checks, so the raw
 * wire values are never narrowed by hand.
 */
import { execFile } from "node:child_process"
import { promises as fsPromises } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { z } from "zod"

import { createCodeGraphRuntime } from "../../../../../web/server/lib/code-graph/runtime.js"
import type { QueryEnvelope } from "../../../../code-graph/src/index.ts"
import type { OmoJsonValue } from "../../plugin-types.ts"
import type { CodeGraphToolDeps } from "./code-graph.ts"

/** Narrow, validated view of one canonical answer. */
export interface CanonicalAnswer {
  readonly envelope: QueryEnvelope
  readonly generation: number | null
  readonly freshness: string
  readonly coverage: string
  readonly ready: boolean
}

/** Narrow, validated view of one canonical index summary. */
export interface CanonicalSummary {
  readonly ready: boolean
  readonly generation: number | null
  readonly projectId: string | null
  readonly worktreeId: string | null
  readonly revision: string | null
  readonly fingerprint: string | null
  readonly freshness: string
  readonly indexTruncated: boolean
  readonly nodeCount: number
  readonly edgeCount: number
  readonly entryCount: number
  readonly entryCap: number
  readonly indexState: string | null
}

/** Options the tool passes to the canonical readIndex call. */
interface CanonicalReadOptions {
  readonly block?: boolean
}

/** Query shapes the tool sends; every field is optional because kinds differ. */
interface CanonicalQueryInput {
  readonly kind?: string
  readonly query?: string
  readonly symbol?: string
  readonly file?: string
  readonly from?: string
  readonly to?: string
  readonly target?: string
  readonly limit?: number
  readonly depth?: number
}

/** The slice of the canonical runtime the tool drives. */
export interface CanonicalRuntime {
  readIndex(directory: string, options?: CanonicalReadOptions): Promise<CanonicalSummary>
  query(directory: string, input?: CanonicalQueryInput): Promise<CanonicalAnswer>
}

/** Values that may arrive from the untyped JS runtime: wire JSON or a typed envelope. */
type WireInput = OmoJsonValue | QueryEnvelope

/** Validated view of one JSON object from the wire. */
interface WireObject {
  readonly [key: string]: OmoJsonValue
}

const WireObjectSchema = z.custom<WireObject>(
  (candidate) => candidate !== null && !Array.isArray(candidate) && candidate instanceof Object,
)

export const wireObjectOf = (value: WireInput): WireObject | null => {
  const parsed = WireObjectSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Finite numbers only: the wire never means NaN or Infinity for a real count or id. */
export const FiniteNumberSchema = z.number().refine((candidate) => Number.isFinite(candidate))

const NumberSchema = z.number()

const StringSchema = z.string()

const BooleanSchema = z.boolean()

const stringOrNull = (value: OmoJsonValue): string | null => {
  const parsed = StringSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

const finiteOrNull = (value: OmoJsonValue): number | null => {
  const parsed = FiniteNumberSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

const countOrZero = (value: OmoJsonValue): number => {
  const parsed = NumberSchema.safeParse(value)
  return parsed.success ? parsed.data : 0
}

/** Store directory shared with the panel server: `ALCODE_DATA_DIR` when set,
 * else the default user root. Same user, same path, same generations. */
function resolveCanonicalStoreDir(): string {
  const root =
    process.env.ALCODE_DATA_DIR !== undefined && process.env.ALCODE_DATA_DIR.length > 0
      ? path.resolve(process.env.ALCODE_DATA_DIR)
      : path.join(homedir(), ".config", "alcode")
  return path.join(root, "code-graph-store")
}

/** Static shape of the untyped JS runtime module's factory export. */
type ImportedRuntimeFactory = typeof createCodeGraphRuntime

/** Dependencies the JS runtime factory receives from the tool host. */
interface RawRuntimeDeps {
  readonly fsPromises: typeof fsPromises
  readonly path: typeof path
  readonly execFile: typeof execFile
}

/** Options the JS runtime factory accepts. */
interface RawRuntimeOptions {
  readonly storeDir?: string
  readonly blockOnRead?: boolean
}

/** Unvalidated wire answers of the raw JS runtime. */
interface RawRuntime {
  readIndex(directory: string, options?: CanonicalReadOptions): Promise<OmoJsonValue>
  query(directory: string, input?: CanonicalQueryInput): Promise<OmoJsonValue>
}

type RawRuntimeFactory = (deps: RawRuntimeDeps, options?: RawRuntimeOptions) => RawRuntime

const asFactory = (value: ImportedRuntimeFactory): RawRuntimeFactory => {
  if (!(value instanceof Function)) throw new Error("canonical code-graph runtime factory is not a function")
  // SAFETY: instanceof Function checked the callable shape; every answer the factory
  // produces is re-validated through zod before the tool reads a single field.
  return value as RawRuntimeFactory
}

const toCanonicalSummary = (raw: OmoJsonValue): CanonicalSummary | null => {
  const wire = wireObjectOf(raw)
  if (wire === null) return null
  const ready = BooleanSchema.safeParse(wire["ready"])
  if (!ready.success) return null
  const indexState = wireObjectOf(wire["indexState"])
  return {
    ready: ready.data,
    generation: finiteOrNull(wire["generation"]),
    projectId: stringOrNull(wire["projectId"]),
    worktreeId: stringOrNull(wire["worktreeId"]),
    revision: stringOrNull(wire["revision"]),
    fingerprint: stringOrNull(wire["fingerprint"]),
    freshness: stringOrNull(wire["freshness"]) ?? "unindexed",
    indexTruncated: wire["indexTruncated"] === true,
    nodeCount: countOrZero(wire["nodeCount"]),
    edgeCount: countOrZero(wire["edgeCount"]),
    entryCount: countOrZero(wire["entryCount"]),
    entryCap: countOrZero(wire["entryCap"]),
    indexState: indexState === null ? null : stringOrNull(indexState["state"]),
  }
}

/** The envelope fields the tool consumes; anything else rides through. */
const toCanonicalAnswer = (raw: WireInput): CanonicalAnswer | null => {
  const wire = wireObjectOf(raw)
  if (wire === null) return null
  if (!Array.isArray(wire["items"])) return null
  if (wireObjectOf(wire["totals"]) === null) return null
  if (!Array.isArray(wire["unresolved"])) return null
  if (!Array.isArray(wire["unsupported"])) return null
  const coverage = StringSchema.safeParse(wire["coverage"])
  if (!coverage.success) return null
  // SAFETY: items/totals/unresolved/unsupported/coverage passed structural checks above;
  // the remaining envelope fields ride through untouched into the agent-context builder.
  const envelope = raw as QueryEnvelope
  return {
    envelope,
    generation: finiteOrNull(wire["generation"]),
    freshness: stringOrNull(wire["freshness"]) ?? "unindexed",
    coverage: coverage.data,
    ready: wire["ready"] !== false,
  }
}

const wrapRawRuntime = (raw: RawRuntime): CanonicalRuntime => ({
  readIndex: async (directory, options = {}) => {
    const summary = toCanonicalSummary(await raw.readIndex(directory, { ...options }))
    if (summary === null) throw new Error("canonical code-graph readIndex answered outside its contract")
    return summary
  },
  query: async (directory, input = {}) => {
    const answer = toCanonicalAnswer(await raw.query(directory, { ...input }))
    if (answer === null) throw new Error("canonical code-graph query answered outside its contract")
    return answer
  },
})

const sharedByStoreDir = new Map<string, CanonicalRuntime>()

/** Tool-injected runtime wins (tests); otherwise one shared runtime per store directory. */
export function getCanonicalRuntime(deps: CodeGraphToolDeps = {}): CanonicalRuntime {
  if (deps.runtime !== undefined) return deps.runtime
  const storeDir = deps.storeDir ?? resolveCanonicalStoreDir()
  const existing = sharedByStoreDir.get(storeDir)
  if (existing !== undefined) return existing
  const created = wrapRawRuntime(
    asFactory(createCodeGraphRuntime)({ fsPromises, path, execFile }, { storeDir, blockOnRead: false }),
  )
  sharedByStoreDir.set(storeDir, created)
  return created
}
