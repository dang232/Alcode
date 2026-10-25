/**
 * Code-graph schema: entities, closed edge set, confidence, and scope key.
 *
 * Binding: `.omo/ulw/waves/s53-phase-a/schema-draft.md` sections 1-4.
 * Precedent: `memory-core/src/project-knowledge/record.ts` (fingerprint
 * grammar, project-id grammar, revision grammar, confidence grammar,
 * `RECORD_ID` shape, `InvalidationCase` vocabulary) and `validator.ts`
 * (freshness gates, promotion confidence gate). The grammars are
 * re-declared here so this module stays dependency-free; the text shapes
 * match on purpose.
 *
 * - Fingerprint: sha256(`${revision}:${blobSha256}`), 64 lowercase hex.
 * - Scope fingerprint: sha256(`${projectId}\n${worktreeId}\n${revision}`).
 * - Project id: `<safe-slug>-<sha256-8>`.
 * - Revision: 40 lowercase hex (a pinned commit sha, never a branch name).
 * - Confidence: number in [0, 1] with at most 2 decimals.
 */

import { createHash } from "node:crypto";

/** A graph record older than this is stale (same 7-day gate as validator.ts). */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type GraphEntityKind = "file" | "symbol";

export const GRAPH_ENTITY_KINDS: readonly GraphEntityKind[] = ["file", "symbol"];

/**
 * Closed edge set (schema-draft section 2). No other edge kinds may be
 * added without a schema revision. Unknown kinds are rejected at the
 * boundary, never stored or inferred.
 */
export type GraphEdgeKind =
  | "DEFINES"
  | "IMPORTS"
  | "CALLS_STATIC"
  | "CALLS_UNRESOLVED"
  | "EXPORTS"
  | "TESTS"
  | "LINKS_KNOWLEDGE"
  | "INVALIDATED_BY";

export const GRAPH_EDGE_KINDS: readonly GraphEdgeKind[] = [
  "DEFINES",
  "IMPORTS",
  "CALLS_STATIC",
  "CALLS_UNRESOLVED",
  "EXPORTS",
  "TESTS",
  "LINKS_KNOWLEDGE",
  "INVALIDATED_BY",
];

/** Number in [0, 1] with at most 2 decimals. Validated at every boundary. */
export type GraphConfidence = number;

/**
 * Cause vocabulary for INVALIDATED_BY `to` targets, reused unchanged from
 * the memory service `InvalidationCase` (schema-draft section 2).
 */
export type GraphInvalidationCause =
  | "SRC-EDIT"
  | "SRC-DELETE"
  | "SYM-RENAME"
  | "HEAD-MOVE"
  | "EVID-STALE"
  | "SUPERSEDE-CHAIN"
  | "SCOPE-NARROW"
  | "SECRET-FOUND"
  | "PROV-BREAK"
  | "ENV-CHANGE";

/** Subset of the cause vocabulary that applies to cached-graph freshness. */
export type GraphInvalidationCase = Extract<
  GraphInvalidationCause,
  "HEAD-MOVE" | "EVID-STALE" | "SRC-EDIT" | "SRC-DELETE" | "SYM-RENAME"
>;

/**
 * Scope key: which project, which worktree, at which revision, bound to
 * which content. The cache keys storage on (projectId, worktreeId) and
 * treats (revision, fingerprint) as the freshness binding.
 */
export interface GraphScopeKey {
  readonly projectId: string;
  readonly worktreeId: string;
  readonly revision: string;
  readonly fingerprint: string;
}

export interface GraphEntity {
  readonly id: string;
  readonly projectId: string;
  readonly filePath: string;
  readonly symbol: string;
  readonly kind: GraphEntityKind;
  readonly revision: string;
  readonly fingerprint: string;
  readonly confidence: GraphConfidence;
}

