import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  createRecord,
  renderRecordFile,
  type CreateRecordResult,
  type NewKnowledgeInput,
  type ProjectKnowledgeRecord,
} from "../../../../memory-core/src/project-knowledge/record.ts"
import { evaluatePromotion } from "../../../../memory-core/src/project-knowledge/validator.ts"
import { ensureProjectKnowledgeStore, PROJECT_KNOWLEDGE_ROOT_ENV_VAR, resolveProjectKnowledgeRoot } from "../../../../memory-core/src/project-knowledge/store-home.ts"
import { resolveProjectIdentity } from "../../../../memory-core/src/project-knowledge/identity.ts"
import { deriveKnowledgeCandidate, type KnowledgeCandidate } from "./knowledge-feedback"
import { dagFingerprint, nodeFingerprintInput } from "../fingerprint"
import { nodeFingerprintFromInput } from "../manager"
import type { TaskUnderstanding } from "./types"
import type { DagVerificationRecord } from "../verification"

export type AcceptedRunKnowledgeInput = {
  readonly runId: string
  readonly generation: number
  readonly revision: string
  readonly accepted: boolean
  readonly at: string
  readonly checks: readonly { readonly nodeId: string; readonly checkId: string }[]
  readonly records: readonly DagVerificationRecord[]
  readonly nodeAttempts: ReadonlyMap<string, number>
  readonly nodeScopes: ReadonlyMap<string, readonly string[]>
  readonly nodeFingerprints: ReadonlyMap<string, string>
  readonly directory: string
  readonly env?: Record<string, string | undefined>
}

function blobSha256AtRevision(directory: string, revision: string, file: string): string | undefined {
  try {
    const content = execFileSync("git", ["-C", directory, "show", `${revision}:${file}`], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
      windowsHide: true,
    })
    return createHash("sha256").update(content).digest("hex")
  } catch {
    return undefined
  }
}

export type KnowledgeLifecycleResult =
  | { readonly status: "persisted"; readonly id: string; readonly path: string }
  | { readonly status: "duplicate"; readonly id: string }
  | { readonly status: "rejected"; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: string }

// A candidate needs a genuine execution that PASSED, belongs to this accepted run and generation,
// and landed on a node that needed more than one attempt. The record's own sourceRevision is the
// definition fingerprint (the dag engine's freshness anchor), never the git revision, so freshness
// here is run identity plus node fingerprint; the git revision that retrieval compares against is
// the accepted run's revision, which becomes the record's sourceRevision.
function retriedPassingRecord(input: AcceptedRunKnowledgeInput): DagVerificationRecord | undefined {
  for (const record of input.records) {
    if (record.runId !== input.runId) continue
    if (record.generation !== input.generation) continue
    if (record.status !== "passed" || record.started !== true || record.exitCode !== 0) continue
    if ((input.nodeAttempts.get(record.nodeId) ?? 1) < 2) continue
    const fingerprint = input.nodeFingerprints.get(record.nodeId)
    if (fingerprint !== undefined && fingerprint.length > 0 && record.nodeFingerprint !== fingerprint) continue
    return record
  }
  return undefined
}

function understandingFor(input: AcceptedRunKnowledgeInput, sourceFile: string, revision: string): TaskUnderstanding {
  const files = new Set<string>([sourceFile])
  for (const scope of input.nodeScopes.values()) for (const file of scope) files.add(file)
  const at = input.at
  const symbols = [...files].map((file) => ({
    id: `file:${file}`,
    kind: "file" as const,
    name: file,
    file,
    line: 1,
    confidence: 1,
    resolved: true,
  }))
  return {
    scope: {
      projectId: resolveProjectIdentity(input.directory, {}).projectId,
      worktreeId: input.directory,
      revision,
      fingerprint: `run:${input.runId}`,
    },
    symbols,
    advisorySymbols: [],
    edges: [],
    impacted: [],
    tests: [],
    constraints: [],
    uncertainties: [],
    hunks: [],
    changes: [],
    freshness: "fresh",
    revision: input.revision,
    diagnostics: [],
    at,
  } as unknown as TaskUnderstanding
}

