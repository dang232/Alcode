/**
 * Project-knowledge retrieval wiring on the memory-core ranker chain.
 *
 * Ranking inputs (section 5 weights, constants not config): task relevance
 * 0.40, source authority 0.25, freshness 0.15, scope match 0.10,
 * verification status 0.10. Relevance is derived from the one memory-core
 * ranker chain only (`planRecallQueries` + `chooseRecallStrategy` +
 * `selectRecallCandidates`); there is no second scorer (INV-16). The
 * composite only blends the fixed authority/freshness/scope/verification
 * factors around that single-chain order.
 *
 * Filters, in order: superseded-excluded (INV-04), project isolation
 * (INV-07), environment match (INV-08), read-path secret purge (INV-06),
 * own-session exclusion (INV-17); disjoint scopes serve as read-only hints,
 * never scoped truth (INV-19). Input records come from a HEAD-tree load, so
 * the working tree is never read (INV-13).
 */

import { planRecallQueries } from "../recall/planner";
import { selectRecallCandidates } from "../recall/select";
import { chooseRecallStrategy } from "../recall/strategy";
import type { RecallDocument } from "../recall/provider";
import { containsSecretLikeMaterial } from "../sync/redact";
import { applyBudget, type BudgetedEntry, type BudgetResult, type ScopeNote } from "./budget";
import { STALE_AFTER_MS, recordFilePath, type ProjectKnowledgeRecord } from "./record";

/** Section 5 ranking weights. Constants, not config, not model-tunable. */
export const TASK_RELEVANCE_WEIGHT = 0.4;
export const SOURCE_AUTHORITY_WEIGHT = 0.25;
export const FRESHNESS_WEIGHT = 0.15;
export const SCOPE_MATCH_WEIGHT = 0.1;
export const VERIFICATION_WEIGHT = 0.1;

export interface RetrievalRequest {
  /** Retrieval serves only records carrying this project id (INV-07). */
  readonly projectId: string;
  /** Newest-first conversation texts feeding the planned recall queries. */
  readonly queryTexts: readonly string[];
  readonly nodeWriteScopes: readonly string[];
  readonly runScope?: string;
  /** Record ids written by the caller's own uncommitted session (INV-17). */
  readonly excludeSessionRecordIds?: ReadonlySet<string>;
  readonly excludePaths?: ReadonlySet<string>;
  /** Paths already surfaced this session; they never repeat. */
  readonly surfacedPaths?: ReadonlySet<string>;
  readonly nowMs: number;
}

export interface RankedKnowledgeRecord {
  readonly record: ProjectKnowledgeRecord;
  readonly totalScore: number;
  readonly scopeNote: ScopeNote;
}

export interface RetrievalResult {
  readonly ranked: readonly RankedKnowledgeRecord[];
  /** Section 6 SECRET-FOUND purges on the read path. */
  readonly purgedSecretIds: readonly string[];
  readonly budget: BudgetResult;
}

function authorityScore(record: ProjectKnowledgeRecord): number {
  if (record.category === "source-verified") return 1.0;
  if (record.category === "environment-specific") return 0.8;
  if (record.category === "previously-verified") return 0.5;
  return 0.2;
}

function freshnessScore(record: ProjectKnowledgeRecord, nowMs: number): number {
  const base = record.validatedAt ?? record.observedAt;
  const age = nowMs - Date.parse(base);
  if (!(age > 0)) return 1.0;
  return Math.max(0, 1 - age / STALE_AFTER_MS);
}

function verificationScore(record: ProjectKnowledgeRecord): number {
  if (record.validationMethod === "test-pass") return 1.0;
  if (record.validationMethod === "review-accept") return 0.7;
  if (record.validationMethod === "rg-resolve") return 0.5;
  return 0.0;
}

export interface ScopeMatch {
  readonly score: number;
  readonly note: ScopeNote;
}