export interface GraphEdge {
  readonly from: string;
  /** Graph-internal kinds target an entity id; see hasExternalTarget. */
  readonly to: string;
  readonly kind: GraphEdgeKind;
  readonly confidence: GraphConfidence;
}

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ENTITY_ID = /^cg-[0-9a-f]{12}$/;
const KNOWLEDGE_RECORD_ID = /^pk-[0-9a-f]{12}$/;
const PROJECT_ID = /^[^\s/]+-[0-9a-f]{8}$/;
const WORKTREE_ID = /^[^\s/\\]{1,128}$/;
/** `file` or a namespaced symbol (same shape as record.ts). */
const SYMBOL = /^(?:file|fn:[^\s:]+|class:[^\s:]+|const:[^\s:]+)$/;
/** Confidence text: number in [0,1] with at most 2 decimals. */
const CONFIDENCE_TEXT = /^(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?)$/;

/** Cap for unresolved dynamics: never proven (schema-draft section 3). */
const UNRESOLVED_CONFIDENCE_CAP = 0.5;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Content binding of the pinned revision to the observed blob. */
export function computeFingerprint(revision: string, blobSha256: string): string {
  return sha256Hex(`${revision}:${blobSha256}`);
}

/** Content binding of a scope key to its (project, worktree, revision). */
export function computeScopeFingerprint(
  projectId: string,
  worktreeId: string,
  revision: string,
): string {
  return sha256Hex(`${projectId}\n${worktreeId}\n${revision}`);
}

/** Stable content-derived entity identity. Recomputed, never user-supplied. */
export function computeEntityId(projectId: string, filePath: string, symbol: string): string {
  return `cg-${sha256Hex(`${projectId}\n${filePath}\n${symbol}`).slice(0, 12)}`;
}

function isRepoRelativePath(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\")) return false;
  const segments = value.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") return false;
  }
  return true;
}

export function isProjectId(value: string): value is string {
  return PROJECT_ID.test(value);
}

export function isWorktreeId(value: string): value is string {
  return WORKTREE_ID.test(value);
}

export function isRevision(value: string): value is string {
  return HEX40.test(value);
}

export function isFingerprint(value: string): value is string {
  return HEX64.test(value);
}

export function isEntityKind(value: string): value is GraphEntityKind {
  return value === "file" || value === "symbol";
}

export function isEdgeKind(value: string): value is GraphEdgeKind {
  return (
    value === "DEFINES" ||
    value === "IMPORTS" ||
    value === "CALLS_STATIC" ||
    value === "CALLS_UNRESOLVED" ||
    value === "EXPORTS" ||
    value === "TESTS" ||
    value === "LINKS_KNOWLEDGE" ||
    value === "INVALIDATED_BY"
  );
}

export function isConfidence(value: number): value is GraphConfidence {
  return Number.isFinite(value) && value >= 0 && value <= 1 && CONFIDENCE_TEXT.test(String(value));
}

/** Highest confidence an edge kind may carry (schema-draft section 3). */
export function maxEdgeConfidence(kind: GraphEdgeKind): GraphConfidence {
  return kind === "CALLS_UNRESOLVED" ? UNRESOLVED_CONFIDENCE_CAP : 1;
}

/**
 * Per-edge confidence rule (schema-draft section 3): resolved kinds are
 * 1.00 or the edge is not emitted; CALLS_UNRESOLVED is capped at 0.50 and
 * never proven; LINKS_KNOWLEDGE inherits the linked record's confidence
 * unchanged, so any valid confidence holds.
 */
export function isEdgeConfidence(kind: GraphEdgeKind, confidence: number): boolean {
  if (!isConfidence(confidence)) return false;
  if (kind === "LINKS_KNOWLEDGE") return true;
  return confidence <= maxEdgeConfidence(kind) && (kind === "CALLS_UNRESOLVED" || confidence === 1);
}

