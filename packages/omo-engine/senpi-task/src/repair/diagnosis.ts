// Host-produced diagnosis input for the repair loop.
//
// The host (never the model) builds this input from durable evidence after the
// completion gate reports "blocked": it names the failed checks with their
// configured scopes, carries each failed record's exit status and bounded
// output, the timeout/execution metadata, the evidence revision the records
// were taken against alongside the CURRENT workspace revision, the changed
// files that are trustworthy only when a revision is available, a bounded
// host-observed view of the files those checks own (so an exact `find` string
// can be quoted), and the previous repair attempts with their outcomes.
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
import { closeSync, lstatSync, openSync, readdirSync, readSync, type Dirent } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
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

// Bound on the host-observed workspace view: at most this many bytes of each
// file, at most this many files, so one large tree cannot bloat the prompt.
// A file larger than the cap is reported as truncated (sizeBytes >
// contentBytes) and its content ends with an explicit host marker.
export const DIAGNOSIS_FILE_CONTENT_CAP_BYTES = 8 * 1024;
export const DIAGNOSIS_MAX_CONTEXT_FILES = 3;

// Directories that never describe the code under repair: repository internals,
// installed dependencies, and Alcode's own approval/verification state.
const WORKSPACE_CONTEXT_SKIP_DIRS = new Set([".git", "node_modules", ".alcode", ".omo"]);

// One file in the bounded workspace view. `content` is the first
// DIAGNOSIS_FILE_CONTENT_CAP_BYTES bytes of the file exactly as stored; when
// `truncated` is true a host marker line was appended to say what was cut.
export type RepairWorkspaceFileContext = {
  readonly path: string;
  readonly sizeBytes: number;
  readonly contentBytes: number;
  readonly truncated: boolean;
  readonly content: string;
};

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
  // Host-observed file contents for the failed checks' scopes (first
  // DIAGNOSIS_MAX_CONTEXT_FILES files, first DIAGNOSIS_FILE_CONTENT_CAP_BYTES
  // bytes each). Facts only: the model may quote a `find` from here, never
  // invent one.
  readonly workspaceContext: readonly RepairWorkspaceFileContext[];
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

function toWorkspaceRelativePath(workspaceDir: string, absolutePath: string): string | null {
  const rel = relative(workspaceDir, absolutePath);
  if (rel.length === 0) return null;
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

// List the regular files a scope owns. A file scope yields that file; a
// directory scope (or "" for a run-scoped check) is walked deterministically
// and stops at `limit` files. Symlinks are skipped so the view cannot leave
// the workspace, and repository/dependency internals are never walked.
function collectScopeFiles(workspaceDir: string, scope: string, limit: number): readonly string[] {
  if (limit <= 0) return [];
  const absolute = resolve(workspaceDir, scope);
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(absolute);
  } catch {
    return [];
  }
  if (stats.isSymbolicLink()) return [];
  if (stats.isFile()) {
    const rel = toWorkspaceRelativePath(workspaceDir, absolute);
    return rel === null ? [] : [rel];
  }
  if (!stats.isDirectory()) return [];
  const rootRelative = toWorkspaceRelativePath(workspaceDir, absolute);
  if (rootRelative === null && resolve(absolute) !== resolve(workspaceDir)) return [];

  const files: string[] = [];
  const walk = (dir: string): void => {
    if (files.length >= limit) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      if (files.length >= limit) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (WORKSPACE_CONTEXT_SKIP_DIRS.has(entry.name)) continue;
        walk(resolve(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = toWorkspaceRelativePath(workspaceDir, resolve(dir, entry.name));
      if (rel !== null) files.push(rel);
    }
  };
  walk(absolute);
  return files;
}

// Deterministic candidate order: each failed check's scopes in catalogue order
// (declaration order in the catalogue's [a-z] sorted check list), then the
// changed files already in the input, capped globally.
function collectWorkspaceContextFiles(
  workspaceDir: string,
  scopesByCheck: readonly (readonly string[])[],
  changedFiles: readonly string[],
): readonly string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string): void => {
    if (files.length >= DIAGNOSIS_MAX_CONTEXT_FILES) return;
    const normalized = candidate.replace(/\\/g, "/").replace(/^\.\//, "");
    if (normalized.length === 0 || seen.has(normalized)) return;
    seen.add(normalized);
    files.push(normalized);
  };
  for (const scopes of scopesByCheck) {
    if (files.length >= DIAGNOSIS_MAX_CONTEXT_FILES) break;
    // An empty configuredScope means the check is run-scoped: it owns the tree.
    for (const scope of scopes.length === 0 ? [""] : scopes) {
      if (files.length >= DIAGNOSIS_MAX_CONTEXT_FILES) break;
      for (const file of collectScopeFiles(workspaceDir, scope, DIAGNOSIS_MAX_CONTEXT_FILES - files.length)) {
        add(file);
      }
    }
  }
  for (const changed of changedFiles) add(changed);
  return files;
}

// Read at most DIAGNOSIS_FILE_CONTENT_CAP_BYTES from one file. The read itself
// is bounded (one extra byte proves truncation without loading a huge file),
// and a truncated file says so both structurally and in its content.
function readWorkspaceFileContext(workspaceDir: string, relativePath: string): RepairWorkspaceFileContext | null {
  const absolute = resolve(workspaceDir, relativePath);
  const normalized = toWorkspaceRelativePath(workspaceDir, absolute);
  if (normalized === null) return null;
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(absolute);
  } catch {
    return null;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) return null;
  const sizeBytes = stats.size;
  const readBytes = Math.min(sizeBytes, DIAGNOSIS_FILE_CONTENT_CAP_BYTES + 1);
  const buffer = Buffer.alloc(readBytes);
  let bytesRead = 0;
  try {
    const fd = openSync(absolute, "r");
    try {
      bytesRead = readSync(fd, buffer, 0, readBytes, 0);
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  const prefix = buffer.subarray(0, Math.min(bytesRead, DIAGNOSIS_FILE_CONTENT_CAP_BYTES));
  const truncated = sizeBytes > prefix.length;
  let content = prefix.toString("utf8");
  if (truncated) {
    content += `\n[host truncated: showing first ${prefix.length} of ${sizeBytes} bytes]`;
  }
  return { path: normalized, sizeBytes, contentBytes: prefix.length, truncated, content };
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

  const workspaceContext: RepairWorkspaceFileContext[] = [];
  const contextFiles = collectWorkspaceContextFiles(
    deps.workspaceDir,
    failed.map((record) => scopeByCheckId.get(record.checkId) ?? []),
    changedFiles,
  );
  for (const file of contextFiles) {
    const context = readWorkspaceFileContext(deps.workspaceDir, file);
    if (context !== null) workspaceContext.push(context);
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
      workspaceContext,
      previousAttempts: deps.attemptStore.list(deps.taskId).map(summarizeAttempt),
    },
  };
}
