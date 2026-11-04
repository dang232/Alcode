/**
 * Code-graph extraction over the vendored TypeScript compiler API.
 *
 * Contract: `.omo/ulw/waves/s53-phase-a/schema-draft.md` sections 1-3.
 * Closed edge set: DEFINES, IMPORTS, CALLS_STATIC, CALLS_UNRESOLVED,
 * EXPORTS, TESTS, LINKS_KNOWLEDGE (link-only), INVALIDATED_BY,
 * ROUTE, REFERENCES, NAVIGATES (S8 framework routes, literal-only).
 *
 * Static facts resolve through binder/checker symbols
 * (`checker.getSymbolAtLocation`, alias tracing) and the compiler's own
 * module resolution (a static specifier counts iff the checker maps it to
 * exactly one in-graph file). Anything the checker cannot pin to exactly
 * one in-graph definition is either skipped (failed imports, callees that
 * live in library/external files outside the graph) or recorded as
 * uncertain (CALLS_UNRESOLVED, capped at 0.50, never promoted).
 *
 * The parser dependency is the already-vendored `typescript@7.0.2`
 * (exact pin; no new dependency). Its native server binary ships inside
 * the vendored install and is located relative to that package, so no
 * install or lockfile change is needed. No GitNexus/ShadowFrog lines are
 * used anywhere: every fact below is derived from compiler API calls.
 */

import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { API, SymbolFlags } from "typescript/unstable/sync";
import type { Checker, Project, Symbol as TsSymbol } from "typescript/unstable/sync";
import {
  SyntaxKind,
  isArrayLiteralExpression,
  isArrowFunction,
  isCallExpression,
  isClassDeclaration,
  isClassExpression,
  isConstructorDeclaration,
  isElementAccessExpression,
  isEnumDeclaration,
  isExportDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isInterfaceDeclaration,
  isJsxAttribute,
  isJsxElement,
  isJsxExpression,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isMethodDeclaration,
  isNewExpression,
  isNoSubstitutionTemplateLiteral,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isSourceFile,
  isStringLiteral,
  isTemplateExpression,
  isTypeAliasDeclaration,
  isVariableDeclaration,
  isVariableStatement,
} from "typescript/unstable/ast";
import type { Node, SourceFile } from "typescript/unstable/ast";
import {
  MAX_CONTENT_FILE_BYTES,
  MAX_CONTENT_TOKENS_PER_FILE,
  contentFileLanguage,
  contentTokenize,
  emptyContentIndex,
} from "./schema";
import type { ContentIndex, ContentSkip, FileContentEntry } from "./schema";

export { searchContent } from "./schema";
export {
  CONTENT_SEARCH_TIME_BUDGET_MS,
  MAX_CONTENT_TOKENS_PER_FILE,
} from "./schema";

export type EdgeKind =
  | "DEFINES"
  | "IMPORTS"
  | "CALLS_STATIC"
  | "CALLS_UNRESOLVED"
  | "EXPORTS"
  | "TESTS"
  | "LINKS_KNOWLEDGE"
  | "INVALIDATED_BY"
  | "ROUTE"
  | "REFERENCES"
  | "NAVIGATES";

export type NodeKind = "file" | "symbol" | "export-contract" | "knowledge-link" | "call-site" | "route";

/** Framework that owns a route hop (S8: Express + Next.js App/Pages + React Router; S9: TanStack, Vue/Nuxt, SvelteKit, Angular). */
type FrameworkTag =
  | "express"
  | "next-app"
  | "next-pages"
  | "react-router"
  | "tanstack-router"
  | "vue-router"
  | "nuxt"
  | "sveltekit"
  | "angular";

/** Per-framework detector that produced a route hop; navigation shares the matched route's framework. */
type RouteResolverName =
  | "express-route-detector"
  | "next-app-detector"
  | "next-pages-detector"
  | "react-router-detector"
  | "tanstack-router-detector"
  | "vue-router-detector"
  | "nuxt-detector"
  | "sveltekit-detector"
  | "angular-detector"
  | "navigation-detector"
  | "markup-navigation-detector";

/** Cause vocabulary reused unchanged from the memory service (schema section 2). */
export type InvalidationCause =
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

export interface GraphNode {
  readonly id: string;
  readonly kind: NodeKind;
  /** Repo-relative path with forward slashes (the `file` half of `file:line`). */
  readonly file: string;
  /** 1-based line number. */
  readonly line: number;
  readonly name?: string;
  /** File nodes only: true when the path marks the file as a test. */
  readonly isTest?: boolean;
  /** Export-contract nodes: the origin symbol id. Knowledge-link nodes: the record id. */
  readonly target?: string;
  /** Knowledge-link nodes only: the pinned source revision (link-only, never a body). */
  readonly revision?: string;
}

export interface GraphEdge {
  readonly id: string;
  readonly kind: EdgeKind;
  readonly from: string;
  /** Node id, or `"unknown"` when the callee/target is not statically known. */
  readonly to: string;
  /** Number in [0,1] with at most 2 decimals (CONFIDENCE_TEXT). */
  readonly confidence: number;
  /** `file:line` source ref of the site that produced this edge. */
  readonly ref: string;
  /** Set on CALLS_UNRESOLVED and ambiguous EXPORTS: manual-review points, never facts. */
  readonly uncertain?: true;
  /** INVALIDATED_BY only: the invalidation cause. */
  readonly cause?: InvalidationCause;
  /** Call edges only: the reified call-site node id. */
  readonly callSite?: string;
  /** Route hops only: always `framework` (which detector family owns the hop). */
  readonly resolvedBy?: "framework";
  /** Route hops only: the framework that owns the matched route. */
  readonly framework?: FrameworkTag;
  /** Route hops only: the per-framework detector that produced this hop. */
  readonly resolver?: RouteResolverName;
  /** Markup NAVIGATES only: internal links are inferred, never confirmed. */
  readonly inferred?: true;
}

export interface GraphSnapshot {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /**
   * Extraction-time source-content index for searchContent. Kept outside
   * nodes/edges so existing consumers are untouched; absent only on
   * snapshots built before content search existed.
   */
  readonly content?: ContentIndex;
  /**
   * Absolute directory every `file` field is relative to. Node ids are rooted
   * here, not at the project root, so any caller that needs a real path must
   * join against this and never against the workspace directory. When
   * `IndexOptions.rootDir` is set this is that normalized root (so ids read
   * `apps/...` even when only `apps/...` files were indexed); otherwise it
   * is the legacy `commonDir(entryFiles)`.
   */
  readonly root?: string;
  /**
   * Entry and transitively discovered files refused for sitting outside
   * `IndexOptions.rootDir`, each with its reason. Absent on snapshots
   * built without `rootDir` and on legacy snapshots predating this field.
   */
  readonly dropped?: readonly DroppedFile[];
}

/** Advisory pointer to a ProjectKnowledgeRecord. The graph stores only the id triple, never the record body. */
export interface KnowledgeLinkInput {
  readonly from: string;
  readonly recordId: string;
  readonly confidence: number;
  readonly sourceFile: string;
  readonly sourceRevision: string;
}

/** Bounded build budgets for extraction. All fields optional; absent means unbounded (legacy). */
export interface IndexBuildBudgets {
  /** Max entry files (before discovery). Exceeding fails closed with BUDGET_FILES. */
  readonly maxFiles?: number;
  /** Max graph nodes (checked at each project boundary). Exceeding fails closed with BUDGET_NODES. */
  readonly maxNodes?: number;
  /** Max graph edges (checked at each project boundary). Exceeding fails closed with BUDGET_EDGES. */
  readonly maxEdges?: number;
  /** Max wall-clock ms for the whole build (checked at each project boundary). Exceeding fails closed with BUDGET_TIME. */
  readonly maxMs?: number;
}

export interface IndexOptions {
  /** Override for the vendored TypeScript server binary. Defaults to the binary inside `typescript@7.0.2`. */
  readonly tsserverPath?: string;
  /** Advisory knowledge pointers, emitted as LINKS_KNOWLEDGE edges (link-only). */
  readonly knowledge?: readonly KnowledgeLinkInput[];
  /**
   * Repository root every `file` id and stored file path is relative to
   * (POSIX, e.g. `apps/api/src/x.ts`). A nested index root then keeps the
   * repository id space, so an import that resolves outside the indexed
   * files still lands on an id the resolver can find. When omitted, the
   * legacy `commonDir(entryFiles)` behaviour applies unchanged.
   */
  readonly rootDir?: string;
  /**
   * Real work-completion reporter, called from inside the synchronous build.
   * A caller that must keep its own event loop free (the server's index worker)
   * needs progress that describes phases actually finished — the number of
   * projects analysed so far — not a percentage invented from a timer.
   * Called on the indexing thread, so a reporter must not block.
   */
  readonly onProgress?: (event: IndexProgressEvent) => void;
  /**
   * The graph accumulated after each finished project, handed over while the
   * remaining projects are still building. A caller publishes it as the
   * current partial answer so a reader sees the projects already analysed
   * instead of an empty graph; the returned snapshot stays the complete one.
   * Cross-project edges into projects not yet analysed are absent by nature.
   */
  readonly onPartialSnapshot?: (
    snapshot: GraphSnapshot,
    progress: { readonly projectsDone: number; readonly projectsTotal: number },
  ) => void;
  /**
   * Cooperative cancellation. Checked before each project and after each
   * project boundary; when aborted the build throws an AbortError-named
   * Error with `code: "CANCELLED"` (finally blocks still dispose/close).
   * The async lifecycle wrapper maps this to `{ status: "cancelled" }`
   * instead of letting it escape as an untyped throw.
   */
  readonly signal?: AbortSignal;
  /**
   * Bounded build budgets (files/nodes/edges/time). Checked upfront
   * (files) and at each project boundary (nodes/edges/time). Exceeding
   * throws an Error with `code: "BUDGET_FILES" | "BUDGET_NODES" |
   * "BUDGET_EDGES" | "BUDGET_TIME"`; the lifecycle wrapper maps it to
   * `{ status: "truncated" }` with the budget reason, never a silent cut.
   */
  readonly budgets?: IndexBuildBudgets;
  /**
   * Caller generation for observability only. Carried into progress events
   * so a worker can discard stale callbacks; never enforced here (the
   * lifecycle coordinator owns generation safety).
   */
  readonly generation?: string | number;
}

/** One measured step of a build: nothing here is extrapolated. */
export interface IndexProgressEvent {
  readonly phase: "program" | "projects" | "edges" | "done";
  /** Entry files handed to the build. */
  readonly files: number;
  /** Projects whose entries have been analysed, and how many there are. */
  readonly projectsDone: number;
  readonly projectsTotal: number;
  /** Graph size so far (present on projects/edges/done when known). */
  readonly nodes?: number;
  readonly edges?: number;
  /** Wall-clock ms since build start (present when the builder tracks it). */
  readonly elapsedMs?: number;
  /** Caller generation echoed back for stale-callback discard. */
  readonly generation?: string | number;
}

/** A file refused during extraction because it sits outside `IndexOptions.rootDir`. */
export interface DroppedFile {
  readonly file: string;
  readonly reason: "outside-root";
}

const STATIC_CONFIDENCE = 1;
/** Schema section 3: unresolved dynamics are never proven (capped at most 0.50). */
const UNRESOLVED_CONFIDENCE = 0.5;
const UNKNOWN = "unknown";
const RECORD_ID = /^pk-[0-9a-f]{12}$/;
const MAX_ALIAS_DEPTH = 10;

/** Structured build failure code (thrown on Error.code, mapped by the lifecycle wrapper). */
export type IndexBuildFailureCode = "CANCELLED" | "BUDGET_FILES" | "BUDGET_NODES" | "BUDGET_EDGES" | "BUDGET_TIME";

function buildFailure(code: IndexBuildFailureCode, message: string): Error {
  return Object.assign(new Error(message), { code, name: code === "CANCELLED" ? "AbortError" : "Error" });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw buildFailure("CANCELLED", "code-graph: indexing cancelled (AbortSignal aborted)");
  }
}

export function isTestPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return (
    /(^|\/)__tests__\//.test(normalized) ||
    /\.test\.[cm]?[tj]sx?$/.test(normalized) ||
    /\.spec\.[cm]?[tj]sx?$/.test(normalized) ||
    /(^|\/)(test|tests)\//.test(normalized)
  );
}

function toPosixPath(value: string): string {
  const slashed = value.replace(/\\/g, "/");
  // Only separators and the drive-letter case are normalized. The rest of
  // the path keeps its original case: filesystems and checkouts can hold
  // two files whose names differ only by case, so lowercasing the whole
  // path would merge distinct files into one id.
  return /^[a-zA-Z]:\//.test(slashed) ? slashed[0].toLowerCase() + slashed.slice(1) : slashed;
}

function commonDir(paths: readonly string[]): string {
  const [first, ...rest] = paths;
  if (first === undefined) return process.cwd().replace(/\\/g, "/");
  const firstSegments = first.split("/").slice(0, -1);
  let length = firstSegments.length;
  for (const other of rest) {
    const segments = other.split("/").slice(0, -1);
    let shared = 0;
    while (shared < length && shared < segments.length && firstSegments[shared] === segments[shared]) {
      shared += 1;
    }
    length = shared;
  }
  return firstSegments.slice(0, length).join("/") || "/";
}

/**
 * Locate the native server binary inside the already-vendored
 * `typescript@7.0.2` install (platform package, then the linked `.bin`
 * launcher). Throws when neither is present so the failure is explicit
 * instead of a silent empty graph.
 */
/**
 * Inside a packaged app the compiler binary must run from real files, not
 * from inside the archive: when the candidate sits under `app.asar` and an
 * `app.asar.unpacked` twin exists, the twin wins. In a checkout there is no
 * twin and the candidate is used unchanged, so development behavior never
 * moves. Whether plain spawn resolves archive paths depends on Electron
 * internals; the twin is a real path under every runtime.
 */
export function preferUnpacked(candidate: string): string {
  for (const marker of ["/app.asar/", "\\app.asar\\"]) {
    const at = candidate.indexOf(marker);
    if (at < 0) continue;
    const twin =
      candidate.slice(0, at) + marker.replace("app.asar", "app.asar.unpacked") + candidate.slice(at + marker.length);
    try {
      if (existsSync(twin)) return twin;
    } catch {
      // An unreadable twin is no twin; fall through to the candidate.
    }
  }
  return candidate;
}

