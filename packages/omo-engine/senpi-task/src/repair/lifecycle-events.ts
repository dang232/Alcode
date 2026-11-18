// Authoritative repair lifecycle events for ordinary-task verification repair.
//
// This module sits BESIDE the persisted attempt lifecycle (./state.ts,
// ./attempt.ts, ./store.ts) and never replaces it: the table in ./state.ts
// stays the only authority for attempt moves, and the completion gate in
// ../verification/completion-status.ts stays the only authority for
// "verified". These events are the observable trail a parent agent (or log
// tailer) reads to follow a repair - diagnosis, plan, execution,
// reverification, retry, and the final gate verdict - without inferring
// progress from a mutable attempt record.
//
// Identity fencing, stated so a stale emitter cannot rewrite history:
// every event carries (taskId, runEpoch, attemptId, timestamp). The emit
// gate in this module DROPS any event whose runEpoch is below the task's
// current epoch, and drops every event from a cancelled task, so a late
// callback from an older run (or a stopped run) can never overwrite newer
// state downstream. Dropping is the whole mechanism: the sink is only
// invoked for current-epoch, non-cancelled events.

import type { VerificationStatus } from "../verification/completion-status";

export type RepairLifecycleEventType =
  | "repair_started"
  | "diagnosis_started"
  | "diagnosis_completed"
  | "plan_proposed"
  | "plan_accepted"
  | "plan_rejected"
  | "repair_execution_started"
  | "files_modified"
  | "reverification_started"
  | "reverification_completed"
  | "retry_scheduled"
  | "repair_blocked"
  | "repair_failed"
  | "repair_cancelled"
  | "final_verification_status";

type RepairLifecycleEventBase = {
  readonly type: RepairLifecycleEventType;
  readonly taskId: string;
  readonly runEpoch: number;
  readonly attemptId: string;
  readonly timestamp: number;
};

type RepairStartedEvent = RepairLifecycleEventBase & {
  readonly type: "repair_started";
  readonly failedCheckIds: readonly string[];
  readonly failedEvidenceIds?: readonly string[];
  readonly diagnosisRevision?: string;
  readonly reason?: string;
};

type DiagnosisStartedEvent = RepairLifecycleEventBase & {
  readonly type: "diagnosis_started";
  readonly diagnosisRevision?: string;
  readonly reason?: string;
};

type DiagnosisCompletedEvent = RepairLifecycleEventBase & {
  readonly type: "diagnosis_completed";
  readonly diagnosisRevision: string;
  readonly suspectedRootCause?: string;
  readonly detail?: string;
};

type PlanProposedEvent = RepairLifecycleEventBase & {
  readonly type: "plan_proposed";
  readonly planSummary: string;
  readonly steps?: readonly string[];
  readonly checksToRerun?: readonly string[];
};

type PlanAcceptedEvent = RepairLifecycleEventBase & {
  readonly type: "plan_accepted";
  readonly planSummary?: string;
  readonly reason?: string;
};

type PlanRejectedEvent = RepairLifecycleEventBase & {
  readonly type: "plan_rejected";
  readonly violations: readonly string[];
  readonly reason?: string;
};

type RepairExecutionStartedEvent = RepairLifecycleEventBase & {
  readonly type: "repair_execution_started";
  readonly filesToChange?: readonly string[];
  readonly reason?: string;
};

type FilesModifiedEvent = RepairLifecycleEventBase & {
  readonly type: "files_modified";
  readonly changedFiles: readonly string[];
};

type ReverificationStartedEvent = RepairLifecycleEventBase & {
  readonly type: "reverification_started";
  readonly evidenceRevision?: string;
  readonly checkIds?: readonly string[];
};

type ReverificationCompletedEvent = RepairLifecycleEventBase & {
  readonly type: "reverification_completed";
  readonly verification: VerificationStatus;
  readonly code?: string;
  readonly reason?: string;
};

