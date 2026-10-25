/**
 * Project-knowledge record store: schema gate, entry state, secrets gate,
 * write-time project binding, and HEAD-tree loading.
 *
 * Contract: `waves/slice5-contract/contract.md` sections 1-2, 6-7.
 * Every record is one git-backed markdown file (frontmatter + body) under
 * `project-knowledge/<id>.md`, reusing the memfs frontmatter discipline.
 * The store itself is memory only: callers hand it files read from the HEAD
 * tree (compile-from-committed invariant), so working-tree content can never
 * enter through this module.
 */

import { createHash } from "node:crypto";
import { parseMemoryFile, renderMemoryFile } from "../memfs";
import { decodeScalarSource } from "../memfs/frontmatter-scalar";
import { containsSecretLikeMaterial } from "../sync/redact";

export const PROJECT_KNOWLEDGE_DIR = "project-knowledge";
export const RECORD_FILE_EXTENSION = ".md";

/** Field 4: the assertion is one statement of at most 500 characters. */
export const MAX_CLAIM_CHARS = 500;

/** Section 2: evidence older than 7 days is stale. */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type ProjectKnowledgeCategory =
  | "source-verified"
  | "previously-verified"
  | "unverified-hypothesis"
  | "superseded"
  | "environment-specific";

export type ValidationMethod = "rg-resolve" | "test-pass" | "review-accept" | "none";

/** Section 6 case ids. A record with no invalidation conditions is rejected. */
export type InvalidationCase =
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

export function isKnowledgeCategory(value: string): value is ProjectKnowledgeCategory {
  return (
    value === "source-verified" ||
    value === "previously-verified" ||
    value === "unverified-hypothesis" ||
    value === "superseded" ||
    value === "environment-specific"
  );
}

export function isValidationMethod(value: string): value is ValidationMethod {
  return value === "rg-resolve" || value === "test-pass" || value === "review-accept" || value === "none";
}

