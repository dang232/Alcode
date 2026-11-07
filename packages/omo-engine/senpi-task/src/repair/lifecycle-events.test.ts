// Unit test of the authoritative repair lifecycle events (./lifecycle-events)
// and the completion repair-outcome derivation (../completion/notification).
//
// This file owns both: the fifteen typed lifecycle events plus the stale-epoch
// / cancelled-task emit gate, and the gate-verdict-plus-attempt derivation
// that propagates the repair outcome to the parent agent. No sleeps: every
// check is synchronous and pure.
import { describe, expect, test } from "bun:test";

import { buildCompletionDetails, completionMessageLines, deriveRepairOutcomeForCompletion } from "../completion/notification";
import type { TaskRecord } from "../state";
import type { VerificationStatus } from "../verification/completion-status";
import {
  emitRepairLifecycleEvent,
  isStaleRepairLifecycleEvent,
  REPAIR_LIFECYCLE_EVENT_TYPES,
  repairLifecycleGateForTask,
  type RepairLifecycleEvent,
  type RepairLifecycleEventType,
} from "./lifecycle-events";

function baseFields(overrides: Partial<{ taskId: string; runEpoch: number; attemptId: string; timestamp: number }> = {}) {
  return {
    taskId: "st_repair1",
    runEpoch: 0,
    attemptId: "st_repair1.e0.r1",
    timestamp: 1000,
    ...overrides,
  };
}

type VerifiableTestRecord = TaskRecord & { readonly verification_status?: VerificationStatus };

function completedRecord(overrides: Partial<VerifiableTestRecord> = {}): VerifiableTestRecord {
  return {
    task_id: "st_repair1",
    name: "repair-me",
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 1,
    execution_mode: "in-process",
    model: "test/model",
    status: "completed",
    residency_state: "resident",
    created_at: "2026-07-06T01:00:00.000Z",
    updated_at: "2026-07-06T01:00:03.000Z",
    final_response: "done",
    notify_on_terminal: false,
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...overrides,
  };
}