type RetryScheduledEvent = RepairLifecycleEventBase & {
  readonly type: "retry_scheduled";
  readonly nextAttemptNumber: number;
  readonly reason?: string;
};

type RepairBlockedEvent = RepairLifecycleEventBase & {
  readonly type: "repair_blocked";
  readonly code?: string;
  readonly reason?: string;
  readonly detail?: string;
};

type RepairFailedEvent = RepairLifecycleEventBase & {
  readonly type: "repair_failed";
  readonly reason?: string;
  readonly detail?: string;
};

type RepairCancelledEvent = RepairLifecycleEventBase & {
  readonly type: "repair_cancelled";
  readonly reason?: string;
};

type FinalVerificationStatusEvent = RepairLifecycleEventBase & {
  readonly type: "final_verification_status";
  readonly verification: VerificationStatus;
  readonly code?: string;
  readonly reason?: string;
};

export type RepairLifecycleEvent =
  | RepairStartedEvent
  | DiagnosisStartedEvent
  | DiagnosisCompletedEvent
  | PlanProposedEvent
  | PlanAcceptedEvent
  | PlanRejectedEvent
  | RepairExecutionStartedEvent
  | FilesModifiedEvent
  | ReverificationStartedEvent
  | ReverificationCompletedEvent
  | RetryScheduledEvent
  | RepairBlockedEvent
  | RepairFailedEvent
  | RepairCancelledEvent
  | FinalVerificationStatusEvent;

export const REPAIR_LIFECYCLE_EVENT_TYPES: readonly RepairLifecycleEventType[] = [
  "repair_started",
  "diagnosis_started",
  "diagnosis_completed",
  "plan_proposed",
  "plan_accepted",
  "plan_rejected",
  "repair_execution_started",
  "files_modified",
  "reverification_started",
  "reverification_completed",
  "retry_scheduled",
  "repair_blocked",
  "repair_failed",
  "repair_cancelled",
  "final_verification_status",
];

// The task-side facts the emit gate reads. currentRunEpoch is the task's
// live epoch (TaskRecord.notification.run_epoch); cancelled is true once the
// task is cancelled or carries a cancel request, at which point every
// in-flight repair event is stale by definition.
export type RepairLifecycleEmitGate = {
  readonly currentRunEpoch: number;
  readonly cancelled: boolean;
};

// Minimal task-record shape the gate adapter reads. Structural (not the full
// TaskRecord) so this module never imports the state store.
export type RepairLifecycleTaskSnapshot = {
  readonly notification: { readonly run_epoch: number };
  readonly status: string;
  readonly cancel_requested?: unknown;
  readonly killed?: boolean;
};

export function repairLifecycleGateForTask(task: RepairLifecycleTaskSnapshot): RepairLifecycleEmitGate {
  const cancelled =
    task.status === "cancelled" || task.cancel_requested !== undefined || task.killed === true;
  return { currentRunEpoch: task.notification.run_epoch, cancelled };
}

// Pure staleness check, separated so callers can filter without emitting.
// An event is stale when its epoch trails the task's current epoch, or when
// the task is cancelled (a cancelled task's stale attempt must never publish).
export function isStaleRepairLifecycleEvent(
  event: RepairLifecycleEvent,
  gate: RepairLifecycleEmitGate,
): boolean {
  if (event.runEpoch < gate.currentRunEpoch) return true;
  if (gate.cancelled) return true;
  return false;
}

// Gated emit: invokes the sink only for current-epoch events from a live
// task. Returns true when the sink ran, false when the event was dropped as
// stale. A dropped event leaves downstream state untouched, which is what
// keeps a late callback from an older run from overwriting newer state.
export function emitRepairLifecycleEvent(
  sink: (event: RepairLifecycleEvent) => void,
  event: RepairLifecycleEvent,
  gate: RepairLifecycleEmitGate,
): boolean {
  if (isStaleRepairLifecycleEvent(event, gate)) return false;
  sink(event);
  return true;
}