export function isInvalidationCase(value: string): value is InvalidationCase {
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

export interface KnowledgeScope {
  readonly writeScopes: readonly string[];
  readonly runScope?: string;
}

/** Field 17 kinds: the closed set of rationale note slots on a record. */
export type RationaleKind =
  | "purpose"
  | "design-intent"
  | "invariant"
  | "hazard"
  | "history"
  | "cross-reference"
  | "verification-ref";

export function isRationaleKind(value: string): value is RationaleKind {
  return (
    value === "purpose" ||
    value === "design-intent" ||
    value === "invariant" ||
    value === "hazard" ||
    value === "history" ||
    value === "cross-reference" ||
    value === "verification-ref"
  );
}

/**
 * One model-generated explanation attached to a record. `standing` reuses the
   record trust states and `confidence` reuses the `CONFIDENCE_TEXT` grammar;
   both are per-note so a single unverified note can never be read as fact.
 */
export interface RationaleNote {
  readonly kind: RationaleKind;
  readonly text: string;
  readonly standing: ProjectKnowledgeCategory;
  readonly confidence: number;
}

export interface KnowledgeRationale {
  readonly notes: readonly RationaleNote[];
}

/**
 * Entry-state rationale input (mirrors INV-02): notes carry no verified
   standing. `standing` may be omitted (defaults to `unverified-hypothesis`)
   or repeat it; anything higher refuses the write — a model-generated
   explanation is never stored as verified fact.
 */
export interface NewRationaleNote {
  readonly kind: RationaleKind;
  readonly text: string;
  readonly confidence: number;
  readonly standing?: ProjectKnowledgeCategory;
}

export interface NewKnowledgeRationale {
  readonly notes: readonly NewRationaleNote[];
}

/** Section 1: canonical field order 1-16, plus additive field 17 (rationale). */
export interface ProjectKnowledgeRecord {
  readonly id: string;
  readonly projectId: string;
  readonly category: ProjectKnowledgeCategory;
  readonly claim: string;
  readonly sourceFile: string;
  readonly sourceSymbol: string;
  readonly sourceRevision: string;
  readonly fingerprint: string;
  readonly observedAt: string;
  readonly validatedAt?: string;
  readonly validationMethod: ValidationMethod;
  readonly confidence: number;
  readonly scope: KnowledgeScope;
  readonly agentRole?: string;
  readonly invalidationConditions: readonly string[];
  readonly supersedes: string | null;
  /**
   * Field 17: optional rationale metadata (purpose, design intent, invariant,
   * hazard, history, cross-references, verification refs). Purely additive:
   * absent on old records, excluded from `computeRecordId` and
   * `computeFingerprint`, so existing identities and bindings never shift.
   */
  readonly rationale?: KnowledgeRationale;
}

/** Entry-state input: no category (always `unverified-hypothesis`) and no id (recomputed). */
export interface NewKnowledgeInput {
  readonly projectId: string;
  readonly claim: string;
  readonly sourceFile: string;
  readonly sourceSymbol: string;
  readonly sourceRevision: string;
  /** sha256 of the source file blob the claim was observed in; the fingerprint is derived. */
  readonly sourceBlobSha256: string;
  readonly observedAt: string;
  readonly validationMethod: ValidationMethod;
  readonly confidence: number;
  readonly scope: KnowledgeScope;
  readonly agentRole?: string;
  readonly invalidationConditions: readonly string[];
  readonly supersedes?: string;
  readonly rationale?: NewKnowledgeRationale;
}

export type CreateRecordResult =
  | { readonly kind: "created"; readonly record: ProjectKnowledgeRecord }
  | { readonly kind: "refused"; readonly reason: string };

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const RECORD_ID = /^pk-[0-9a-f]{12}$/;
/** Field 2: `<safe-slug>-<sha256-8>` grammar (same shape as `identity/shortHash`). */
const PROJECT_ID = /^[^\s/]+-[0-9a-f]{8}$/;
/** Field 6: `file` or a namespaced symbol. */
const SOURCE_SYMBOL = /^(?:file|fn:[^\s:]+|class:[^\s:]+|const:[^\s:]+)$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** Field 12: number in [0,1] with at most 2 decimals. */
const CONFIDENCE_TEXT = /^(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?)$/;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Field 1: stable content-derived identity. Recomputed, never user-supplied. */
export function computeRecordId(sourceFile: string, sourceSymbol: string, claim: string): string {
  return `pk-${sha256Hex(`${sourceFile}\n${sourceSymbol}\n${claim}`).slice(0, 12)}`;
}

/** Field 8: content binding of the pinned revision to the observed blob. */
export function computeFingerprint(sourceRevision: string, sourceBlobSha256: string): string {
  return sha256Hex(`${sourceRevision}:${sourceBlobSha256}`);
}

export function recordFilePath(id: string): string {
  return `${PROJECT_KNOWLEDGE_DIR}/${id}${RECORD_FILE_EXTENSION}`;
}

export function isRecordFilePath(path: string): boolean {
  return path.startsWith(`${PROJECT_KNOWLEDGE_DIR}/`) && path.endsWith(RECORD_FILE_EXTENSION);
}

function isRepoRelativePath(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\")) return false;
  const segments = value.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") return false;
  }
  return true;
}

function isIsoUtc(value: string): boolean {
  return ISO_UTC.test(value) && !Number.isNaN(Date.parse(value));
}

function isConfidenceText(value: string): boolean {
  return CONFIDENCE_TEXT.test(value);
}

function isNonEmptyEntry(value: string): boolean {
  return value.length > 0 && !value.includes("\n") && !value.includes("\r");
}

/** Decodes a JSON string list at the file boundary; rejects anything else. */
function decodeStringList(raw: string): readonly string[] | undefined {
  let candidate: string[];
  try {
    candidate = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(candidate)) return undefined;
  const items: string[] = [];
  for (const entry of candidate) {
    if (!isNonEmptyEntry(entry)) return undefined;
    items.push(entry);
  }
  return items;
}

function checkClaim(claim: string): string | undefined {
  if (claim.length === 0 || claim.length > MAX_CLAIM_CHARS) return "invalid-claim";
  if (claim.includes("\n") || claim.includes("\r")) return "invalid-claim";
  return undefined;
}

function checkRationaleText(text: string): string | undefined {
  // Rationale notes are single-statement explanations, same shape as a claim.
  if (text.length === 0 || text.length > MAX_CLAIM_CHARS) return "invalid-rationale-text";
  if (text.includes("\n") || text.includes("\r")) return "invalid-rationale-text";
  return undefined;
}

