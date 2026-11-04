/**
 * code-graph.ts — the `code_graph` native tool.
 *
 * Exposes the repository code graph over one op surface: `status` reports
 * the canonical index state (cheap — it never blocks on a build),
 * `context`/`search`/`trace`/`impact`/`tests` query the one canonical
 * Code Graph service (the same runtime, store directory, and persisted
 * generations the panel serves) and wrap the canonical answer through
 * `buildAgentContext`. The tool returns one JSON string carrying both the
 * rendered text and the structured envelope. Repeated queries against an
 * unchanged repository reuse its generation instead of rebuilding.
 *
 * Every caller-fixable problem is refused with the shared `refuseArgs`
 * usage error; service failures (no sources, index failure) answer as an
 * honest unavailable envelope, never a raw throw.
 */

import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
import path from "node:path"
import { z } from "zod"

import type { CompletenessReason } from "../../../../code-graph/src/queries.ts"
import type { OmoJsonObject, OmoJsonValue, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
import { refuseArgs } from "../ulw/args.ts"
import {
  AGENT_CONTEXT_DEFAULT_MAX_BYTES,
  buildAgentContext,
  isTestPath,
  renderAgentContext,
  type GraphContextEnvelope,
  type GraphContextOp,
  type GraphContextSubject,
  type QueryEnvelope,
  type QueryItem,
} from "../../../../code-graph/src/index.ts"
import { CodeGraphArgsSchema, type CodeGraphArgs } from "./args.ts"
import {
  FiniteNumberSchema,
  getCanonicalRuntime,
  wireObjectOf,
  type CanonicalAnswer,
  type CanonicalRuntime,
  type CanonicalSummary,
} from "./canonical-runtime.ts"

export const CODE_GRAPH_NAME = "code_graph"

// [CODE-GRAPH-EXPLORE-PLAYBOOK-START]
// Composed explore answer (one call: bodies + call paths + blast radius).
// Call op 'explore' with a bare symbol name, a symbol id, or a file path.
// A bare name matches EVERY definition carrying it: an ambiguous symbol
// returns every definition's body, never just the first.
// The answer returns in one response:
// (a) bodies: verbatim line-numbered source bodies grouped by file, cut at
//     60 lines with truncated:true when the file runs longer, never invented;
// (b) paths: static call paths between the matched definitions plus their
//     direct caller/callee hops; dynamic dispatch never becomes an edge and
//     rides only as an unresolved manual-review note with blockedByDynamic;
// (c) blastRadius: the joint reverse-reachability summary over every
//     matched definition (dependents, files, modules, tests found).
// Existing envelope fields keep their meaning; read unresolved first, then
// bodies, then paths, then blastRadius before editing. Budgets: limit caps
// definitions, bodies, and rows; depth bounds path length; every cut names
// itself in unresolved. This op never calls runtime kind 'explore' (that
// kind is the repository-modules overview); it composes search, context,
// trace, impact, and file views plus verbatim disk bodies.
// [CODE-GRAPH-EXPLORE-PLAYBOOK-END]
/** Agent playbook for op explore: served inside the tool description (the server-instructions equivalent). */
const EXPLORE_PLAYBOOK =
  "Explore returns bodies, paths, and blast radius in one call. " +
  "Use it when you want to understand a symbol before editing. " +
  "Subject may be a bare name (every definition answers), a symbol id, or a file path. " +
  "Bodies are verbatim line-numbered source grouped by file. " +
  "Paths are static calls only; dynamics stay in unresolved and never become edges. " +
  "BlastRadius counts every reverse-reachable dependent for edit risk.";

const CODE_GRAPH_DESCRIPTION =
  "Query the repository code graph: status, symbol context, search, call trace, blast-radius impact, owning tests, or a composed explore answer. " +
  EXPLORE_PLAYBOOK;

export type CodeGraphToolDeps = {
  /** Working directory override (tests); defaults to the tool context directory. */
  readonly directory?: string
  /** Canonical store directory override (tests); defaults to the shared panel store. */
  readonly storeDir?: string
  /** Canonical runtime override (tests); defaults to the shared singleton. */
  readonly runtime?: CanonicalRuntime
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])

const FALLBACK_REVISION = "0".repeat(40)

function resolveDirectory(deps: CodeGraphToolDeps, context: OmoToolContext | undefined): string {
  if (context?.directory !== undefined && context.directory.length > 0) return context.directory
  if (context?.worktree !== undefined && context.worktree.length > 0) return context.worktree
  if (deps.directory !== undefined && deps.directory.length > 0) return deps.directory
  return process.cwd()
}

async function collectChangedPaths(directory: string): Promise<string[]> {
  const run = promisify(execFile)
  let stdout: string
  try {
    ({ stdout } = await run("git", ["status", "--porcelain"], { cwd: directory, maxBuffer: 1 << 20 }))
  } catch {
    return []
  }
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 3)
    .map((line) => line.slice(2).trim().replace(/^"|"$/g, ""))
    .flatMap((entry) => (entry.includes(" -> ") ? entry.split(" -> ") : [entry]))
    .filter((entry) => SOURCE_EXTENSIONS.has(path.extname(entry)))
    .sort()
}

function looksLikeNodeId(subject: string): boolean {
  return subject.includes(":") || subject.includes("@") || subject.includes("/") || subject.includes("\\")
}

