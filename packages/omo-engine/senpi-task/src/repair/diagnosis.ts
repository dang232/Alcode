// Host-produced diagnosis input for the repair loop.
//
// The host (never the model) builds this input from durable evidence after the
// completion gate reports "blocked": it names the failed checks with their
// configured scopes, carries each failed record's exit status and bounded
// output, the timeout/execution metadata, the evidence revision the records
// were taken against alongside the CURRENT workspace revision, the changed
// files that are trustworthy only when a revision is available, and the
// previous repair attempts with their outcomes.
//
// Fail-closed: the builder returns a typed reason instead of an input when no
// failed record exists, when the evidence revision cannot be determined, or
// when the current revision cannot be determined. It never synthesises a
// failure the evidence does not show.
//
// No code-graph / project-intelligence evidence rides on this input: this
// package owns no live graph provider. dag/intelligence/* only consumes
// host-supplied envelopes (buildTaskUnderstanding over TaskUnderstandingInput)
// and dag/graph-assist.ts only advises the DAG scheduler's admission. A host
// that owns a graph passes query results through its own channel; this module
// invents none.

import { execFileSync } from "node:child_process";
import {
  isVerificationAccepting,
  parseVerificationRecord,
  verificationRecordKey,
  type DagVerificationRecord,
  type DagVerificationStatus,
  type DagVerifyCheckCategory,
} from "../dag/verification";
import { catalogueChecks, type OrdinaryCatalogue } from "../verification/catalogue";
import { createFileEvidenceStore, workspaceRevision } from "../verification/evidence-store";
import type { RepairOutcome, RepairAttempt } from "./attempt";
import type { RepairState } from "./state";
import type { RepairAttemptStore } from "./store";

// Bound applied to the single combined output stream of each failed check.
// The runner merges stdout and stderr into one `output` string (see
// runVerificationCommand), and buildVerificationRecord already caps the
// persisted summary at 4000 chars; the diagnosis carries a tighter excerpt so
// one verbose failure cannot bloat the repair input. Stated on every failed
// check entry as `outputCapChars` alongside `outputTruncated`.
const DIAGNOSIS_OUTPUT_CAP_CHARS = 2000;

// One failed check with its configured scope and bounded execution evidence.
type FailedCheckDiagnosis = {
  readonly checkId: string;
  readonly category: DagVerifyCheckCategory;
  readonly criteria: readonly string[];
  // The check's configured scope (coveredPaths). Empty means the check is
  // run-scoped: it attests the whole tree, not a file set.
  readonly configuredScope: readonly string[];
  readonly command: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly status: DagVerificationStatus;
  readonly started: boolean;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly uncertainEffect: boolean;
  readonly durationMs: number;
  readonly startedAt: string;
  readonly completedAt: string;
  // Combined stdout/stderr excerpt, first DIAGNOSIS_OUTPUT_CAP_CHARS chars.
  readonly outputExcerpt: string;
  readonly outputTruncated: boolean;
  readonly outputBytes: number;
  readonly outputCapChars: number;
  readonly classification?: string;
  readonly diagnosticRef?: string;
};

type PreviousAttemptSummary = {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly runEpoch: number;
  readonly state: RepairState;
  readonly outcomeResult?: RepairOutcome["result"];
  readonly outcomeReason?: string;
};

function summarizeAttempt(attempt: RepairAttempt): PreviousAttemptSummary {
  const summary: PreviousAttemptSummary = {
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    runEpoch: attempt.runEpoch,
    state: attempt.state,
  };
  if (attempt.outcome === undefined) return summary;
  const withOutcome: PreviousAttemptSummary = {
    ...summary,
    outcomeResult: attempt.outcome.result,
  };
  if (attempt.outcome.reason === undefined) return withOutcome;
  return { ...withOutcome, outcomeReason: attempt.outcome.reason };
}

type RepairDiagnosisInput = {
  readonly taskId: string;
  readonly runId: string;
  readonly epoch: number;
  readonly failedChecks: readonly FailedCheckDiagnosis[];
  // The single source revision every failed record agrees on. Empty agreement
  // (missing, blank, or mixed revisions) fails the build instead of guessing.
  readonly evidenceRevision: string;
  readonly currentRevision: string;
  readonly revisionsMatch: boolean;
  // Workspace changed files. Trustworthy only when the current revision could
  // be determined (changedFilesTrustworthy); otherwise empty.
  readonly changedFiles: readonly string[];
  readonly changedFilesTrustworthy: boolean;
  readonly previousAttempts: readonly PreviousAttemptSummary[];
};

// Facts vs hypotheses: facts are host-observed strings (each index citable);
// a hypothesis must cite at least one fact index, so an unsupported claim
// cannot enter the diagnosis.
type RepairHypothesis = {
  readonly statement: string;
  readonly supportingFactIndexes: readonly number[];
};