describe("repair lifecycle events", () => {
  test("#given the module #when event types listed #then all fifteen authoritative types are present", () => {
    // given + when
    const types = [...REPAIR_LIFECYCLE_EVENT_TYPES].sort();

    // then: exactly the fifteen lifecycle events from the brief
    const expected: RepairLifecycleEventType[] = [
      "diagnosis_completed",
      "diagnosis_started",
      "files_modified",
      "final_verification_status",
      "plan_accepted",
      "plan_proposed",
      "plan_rejected",
      "repair_blocked",
      "repair_cancelled",
      "repair_execution_started",
      "repair_failed",
      "repair_started",
      "retry_scheduled",
      "reverification_completed",
      "reverification_started",
    ];
    expect(types).toEqual([...expected].sort());
  });

  test("#given every lifecycle type #when one event per type built #then each carries taskId, runEpoch, attemptId, and timestamp", () => {
    // given: one event per type, each with its relevant detail
    const events: RepairLifecycleEvent[] = [
      { type: "repair_started", ...baseFields(), failedCheckIds: ["unit-a"] },
      { type: "diagnosis_started", ...baseFields() },
      { type: "diagnosis_completed", ...baseFields(), diagnosisRevision: "rev-1" },
      { type: "plan_proposed", ...baseFields(), planSummary: "fix the counter" },
      { type: "plan_accepted", ...baseFields(), planSummary: "fix the counter" },
      { type: "plan_rejected", ...baseFields(), violations: ["missing-rerun"] },
      { type: "repair_execution_started", ...baseFields(), filesToChange: ["src/fix.ts"] },
      { type: "files_modified", ...baseFields(), changedFiles: ["src/fix.ts"] },
      { type: "reverification_started", ...baseFields(), evidenceRevision: "rev-2" },
      { type: "reverification_completed", ...baseFields(), verification: "verified" },
      { type: "retry_scheduled", ...baseFields(), nextAttemptNumber: 2 },
      { type: "repair_blocked", ...baseFields(), code: "verification_failed" },
      { type: "repair_failed", ...baseFields(), reason: "reverification_blocked" },
      { type: "repair_cancelled", ...baseFields(), reason: "cancelled" },
      { type: "final_verification_status", ...baseFields(), verification: "verified" },
    ];

    // when + then: identity fencing fields are present on every event
    expect(events).toHaveLength(15);
    for (const event of events) {
      expect(Object.prototype.toString.call(event.taskId)).toBe("[object String]");
      expect(Number.isSafeInteger(event.runEpoch)).toBe(true);
      expect(Object.prototype.toString.call(event.attemptId)).toBe("[object String]");
      expect(Number.isFinite(event.timestamp)).toBe(true);
    }
  });

  test("#given a current-epoch event #when emitted through a live gate #then the sink runs", () => {
    // given
    const seen: RepairLifecycleEvent[] = [];
    const event: RepairLifecycleEvent = { type: "files_modified", ...baseFields({ runEpoch: 1 }), changedFiles: ["a.ts"] };

    // when
    const emitted = emitRepairLifecycleEvent((e) => seen.push(e), event, { currentRunEpoch: 1, cancelled: false });

    // then
    expect(emitted).toBe(true);
    expect(seen).toEqual([event]);
  });

  test("#given an event below the task epoch #when emitted #then it is dropped and never touches the sink", () => {
    // given
    const seen: RepairLifecycleEvent[] = [];
    const stale: RepairLifecycleEvent = { type: "files_modified", ...baseFields({ runEpoch: 0 }), changedFiles: ["a.ts"] };

    // when
    const emitted = emitRepairLifecycleEvent((e) => seen.push(e), stale, { currentRunEpoch: 1, cancelled: false });

    // then
    expect(emitted).toBe(false);
    expect(seen).toHaveLength(0);
    expect(isStaleRepairLifecycleEvent(stale, { currentRunEpoch: 1, cancelled: false })).toBe(true);
  });

  test("#given a cancelled task #when a current-epoch event is emitted #then it is dropped as a stale-attempt event", () => {
    // given
    const seen: RepairLifecycleEvent[] = [];
    const event: RepairLifecycleEvent = { type: "repair_started", ...baseFields({ runEpoch: 2 }), failedCheckIds: ["unit-a"] };

    // when
    const emitted = emitRepairLifecycleEvent((e) => seen.push(e), event, { currentRunEpoch: 2, cancelled: true });

    // then: a cancelled task's stale attempt must never overwrite newer state
    expect(emitted).toBe(false);
    expect(seen).toHaveLength(0);
  });

  test("#given a late stale callback after the epoch moved on #when emitted #then newer state is untouched", () => {
    // given: the sink would overwrite newer state if it ran
    let state = "newer-epoch-state";
    const stale: RepairLifecycleEvent = { type: "reverification_completed", ...baseFields({ runEpoch: 0 }), verification: "verified" };

    // when
    const emitted = emitRepairLifecycleEvent(
      () => {
        state = "overwritten-by-stale";
      },
      stale,
      repairLifecycleGateForTask({
        notification: { run_epoch: 1 },
        status: "error",
      }),
    );

    // then
    expect(emitted).toBe(false);
    expect(state).toBe("newer-epoch-state");
  });

  test("#given a task snapshot #when the gate is derived #then cancelled and killed tasks gate every event as stale", () => {
    // given + when
    const live = repairLifecycleGateForTask({ notification: { run_epoch: 3 }, status: "running" });
    const cancelled = repairLifecycleGateForTask({ notification: { run_epoch: 3 }, status: "cancelled" });
    const cancelRequested = repairLifecycleGateForTask({
      notification: { run_epoch: 3 },
      status: "running",
      cancel_requested: { requested_at: "now" },
    });
    const event: RepairLifecycleEvent = { type: "diagnosis_started", ...baseFields({ runEpoch: 3 }) };

    // then
    expect(isStaleRepairLifecycleEvent(event, live)).toBe(false);
    expect(isStaleRepairLifecycleEvent(event, cancelled)).toBe(true);
    expect(isStaleRepairLifecycleEvent(event, cancelRequested)).toBe(true);
  });
});

