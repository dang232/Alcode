/**
 * plan-evidence.ts - bounded, task-specific evidence for the model planner.
 *
 * Alcode's run path (runner.ts) composes the request that the planning agent receives.
 * This module builds the evidence block that rides that request: real code-graph query
 * results over the run directory plus project-knowledge records, narrowed to one task and
 * capped in bytes. Everything here is optional at the boundary: when the graph, the
 * revision, or the knowledge is unusable, the block is absent and the caller sends the
 * original message unchanged.
 */

import { resolveProjectIdentity } from "../../../../memory-core/src/project-knowledge/identity.ts"
import { createHash } from "node:crypto"
import { promises as fs, type Dirent } from "node:fs"
import path from "node:path"

import {
  computeScopeFingerprint,
  findTests,
  impact,
  indexFiles,
  search,
  symbolContext,
  type FindTestsResult,
  type GraphSnapshot,
  type ImpactResult,
  type QueryEnvelope,
  type QueryItem,
  type QueryOptions,
  type SymbolContextResult,
} from "../../../../code-graph/src/index.ts"
import type { GraphContextLevel } from "./graph-policy.ts"
import {
  PROJECT_KNOWLEDGE_DIR,
  RECORD_FILE_EXTENSION,
  parseRecordFile,
} from "../../../../memory-core/src/project-knowledge/record.ts"
import { derivePlanHints, renderPlanEvidence } from "../../../../senpi-task/src/dag/intelligence/plan-evidence.ts"
import { buildTaskUnderstanding } from "../../../../senpi-task/src/dag/intelligence/understanding.ts"
import type {
  EvidenceEnvelopeInput,
  EvidenceItemInput,
  FindTestsEnvelopeInput,
  ImpactEnvelopeInput,
  KnowledgeRecordInput,
  PlanHints,
  SymbolContextEnvelopeInput,
  TaskUnderstanding,
  TaskUnderstandingQueries,
  UnderstandingScope,
} from "../../../../senpi-task/src/dag/intelligence/types.ts"

export const PLAN_EVIDENCE_DISABLED_ENV = "OMO_PLAN_EVIDENCE"
export const PLAN_EVIDENCE_KNOWLEDGE_ENV = "OMO_PLAN_EVIDENCE_KNOWLEDGE"
export const PLAN_EVIDENCE_MAX_BYTES = 4096
export const PLAN_EVIDENCE_MAX_FILES = 2000
/**
 * Files a level may index. Measured on the Alwork tree: 120 files ~7.4 s cold
 * (~6 s of it is the TypeScript extraction start) and 240 files ~14.4 s, so an
 * uncapped walk turns one user message into a minute of work. Levels buy
 * bounded cost, not full-repo coverage; a persisted generation is the path to
 * both and is tracked as a limitation in the Phase 3 report.
 */
export const PLAN_EVIDENCE_LEVEL_MAX_FILES: Record<1 | 2 | 3, number> = {
  1: 120,
  2: 400,
  3: 800,
}
export const PLAN_EVIDENCE_MAX_KEYWORDS = 8
export const PLAN_EVIDENCE_MAX_SUBJECTS = 3

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  "vendor",
  "__pycache__",
  ".venv",
])
const KEYWORD_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "when", "then", "than",
  "have", "has", "had", "will", "would", "should", "could", "make", "made", "need",
  "needs", "please", "task", "work", "code", "file", "files", "fix", "update",
  "implement", "change", "changes", "using", "use", "our", "your", "you", "are", "was",
  "were", "been", "being", "but", "not", "all", "any", "can", "may", "must", "about",
  "how", "name", "trace", "through", "only", "every", "what", "which", "where", "why",
  "list", "tell", "before", "after", "state", "include", "including", "also", "them",
])

export type PlannerEvidenceDiagnostics = {
  readonly reason?: string
  readonly files: number
  readonly indexedFiles: number
  readonly keywords: readonly string[]
  readonly subjects: readonly string[]
  readonly durationMs: number
  readonly scope?: UnderstandingScope
  readonly knowledgeRecords: number
  readonly knowledgeExcluded: number
}

export type PlannerEvidence = {
  readonly status: "available" | "unavailable"
  readonly text?: string
  readonly bytes: number
  readonly understanding?: TaskUnderstanding
  readonly hints?: PlanHints
  readonly diagnostics: PlannerEvidenceDiagnostics
}