const normalizeRel = (subject: string): string => subject.replace(/\\/g, "/").replace(/^\.\//, "")

/**
 * Resolve a subject against the canonical generation: file-like subjects
 * probe the file view (falling back to a basename search, as the old
 * snapshot-membership check did), bare names search once, and symbol ids
 * pass through — the engine answers an honest empty result when unknown.
 */
async function resolveSubjectId(
  runtime: CanonicalRuntime,
  track: (answer: CanonicalAnswer) => CanonicalAnswer,
  directory: string,
  subject: string,
  limit: number,
): Promise<string> {
  const normalized = normalizeRel(subject)
  const fileLike =
    subject.startsWith("file:") || normalized.includes("/") || subject.includes("\\") || /\.[a-z0-9]+$/i.test(normalized)
  if (fileLike) {
    const probe = track(await runtime.query(directory, { kind: "file", file: normalized, limit: 1 }))
    const hit = probe.envelope.items[0]
    if (hit !== undefined && hit.id.startsWith("file:")) return hit.id
    if (!looksLikeNodeId(subject)) {
      const found = track(await runtime.query(directory, { kind: "search", query: subject, limit }))
      const exact = found.envelope.items.find((item) => item.name === subject) ?? found.envelope.items[0]
      return exact?.id ?? subject
    }
    const base = normalized.split("/").pop() ?? normalized
    const byName = track(await runtime.query(directory, { kind: "search", query: base, limit }))
    return byName.envelope.items.find((item) => item.id.startsWith("file:"))?.id ?? subject
  }
  if (!looksLikeNodeId(subject)) {
    const found = track(await runtime.query(directory, { kind: "search", query: subject, limit }))
    const exact = found.envelope.items.find((item) => item.name === subject) ?? found.envelope.items[0]
    return exact?.id ?? subject
  }
  return subject
}

/** The result-limit reason rides only on partial answers; complete ones omit it. */
interface CompletenessExtra {
  readonly completenessReason?: CompletenessReason
}

const completenessExtraOf = (complete: boolean): CompletenessExtra =>
  complete ? {} : { completenessReason: "result-limit" }

function mergedImpactEnvelope(
  summary: CanonicalSummary,
  directory: string,
  paths: readonly string[],
  parts: readonly CanonicalAnswer[],
): QueryEnvelope {
  const seen = new Set<string>()
  const items: QueryEnvelope["items"][number][] = []
  const unresolved: string[] = []
  const knownParts: number[] = []
  let deduped = 0
  let everyPartComplete = true
  let partsRun = 0
  for (const part of parts) {
    partsRun += 1
    if (part.envelope.completeness !== undefined && part.envelope.completeness !== "complete") everyPartComplete = false
    const known = part.envelope.totals?.known
    if (known !== undefined && known !== null) knownParts.push(known)
    for (const item of part.envelope.items) {
      if (seen.has(item.id)) {
        deduped += 1
        continue
      }
      seen.add(item.id)
      items.push(item)
    }
    unresolved.push(...part.envelope.unresolved)
  }
  const uniqueUnresolved = [...new Set(unresolved)]
  // S2: union the parts' per-file staleness notes so a changes-mode impact
  // answer carries the same Read-directly notes as a single query.
  const staleNoteTexts: string[] = []
  for (const part of parts) {
    for (const entry of staleUnresolvedEntries(staleCarrierOf(part.envelope))) {
      if (!uniqueUnresolved.includes(entry.reason) && !staleNoteTexts.includes(entry.reason)) staleNoteTexts.push(entry.reason)
    }
  }
  const coverRank = (coverage: string): number =>
    coverage === "indexed" ? 0 : coverage === "partial" ? 1 : 2
  const coverage =
    paths.length === 0
      ? "indexed"
      : (parts.map((part) => part.envelope.coverage).sort((a, b) => coverRank(b) - coverRank(a))[0] ?? "partial")
  const complete = paths.length === 0 || (everyPartComplete && deduped === 0 && knownParts.length > 0)
  const known = paths.length === 0
    ? 0
    : partsRun === 1 && knownParts.length === 1 ? knownParts[0] : null
  return {
    projectId: summary.projectId ?? "project-00000000",
    worktreeId: summary.worktreeId ?? directory,
    revision: summary.revision ?? FALLBACK_REVISION,
    fingerprint: summary.fingerprint ?? "",
    freshness: "fresh",
    coverage,
    truncated: false,
    knowledgeIds: [],
    unresolved: [...(paths.length === 0 ? ["no-changes"] : uniqueUnresolved), ...staleNoteTexts],
    unsupported: [],
    items,
    totals: { displayed: items.length, known, hidden: known === null ? null : Math.max(known - items.length, 0) },
    completeness: complete ? "complete" : "partial",
    ...completenessExtraOf(complete),
  }
}

function inferSubjectKind(subject: string): CodeGraphArgs["subjectKind"] {
  if (subject.includes("@") || subject.startsWith("fn:") || subject.startsWith("file:")) return "symbol"
  if (subject.includes("/") || subject.includes("\\") || subject.includes(".")) return "file"
  return "query"
}

function toSubjects(op: GraphContextOp, args: CodeGraphArgs): readonly GraphContextSubject[] {
  if (op === "status") return []
  const subject = args.subject
  if (subject === undefined) {
    return args.subjectKind === "changes" ? [{ kind: "changes", id: "working-tree", reason: "git-status" }] : []
  }
  const kind = args.subjectKind ?? inferSubjectKind(subject)
  const subjects: GraphContextSubject[] = [{ kind, id: subject }]
  if (op === "trace" && args.to !== undefined) {
    subjects.push({ kind: args.subjectKind ?? inferSubjectKind(args.to), id: args.to })
  }
  return subjects
}

/**
 * S2 staleness subset: the canonical runtime attaches `staleFiles[]`
 * (`{ file, ageMs }`), `pendingSync[]`, and `syncStatus` to served envelopes
 * and summaries. QueryEnvelope/CanonicalSummary are closed engine types, so
 * the subset is read through this one justified cast and every field is
 * re-validated below before it reaches a note or reason.
 */
interface StaleCarrier {
  readonly staleFiles?: ReadonlyArray<{ readonly file: string; readonly ageMs?: number | null }>;
  readonly pendingSync?: ReadonlyArray<string>;
  readonly syncStatus?: string;
}

const staleCarrierOf = (value: QueryEnvelope | CanonicalSummary): StaleCarrier =>
  // SAFETY: QueryEnvelope and CanonicalSummary are closed engine types, but the JS runtime
  // attaches staleFiles/pendingSync/syncStatus beside them; every field is re-validated
  // below before it reaches a note or reason.
  value as StaleCarrier;

const NonEmptyStringSchema = z.string().min(1);

const isNonEmptyString = (value: OmoJsonValue): value is string =>
  NonEmptyStringSchema.safeParse(value).success;

/** One validated stale-file entry: the file plus its index age, if the wire carried one. */
interface StaleFileEntry {
  readonly file: string;
  readonly ageMs: number | null;
}

const StaleFileSchema = z.object({ file: z.string().min(1), ageMs: FiniteNumberSchema.optional() });

const staleFilesOf = (carrier: StaleCarrier): StaleFileEntry[] => {
  if (!Array.isArray(carrier.staleFiles)) return [];
  const out: StaleFileEntry[] = [];
  for (const entry of carrier.staleFiles) {
    const parsed = StaleFileSchema.safeParse(entry);
    if (!parsed.success) continue;
    const ageMs = FiniteNumberSchema.safeParse(parsed.data["ageMs"]);
    out.push({ file: parsed.data.file, ageMs: ageMs.success ? ageMs.data : null });
  }
  return out;
};

const pendingSyncOf = (carrier: StaleCarrier): string[] => {
  if (!Array.isArray(carrier.pendingSync)) return [];
  return carrier.pendingSync.filter(isNonEmptyString);
};

const syncStatusOf = (carrier: StaleCarrier): string | null => {
  const status = carrier.syncStatus;
  return status === "disabled" || status === "recovering" || status === "ok" ? status : null;
};

const staleNoteFor = (file: string): string =>
  `stale: ${file} edited since index \u2014 Read directly for current source`;

/** Tool-facing unresolved entries for referenced pending files, plus the whole-index note. */
const staleUnresolvedEntries = (carrier: StaleCarrier): Array<{ kind: "unresolved"; id: string; reason: string }> => {
  const entries: Array<{ kind: "unresolved"; id: string; reason: string }> = [];
  for (const entry of staleFilesOf(carrier)) {
    entries.push({ kind: "unresolved", id: entry.file, reason: staleNoteFor(entry.file) });
  }
  const status = syncStatusOf(carrier);
  if (status === "disabled" || status === "recovering") {
    entries.push({ kind: "unresolved", id: "sync-status", reason: `sync ${status} \u2014 whole index may be stale` });
  }
  return entries;
};

/** Status reasons mirroring the same notes: per-file `stale:<f>`, `pending:<n>`, `sync-<status>`. */
const staleStatusReasons = (carrier: StaleCarrier): string[] => {
  const stale = staleFilesOf(carrier);
  const reasons: string[] = stale.map((entry) => `stale:${entry.file}`);
  const referenced = new Set(stale.map((entry) => entry.file));
  const unreferenced = pendingSyncOf(carrier).filter((file) => !referenced.has(file));
  if (unreferenced.length > 0) reasons.push(`pending:${unreferenced.length}`);
  const status = syncStatusOf(carrier);
  if (status === "disabled" || status === "recovering") reasons.push(`sync-${status}`);
  return reasons;
};

/** Correlation triple the tool passes to the agent-context builder; generation rides only when set. */
interface ToolCorrelation {
  projectId: string
  worktreeId: string
  revision: string
  generation?: number
}

/** Optional summary extras; absent values stay absent from the status object. */
interface SummaryStatusExtras {
  generation?: number
  revision?: string
}

const summaryStatusExtrasOf = (generation: number | null, revision: string | null): SummaryStatusExtras => {
  const extras: SummaryStatusExtras = {}
  if (generation !== null) extras.generation = generation
  if (revision !== null) extras.revision = revision
  return extras
}

/** Tool depth validated to a traversal level; depth is args-validated, so 2 is home. */
const DepthLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)])