type RepairDiagnosis = {
  readonly facts: readonly string[];
  readonly hypotheses: readonly RepairHypothesis[];
};

type RepairDiagnosisBuildError =
  | { readonly reason: "hypothesis_without_support"; readonly hypothesisIndex: number }
  | { readonly reason: "fact_index_out_of_range"; readonly hypothesisIndex: number; readonly factIndex: number };

type BuildRepairDiagnosisResult =
  | { readonly ok: true; readonly diagnosis: RepairDiagnosis }
  | { readonly ok: false; readonly reason: RepairDiagnosisBuildError["reason"]; readonly hypothesisIndex: number; readonly factIndex?: number };

function buildRepairDiagnosis(input: {
  readonly facts: readonly string[];
  readonly hypotheses: readonly { readonly statement: string; readonly supportingFactIndexes: readonly number[] }[];
}): BuildRepairDiagnosisResult {
  for (let index = 0; index < input.hypotheses.length; index += 1) {
    const hypothesis = input.hypotheses[index];
    if (hypothesis === undefined) continue;
    if (hypothesis.supportingFactIndexes.length === 0) {
      return { ok: false, reason: "hypothesis_without_support", hypothesisIndex: index };
    }
    for (const factIndex of hypothesis.supportingFactIndexes) {
      if (!Number.isInteger(factIndex) || factIndex < 0 || factIndex >= input.facts.length) {
        return { ok: false, reason: "fact_index_out_of_range", hypothesisIndex: index, factIndex };
      }
    }
  }
  return {
    ok: true,
    diagnosis: {
      facts: [...input.facts],
      hypotheses: input.hypotheses.map((hypothesis) => ({
        statement: hypothesis.statement,
        supportingFactIndexes: [...hypothesis.supportingFactIndexes],
      })),
    },
  };
}

type RepairDiagnosisFailureReason = "no_failed_record" | "evidence_revision_unknown" | "current_revision_unknown";

export type BuildRepairDiagnosisInputDeps = {
  readonly taskId: string;
  readonly runId: string;
  readonly epoch: number;
  readonly catalogue: OrdinaryCatalogue;
  readonly evidenceRoot: string;
  readonly workspaceDir: string;
  readonly attemptStore: RepairAttemptStore;
  // Injected for tests; defaults to the real workspaceRevision(workspaceDir).
  readonly currentRevision?: () => string;
  // Injected for tests; defaults to a git-status listing of workspaceDir.
  readonly changedFiles?: () => readonly string[] | null;
};

export type RepairDiagnosisInputResult =
  | { readonly ok: true; readonly input: RepairDiagnosisInput }
  | { readonly ok: false; readonly reason: RepairDiagnosisFailureReason; readonly detail: string };

function toFailedCheck(record: DagVerificationRecord, scopeByCheckId: ReadonlyMap<string, readonly string[]>): FailedCheckDiagnosis {
  const excerpt = record.outputSummary.slice(0, DIAGNOSIS_OUTPUT_CAP_CHARS);
  const base: FailedCheckDiagnosis = {
    checkId: record.checkId,
    category: record.category,
    criteria: [...record.criteria],
    configuredScope: scopeByCheckId.get(record.checkId) ?? [],
    command: [...record.command],
    cwd: record.cwd,
    timeoutMs: record.timeoutMs,
    status: record.status,
    started: record.started,
    timedOut: record.timedOut,
    cancelled: record.cancelled,
    uncertainEffect: record.uncertainEffect,
    durationMs: record.durationMs,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    outputExcerpt: excerpt,
    outputTruncated: record.outputSummary.length > excerpt.length,
    outputBytes: record.outputBytes,
    outputCapChars: DIAGNOSIS_OUTPUT_CAP_CHARS,
  };
  let next = base;
  if (record.exitCode !== undefined) next = { ...next, exitCode: record.exitCode };
  if (record.signal !== undefined) next = { ...next, signal: record.signal };
  if (record.classification !== undefined) next = { ...next, classification: record.classification };
  if (record.diagnosticRef !== undefined) next = { ...next, diagnosticRef: record.diagnosticRef };
  return next;
}