export function isInvalidationCause(value: string): value is GraphInvalidationCause {
  return (
    value === "SRC-EDIT" ||
    value === "SRC-DELETE" ||
    value === "SYM-RENAME" ||
    value === "HEAD-MOVE" ||
    value === "EVID-STALE" ||
    value === "SUPERSEDE-CHAIN" ||
    value === "SCOPE-NARROW" ||
    value === "SECRET-FOUND" ||
    value === "PROV-BREAK" ||
    value === "ENV-CHANGE"
  );
}

export function isKnowledgeRecordId(value: string): value is string {
  return KNOWLEDGE_RECORD_ID.test(value);
}

/* ------------------------------------------------------------------
 * Extraction-time source-content index (content search).
 *
 * The extractor already holds every indexed file's source text as a
 * compiler `SourceFile`; this section derives a bounded per-file token
 * map from that text (no filesystem scan) and answers literal /
 * multi-term queries from the map plus the stored lines. Binary and
 * oversized files are skipped with a counted note, never silently.
 * ------------------------------------------------------------------ */

/** Distinct-token cap per indexed file (bounded per file, never the whole graph). */
export const MAX_CONTENT_TOKENS_PER_FILE = 5000;

/** Files larger than this are skipped from the content index (counted, never silent). */
export const MAX_CONTENT_FILE_BYTES = 256 * 1024;

/** Wall-clock bound for one searchContent call; the cut names itself. */
export const CONTENT_SEARCH_TIME_BUDGET_MS = 1000;

export const CONTENT_DEFAULT_LIMIT = 20;
export const CONTENT_MAX_LIMIT = 50;

/** Why a file was left out of the content index. */
export type ContentSkipReason = "binary" | "too-large";

export interface ContentSkip {
  readonly file: string;
  readonly reason: ContentSkipReason;
  readonly language: string;
  readonly isTest: boolean;
}

/** Bounded per-file content record: stored lines plus a token-to-lines map. */
export interface FileContentEntry {
  readonly file: string;
  /** Lowercase extension without the dot ("ts", "tsx", "js", ...). */
  readonly language: string;
  readonly isTest: boolean;
  readonly lines: readonly string[];
  /** Lowercase token -> sorted 1-based line numbers where it occurs. */
  readonly tokens: Readonly<Record<string, readonly number[]>>;
  /** Distinct tokens observed (may exceed the kept map when capped). */
  readonly tokenCount: number;
  /** True when tokens beyond MAX_CONTENT_TOKENS_PER_FILE were dropped. */
  readonly tokenTruncated: boolean;
}

/**
 * Extraction-time content index. Lives on the snapshot OUTSIDE
 * nodes/edges so existing consumers are untouched.
 */
export interface ContentIndex {
  /** The per-file token cap in force when this index was built. */
  readonly tokenCap: number;
  readonly files: Readonly<Record<string, FileContentEntry>>;
  readonly skipped: readonly ContentSkip[];
}

export function emptyContentIndex(): ContentIndex {
  return { tokenCap: MAX_CONTENT_TOKENS_PER_FILE, files: {}, skipped: [] };
}

export type ContentMatchReason = "literal" | "token" | "phrase";

export type ContentCoverage = "indexed" | "partial" | "unindexed";

export interface ContentSearchItem {
  readonly file: string;
  /** 1-based line number. */
  readonly line: number;
  /** 1-based column where the match starts. */
  readonly column?: number;
  /** Source excerpt, at most 200 characters. */
  readonly excerpt: string;
  readonly reason: ContentMatchReason;
  readonly confidence: 1;
}

export interface ContentSearchOptions {
  /** Result cap; clamped to [1, CONTENT_MAX_LIMIT]. Defaults to 20. */
  readonly limit?: number;
  /** Keep only files whose repo-relative path starts with this prefix. */
  readonly pathPrefix?: string;
  /** Keep only files with this language (extension, e.g. "ts"). */
  readonly language?: string;
  /** Keep only test files or only source files. */
  readonly kind?: "test" | "source";
  /** Keep only files at or under this repo-relative directory. */
  readonly directory?: string;
}