export type PlannerEvidenceOptions = {
  readonly message: string
  readonly directory: string
  readonly maxBytes?: number
  readonly maxFiles?: number
  readonly maxSubjects?: number
  /**
   * When false, the block carries confirmed symbols only: impact and
   * findTests sections are omitted so lower levels send less request text.
   * Defaults to true to preserve the pre-level request shape.
   */
  readonly includeImpactAndTests?: boolean
  readonly knowledge?: readonly KnowledgeRecordInput[]
  readonly knowledgeRoot?: string
  /** Trusted project for this request; defaults to the repository identity of `directory`. */
  readonly projectId?: string
}

export type PlannerTurnInput = {
  readonly message: string
  readonly directory: string
  readonly strategy: string
  readonly enabled?: boolean
  /** Trusted project for this request; defaults to the repository identity of `directory`. */
  readonly projectId?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly maxBytes?: number
  /** Graph preflight level: 0 sends the original message untouched. */
  readonly level?: GraphContextLevel
  readonly maxSubjects?: number
  readonly includeImpactAndTests?: boolean
}

export type PlannerTurn = {
  readonly promptText: string
  readonly evidence?: PlannerEvidence
  readonly skipped?: "disabled" | "disabled-env" | "strategy-direct" | string
}

export function isPlanningStrategy(strategy: string): boolean {
  return strategy !== "direct"
}

export function isPlanEvidenceEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = env[PLAN_EVIDENCE_DISABLED_ENV]
  if (raw === undefined) return true
  const normalized = raw.trim().toLowerCase()
  return normalized !== "0" && normalized !== "false" && normalized !== "off"
}

export function extractTaskKeywords(message: string, limit = PLAN_EVIDENCE_MAX_KEYWORDS): string[] {
  const seen = new Set<string>()
  const words = message.toLowerCase().match(/[a-z_][a-z0-9_.-]{2,}/g) ?? []
  const keywords: string[] = []
  const push = (word: string): void => {
    if (KEYWORD_STOPWORDS.has(word) || seen.has(word)) return
    seen.add(word)
    keywords.push(word)
  }
  for (const word of words) {
    push(word)
    if (keywords.length >= limit) break
  }
  return keywords
}

function splitHyphenatedKeywords(message: string): string[] {
  const joined: string[] = []
  for (const word of message.toLowerCase().match(/[a-z_][a-z0-9_]*\.[a-z0-9]+|[a-z_][a-z0-9_.-]{2,}/g) ?? []) {
    const compact = word.replace(/-/g, "")
    if (compact !== word) joined.push(compact)
  }
  return joined
}

export async function collectSourceFiles(
  directory: string,
  maxFiles = PLAN_EVIDENCE_MAX_FILES,
): Promise<string[]> {
  const collected: string[] = []
  const walk = async (current: string): Promise<void> => {
    if (collected.length >= maxFiles) return
    let entries: Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (collected.length >= maxFiles) return
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue
        await walk(path.join(current, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue
      collected.push(path.join(current, entry.name))
    }
  }
  await walk(directory)
  collected.sort()
  return collected
}

export async function readWorktreeRevision(directory: string): Promise<string | undefined> {
  const gitDir = await resolveGitDir(directory)
  if (gitDir === undefined) return undefined
  let head: string
  try {
    head = (await fs.readFile(path.join(gitDir, "HEAD"), "utf8")).trim()
  } catch {
    return undefined
  }
  if (!head.startsWith("ref:")) return /^[0-9a-f]{7,64}$/.test(head) ? head : undefined
  const ref = head.slice(4).trim()
  return await readRefValue(gitDir, ref)
}

// A linked worktree (`git worktree add`) replaces `.git` with a file that points at the real
// git directory, so a reader that assumes a directory reports no revision and silently drops
// all project knowledge for every worktree checkout.
async function resolveGitDir(directory: string): Promise<string | undefined> {
  const dotGit = path.join(directory, ".git")
  try {
    const stat = await fs.stat(dotGit)
    if (stat.isDirectory()) return dotGit
    const content = (await fs.readFile(dotGit, "utf8")).trim()
    if (!content.startsWith("gitdir:")) return undefined
    const target = content.slice("gitdir:".length).trim()
    if (target.length === 0) return undefined
    return path.isAbsolute(target) ? target : path.resolve(directory, target)
  } catch {
    return undefined
  }
}

// A worktree git directory keeps HEAD and its own refs while shared refs live in the common
// directory named by `commondir`, so both roots are searched before giving up.
async function refRoots(gitDir: string): Promise<string[]> {
  const roots = [gitDir]
  try {
    const common = (await fs.readFile(path.join(gitDir, "commondir"), "utf8")).trim()
    if (common.length > 0) {
      roots.push(path.isAbsolute(common) ? common : path.resolve(gitDir, common))
    }
  } catch {
    return roots
  }
  return roots
}

async function readRefValue(gitDir: string, ref: string): Promise<string | undefined> {
  for (const root of await refRoots(gitDir)) {
    try {
      const value = (await fs.readFile(path.join(root, ref), "utf8")).trim()
      if (/^[0-9a-f]{7,64}$/.test(value)) return value
    } catch {
      // loose ref absent; packed-refs below may still carry it
    }
    try {
      const packed = await fs.readFile(path.join(root, "packed-refs"), "utf8")
      for (const line of packed.split("\n")) {
        const trimmed = line.trim()
        if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("^")) continue
        const [sha, name] = trimmed.split(" ")
        if (name === ref && sha !== undefined && /^[0-9a-f]{7,64}$/.test(sha)) return sha
      }
    } catch {
      // no packed refs in this root
    }
  }
  return undefined
}