const levelOf = (depth: number | undefined): 1 | 2 | 3 => {
  const parsed = DepthLevelSchema.safeParse(depth ?? 2)
  return parsed.success ? parsed.data : 2
}

function correlationOf(summary: CanonicalSummary, directory: string): ToolCorrelation {
  const correlation: ToolCorrelation = {
    projectId: summary.projectId ?? "project-00000000",
    worktreeId: summary.worktreeId ?? directory,
    revision: summary.revision ?? FALLBACK_REVISION,
  }
  if (summary.generation !== null) correlation.generation = summary.generation
  return correlation
}

/** Verbatim body caps mirror the engine explore query so tool and engine answers read alike. */
const EXPLORE_TOOL_BODY_MAX_LINES = 60
const EXPLORE_TOOL_MAX_PATHS = 20
const EXPLORE_TOOL_MAX_IMPACT_DEFS = 5
const EXPLORE_TOOL_TEXT_BODY_LINES = 200

interface ExploreToolBodyLine {
  readonly line: number
  readonly text: string
}

interface ExploreToolBody {
  readonly id: string
  readonly name?: string
  readonly file: string
  readonly startLine: number
  readonly endLine: number
  /** True when the file continues past endLine; the tail is omitted, never guessed. */
  readonly truncated: boolean
  readonly lines: readonly ExploreToolBodyLine[]
}