function checkRationaleNotes(notes: readonly RationaleNote[]): string | undefined {
  for (const note of notes) {
    if (!isRationaleKind(note.kind)) return "invalid-rationale-kind";
    const textFailure = checkRationaleText(note.text);
    if (textFailure !== undefined) return textFailure;
    if (!isKnowledgeCategory(note.standing)) return "invalid-rationale-standing";
    if (!isConfidenceText(String(note.confidence))) return "invalid-rationale-confidence";
  }
  return undefined;
}

function checkCommonFields(record: ProjectKnowledgeRecord): string | undefined {
  if (!PROJECT_ID.test(record.projectId)) return "invalid-project";
  if (!isRepoRelativePath(record.sourceFile)) return "invalid-source-file";
  if (!SOURCE_SYMBOL.test(record.sourceSymbol)) return "invalid-source-symbol";
  if (!HEX40.test(record.sourceRevision)) return "invalid-source-revision";
  if (!HEX64.test(record.fingerprint)) return "invalid-fingerprint";
  if (!isIsoUtc(record.observedAt)) return "invalid-observed-at";
  if (record.validatedAt !== undefined && !isIsoUtc(record.validatedAt)) return "invalid-validated-at";
  if (record.validatedAt !== undefined && record.category === "unverified-hypothesis") {
    return "entry-never-validated";
  }
  if (!isConfidenceText(String(record.confidence))) return "invalid-confidence";
  if (record.scope.writeScopes.some((entry) => !isNonEmptyEntry(entry))) return "invalid-scope";
  if (record.scope.runScope !== undefined && !isNonEmptyEntry(record.scope.runScope)) return "invalid-scope";
  if (record.agentRole !== undefined && !isNonEmptyEntry(record.agentRole)) return "invalid-agent-role";
  if (record.invalidationConditions.length === 0) return "empty-invalidation-conditions";
  if (record.invalidationConditions.some((entry) => !isInvalidationCase(entry))) {
    return "unknown-invalidation-case";
  }
  if (record.supersedes !== null && !RECORD_ID.test(record.supersedes)) return "invalid-supersedes";
  if (record.rationale !== undefined) {
    const rationaleFailure = checkRationaleNotes(record.rationale.notes);
    if (rationaleFailure !== undefined) return rationaleFailure;
  }
  return undefined;
}

export function createRecord(input: NewKnowledgeInput): CreateRecordResult {
  const claimFailure = checkClaim(input.claim);
  if (claimFailure !== undefined) return { kind: "refused", reason: claimFailure };
  // H2: a secret-bearing claim refuses the write; no partial record persists.
  if (containsSecretLikeMaterial(input.claim)) return { kind: "refused", reason: "secret-found" };
  if (!HEX40.test(input.sourceRevision)) return { kind: "refused", reason: "invalid-source-revision" };
  if (!HEX64.test(input.sourceBlobSha256)) return { kind: "refused", reason: "invalid-source-blob" };
  const runScope = input.scope.runScope;
  const scope: KnowledgeScope =
    runScope === undefined
      ? { writeScopes: [...input.scope.writeScopes] }
      : { writeScopes: [...input.scope.writeScopes], runScope };
  // INV-02 for rationale: model-generated notes enter as
  // `unverified-hypothesis`, never higher; anything else refuses the write.
  let rationale: KnowledgeRationale | undefined;
  if (input.rationale !== undefined && input.rationale.notes.length > 0) {
    const notes: RationaleNote[] = [];
    for (const note of input.rationale.notes) {
      if (note.standing !== undefined && note.standing !== "unverified-hypothesis") {
        return { kind: "refused", reason: "invalid-rationale-standing" };
      }
      if (containsSecretLikeMaterial(note.text)) return { kind: "refused", reason: "secret-found" };
      if (!isRationaleKind(note.kind)) return { kind: "refused", reason: "invalid-rationale-kind" };
      notes.push({
        kind: note.kind,
        text: note.text,
        standing: "unverified-hypothesis",
        confidence: note.confidence,
      });
    }
    rationale = { notes };
  }
  const record: ProjectKnowledgeRecord = {
    id: computeRecordId(input.sourceFile, input.sourceSymbol, input.claim),
    projectId: input.projectId,
    // INV-02: entry state for all new records, never higher; the input carries no category.
    category: "unverified-hypothesis",
    claim: input.claim,
    sourceFile: input.sourceFile,
    sourceSymbol: input.sourceSymbol,
    sourceRevision: input.sourceRevision,
    fingerprint: computeFingerprint(input.sourceRevision, input.sourceBlobSha256),
    observedAt: input.observedAt,
    validationMethod: input.validationMethod,
    confidence: input.confidence,
    scope,
    agentRole: input.agentRole,
    invalidationConditions: [...input.invalidationConditions],
    supersedes: input.supersedes ?? null,
    rationale,
  };
  const failure = checkCommonFields(record);
  if (failure !== undefined) return { kind: "refused", reason: failure };
  return { kind: "created", record };
}