async function readRecordDirectory(
  dir: string,
  label: string,
): Promise<{ readonly records: readonly KnowledgeRecordInput[]; readonly dropped: number }> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return { records: [], dropped: 0 }
  }
  const records: KnowledgeRecordInput[] = []
  let dropped = 0
  for (const name of names.sort()) {
    if (!name.endsWith(RECORD_FILE_EXTENSION)) continue
    const filePath = path.join(dir, name)
    let content: string
    try {
      content = await fs.readFile(filePath, "utf8")
    } catch {
      dropped += 1
      continue
    }
    const parsed = parseRecordFile(`${label}/${name}`, content)
    if (parsed.kind !== "record") {
      dropped += 1
      continue
    }
    records.push({
      id: parsed.record.id,
      claim: parsed.record.claim,
      category: parsed.record.category,
      sourceFile: parsed.record.sourceFile,
      sourceRevision: parsed.record.sourceRevision,
      projectId: parsed.record.projectId,
      fingerprint: parsed.record.fingerprint,
      validatedAt: parsed.record.validatedAt,
      supersededBy: parsed.record.supersedes ?? undefined,
    })
  }
  return { records, dropped }
}

/**
 * The external store is opt-in and absolute: a relative or blank value is ignored, so a
 * typo can never widen the read to the working directory or a parent tree.
 */
export function resolveKnowledgeRoot(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const raw = env[PLAN_EVIDENCE_KNOWLEDGE_ENV]?.trim()
  if (raw === undefined || raw.length === 0) return undefined
  return path.isAbsolute(raw) ? raw : undefined
}

export async function loadKnowledgeRecords(
  directory: string,
  externalRoot?: string,
): Promise<{ readonly records: readonly KnowledgeRecordInput[]; readonly dropped: number }> {
  const local = await readRecordDirectory(path.join(directory, PROJECT_KNOWLEDGE_DIR), PROJECT_KNOWLEDGE_DIR)
  if (externalRoot === undefined) return local
  const external = await readRecordDirectory(externalRoot, PROJECT_KNOWLEDGE_DIR)
  if (external.records.length === 0) return { records: local.records, dropped: local.dropped + external.dropped }
  const seen = new Set(local.records.map((record) => record.id))
  const records = [...local.records]
  for (const record of external.records) {
    if (seen.has(record.id)) continue
    seen.add(record.id)
    records.push(record)
  }
  return { records, dropped: local.dropped + external.dropped }
}

// Project identity is an INPUT to retrieval, never a property inferred from the
// records being retrieved: a foreign record must not be able to re-anchor the scope
// and then render itself as authoritative (the Slice 9.5 defect).
function deriveProjectId(directory: string, explicit?: string): string {
  if (explicit !== undefined && explicit.trim().length > 0) {
    return explicit.trim()
  }
  return resolveProjectIdentity(directory).projectId
}

function toItem(item: QueryItem): EvidenceItemInput {
  return {
    id: item.id,
    file: item.file,
    line: item.line,
    confidence: item.confidence,
    knowledgeIds: [...item.knowledgeIds],
    name: item.name,
  }
}