interface ExploreToolBodyGroup {
  readonly file: string
  readonly bodies: readonly ExploreToolBody[]
}

interface ExploreToolHop {
  readonly from: string
  readonly to: string
  readonly ref: string
}

interface ExploreToolPath {
  readonly from: string
  readonly to: string
  readonly found: boolean
  readonly hops: readonly ExploreToolHop[]
  /** True when dynamics on the walked frontier could complete a path the static graph lacks. */
  readonly blockedByDynamic: boolean
}

interface ExploreToolDefinition {
  readonly id: string
  readonly file: string
  readonly line: number
  readonly name?: string
}

interface ExploreToolBlastRadius {
  readonly subjectIds: readonly string[]
  readonly dependentFiles: number
  readonly dependentSymbols: number
  readonly modules: readonly { readonly module: string; readonly count: number }[]
  readonly testsFound: number
}

interface ExplorePayload {
  readonly subject: string
  readonly definitions: readonly ExploreToolDefinition[]
  readonly bodies: readonly ExploreToolBodyGroup[]
  readonly paths: readonly ExploreToolPath[]
  readonly impacted: readonly QueryItem[]
  readonly blastRadius: ExploreToolBlastRadius
}

/** The explore rows the tool reads from merged impact answers; structural, never asserted. */
const ExploreItemSchema = z.object({ id: z.string(), file: z.string(), line: FiniteNumberSchema })

const asExploreItem = (value: QueryItem): QueryItem | null => {
  const parsed = ExploreItemSchema.safeParse(value)
  return parsed.success ? value : null
}

/** Validated caller/callee rows (single-hop paths) from a context envelope's extras. */
const exploreNeighborsOf = (
  envelope: QueryEnvelope,
  key: "callers" | "callees",
): { readonly id: string; readonly ref: string }[] => {
  const extras = wireObjectOf(envelope)
  if (extras === null) return []
  const list = extras[key]
  if (!Array.isArray(list)) return []
  const out: { readonly id: string; readonly ref: string }[] = []
  for (const entry of list) {
    const item = wireObjectOf(entry)
    if (item === null) continue
    const id = item["id"]
    if (!isNonEmptyString(id)) continue
    const evidence: readonly OmoJsonValue[] = Array.isArray(item["evidence"]) ? item["evidence"] : []
    const ref = evidence.length === 0 ? null : wireObjectOf(evidence[0])?.["ref"] ?? null
    if (!isNonEmptyString(ref)) continue
    out.push({ id, ref })
  }
  return out
}

/** Validated static hops from a trace envelope's extras; dynamics never ride as hops. */
const exploreTraceOf = (
  envelope: QueryEnvelope,
): { readonly hops: readonly ExploreToolHop[]; readonly blocked: boolean } | null => {
  const record = wireObjectOf(envelope)
  if (record === null) return null
  const raw = record["path"]
  if (!Array.isArray(raw)) return null
  const hops: ExploreToolHop[] = []
  for (const entry of raw) {
    const hop = wireObjectOf(entry)
    if (hop === null) continue
    const from = hop["from"]
    const to = hop["to"]
    const ref = hop["ref"]
    if (!isNonEmptyString(from) || !isNonEmptyString(to) || !isNonEmptyString(ref)) continue
    // The engine never emits unknown targets; a defensive filter keeps it that way here too.
    if (to === "unknown") continue
    hops.push({ from, to, ref })
  }
  const summary = wireObjectOf(record["summary"])
  const reason = summary?.["reason"] ?? null
  const blocked =
    reason === "blocked-by-unresolved" ||
    envelope.unresolved.some((note) => note.includes("unknown callee"))
  return { hops, blocked }
}

const exploreModuleOf = (file: string): string => {
  const slash = file.indexOf("/")
  return slash < 0 ? "(root)" : file.slice(0, slash)
}

async function readExploreBody(
  directory: string,
  definition: ExploreToolDefinition,
): Promise<{ readonly body?: ExploreToolBody; readonly note?: string }> {
  let text: string
  try {
    text = await readFile(path.join(directory, definition.file), "utf8")
  } catch {
    return { note: `explore: body unreadable for ${definition.file} (${definition.id}); omitted, never synthesized` }
  }
  const stored = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
  const startLine = Math.min(Math.max(1, Math.floor(definition.line)), stored.length + 1)
  let effectiveLength = stored.length
  while (effectiveLength > startLine && (stored[effectiveLength - 1] ?? "") === "") effectiveLength -= 1
  const endLine = Math.min(startLine + EXPLORE_TOOL_BODY_MAX_LINES - 1, effectiveLength)
  const lines: ExploreToolBodyLine[] = []
  for (let line = startLine; line <= endLine; line += 1) {
    lines.push({ line, text: stored[line - 1] ?? "" })
  }
  const body: ExploreToolBody = {
    id: definition.id,
    file: definition.file,
    startLine,
    endLine,
    truncated: effectiveLength > endLine,
    lines,
  }
  return { body: definition.name === undefined ? body : { ...body, name: definition.name } }
}