export interface ContentSearchResult {
  readonly items: readonly ContentSearchItem[];
  /** True when `limit` or the time budget cut the answer. */
  readonly truncated: boolean;
  readonly coverage: ContentCoverage;
  /** Skipped-file counts, caps, cuts: manual-review notes, never facts. */
  readonly unresolved: readonly string[];
  /** Unsupported inputs (e.g. a language with no indexed files). */
  readonly unsupported: readonly string[];
}

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  typescript: "ts",
  javascript: "js",
};

/** Split text into lowercase search tokens (identifiers and numbers). */
export function contentTokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_$]+/g) ?? [];
}

function normalizeLanguage(value: string): string {
  const bare = value.trim().toLowerCase().replace(/^\.+/, "");
  return LANGUAGE_ALIASES[bare] ?? bare;
}

function normalizePathFilter(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  const trimmed = cleaned.replace(/^\.\//, "");
  return trimmed === "" ? undefined : trimmed;
}

function clampContentLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return CONTENT_DEFAULT_LIMIT;
  return Math.min(CONTENT_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

export function contentFileLanguage(file: string): string {
  const base = file.split("/").pop() ?? file;
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "unknown" : base.slice(dot + 1).toLowerCase();
}

/**
 * Segment-aligned containment either way: the caller's filter may be rooted at the
 * project while indexed paths are rooted at the snapshot's common directory (which
 * can sit below the project), so `apps/api/src/x/` must still match `api/src/x/y.ts`.
 * A bare substring test would let a partial segment match unrelated paths (a filter
 * ending `rc/x` claiming `src/x`), so the boundary is checked and only whole leading
 * segments are dropped.
 */
function pathFilterMatches(file: string, filter: string): boolean {
  if (file.startsWith(filter)) return true;
  const segments = filter.split("/").filter((segment) => segment.length > 0);
  for (let index = 1; index < segments.length; index += 1) {
    const tail = segments.slice(index).join("/");
    if (file === tail || file.startsWith(`${tail}/`)) return true;
  }
  return false;
}

function fileMatchesFilters(
  file: string,
  isTest: boolean,
  language: string,
  prefix: string | undefined,
  directory: string | undefined,
  kind: "test" | "source" | undefined,
  wantedLanguage: string | undefined,
): boolean {
  if (prefix !== undefined && !pathFilterMatches(file, prefix)) return false;
  if (directory !== undefined && !pathFilterMatches(file, directory)) return false;
  if (kind === "test" && !isTest) return false;
  if (kind === "source" && isTest) return false;
  if (wantedLanguage !== undefined && language !== wantedLanguage) return false;
  return true;
}

function excerptFor(line: string, column: number): string {
  if (line.length <= 200) return line;
  const start = Math.max(0, Math.min(line.length - 200, column - 1 - 80));
  return line.slice(start, start + 200);
}

/**
 * Indexed source-content search over an extracted snapshot.
 *
 * Answered from the extraction-time content index only: a literal or
 * multi-term text query is matched against stored lines, prefiltered by
 * the per-file token map. Multi-term queries require every term present
 * in the same file. Ranking prefers whole-phrase hits, then
 * all-terms-in-order, then all-terms. Bounded by `limit` (default 20,
 * max 50) and a wall-clock budget; binary/large files skipped at
 * extraction time surface as a counted `unresolved` note, never
 * silently. A snapshot without a content index reports `unindexed`.
 */
export function searchContent(
  snapshot: { readonly content?: ContentIndex },
  query: string,
  options: ContentSearchOptions = {},
): ContentSearchResult {
  const limit = clampContentLimit(options.limit);
  const index = snapshot.content;
  if (index === undefined) {
    return {
      items: [],
      truncated: false,
      coverage: "unindexed",
      unresolved: ["snapshot has no content index (extracted before content search; re-run indexFiles)"],
      unsupported: [],
    };
  }
  const trimmed = query.trim();
  const terms = contentTokenize(trimmed);
  if (terms.length === 0) {
    return {
      items: [],
      truncated: false,
      coverage: "indexed",
      unresolved: [`query has no searchable terms: ${JSON.stringify(query.slice(0, 80))}`],
      unsupported: [],
    };
  }
  if (options.language !== undefined) {
    const wanted = normalizeLanguage(options.language);
    const supported = Object.values(index.files).some((entry) => entry.language === wanted);
    if (!supported) {
      return {
        items: [],
        truncated: false,
        coverage: "unindexed",
        unresolved: [],
        unsupported: [`unsupported language: "${options.language}" (no indexed files)`],
      };
    }
  }
  const prefix = normalizePathFilter(options.pathPrefix);
  const directory = normalizePathFilter(options.directory);
  const kind = options.kind === "test" || options.kind === "source" ? options.kind : undefined;
  const wantedLanguage = options.language === undefined ? undefined : normalizeLanguage(options.language);
  const deadline = Date.now() + CONTENT_SEARCH_TIME_BUDGET_MS;
  const uniqueTerms = [...new Set(terms)];
  const multi = terms.length > 1;
  const phraseNeedle = collapseWhitespace(trimmed.toLowerCase());
  const ranked: { item: ContentSearchItem; tier: number }[] = [];
  let timedOut = false;
  const candidateFiles = Object.values(index.files)
    .filter((entry) => fileMatchesFilters(entry.file, entry.isTest, entry.language, prefix, directory, kind, wantedLanguage))
    .sort((left, right) => (left.file < right.file ? -1 : 1));
  for (const entry of candidateFiles) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    if (!fileHasAllTerms(entry, uniqueTerms)) continue;
    const lowered = entry.lines.map((line) => line.toLowerCase());
    for (let lineNumber = 1; lineNumber <= entry.lines.length; lineNumber += 1) {
      const line = lowered[lineNumber - 1] as string;
      if (!uniqueTerms.every((term) => line.includes(term))) continue;
      let reason: ContentMatchReason;
      let tier: number;
      if (multi && collapseWhitespace(line).includes(phraseNeedle)) {
        reason = "phrase";
        tier = 0;
      } else if (!multi) {
        reason = "literal";
        tier = 0;
      } else if (termsInOrder(line, terms)) {
        reason = "token";
        tier = 1;
      } else {
        reason = "token";
        tier = 2;
      }
      const column = line.indexOf(uniqueTerms[0] as string) + 1;
      const raw = entry.lines[lineNumber - 1] as string;
      ranked.push({
        tier,
        item: {
          file: entry.file,
          line: lineNumber,
          column,
          excerpt: excerptFor(raw, column),
          reason,
          confidence: 1,
        },
      });
    }
  }
  ranked.sort((left, right) => {
    if (left.tier !== right.tier) return left.tier - right.tier;
    if (left.item.file !== right.item.file) return left.item.file < right.item.file ? -1 : 1;
    return left.item.line - right.item.line;
  });
  const truncated = timedOut || ranked.length > limit;
  const items = ranked.slice(0, limit).map((entry) => entry.item);
  const unresolved: string[] = [];
  const skippedInScope = index.skipped.filter((skip) =>
    fileMatchesFilters(skip.file, skip.isTest, skip.language, prefix, directory, kind, wantedLanguage),
  );
  if (skippedInScope.length > 0) {
    const named = skippedInScope.slice(0, 5).map((skip) => `${skip.file} (${skip.reason})`);
    const rest = skippedInScope.length > 5 ? ` and ${skippedInScope.length - 5} more` : "";
    unresolved.push(
      `skipped ${skippedInScope.length} file(s) from content search (binary or too large to index): ${named.join(", ")}${rest}`,
    );
  }
  const cappedInScope = candidateFiles.filter((entry) => entry.tokenTruncated).length;
  if (cappedInScope > 0) {
    unresolved.push(
      `${cappedInScope} file(s) hit the per-file token cap (${index.tokenCap}); matches past the cap may be missed`,
    );
  }
  if (timedOut) {
    unresolved.push(
      `search stopped after the ${CONTENT_SEARCH_TIME_BUDGET_MS}ms time budget; results are partial`,
    );
  }
  if (ranked.length > limit) {
    unresolved.push(`truncated to ${limit} of ${ranked.length} content matches`);
  }
  return {
    items,
    truncated,
    coverage: truncated ? "partial" : "indexed",
    unresolved,
    unsupported: [],
  };
}

function fileHasAllTerms(entry: FileContentEntry, terms: readonly string[]): boolean {
  const missing = terms.filter((term) => !(term in entry.tokens));
  if (missing.length === 0) return true;
  return missing.every((term) =>
    entry.lines.some((line) => line.toLowerCase().includes(term)),
  );
}

/** Terms appear in query order (sequentially, not necessarily contiguously). */
function termsInOrder(line: string, terms: readonly string[]): boolean {
  let from = 0;
  for (const term of terms) {
    const at = line.indexOf(term, from);
    if (at < 0) return false;
    from = at + term.length;
  }
  return true;
}

/**
 * Edge kinds whose `to` target lives outside the graph node set and is
 * therefore exempt from endpoint-existence checks: CALLS_UNRESOLVED points
 * at an unknown callee (well-formed marker, never a guessed symbol),
 * LINKS_KNOWLEDGE at a `pk-` record id (memory side authoritative),
 * INVALIDATED_BY at an invalidation cause. All other kinds target graph
 * entities that must exist.
 */
export function hasExternalTarget(kind: GraphEdgeKind): boolean {
  return kind === "CALLS_UNRESOLVED" || kind === "LINKS_KNOWLEDGE" || kind === "INVALIDATED_BY";
}

/** Storage key: per-project per-worktree. Revision binds freshness, not identity. */
export function storageKey(projectId: string, worktreeId: string): string {
  return `${projectId}\0${worktreeId}`;
}

export function scopeKeyEquals(left: GraphScopeKey, right: GraphScopeKey): boolean {
  return (
    left.projectId === right.projectId &&
    left.worktreeId === right.worktreeId &&
    left.revision === right.revision &&
    left.fingerprint === right.fingerprint
  );
}

export function isGraphScopeKey(scope: GraphScopeKey): boolean {
  return (
    isProjectId(scope.projectId) &&
    isWorktreeId(scope.worktreeId) &&
    isRevision(scope.revision) &&
    isFingerprint(scope.fingerprint)
  );
}

export function isGraphEntity(entity: GraphEntity): boolean {
  return (
    ENTITY_ID.test(entity.id) &&
    entity.id === computeEntityId(entity.projectId, entity.filePath, entity.symbol) &&
    isProjectId(entity.projectId) &&
    isRepoRelativePath(entity.filePath) &&
    SYMBOL.test(entity.symbol) &&
    isEntityKind(entity.kind) &&
    (entity.kind === "file" ? entity.symbol === "file" : entity.symbol !== "file") &&
    isRevision(entity.revision) &&
    isFingerprint(entity.fingerprint) &&
    isConfidence(entity.confidence)
  );
}

export function isGraphEdge(edge: GraphEdge, knownIds: ReadonlySet<string>): boolean {
  if (!isEdgeKind(edge.kind)) return false;
  if (!ENTITY_ID.test(edge.from) || !knownIds.has(edge.from)) return false;
  if (!isEdgeConfidence(edge.kind, edge.confidence)) return false;
  if (edge.kind === "CALLS_UNRESOLVED") return ENTITY_ID.test(edge.to);
  if (edge.kind === "LINKS_KNOWLEDGE") return isKnowledgeRecordId(edge.to);
  if (edge.kind === "INVALIDATED_BY") return isInvalidationCause(edge.to);
  return ENTITY_ID.test(edge.to) && knownIds.has(edge.to);
}