function listChangedFiles(workspaceDir: string): readonly string[] {
  const status = execFileSync("git", ["-C", workspaceDir, "status", "--porcelain=v1", "--untracked-files=normal"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const files: string[] = [];
  for (const line of status.split("\n")) {
    if (line.length < 4) continue;
    const pathPart = line.slice(3);
    const arrow = pathPart.indexOf(" -> ");
    const raw = arrow >= 0 ? pathPart.slice(arrow + 4) : pathPart;
    const unquoted = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    if (unquoted.length > 0) files.push(unquoted);
  }
  return [...new Set(files)].sort();
}

export function buildRepairDiagnosisInput(deps: BuildRepairDiagnosisInputDeps): RepairDiagnosisInputResult {
  const store = createFileEvidenceStore(deps.evidenceRoot);
  let listed: readonly string[];
  try {
    listed = store.listVerifications(deps.runId);
  } catch {
    return { ok: false, reason: "no_failed_record", detail: `no verification evidence for run ${deps.runId}` };
  }

  // Read each listed file by re-resolving node/check/attempt from the stem the
  // same way readRunVerificationRecords does (last segments win), so dotted
  // check ids route to the right record instead of failing the build. Latest
  // file per check key wins.
  const byKey = new Map<string, { readonly record: DagVerificationRecord; readonly attempt: number }>();
  let malformed = 0;
  for (const file of listed) {
    if (!file.endsWith(".json")) continue;
    const stem = file.slice(0, -".json".length);
    const attemptSeparator = stem.lastIndexOf(".");
    if (attemptSeparator < 0) continue;
    const head = stem.slice(0, attemptSeparator);
    const checkSeparator = head.lastIndexOf(".");
    if (checkSeparator < 0) continue;
    const nodeId = head.slice(0, checkSeparator);
    const checkId = head.slice(checkSeparator + 1);
    const attempt = Number(stem.slice(attemptSeparator + 1));
    if (!Number.isInteger(attempt) || attempt < 0) continue;
    const raw = store.readVerification(deps.runId, nodeId, checkId, attempt);
    if (raw === null) continue;
    const record = parseVerificationRecord(raw);
    if (record === null) {
      malformed += 1;
      continue;
    }
    const key = verificationRecordKey(record.nodeId, record.checkId);
    const stored = byKey.get(key);
    if (stored === undefined || attempt >= stored.attempt) byKey.set(key, { record, attempt });
  }

  // Only this epoch's evidence counts: the evidence dir is per run id and a
  // run id spans epochs, so an older epoch's failure is another run's story.
  const failed: DagVerificationRecord[] = [];
  for (const entry of byKey.values()) {
    if (entry.record.workerAttempt !== undefined && entry.record.workerAttempt !== deps.epoch) continue;
    if (!isVerificationAccepting(entry.record.status)) failed.push(entry.record);
  }
  failed.sort((a, b) => (a.checkId < b.checkId ? -1 : a.checkId > b.checkId ? 1 : 0));
  if (failed.length === 0) {
    return {
      ok: false,
      reason: "no_failed_record",
      detail: malformed > 0
        ? `no failed verification record for run ${deps.runId} at epoch ${deps.epoch} (${malformed} malformed file(s) skipped)`
        : `no failed verification record for run ${deps.runId} at epoch ${deps.epoch}`,
    };
  }

  const revisions = [...new Set(failed.map((record) => record.sourceRevision).filter((revision) => revision.length > 0))];
  if (revisions.length !== 1 || revisions[0] === undefined) {
    return {
      ok: false,
      reason: "evidence_revision_unknown",
      detail: `failed records disagree on (or omit) the source revision for run ${deps.runId}`,
    };
  }
  const evidenceRevision: string = revisions[0];

  let currentRevision: string;
  try {
    currentRevision = deps.currentRevision !== undefined ? deps.currentRevision() : workspaceRevision(deps.workspaceDir);
  } catch (error) {
    return {
      ok: false,
      reason: "current_revision_unknown",
      detail: `workspace revision unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let changedFiles: readonly string[] = [];
  let changedFilesTrustworthy = false;
  try {
    const changed = deps.changedFiles !== undefined ? deps.changedFiles() : listChangedFiles(deps.workspaceDir);
    if (changed !== null) {
      changedFiles = [...changed].sort();
      changedFilesTrustworthy = true;
    }
  } catch {
    changedFiles = [];
    changedFilesTrustworthy = false;
  }

  const scopeByCheckId = new Map<string, readonly string[]>();
  for (const check of catalogueChecks(deps.catalogue)) {
    scopeByCheckId.set(check.checkId, check.coveredPaths === undefined ? [] : [...check.coveredPaths]);
  }

  return {
    ok: true,
    input: {
      taskId: deps.taskId,
      runId: deps.runId,
      epoch: deps.epoch,
      failedChecks: failed.map((record) => toFailedCheck(record, scopeByCheckId)),
      evidenceRevision,
      currentRevision,
      revisionsMatch: evidenceRevision === currentRevision,
      changedFiles,
      changedFilesTrustworthy,
      previousAttempts: deps.attemptStore.list(deps.taskId).map(summarizeAttempt),
    },
  };
}