const EXTRA_KEYS = {
  id: "pk-id",
  projectId: "pk-project",
  category: "pk-category",
  sourceFile: "pk-source-file",
  sourceSymbol: "pk-source-symbol",
  sourceRevision: "pk-source-revision",
  fingerprint: "pk-fingerprint",
  observedAt: "pk-observed-at",
  validatedAt: "pk-validated-at",
  validationMethod: "pk-validation-method",
  confidence: "pk-confidence",
  writeScopes: "pk-write-scopes",
  runScope: "pk-run-scope",
  agentRole: "pk-agent-role",
  invalidationConditions: "pk-invalidation-conditions",
  supersedes: "pk-supersedes",
  rationale: "pk-rationale",
} as const;

export function renderRecordFile(record: ProjectKnowledgeRecord): string {
  // Pairs keep the EXTRA_KEYS evidence at every entry; the trailing optional
  // fields stay absent (not empty) when unset so round-trip parsing sees no
  // phantom keys. Old files predate `pk-rationale` and parse with
  // `rationale` undefined.
  const pairs: Array<[string, string]> = [
    [EXTRA_KEYS.id, record.id],
    [EXTRA_KEYS.projectId, record.projectId],
    [EXTRA_KEYS.category, record.category],
    [EXTRA_KEYS.sourceFile, record.sourceFile],
    [EXTRA_KEYS.sourceSymbol, record.sourceSymbol],
    [EXTRA_KEYS.sourceRevision, record.sourceRevision],
    [EXTRA_KEYS.fingerprint, record.fingerprint],
    [EXTRA_KEYS.observedAt, record.observedAt],
    [EXTRA_KEYS.validationMethod, record.validationMethod],
    [EXTRA_KEYS.confidence, String(record.confidence)],
    [EXTRA_KEYS.writeScopes, JSON.stringify(record.scope.writeScopes)],
    [EXTRA_KEYS.invalidationConditions, JSON.stringify(record.invalidationConditions)],
  ];
  if (record.validatedAt !== undefined) pairs.push([EXTRA_KEYS.validatedAt, record.validatedAt]);
  if (record.scope.runScope !== undefined) pairs.push([EXTRA_KEYS.runScope, record.scope.runScope]);
  if (record.agentRole !== undefined) pairs.push([EXTRA_KEYS.agentRole, record.agentRole]);
  if (record.supersedes !== null) pairs.push([EXTRA_KEYS.supersedes, record.supersedes]);
  if (record.rationale !== undefined) {
    pairs.push([EXTRA_KEYS.rationale, JSON.stringify(record.rationale.notes)]);
  }
  const extra = Object.fromEntries(pairs);
  // The claim is the description, so the memfs contract (non-empty description)
  // and this module's claim gate coincide.
  return renderMemoryFile({ description: record.claim, extra }, "");
}

/** Decodes the `pk-rationale` JSON note list; rejects anything else. */
function decodeRationaleNotes(raw: string): readonly RationaleNote[] | undefined {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(candidate)) return undefined;
  const notes: RationaleNote[] = [];
  for (const entry of candidate) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const { kind, text, standing, confidence } = entry as Record<string, unknown>;
    if (typeof kind !== "string" || typeof text !== "string") return undefined;
    if (typeof standing !== "string" || !isKnowledgeCategory(standing)) return undefined;
    if (typeof confidence !== "number" || !isConfidenceText(String(confidence))) return undefined;
    notes.push({ kind: kind as RationaleKind, text, standing, confidence });
  }
  return notes;
}