export function deriveAcceptedKnowledgeCandidate(
  input: AcceptedRunKnowledgeInput,
): { readonly candidate: KnowledgeCandidate; readonly sourceFile: string } | undefined {
  if (!input.accepted) return undefined
  const record = retriedPassingRecord(input)
  if (record === undefined) return undefined
  const scope = input.nodeScopes.get(record.nodeId) ?? []
  // A node's declared write scope names the produced file; a check that declares its own coverage
  // names the same file when the node declared none. Both are real provenance, and an empty pair
  // means the finding has no file to bind to, so it is not knowledge.
  const sourceFile = scope[0] ?? (record.coveredPaths ?? [])[0]
  if (sourceFile === undefined) return undefined
  const claim = `${record.checkId} failed on an earlier attempt and passes after the repair, so ${sourceFile} is verified at revision ${input.revision.slice(0, 12)}.`
  const candidate = deriveKnowledgeCandidate({
    claim,
    sourceFile,
    understanding: understandingFor(input, sourceFile, record.sourceRevision),
    acceptance: { accepted: true, reasons: [] },
    records: input.records,
    current: {
      // The verification record's revision is the plan fingerprint the dag engine stamps; freshness
      // inside the engine compares like with like. The git revision is what retrieval compares
      // against, so it is applied when the record is mapped, not here.
      sourceRevision: record.sourceRevision,
      nodeFingerprints: input.nodeFingerprints,
      generation: input.generation,
    },
    latestAttempts: input.nodeAttempts,
    at: input.at,
  })
  return candidate === undefined ? undefined : { candidate, sourceFile }
}

export function mapCandidateToRecord(
  candidate: KnowledgeCandidate,
  context: {
    readonly projectId: string
    readonly sourceSymbol: string
    readonly sourceBlobSha256: string
    readonly writeScopes: readonly string[]
    readonly sourceRevision?: string
  },
): CreateRecordResult {
  const input: NewKnowledgeInput = {
    projectId: context.projectId,
    claim: candidate.claim,
    sourceFile: candidate.sourceFile,
    sourceSymbol: context.sourceSymbol,
    sourceRevision: context.sourceRevision ?? candidate.sourceRevision,
    sourceBlobSha256: context.sourceBlobSha256,
    category: "unverified-hypothesis",
    observedAt: candidate.at,
    validatedAt: candidate.at,
    validationMethod: "test-pass",
    confidence: 1,
    scope: { writeScopes: [...context.writeScopes] },
    invalidationConditions: ["SRC-EDIT"],
    supersedes: null,
  }
  return createRecord(input)
}

export type AcceptedRunHookInput = {
  readonly snapshot: import("../types").DagRunRecordV1
  readonly store: import("../store").DagFileStore
  readonly revision: string
  readonly at: string
  readonly directory: string
}

/**
 * Default hook body for the scheduler seam: reads the run's persisted verification records and
 * hands them to the lifecycle. Shaped for `DagSchedulerOptions.knowledgeHook`.
 */