function defaultTsServerPath(): string {
  const require = createRequire(import.meta.url);
  const tsDir = dirname(require.resolve("typescript/package.json"));
  const platformRoot = join(tsDir, "..", "@typescript");
  if (existsSync(platformRoot)) {
    const platform = `typescript-${process.platform}-${process.arch}`;
    const names = readdirSync(platformRoot).sort();
    const ordered = [...names.filter((name) => name === platform), ...names.filter((name) => name !== platform)];
    for (const name of ordered) {
      for (const binary of ["tsc.exe", "tsgo", "tsc"]) {
        const candidate = join(platformRoot, name, "lib", binary);
        if (existsSync(candidate)) return preferUnpacked(candidate);
      }
    }
  }
  for (const binary of process.platform === "win32" ? ["tsc.exe", "tsc"] : ["tsc"]) {
    const candidate = join(tsDir, "..", ".bin", binary);
    if (existsSync(candidate)) return preferUnpacked(candidate);
  }
  throw new Error(
    "code-graph: TypeScript native server binary not found inside typescript@7.0.2; " +
      "pass IndexOptions.tsserverPath explicitly",
  );
}

/** Follow an alias chain to its final symbol. Only called with alias symbols; anything else returns as-is. */
function followAlias(checker: Checker, symbol: TsSymbol): TsSymbol {
  let current = symbol;
  for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth += 1) {
    if ((current.flags & SymbolFlags.Alias) === 0) return current;
    const next = checker.getAliasedSymbol(current);
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

function ownerClassName(declaration: Node): string | undefined {
  const parent = declaration.parent;
  if (parent === undefined) return undefined;
  if ((isClassDeclaration(parent) || isClassExpression(parent)) && parent.name && isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return undefined;
}

function callableInitializer(decl: Node): boolean {
  if (!isVariableDeclaration(decl) || decl.initializer === undefined) return false;
  return isArrowFunction(decl.initializer) || isFunctionExpression(decl.initializer);
}

/** Stable content-derived symbol id (`fn:…` / `class:…` / `const:…`-shaped, per the SOURCE_SYMBOL grammar). */
function symbolIdForDecl(declaration: Node, nameText: string, fileRel: string): string {
  if (isConstructorDeclaration(declaration)) {
    const owner = ownerClassName(declaration);
    return `fn:${owner ? `${owner}.` : ""}constructor@${fileRel}`;
  }
  if (isMethodDeclaration(declaration)) {
    const owner = ownerClassName(declaration);
    return `fn:${owner ? `${owner}.` : ""}${nameText}@${fileRel}`;
  }
  if (isClassDeclaration(declaration) || isClassExpression(declaration)) return `class:${nameText}@${fileRel}`;
  if (isInterfaceDeclaration(declaration)) return `interface:${nameText}@${fileRel}`;
  if (isEnumDeclaration(declaration)) return `enum:${nameText}@${fileRel}`;
  if (isTypeAliasDeclaration(declaration)) return `type:${nameText}@${fileRel}`;
  if (
    isFunctionDeclaration(declaration) ||
    isFunctionExpression(declaration) ||
    isArrowFunction(declaration)
  ) {
    return `fn:${nameText}@${fileRel}`;
  }
  return `const:${nameText}@${fileRel}`;
}

function isCallableDeclKind(kind: SyntaxKind): boolean {
  return (
    kind === SyntaxKind.FunctionDeclaration ||
    kind === SyntaxKind.FunctionExpression ||
    kind === SyntaxKind.ArrowFunction ||
    kind === SyntaxKind.MethodDeclaration ||
    kind === SyntaxKind.Constructor ||
    kind === SyntaxKind.ClassDeclaration ||
    kind === SyntaxKind.ClassExpression
  );
}

/* ------------------------------------------------------------------
 * S8 route + navigation detectors (Express + Next.js App/Pages + React
 * Router) plus S9 (TanStack Router, Vue Router, Nuxt, SvelteKit,
 * Angular). Literal-only destinations; computed or unserved
 * destinations never produce a route hop and fail closed as
 * CALLS_UNRESOLVED (capped at 0.50, never proven). Every framework hop
 * carries resolvedBy framework + resolver name; markup links carry
 * inferred. Multi-app scoping matches only routes in the sender's app.
 * ------------------------------------------------------------------ */

const EXPRESS_METHODS: readonly string[] = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "options",
  "head",
  "all",
  "use",
];

function isExpressMethod(name: string): boolean {
  const lower = name.toLowerCase();
  return EXPRESS_METHODS.includes(lower);
}

function expressMethodOf(name: string): string {
  return name.toUpperCase();
}

/** App scope for multi-app matching: `apps/<name>` when nested, else first segment, else root. */
function appScopeOf(rel: string): string {
  const segments = rel.split("/");
  if (segments.length <= 1) return "(root)";
  const head = segments[0] ?? "";
  if (head === "apps") return `apps/${segments[1] ?? ""}`;
  return head;
}

function stripQueryHash(value: string): string {
  const query = value.indexOf("?");
  const hash = value.indexOf("#");
  let end = value.length;
  if (query >= 0 && query < end) end = query;
  if (hash >= 0 && hash < end) end = hash;
  return value.slice(0, end);
}

function normalizePattern(value: string): string {
  const clean = stripQueryHash(value);
  const leading = clean.startsWith("/") ? clean : `/${clean}`;
  if (leading.length > 1 && leading.endsWith("/")) return leading.slice(0, -1);
  return leading;
}

function splitSegments(path: string): string[] {
  const clean = stripQueryHash(path);
  const trimmed = clean.length > 1 && clean.endsWith("/") ? clean.slice(0, -1) : clean;
  return trimmed.split("/").filter((segment) => segment.length > 0);
}

/** Single `:` matches one segment; `:x*` matches the tail; `:x?`/`:x*?` may be absent. */
function routeMatches(pattern: string, dest: string): boolean {
  const normalizedDest = normalizePattern(dest);
  const normalizedPattern = normalizePattern(pattern);
  if (normalizedPattern === normalizedDest) return true;
  const patternSegments = splitSegments(normalizedPattern);
  const destSegments = splitSegments(normalizedDest);
  let patternIndex = 0;
  let destIndex = 0;
  while (patternIndex < patternSegments.length) {
    const patternSegment = patternSegments[patternIndex] ?? "";
    const isParam = patternSegment.startsWith(":");
    const isMulti = patternSegment.endsWith("*");
    const isOptional = patternSegment.endsWith("?");
    if (!isParam) {
      const destSegment = destSegments[destIndex];
      if (destSegment === undefined || destSegment !== patternSegment) return false;
      patternIndex += 1;
      destIndex += 1;
      continue;
    }
    if (isMulti) {
      const restPattern = patternSegments.length - patternIndex - 1;
      const restDest = destSegments.length - destIndex;
      if (restDest < restPattern) return false;
      if (restPattern === 0) {
        if (isOptional) return true;
        return restDest >= 1;
      }
      const consume = restDest - restPattern;
      if (!isOptional && consume < 1) return false;
      destIndex += consume;
      patternIndex += 1;
      continue;
    }
    const destSegment = destSegments[destIndex];
    if (destSegment === undefined) {
      if (isOptional) {
        patternIndex += 1;
        continue;
      }
      return false;
    }
    if (destSegment.length === 0) return false;
    patternIndex += 1;
    destIndex += 1;
  }
  return destIndex === destSegments.length;
}

function mapRouteSegment(segment: string): string | undefined {
  if (segment.startsWith("(") && segment.endsWith(")")) return undefined;
  if (segment.startsWith("@")) return undefined;
  if (segment.startsWith("_") && segment.length > 1) return undefined;
  const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (optionalCatchAll !== null) {
    const name = (optionalCatchAll[1] ?? "").split("=")[0]?.split(":")[0] ?? "";
    if (name.length === 0) return undefined;
    return `:${name}*?`;
  }
  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll !== null) {
    const name = (catchAll[1] ?? "").split("=")[0]?.split(":")[0] ?? "";
    if (name.length === 0) return undefined;
    return `:${name}*`;
  }
  const dynamic = segment.match(/^\[(.+)\]$/);
  if (dynamic !== null) {
    const name = (dynamic[1] ?? "").split("=")[0]?.split(":")[0] ?? "";
    if (name.length === 0) return undefined;
    return `:${name}`;
  }
  if (segment === "*") return ":wild*";
  return segment;
}

function joinRouteSegments(segments: readonly (string | undefined)[]): string {
  const kept: string[] = [];
  for (const segment of segments) {
    if (segment !== undefined && segment.length > 0) kept.push(segment);
  }
  if (kept.length === 0) return "/";
  return `/${kept.join("/")}`;
}

function nextAppPattern(rel: string): string | undefined {
  const marker = "/app/";
  const at = rel.lastIndexOf(marker);
  let after: string | undefined;
  if (at >= 0) after = rel.slice(at + marker.length);
  else if (rel.startsWith("app/")) after = rel.slice("app/".length);
  else return undefined;
  if (after === undefined) return undefined;
  if (/^page\.[tj]sx?$/.test(after)) return "/";
  const suffix = after.match(/^(.*)\/page\.[tj]sx?$/);
  if (suffix === null) return undefined;
  const dir = suffix[1] ?? "";
  if (dir.length === 0) return "/";
  const mapped = dir.split("/").map(mapRouteSegment);
  return joinRouteSegments(mapped);
}

function nextAppRoutePattern(rel: string): string | undefined {
  const marker = "/app/";
  const at = rel.lastIndexOf(marker);
  let after: string | undefined;
  if (at >= 0) after = rel.slice(at + marker.length);
  else if (rel.startsWith("app/")) after = rel.slice("app/".length);
  else return undefined;
  if (after === undefined) return undefined;
  if (/^route\.[tj]s$/.test(after)) return "/";
  const suffix = after.match(/^(.*)\/route\.[tj]s$/);
  if (suffix === null) return undefined;
  const dir = suffix[1] ?? "";
  if (dir.length === 0) return "/";
  const mapped = dir.split("/").map(mapRouteSegment);
  return joinRouteSegments(mapped);
}

function nextPagesPattern(rel: string): string | undefined {
  const marker = "/pages/";
  const at = rel.lastIndexOf(marker);
  let after: string | undefined;
  if (at >= 0) after = rel.slice(at + marker.length);
  else if (rel.startsWith("pages/")) after = rel.slice("pages/".length);
  else return undefined;
  if (after === undefined) return undefined;
  const base = after.split("/").pop() ?? "";
  if (base.startsWith("_")) return undefined;
  const withoutExt = after.replace(/\.[tj]sx?$/, "");
  if (withoutExt === "index") return "/";
  if (withoutExt.endsWith("/index")) {
    const dir = withoutExt.slice(0, -"/index".length);
    if (dir.length === 0) return "/";
    return joinRouteSegments(dir.split("/").map(mapRouteSegment));
  }
  return joinRouteSegments(withoutExt.split("/").map(mapRouteSegment));
}

/* ------------------------------------------------------------------
 * S9 file-route grammars (Nuxt, SvelteKit) and config-path grammar.
 * Same literal-only posture as S8: a computed path is never guessed.
 * ------------------------------------------------------------------ */

/** TanStack `$param` / `$` segments translated into the shared `:param` grammar so matching stays one rule. */
function tanstackSegment(segment: string): string | undefined {
  if (segment === "$") return ":wild*";
  if (segment.startsWith("$")) {
    const name = segment.slice(1);
    if (name.length === 0) return undefined;
    return `:${name}`;
  }
  return mapRouteSegment(segment);
}

/**
 * Literal config `path` values (`{ path }` in React/Vue/Angular/TanStack
 * route records, `createFileRoute('/x')`). Bare segments are rooted
 * (`users` -> `/users`); `''` is the parent match (`/`); `*`/`**`
 * wildcards become `:wild*`. Anything non-literal (identifiers,
 * templates with holes, concatenations) is computed, never guessed.
 */
function routePathOfNode(node: Node | undefined, framework: FrameworkTag): RouteDestination {
  if (node === undefined) return { kind: "ignore" };
  let text: string | undefined;
  if (isStringLiteral(node)) text = node.text;
  else if (isNoSubstitutionTemplateLiteral(node)) text = node.text;
  else if (isTemplateExpression(node)) return { kind: "computed" };
  else return { kind: "computed" };
  if (text === undefined) return { kind: "computed" };
  const clean = stripQueryHash(text);
  if (clean === "" || clean === "/" || clean === "index") return { kind: "literal", value: "/" };
  if (clean === "*" || clean === "**") return { kind: "literal", value: "/:wild*" };
  if (
    clean.startsWith("http://") ||
    clean.startsWith("https://") ||
    clean.startsWith("//") ||
    clean.startsWith("mailto:") ||
    clean.startsWith("tel:") ||
    clean.startsWith("#") ||
    /\s/.test(clean)
  ) {
    return { kind: "ignore" };
  }
  const rooted = clean.startsWith("/") ? clean : `/${clean}`;
  const segments = splitSegments(rooted).map((segment) =>
    framework === "tanstack-router" ? tanstackSegment(segment) : mapRouteSegment(segment),
  );
  return { kind: "literal", value: joinRouteSegments(segments) };
}

/**
 * Nuxt file routes over indexed companions: the pages arm (page grammar
 * shared with Next, `.vue` included) and the server arm
 * grammar: `server/api/hello.ts` -> `/api/hello`, optional HTTP-method
 * suffix stripped). `.vue` pages themselves are never indexed (the
 * compiler only sees TS), so the pages arm fires for TS companions that
 * share the grammar; the server arm fires on real server route files.
 */