function baseEnvelope(envelope: QueryEnvelope): EvidenceEnvelopeInput {
  return {
    projectId: envelope.projectId,
    worktreeId: envelope.worktreeId,
    revision: envelope.revision,
    fingerprint: envelope.fingerprint,
    freshness: envelope.freshness,
    coverage: envelope.coverage,
    truncated: envelope.truncated,
    knowledgeIds: [...envelope.knowledgeIds],
    unresolved: [...envelope.unresolved],
    unsupported: [...envelope.unsupported],
    items: envelope.items.map(toItem),
  }
}

function symbolContextEnvelope(result: SymbolContextResult): SymbolContextEnvelopeInput {
  return {
    ...baseEnvelope(result),
    definition: result.definition === undefined ? undefined : toItem(result.definition),
    callers: result.callers.map(toItem),
    callees: result.callees.map(toItem),
  }
}

function impactEnvelope(result: ImpactResult): ImpactEnvelopeInput {
  return {
    ...baseEnvelope(result),
    subject: result.subject === undefined ? undefined : toItem(result.subject),
    impacted: result.impacted.map(toItem),
  }
}

function findTestsEnvelope(result: FindTestsResult): FindTestsEnvelopeInput {
  return {
    ...baseEnvelope(result),
    subjectFile: result.subjectFile,
    candidates: result.candidates.map(toItem),
  }
}

function isSubjectFile(file: string): boolean {
  return !/(^|\/)__tests__\/|\.test\.[a-z]+$|\.spec\.[a-z]+$/.test(file) && !file.endsWith(".d.ts")
}

function mergeSearchEnvelopes(envelopes: readonly QueryEnvelope[]): EvidenceEnvelopeInput | undefined {
  const first = envelopes.find((envelope) => envelope.items.length > 0) ?? envelopes[0]
  if (first === undefined) return undefined
  const items = new Map<string, QueryItem>()
  for (const envelope of envelopes) {
    for (const item of envelope.items) {
      const existing = items.get(item.id)
      if (existing === undefined || existing.confidence < item.confidence) items.set(item.id, item)
    }
  }
  return {
    ...baseEnvelope(first),
    truncated: envelopes.some((envelope) => envelope.truncated),
    items: [...items.values()].sort((left, right) => right.confidence - left.confidence).map(toItem),
  }
}

function queryOptions(scope: UnderstandingScope): QueryOptions {
  return { scope }
}

function renderBlock(understanding: TaskUnderstanding, scope: UnderstandingScope, maxBytes: number): string {
  const header =
    `<plan-evidence source="code-graph+project-knowledge" project="${scope.projectId}" ` +
    `worktree="${scope.worktreeId}" revision="${scope.revision.slice(0, 12)}">`
  const footer = "</plan-evidence>"
  const marker = `\n(evidence truncated to ${maxBytes} bytes)`
  const budget = Math.max(0, maxBytes - Buffer.byteLength(header) - Buffer.byteLength(footer) - 2)
  let body = renderPlanEvidence(understanding)
  if (Buffer.byteLength(body) > budget) {
    const markerBytes = Buffer.byteLength(marker)
    const room = Math.max(0, budget - markerBytes)
    const trimmed = Buffer.from(body).subarray(0, room).toString("utf8")
    body = `${trimmed}${marker}`
  }
  return `${header}\n${body}\n${footer}`
}

function unavailable(reason: string, diagnostics: Partial<PlannerEvidenceDiagnostics> = {}): PlannerEvidence {
  return {
    status: "unavailable",
    bytes: 0,
    diagnostics: {
      reason,
      files: diagnostics.files ?? 0,
      indexedFiles: diagnostics.indexedFiles ?? 0,
      keywords: diagnostics.keywords ?? [],
      subjects: diagnostics.subjects ?? [],
      durationMs: diagnostics.durationMs ?? 0,
      knowledgeRecords: diagnostics.knowledgeRecords ?? 0,
      knowledgeExcluded: diagnostics.knowledgeExcluded ?? 0,
      scope: diagnostics.scope,
    },
  }
}

/**
 * Builds the planner evidence block for one task in one worktree. Never throws: every exit
 * that cannot produce trustworthy evidence returns `status: "unavailable"` with the reason.
 */
