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
 * import.
 */
import { execFile } from "node:child_process"
import { promises as fsPromises } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

import { createCodeGraphRuntime } from "../../../../../web/server/lib/code-graph/runtime.js"
import type { QueryEnvelope } from "../../../../code-graph/src/index.ts"
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

/** The slice of the canonical runtime the tool drives. */
export interface CanonicalRuntime {
  readIndex(directory: string, options?: { readonly block?: boolean }): Promise<CanonicalSummary>
  query(directory: string, input: Record<string, unknown>): Promise<CanonicalAnswer>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asNumberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null

/** Store directory shared with the panel server: `ALCODE_DATA_DIR` when set,
 * else the default user root. Same user, same path, same generations. */
export function resolveCanonicalStoreDir(): string {
  const root =
    process.env.ALCODE_DATA_DIR !== undefined && process.env.ALCODE_DATA_DIR.length > 0
      ? path.resolve(process.env.ALCODE_DATA_DIR)
      : path.join(homedir(), ".config", "alcode")
  return path.join(root, "code-graph-store")
}

type RawRuntimeFactory = (
  deps: { readonly fsPromises: unknown; readonly path: unknown; readonly execFile: unknown },
  options?: { readonly storeDir?: string; readonly blockOnRead?: boolean },
) => {
  readIndex(directory: string, options?: Record<string, unknown>): Promise<unknown>
  query(directory: string, input?: Record<string, unknown>): Promise<unknown>
}

const asFactory = (value: unknown): RawRuntimeFactory => {
  if (typeof value !== "function") throw new Error("canonical code-graph runtime factory is not a function")
  return value as RawRuntimeFactory
}

const toCanonicalSummary = (raw: unknown): CanonicalSummary | null => {
  if (!isRecord(raw)) return null
  if (typeof raw["ready"] !== "boolean") return null
  const state = isRecord(raw["indexState"]) ? asStringOrNull(raw["indexState"]["state"]) : null
  return {
    ready: raw["ready"],
    generation: asNumberOrNull(raw["generation"]),
    projectId: asStringOrNull(raw["projectId"]),
    worktreeId: asStringOrNull(raw["worktreeId"]),
    revision: asStringOrNull(raw["revision"]),
    fingerprint: asStringOrNull(raw["fingerprint"]),
    freshness: typeof raw["freshness"] === "string" ? raw["freshness"] : "unindexed",
    indexTruncated: raw["indexTruncated"] === true,
    nodeCount: typeof raw["nodeCount"] === "number" ? raw["nodeCount"] : 0,
    edgeCount: typeof raw["edgeCount"] === "number" ? raw["edgeCount"] : 0,
    entryCount: typeof raw["entryCount"] === "number" ? raw["entryCount"] : 0,
    entryCap: typeof raw["entryCap"] === "number" ? raw["entryCap"] : 0,
    indexState: state,
  }
}

/** The envelope fields the tool consumes; anything else rides through. */
const toCanonicalAnswer = (raw: unknown): CanonicalAnswer | null => {
  if (!isRecord(raw)) return null
  const envelope = raw as Record<string, unknown> & {
    items?: unknown
    totals?: unknown
    unresolved?: unknown
    unsupported?: unknown
  }
  if (!Array.isArray(envelope.items)) return null
  if (!isRecord(envelope.totals)) return null
  if (!Array.isArray(envelope.unresolved) || !Array.isArray(envelope.unsupported)) return null
  if (typeof envelope["coverage"] !== "string") return null
  return {
    envelope: raw as unknown as QueryEnvelope,
    generation: asNumberOrNull(raw["generation"]),
    freshness: typeof raw["freshness"] === "string" ? raw["freshness"] : "unindexed",
    coverage: envelope["coverage"] as string,
    ready: raw["ready"] !== false,
  }
}

const wrapRawRuntime = (raw: {
  readIndex(directory: string, options?: Record<string, unknown>): Promise<unknown>
  query(directory: string, input?: Record<string, unknown>): Promise<unknown>
}): CanonicalRuntime => ({
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