function nuxtRoutePattern(rel: string): string | undefined {
  const pagesMarker = "/pages/";
  const pagesAt = rel.lastIndexOf(pagesMarker);
  let pagesAfter: string | undefined;
  if (pagesAt >= 0) pagesAfter = rel.slice(pagesAt + pagesMarker.length);
  else if (rel.startsWith("pages/")) pagesAfter = rel.slice("pages/".length);
  if (pagesAfter !== undefined) {
    if (pagesAfter.split("/").pop()?.startsWith("_") === true) return undefined;
    const withoutExt = pagesAfter.replace(/\.(vue|[tj]sx?)$/, "");
    if (withoutExt === "index") return "/";
    if (withoutExt.endsWith("/index")) {
      const dir = withoutExt.slice(0, -"/index".length);
      if (dir.length === 0) return "/";
      return joinRouteSegments(dir.split("/").map(mapRouteSegment));
    }
    return joinRouteSegments(withoutExt.split("/").map(mapRouteSegment));
  }
  const serverMarker = "/server/";
  const serverAt = rel.lastIndexOf(serverMarker);
  let serverAfter: string | undefined;
  if (serverAt >= 0) serverAfter = rel.slice(serverAt + serverMarker.length);
  else if (rel.startsWith("server/")) serverAfter = rel.slice("server/".length);
  if (serverAfter !== undefined) {
    const kind = serverAfter.split("/")[0];
    if (kind !== "api" && kind !== "routes") return undefined;
    const rest = serverAfter.split("/").slice(1).join("/");
    const withoutMethod = rest.replace(/\.(get|post|put|delete|patch|head|options)\.[tj]s$/, "").replace(/\.[tj]s$/, "");
    const prefix = kind === "api" ? "api" : "";
    if (withoutMethod === "index" || withoutMethod === "") return prefix === "" ? "/" : `/${prefix}`;
    if (withoutMethod.endsWith("/index")) {
      const dir = withoutMethod.slice(0, -"/index".length);
      const mapped = dir.split("/").map(mapRouteSegment);
      return prefix === "" ? joinRouteSegments(mapped) : joinRouteSegments([prefix, ...mapped]);
    }
    const mapped = withoutMethod.split("/").map(mapRouteSegment);
    return prefix === "" ? joinRouteSegments(mapped) : joinRouteSegments([prefix, ...mapped]);
  }
  return undefined;
}

/**
 * SvelteKit file routes over indexed `.ts` companions:
 * `routes/about/+page.ts` -> `/about`, `routes/api/users/+server.ts` ->
 * `/api/users`. Param grammar (`[id]`, `[...rest]`, matchers) reuses the
 * shared segment mapper; group segments (`(app)`) are skipped the same way.
 */
function svelteKitRoutePattern(rel: string): string | undefined {
  const marker = "/routes/";
  const at = rel.lastIndexOf(marker);
  let after: string | undefined;
  if (at >= 0) after = rel.slice(at + marker.length);
  else if (rel.startsWith("routes/")) after = rel.slice("routes/".length);
  else return undefined;
  if (after === undefined) return undefined;
  const leaf = after.split("/").pop() ?? "";
  if (!/^\+(?:page(?:\.server)?|server|layout(?:\.server)?|error)\.[tj]s$/.test(leaf)) return undefined;
  const dir = after.split("/").slice(0, -1).join("/");
  if (dir.length === 0) return "/";
  return joinRouteSegments(dir.split("/").map(mapRouteSegment));
}

function routeIdFor(framework: FrameworkTag, pattern: string, rel: string, method?: string): string {
  const normalized = normalizePattern(pattern);
  const head = method !== undefined && method.length > 0 ? `${method} ` : "";
  return `route:${framework}:${head}${normalized}@${rel}`;
}

function resolverForRoute(framework: FrameworkTag): RouteResolverName {
  if (framework === "express") return "express-route-detector";
  if (framework === "next-app") return "next-app-detector";
  if (framework === "next-pages") return "next-pages-detector";
  if (framework === "tanstack-router") return "tanstack-router-detector";
  if (framework === "vue-router") return "vue-router-detector";
  if (framework === "nuxt") return "nuxt-detector";
  if (framework === "sveltekit") return "sveltekit-detector";
  if (framework === "angular") return "angular-detector";
  return "react-router-detector";
}

type RouteDestination =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "computed" }
  | { readonly kind: "ignore" };

function destinationOfStringText(text: string): RouteDestination {
  if (text.startsWith("/") && !text.startsWith("//")) return { kind: "literal", value: normalizePattern(stripQueryHash(text)) };
  if (
    text.startsWith("http://") ||
    text.startsWith("https://") ||
    text.startsWith("//") ||
    text.startsWith("mailto:") ||
    text.startsWith("tel:") ||
    text.startsWith("#")
  ) {
    return { kind: "ignore" };
  }
  return { kind: "ignore" };
}

function destinationOfNode(node: Node | undefined): RouteDestination {
  if (node === undefined) return { kind: "ignore" };
  if (isStringLiteral(node)) return destinationOfStringText(node.text);
  if (isNoSubstitutionTemplateLiteral(node)) return destinationOfStringText(node.text);
  if (isTemplateExpression(node)) return { kind: "computed" };
  if (isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (!isPropertyAssignment(property)) continue;
      const key = property.name;
      const keyText = isIdentifier(key) ? key.text : isStringLiteral(key) ? key.text : undefined;
      // S9: TanStack `navigate({ to })` / `redirect({ to })` carry the
      // destination under `to`; Next-style `{ pathname }` keeps working.
      if (keyText !== "pathname" && keyText !== "to") continue;
      return destinationOfNode(property.initializer);
    }
    return { kind: "ignore" };
  }
  // S9: Angular `router.navigate(['/users'])` passes an array whose first
  // entry is the destination; anything else in the array is ignored.
  if (isArrayLiteralExpression(node)) {
    const first = node.elements.length > 0 ? node.elements[0] : undefined;
    if (first === undefined) return { kind: "ignore" };
    const dest = destinationOfNode(first);
    return dest.kind === "literal" ? dest : { kind: "computed" };
  }
  return { kind: "computed" };
}

interface FileCtx {
  readonly key: string;
  readonly rel: string;
  readonly sourceFile: SourceFile;
  readonly project: Project;
  readonly checker: Checker;
}

type CallOutcome =
  | { readonly kind: "static"; readonly targetId: string }
  | { readonly kind: "unresolved" }
  | { readonly kind: "skip" };

interface RouteRecord {
  readonly id: string;
  readonly pattern: string;
  readonly method?: string;
  readonly framework: FrameworkTag;
  readonly resolver: RouteResolverName;
  readonly file: string;
  readonly line: number;
  readonly appScope: string;
}

function fileImportsNeedle(ctx: FileCtx, needle: string): boolean {
  let found = false;
  const visit = (node: Node): void => {
    if (found) return;
    if (isImportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier && isStringLiteral(specifier) && specifier.text.includes(needle)) {
        found = true;
        return;
      }
      return;
    }
    if (isCallExpression(node)) {
      const callee = node.expression;
      if (isIdentifier(callee) && callee.text === "require" && node.arguments.length > 0) {
        const first = node.arguments[0];
        if (first && isStringLiteral(first) && first.text.includes(needle)) {
          found = true;
          return;
        }
      }
    }
    node.forEachChild((child) => {
      visit(child);
      return undefined;
    });
  };
  ctx.sourceFile.forEachChild((child) => {
    visit(child);
    return undefined;
  });
  return found;
}

function handlerIdForIdentifier(ctx: FileCtx, files: Map<string, FileCtx>, ident: Node): string | undefined {
  if (!isIdentifier(ident)) return undefined;
  const symbol = ctx.checker.getSymbolAtLocation(ident);
  if (!symbol) return undefined;
  const final = followAlias(ctx.checker, symbol);
  const inGraph: Node[] = [];
  for (const handle of final.declarations) {
    const declaration = handle.resolve(ctx.project);
    if (!declaration) continue;
    const declFile = toPosixPath(declaration.getSourceFile().fileName);
    if (files.has(declFile)) inGraph.push(declaration);
  }
  if (inGraph.length === 0) return undefined;
  const callable = inGraph.filter(
    (declaration) => isCallableDeclKind(declaration.kind) || callableInitializer(declaration),
  );
  if (callable.length !== inGraph.length) return undefined;
  const targets = new Set<string>();
  for (const declaration of callable) {
    const nameText = declNameOf(declaration);
    if (!nameText) return undefined;
    const declFile = toPosixPath(declaration.getSourceFile().fileName);
    const targetCtx = files.get(declFile);
    if (!targetCtx) return undefined;
    targets.add(symbolIdForDecl(declaration, nameText, targetCtx.rel));
  }
  if (targets.size !== 1) return undefined;
  const only: string[] = [];
  for (const target of targets) only.push(target);
  return only[0];
}

function declNameOf(declaration: Node): string | undefined {
  if (declaration.kind === SyntaxKind.Constructor) return "constructor";
  if (isFunctionDeclaration(declaration)) return declaration.name && isIdentifier(declaration.name) ? declaration.name.text : undefined;
  if (isFunctionExpression(declaration)) return declaration.name && isIdentifier(declaration.name) ? declaration.name.text : undefined;
  if (isClassDeclaration(declaration)) return declaration.name && isIdentifier(declaration.name) ? declaration.name.text : undefined;
  if (isClassExpression(declaration)) return declaration.name && isIdentifier(declaration.name) ? declaration.name.text : undefined;
  if (isInterfaceDeclaration(declaration)) return declaration.name && isIdentifier(declaration.name) ? declaration.name.text : undefined;
  if (isEnumDeclaration(declaration)) return declaration.name && isIdentifier(declaration.name) ? declaration.name.text : undefined;
  if (isTypeAliasDeclaration(declaration)) return declaration.name && isIdentifier(declaration.name) ? declaration.name.text : undefined;
  if (isMethodDeclaration(declaration)) return declaration.name && isIdentifier(declaration.name) ? declaration.name.text : undefined;
  if (isVariableDeclaration(declaration)) return isIdentifier(declaration.name) ? declaration.name.text : undefined;
  return undefined;
}

function defaultHandlerForFile(ctx: FileCtx, files: Map<string, FileCtx>): { readonly id: string; readonly line: number } | undefined {
  const moduleSymbol = ctx.checker.getSymbolAtLocation(ctx.sourceFile);
  if (moduleSymbol) {
    const exported = ctx.checker.getExportsOfModule(moduleSymbol);
    for (const exportedSymbol of exported) {
      if (exportedSymbol.name !== "default") continue;
      const final = followAlias(ctx.checker, exportedSymbol);
      for (const handle of final.declarations) {
        const declaration = handle.resolve(ctx.project);
        if (!declaration) continue;
        const declFile = toPosixPath(declaration.getSourceFile().fileName);
        if (declFile !== ctx.key) continue;
        const nameText = declNameOf(declaration);
        if (!nameText) continue;
        const id = symbolIdForDecl(declaration, nameText, ctx.rel);
        const line = ctx.sourceFile.getLineAndCharacterOfPosition(declaration.getStart(ctx.sourceFile)).line + 1;
        return { id, line };
      }
    }
  }
  return undefined;
}

/** Cheap graph size probe for budget enforcement (no sorting, no copy). */
interface GraphBuildSize {
  readonly nodes: number;
  readonly edges: number;
  readonly files: number;
}

class GraphBuilder {
  private readonly files = new Map<string, FileCtx>();
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly routes: RouteRecord[] = [];
  private readonly routeIds = new Set<string>();
  private readonly callOrdinals = new Map<string, number>();
  /** Files whose per-file facts are already emitted. Re-emission
   * recomputes identical entries for stable ids but mints fresh
   * ordinal call-site ids every pass, duplicating the whole call graph
   * once per project. Emitting each file exactly once keeps the unique
   * facts and drops the copies. */
  private readonly emittedFiles = new Set<string>();
  private readonly contentFiles = new Map<string, FileContentEntry>();
  private readonly contentSkipped: ContentSkip[] = [];
  private readonly droppedKeys = new Set<string>();
  readonly dropped: DroppedFile[] = [];

  constructor(
    private readonly root: string,
    /**
     * Rip out nothing silently: outside-root files are refused with a
     * recorded reason instead of falling back to an absolute-path id the
     * resolver cannot find. False (legacy) keeps the old absolute fallback.
     */
    private readonly strictRoot = false,
  ) {}

  snapshot(): GraphSnapshot {
    const nodes = [...this.nodes.values()].sort((left, right) => (left.id < right.id ? -1 : 1));
    const edges = [...this.edges.values()].sort((left, right) => (left.id < right.id ? -1 : 1));
    const files = [...this.contentFiles.values()].sort((left, right) => (left.file < right.file ? -1 : 1));
    const byFile: Record<string, FileContentEntry> = {};
    for (const entry of files) byFile[entry.file] = entry;
    const skipped = [...this.contentSkipped].sort((left, right) => (left.file < right.file ? -1 : 1));
    return { nodes, edges, content: { tokenCap: MAX_CONTENT_TOKENS_PER_FILE, files: byFile, skipped } };
  }

  /** Cheap size probe for budget enforcement (no sorting, no copy). */
  size(): GraphBuildSize {
    return { nodes: this.nodes.size, edges: this.edges.size, files: this.files.size };
  }

  addEntries(project: Project, entries: readonly string[]): void {
    const program = project.program;
    const queue: string[] = [];
    for (const entry of entries) {
      const key = toPosixPath(entry);
      const sourceFile = program.getSourceFile(entry);
      if (!sourceFile) throw new Error(`code-graph: entry is not part of the TypeScript program: ${entry}`);
      if (program.isSourceFileDefaultLibrary(sourceFile)) {
        throw new Error(`code-graph: entry is a TypeScript default library file: ${entry}`);
      }
      queue.push(key);
    }
    while (queue.length > 0) {
      const key = queue.pop();
      if (key === undefined || this.files.has(key)) continue;
      const sourceFile = program.getSourceFile(key);
      if (!sourceFile) continue;
      if (program.isSourceFileDefaultLibrary(sourceFile) || program.isSourceFileFromExternalLibrary(sourceFile)) {
        continue;
      }
      const rel = this.relOf(key);
      if (rel === undefined) {
        this.dropOutsideRoot(key);
        continue;
      }
      const ctx: FileCtx = { key, rel, sourceFile, project, checker: project.checker };
      this.files.set(key, ctx);
      this.indexContent(ctx);
      this.nodes.set(`file:${rel}`, { id: `file:${rel}`, kind: "file", file: rel, line: 1, name: rel });
      for (const target of this.staticImportTargets(ctx)) {
        if (!this.files.has(target)) queue.push(target);
      }
    }
    const ordered = [...this.files.values()].sort((left, right) => (left.rel < right.rel ? -1 : 1));
    const fresh: FileCtx[] = [];
    for (const ctx of ordered) {
      if (!this.emittedFiles.has(ctx.key)) {
        this.emittedFiles.add(ctx.key);
        fresh.push(ctx);
      }
    }
    for (const ctx of fresh) {
      const isTest = isTestPath(ctx.rel);
      if (isTest) {
        const fileNode = this.nodes.get(`file:${ctx.rel}`);
        if (fileNode) this.nodes.set(fileNode.id, { ...fileNode, isTest: true });
      }
      this.emitImports(ctx, isTest);
      this.emitExports(ctx);
      this.emitDefinitions(ctx);
      this.emitCalls(ctx);
    }
    this.emitRouteNodes(ordered);
    this.emitNavigations(ordered);
  }

