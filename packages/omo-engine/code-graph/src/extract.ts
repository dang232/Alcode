/**
 * Code-graph extraction over the vendored TypeScript compiler API.
 *
 * Contract: `.omo/ulw/waves/s53-phase-a/schema-draft.md` sections 1-3.
 * Closed edge set: DEFINES, IMPORTS, CALLS_STATIC, CALLS_UNRESOLVED,
 * EXPORTS, TESTS, LINKS_KNOWLEDGE (link-only), INVALIDATED_BY.
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
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isMethodDeclaration,
  isNewExpression,
  isSourceFile,
  isStringLiteral,
  isTypeAliasDeclaration,
  isVariableDeclaration,
  isVariableStatement,
} from "typescript/unstable/ast";
import type { NamedExports, Node, SourceFile } from "typescript/unstable/ast";

export type EdgeKind =
  | "DEFINES"
  | "IMPORTS"
  | "CALLS_STATIC"
  | "CALLS_UNRESOLVED"
  | "EXPORTS"
  | "TESTS"
  | "LINKS_KNOWLEDGE"
  | "INVALIDATED_BY";

export type NodeKind = "file" | "symbol" | "export-contract" | "knowledge-link" | "call-site";

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
}

export interface GraphSnapshot {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /**
   * Absolute directory every `file` field is relative to. Node ids are rooted
   * here, not at the project root, so any caller that needs a real path must
   * join against this and never against the workspace directory.
   */
  readonly root?: string;
}

/** Advisory pointer to a ProjectKnowledgeRecord. The graph stores only the id triple, never the record body. */
export interface KnowledgeLinkInput {
  readonly from: string;
  readonly recordId: string;
  readonly confidence: number;
  readonly sourceFile: string;
  readonly sourceRevision: string;
}

export interface IndexOptions {
  /** Override for the vendored TypeScript server binary. Defaults to the binary inside `typescript@7.0.2`. */
  readonly tsserverPath?: string;
  /** Advisory knowledge pointers, emitted as LINKS_KNOWLEDGE edges (link-only). */
  readonly knowledge?: readonly KnowledgeLinkInput[];
}

const STATIC_CONFIDENCE = 1;
/** Schema section 3: unresolved dynamics are never proven (capped at most 0.50). */
const UNRESOLVED_CONFIDENCE = 0.5;
const UNKNOWN = "unknown";
const RECORD_ID = /^pk-[0-9a-f]{12}$/;
const MAX_ALIAS_DEPTH = 10;

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
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  for (const binary of process.platform === "win32" ? ["tsc.exe", "tsc"] : ["tsc"]) {
    const candidate = join(tsDir, "..", ".bin", binary);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "code-graph: TypeScript native server binary not found inside typescript@7.0.2; " +
      "pass IndexOptions.tsserverPath explicitly",
  );
}

function isSymbolLike(value: unknown): value is TsSymbol {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly name?: unknown; readonly flags?: unknown; readonly declarations?: unknown };
  return (
    typeof candidate.name === "string" &&
    typeof candidate.flags === "number" &&
    Array.isArray(candidate.declarations)
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

class GraphBuilder {
  private readonly files = new Map<string, FileCtx>();
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly callOrdinals = new Map<string, number>();

  constructor(private readonly root: string) {}

  snapshot(): GraphSnapshot {
    const nodes = [...this.nodes.values()].sort((left, right) => (left.id < right.id ? -1 : 1));
    const edges = [...this.edges.values()].sort((left, right) => (left.id < right.id ? -1 : 1));
    return { nodes, edges };
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
      const ctx: FileCtx = { key, rel, sourceFile, project, checker: project.checker };
      this.files.set(key, ctx);
      this.nodes.set(`file:${rel}`, { id: `file:${rel}`, kind: "file", file: rel, line: 1, name: rel });
      for (const target of this.staticImportTargets(ctx)) {
        if (!this.files.has(target)) queue.push(target);
      }
    }
    const ordered = [...this.files.values()].sort((left, right) => (left.rel < right.rel ? -1 : 1));
    for (const ctx of ordered) {
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
  }

  addKnowledgeLinks(links: readonly KnowledgeLinkInput[]): void {
    for (const link of links) {
      if (link.from.length === 0 || !RECORD_ID.test(link.recordId)) continue;
      if (!Number.isFinite(link.confidence) || link.confidence < 0 || link.confidence > 1) continue;
      const id = `knowledge:${link.recordId}`;
      const file = toPosixPath(link.sourceFile);
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

  private relOf(key: string): string {
    const rel = key.startsWith(`${this.root}/`) ? key.slice(this.root.length + 1) : key;
    return rel;
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
    const raw: unknown = ctx.checker.getExportsOfModule(moduleSymbol);
    const exported: readonly TsSymbol[] = Array.isArray(raw) ? raw.filter(isSymbolLike) : [];
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
          (clause as NamedExports).elements.forEach((element) => {
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
}

export function indexFiles(entryFiles: readonly string[], options: IndexOptions = {}): GraphSnapshot {
  if (entryFiles.length === 0) return { nodes: [], edges: [] };
  const absoluteEntries = entryFiles.map((entry) => resolve(entry));
  const root = commonDir(absoluteEntries.map(toPosixPath));
  const tsserverPath = options.tsserverPath ?? defaultTsServerPath();
  const api = new API({ tsserverPath, cwd: root });
  try {
    const snapshot = api.updateSnapshot({ openFiles: absoluteEntries });
    try {
      const builder = new GraphBuilder(root);
      const byProject = new Map<Project, string[]>();
      for (const entry of absoluteEntries) {
        const project = snapshot.getDefaultProjectForFile(entry);
        if (!project) throw new Error(`code-graph: no TypeScript project covers entry: ${entry}`);
        const list = byProject.get(project);
        if (list) list.push(entry);
        else byProject.set(project, [entry]);
      }
      for (const [project, entries] of byProject) builder.addEntries(project, entries);
      builder.addKnowledgeLinks(options.knowledge ?? []);
      return { ...builder.snapshot(), root };
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