export async function buildPlannerEvidence(options: PlannerEvidenceOptions): Promise<PlannerEvidence> {
  const started = Date.now()
  const maxBytes = options.maxBytes ?? PLAN_EVIDENCE_MAX_BYTES
  const keywords = [...extractTaskKeywords(options.message), ...splitHyphenatedKeywords(options.message)].slice(0, PLAN_EVIDENCE_MAX_KEYWORDS * 2)
  if (keywords.length === 0) return unavailable("no-task-keywords")

  const revision = await readWorktreeRevision(options.directory)
  if (revision === undefined) return unavailable("revision-unresolved", { keywords })

  const loaded = options.knowledge === undefined
    ? await loadKnowledgeRecords(options.directory, options.knowledgeRoot)
    : { records: options.knowledge, dropped: 0 }
  const projectId = deriveProjectId(options.directory, options.projectId)
  const worktreeId = path.resolve(options.directory)
  const scope: UnderstandingScope = {
    projectId,
    worktreeId,
    revision,
    fingerprint: computeScopeFingerprint(projectId, worktreeId, revision),
  }

  const files = await collectSourceFiles(options.directory, options.maxFiles ?? PLAN_EVIDENCE_MAX_FILES)
  if (files.length === 0) return unavailable("no-source-files", { keywords, scope })

  let snapshot: GraphSnapshot
  try {
    snapshot = indexFiles(files)
  } catch {
    return unavailable("index-failed", { keywords, scope, files: files.length })
  }
  if (snapshot.nodes.length === 0) {
    return unavailable("empty-graph", { keywords, scope, files: files.length })
  }

  const optionsForScope = queryOptions(scope)
  const searchEnvelopes = keywords.map((keyword) => search(snapshot, keyword, optionsForScope))
  const searchEvidence = mergeSearchEnvelopes(searchEnvelopes)
  if (searchEvidence === undefined || searchEvidence.items.length === 0) {
    return unavailable("no-relevant-symbols", { keywords, scope, files: files.length })
  }

  const candidates = searchEvidence.items.filter((item) => item.confidence >= 1 && isSubjectFile(item.file))
  const keywordSet = new Set(keywords)
  const namesKeyword = (item: EvidenceItemInput): boolean => {
    const base = (item.file.split("/").pop() ?? "").toLowerCase()
    const stem = base.replace(/\.[^.]+$/, "")
    const name = (item.name ?? "").toLowerCase()
    return keywordSet.has(base) || keywordSet.has(stem) || (name.length > 0 && keywordSet.has(name))
  }
  const ranked = [...candidates].sort((left, right) =>
    Number(namesKeyword(right)) - Number(namesKeyword(left)) || right.confidence - left.confidence)
  const subjects = ranked.slice(0, options.maxSubjects ?? PLAN_EVIDENCE_MAX_SUBJECTS).map((item) => item.id)
  if (subjects.length === 0) {
    return unavailable("no-confirmed-subject", { keywords, scope, files: files.length })
  }

  let contextEvidence: SymbolContextEnvelopeInput | undefined
  let impactEvidence: ImpactEnvelopeInput | undefined
  let testsEvidence: FindTestsEnvelopeInput | undefined
  const includeImpactAndTests = options.includeImpactAndTests ?? true
  for (const subject of subjects) {
    const context = symbolContext(snapshot, subject, optionsForScope)
    if (contextEvidence === undefined && context.definition !== undefined) {
      contextEvidence = symbolContextEnvelope(context)
    }
    if (!includeImpactAndTests) continue
    const reach = impact(snapshot, subject, optionsForScope)
    if (impactEvidence === undefined || (impactEvidence.impacted ?? []).length === 0) {
      impactEvidence = impactEnvelope(reach)
    }
    const tests = findTests(snapshot, subject, optionsForScope)
    if (testsEvidence === undefined || (testsEvidence.candidates ?? []).length === 0) {
      testsEvidence = findTestsEnvelope(tests)
    }
  }
  // A barrel file carries the symbol but no test edge of its own; when the chosen subjects
  // yield no test, the definition the barrel re-exports still owns the coverage, so ask the
  // graph for it by symbol instead of reporting no tests for a covered change.
  if (includeImpactAndTests && (testsEvidence?.candidates ?? []).length === 0) {
    const symbolFallbacks = searchEvidence.items.filter((item) =>
      item.id.startsWith("fn:") && !subjects.includes(item.id))
    for (const candidate of symbolFallbacks) {
      const tests = findTests(snapshot, candidate.id, optionsForScope)
      if ((tests.candidates ?? []).length > 0) {
        testsEvidence = findTestsEnvelope(tests)
        break
      }
    }
  }

  const queries: TaskUnderstandingQueries = {
    search: searchEvidence,
    symbolContext: contextEvidence,
    impact: impactEvidence,
    findTests: testsEvidence,
  }
  const understanding = buildTaskUnderstanding({ scope, queries, knowledge: loaded.records })
  const hints = derivePlanHints(understanding, [])
  // Lower levels render confirmed symbols only: impact and test rows are a
  // level-3 addition, so they are redacted from the rendered block (hints
  // still see the full understanding).
  const rendered = includeImpactAndTests
    ? understanding
    : { ...understanding, impacted: [], tests: [] }
  const text = renderBlock(rendered, scope, maxBytes)
  const bytes = Buffer.byteLength(text)
  if (bytes === 0) return unavailable("empty-render", { keywords, scope, files: files.length })

  return {
    status: "available",
    text,
    bytes,
    understanding,
    hints,
    diagnostics: {
      files: files.length,
      indexedFiles: snapshot.nodes.length,
      keywords,
      subjects,
      durationMs: Date.now() - started,
      scope,
      knowledgeRecords: loaded.records.length,
      knowledgeExcluded: loaded.dropped,
    },
  }
}

