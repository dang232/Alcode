// Durable repair-attempt storage: one JSON file per attempt.
//
// Layout mirrors the evidence store's host-owned directory discipline:
// `<root>/<taskId>/<attemptId>.json`, written temp+rename so a torn write can
// never be mistaken for a record. The store keeps NO in-memory cache: every
// call hits disk, so a fresh store instance over the same root reads back
// every attempt. Restart recovery is a property of the layout, not of memory.
//
// Overwrite guards, in order: the attemptId must be the canonical derivation
// of (taskId, runEpoch, attemptNumber); the file's stored identity must match
// the incoming one; a persisted sibling for the same task with a NEWER
// runEpoch (or, within the same epoch, a higher attemptNumber) rejects the
// write as stale; and a same-file write older than what is stored rejects as
// stale. A stale attempt may never overwrite a newer one for the same task.

import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseRepairAttemptId, type RepairAttempt, type RepairOutcome } from "./attempt";
import { REPAIR_STATES, type RepairState } from "./state";

const REPAIR_STORE_BOUNDS = {
  maxCheckIds: 200,
  maxEvidenceIds: 200,
  maxPlanSteps: 100,
  maxPlanStepLength: 2048,
  maxTextLength: 8192,
} as const;

function assertSafeSegment(value: string, name: string): void {
  if (value.length === 0 || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
    throw new Error(`invalid ${name} for repair attempt storage: ${JSON.stringify(value)}`);
  }
}

function truncateText(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

// Bounded output: id lists and plan steps are capped in count, free text in
// length, so one oversized plan or failure report cannot grow a record file
// without bound. Identity fields (attemptId, taskId, runEpoch, attemptNumber,
// diagnosisRevision, timestamps) are kept exact - truncating them would break
// equality checks elsewhere.
function boundRepairAttemptForStore(attempt: RepairAttempt): RepairAttempt {
  let boundedOutcome: RepairOutcome | undefined;
  if (attempt.outcome !== undefined) {
    boundedOutcome = {
      result: attempt.outcome.result,
      recordedAt: attempt.outcome.recordedAt,
    };
    if (attempt.outcome.reason !== undefined) {
      boundedOutcome = {
        ...boundedOutcome,
        reason: truncateText(attempt.outcome.reason, REPAIR_STORE_BOUNDS.maxTextLength),
      };
    }
    if (attempt.outcome.detail !== undefined) {
      boundedOutcome = {
        ...boundedOutcome,
        detail: truncateText(attempt.outcome.detail, REPAIR_STORE_BOUNDS.maxTextLength),
      };
    }
  }
  return {
    ...attempt,
    failedCheckIds: attempt.failedCheckIds.slice(0, REPAIR_STORE_BOUNDS.maxCheckIds),
    failedEvidenceIds: attempt.failedEvidenceIds.slice(0, REPAIR_STORE_BOUNDS.maxEvidenceIds),
    plan:
      attempt.plan === undefined
        ? undefined
        : {
            summary: truncateText(attempt.plan.summary, REPAIR_STORE_BOUNDS.maxTextLength),
            steps: attempt.plan.steps
              .slice(0, REPAIR_STORE_BOUNDS.maxPlanSteps)
              .map((step) => truncateText(step, REPAIR_STORE_BOUNDS.maxPlanStepLength)),
            createdAt: attempt.plan.createdAt,
          },
    outcome: boundedOutcome,
  };
}

// The JSON shape a repair record file may hold. Every field is optional and
// concretely typed: a missing or mistyped field fails the record check below,
// so a corrupt file is never mistaken for an attempt. This is the parse
// boundary for repair JSON: raw text becomes this candidate through a single
// JSON.parse assertion, and everything downstream reads only these fields.
type RepairAttemptCandidate = {
  readonly attemptId?: string;
  readonly taskId?: string;
  readonly runEpoch?: number;
  readonly attemptNumber?: number;
  readonly workspaceId?: string;
  readonly state?: string;
  readonly failedCheckIds?: readonly string[];
  readonly failedEvidenceIds?: readonly string[];
  readonly diagnosisRevision?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
};

// String-typed JSON fields arrive through the candidate above, whose types
// promise strings but whose runtime values are whatever the file held. A
// strict identity against String(value) accepts only genuine string
// primitives: String objects, numbers, and every other JSON value stringify
// to something they are not identical to, exactly like a typeof check.
function isCandidateString(value: string | undefined): value is string {
  return value !== undefined && value === String(value);
}

function isRepairState(value: string | undefined): value is RepairState {
  // SAFETY: REPAIR_STATES is the frozen literal of the seven repair states;
  // widening it admits the includes call, and membership itself is decided by
  // that call, so no non-member can pass through this assertion.
  return isCandidateString(value) && (REPAIR_STATES as readonly string[]).includes(value);
}

// Strict shape check for records read back from disk. Unknown extra fields
// are tolerated (forward compatibility); missing or mistyped identity fields
// fail, so a corrupt file is never mistaken for an attempt.
function isRepairAttemptRecord(value: RepairAttemptCandidate): value is RepairAttempt {
  if (value === null || value === undefined || value.constructor !== Object) return false;
  if (!isCandidateString(value.attemptId)) return false;
  if (!isCandidateString(value.taskId)) return false;
  if (!Number.isSafeInteger(value.runEpoch)) return false;
  if (!Number.isSafeInteger(value.attemptNumber)) return false;
  if (!isCandidateString(value.workspaceId)) return false;
  if (!isRepairState(value.state)) return false;
  if (!Array.isArray(value.failedCheckIds) || !value.failedCheckIds.every((id) => isCandidateString(id))) {
    return false;
  }
  if (!Array.isArray(value.failedEvidenceIds) || !value.failedEvidenceIds.every((id) => isCandidateString(id))) {
    return false;
  }
  if (!isCandidateString(value.diagnosisRevision)) return false;
  if (!Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)) return false;
  const parsed = parseRepairAttemptId(value.attemptId);
  if (parsed === null) return false;
  if (parsed.taskId !== value.taskId || parsed.runEpoch !== value.runEpoch) return false;
  return true;
}