export type ParsedRecordFile =
  | { readonly kind: "record"; readonly record: ProjectKnowledgeRecord }
  | { readonly kind: "dropped"; readonly reason: string }
  | { readonly kind: "secret"; readonly reason: string };

export function parseRecordFile(path: string, content: string): ParsedRecordFile {
  if (!isRecordFilePath(path)) return { kind: "dropped", reason: "not-a-record-path" };
  let description: string;
  let extra: Readonly<Record<string, string>> | undefined;
  try {
    const parsed = parseMemoryFile(content);
    description = parsed.frontmatter.description;
    extra = parsed.frontmatter.extra;
  } catch {
    // SV-SCHEMA: unparseable files are dropped, never loaded.
    return { kind: "dropped", reason: "unparseable" };
  }
  const claimFailure = checkClaim(description);
  if (claimFailure !== undefined) return { kind: "dropped", reason: claimFailure };
  // Section 6 SECRET-FOUND on the read path: purge, never load.
  if (containsSecretLikeMaterial(description)) return { kind: "secret", reason: "secret-found" };
  const raw = (key: string): string | undefined => {
    const value = extra?.[key];
    return value === undefined ? undefined : decodeScalarSource(value);
  };
  const projectId = raw(EXTRA_KEYS.projectId);
  const categoryText = raw(EXTRA_KEYS.category);
  const sourceFile = raw(EXTRA_KEYS.sourceFile);
  const sourceSymbol = raw(EXTRA_KEYS.sourceSymbol);
  const sourceRevision = raw(EXTRA_KEYS.sourceRevision);
  const fingerprint = raw(EXTRA_KEYS.fingerprint);
  const observedAt = raw(EXTRA_KEYS.observedAt);
  const validatedAt = raw(EXTRA_KEYS.validatedAt);
  const methodText = raw(EXTRA_KEYS.validationMethod);
  const confidenceText = raw(EXTRA_KEYS.confidence);
  const scopesText = raw(EXTRA_KEYS.writeScopes);
  const runScope = raw(EXTRA_KEYS.runScope);
  const agentRole = raw(EXTRA_KEYS.agentRole);
  const conditionsText = raw(EXTRA_KEYS.invalidationConditions);
  const supersedes = raw(EXTRA_KEYS.supersedes);
  const rationaleText = raw(EXTRA_KEYS.rationale);
  if (
    projectId === undefined ||
    categoryText === undefined ||
    !isKnowledgeCategory(categoryText) ||
    sourceFile === undefined ||
    sourceSymbol === undefined ||
    sourceRevision === undefined ||
    fingerprint === undefined ||
    observedAt === undefined ||
    methodText === undefined ||
    !isValidationMethod(methodText) ||
    confidenceText === undefined ||
    !isConfidenceText(confidenceText) ||
    scopesText === undefined ||
    conditionsText === undefined
  ) {
    return { kind: "dropped", reason: "missing-field" };
  }
  const storedId = raw(EXTRA_KEYS.id);
  // Field 1: identity is recomputed, never user-supplied.
  if (storedId !== computeRecordId(sourceFile, sourceSymbol, description)) {
    return { kind: "dropped", reason: "id-mismatch" };
  }
  const writeScopes = decodeStringList(scopesText);
  const invalidationConditions = decodeStringList(conditionsText);
  if (writeScopes === undefined || invalidationConditions === undefined) {
    return { kind: "dropped", reason: "malformed-list" };
  }
  // Field 17 is additive: files written before it exist carry no key and load
  // with `rationale` undefined. An empty stored list normalizes the same way.
  let rationale: KnowledgeRationale | undefined;
  if (rationaleText !== undefined) {
    const notes = decodeRationaleNotes(rationaleText);
    if (notes === undefined) return { kind: "dropped", reason: "malformed-rationale" };
    for (const note of notes) {
      if (containsSecretLikeMaterial(note.text)) return { kind: "secret", reason: "secret-found" };
    }
    if (notes.length > 0) rationale = { notes: [...notes] };
  }
  const record: ProjectKnowledgeRecord = {
    id: computeRecordId(sourceFile, sourceSymbol, description),
    projectId,
    category: categoryText,
    claim: description,
    sourceFile,
    sourceSymbol,
    sourceRevision,
    fingerprint,
    observedAt,
    validatedAt,
    validationMethod: methodText,
    confidence: Number(confidenceText),
    scope: { writeScopes, runScope },
    agentRole,
    invalidationConditions,
    supersedes: supersedes ?? null,
    rationale,
  };
  const failure = checkCommonFields(record);
  if (failure !== undefined) return { kind: "dropped", reason: failure };
  return { kind: "record", record };
}