  addKnowledgeLinks(links: readonly KnowledgeLinkInput[]): void {
    for (const link of links) {
      if (link.from.length === 0 || !RECORD_ID.test(link.recordId)) continue;
      if (!Number.isFinite(link.confidence) || link.confidence < 0 || link.confidence > 1) continue;
      const id = `knowledge:${link.recordId}`;
      const file = this.linkFileOf(link.sourceFile);
      if (file === undefined) continue;
      this.nodes.set(id, { id, kind: "knowledge-link", file, line: 1, target: link.recordId, revision: link.sourceRevision });
      const edgeId = `links:${link.from}:${link.recordId}`;
      this.edges.set(edgeId, {
        id: edgeId,
        kind: "LINKS_KNOWLEDGE",
        from: link.from,
        to: id,
        confidence: link.confidence,
        ref: `${file}:1`,
      });
    }
  }

  /**
   * Derive the bounded per-file content record from the source text the
   * extractor already holds. Binary or oversized files are skipped with
   * a counted record, never silently.
   */
  private indexContent(ctx: FileCtx): void {
    const language = contentFileLanguage(ctx.rel);
    const isTest = isTestPath(ctx.rel);
    const text = ctx.sourceFile.getFullText();
    if (text.includes("\0")) {
      this.contentSkipped.push({ file: ctx.rel, reason: "binary", language, isTest });
      return;
    }
    if (text.length > MAX_CONTENT_FILE_BYTES) {
      this.contentSkipped.push({ file: ctx.rel, reason: "too-large", language, isTest });
      return;
    }
    const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
    const perToken = new Map<string, number[]>();
    lines.forEach((line, index) => {
      for (const token of contentTokenize(line)) {
        const seen = perToken.get(token);
        if (seen) {
          if (seen[seen.length - 1] !== index + 1) seen.push(index + 1);
        } else {
          perToken.set(token, [index + 1]);
        }
      }
    });
    const tokens: Record<string, readonly number[]> = {};
    let kept = 0;
    let tokenTruncated = false;
    for (const [token, atLines] of perToken) {
      if (kept >= MAX_CONTENT_TOKENS_PER_FILE) {
        tokenTruncated = true;
        break;
      }
      tokens[token] = atLines;
      kept += 1;
    }
    this.contentFiles.set(ctx.rel, {
      file: ctx.rel,
      language,
      isTest,
      lines,
      tokens,
      tokenCount: perToken.size,
      tokenTruncated,
    });
  }

  /**
   * The single normalization point for file identity: forward slashes (via
   * `toPosixPath` on every key), no leading `./`, no drive prefix, no `..`
   * segment. Absolute resolved keys under the root slice to a repo-relative
   * id; anything else is legacy callers' absolute fallback, or — under
   * `strictRoot` — an outside-root refusal (`undefined`), never a silent
   * re-root onto an id the resolver cannot find.
   */
  private relOf(key: string): string | undefined {
    const prefix = `${this.root}/`;
    if (!key.startsWith(prefix)) return this.strictRoot ? undefined : key;
    const rel = key.slice(prefix.length);
    if (rel.length === 0 || rel.split("/").includes("..")) return undefined;
    return rel;
  }

  /** Record an outside-root file once, so the refusal is visible, not silent. */
  private dropOutsideRoot(key: string): void {
    if (this.droppedKeys.has(key)) return;
    this.droppedKeys.add(key);
    this.dropped.push({ file: key, reason: "outside-root" });
  }