describe("completion repair outcome derivation", () => {
  test("#given repaired attempt plus verified gate #when derived #then repaired_and_verified", () => {
    // given + when
    const outcome = deriveRepairOutcomeForCompletion({ gateVerdict: "verified", attemptState: "repaired", attemptId: "st_repair1.e0.r1" });

    // then
    expect(outcome?.status).toBe("repaired_and_verified");
    expect(outcome?.gateVerdict).toBe("verified");
    expect(outcome?.attemptState).toBe("repaired");
  });

  test("#given repaired attempt plus blocked gate #when derived #then edited_but_blocked, never verified", () => {
    // given + when
    const outcome = deriveRepairOutcomeForCompletion({ gateVerdict: "blocked", attemptState: "repaired" });

    // then: the MUST invariant - a repaired state with a non-verified verdict never reports verified
    expect(outcome?.status).toBe("edited_but_blocked");
    expect(outcome?.status).not.toBe("repaired_and_verified");
  });

  test("#given repaired attempt plus unverified gate #when derived #then repaired_but_unverified", () => {
    // given + when
    const outcome = deriveRepairOutcomeForCompletion({ gateVerdict: "unverified", attemptState: "repaired" });

    // then
    expect(outcome?.status).toBe("repaired_but_unverified");
  });

  test("#given failed and cancelled attempts #when derived #then repair_failed and repair_cancelled", () => {
    // given + when
    const failed = deriveRepairOutcomeForCompletion({ gateVerdict: "blocked", attemptState: "repair_failed", reason: "reverification_blocked" });
    const cancelled = deriveRepairOutcomeForCompletion({ gateVerdict: "blocked", attemptState: "repair_cancelled" });
    const cancelledFlag = deriveRepairOutcomeForCompletion({ gateVerdict: "blocked", cancelled: true });

    // then
    expect(failed?.status).toBe("repair_failed");
    expect(cancelled?.status).toBe("repair_cancelled");
    expect(cancelledFlag?.status).toBe("repair_cancelled");
  });

  test("#given repaired attempt with no gate verdict #when derived #then never verified", () => {
    // given: no gate verdict means no authority to claim verified
    const outcome = deriveRepairOutcomeForCompletion({ attemptState: "repaired" });

    // when + then
    expect(outcome).not.toBeUndefined();
    expect(outcome?.status).not.toBe("repaired_and_verified");
    expect(outcome?.status).toBe("edited_but_blocked");
  });

  test("#given no attempt #when derived #then undefined (no repair outcome carried)", () => {
    // given + when
    const outcome = deriveRepairOutcomeForCompletion({ gateVerdict: "verified" });

    // then
    expect(outcome).toBeUndefined();
  });

  test("#given a repaired_and_verified completion #when details built #then repair_outcome is carried and rendered for the parent", () => {
    // given
    const record = completedRecord({ verification_status: "verified" });

    // when
    const details = buildCompletionDetails(record, {
      repair: { attemptState: "repaired", attemptId: "st_repair1.e0.r1" },
    });
    const line = completionMessageLines([details]).join("\n");

    // then
    expect(details.repair_outcome?.status).toBe("repaired_and_verified");
    expect(line).toContain("repair:repaired_and_verified");
  });

  test("#given a repaired attempt with a blocked gate #when details built #then edited_but_blocked is carried, never verified", () => {
    // given
    const record = completedRecord({ status: "error", verification_status: "blocked" });

    // when
    const details = buildCompletionDetails(record, {
      repair: { attemptState: "repaired", attemptId: "st_repair1.e0.r1" },
    });

    // then
    expect(details.repair_outcome?.status).toBe("edited_but_blocked");
    expect(details.repair_outcome?.status).not.toBe("repaired_and_verified");
  });
});