export function composeRunPrompt(message: string, evidence: PlannerEvidence | undefined): string {
  if (evidence === undefined || evidence.status !== "available" || evidence.text === undefined) return message
  return `${message}\n\n${evidence.text}`
}

/**
 * The one step runner.ts performs before dispatch: decide whether this turn is planned work,
 * build the evidence, and return the exact text the planner will receive. A skipped or
 * unavailable turn returns the original message untouched, so the disabled path is identical.
 */
export async function preparePlannerTurn(input: PlannerTurnInput): Promise<PlannerTurn> {
  if (input.enabled === false) return { promptText: input.message, skipped: "disabled" }
  if (!isPlanEvidenceEnabled(input.env ?? process.env)) return { promptText: input.message, skipped: "disabled-env" }
  if (input.level === 0) return { promptText: input.message, skipped: "graph-level-0" }
  // A level-bearing caller has already decided how much graph work this task
  // earns, so a `direct` strategy no longer vetoes a level 1 block: simple
  // code questions are exactly where a small bounded block pays off. Without a
  // level the old strategy gate stands, so every existing caller is unchanged.
  if (input.level === undefined && !isPlanningStrategy(input.strategy)) {
    return { promptText: input.message, skipped: "strategy-direct" }
  }
  const evidence = await buildPlannerEvidence({
    message: input.message,
    directory: input.directory,
    maxBytes: input.maxBytes ?? (input.level === 1 ? 1024 : PLAN_EVIDENCE_MAX_BYTES),
    maxSubjects: input.maxSubjects ?? (input.level === 1 ? 1 : PLAN_EVIDENCE_MAX_SUBJECTS),
    maxFiles: input.maxFiles ?? (input.level === undefined
      ? PLAN_EVIDENCE_MAX_FILES
      : PLAN_EVIDENCE_LEVEL_MAX_FILES[input.level]),
    includeImpactAndTests:
      input.includeImpactAndTests ?? (input.level === undefined ? true : input.level >= 3),
    knowledgeRoot: resolveKnowledgeRoot(input.env ?? process.env),
    projectId: input.projectId,
  })
  if (evidence.status !== "available") {
    return { promptText: input.message, evidence, skipped: evidence.diagnostics.reason ?? "unavailable" }
  }
  return { promptText: composeRunPrompt(input.message, evidence), evidence }
}

export type RunPromptInput = {
  readonly sessionID: string
  readonly directory: string
  readonly message: string
  readonly agent: string
  readonly model?: { readonly providerID: string; readonly modelID: string }
  readonly evidence?: PlannerEvidence
}

export type RunPromptBody = {
  readonly agent: string
  readonly model?: { readonly providerID: string; readonly modelID: string }
  readonly tools: { readonly question: false }
  readonly parts: readonly { readonly type: "text"; readonly text: string }[]
}

export type RunPromptEnvelope = {
  readonly path: { readonly id: string }
  readonly body: RunPromptBody
  readonly query: { readonly directory: string }
}

export function buildPromptInput(input: RunPromptInput): RunPromptEnvelope {
  const text = composeRunPrompt(input.message, input.evidence)
  return {
    path: { id: input.sessionID },
    body: {
      agent: input.agent,
      model: input.model,
      tools: { question: false },
      parts: [{ type: "text", text }],
    },
    query: { directory: input.directory },
  }
}