  /**
   * Advisory link paths follow the same id space: relativized under the
   * root when absolute, kept as-is when already root-relative, refused
   * (`undefined`) otherwise.
   */
  private linkFileOf(sourceFile: string): string | undefined {
    const posix = toPosixPath(sourceFile);
    if (!this.strictRoot) return posix;
    const prefix = `${this.root}/`;
    if (posix.startsWith(prefix)) {
      const rel = posix.slice(prefix.length);
      if (rel.length > 0 && !rel.split("/").includes("..")) return rel;
      return undefined;
    }
    if (posix.startsWith("/") || /^[a-z]:\//.test(posix) || posix.split("/").includes("..")) {
      return undefined;
    }
    return posix.replace(/^\.\//, "");
  }

  private lineOf(ctx: FileCtx, node: Node): number {
    return ctx.sourceFile.getLineAndCharacterOfPosition(node.getStart(ctx.sourceFile)).line + 1;
  }

  /** Resolve a static specifier through the checker's module symbol to one in-program file. */
  private resolveModuleKey(ctx: FileCtx, specifierNode: Node): string | undefined {
    const symbol = ctx.checker.getSymbolAtLocation(specifierNode);
    if (!symbol || (symbol.flags & SymbolFlags.Alias) !== 0) return undefined;
    const keys = new Set<string>();
    for (const handle of symbol.declarations) {
      const declaration = handle.resolve(ctx.project);
      if (!declaration || !isSourceFile(declaration)) continue;
      keys.add(toPosixPath(declaration.fileName));
    }
    if (keys.size !== 1) return undefined;
    const [key] = keys;
    if (key === undefined) return undefined;
    const target = ctx.project.program.getSourceFile(key);
    if (!target) return undefined;
    if (ctx.project.program.isSourceFileDefaultLibrary(target)) return undefined;
    return key;
  }

  private staticImportTargets(ctx: FileCtx): string[] {
    const targets: string[] = [];
    const visit = (node: Node): void => {
      if (isImportDeclaration(node) || isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier;
        if (specifier && isStringLiteral(specifier)) {
          const key = this.resolveModuleKey(ctx, specifier);
          if (key) targets.push(key);
        }
        return;
      }
      node.forEachChild((child) => {
        visit(child);
        return undefined;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return undefined;
    });
    return targets;
  }

  private emitImports(ctx: FileCtx, isTest: boolean): void {
    const visit = (node: Node): void => {
      if (isImportDeclaration(node) || isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier;
        if (specifier && isStringLiteral(specifier)) {
          const line = this.lineOf(ctx, specifier);
          const key = this.resolveModuleKey(ctx, specifier);
          const target = key === undefined ? undefined : this.files.get(key);
          if (target) {
            const edgeId = `imports:file:${ctx.rel}:file:${target.rel}:${line}`;
            this.edges.set(edgeId, {
              id: edgeId,
              kind: "IMPORTS",
              from: `file:${ctx.rel}`,
              to: `file:${target.rel}`,
              confidence: STATIC_CONFIDENCE,
              ref: `${ctx.rel}:${line}`,
            });
            if (isTest) {
              const testId = `tests:file:${ctx.rel}:file:${target.rel}:${line}`;
              this.edges.set(testId, {
                id: testId,
                kind: "TESTS",
                from: `file:${ctx.rel}`,
                to: `file:${target.rel}`,
                confidence: STATIC_CONFIDENCE,
                ref: `${ctx.rel}:${line}`,
              });
            }
          }
          // Ambiguous/failed resolution emits no edge (schema section 3).
        }
        return;
      }
      node.forEachChild((child) => {
        visit(child);
        return undefined;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return undefined;
    });
  }

  private emitExports(ctx: FileCtx): void {
    if (!ctx.sourceFile.externalModuleIndicator) return;
    const moduleSymbol = ctx.checker.getSymbolAtLocation(ctx.sourceFile);
    if (!moduleSymbol) return;
    const exported = ctx.checker.getExportsOfModule(moduleSymbol);
    const contractLines = this.exportContractLines(ctx);
    for (const exportedSymbol of exported) {
      if ((exportedSymbol.flags & SymbolFlags.ExportStar) !== 0) continue;
      if (exportedSymbol.name.startsWith("__")) continue;
      const contractId = `export:${exportedSymbol.name}@${ctx.rel}`;
      const origin = followAlias(ctx.checker, exportedSymbol);
      const targets = new Map<string, string>();
      for (const handle of origin.declarations) {
        const declaration = handle.resolve(ctx.project);
        if (!declaration) continue;
        const declFile = toPosixPath(declaration.getSourceFile().fileName);
        const targetCtx = this.files.get(declFile);
        if (!targetCtx) continue;
        const nameText = this.declaredName(declaration);
        if (!nameText) continue;
        const targetId = symbolIdForDecl(declaration, nameText, targetCtx.rel);
        targets.set(targetId, targetId);
      }
      const line = contractLines.get(exportedSymbol.name) ?? 1;
      if (targets.size === 1) {
        const [targetId] = targets.keys();
        if (targetId === undefined) continue;
        this.nodes.set(contractId, {
          id: contractId,
          kind: "export-contract",
          file: ctx.rel,
          line,
          name: exportedSymbol.name,
          target: targetId,
        });
        const edgeId = `exports:file:${ctx.rel}:${contractId}:${targetId}`;
        this.edges.set(edgeId, {
          id: edgeId,
          kind: "EXPORTS",
          from: `file:${ctx.rel}`,
          to: contractId,
          confidence: STATIC_CONFIDENCE,
          ref: `${ctx.rel}:${line}`,
        });
      } else {
        // Star-re-export collisions (or unresolvable origins): one uncertain
        // record per candidate, never a guessed single winner.
        this.nodes.set(contractId, {
          id: contractId,
          kind: "export-contract",
          file: ctx.rel,
          line,
          name: exportedSymbol.name,
        });
        const candidates = targets.size > 0 ? [...targets.keys()] : [UNKNOWN];
        for (const candidate of candidates) {
          const edgeId = `exports:file:${ctx.rel}:${contractId}:${candidate}`;
          this.edges.set(edgeId, {
            id: edgeId,
            kind: "EXPORTS",
            from: `file:${ctx.rel}`,
            to: candidate === UNKNOWN ? UNKNOWN : contractId,
            confidence: UNRESOLVED_CONFIDENCE,
            ref: `${ctx.rel}:${line}`,
            uncertain: true,
          });
        }
      }
    }
  }

  /** Map exported names to the 1-based line of their local export statement. */
  private exportContractLines(ctx: FileCtx): Map<string, number> {
    const lines = new Map<string, number>();
    const visit = (node: Node): void => {
      if (isExportDeclaration(node)) {
        const clause = node.exportClause;
        if (clause && clause.kind === SyntaxKind.NamedExports) {
          clause.elements.forEach((element) => {
            const exported = element.propertyName ?? element.name;
            const text = exported.text;
            if (!lines.has(text)) lines.set(text, this.lineOf(ctx, element));
          });
        }
        if (node.moduleSpecifier === undefined) return;
        return;
      }
      node.forEachChild((child) => {
        visit(child);
        return undefined;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return undefined;
    });
    return lines;
  }

  private declaredName(declaration: Node): string | undefined {
    if (isConstructorDeclaration(declaration)) return "constructor";
    if (
      isFunctionDeclaration(declaration) ||
      isFunctionExpression(declaration) ||
      isClassDeclaration(declaration) ||
      isClassExpression(declaration) ||
      isInterfaceDeclaration(declaration) ||
      isEnumDeclaration(declaration) ||
      isTypeAliasDeclaration(declaration) ||
      isMethodDeclaration(declaration)
    ) {
      const name = declaration.name;
      return name && isIdentifier(name) ? name.text : undefined;
    }
    if (isVariableDeclaration(declaration)) {
      return isIdentifier(declaration.name) ? declaration.name.text : undefined;
    }
    return undefined;
  }

  private emitDefinitions(ctx: FileCtx): void {
    const define = (declaration: Node, nameNode: Node): void => {
      if (!isIdentifier(nameNode)) return;
      const symbol = ctx.checker.getSymbolAtLocation(nameNode);
      if (!symbol) return;
      const id = symbolIdForDecl(declaration, nameNode.text, ctx.rel);
      const line = this.lineOf(ctx, nameNode);
      this.nodes.set(id, { id, kind: "symbol", file: ctx.rel, line, name: symbol.name });
      const edgeId = `defines:file:${ctx.rel}:${id}`;
      this.edges.set(edgeId, {
        id: edgeId,
        kind: "DEFINES",
        from: `file:${ctx.rel}`,
        to: id,
        confidence: STATIC_CONFIDENCE,
        ref: `${ctx.rel}:${line}`,
      });
    };
    const visit = (node: Node): void => {
      if (isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (isVariableDeclaration(declaration)) define(declaration, declaration.name);
        }
      } else if (
        isFunctionDeclaration(node) ||
        isFunctionExpression(node) ||
        isClassDeclaration(node) ||
        isClassExpression(node) ||
        isInterfaceDeclaration(node) ||
        isEnumDeclaration(node) ||
        isTypeAliasDeclaration(node) ||
        isMethodDeclaration(node)
      ) {
        if (node.name) define(node, node.name);
      }
      node.forEachChild((child) => {
        visit(child);
        return undefined;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return undefined;
    });
  }

  private emitCalls(ctx: FileCtx): void {
    const callers: string[] = [`file:${ctx.rel}`];
    const visit = (node: Node): void => {
      const boundary = this.boundaryId(ctx, node);
      if (boundary) callers.push(boundary);
      const caller = callers[callers.length - 1] ?? `file:${ctx.rel}`;
      if (isCallExpression(node)) this.recordCall(ctx, node, node.expression, caller);
      else if (isNewExpression(node)) this.recordCall(ctx, node, node.expression, caller);
      else if (isJsxOpeningElement(node) || isJsxSelfClosingElement(node)) {
        this.recordCall(ctx, node, node.tagName, caller);
      }
      node.forEachChild((child) => {
        visit(child);
        return undefined;
      });
      if (boundary) callers.pop();
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return undefined;
    });
  }

  /**
   * Named function boundary id, or undefined for anonymous/top-level code.
   * Constructor bodies attribute to the owning class symbol, which always
   * has a DEFINES node (constructors themselves are not separate symbols).
   */
  private boundaryId(ctx: FileCtx, node: Node): string | undefined {
    if (isConstructorDeclaration(node)) {
      const owner = ownerClassName(node);
      return owner ? `class:${owner}@${ctx.rel}` : `file:${ctx.rel}`;
    }
    if (
      isFunctionDeclaration(node) ||
      isFunctionExpression(node) ||
      isMethodDeclaration(node) ||
      isVariableDeclaration(node)
    ) {
      if (!isVariableDeclaration(node) && node.name === undefined) return undefined;
      const nameNode = isVariableDeclaration(node) ? node.name : node.name;
      if (!nameNode || !isIdentifier(nameNode)) return undefined;
      if (isVariableDeclaration(node) && !callableInitializer(node)) return undefined;
      if (isVariableDeclaration(node)) return `const:${nameNode.text}@${ctx.rel}`;
      const symbol = ctx.checker.getSymbolAtLocation(nameNode);
      if (!symbol) return undefined;
      return symbolIdForDecl(node, nameNode.text, ctx.rel);
    }
    return undefined;
  }

  private classifyCall(ctx: FileCtx, call: Node, callee: Node): CallOutcome {
    if (callee.kind === SyntaxKind.ImportKeyword) return { kind: "unresolved" };
    if (isIdentifier(callee) && (callee.text === "eval" || callee.text === "require")) {
      return { kind: "unresolved" };
    }
    if (isNewExpression(call) && isIdentifier(callee) && callee.text === "Function") {
      return { kind: "unresolved" };
    }
    if (isElementAccessExpression(callee)) return { kind: "unresolved" };
    if (isFunctionExpression(callee) || isArrowFunction(callee)) return { kind: "skip" };
    const symbol = ctx.checker.getSymbolAtLocation(callee);
    if (!symbol) return { kind: "unresolved" };
    const final = followAlias(ctx.checker, symbol);
    const inGraph: Node[] = [];
    for (const handle of final.declarations) {
      const declaration = handle.resolve(ctx.project);
      if (!declaration) continue;
      const declFile = toPosixPath(declaration.getSourceFile().fileName);
      if (this.files.has(declFile)) inGraph.push(declaration);
    }
    // Callees that live only in library/external files are outside the
    // graph scope: no edge, rather than a false uncertain record.
    if (inGraph.length === 0) return { kind: "skip" };
    const callable = inGraph.filter((declaration) => isCallableDeclKind(declaration.kind) || callableInitializer(declaration));
    if (callable.length !== inGraph.length) return { kind: "unresolved" };
    const targets = new Set<string>();
    for (const declaration of callable) {
      const nameText = this.declaredName(declaration);
      if (!nameText) return { kind: "unresolved" };
      const declFile = toPosixPath(declaration.getSourceFile().fileName);
      const targetCtx = this.files.get(declFile);
      if (!targetCtx) return { kind: "unresolved" };
      targets.add(symbolIdForDecl(declaration, nameText, targetCtx.rel));
    }
    if (targets.size !== 1) return { kind: "unresolved" };
    const [targetId] = targets;
    if (targetId === undefined) return { kind: "unresolved" };
    return { kind: "static", targetId };
  }

  private recordCall(ctx: FileCtx, call: Node, callee: Node, callerId: string): void {
    const outcome = this.classifyCall(ctx, call, callee);
    if (outcome.kind === "skip") return;
    const line = this.lineOf(ctx, call);
    const ordinal = this.callOrdinals.get(ctx.key) ?? 0;
    this.callOrdinals.set(ctx.key, ordinal + 1);
    const callSiteId = `call:${ctx.rel}:${line}:${ordinal}`;
    const calleeText = callee.getText().slice(0, 80);
    this.nodes.set(callSiteId, { id: callSiteId, kind: "call-site", file: ctx.rel, line, name: calleeText });
    if (outcome.kind === "static") {
      const edgeId = `calls-static:${callerId}:${outcome.targetId}:${callSiteId}`;
      this.edges.set(edgeId, {
        id: edgeId,
        kind: "CALLS_STATIC",
        from: callerId,
        to: outcome.targetId,
        confidence: STATIC_CONFIDENCE,
        ref: `${ctx.rel}:${line}`,
        callSite: callSiteId,
      });
    } else {
      const edgeId = `calls-unresolved:${callerId}:${callSiteId}`;
      this.edges.set(edgeId, {
        id: edgeId,
        kind: "CALLS_UNRESOLVED",
        from: callerId,
        to: UNKNOWN,
        confidence: UNRESOLVED_CONFIDENCE,
        ref: `${ctx.rel}:${line}`,
        uncertain: true,
        callSite: callSiteId,
      });
    }
  }

  private emitRouteRecord(record: RouteRecord, handlerId: string | undefined, handlerRef: string): void {
    if (this.routeIds.has(record.id)) return;
    this.routeIds.add(record.id);
    this.routes.push(record);
    this.nodes.set(record.id, { id: record.id, kind: "route", file: record.file, line: record.line, name: record.pattern });
    const routeEdgeId = `route:file:${record.file}:${record.id}`;
    this.edges.set(routeEdgeId, {
      id: routeEdgeId,
      kind: "ROUTE",
      from: `file:${record.file}`,
      to: record.id,
      confidence: STATIC_CONFIDENCE,
      ref: `${record.file}:${record.line}`,
      resolvedBy: "framework",
      framework: record.framework,
      resolver: record.resolver,
    });
    if (handlerId !== undefined) {
      const refEdgeId = `references:${record.id}:${handlerId}`;
      this.edges.set(refEdgeId, {
        id: refEdgeId,
        kind: "REFERENCES",
        from: record.id,
        to: handlerId,
        confidence: STATIC_CONFIDENCE,
        ref: handlerRef,
        resolvedBy: "framework",
        framework: record.framework,
        resolver: record.resolver,
      });
    }
  }

  private emitRouteUnresolved(ctx: FileCtx, senderId: string, line: number, siteText: string): void {
    const ordinal = this.callOrdinals.get(ctx.key) ?? 0;
    this.callOrdinals.set(ctx.key, ordinal + 1);
    const callSiteId = `call:${ctx.rel}:${line}:${ordinal}`;
    this.nodes.set(callSiteId, { id: callSiteId, kind: "call-site", file: ctx.rel, line, name: siteText.slice(0, 80) });
    const edgeId = `calls-unresolved:${senderId}:${callSiteId}`;
    if (this.edges.has(edgeId)) return;
    this.edges.set(edgeId, {
      id: edgeId,
      kind: "CALLS_UNRESOLVED",
      from: senderId,
      to: UNKNOWN,
      confidence: UNRESOLVED_CONFIDENCE,
      ref: `${ctx.rel}:${line}`,
      uncertain: true,
      callSite: callSiteId,
    });
  }

  private findMatchingRoutes(pattern: string, appScope: string): RouteRecord[] {
    const out: RouteRecord[] = [];
    for (const record of this.routes) {
      if (record.appScope !== appScope) continue;
      if (routeMatches(record.pattern, pattern)) out.push(record);
    }
    out.sort((left, right) => (left.id < right.id ? -1 : 1));
    return out;
  }

  private emitNavigation(
    ctx: FileCtx,
    senderId: string,
    dest: RouteDestination,
    line: number,
    inferred: boolean,
    siteText: string,
    resolver: RouteResolverName,
  ): void {
    if (dest.kind === "ignore") return;
    if (dest.kind === "computed") {
      this.emitRouteUnresolved(ctx, senderId, line, siteText);
      return;
    }
    const appScope = appScopeOf(ctx.rel);
    const matches = this.findMatchingRoutes(dest.value, appScope);
    if (matches.length === 0) {
      this.emitRouteUnresolved(ctx, senderId, line, siteText);
      return;
    }
    for (const match of matches) {
      const edgeId = `navigates:${senderId}:${match.id}:${ctx.rel}:${line}`;
      if (this.edges.has(edgeId)) continue;
      const edge: GraphEdge = {
        id: edgeId,
        kind: "NAVIGATES",
        from: senderId,
        to: match.id,
        confidence: STATIC_CONFIDENCE,
        ref: `${ctx.rel}:${line}`,
        resolvedBy: "framework",
        framework: match.framework,
        resolver,
      };
      this.edges.set(edgeId, inferred ? { ...edge, inferred: true } : edge);
    }
  }

  private emitRouteNodes(ordered: readonly FileCtx[]): void {
    for (const ctx of ordered) {
      this.emitExpressRoutes(ctx);
      this.emitNextAppRoutes(ctx);
      this.emitNextPagesRoutes(ctx);
      this.emitReactRouterRoutes(ctx);
      this.emitReactRouterFullRoutes(ctx);
      this.emitTanStackRouterRoutes(ctx);
      this.emitVueRouterRoutes(ctx);
      this.emitNuxtRoutes(ctx);
      this.emitSvelteKitRoutes(ctx);
      this.emitAngularRoutes(ctx);
    }
  }

  private collectExpressRouterVars(ctx: FileCtx): Set<string> {
    const vars = new Set<string>();
    const visit = (node: Node): void => {
      if (isVariableDeclaration(node)) {
        if (!isIdentifier(node.name)) return;
        const initializer = node.initializer;
        if (!initializer || !isCallExpression(initializer)) return;
        const callee = initializer.expression;
        if (isIdentifier(callee) && callee.text === "express") {
          vars.add(node.name.text);
          return;
        }
        if (isIdentifier(callee) && callee.text === "Router") {
          vars.add(node.name.text);
          return;
        }
        if (isPropertyAccessExpression(callee)) {
          const object = callee.expression;
          const name = callee.name;
          if (isIdentifier(object) && object.text === "express" && isIdentifier(name) && name.text === "Router") {
            vars.add(node.name.text);
            return;
          }
        }
        return;
      }
      node.forEachChild((child) => {
        visit(child);
        return undefined;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return undefined;
    });
    return vars;
  }

  private emitExpressRoutes(ctx: FileCtx): void {
    if (!fileImportsNeedle(ctx, "express")) return;
    const routerVars = this.collectExpressRouterVars(ctx);
    const visit = (node: Node): void => {
      if (isCallExpression(node)) {
        const callee = node.expression;
        if (isPropertyAccessExpression(callee)) {
          const object = callee.expression;
          const methodNode = callee.name;
          if (isIdentifier(object) && isIdentifier(methodNode) && isExpressMethod(methodNode.text)) {
            const receiver = object.text;
            const known = routerVars.has(receiver) || receiver === "app" || receiver === "router";
            if (known) {
              const args = node.arguments;
              const first = args.length > 0 ? args[0] : undefined;
              const line = this.lineOf(ctx, node);
              const dest = destinationOfNode(first);
              if (dest.kind === "literal") {
                const method = expressMethodOf(methodNode.text);
                const pattern = dest.value;
                const record: RouteRecord = {
                  id: routeIdFor("express", pattern, ctx.rel, method),
                  pattern,
                  method,
                  framework: "express",
                  resolver: "express-route-detector",
                  file: ctx.rel,
                  line,
                  appScope: appScopeOf(ctx.rel),
                };
                const handlerRef = `${ctx.rel}:${line}`;
                let emitted = false;
                for (let index = 1; index < args.length; index += 1) {
                  const handler = args[index];
                  if (handler === undefined) continue;
                  if (isArrayLiteralExpression(handler)) {
                    for (const element of handler.elements) {
                      const handlerId = handlerIdForIdentifier(ctx, this.files, element);
                      if (handlerId !== undefined) {
                        this.emitRouteRecord(record, handlerId, handlerRef);
                        emitted = true;
                      }
                    }
                    continue;
                  }
                  if (isIdentifier(handler)) {
                    const handlerId = handlerIdForIdentifier(ctx, this.files, handler);
                    if (handlerId !== undefined) {
                      this.emitRouteRecord(record, handlerId, handlerRef);
                      emitted = true;
                    }
                    continue;
                  }
                }
                if (!emitted) this.emitRouteRecord(record, undefined, handlerRef);
              } else if (dest.kind === "computed") {
                this.emitRouteUnresolved(ctx, `file:${ctx.rel}`, line, node.getText().slice(0, 80));
              }
            }
          }
        }
      }
      node.forEachChild((child) => {
        visit(child);
        return undefined;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return undefined;
    });
  }

  private emitNextAppRoutes(ctx: FileCtx): void {
    const pagePattern = nextAppPattern(ctx.rel);
    if (pagePattern !== undefined) {
      const handler = defaultHandlerForFile(ctx, this.files);
      const line = handler !== undefined ? handler.line : 1;
      const handlerId = handler !== undefined ? handler.id : `file:${ctx.rel}`;
      const record: RouteRecord = {
        id: routeIdFor("next-app", pagePattern, ctx.rel),
        pattern: pagePattern,
        framework: "next-app",
        resolver: "next-app-detector",
        file: ctx.rel,
        line,
        appScope: appScopeOf(ctx.rel),
      };
      this.emitRouteRecord(record, handlerId, `${ctx.rel}:${line}`);
      return;
    }
    const endpointPattern = nextAppRoutePattern(ctx.rel);
    if (endpointPattern !== undefined) {
      const moduleSymbol = ctx.checker.getSymbolAtLocation(ctx.sourceFile);
      if (!moduleSymbol) return;
      const exported = ctx.checker.getExportsOfModule(moduleSymbol);
      const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
      for (const exportedSymbol of exported) {
        if (!methods.includes(exportedSymbol.name)) continue;
        const final = followAlias(ctx.checker, exportedSymbol);
        for (const handle of final.declarations) {
          const declaration = handle.resolve(ctx.project);
          if (!declaration) continue;
          const declFile = toPosixPath(declaration.getSourceFile().fileName);
          if (declFile !== ctx.key) continue;
          const nameText = declNameOf(declaration);
          if (!nameText) continue;
          const handlerId = symbolIdForDecl(declaration, nameText, ctx.rel);
          const line = ctx.sourceFile.getLineAndCharacterOfPosition(declaration.getStart(ctx.sourceFile)).line + 1;
          const record: RouteRecord = {
            id: routeIdFor("next-app", endpointPattern, ctx.rel, exportedSymbol.name),
            pattern: endpointPattern,
            method: exportedSymbol.name,
            framework: "next-app",
            resolver: "next-app-detector",
            file: ctx.rel,
            line,
            appScope: appScopeOf(ctx.rel),
          };
          this.emitRouteRecord(record, handlerId, `${ctx.rel}:${line}`);
        }
      }
    }
  }

  private emitNextPagesRoutes(ctx: FileCtx): void {
    const pattern = nextPagesPattern(ctx.rel);
    if (pattern === undefined) return;
    const handler = defaultHandlerForFile(ctx, this.files);
    const line = handler !== undefined ? handler.line : 1;
    const handlerId = handler !== undefined ? handler.id : `file:${ctx.rel}`;
    const record: RouteRecord = {
      id: routeIdFor("next-pages", pattern, ctx.rel),
      pattern,
      framework: "next-pages",
      resolver: "next-pages-detector",
      file: ctx.rel,
      line,
      appScope: appScopeOf(ctx.rel),
    };
    this.emitRouteRecord(record, handlerId, `${ctx.rel}:${line}`);
  }

  private jsxAttrDestination(attr: Node): RouteDestination {
    if (!isJsxAttribute(attr)) return { kind: "ignore" };
    const initializer = attr.initializer;
    if (initializer === undefined) return { kind: "ignore" };
    if (isStringLiteral(initializer)) return destinationOfStringText(initializer.text);
    if (isJsxExpression(initializer)) {
      const inner = initializer.expression;
      if (inner === undefined) return { kind: "ignore" };
      return destinationOfNode(inner);
    }
    return { kind: "ignore" };
  }

  private jsxAttrNamed(node: Node, names: readonly string[]): Node | undefined {
    let found: Node | undefined;
    const attributes = isJsxOpeningElement(node)
      ? node.attributes.properties
      : isJsxSelfClosingElement(node)
        ? node.attributes.properties
        : undefined;
    if (attributes === undefined) return undefined;
    for (const attr of attributes) {
      if (!isJsxAttribute(attr)) continue;
      const attrName = attr.name;
      const text = isIdentifier(attrName) ? attrName.text : undefined;
      if (text !== undefined && names.includes(text)) {
        found = attr;
        break;
      }
    }
    return found;
  }

  private resolveJsxElementHandler(ctx: FileCtx, value: Node | undefined): string | undefined {
    if (value === undefined) return undefined;
    // Config records (`element: <Home />`) carry the self-closing element
    // directly, without the `{...}` wrapper JSX attributes have.
    if (isJsxSelfClosingElement(value)) {
      const tag = value.tagName;
      if (isIdentifier(tag)) return handlerIdForIdentifier(ctx, this.files, tag);
      return undefined;
    }
    if (isJsxExpression(value)) {
      const inner = value.expression;
      if (inner === undefined) return undefined;
      if (isIdentifier(inner)) return handlerIdForIdentifier(ctx, this.files, inner);
      if (isJsxElement(inner)) {
        const tag = inner.openingElement.tagName;
        if (isIdentifier(tag)) return handlerIdForIdentifier(ctx, this.files, tag);
        return undefined;
      }
      if (isJsxSelfClosingElement(inner)) {
        const tag = inner.tagName;
        if (isIdentifier(tag)) return handlerIdForIdentifier(ctx, this.files, tag);
        return undefined;
      }
      return undefined;
    }
    if (isJsxElement(value)) {
      const tag = value.openingElement.tagName;
      if (isIdentifier(tag)) return handlerIdForIdentifier(ctx, this.files, tag);
      return undefined;
    }
    if (isIdentifier(value)) return handlerIdForIdentifier(ctx, this.files, value);
    return undefined;
  }

  private emitReactRouterRoutes(ctx: FileCtx): void {
    if (!fileImportsNeedle(ctx, "react-router")) return;
    const visit = (node: Node): void => {
      if (isJsxOpeningElement(node) || isJsxSelfClosingElement(node)) {
        const tag = node.tagName;
        if (isIdentifier(tag) && tag.text === "Route") {
          const pathAttr = this.jsxAttrNamed(node, ["path"]);
          if (pathAttr !== undefined) {
            const dest = this.jsxAttrDestination(pathAttr);
            const line = this.lineOf(ctx, node);
            if (dest.kind === "literal") {
              const elementAttr = this.jsxAttrNamed(node, ["element", "Component", "component"]);
              const handlerId =
                elementAttr !== undefined && isJsxAttribute(elementAttr)
                  ? this.resolveJsxElementHandler(ctx, elementAttr.initializer)
                  : undefined;
              const record: RouteRecord = {
                id: routeIdFor("react-router", dest.value, ctx.rel),
                pattern: dest.value,
                framework: "react-router",
                resolver: "react-router-detector",
                file: ctx.rel,
                line,
                appScope: appScopeOf(ctx.rel),
              };
              this.emitRouteRecord(record, handlerId ?? `file:${ctx.rel}`, `${ctx.rel}:${line}`);
            } else if (dest.kind === "computed") {
              this.emitRouteUnresolved(ctx, `file:${ctx.rel}`, line, node.getText().slice(0, 80));
            }
          }
        }
      }
      if (isCallExpression(node)) {
        const callee = node.expression;
        if (
          isIdentifier(callee) &&
          (callee.text === "createBrowserRouter" ||
            callee.text === "createMemoryRouter" ||
            callee.text === "createHashRouter")
        ) {
          const first = node.arguments.length > 0 ? node.arguments[0] : undefined;
          if (first !== undefined && isArrayLiteralExpression(first)) {
            for (const entry of first.elements) {
              if (!isObjectLiteralExpression(entry)) continue;
              let pathValue: Node | undefined;
              let elementValue: Node | undefined;
              for (const property of entry.properties) {
                if (!isPropertyAssignment(property)) continue;
                const key = property.name;
                const keyText = isIdentifier(key) ? key.text : isStringLiteral(key) ? key.text : undefined;
                if (keyText === "path") pathValue = property.initializer;
                if (keyText === "element" || keyText === "Component" || keyText === "component") {
                  elementValue = property.initializer;
                }
              }
              if (pathValue === undefined) continue;
              const dest = destinationOfNode(pathValue);
              const line = this.lineOf(ctx, entry);
              if (dest.kind === "literal") {
                const handlerId = this.resolveJsxElementHandler(ctx, elementValue);
                const record: RouteRecord = {
                  id: routeIdFor("react-router", dest.value, ctx.rel),
                  pattern: dest.value,
                  framework: "react-router",
                  resolver: "react-router-detector",
                  file: ctx.rel,
                  line,
                  appScope: appScopeOf(ctx.rel),
                };
                this.emitRouteRecord(record, handlerId ?? `file:${ctx.rel}`, `${ctx.rel}:${line}`);
              } else if (dest.kind === "computed") {
                this.emitRouteUnresolved(ctx, `file:${ctx.rel}`, line, entry.getText().slice(0, 80));
              }
            }
          }
        }
      }
      node.forEachChild((child) => {
        visit(child);
        return undefined;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return undefined;
    });
  }

  /* ----------------------------------------------------------------
   * S9 route detectors (TanStack, Vue, Nuxt, SvelteKit, Angular).
   * Same contract as S8: literal-only paths; computed paths fail closed
   * as CALLS_UNRESOLVED; every hop carries resolvedBy framework +
   * resolver; multi-app scoping matches only routes in the sender's app.
   * -------------------------------------------------------------- */

  /**
   * Config-object route records (`{ path, component|element, children }`)
   * shared by React Router `useRoutes`, Vue `createRouter({ routes })`,
   * Angular `forRoot/provideRouter`, and TanStack `createRoute`. The path
   * grammar is literal-only: bare config segments (`users`, TanStack
   * `$id`) are rooted and translated here, never guessed; a computed
   * path fails closed as CALLS_UNRESOLVED. `children` arrays recurse so
   * nested records bind too.
   */
  private emitRouteObjectRecord(
    ctx: FileCtx,
    entry: Node,
    framework: FrameworkTag,
    handlerKeys: readonly string[],
  ): void {
    if (!isObjectLiteralExpression(entry)) return;
    let pathValue: Node | undefined;
    let handlerValue: Node | undefined;
    let childrenValue: Node | undefined;
    for (const property of entry.properties) {
      if (isShorthandPropertyAssignment(property) && property.name.text === "path") {
        // `{ path }` shorthand reads a variable: a computed destination,
        // never a guessed literal.
        pathValue = property.name;
        continue;
      }
      if (!isPropertyAssignment(property)) continue;
      const key = property.name;
      const keyText = isIdentifier(key) ? key.text : isStringLiteral(key) ? key.text : undefined;
      if (keyText === "path") pathValue = property.initializer;
      else if (keyText !== undefined && handlerKeys.includes(keyText)) handlerValue = property.initializer;
      else if (keyText === "children") childrenValue = property.initializer;
    }
    if (pathValue !== undefined) {
      const dest = routePathOfNode(pathValue, framework);
      const line = this.lineOf(ctx, entry);
      if (dest.kind === "literal") {
        const handlerId = this.resolveJsxElementHandler(ctx, handlerValue);
        const record: RouteRecord = {
          id: routeIdFor(framework, dest.value, ctx.rel),
          pattern: dest.value,
          framework,
          resolver: resolverForRoute(framework),
          file: ctx.rel,
          line,
          appScope: appScopeOf(ctx.rel),
        };
        this.emitRouteRecord(record, handlerId ?? `file:${ctx.rel}`, `${ctx.rel}:${line}`);
      } else if (dest.kind === "computed") {
        this.emitRouteUnresolved(ctx, `file:${ctx.rel}`, line, entry.getText().slice(0, 80));
      }
    }
    if (childrenValue !== undefined && isArrayLiteralExpression(childrenValue)) {
      for (const child of childrenValue.elements) {
        this.emitRouteObjectRecord(ctx, child, framework, handlerKeys);
      }
    }
  }

  /** Same-file `const <name> = [...]` lookup for shorthand route tables (`{ routes }`):
   * the shorthand name resolves to the property symbol, not the local, so
   * the checker path cannot see the array. First match in source order wins;
   * cross-file tables stay unresolved (fail closed). */
  private sameFileRouteArray(ctx: FileCtx, name: string): readonly Node[] | undefined {
    let found: readonly Node[] | undefined;
    const visit = (node: Node): void => {
      if (found !== undefined) return;
      if (
        isVariableDeclaration(node) &&
        isIdentifier(node.name) &&
        node.name.text === name &&
        node.initializer !== undefined &&
        isArrayLiteralExpression(node.initializer)
      ) {
        found = [...node.initializer.elements];
        return;
      }
      node.forEachChild((child) => {
        visit(child);
        return undefined;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return undefined;
    });
    return found;
  }

  /** Resolve an inline array or an in-graph `const routes = [...]` identifier to its elements. */
  private routeArrayElements(ctx: FileCtx, value: Node | undefined): readonly Node[] | undefined {
    if (value === undefined) return undefined;
    if (isArrayLiteralExpression(value)) return [...value.elements];
    if (!isIdentifier(value)) return undefined;
    const symbol = ctx.checker.getSymbolAtLocation(value);
    if (!symbol) return undefined;
    const final = followAlias(ctx.checker, symbol);
    for (const handle of final.declarations) {
      const declaration = handle.resolve(ctx.project);
      if (!declaration) continue;
      if (toPosixPath(declaration.getSourceFile().fileName) !== ctx.key) continue;
      if (isVariableDeclaration(declaration) && declaration.initializer !== undefined && isArrayLiteralExpression(declaration.initializer)) {
        return [...declaration.initializer.elements];
      }
    }
    return undefined;
  }

  /** S9: React Router completion — `useRoutes` arrays, `createRoute`/`route` configs, nested `children`. */
  private emitReactRouterFullRoutes(ctx: FileCtx): void {
    if (!fileImportsNeedle(ctx, "react-router")) return;
    const keys = ["element", "Component", "component"] as const;
    const visit = (node: Node): void => {
      if (isCallExpression(node)) {
        const callee = node.expression;
        if (isIdentifier(callee) && callee.text === "useRoutes") {
          const first = node.arguments.length > 0 ? node.arguments[0] : undefined;
          const elements = this.routeArrayElements(ctx, first);
          if (elements !== undefined) {
            for (const entry of elements) this.emitRouteObjectRecord(ctx, entry, "react-router", keys);
          } else if (first !== undefined && !isArrayLiteralExpression(first)) {
            this.emitRouteUnresolved(ctx, `file:${ctx.rel}`, this.lineOf(ctx, node), node.getText().slice(0, 80));
          }
        }
        if (isIdentifier(callee) && (callee.text === "createRoute" || callee.text === "route")) {
          const first = node.arguments.length > 0 ? node.arguments[0] : undefined;
          if (first !== undefined && isObjectLiteralExpression(first)) {
            this.emitRouteObjectRecord(ctx, first, "react-router", keys);
          } else if (first !== undefined) {
            this.emitRouteUnresolved(ctx, `file:${ctx.rel}`, this.lineOf(ctx, node), node.getText().slice(0, 80));
          }
        }
        // `createBrowserRouter` / `createMemoryRouter` nested children:
        // re-walk data-router arrays through the shared record walker so
        // nested `children` bind instead of silently dropping.
        if (
          isIdentifier(callee) &&
          (callee.text === "createBrowserRouter" ||
            callee.text === "createMemoryRouter" ||
            callee.text === "createHashRouter")
        ) {
          const first = node.arguments.length > 0 ? node.arguments[0] : undefined;
          if (first !== undefined && isArrayLiteralExpression(first)) {
            for (const entry of first.elements) {
              if (!isObjectLiteralExpression(entry)) continue;
              let hasChildren = false;
              for (const property of entry.properties) {
                if (!isPropertyAssignment(property)) continue;
                const key = property.name;
                const keyText = isIdentifier(key) ? key.text : isStringLiteral(key) ? key.text : undefined;
                if (keyText === "children" && isArrayLiteralExpression(property.initializer)) hasChildren = true;
              }
              if (hasChildren) this.emitRouteObjectRecord(ctx, entry, "react-router", keys);
            }
          }
        }
      }
      node.forEachChild((child) => {
        visit(child);
        return undefined;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return undefined;
    });
  }

  /** S9: TanStack Router — `createFileRoute('/path')` plus `createRoute({ path })` configs. */
  private emitTanStackRouterRoutes(ctx: FileCtx): void {
    if (!fileImportsNeedle(ctx, "tanstack")) return;
    const keys = ["component", "Component"] as const;
    const visit = (node: Node): void => {
      if (isCallExpression(node)) {
        const callee = node.expression;
        if (isIdentifier(callee) && callee.text === "createFileRoute") {
          const first = node.arguments.length > 0 ? node.arguments[0] : undefined;
          const dest = routePathOfNode(first, "tanstack-router");
          const line = this.lineOf(ctx, node);
          if (dest.kind === "literal") {
            // File-based: the route file itself serves the path; the
            // default export names the handler when one is resolvable.
            const handler = defaultHandlerForFile(ctx, this.files);
            const record: RouteRecord = {
              id: routeIdFor("tanstack-router", dest.value, ctx.rel),
              pattern: dest.value,
              framework: "tanstack-router",
              resolver: "tanstack-router-detector",
              file: ctx.rel,
              line,
              appScope: appScopeOf(ctx.rel),
            };
            this.emitRouteRecord(
              record,
              handler !== undefined ? handler.id : `file:${ctx.rel}`,
              `${ctx.rel}:${handler !== undefined ? handler.line : line}`,
            );
          } else if (dest.kind === "computed") {
            this.emitRouteUnresolved(ctx, `file:${ctx.rel}`, line, node.getText().slice(0, 80));
          }
          return;
        }
        if (isIdentifier(callee) && callee.text === "createRoute") {
          const first = node.arguments.length > 0 ? node.arguments[0] : undefined;
          if (first !== undefined && isObjectLiteralExpression(first)) {
            this.emitRouteObjectRecord(ctx, first, "tanstack-router", keys);
          } else if (first !== undefined) {
            this.emitRouteUnresolved(ctx, `file:${ctx.rel}`, this.lineOf(ctx, node), node.getText().slice(0, 80));
          }
        }
      }
      node.forEachChild((child) => {
        visit(child);
        return undefined;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return undefined;
    });
  }

  /** S9: Vue Router — `createRouter({ routes: [{ path, component }] })`. */
  private emitVueRouterRoutes(ctx: FileCtx): void {
    if (!fileImportsNeedle(ctx, "vue-router")) return;
    const keys = ["component", "Component", "components"] as const;
    const visit = (node: Node): void => {
      if (isCallExpression(node)) {
        const callee = node.expression;
        if (isIdentifier(callee) && (callee.text === "createRouter" || callee.text === "createWebHistory")) {
          const options = callee.text === "createRouter"
            ? (node.arguments.length > 0 ? node.arguments[0] : undefined)
            : undefined;
          if (options !== undefined && isObjectLiteralExpression(options)) {
            for (const property of options.properties) {
              // Longhand `routes: [...]` (or `routes: routesVar`) resolves
              // through the checker; `{ routes }` shorthand carries only
              // the property symbol, so it binds through the same-file
              // table instead. Anything else without an explicit key is
              // not a route table.
              let elements: readonly Node[] | undefined;
              let isRoutesKey = false;
              if (isPropertyAssignment(property)) {
                const key = property.name;
                const keyText = isIdentifier(key) ? key.text : isStringLiteral(key) ? key.text : undefined;
                if (keyText === "routes") {
                  isRoutesKey = true;
                  elements = this.routeArrayElements(ctx, property.initializer);
                }
              } else if (isShorthandPropertyAssignment(property) && property.name.text === "routes") {
                isRoutesKey = true;
                elements = this.sameFileRouteArray(ctx, "routes");
              }
              if (!isRoutesKey) continue;
              if (elements !== undefined) {
                for (const entry of elements) this.emitRouteObjectRecord(ctx, entry, "vue-router", keys);
              } else {
                this.emitRouteUnresolved(ctx, `file:${ctx.rel}`, this.lineOf(ctx, node), node.getText().slice(0, 80));
              }
            }
          }
        }
      }
      node.forEachChild((child) => {
        visit(child);
        return undefined;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return undefined;
    });
  }

  /** S9: Nuxt file routes over indexed TS companions (pages arm plus server arm). */
  private emitNuxtRoutes(ctx: FileCtx): void {
    const pattern = nuxtRoutePattern(ctx.rel);
    if (pattern === undefined) return;
    if (!fileImportsNeedle(ctx, "nuxt") && !fileImportsNeedle(ctx, "vue") && !fileImportsNeedle(ctx, "#app")) {
      // File-based Nuxt routes need no import gate beyond the path itself:
      // a `pages/about.vue` companion cannot be indexed, but server-route
      // `.ts` files and router options carry the same path grammar.
    }
    const handler = defaultHandlerForFile(ctx, this.files);
    const line = handler !== undefined ? handler.line : 1;
    const record: RouteRecord = {
      id: routeIdFor("nuxt", pattern, ctx.rel),
      pattern,
      framework: "nuxt",
      resolver: "nuxt-detector",
      file: ctx.rel,
      line,
      appScope: appScopeOf(ctx.rel),
    };
    this.emitRouteRecord(record, handler !== undefined ? handler.id : `file:${ctx.rel}`, `${ctx.rel}:${line}`);
  }

  /** S9: SvelteKit — file-based route companions (+page, +server) over indexed files. */
  private emitSvelteKitRoutes(ctx: FileCtx): void {
    const pattern = svelteKitRoutePattern(ctx.rel);
    if (pattern === undefined) return;
    const handler = defaultHandlerForFile(ctx, this.files);
    const line = handler !== undefined ? handler.line : 1;
    const record: RouteRecord = {
      id: routeIdFor("sveltekit", pattern, ctx.rel),
      pattern,
      framework: "sveltekit",
      resolver: "sveltekit-detector",
      file: ctx.rel,
      line,
      appScope: appScopeOf(ctx.rel),
    };
    this.emitRouteRecord(record, handler !== undefined ? handler.id : `file:${ctx.rel}`, `${ctx.rel}:${line}`);
  }

  /** S9: Angular — `RouterModule.forRoot/forChild` and `provideRouter` route arrays. */
  private emitAngularRoutes(ctx: FileCtx): void {
    if (!fileImportsNeedle(ctx, "@angular/router")) return;
    const keys = ["component", "loadComponent", "loadChildren"] as const;
    const visit = (node: Node): void => {
      if (isCallExpression(node)) {
        const callee = node.expression;
        let routesArg: Node | undefined;
        if (
          isPropertyAccessExpression(callee) &&
          isIdentifier(callee.expression) &&
          isIdentifier(callee.name) &&
          (callee.name.text === "forRoot" || callee.name.text === "forChild")
        ) {
          routesArg = node.arguments.length > 0 ? node.arguments[0] : undefined;
        } else if (isIdentifier(callee) && callee.text === "provideRouter") {
          routesArg = node.arguments.length > 0 ? node.arguments[0] : undefined;
        }
        if (routesArg !== undefined) {
          const elements = this.routeArrayElements(ctx, routesArg);
          if (elements !== undefined) {
            for (const entry of elements) this.emitRouteObjectRecord(ctx, entry, "angular", keys);
          } else {
            this.emitRouteUnresolved(ctx, `file:${ctx.rel}`, this.lineOf(ctx, node), node.getText().slice(0, 80));
          }
        }
      }
      node.forEachChild((child) => {
        visit(child);
        return undefined;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return undefined;
    });
  }

  private emitNavigations(ordered: readonly FileCtx[]): void {
    for (const ctx of ordered) {
      const isNextFile = fileImportsNeedle(ctx, "next");
      const isRouterFile = fileImportsNeedle(ctx, "react-router");
      const isTanStackFile = fileImportsNeedle(ctx, "tanstack");
      const isVueFile = fileImportsNeedle(ctx, "vue-router");
      const isNuxtFile = fileImportsNeedle(ctx, "nuxt") || fileImportsNeedle(ctx, "#app");
      const isSvelteFile = fileImportsNeedle(ctx, "@sveltejs") || fileImportsNeedle(ctx, "$app");
      const isAngularFile = fileImportsNeedle(ctx, "@angular/router");
      const callers: string[] = [`file:${ctx.rel}`];
      const visit = (node: Node): void => {
        const boundary = this.boundaryId(ctx, node);
        if (boundary) callers.push(boundary);
        const sender = callers[callers.length - 1] ?? `file:${ctx.rel}`;
        if (isCallExpression(node)) {
          this.emitCodeNavigation(ctx, node, sender, {
            isNextFile,
            isRouterFile,
            isTanStackFile,
            isVueFile,
            isNuxtFile,
            isSvelteFile,
            isAngularFile,
          });
        } else if (isJsxOpeningElement(node) || isJsxSelfClosingElement(node)) {
          this.emitMarkupNavigation(ctx, node, sender, {
            isNextFile,
            isRouterFile,
            isTanStackFile,
            isVueFile,
            isNuxtFile,
            isAngularFile,
          });
        }
        node.forEachChild((child) => {
          visit(child);
          return undefined;
        });
        if (boundary) callers.pop();
      };
      ctx.sourceFile.forEachChild((child) => {
        visit(child);
        return undefined;
      });
    }
  }

  private emitCodeNavigation(
    ctx: FileCtx,
    node: Node,
    sender: string,
    flags: {
      readonly isNextFile: boolean;
      readonly isRouterFile: boolean;
      readonly isTanStackFile: boolean;
      readonly isVueFile: boolean;
      readonly isNuxtFile: boolean;
      readonly isSvelteFile: boolean;
      readonly isAngularFile: boolean;
    },
  ): void {
    if (!isCallExpression(node)) return;
    const { isNextFile, isRouterFile, isTanStackFile, isVueFile, isNuxtFile, isSvelteFile, isAngularFile } = flags;
    const callee = node.expression;
    const line = this.lineOf(ctx, node);
    const siteText = node.getText().slice(0, 80);
    const first = node.arguments.length > 0 ? node.arguments[0] : undefined;
    const second = node.arguments.length > 1 ? node.arguments[1] : undefined;
    if (isPropertyAccessExpression(callee)) {
      const object = callee.expression;
      const name = callee.name;
      if (!isIdentifier(object) || !isIdentifier(name)) return;
      const receiver = object.text;
      const method = name.text;
      // S8: React Router history + Next router; S9: Vue shares the same
      // `router.push/replace` call shape, Angular navigates by array.
      if (
        receiver === "router" &&
        (method === "push" || method === "replace" || method === "prefetch")
      ) {
        const dest = destinationOfNode(first);
        this.emitNavigation(ctx, sender, dest, line, false, siteText, "navigation-detector");
        return;
      }
      if (
        receiver === "history" &&
        (method === "push" || method === "replace") &&
        (isRouterFile || isVueFile)
      ) {
        const dest = destinationOfNode(first);
        this.emitNavigation(ctx, sender, dest, line, false, siteText, "navigation-detector");
        return;
      }
      if (receiver === "router" && (method === "navigate" || method === "navigateByUrl") && isAngularFile) {
        // Angular navigates by segment array (`['home']`): bare segments
        // root the same way config paths do; computed entries fail closed.
        const dest = this.angularDestination(first);
        this.emitNavigation(ctx, sender, dest, line, false, siteText, "navigation-detector");
        return;
      }
      if (receiver === "NextResponse" && method === "redirect" && isNextFile) {
        const dest = destinationOfNode(first);
        this.emitNavigation(ctx, sender, dest, line, false, siteText, "navigation-detector");
        return;
      }
      return;
    }
    if (isIdentifier(callee)) {
      const name = callee.text;
      // S8 `navigate('/x')`; S9 TanStack `navigate({ to: '/x' })` shares
      // the name and resolves through the `to` key.
      if (name === "navigate" && (isRouterFile || isTanStackFile)) {
        const dest = destinationOfNode(first);
        this.emitNavigation(ctx, sender, dest, line, false, siteText, "navigation-detector");
        return;
      }
      // S8 Next `redirect('/x')`; S9 TanStack `redirect({ to })`.
      if (name === "redirect" && (isNextFile || isTanStackFile)) {
        const dest = destinationOfNode(first);
        this.emitNavigation(ctx, sender, dest, line, false, siteText, "navigation-detector");
        return;
      }
      if (name === "permanentRedirect" && isNextFile) {
        const dest = destinationOfNode(first);
        this.emitNavigation(ctx, sender, dest, line, false, siteText, "navigation-detector");
        return;
      }
      // S9: SvelteKit `redirect(status, location)` carries the URL second.
      if (name === "redirect" && isSvelteFile && !isNextFile && !isTanStackFile) {
        const dest = destinationOfNode(second);
        this.emitNavigation(ctx, sender, dest, line, false, siteText, "navigation-detector");
        return;
      }
      // S9: Nuxt `navigateTo('/x')`, SvelteKit `goto('/x')`.
      if (name === "navigateTo" && isNuxtFile) {
        const dest = destinationOfNode(first);
        this.emitNavigation(ctx, sender, dest, line, false, siteText, "navigation-detector");
        return;
      }
      if (name === "goto" && isSvelteFile) {
        const dest = destinationOfNode(first);
        this.emitNavigation(ctx, sender, dest, line, false, siteText, "navigation-detector");
        return;
      }
      if (name === "fetch") {
        const dest = destinationOfNode(first);
        if (dest.kind === "ignore") return;
        this.emitNavigation(ctx, sender, dest, line, false, siteText, "navigation-detector");
        return;
      }
    }
  }

  /**
   * S9 Angular destinations: `router.navigate(['home'])` and
   * `routerLink="home"` carry bare segments, so they root through the
   * config-path grammar instead of the absolute-URL navigation grammar.
   * Computed entries stay computed (fail closed); external URLs stay ignored.
   */
  private angularDestination(node: Node | undefined): RouteDestination {
    const first =
      node !== undefined && isArrayLiteralExpression(node) && node.elements.length > 0
        ? node.elements[0]
        : node;
    return routePathOfNode(first, "angular");
  }

  private angularAttrDestination(attr: Node): RouteDestination {
    if (!isJsxAttribute(attr)) return { kind: "ignore" };
    const initializer = attr.initializer;
    if (initializer === undefined) return { kind: "ignore" };
    if (isStringLiteral(initializer) || isNoSubstitutionTemplateLiteral(initializer)) {
      return routePathOfNode(initializer, "angular");
    }
    if (isJsxExpression(initializer)) {
      const inner = initializer.expression;
      if (inner === undefined) return { kind: "ignore" };
      if (isArrayLiteralExpression(inner)) {
        const first = inner.elements.length > 0 ? inner.elements[0] : undefined;
        return routePathOfNode(first, "angular");
      }
      return destinationOfNode(inner);
    }
    return { kind: "ignore" };
  }

  private emitMarkupNavigation(
    ctx: FileCtx,
    node: Node,
    sender: string,
    flags: {
      readonly isNextFile: boolean;
      readonly isRouterFile: boolean;
      readonly isTanStackFile: boolean;
      readonly isVueFile: boolean;
      readonly isNuxtFile: boolean;
      readonly isAngularFile: boolean;
    },
  ): void {
    const { isNextFile, isRouterFile, isTanStackFile, isVueFile, isNuxtFile, isAngularFile } = flags;
    const tagNode = isJsxOpeningElement(node) ? node.tagName : isJsxSelfClosingElement(node) ? node.tagName : undefined;
    if (tagNode === undefined || !isIdentifier(tagNode)) return;
    const tag = tagNode.text;
    const line = this.lineOf(ctx, node);
    const siteText = node.getText().slice(0, 80);
    // S9: Angular `routerLink` (string or `['/x']` array) on any element.
    // Bare segments root like config paths; computed entries fail closed.
    if (isAngularFile) {
      const routerLinkAttr = this.jsxAttrNamed(node, ["routerLink"]);
      if (routerLinkAttr !== undefined) {
        const dest = this.angularAttrDestination(routerLinkAttr);
        this.emitNavigation(ctx, sender, dest, line, true, siteText, "markup-navigation-detector");
        return;
      }
    }
    if (tag === "a") {
      const hrefAttr = this.jsxAttrNamed(node, ["href"]);
      if (hrefAttr === undefined) return;
      const dest = this.jsxAttrDestination(hrefAttr);
      this.emitNavigation(ctx, sender, dest, line, true, siteText, "markup-navigation-detector");
      return;
    }
    if (tag === "Link") {
      if (!isNextFile && !isRouterFile && !isTanStackFile && !isVueFile && !isNuxtFile) return;
      const attr = this.jsxAttrNamed(node, ["href", "to"]);
      if (attr === undefined) return;
      const dest = this.jsxAttrDestination(attr);
      this.emitNavigation(ctx, sender, dest, line, true, siteText, "markup-navigation-detector");
      return;
    }
    // S9: TanStack/Vue/Nuxt link components share the `to` shape.
    if (tag === "RouterLink") {
      if (!isVueFile && !isTanStackFile) return;
      const attr = this.jsxAttrNamed(node, ["to", "href"]);
      if (attr === undefined) return;
      const dest = this.jsxAttrDestination(attr);
      this.emitNavigation(ctx, sender, dest, line, true, siteText, "markup-navigation-detector");
      return;
    }
    if (tag === "NuxtLink") {
      if (!isNuxtFile) return;
      const attr = this.jsxAttrNamed(node, ["to", "href"]);
      if (attr === undefined) return;
      const dest = this.jsxAttrDestination(attr);
      this.emitNavigation(ctx, sender, dest, line, true, siteText, "markup-navigation-detector");
      return;
    }
    if (tag === "Navigate" || tag === "NavLink" || tag === "Redirect") {
      if (!isRouterFile) return;
      const attr = this.jsxAttrNamed(node, ["to", "href"]);
      if (attr === undefined) return;
      const dest = this.jsxAttrDestination(attr);
      this.emitNavigation(ctx, sender, dest, line, true, siteText, "markup-navigation-detector");
    }
  }
}

export function indexFiles(entryFiles: readonly string[], options: IndexOptions = {}): GraphSnapshot {
  if (entryFiles.length === 0) return { nodes: [], edges: [], content: emptyContentIndex() };
  throwIfAborted(options.signal);
  const maxFiles = options.budgets?.maxFiles;
  if (maxFiles !== undefined && Number.isFinite(maxFiles) && entryFiles.length > maxFiles) {
    throw buildFailure(
      "BUDGET_FILES",
      `code-graph: entry budget exceeded (${entryFiles.length} entries > maxFiles ${maxFiles})`,
    );
  }
  const absoluteEntries = entryFiles.map((entry) => resolve(entry));
  if (options.rootDir === undefined) {
    // Legacy path: `commonDir(entryFiles)` identity, byte-identical to before.
    const root = commonDir(absoluteEntries.map(toPosixPath));
    const { snapshot } = buildGraph(absoluteEntries, root, false, options);
    return { ...snapshot, root };
  }
  // Repo-root-relative identity: every file id and stored file path is
  // POSIX relative to rootDir, so a nested index root keeps the repository
  // id space and cross-package imports land inside it. Module resolution is
  // untouched: the compiler's own resolution already crosses packages once
  // the root is right (proven by the cross-package fixture below).
  const root = toPosixPath(resolve(options.rootDir));
  const prefix = `${root}/`;
  const inside: string[] = [];
  const entryDropped: DroppedFile[] = [];
  const seenDropped = new Set<string>();
  for (const entry of absoluteEntries) {
    const key = toPosixPath(entry);
    const rel = key.startsWith(prefix) ? key.slice(prefix.length) : undefined;
    if (rel !== undefined && rel.length > 0 && !rel.split("/").includes("..")) {
      inside.push(entry);
    } else if (!seenDropped.has(key)) {
      seenDropped.add(key);
      entryDropped.push({ file: key, reason: "outside-root" });
    }
  }
  if (inside.length === 0) {
    return { nodes: [], edges: [], content: emptyContentIndex(), root, dropped: entryDropped };
  }
  const { snapshot, dropped } = buildGraph(inside, root, true, options);
  const mergedByFile = new Map<string, DroppedFile>();
  for (const drop of [...entryDropped, ...dropped]) {
    if (!mergedByFile.has(drop.file)) mergedByFile.set(drop.file, drop);
  }
  const merged = [...mergedByFile.values()].sort((left, right) => (left.file < right.file ? -1 : 1));
  return { ...snapshot, root, dropped: merged };
}

/** One project-owned entry partition for the sharded-build experiment. */
interface ProjectEntryGroup {
  readonly projectId: string;
  readonly configFileName: string;
  readonly entries: string[];
}

/**
 * Experiment seam for a bounded-concurrency build (flag-gated, never on the
 * served path until equivalence is proven): partition entries by the owning
 * TypeScript project of a single session, so every shard can build in its
 * own session with the same project assignment the whole-scope build would
 * use. Entries no project covers throw, matching the whole-scope contract.
 */
export function groupEntriesByProject(
  entryFiles: readonly string[],
  options: { rootDir: string; tsserverPath?: string },
): ProjectEntryGroup[] {
  if (entryFiles.length === 0) return [];
  if (options.rootDir === undefined || options.rootDir === "") {
    throw new Error("code-graph: groupEntriesByProject needs an explicit rootDir");
  }
  const root = toPosixPath(resolve(options.rootDir));
  const absoluteEntries = entryFiles.map((entry) => resolve(entry));
  const tsserverPath = options.tsserverPath ?? defaultTsServerPath();
  const api = new API({ tsserverPath, cwd: root });
  try {
    const snapshot = api.updateSnapshot({ openFiles: [...absoluteEntries] });
    try {
      const groups = new Map<string, { configFileName: string; entries: string[] }>();
      const order: string[] = [];
      for (const entry of absoluteEntries) {
        const project = snapshot.getDefaultProjectForFile(entry);
        if (!project) throw new Error(`code-graph: no TypeScript project covers entry: ${entry}`);
        const key = project.id.length > 0 ? project.id : project.configFileName;
        let group = groups.get(key);
        if (group === undefined) {
          group = { configFileName: project.configFileName, entries: [] };
          groups.set(key, group);
          order.push(key);
        }
        group.entries.push(entry);
      }
      return order.map((key) => {
        const group = groups.get(key);
        if (group === undefined) throw new Error("code-graph: project group missing");
        return { projectId: key, configFileName: group.configFileName, entries: group.entries };
      });
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}

function buildGraph(
  absoluteEntries: readonly string[],
  root: string,
  strictRoot: boolean,
  options: IndexOptions,
) {
  const tsserverPath = options.tsserverPath ?? defaultTsServerPath();
  const report = options.onProgress;
  const signal = options.signal;
  const budgets = options.budgets;
  const generation = options.generation;
  const startMs = Date.now();
  const elapsed = (): number => Date.now() - startMs;
  const checkTimeBudget = (): void => {
    const maxMs = budgets?.maxMs;
    if (maxMs !== undefined && Number.isFinite(maxMs) && elapsed() > maxMs) {
      throw buildFailure(
        "BUDGET_TIME",
        `code-graph: time budget exceeded (${elapsed()}ms > maxMs ${maxMs})`,
      );
    }
  };
  const checkSizeBudgets = (size: { readonly nodes: number; readonly edges: number }): void => {
    const maxNodes = budgets?.maxNodes;
    if (maxNodes !== undefined && Number.isFinite(maxNodes) && size.nodes > maxNodes) {
      throw buildFailure(
        "BUDGET_NODES",
        `code-graph: node budget exceeded (${size.nodes} nodes > maxNodes ${maxNodes})`,
      );
    }
    const maxEdges = budgets?.maxEdges;
    if (maxEdges !== undefined && Number.isFinite(maxEdges) && size.edges > maxEdges) {
      throw buildFailure(
        "BUDGET_EDGES",
        `code-graph: edge budget exceeded (${size.edges} edges > maxEdges ${maxEdges})`,
      );
    }
  };
  throwIfAborted(signal);
  const api = new API({ tsserverPath, cwd: root });
  try {
    const snapshot = api.updateSnapshot({ openFiles: [...absoluteEntries] });
    // Program construction is the expensive step and it completes in one call,
    // so this is the first moment a true count exists.
    throwIfAborted(signal);
    checkTimeBudget();
    report?.({ phase: "program", files: absoluteEntries.length, projectsDone: 0, projectsTotal: 0, elapsedMs: elapsed(), generation });
    try {
      const builder = new GraphBuilder(root, strictRoot);
      const byProject = new Map<Project, string[]>();
      for (const entry of absoluteEntries) {
        const project = snapshot.getDefaultProjectForFile(entry);
        if (!project) throw new Error(`code-graph: no TypeScript project covers entry: ${entry}`);
        const list = byProject.get(project);
        if (list) list.push(entry);
        else byProject.set(project, [entry]);
      }
      const projectsTotal = byProject.size;
      let projectsDone = 0;
      for (const [project, entries] of byProject) {
        throwIfAborted(signal);
        checkTimeBudget();
        builder.addEntries(project, entries);
        projectsDone += 1;
        const size = builder.size();
        checkSizeBudgets(size);
        checkTimeBudget();
        throwIfAborted(signal);
        report?.({ phase: "projects", files: absoluteEntries.length, projectsDone, projectsTotal, nodes: size.nodes, edges: size.edges, elapsedMs: elapsed(), generation });
        if (options.onPartialSnapshot !== undefined && projectsDone < projectsTotal) {
          options.onPartialSnapshot(builder.snapshot(), { projectsDone, projectsTotal });
        }
      }
      throwIfAborted(signal);
      checkTimeBudget();
      const preEdges = builder.size();
      report?.({ phase: "edges", files: absoluteEntries.length, projectsDone, projectsTotal, nodes: preEdges.nodes, edges: preEdges.edges, elapsedMs: elapsed(), generation });
      builder.addKnowledgeLinks(options.knowledge ?? []);
      const snapshotOut = builder.snapshot();
      checkSizeBudgets({ nodes: snapshotOut.nodes.length, edges: snapshotOut.edges.length });
      checkTimeBudget();
      throwIfAborted(signal);
      report?.({ phase: "done", files: absoluteEntries.length, projectsDone, projectsTotal, nodes: snapshotOut.nodes.length, edges: snapshotOut.edges.length, elapsedMs: elapsed(), generation });
      return { snapshot: snapshotOut, dropped: builder.dropped };
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}

/**
 * Diff two snapshots into INVALIDATED_BY edges (system fact, confidence
 * 1.00). A missing file node means SRC-DELETE; a missing symbol whose file
 * survives means SYM-RENAME; any other stale node whose file survives
 * means SRC-EDIT; a stale edge whose endpoints survive likewise means
 * SRC-EDIT, otherwise it inherits the stale endpoint's cause.
 */
export function invalidateEdges(previous: GraphSnapshot, current: GraphSnapshot): GraphEdge[] {
  const prevNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const curNodes = new Map(current.nodes.map((node) => [node.id, node]));
  const curEdgeIds = new Set(current.edges.map((edge) => edge.id));
  const curFiles = new Set(
    current.nodes.filter((node) => node.kind === "file").map((node) => node.id),
  );
  const staleCause = new Map<string, InvalidationCause>();
  const out = new Map<string, GraphEdge>();
  const sortedPrev = [...prevNodes.values()].sort((left, right) => (left.id < right.id ? -1 : 1));
  for (const node of sortedPrev) {
    if (curNodes.has(node.id)) continue;
    let cause: InvalidationCause;
    if (node.kind === "file") cause = "SRC-DELETE";
    else if (curFiles.has(`file:${node.file}`)) cause = node.kind === "symbol" ? "SYM-RENAME" : "SRC-EDIT";
    else cause = "SRC-DELETE";
    staleCause.set(node.id, cause);
    const id = `invalidated:${node.id}`;
    out.set(id, {
      id,
      kind: "INVALIDATED_BY",
      from: node.id,
      to: `cause:${cause}`,
      confidence: STATIC_CONFIDENCE,
      ref: `${node.file}:${node.line}`,
      cause,
    });
  }
  for (const edge of previous.edges) {
    if (curEdgeIds.has(edge.id)) continue;
    const staleEnds = [edge.from, edge.to].filter((end) => staleCause.has(end)).sort();
    const first = staleEnds[0];
    const cause: InvalidationCause = first === undefined ? "SRC-EDIT" : (staleCause.get(first) ?? "SRC-EDIT");
    const id = `invalidated:${edge.id}`;
    if (out.has(id)) continue;
    out.set(id, {
      id,
      kind: "INVALIDATED_BY",
      from: edge.id,
      to: `cause:${cause}`,
      confidence: STATIC_CONFIDENCE,
      ref: edge.ref,
      cause,
    });
  }
  return [...out.values()].sort((left, right) => (left.id < right.id ? -1 : 1));
}