function attemptFilePath(root: string, taskId: string, attemptId: string): string {
  return join(root, taskId, `${attemptId}.json`);
}

// Sibling scan for the staleness guard: every valid attempt file persisted
// for this task. Corrupt sibling files are skipped, never fatal - one broken
// file must not block a newer attempt from persisting.
function readTaskAttempts(root: string, taskId: string): RepairAttempt[] {
  let entries: string[];
  try {
    entries = readdirSync(join(root, taskId));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const attempts: RepairAttempt[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    let raw: string;
    try {
      raw = readFileSync(join(root, taskId, entry), "utf8");
    } catch {
      continue;
    }
    let parsed: RepairAttemptCandidate;
    try {
      // SAFETY: JSON.parse returns whatever the file held; the candidate type
      // only names the fields the record check reads, and
      // isRepairAttemptRecord rejects anything missing or mistyped before the
      // value is trusted.
      parsed = JSON.parse(raw) as RepairAttemptCandidate;
    } catch {
      continue;
    }
    if (isRepairAttemptRecord(parsed)) attempts.push(parsed);
  }
  attempts.sort((a, b) => a.runEpoch - b.runEpoch || a.attemptNumber - b.attemptNumber);
  return attempts;
}

export type RepairAttemptStoreOptions = {
  readonly root: string;
};

export type RepairAttemptStore = {
  readonly root: string;
  // Persists the bounded copy and returns its file path. Throws when the
  // attemptId is not the canonical derivation of its identity fields, when
  // the stored file belongs to a different attempt, or when the write is
  // stale relative to what is already persisted for the task.
  save(attempt: RepairAttempt): string;
  // Returns null for an unknown id or a missing file; throws on a malformed
  // record, because the caller asked for that exact attempt.
  load(attemptId: string): RepairAttempt | null;
  // Every valid attempt persisted for the task, oldest first. A missing task
  // directory reads as no attempts.
  list(taskId: string): RepairAttempt[];
};

export function createRepairAttemptStore(options: RepairAttemptStoreOptions): RepairAttemptStore {
  const root = options.root;
  return {
    root,
    save(attempt: RepairAttempt): string {
      assertSafeSegment(attempt.taskId, "taskId");
      assertSafeSegment(attempt.attemptId, "attemptId");
      const parsed = parseRepairAttemptId(attempt.attemptId);
      if (
        parsed === null ||
        parsed.taskId !== attempt.taskId ||
        parsed.runEpoch !== attempt.runEpoch ||
        parsed.attemptNumber !== attempt.attemptNumber
      ) {
        throw new Error(
          `repair attempt identity mismatch: ${JSON.stringify(attempt.attemptId)} is not the canonical id for this task, epoch, and attempt number`,
        );
      }
      for (const sibling of readTaskAttempts(root, attempt.taskId)) {
        if (sibling.attemptId === attempt.attemptId) continue;
        if (
          sibling.runEpoch > attempt.runEpoch ||
          (sibling.runEpoch === attempt.runEpoch && sibling.attemptNumber > attempt.attemptNumber)
        ) {
          throw new Error(
            `stale repair attempt write: ${attempt.attemptId} is older than persisted ${sibling.attemptId}`,
          );
        }
      }
      const target = attemptFilePath(root, attempt.taskId, attempt.attemptId);
      let stored: RepairAttempt | null = null;
      try {
        const raw = readFileSync(target, "utf8");
        // SAFETY: the bytes come straight from a file this store wrote;
        // treating them as a candidate only stages them for the record check
        // below, which throws on anything malformed before it is stored.
        const value: RepairAttemptCandidate = JSON.parse(raw) as RepairAttemptCandidate;
        if (!isRepairAttemptRecord(value)) {
          throw new Error(`malformed repair attempt record for ${attempt.attemptId}`);
        }
        stored = value;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          stored = null;
        } else {
          throw error;
        }
      }
      if (stored !== null) {
        if (
          stored.taskId !== attempt.taskId ||
          stored.runEpoch !== attempt.runEpoch ||
          stored.attemptNumber !== attempt.attemptNumber
        ) {
          throw new Error(
            `repair attempt identity mismatch: stored file for ${attempt.attemptId} belongs to another attempt`,
          );
        }
        if (stored.updatedAt > attempt.updatedAt) {
          throw new Error(`stale repair attempt write: stored ${attempt.attemptId} is newer than the incoming copy`);
        }
      }
      const bounded = boundRepairAttemptForStore(attempt);
      mkdirSync(join(root, attempt.taskId), { recursive: true });
      const temp = `${target}.${process.pid}.tmp`;
      try {
        writeFileSync(temp, JSON.stringify(bounded, null, 2));
        renameSync(temp, target);
      } catch (error) {
        try {
          unlinkSync(temp);
        } catch {
          // The temp file may not exist; the original write error below is the one that matters.
        }
        throw new Error(
          `failed to persist repair attempt ${attempt.attemptId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return target;
    },
    load(attemptId: string): RepairAttempt | null {
      assertSafeSegment(attemptId, "attemptId");
      const parsed = parseRepairAttemptId(attemptId);
      if (parsed === null) return null;
      assertSafeSegment(parsed.taskId, "taskId");
      let raw: string;
      try {
        raw = readFileSync(attemptFilePath(root, parsed.taskId, attemptId), "utf8");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw error;
      }
      // SAFETY: the bytes come straight from a file this store wrote; treating
      // them as a candidate only stages them for the record check below, which
      // throws on anything malformed before the record is returned.
      const value: RepairAttemptCandidate = JSON.parse(raw) as RepairAttemptCandidate;
      if (!isRepairAttemptRecord(value)) {
        throw new Error(`malformed repair attempt record for ${attemptId}`);
      }
      if (value.attemptId !== attemptId) {
        throw new Error(`repair attempt identity mismatch: stored file for ${attemptId} belongs to another attempt`);
      }
      return value;
    },
    list(taskId: string): RepairAttempt[] {
      assertSafeSegment(taskId, "taskId");
      return readTaskAttempts(root, taskId);
    },
  };
}
