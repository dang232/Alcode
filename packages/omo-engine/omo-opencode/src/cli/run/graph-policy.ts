/**
 * graph-policy.ts
 *
 * Deterministic, synchronous, dependency-free Level 0-3 code-graph preflight
 * policy for Alcode's run request path. The level changes the ACTUAL model
 * request text: level 0 sends the original message untouched, level 1 sends a
 * small evidence block, level 2 a full-size block, and level 3 a full-size
 * block that additionally carries impact and findTests sections.
 *
 * First match wins; every rule below is evaluated in order.
 */

import type {
  TaskClarity,
  TaskComplexity,
  RiskLevel,
  WorkflowStrategy,
} from "./workflow-select";

export type GraphContextLevel = 0 | 1 | 2 | 3;

export interface GraphPolicyInput {
  explicitMode?: string;
  complexity?: TaskComplexity;
  clarity?: TaskClarity;
  risk?: RiskLevel;
  fileCount?: number;
  /** Workflow strategy of the calling path; absent for a chat turn. */
  strategy?: WorkflowStrategy;
  message?: string;
  graphAvailable?: boolean;
  graphStale?: boolean;
  replanCount?: number;
}

export interface GraphPolicyDecision {
  level: GraphContextLevel;
  reasonCode: string;
  notes: readonly string[];
  maxBytes: number;
  maxSubjects: number;
  escalateToHighAssurance: boolean;
}

export const GRAPH_POLICY_ENV = "OMO_GRAPH_PREFLIGHT";

export const GRAPH_LEVEL_BYTES: Record<GraphContextLevel, number> = {
  0: 0,
  1: 1024,
  2: 4096,
  3: 4096,
};

export const GRAPH_LEVEL_SUBJECTS: Record<GraphContextLevel, number> = {
  0: 0,
  1: 1,
  2: 3,
  3: 3,
};

// A code-shape test, not a keyword scan: paths, extensions, diff/call syntax,
// or a code noun in singular OR plural. Plural forms matter: "name the files"
// / "which tests cover it" is a code question even though "file" and "test"
// never appear as whole words.
const CODE_SIGNAL_PATTERN =
  /\.[a-z]{1,5}\b|`|\(.+\)|::|->|\b[a-z0-9_.-]+\/[a-z0-9_.-]+\b|\b(?:function|class|import|export|const|let|fix|bug|refactor|implement|code|symbol|graph|impact|callers?|callees?|dependenc(?:y|ies)|interface|module|package|api|variable|type|method|enum|struct|endpoint|handler|schema|migration|column|query|test|file)s?\b/i;
// Identifiers are checked case-SENSITIVELY: under the `i` flag `[A-Z]` would
// also match lowercase, so "thanks" would read as camelCase.
const CODE_IDENTIFIER_PATTERN = /\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b|\b[a-z0-9]+_[a-z0-9_]+\b/;

function hasCodeSignal(message: string | undefined): boolean {
  if (message === undefined || message.trim().length === 0) return false;
  return CODE_SIGNAL_PATTERN.test(message) || CODE_IDENTIFIER_PATTERN.test(message);
}

function hasFileCount(fileCount: number | undefined): boolean {
  // buildWorkflowProfile reports fileCount 1 when no code path was detected,
  // so 1 still means "no files"; 2+ means real multi-file scope.
  return fileCount !== undefined && fileCount > 1;
}

/**
 * Select the graph context level for one run request.
 * Deterministic, synchronous, dependency-free: the same input always yields
 * the same level, reason code, notes, and budgets.
 */
export function selectGraphContextLevel(
  input: GraphPolicyInput,
): GraphPolicyDecision {
  const notes: string[] = [];
  const explicitMode = (input.explicitMode ?? "").trim().toLowerCase();

  let level: GraphContextLevel;
  let reasonCode: string;

  if (input.risk === "security-sensitive" || input.risk === "high") {
    // Risk outranks both shape heuristics: a security-sensitive task is never
    // "non-code" and never silently reduced to level 0 by an explicit mode.
    level = 3;
    reasonCode = "risk-high";
  } else if (explicitMode === "direct" && input.complexity === "trivial") {
    level = 0;
    reasonCode = "explicit-direct";
  } else if (
    !hasCodeSignal(input.message) &&
    !hasFileCount(input.fileCount)
  ) {
    level = 0;
    reasonCode = "non-code";
  } else if (
    input.complexity === "complex" ||
    input.clarity === "unclear" ||
    (input.fileCount !== undefined && input.fileCount >= 3)
  ) {
    level = 2;
    reasonCode = "scope-broad";
  } else {
    level = 1;
    reasonCode = "code-task";
  }

  if (input.graphAvailable === false) {
    notes.push("graph-unavailable");
  }
  if (input.graphStale === true) {
    notes.push("graph-stale");
  }
  if (input.replanCount !== undefined && input.replanCount >= 1) {
    if (level > 2) {
      level = 2;
    }
    notes.push("replan-capped");
  }

  return {
    level,
    reasonCode,
    notes,
    maxBytes: GRAPH_LEVEL_BYTES[level],
    maxSubjects: GRAPH_LEVEL_SUBJECTS[level],
    // Escalation follows the RISK, not the post-cap level: a security-sensitive
    // task whose graph is unavailable keeps its stricter completion gate even
    // after the replan cap lowers the context level to 2.
    escalateToHighAssurance:
      input.graphAvailable === false
      && (input.risk === "security-sensitive" || input.risk === "high"),
  };
}

/**
 * OMO_GRAPH_PREFLIGHT=0 forces level 0 (original message untouched).
 * Any other value (including unset) leaves the policy decision intact.
 */
export function isGraphPreflightForcedOff(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return (env[GRAPH_POLICY_ENV] ?? "").trim() === "0";
}