function renderExploreText(payload: ExplorePayload): string {
  const lines: string[] = []
  lines.push(`EXPLORE subject=${payload.subject}`)
  lines.push(
    `definitions: ${payload.definitions.length}${payload.definitions.length > 0 ? ` ${payload.definitions.map((definition) => definition.id).join(",")}` : ""}`,
  )
  lines.push(`bodies: ${payload.bodies.length} file(s)`)
  let renderedBodyLines = 0
  let omittedBodyLines = 0
  for (const group of payload.bodies) {
    lines.push(`## ${group.file}`)
    for (const body of group.bodies) {
      lines.push(`### ${body.id} lines ${body.startLine}-${body.endLine}${body.truncated ? " (truncated)" : ""}`)
      for (const entry of body.lines) {
        if (renderedBodyLines >= EXPLORE_TOOL_TEXT_BODY_LINES) {
          omittedBodyLines += 1
          continue
        }
        renderedBodyLines += 1
        lines.push(`${entry.line}: ${entry.text}`)
      }
    }
  }
  if (omittedBodyLines > 0) {
    lines.push(`…(${omittedBodyLines} more body lines omitted by text budget; structured bodies carry them all)`)
  }
  const found = payload.paths.filter((entry) => entry.found).length
  lines.push(`paths: ${found}/${payload.paths.length} found`)
  for (const entry of payload.paths) {
    const tail = entry.found
      ? entry.hops.map((hop) => `${hop.from} -> ${hop.to} via ${hop.ref}`).join(" | ")
      : "no static path (never guessed)"
    lines.push(
      `${entry.from} -> ${entry.to}: ${entry.found ? "found" : "missing"}${entry.blockedByDynamic ? " [blocked-by-dynamic]" : ""} ${tail}`,
    )
  }
  const blast = payload.blastRadius
  lines.push(
    `blastRadius: dependents=${payload.impacted.length} files=${blast.dependentFiles} symbols=${blast.dependentSymbols} tests=${blast.testsFound} modules=${blast.modules.map((entry) => `${entry.module}:${entry.count}`).join(",") || "none"}`,
  )
  return lines.join("\n")
}

/**
 * Composed explore answer at the tool layer: definitions (every match when
 * the name is ambiguous), verbatim disk bodies grouped by file, static call
 * paths between the matches, and the joint blast radius. Never calls
 * runtime kind 'explore' (the repository-modules overview); it composes
 * search, file, context, trace, and impact views over one generation.
 */
