import type { IsolationDetails } from "../isolation/details"
import type { RepairState } from "../repair/state"
import type { ResolvedModelRecord, TaskRecord, TaskRunStats, TaskStatus } from "../state"
import type { ListTaskRecordsResult, PersistedTaskEvent } from "../store"
import type { VerificationStatus } from "../verification/completion-status"

export type TransitionReason = "compacting" | "session_switching" | "session_shutdown"

// The live parent-session state the completion push routes against (plan-consultant finding #3).
export type ParentState =
  | { readonly kind: "idle" }
  | { readonly kind: "streaming" }
  | { readonly kind: "compacting" }
  | { readonly kind: "session_switching" }
  | { readonly kind: "session_shutdown" }

export type RoutingDecision =
  | { readonly kind: "wake" }
  | { readonly kind: "deliver_streaming" }
  | { readonly kind: "buffer"; readonly reason: TransitionReason }

// The repair outcome carried on a completion notification. The five statuses are exhaustive:
// - "repaired_and_verified": the persisted attempt reached "repaired" AND the gate verdict is "verified".
// - "edited_but_blocked": the gate verdict is "blocked" (a "repaired" attempt with a non-"verified"
//   verdict reports this, never verified).
// - "repaired_but_unverified": the gate verdict is "unverified" after a repair ran.
// - "repair_failed": the persisted attempt settled as "repair_failed".
// - "repair_cancelled": the persisted attempt settled as "repair_cancelled" (or the repair was
//   cancelled). Derived ONLY from the gate verdict plus the persisted attempt state in
//   notification.ts, never from a model claim or a repair state alone.
export type RepairOutcomeStatus =
  | "repaired_and_verified"
  | "edited_but_blocked"
  | "repaired_but_unverified"
  | "repair_failed"
  | "repair_cancelled"

export type RepairOutcomeForCompletion = {
  readonly status: RepairOutcomeStatus
  readonly gateVerdict?: VerificationStatus
  readonly attemptState?: RepairState
  readonly attemptId?: string
  readonly reason?: string
}

export type CompletionDetails = {
  readonly task_id: string
  readonly name: string
  readonly status: TaskStatus
  readonly category?: string
  readonly agent_type?: string
  readonly model: string
  readonly requested_model?: ResolvedModelRecord
  readonly fallback_models?: readonly ResolvedModelRecord[]
  readonly resolved_model?: ResolvedModelRecord
  readonly duration_ms: number
  readonly tokens?: number
  readonly run_stats?: TaskRunStats
  readonly final_response: string
  readonly final_response_file?: string
  // The gate's claim about this completion, carried so the parent agent cannot read a finished run as
  // verified when nothing was verified. Absent means the record predates the claim; a completed run
  // with no claim is reported as unverified, never as verified.
  readonly verification_status?: VerificationStatus
  readonly continuation_hint: string
  // The repair outcome for this completion, when a repair attempt ran. Absent when no repair ran.
  // The parent agent reads `status` plus the rendered `repair:<status>` token in the message body.
  readonly repair_outcome?: RepairOutcomeForCompletion
  // The child resumed on its own (a monitor or background job woke it) after an earlier completion.
  readonly resumed_turn?: true
  // Present once an isolated child settled: what happened to its clone and where the artifacts are.
  readonly isolation?: IsolationDetails
  // Present only when the completed task was a DAG node child, so the parent can address the exact
  // node it must re-verify or correct.
  readonly dag?: {
    readonly run_id: string
    readonly node_id: string
  }
}

// Structurally compatible with senpi sendMessage(Pick<CustomMessage,"customType"|"content"|"display"|
// "details">, {triggerTurn, deliverAs}). One message carries one or many completions (batching).
// Delivery is UNCONDITIONAL STEER: every delivered notification triggers a turn and steers into the
// running turn at the next tool-call boundary; the adapter batches all ready messages into ONE steer.
export type ParentNotifierMessage = {
  readonly customType: "senpi-task.completion"
  readonly content: string
  readonly display: boolean
  readonly details: readonly CompletionDetails[]
  readonly triggerTurn?: boolean
}

// SYNCHRONOUS enqueue seam. senpi pi.sendMessage returns void and swallows async delivery errors, so
// a synchronous throw from enqueue is the adapter's immediate failure signal. The adapter batches, so
// a returning enqueue only means QUEUED: a later failure (failed flush, or a batch window dropped by
// session shutdown) is reported out-of-band through recordDeliveryFailure.
export type ParentNotifier = {
  enqueue(message: ParentNotifierMessage): void
}

export type CompletionNotifierStore = {
  readonly load: (taskId: string) => TaskRecord | null
  readonly list: () => ListTaskRecordsResult
  readonly replace: (record: TaskRecord) => void
  // Locked re-read + conditional write. Notification bookkeeping MUST go through this so a
  // concurrent residency/host_pid claim is never erased by a stale whole-record replace.
  readonly mutate: (taskId: string, mutation: (record: TaskRecord) => TaskRecord) => TaskRecord | null
  readonly appendEvent: (taskId: string, event: PersistedTaskEvent) => string
}

export type CompletionRetrySchedule = (fn: () => void, delayMs: number) => () => void

export type CompletionNotifierDeps = {
  readonly notifier: ParentNotifier
  readonly store: CompletionNotifierStore
  readonly stateDir?: string
  readonly schedule?: CompletionRetrySchedule
  readonly getParentState?: () => ParentState
  readonly getCurrentSessionId?: () => string | undefined
}

export type CompletionRequest = {
  readonly record: TaskRecord
  readonly parentState: ParentState
  readonly runInBackground: boolean
  readonly tokens?: number
}

export type SkipReason = "sync-task" | "non-notifying-terminal" | "not-terminal" | "already-notified"

export type DeliveredDecision = "wake" | "deliver_streaming"

export type NotifyResult =
  | { readonly kind: "skipped"; readonly reason: SkipReason }
  | { readonly kind: "delivered"; readonly decision: DeliveredDecision }
  | { readonly kind: "buffered"; readonly reason: TransitionReason }
  | { readonly kind: "failed" }

export type FlushInput = {
  readonly sessionId: string
  readonly replaced: boolean
}

export type ReconcileUnnotifiedNotificationsInput = {
  readonly sessionId: string
  readonly parentState: ParentState
}

export type RecordDeliveryFailureInput = {
  readonly taskIds: readonly string[]
  readonly error: unknown
}

export type FlushResult =
  | { readonly kind: "flushed"; readonly count: number }
  | { readonly kind: "dropped"; readonly count: number }
  | { readonly kind: "failed"; readonly count: number }
  | { readonly kind: "empty" }

export type CompletionNotifier = {
  notifyTerminal(request: CompletionRequest): NotifyResult
  /**
   * Out-of-band receipt for a notification the adapter accepted but never delivered (its idle-injection
   * flush failed, or the batch window was dropped when the coordinator retired on session shutdown).
   * `notified_epoch` was already persisted by the accepting enqueue, so it is rolled back below the
   * epoch and `notification_failed_epoch` is stamped: without that rollback
   * `reconcileUnnotifiedNotifications` skips the record forever and the parent never learns its
   * background task finished.
   */
  recordDeliveryFailure(input: RecordDeliveryFailureInput): void
  flushBuffered(input: FlushInput): FlushResult
  reconcileUnnotifiedNotifications(input: ReconcileUnnotifiedNotificationsInput): void
  /** Thin alias of reconcileUnnotifiedNotifications for the pre-rename omo-senpi caller (todo 18). */
  reconcileFailedNotifications(input: ReconcileUnnotifiedNotificationsInput): void
  bufferedCount(sessionId: string): number
}