function scopeMatch(record: ProjectKnowledgeRecord, nodeWriteScopes: readonly string[]): ScopeMatch {
  if (record.scope.writeScopes.length === 0) return { score: 1.0, note: "in-scope" };
  const node = new Set(nodeWriteScopes);
  const covered = record.scope.writeScopes.every((entry) => node.has(entry));
  return covered ? { score: 1.0, note: "in-scope" } : { score: 0.3, note: "hint-only" };
}

function toRecallDocument(record: ProjectKnowledgeRecord): RecallDocument {
  return {
    path: recordFilePath(record.id),
    description: record.claim,
    body: `${record.category} ${record.sourceFile} ${record.sourceSymbol}`,
  };
}

/**
 * Retrieve eligible knowledge for one project. Only records matched by the
 * single memory-core ranker chain score; everything else filters out before
 * the budget.
 */
export function retrieveProjectKnowledge(
  records: readonly ProjectKnowledgeRecord[],
  request: RetrievalRequest,
): RetrievalResult {
  const purgedSecretIds: string[] = [];
  const excludedSessions = request.excludeSessionRecordIds;
  const eligible = records.filter((record) => {
    if (record.category === "superseded") return false;
    if (record.projectId !== request.projectId) return false;
    if (record.scope.runScope !== undefined && record.scope.runScope !== request.runScope) return false;
    if (containsSecretLikeMaterial(record.claim)) {
      purgedSecretIds.push(record.id);
      return false;
    }
    if (excludedSessions !== undefined && excludedSessions.has(record.id)) return false;
    return true;
  });
  const documents = eligible.map(toRecallDocument);
  const queries = planRecallQueries(request.queryTexts);
  const empty: RetrievalResult = {
    ranked: [],
    purgedSecretIds,
    budget: applyBudget([]),
  };
  if (documents.length === 0 || queries.length === 0) return empty;
  // INV-16: the one memory-core ranker chain decides relevance order.
  const strategy = chooseRecallStrategy(documents, queries);
  const selected = selectRecallCandidates(documents, queries, {
    maxItems: documents.length,
    surfaced: request.surfacedPaths ?? new Set<string>(),
    excludePaths: request.excludePaths,
    strategy,
  });
  const positions = new Map<string, number>();
  selected.forEach((candidate, index) => {
    if (!positions.has(candidate.path)) positions.set(candidate.path, index);
  });
  const byId = new Map<string, ProjectKnowledgeRecord>();
  for (const record of eligible) byId.set(recordFilePath(record.id), record);
  const ranked: RankedKnowledgeRecord[] = [];
  for (const [path, position] of positions) {
    const record = byId.get(path);
    if (record === undefined) continue;
    const relevance = 1 / (1 + position);
    const scope = scopeMatch(record, request.nodeWriteScopes);
    const totalScore =
      TASK_RELEVANCE_WEIGHT * relevance +
      SOURCE_AUTHORITY_WEIGHT * authorityScore(record) +
      FRESHNESS_WEIGHT * freshnessScore(record, request.nowMs) +
      SCOPE_MATCH_WEIGHT * scope.score +
      VERIFICATION_WEIGHT * verificationScore(record);
    ranked.push({ record, totalScore, scopeNote: scope.note });
  }
  ranked.sort((left, right) =>
    right.totalScore !== left.totalScore
      ? right.totalScore - left.totalScore
      : left.record.id < right.record.id
        ? -1
        : left.record.id > right.record.id
          ? 1
          : 0,
  );
  const budgeted: BudgetedEntry[] = ranked.map((entry) => ({
    record: entry.record,
    totalScore: entry.totalScore,
    scopeNote: entry.scopeNote,
  }));
  return { ranked, purgedSecretIds, budget: applyBudget(budgeted) };
}

/**
 * Audit read (INV-18): a superseded id resolves by exact id for audit, but
 * never ranks. Unknown ids resolve to nothing; there is no fuzzy audit read.
 */
export function resolveAuditRecord(
  records: readonly ProjectKnowledgeRecord[],
  id: string,
): ProjectKnowledgeRecord | undefined {
  for (const record of records) {
    if (record.id === id) return record;
  }
  return undefined;
}