async function composeExplore(
  runtime: CanonicalRuntime,
  track: (answer: CanonicalAnswer) => CanonicalAnswer,
  directory: string,
  subject: string,
  subjectKind: CodeGraphArgs["subjectKind"],
  limit: number | undefined,
  depth: number | undefined,
): Promise<{ readonly envelope: QueryEnvelope; readonly extraUnresolved: readonly string[]; readonly explore: ExplorePayload }> {
  const cap = limit ?? 20
  const kind = subjectKind ?? inferSubjectKind(subject)
  let searchEnvelope: QueryEnvelope
  let candidates: QueryItem[]
  if (kind === "file") {
    const view = track(await runtime.query(directory, { kind: "file", file: normalizeRel(subject), limit }))
    searchEnvelope = view.envelope
    candidates = view.envelope.items.filter((item) => !item.id.startsWith("file:"))
  } else {
    const found = track(await runtime.query(directory, { kind: "search", query: subject, limit }))
    searchEnvelope = found.envelope
    const symbols = found.envelope.items.filter((item) => !item.id.startsWith("file:"))
    const exact = symbols.find((item) => item.id === subject)
    const named = symbols.filter((item) => item.name === subject)
    candidates = exact !== undefined ? [exact] : named.length > 0 ? named : symbols
  }
  const definitions: ExploreToolDefinition[] = candidates.slice(0, cap).map((item) => {
    if (item.name === undefined) {
      return { id: item.id, file: item.file, line: item.line }
    }
    return { id: item.id, file: item.file, line: item.line, name: item.name }
  })
  const notes: string[] = []
  if (definitions.length === 0) {
    const envelope: QueryEnvelope = {
      ...searchEnvelope,
      unresolved: [...searchEnvelope.unresolved, `explore: no definition for ${subject} in this snapshot`],
    }
    return {
      envelope,
      extraUnresolved: [],
      explore: {
        subject,
        definitions: [],
        bodies: [],
        paths: [],
        impacted: [],
        blastRadius: { subjectIds: [], dependentFiles: 0, dependentSymbols: 0, modules: [], testsFound: 0 },
      },
    }
  }
  // Verbatim bodies from disk (current source), grouped by file.
  const staleFiles = new Set(staleFilesOf(staleCarrierOf(searchEnvelope)).map((entry) => entry.file))
  const groups = new Map<string, ExploreToolBody[]>()
  for (const definition of definitions) {
    const { body, note } = await readExploreBody(directory, definition)
    if (note !== undefined) notes.push(note)
    if (body !== undefined) {
      const group = groups.get(definition.file)
      if (group === undefined) groups.set(definition.file, [body])
      else group.push(body)
    }
    if (staleFiles.has(definition.file)) notes.push(staleNoteFor(definition.file))
  }
  const bodies: ExploreToolBodyGroup[] = [...groups.entries()].map(([file, items]) => ({ file, bodies: items }))
  // Static paths: direct caller/callee hops first, then definition-pair traces.
  const paths: ExploreToolPath[] = []
  const seenPair = new Set<string>()
  const takePath = (entry: ExploreToolPath): boolean => {
    if (entry.from === entry.to) return true
    const key = `${entry.from} -> ${entry.to}`
    if (seenPair.has(key)) return true
    if (paths.length >= EXPLORE_TOOL_MAX_PATHS) return false
    seenPair.add(key)
    paths.push(entry)
    return true
  }
  let pathsCut = false
  const contextUnresolved: string[] = []
  for (const definition of definitions) {
    const ctx = track(await runtime.query(directory, { kind: "context", symbol: definition.id, limit, depth }))
    contextUnresolved.push(...ctx.envelope.unresolved)
    for (const caller of exploreNeighborsOf(ctx.envelope, "callers")) {
      if (!takePath({ from: caller.id, to: definition.id, found: true, hops: [{ from: caller.id, to: definition.id, ref: caller.ref }], blockedByDynamic: false })) {
        pathsCut = true
      }
    }
    for (const callee of exploreNeighborsOf(ctx.envelope, "callees")) {
      if (!takePath({ from: definition.id, to: callee.id, found: true, hops: [{ from: definition.id, to: callee.id, ref: callee.ref }], blockedByDynamic: false })) {
        pathsCut = true
      }
    }
  }
  for (const from of definitions) {
    for (const to of definitions) {
      if (from.id === to.id || paths.length >= EXPLORE_TOOL_MAX_PATHS) {
        if (from.id !== to.id) pathsCut = true
        continue
      }
      const key = `${from.id} -> ${to.id}`
      if (seenPair.has(key)) continue
      const traced = track(await runtime.query(directory, { kind: "trace", from: from.id, to: to.id, limit, depth }))
      contextUnresolved.push(...traced.envelope.unresolved)
      const parsed = exploreTraceOf(traced.envelope)
      if (parsed === null) continue
      seenPair.add(key)
      paths.push({
        from: from.id,
        to: to.id,
        found: parsed.hops.length > 0,
        hops: parsed.hops,
        blockedByDynamic: parsed.hops.length === 0 && parsed.blocked,
      })
    }
  }
  if (pathsCut) notes.push(`explore: call paths cut to ${EXPLORE_TOOL_MAX_PATHS}; more hops exist`)
  // Joint blast radius: impact per definition (bounded), merged by id.
  const impactedById = new Map<string, QueryItem>()
  const blastNotes: string[] = []
  for (const definition of definitions.slice(0, EXPLORE_TOOL_MAX_IMPACT_DEFS)) {
    const answered = track(await runtime.query(directory, { kind: "impact", symbol: definition.id, limit, depth }))
    blastNotes.push(...answered.envelope.unresolved)
    for (const item of answered.envelope.items) {
      const valid = asExploreItem(item)
      if (valid !== null && !impactedById.has(valid.id)) impactedById.set(valid.id, valid)
    }
  }
  if (definitions.length > EXPLORE_TOOL_MAX_IMPACT_DEFS) {
    blastNotes.push(`explore: blast radius covers the first ${EXPLORE_TOOL_MAX_IMPACT_DEFS} of ${definitions.length} definitions`)
  }
  const impacted = [...impactedById.values()].filter((item) => !definitions.some((definition) => definition.id === item.id))
  const dependentFiles = new Set(impacted.map((item) => item.file))
  const moduleCounts = new Map<string, number>()
  for (const item of impacted) {
    const module = exploreModuleOf(item.file)
    moduleCounts.set(module, (moduleCounts.get(module) ?? 0) + 1)
  }
  const modules = [...moduleCounts.entries()]
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
    .map(([module, count]) => ({ module, count }))
  const blastRadius: ExploreToolBlastRadius = {
    subjectIds: definitions.map((definition) => definition.id),
    dependentFiles: dependentFiles.size,
    dependentSymbols: impacted.filter((item) => !item.id.startsWith("file:")).length,
    modules,
    testsFound: impacted.filter((item) => isTestPath(item.file)).length,
  }
  const foundPaths = paths.filter((entry) => entry.found).length
  const mergedItems = [...candidates.slice(0, cap), ...impacted].slice(0, cap)
  const known = candidates.length + impacted.length
  const envelope: QueryEnvelope = {
    ...searchEnvelope,
    items: mergedItems,
    totals: { displayed: mergedItems.length, known, hidden: known - mergedItems.length },
    unresolved: [
      ...searchEnvelope.unresolved,
      ...notes,
      ...new Set([...contextUnresolved, ...blastNotes]),
      `explore: ${definitions.length} definition(s), ${foundPaths}/${paths.length} call path(s) found, ${impacted.length} dependent(s)`,
    ],
  }
  return {
    envelope,
    extraUnresolved: [],
    explore: {
      subject,
      definitions,
      bodies,
      paths,
      impacted: impacted.slice(0, cap),
      blastRadius,
    },
  }
}