export interface CommittedRecordFile {
  readonly path: string;
  readonly content: string;
}

export interface RecordFileIssue {
  readonly path: string;
  readonly reason: string;
}

export interface LoadRecordsSummary {
  readonly loaded: number;
  /** SV-SCHEMA: every dropped file is counted, never loaded. */
  readonly dropped: number;
  /** Section 6 SECRET-FOUND purges on the read path. */
  readonly secretPurged: number;
  readonly issues: readonly RecordFileIssue[];
}

/**
 * Write-time project binding (annex G2): a record commits under the project
 * that is active at commit time. A write issued before a project switch but
 * committed after lands under its original `projectId` only when that project
 * is still active; otherwise it is refused and never becomes visible to the
 * new project.
 */
export type CommitRecordResult =
  | { readonly kind: "committed"; readonly record: ProjectKnowledgeRecord }
  | { readonly kind: "refused"; readonly reason: string };

export interface RecordCommitTarget {
  has(id: string): boolean;
  insert(record: ProjectKnowledgeRecord): boolean;
}

export function commitRecord(
  target: RecordCommitTarget,
  record: ProjectKnowledgeRecord,
  activeProjectId: string,
): CommitRecordResult {
  if (record.projectId !== activeProjectId) return { kind: "refused", reason: "project-switch" };
  if (!target.insert(record)) return { kind: "refused", reason: "duplicate-id" };
  return { kind: "committed", record };
}

export class ProjectKnowledgeStore implements RecordCommitTarget {
  private records: Map<string, ProjectKnowledgeRecord> = new Map();

  /**
   * Replace all state from HEAD-tree files (INV-13, annex M21): only committed
   * files are passed in, so uncommitted working-tree records and restarted
   * sessions carry nothing over.
   */
  loadCommitted(files: readonly CommittedRecordFile[]): LoadRecordsSummary {
    const ordered = [...files].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
    const next: Map<string, ProjectKnowledgeRecord> = new Map();
    let dropped = 0;
    let secretPurged = 0;
    const issues: RecordFileIssue[] = [];
    for (const file of ordered) {
      const parsed = parseRecordFile(file.path, file.content);
      if (parsed.kind === "record") {
        next.set(parsed.record.id, parsed.record);
        continue;
      }
      dropped += 1;
      if (parsed.kind === "secret") secretPurged += 1;
      issues.push({ path: file.path, reason: parsed.reason });
    }
    this.records = next;
    return { loaded: next.size, dropped, secretPurged, issues };
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  /** Retrieval view: `superseded` records are invisible (INV-04). */
  get(id: string): ProjectKnowledgeRecord | undefined {
    const record = this.records.get(id);
    return record === undefined || record.category === "superseded" ? undefined : record;
  }

  /** Audit view: superseded ids resolve by exact id but never rank (INV-18). */
  getForAudit(id: string): ProjectKnowledgeRecord | undefined {
    return this.records.get(id);
  }

  /** Retrieval input: every visible record. Rankers and budget trim from here. */
  eligible(): readonly ProjectKnowledgeRecord[] {
    const visible: ProjectKnowledgeRecord[] = [];
    for (const record of this.records.values()) {
      if (record.category !== "superseded") visible.push(record);
    }
    return visible;
  }

  insert(record: ProjectKnowledgeRecord): boolean {
    if (this.records.has(record.id)) return false;
    this.records.set(record.id, record);
    return true;
  }

  replace(record: ProjectKnowledgeRecord): void {
    this.records.set(record.id, record);
  }

  count(): number {
    return this.records.size;
  }
}