export async function recordAcceptedRunKnowledgeFromStore(
  input: AcceptedRunHookInput,
  env?: Record<string, string | undefined>,
): Promise<KnowledgeLifecycleResult> {
  const { readRunVerificationRecords } = await import("../verification")
  const collected = readRunVerificationRecords(input.store, input.snapshot.runId)
  const records = [...collected.records.values()]
  const nodeAttempts = new Map<string, number>()
  const nodeScopes = new Map<string, readonly string[]>()
  const nodeFingerprints = new Map<string, string>()
  const checks: { nodeId: string; checkId: string }[] = []
  for (const node of input.snapshot.nodes) {
    nodeAttempts.set(node.id, node.attempt)
    nodeScopes.set(node.id, node.writeScopes)
    const persisted = input.snapshot.definition.nodes.find((entry) => entry.id === node.id)
    nodeFingerprints.set(
      node.id,
      persisted === undefined
        ? input.snapshot.definitionFingerprint
        : dagFingerprint(nodeFingerprintInput(nodeFingerprintFromInput(persisted))),
    )
  }
  for (const record of records) {
    checks.push({ nodeId: record.nodeId, checkId: record.checkId })
  }
  return recordAcceptedRunKnowledge({
    runId: input.snapshot.runId,
    generation: input.snapshot.generation,
    revision: input.revision,
    accepted: input.snapshot.status === "completed",
    at: input.at,
    checks,
    records,
    nodeAttempts,
    nodeScopes,
    nodeFingerprints,
    directory: input.directory,
    env,
  })
}

/**
 * Production registration for the scheduler's accepted-run seam. The store boundary is enforced
 * here: a test runtime that names no store gets a typed refusal instead of a write into the user's
 * real home, while production resolves the documented default through the store-home contract.
 */
export function productionKnowledgeHook(
  env: Record<string, string | undefined> = process.env,
): (input: AcceptedRunHookInput) => Promise<KnowledgeLifecycleResult> {
  return async (input) => {
    const override = env[PROJECT_KNOWLEDGE_ROOT_ENV_VAR]?.trim()
    if (env.NODE_ENV === "test" && (override === undefined || override.length === 0)) {
      return { status: "unavailable", reason: "test-runtime-requires-explicit-store" }
    }
    return recordAcceptedRunKnowledgeFromStore(input, env)
  }
}

function atomicWrite(root: string, record: ProjectKnowledgeRecord): { path: string } {
  mkdirSync(root, { recursive: true })
  const target = join(root, `${record.id}.md`)
  const staging = `${target}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(staging, renderRecordFile(record), "utf8")
  renameSync(staging, target)
  return { path: target }
}

/**
 * Full lifecycle for one accepted run: derive from verified evidence, map to a record,
 * promote against the current revision, then persist atomically and idempotently.
 * Never throws and never flips task success: every failure is a typed result.
 */
export function recordAcceptedRunKnowledge(input: AcceptedRunKnowledgeInput): KnowledgeLifecycleResult {
  const derived = deriveAcceptedKnowledgeCandidate(input)
  if (derived === undefined) return { status: "rejected", reason: "no-verified-finding" }

  const env = input.env ?? process.env
  const identity = resolveProjectIdentity(input.directory, {})
  const home = ensureProjectKnowledgeStore(resolveProjectKnowledgeRoot(env, input.directory))
  if (!home.ok) return { status: "unavailable", reason: `store-unwritable: ${home.message}` }

  const blob = blobSha256AtRevision(input.directory, input.revision, derived.sourceFile)
  if (blob === undefined) return { status: "rejected", reason: "source-unreadable-at-revision" }
  const created = mapCandidateToRecord(derived.candidate, {
    projectId: identity.projectId,
    sourceSymbol: "file",
    sourceBlobSha256: blob,
    writeScopes: [derived.sourceFile],
    sourceRevision: input.revision,
  })
  if (created.kind !== "created") return { status: "rejected", reason: created.reason }

  const target = join(home.root, `${created.record.id}.md`)
  if (existsSync(target)) return { status: "duplicate", id: created.record.id }

  const promoted = evaluatePromotion(
    created.record,
    {
      probe: {
        source: "head-tree",
        revision: input.revision,
        symbolResolved: true,
        blobSha256: blob,
        revisionReachable: true,
      },
      secretClean: true,
    },
    input.at,
  )
  if (promoted.outcome !== "promoted") {
    return { status: "rejected", reason: `promotion-${promoted.outcome}: ${promoted.failedChecks.join(",")}` }
  }

  const written = atomicWrite(home.root, promoted.record)
  return { status: "persisted", id: promoted.record.id, path: written.path }
}