export function createCodeGraphTool(deps: CodeGraphToolDeps = {}): OmoToolDefinition {
  return {
    description: CODE_GRAPH_DESCRIPTION,
    args: {
      properties: {
        op: {
          type: "string",
          description: "Graph operation: status, context, search, trace, impact, tests, or explore.",
          allowedValues: ["status", "context", "search", "trace", "impact", "tests", "explore"],
        },
        subject: { type: "string", description: "Symbol id, file path, or search text; required except for status." },
        subjectKind: {
          type: "string",
          description: "How to read subject; inferred when omitted.",
          allowedValues: ["file", "symbol", "changes", "query"],
        },
        to: { type: "string", description: "Destination symbol id for trace." },
        depth: { type: "number", description: "Traversal depth, 1-3; defaults to 2." },
        limit: { type: "number", description: "Result cap, 1-50; defaults to 20." },
        maxBytes: { type: "number", description: "Rendered budget, 512-16384; defaults to 8192." },
      },
      required: ["op"],
    },
    execute: async (toolArgs: OmoJsonObject, context?: OmoToolContext) => {
      const directory = resolveDirectory(deps, context)
      const parsed = CodeGraphArgsSchema.safeParse(toolArgs)
      if (!parsed.success) {
        refuseArgs("", "code_graph needs op status|context|search|trace|impact|tests|explore, optional subject/subjectKind/to, depth 1-3, limit 1-50, maxBytes 512-16384.")
      }
      const args = parsed.data
      const op = args.op
      const maxBytes = args.maxBytes ?? AGENT_CONTEXT_DEFAULT_MAX_BYTES
      const runtime = getCanonicalRuntime(deps)

      if (op === "status") {
        let summary: CanonicalSummary
        try {
          summary = await runtime.readIndex(directory)
        } catch {
          return stringifyEnvelope(
            buildAgentContext({
              op,
              level: 0,
              subjects: [],
              correlation: correlationOf(
                {
                  ready: false, generation: null, projectId: null, worktreeId: null, revision: null,
                  fingerprint: null, freshness: "unindexed", indexTruncated: false, nodeCount: 0,
                  edgeCount: 0, entryCount: 0, entryCap: 0, indexState: null,
                },
                directory,
              ),
              status: { freshness: "unindexed", coverage: "unindexed", queryServable: false, reasons: ["index-failed"] },
              maxBytes,
            }),
          )
        }
        const servable = summary.ready === true
        const coverage = !servable
          ? (summary.generation !== null ? "partial" : "unindexed")
          : summary.indexTruncated ? "partial" : "indexed"
        const reasons = [
          `generation:${summary.generation ?? "none"}`,
          `freshness:${summary.freshness}`,
          ...(summary.indexState !== null ? [`index-state:${summary.indexState}`] : []),
          ...(servable ? [`nodes:${summary.nodeCount}`, `edges:${summary.edgeCount}`] : []),
          ...(summary.indexTruncated ? ["index-truncated"] : []),
        ]
        const envelope = buildAgentContext({
          op,
          level: 0,
          subjects: [],
          correlation: correlationOf(summary, directory),
          status: {
            freshness: summary.freshness,
            coverage,
            ...summaryStatusExtrasOf(summary.generation, summary.revision),
            queryServable: servable,
            reasons: [...reasons, ...staleStatusReasons(staleCarrierOf(summary))],
          },
          maxBytes,
        })
        return stringifyEnvelope(envelope)
      }

      const subject = args.subject
      const changesMode = op === "impact" && (args.subjectKind === "changes" || inferSubjectKind(subject ?? "") === "changes")
      if (subject === undefined && !changesMode) {
        refuseArgs("", `code_graph op '${op}' needs a subject string.`)
      }
      if (op === "explore" && args.subjectKind === "changes") {
        refuseArgs("", "code_graph op 'explore' needs a subject symbol, name, or file path.")
      }
      if (op === "trace" && args.to === undefined) {
        refuseArgs("", "code_graph op 'trace' needs both subject and to symbol ids.")
      }
      // Guarded above: subject is defined on every path that reads it except
      // impact-with-changes (which never reads subjectText), and to is defined
      // for trace. The empty fallbacks never surface.
      const subjectText = subject ?? ""
      const toText = args.to ?? ""

      const displayOp: GraphContextOp = op === "explore" ? "context" : op
      const displaySubjects = (): readonly GraphContextSubject[] =>
        op === "explore"
          ? [{ kind: args.subjectKind ?? inferSubjectKind(subjectText), id: subjectText }]
          : toSubjects(op, args)

      const unavailable = (reasons: readonly string[]): string =>
        stringifyEnvelope(
          buildAgentContext({
            op: displayOp,
            level: levelOf(args.depth),
            subjects: displaySubjects(),
            correlation: correlationOf(
              {
                ready: false, generation: null, projectId: null, worktreeId: null, revision: null,
                fingerprint: null, freshness: "unindexed", indexTruncated: false, nodeCount: 0,
                edgeCount: 0, entryCount: 0, entryCap: 0, indexState: null,
              },
              directory,
            ),
            status: { freshness: "unindexed", coverage: "unindexed", queryServable: false, reasons: [...reasons] },
            maxBytes,
          }),
        )

      let summary: CanonicalSummary
      try {
        summary = await runtime.readIndex(directory, { block: true })
      } catch {
        return unavailable(["index-failed"])
      }
      if (!summary.ready) {
        return stringifyEnvelope(
          buildAgentContext({
            op: displayOp,
            level: levelOf(args.depth),
            subjects: displaySubjects(),
            correlation: correlationOf(summary, directory),
            status: {
              freshness: summary.freshness,
              coverage: summary.generation !== null ? "partial" : "unindexed",
              ...summaryStatusExtrasOf(summary.generation, summary.revision),
              queryServable: false,
              reasons: [
                `generation:${summary.generation ?? "none"}`,
                ...(summary.indexState !== null ? [`index-state:${summary.indexState}`] : []),
              ],
            },
            maxBytes,
          }),
        )
      }
      if (summary.entryCount === 0) {
        return stringifyEnvelope(
          buildAgentContext({
            op: displayOp,
            level: levelOf(args.depth),
            subjects: displaySubjects(),
            correlation: correlationOf(summary, directory),
            status: {
              freshness: summary.freshness,
              coverage: "unindexed",
              ...summaryStatusExtrasOf(summary.generation, summary.revision),
              queryServable: false,
              reasons: ["no-source-files"],
            },
            maxBytes,
          }),
        )
      }

      const generations: (number | null)[] = []
      const track = (answer: CanonicalAnswer): CanonicalAnswer => {
        generations.push(answer.generation)
        return answer
      }
      const limit = args.limit
      const depth = args.depth

      const runOp = async (): Promise<{
        envelope: QueryEnvelope
        extraUnresolved: string[] | readonly string[]
        explore?: ExplorePayload
      }> => {
        if (op === "search") {
          const answer = track(await runtime.query(directory, { kind: "search", query: subjectText, limit }))
          return { envelope: answer.envelope, extraUnresolved: [] }
        }
        if (op === "context") {
          const kind = args.subjectKind ?? inferSubjectKind(subjectText)
          if (kind === "file" || kind === "changes" || kind === "query") {
            const answer = track(await runtime.query(directory, { kind: "search", query: subjectText, limit }))
            return { envelope: answer.envelope, extraUnresolved: [] }
          }
          const resolved = await resolveSubjectId(runtime, track, directory, subjectText, limit ?? 20)
          const answer = track(
            await runtime.query(directory, { kind: "context", symbol: resolved, limit, depth }),
          )
          return {
            envelope: answer.envelope,
            extraUnresolved: resolved === subject ? [] : [`resolved-from-name:${resolved}`],
          }
        }
        if (op === "trace") {
          const from = await resolveSubjectId(runtime, track, directory, subjectText, limit ?? 20)
          const to = await resolveSubjectId(runtime, track, directory, toText, limit ?? 20)
          const answer = track(await runtime.query(directory, { kind: "trace", from, to, limit, depth }))
          return { envelope: answer.envelope, extraUnresolved: [] }
        }
        if (op === "impact") {
          // Files expand to the symbols they define before impact runs: the
          // engine walks from symbol subjects, and a bare file id answers
          // empty. The file view names those symbols over the same
          // generation, so the expansion never mixes generations.
          const impactSubjectsForFile = async (rel: string): Promise<CanonicalAnswer[]> => {
            const view = track(await runtime.query(directory, { kind: "file", file: rel, limit }))
            const symbols = view.envelope.items.map((item) => item.id).filter((id) => !id.startsWith("file:"))
            const subjects = symbols.length > 0 ? symbols : [`file:${rel}`]
            const parts: CanonicalAnswer[] = []
            for (const symbol of subjects) {
              parts.push(track(await runtime.query(directory, { kind: "impact", symbol, limit, depth })))
            }
            return parts
          }
          if (changesMode) {
            const changed = await collectChangedPaths(directory)
            const parts: CanonicalAnswer[] = []
            for (const file of changed) {
              parts.push(...(await impactSubjectsForFile(normalizeRel(file))))
            }
            return { envelope: mergedImpactEnvelope(summary, directory, changed, parts), extraUnresolved: [] }
          }
          const kind = args.subjectKind ?? inferSubjectKind(subjectText)
          if (kind === "file" || kind === "changes") {
            const rel = normalizeRel(subjectText)
            const parts = await impactSubjectsForFile(rel)
            return { envelope: mergedImpactEnvelope(summary, directory, [subjectText], parts), extraUnresolved: [] }
          }
          const resolved = await resolveSubjectId(runtime, track, directory, subjectText, limit ?? 20)
          const answer = track(await runtime.query(directory, { kind: "impact", symbol: resolved, limit, depth }))
          return { envelope: answer.envelope, extraUnresolved: [] }
        }
        if (op === "explore") {
          return composeExplore(runtime, track, directory, subjectText, args.subjectKind, limit, depth)
        }
        const resolved = await resolveSubjectId(runtime, track, directory, subjectText, limit ?? 20)
        const answer = track(await runtime.query(directory, { kind: "tests", target: resolved, limit }))
        return { envelope: answer.envelope, extraUnresolved: [] }
      }

      let pin = summary.generation
      let built = await runOp().catch((): null => null)
      if (built === null) return unavailable(["index-failed"])
      let restarted = false
      if (pin !== null && generations.some((generation) => generation !== null && generation !== pin)) {
        restarted = true
        generations.length = 0
        try {
          summary = await runtime.readIndex(directory, { block: true })
        } catch {
          return unavailable(["index-failed"])
        }
        pin = summary.generation
        built = await runOp().catch((): null => null)
        if (built === null) return unavailable(["index-failed"])
      }

      const staleCarrier = staleCarrierOf(built.envelope)
      const envelope = buildAgentContext({
        op: displayOp,
        level: levelOf(args.depth),
        envelope: built.envelope,
        subjects: displaySubjects(),
        correlation: correlationOf(summary, directory),
        status: {
          ...summaryStatusExtrasOf(pin, null),
          reasons: [
            `generation:${pin ?? "none"}`,
            ...(restarted ? ["generation-changed-restarted"] : []),
            ...(op === "explore" ? ["composed-explore"] : []),
            ...(summary.indexTruncated ? ["index-truncated"] : []),
            ...staleStatusReasons(staleCarrier),
          ],
        },
        unresolved: [
          ...built.extraUnresolved.map((reason) => ({ kind: "unresolved" as const, id: reason, reason })),
          ...staleUnresolvedEntries(staleCarrier),
        ],
        maxBytes,
      })
      if (op === "explore" && built.explore !== undefined) {
        return stringifyExploreEnvelope(envelope, built.explore)
      }
      return stringifyEnvelope(envelope)
    },
  }
}

function stringifyEnvelope(envelope: GraphContextEnvelope): string {
  const rendered = renderAgentContext(envelope)
  return JSON.stringify({ text: rendered.text, omittedItems: rendered.omittedItems, ...envelope })
}

function stringifyExploreEnvelope(envelope: GraphContextEnvelope, explore: ExplorePayload): string {
  const rendered = renderAgentContext(envelope)
  const text = `${rendered.text}\n${renderExploreText(explore)}`
  return JSON.stringify({ text, omittedItems: rendered.omittedItems, ...envelope, explore })
}
