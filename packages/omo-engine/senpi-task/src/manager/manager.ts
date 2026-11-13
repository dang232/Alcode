import { createHash } from "node:crypto"
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { log } from "../../../utils/src/index.ts"

import type { DagTaskOwner, DagTaskOwnerKey, OwnedStartResult } from "../dag/owner"
import type { DagNodeId, DagRunId } from "../dag/types"
import { endFallbackHandoff, forgetClosedChild, handOffToNextRung, isFallbackHandoff } from "../lifecycle/fallback-handoff"
import { registerLifecycleReattachPorts, type ReattachResult, type RespawnResult } from "../lifecycle/port"
import { RunnerError } from "../runners/in-process/runner-error"
import { RpcProcessRunner } from "../runners/rpc-process"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import { createTaskRecord, isSpawnSpecV1, nextRunEpoch, parseTaskId, syncTaskIdFloor, transitionTaskRecord } from "../state"
import { resolvedReasoningFields } from "../state/resolved-reasoning"
import { TaskIdSpaceExhaustedError } from "../state/id"
import type { ResolvedModelRecord, TaskRecord, TaskRunStats, TaskTransition, TaskTransitionResult } from "../state"
import { reopenSelfResumedTurn, type SelfResumedTurnPorts } from "./self-resumed-turn"
import { createSteeringEngine } from "../steering"
import type { CancelOptions, CancelOutcome, DestructionPort, InterruptOutcome, SendInput, SendOutcome, SteeringEngine, SteeringPort } from "../steering"
import { discardManagedHandle, releaseOnDispose, releaseSupersededHandle, type ManagedChildHandle, type ManagedChildListener } from "./child-handle"
import { TaskConcurrency } from "./concurrency"
import { failOwnedRun, launchRunOf, ownsRun } from "./launch-fence"
import { runtimeFallbackCandidates } from "./credential-failure"
import { createWorkpoolAdmission } from "./workpool-admission"
import { withResidentStart } from "./resident-start"
import { createWorkpoolEngine, type WorkpoolEngine } from "../workpool/engine"
import { CURATED_READONLY_AGENT_NAMES } from "../agents/builtin"
import { createWorkpoolWorkerTool } from "../tools/workpool"
import { approvalAuthorityFor } from "../verification/approval-authority"
import { readApprovals } from "../verification/approval-store"
import { resolveCatalogue, WORKSPACE_ID } from "../verification/resolution"
import { runRepairAttempt, type RepairDiagnosisInvoker as RepairAttemptInvoker, type RepairEditExecutor } from "../repair/orchestrator"
import { applyRepairEdits } from "../repair/edit-executor"
import { createHostDiagnosisInvoker } from "../repair/model-diagnosis"
import { createFileEvidenceStore, workspaceRevision } from "../verification/evidence-store"
import { isVerificationAccepting, parseVerificationRecord, runVerificationCommand, type DagVerificationRecord, type DagVerifyCheck } from "../dag/verification"
import type { VerificationRunner } from "../verification/contract"
import type { ChildSpec } from "../runners/in-process"
import { evaluateOrdinaryCompletion, type CompletionGatePreconditions } from "../verification/completion-gate"
import { completionBlockedMessage, type CompletionGateVerdict, type VerificationStatus } from "../verification/completion-status"
import { catalogueChecks, type OrdinaryCatalogue } from "../verification/catalogue"
import { createOrdinaryVerificationCapture } from "../verification/ordinary-capture"
import {
  deleteDelegatedVerificationIntent,
  listDelegatedVerificationIntents,
  verificationIntentPath,
  writeDelegatedVerificationIntent,
  type DelegatedVerificationIntent,
} from "../verification/intents"
import { changedPathsSince, snapshotWorkspace, type WorkspaceBaseline } from "../verification/run-provenance"
import { admitSpill } from "./spill-admission"
import { buildEngineeringDelegationPlan, collectDelegationResults, type DelegationNodeOutcome, type DelegationPlan, type DelegationPlanRejection } from "../delegation/plan"
import {
  compareDelegationNodeSets,
  DelegationRunError,
  type DelegationUnresolvedReason,
  type EngineeringDelegationDeadlineUnavailable,
  type EngineeringDelegationRunCompletion,
} from "../delegation/run"
import { decideDepthPolicy } from "./depth-policy"
import { onceOnly } from "./once-only"
import { ResidencySignal } from "./residency-signal"
import { resolveExecutionMode, type ExecutionMode } from "./execution-mode"
import { toContinueResult } from "./continue-result"
import {
  childIdentityOf,
  hasChildIdentity,
  type ChildIdentity,
  buildManagedSpec,
  buildRecordInput,
  buildSpawnSpecV1,
  inSession,
  isTerminalRecord,
  memberKernelToolRefusal,
  nowIso,
  promotedBackgroundMode,
  recordSpawnedChildSession,
  recordSpawnedPid,
  recordSpawnedRunner,
} from "./manager-helpers"
import { createIsolationWiring, type IsolationWiring } from "./isolation-wiring"
import type { IsolationPreparation } from "../isolation"
import { createOutcomeTracker, type OutcomeTracker } from "./manager-outcome"
import { claimTaskRecord, TaskRecordCollisionError } from "../store"
import { withTaskRecordLockAsync } from "../store/record-lock"
import { reattachManagedTask } from "./manager-reattach"
import { PendingStops } from "./pending-stops"
import { respawnWithWorkpool } from "./workpool-respawn"
import { NameRegistry } from "./names"
import { TaskSequence } from "./task-sequence"
import { createRunStatsTracker, type RunStatsTracker } from "../run-stats"
import { subscribeChildFacts } from "./child-facts"
import type {
  ContinueResult,
  DelegatedVerificationResumeOutcome,
  ListScope,
  ListedTask,
  ManagedRunner,
  ManagedStartSpec,
  ManagerAdmissionPort,
  ManagerDelegatedStartResult,
  ManagerDelegationSpec,
  ManagerDelegationStartRequest,
  ManagerDelegationStartResult,
  ManagerStartSpec,
  ResolvedChildPlan,
  StartResult,
  TaskManager,
  TaskManagerOptions,
} from "./types"
import { describeStartFailure } from "./start-failure"

type PreparedIsolation = Extract<IsolationPreparation, { readonly ok: true }>

type LiveTask = {
  readonly handle: ManagedChildHandle
  readonly model: string
  readonly unsubscribe: () => void
  readonly managedSpec?: ManagedStartSpec
  readonly runner?: ManagedRunner
}

type LaunchContext = {
  readonly record: TaskRecord
  readonly managedSpec: ManagedStartSpec
  readonly runner: ManagedRunner
  readonly model: string
}

type DelegationObservation =
  | {
      readonly outcomes: readonly DelegationNodeOutcome[]
      readonly unresolved: false
      readonly unresolvedReason: undefined
      readonly missingNodeIds: readonly []
      readonly foreignNodeIds: readonly []
    }
  | {
      readonly outcomes: readonly DelegationNodeOutcome[]
      readonly unresolved: true
      // A record that could not be read is its own reason; a settled record names the set mismatch.
      readonly unresolvedReason: DelegationUnresolvedReason
      readonly missingNodeIds: readonly DagNodeId[]
      readonly foreignNodeIds: readonly DagNodeId[]
    }

// A settled run plus its observation. Structurally assignable to the run seam's completion, so the
// ordinary fold keeps receiving exactly the fields it already used.
type DelegationSettled = DelegationObservation & {
  readonly ok: true
  readonly runId: DagRunId
}

// The plan builder brands node ids and the definition widens them back to string for persistence.
// The brand carries no runtime value, so a non-empty persisted id restores exactly the value the
// plan builder produced; an empty one could never have been a plan node.
function plannedNodeIdsFromPersisted(values: readonly string[]): readonly DagNodeId[] {
  return values.filter((value): value is DagNodeId => value.length > 0)
}

// Every way the host-side capture can end before a check runs, named. These used to be five
// indistinguishable `return`s, which forced the gate to describe an attribution failure as a
// worker-shaped "no evidence". The outcome is telemetry for the event that follows; the gate
// remains the only judge of acceptance.
type DelegatedCaptureCode =
  | "captured"
  | "catalogue_not_configured"
  | "no_approved_checks"
  | "baseline_unavailable"
  | "parent_missing"
  | "change_scope_unavailable"
  | "capture_failed"

type DelegatedCaptureSelection = {
  readonly required: number
  readonly omitted: number
}

type DelegatedCaptureOutcome = {
  readonly code: DelegatedCaptureCode
  readonly evidenceRoot: string
  readonly records: readonly DagVerificationRecord[]
  readonly receiptPath: string | null
  readonly dagRunId: string
  readonly catalogueStatus: OrdinaryCatalogue["status"]
  readonly selection: DelegatedCaptureSelection
  readonly detail?: string
}

// The payload the existing verification events carry. `code`/`reason` keep their old meaning; the
// capture fields say WHY the host produced no evidence when it produced none, instead of leaving
// the gate's generic "missing" as the only story.
type VerificationEventPayload = {
  readonly code?: CompletionGateVerdict["code"]
  readonly reason?: string
  readonly verification_status: VerificationStatus
  readonly capture_outcome: DelegatedCaptureCode
  readonly evidence_root: string
  readonly records: number
  readonly receipt_path: string | null
  readonly dag_run_id: string
  readonly catalogue_status: OrdinaryCatalogue["status"]
  readonly selection: DelegatedCaptureSelection
  readonly capture_detail?: string
}

// How the terminal fold ended. A deadline that elapses during the host-side capture is reported
// separately so the caller receives the typed refusal instead of reading a failed parent as a
// delegated success.
type DelegatedFoldOutcome =
  | { readonly kind: "folded" }
  | { readonly kind: "deadline"; readonly budgetMs: number }

// Whether a deadline actually stopped the run. The three cases are reported verbatim: a port with
// no cancel never gets read as a cancellation, and a throwing cancel is a failure, not a stop.
type AdmissionCancelOutcome = "cancelled" | "unavailable" | "failed"

type DeadlineTimer = {
  readonly budgetMs: number
  readonly expired: Promise<{ readonly kind: "deadline"; readonly budgetMs: number }>
  // The deadline elapsed. The verification capture reads this so a check that has not started yet
  // is skipped; a check already running still reports `cancelled` and can never be read as a pass.
  readonly elapsed: () => boolean
  readonly clear: () => void
}

// The fenced terminal write reports both the transition audit and the record it published. A
// named owner contract keeps the binding's type explicit without discarding evidence at the use.
type FencedTerminal = {
  audit?: TaskTransitionResult["audit"]
  terminal?: TaskRecord
}

// Every way the admission drive can end: a settled run, a run-scoped deadline, or a deadline that
// elapsed before the port reported any run identity to fence the refusal to.
type DelegationDriveResult =
  | DelegationSettled
  | EngineeringDelegationDeadlineUnavailable
  | Extract<ManagerDelegationStartResult, { readonly kind: "delegation_start_failed" }>

type TaskWaiter = {
  readonly resolve: (record: TaskRecord) => void
  readonly reject: (reason: unknown) => void
  readonly cleanup: () => void
}

type RepairEligibility = {
  readonly eligible: boolean
  readonly reason: string
}

type RepairEvidenceCollection = {
  readonly failedCheckIds: readonly string[]
  readonly failedEvidenceIds: readonly string[]
}

type RepairFinishedPayload = {
  readonly reason: string
  readonly attempt_id: string
  readonly final_state: string
  readonly gate_verdict: string
  readonly verification_status: VerificationStatus
  readonly changed_files: readonly string[]
  readonly gate_code?: string
  readonly detail?: string
}

type RpcRespawnRunner = {
  start(spec: RpcRunnerSpec): Promise<RpcChildHandle>
}

type TaskManagerImplOptions = TaskManagerOptions & {
  readonly rpcRespawnRunner?: RpcRespawnRunner
}

type LaunchOutcome =
  | { readonly ok: true; readonly run_epoch?: number; readonly resolved_model?: ResolvedModelRecord; readonly queue_position?: number }
  | {
    readonly ok: false
    readonly error: string
    readonly failure_kind?: Extract<StartResult, { kind: "start_failed" }>["failure_kind"]
    readonly failure_reason?: Extract<StartResult, { kind: "start_failed" }>["failure_reason"]
  }

type ReattachingTaskManager = Omit<TaskManager, "start"> & {
  readonly workpools: WorkpoolEngine
  // Required on the concrete manager: the late-binding seam is how the composition root installs a
  // port after construction, so a caller never has to probe for it. `TaskManager` keeps it optional
  // for structural fakes.
  setAdmissionPort(port: ManagerAdmissionPort): void
  // The ordinary start() path accepts a delegated request (a spec carrying objective/roles) and
  // owns the whole run. The non-delegated signature keeps every existing caller unchanged.
  start(spec: ManagerStartSpec & { readonly delegation: ManagerDelegationSpec }): Promise<ManagerDelegatedStartResult>
  start(spec: ManagerStartSpec): Promise<StartResult>
  startDelegated(request: ManagerDelegationStartRequest): Promise<ManagerDelegationStartResult>
  respawn(record: TaskRecord, resumeSessionPath?: string): Promise<RespawnResult>
  reattach(record: TaskRecord, handle: ManagedChildHandle): Promise<ReattachResult>
  waiterKeyCount(): number
  releasedKeyCount(): number
}

const NOOP_DESTRUCTION: DestructionPort = { destroyResidentTask: () => Promise.resolve() }

// The deadline reason text is part of the result a caller reads, so it states which cancel outcome
// actually happened rather than a generic "deadline" claim.
const DEADLINE_CANCEL_REASON = {
  cancelled: "the run was cancelled through the admission port, so no admitted child is left running",
  unavailable: "the admission port exposes no run cancel, so the run was left running rather than reported as completed",
  failed: "the admission port's run cancel failed, so the run may still be running",
} satisfies Readonly<Record<AdmissionCancelOutcome, string>>

function admissionUnavailable(): Extract<ManagerDelegationStartResult, { readonly kind: "admission_unavailable" }> {
  return {
    kind: "admission_unavailable",
    reason: "admission_unavailable",
    message:
      "a delegated start requires an admission port supplied through TaskManagerOptions.admission " +
      "or setAdmissionPort before the first delegated start",
  }
}

function delegationPlanRejected(
  plan: DelegationPlanRejection,
): Extract<ManagerDelegationStartResult, { readonly kind: "delegation_plan_rejected" }> {
  return {
    kind: "delegation_plan_rejected",
    code: plan.code,
    message: plan.message,
    roleKeys: plan.roleKeys,
  }
}

// The public delegated seam must not answer a success-shaped `delegated` with no cause when the
// run record is unreadable or its terminal node set is not this plan's result. The message names
// the actual condition and ids; the ordinary start path still folds and fails the parent instead.
function unresolvedDelegationMessage(
  driven: Extract<DelegationSettled, { readonly unresolved: true }>,
): string {
  if (driven.unresolvedReason === "run_record_unreadable") {
    return `delegated run ${driven.runId} did not settle: its run record could not be read, so no node outcome is reported`
  }
  const parts: string[] = []
  if (driven.missingNodeIds.length > 0) {
    parts.push(`planned node(s) ${driven.missingNodeIds.join(", ")} had no terminal outcome`)
  }
  if (driven.foreignNodeIds.length > 0) {
    parts.push(`unplanned node(s) ${driven.foreignNodeIds.join(", ")} produced an outcome`)
  }
  return `delegated run ${driven.runId} did not settle: ${parts.join("; ")}`
}

function ownerLockPath(stateDir: string, owner: DagTaskOwnerKey): string {
  const ownerKey = `${owner.kind}\0${owner.runId}\0${owner.nodeId}`
  const digest = createHash("sha256").update(ownerKey).digest("hex")
  const ownerDir = join(stateDir, "owner-locks")
  mkdirSync(ownerDir, { recursive: true })
  return join(ownerDir, digest)
}


// allow: SIZE_OK - one stateful manager keeps concurrency, queue, live-handle, and waiter invariants in one closure-backed implementation.
class TaskManagerImpl implements TaskManager {
  readonly workpools: WorkpoolEngine
  readonly #options: TaskManagerImplOptions
  // Construction-time port, replaceable by setAdmissionPort before the first delegated start. It is
  // deliberately not on `#options` after construction: the composition root builds this manager
  // first and only then has a DAG runtime to wrap, and the port must call back into this manager.
  #admission: ManagerAdmissionPort | undefined
  readonly #now: () => number
  readonly #runStats = new Map<string, RunStatsTracker>()
  readonly #hostPid: number
  readonly #concurrency: TaskConcurrency
  readonly #rpcRespawnRunner: RpcRespawnRunner
  readonly #names = new NameRegistry()
  readonly #taskSequence = new TaskSequence()
  readonly #live = new Map<string, LiveTask>()
  // Spawn-time catalogue per ordinary child: the completion gate's immutable required set.
  readonly #verificationCatalogue = new Map<string, OrdinaryCatalogue>()
  // Spawn-time workspace baseline per ordinary child: the host's attribution of the change set the
  // completion capture runs against. Null is a real value (an unattributable tree) and must stay
  // distinguishable from "this run has no snapshot", so the read uses has()/get() together.
  readonly #verificationBaseline = new Map<string, WorkspaceBaseline | null>()
  // Repair attempts in flight, keyed by task id to the run_epoch they were started for. Exactly
  // one attempt runs per (task, epoch): a second blocked completion for the same epoch reuses
  // the guard instead of starting a second model call. Cleared on settle and on forget().
  readonly #repairInFlight = new Map<string, number>()
  // Children whose teardown rejected and that have no pid or daemon session for the orphan path. They
  // are resident for the lifecycle (eviction, idle reclaim, shutdown and TTL see them and retry their
  // teardown) but are not live children: steering never reaches them, and only a teardown that
  // succeeds releases them.
  readonly #cleanupOwners = new Map<string, ManagedChildHandle>()
  readonly #nativeFallbackExhaustions = new WeakSet<ManagedChildHandle>()
  // Callers can subscribe before a queued task owns a handle. Each entry is attached exactly once
  // when #launch promotes it, and its returned cleanup owns both pending and live subscriptions.
  readonly #childSubscribers = new Map<string, Map<ManagedChildListener, () => void>>()
  // Release guard: latest released run_epoch per task_id. A revived task (higher epoch) can still
  // release its LATER occupancy, while a stale re-release of an already-released epoch is a no-op.
  // Keyed by task_id (not `${taskId}:${epoch}`) so growth is bounded by live tasks and forget()
  // prunes in O(1).
  readonly #released = new Map<string, number>()
  // Epoch of a failed rung whose child is still closing under a handoff. Its record already names the
  // next epoch, so the lease the live handle holds is looked up here, not on the record.
  readonly #closingRungs = new Map<string, { readonly epoch: number; readonly handle: ManagedChildHandle }>()
  readonly #waiters = new Map<string, TaskWaiter[]>()
  readonly #background = new Set<string>()
  readonly #evicting = new Set<string>()
  readonly #sendCounts = new Map<string, number>()
  readonly #stopsPending = new PendingStops()
  readonly #steering: SteeringEngine
  readonly #isolation: IsolationWiring
  readonly #outcome: OutcomeTracker
  readonly #residency = new ResidencySignal()

  constructor(options: TaskManagerImplOptions) {
    this.#options = options
    this.#admission = options.admission
    try {
      const listed = options.store.list()
      if (listed.diagnostics.length > 0) {
        log("senpi-task manager task record diagnostics while seeding id floor", { count: listed.diagnostics.length })
      }
      const maxId = listed.records.reduce<string | undefined>(
        (maximum, record) => (maximum === undefined || record.task_id > maximum ? record.task_id : maximum),
        undefined,
      )
      if (maxId !== undefined) syncTaskIdFloor(parseTaskId(maxId))
    } catch (error) {
      log("senpi-task manager failed to seed task id floor", { error: String(error) })
    }
    this.#now = options.now ?? Date.now
    this.#hostPid = options.hostPid ?? process.pid
    this.#rpcRespawnRunner = options.rpcRespawnRunner ?? new RpcProcessRunner()
    this.#concurrency = options.concurrency ?? new TaskConcurrency({
      default_concurrency: options.config.default_concurrency,
      ...(options.config.provider_concurrency !== undefined && { provider_concurrency: options.config.provider_concurrency }),
      ...(options.config.model_concurrency !== undefined && { model_concurrency: options.config.model_concurrency }),
      ...(options.config.global_concurrency !== undefined && { global_concurrency: options.config.global_concurrency }),
    })
    const port: SteeringPort = {
      store: options.store,
      tryBeginSend: (taskId) => this.tryBeginSend(taskId),
      endSend: (taskId) => this.endSend(taskId),
      isEvicting: (taskId) => this.isEvicting(taskId),
      // A rung that runtime fallback is closing is never steered, interrupted through, or revived: its
      // handle is being torn down, and the fallback path retires it once the close ends.
      liveHandle: (taskId) => {
        const handle = this.#live.get(taskId)?.handle
        return handle !== undefined && this.#closingRungs.get(taskId)?.handle === handle ? undefined : handle
      },
      dequeuePending: (taskId) => {
        const rec = this.#tryLoad(taskId)
        if (rec === null || rec === undefined) return false
        const removed = this.#concurrency.remove(rec.model, taskId)
        this.#background.delete(taskId)
        this.#settleWaiters(taskId)
        return removed
      },
      reserveForRevive: (taskId) => this.#reserveForRevive(taskId),
      reserveForDetachedRevive: (record) => this.#reserveForDetachedRevive(record),
      destruction: options.destruction ?? NOOP_DESTRUCTION,
      runStatsSnapshot: (taskId) => this.#runStats.get(taskId)?.snapshot(this.#now()),
      stopRequested: (taskId) => this.#stopsPending.request(taskId),
      releaseTaskLeases: (taskId) => this.#concurrency.releaseTask(taskId),
      stopSettled: (taskId) => {
        this.#concurrency.releaseTask(taskId)
        this.#settleWaiters(taskId)
        this.#stopsPending.settle(taskId)
      },
      now: this.#now,
    }
    this.#steering = createSteeringEngine(port)
    this.#isolation = createIsolationWiring({
      runtime: options.isolation,
      store: options.store,
      cwd: options.cwd,
      hostPid: this.#hostPid,
      config: options.config,
    })
    this.#outcome = createOutcomeTracker({
      store: options.store,
      settleIsolation: (taskId, merge) => this.#isolation.settle(taskId, merge),
      now: this.#now,
      liveHandle: (taskId) => this.#live.get(taskId)?.handle,
      tryLoad: (taskId) => this.#tryLoad(taskId),
      runStatsSnapshot: (taskId) => this.#runStats.get(taskId)?.snapshot(this.#now()),
      releaseSlot: (taskId, model, epoch) => this.#releaseSlot(taskId, model, epoch),
      forget: (taskId) => this.forget(taskId),
      settleWaiters: (taskId, terminal) => this.#settleWaiters(taskId, terminal),
      tryRuntimeFallback: (input) => this.#tryRuntimeFallback(input),
      stopSettlement: (taskId) => this.#stopsPending.settlement(taskId),
      // The ordinary-completion gate: consulted before any 'completed' is published.
      verifyCompletion: (taskId, owned) => this.#verifyOrdinaryCompletion(taskId, owned),
    })
    this.workpools = createWorkpoolEngine(options.store.stateDir, createWorkpoolAdmission({
      options, concurrency: this.#concurrency, hostPid: this.#hostPid,
      get: taskId => this.get(taskId), pending: taskId => this.hasPendingSends(taskId),
      cancel: taskId => this.cancelTask(taskId), waitFor: (taskId, signal) => this.waitFor(taskId, { signal }),
      nextSequence: parent => this.#taskSequence.next(parent), launch: context => this.#launch(context),
      revive: (record, message, reservation) => this.#steering.sendToTask({ idOrName: record.task_id, message, callerSessionId: record.parent_session_id }, reservation),
      trackRevive: (taskId, epoch) => {
        const live = this.#live.get(taskId)
        if (live === undefined) throw new Error("Granted workpool worker lost its live handle")
        this.#runStats.set(taskId, createRunStatsTracker(this.#now(), this.#now))
        this.#outcome.trackOutcome(taskId, live.handle, live.model, epoch)
      },
      workerTools: taskId => [createWorkpoolWorkerTool({ workpools: this.workpools, taskId, runEpoch: () => this.get(taskId)?.notification.run_epoch ?? -1 })],
      ...(options.kernelToolBindings === undefined ? {} : { kernelToolBindings: options.kernelToolBindings }),
    }), options.kernelToolBindings)
    registerLifecycleReattachPorts(options.store, {
      reserve: (record) => this.#reserveForReattach(record),
      respawn: (record, resumeSessionPath) => this.respawn(record, resumeSessionPath),
      reattach: (record, handle) => this.reattach(record, handle),
    })
  }

  async start(spec: ManagerStartSpec & { readonly delegation: ManagerDelegationSpec }): Promise<ManagerDelegatedStartResult>
  async start(spec: ManagerStartSpec): Promise<StartResult>
  async start(spec: ManagerStartSpec): Promise<StartResult | ManagerDelegatedStartResult> {
    const refused = memberKernelToolRefusal(spec)
    if (refused !== undefined) return refused
    // The ordinary path is untouched: only a spec that carries a delegation request branches. A
    // delegated parent is a coordinator, not a spawned child, so it deliberately does NOT take a
    // residency slot (a 1-slot cap would otherwise deadlock the nodes it admits).
    if (spec.delegation !== undefined) return this.#startDelegatedSpec(spec, spec.delegation)
    const resolution = this.#options.planner(spec)
    if (resolution.kind === "error") return { kind: "plan_unresolved", error: resolution.error }

    return withResidentStart(this.#options, spec.parent_session_id,
      release => this.#startResolved(spec, resolution.plan, undefined, release))
  }

  // Late-bound admission seam (p27 todo 7). The composition root constructs this manager before the
  // DAG runtime exists, and the port it installs drives delegated starts through this same manager's
  // startOwned; taking the port at construction would therefore need the manager before it exists.
  // The setter only replaces the reference: it creates no run, scheduler, manager, or store, and
  // calling it again replaces the previous port instead of stacking one. Before it is called, a
  // delegated start still refuses as `admission_unavailable`.
  setAdmissionPort(port: ManagerAdmissionPort): void {
    this.#admission = port
  }

  // Manager-owned delegated start. The admission port is the seam that keeps the DAG runtime out of
  // this class; a construction without it must refuse, never quietly admit no child (a bare
  // manager.start creates a run but admits nothing - see delegation/run.ts:46-50 - and treating that
  // as success is exactly the fabricated outcome this seam exists to prevent).
  async startDelegated(request: ManagerDelegationStartRequest): Promise<ManagerDelegationStartResult> {
    const port = this.#admission
    if (port === undefined) return admissionUnavailable()

    const plan = buildEngineeringDelegationPlan(request)
    if (!plan.ok) return delegationPlanRejected(plan)

    const workingDirectory = request.workingDirectory ?? this.#options.cwd

    // Resolve the spawn-time catalogue before claiming a parent, so an unreadable authority
    // fails closed before a record is claimed (mirroring #startDelegatedSpec). The seam still
    // does not fold: the caller owns the terminal fold via resumeDelegatedVerifications or the
    // production start() path. A successful return therefore never implies completion.
    let catalogue: OrdinaryCatalogue
    try {
      catalogue = this.#delegationCatalogue(workingDirectory)
    } catch (error) {
      return {
        kind: "delegation_start_failed",
        reason: "verification_catalogue_unavailable",
        message: error instanceof Error ? error.message : String(error),
      }
    }

    let baseline: WorkspaceBaseline | null = null
    if (catalogue.status === "configured" && catalogue.checks.length > 0) {
      try { baseline = snapshotWorkspace(workingDirectory) } catch { baseline = null }
    }

    const spec: ManagerStartSpec = {
      prompt: request.objective,
      parent_session_id: request.parent_session_id,
      root_session_id: request.root_session_id ?? request.parent_session_id,
      depth: 0,
      cwd: workingDirectory,
    }

    const resolution = this.#options.planner(spec)
    if (resolution.kind === "error") return { kind: "plan_unresolved", error: resolution.error }

    this.#requireValidDeadline(request.deadlineMs)
    // ONE timer for the whole admission sequence, owned by the caller that finishes the request.
    const deadline = this.#armDeadline(request.deadlineMs)

    const modeBase = { configMode: this.#options.config.default_execution_mode }
    const executionMode = resolveExecutionMode(
      resolution.plan.agentExecutionMode === undefined
        ? modeBase
        : { ...modeBase, agentMode: resolution.plan.agentExecutionMode },
    )

    const claimed = this.#claimDelegatedParent(spec, resolution.plan, executionMode)
    if (!claimed.ok) {
      return { kind: "delegation_start_failed", reason: "record_claim_failed", message: claimed.message }
    }
    const parent = claimed.record
    const epoch = parent.notification.run_epoch
    const entered = this.#options.store.transition(parent.task_id, {
      type: "start",
      timestamp: nowIso(this.#now),
    })
    if (!entered.applied) {
      return {
        kind: "delegation_start_failed",
        reason: "record_claim_failed",
        message: `delegated parent ${parent.task_id} could not enter the running state: ${entered.audit.type}`,
      }
    }

    try {
      const driven = await this.#driveAdmission(
        port,
        plan,
        request.parent_session_id,
        request.root_session_id ?? request.parent_session_id,
        workingDirectory,
        deadline,
      )
      if (!("ok" in driven)) {
        this.#failDelegatedParent(parent.task_id, epoch, driven.message)
        return driven
      }
      if (!driven.ok) {
        this.#failDelegatedParent(parent.task_id, epoch, driven.reason)
        return driven
      }
      if (driven.unresolved) {
        return {
          kind: "delegation_unresolved",
          task_id: parent.task_id,
          runId: driven.runId,
          reason: driven.unresolvedReason,
          message: unresolvedDelegationMessage(driven),
          outcomes: driven.outcomes,
          missingNodeIds: driven.missingNodeIds,
          foreignNodeIds: driven.foreignNodeIds,
        }
      }
      return {
        kind: "delegated",
        task_id: parent.task_id,
        runId: driven.runId,
        outcomes: driven.outcomes,
        unresolved: false,
      }
    } finally {
      deadline?.clear()
    }
  }

  // Re-drive delegated parents whose host-side verification was interrupted. The intent file is
  // the only durable marker of "children settled, verdict not published": it is written before the
  // capture and removed only after THIS writer publishes a terminal. A restart therefore finds
  // either a terminal record (nothing to publish) or a non-terminal one with a complete run (fold
  // it again through the same capture + gate + fenced terminal). Every value comes from the
  // persisted intent and the run record; nothing is re-derived from a fresh catalogue, and no
  // verdict is ever restored from disk. A session-scoped call never touches another session's
  // parent, and an intent whose epoch no longer matches the record is discarded, never delivered.
  async resumeDelegatedVerifications(sessionId?: string): Promise<readonly DelegatedVerificationResumeOutcome[]> {
    const port = this.#admission
    if (port === undefined) return []
    const listing = listDelegatedVerificationIntents(this.#options.store.stateDir)
    for (const invalid of listing.invalid) {
      log("senpi-task delegated verification intent unreadable", { file: invalid })
    }
    const outcomes: DelegatedVerificationResumeOutcome[] = []
    for (const intent of listing.intents) {
      const record = this.#tryLoad(intent.taskId)
      if (record === null) {
        this.#discardDelegatedIntent(intent)
        outcomes.push({ taskId: intent.taskId, epoch: intent.epoch, outcome: "record_missing" })
        continue
      }
      if (sessionId !== undefined && record.parent_session_id !== sessionId) continue
      if (isTerminalRecord(record)) {
        // Exactly-once: the terminal already exists, so this delivery publishes nothing. The
        // intent is removed here because no further fold can add a second terminal for this epoch.
        this.#discardDelegatedIntent(intent)
        outcomes.push({
          taskId: intent.taskId,
          epoch: intent.epoch,
          outcome: "already_terminal",
          status: record.status,
          ...(record.verification_status === undefined ? {} : { verification_status: record.verification_status }),
        })
        continue
      }
      if (record.notification.run_epoch !== intent.epoch) {
        // The epoch fence at the re-drive boundary: an outcome produced for another run of this
        // task id is never delivered into this one.
        this.#discardDelegatedIntent(intent)
        outcomes.push({ taskId: intent.taskId, epoch: intent.epoch, outcome: "stale_epoch", status: record.status })
        continue
      }
      const observed = this.#observeDelegation(port, intent.dagRunId, plannedNodeIdsFromPersisted(intent.plannedNodeIds))
      const incomplete = observed.unresolved || observed.outcomes.some((outcome) => outcome.outcome !== "completed")
      if (incomplete) {
        // A run whose children have not all settled is never verified. The intent stays so a later
        // re-drive can finish; nothing is published for an incomplete run.
        outcomes.push({
          taskId: intent.taskId,
          epoch: intent.epoch,
          outcome: observed.unresolvedReason === "run_record_unreadable" ? "run_record_unreadable" : "run_not_completed",
          status: record.status,
        })
        continue
      }
      await this.#foldDelegatedTerminal(
        intent.taskId,
        intent.epoch,
        { ok: true, runId: intent.dagRunId, ...observed },
        intent.catalogue,
        intent.workspaceDir,
        intent.baseline,
        undefined,
        intent.plannedNodeIds,
      )
      const settled = this.#tryLoad(intent.taskId)
      outcomes.push({
        taskId: intent.taskId,
        epoch: intent.epoch,
        outcome: "folded",
        ...(settled === null
          ? {}
          : {
              status: settled.status,
              ...(settled.verification_status === undefined ? {} : { verification_status: settled.verification_status }),
            }),
      })
    }
    return outcomes
  }

  #discardDelegatedIntent(intent: DelegatedVerificationIntent): void {
    try {
      deleteDelegatedVerificationIntent(verificationIntentPath(this.#options.store.stateDir, intent.taskId, intent.epoch))
    } catch (error) { // no-excuse-ok: catch - the intent is host bookkeeping; a failed delete is reported, never turned into a verdict.
      log("senpi-task delegated verification intent not removed", { taskId: intent.taskId, epoch: intent.epoch, error: String(error) })
    }
  }

  // The ordinary start() path's delegated branch: plan -> startRun -> admit -> wait -> collect ->
  // fold -> terminal. The manager owns the parent TaskRecord and the terminal fold; the admission
  // port owns run identity, dependency gating, and child admission. A production port admits each
  // node through this same manager's startOwned, so no second spawn mechanism exists here.
  async #startDelegatedSpec(
    spec: ManagerStartSpec,
    delegation: ManagerDelegationSpec,
  ): Promise<ManagerDelegatedStartResult> {
    const port = this.#admission
    if (port === undefined) return admissionUnavailable()

    const workingDirectory = delegation.workingDirectory ?? spec.cwd ?? this.#options.cwd
    const planInput = {
      objective: delegation.objective,
      workingDirectory,
      roles: delegation.roles,
    }
    const plan = buildEngineeringDelegationPlan(
      delegation.maxNodes === undefined ? planInput : { ...planInput, maxNodes: delegation.maxNodes },
    )
    if (!plan.ok) return delegationPlanRejected(plan)

    const resolution = this.#options.planner(spec)
    if (resolution.kind === "error") return { kind: "plan_unresolved", error: resolution.error }

    // Validate BEFORE any record is claimed, so an invalid budget leaves no running parent behind.
    this.#requireValidDeadline(delegation.deadlineMs)

    // The catalogue is resolved BEFORE any child runs, the same spawn-time snapshot ordinary workers
    // get. Nothing can relax it mid-run, and an unreadable authority fails closed before a record is
    // claimed. The gate remains the only judge of the run's verification claim.
    let catalogue: OrdinaryCatalogue
    try {
      catalogue = this.#delegationCatalogue(workingDirectory)
    } catch (error) {
      return {
        kind: "delegation_start_failed",
        reason: "verification_catalogue_unavailable",
        message: error instanceof Error ? error.message : String(error),
      }
    }

    // The change-scope baseline must predate every admitted node: a snapshot taken after the run
    // would treat the nodes' edits as the baseline and select checks for an empty change set. A
    // tree the host cannot snapshot stays null, and the gate fails closed instead of inventing [].
    let baseline: WorkspaceBaseline | null = null
    if (catalogue.status === "configured" && catalogue.checks.length > 0) {
      try {
        baseline = snapshotWorkspace(workingDirectory)
      } catch {
        baseline = null
      }
    }

    const modeBase = { configMode: this.#options.config.default_execution_mode }
    const modeWithSpec = spec.execution_mode === undefined ? modeBase : { ...modeBase, specMode: spec.execution_mode }
    const executionMode = resolveExecutionMode(
      resolution.plan.agentExecutionMode === undefined
        ? modeWithSpec
        : { ...modeWithSpec, agentMode: resolution.plan.agentExecutionMode },
    )
    const claimed = this.#claimDelegatedParent(spec, resolution.plan, executionMode)
    if (!claimed.ok) {
      return { kind: "delegation_start_failed", reason: "record_claim_failed", message: claimed.message }
    }
    const parent = claimed.record
    const epoch = parent.notification.run_epoch
    const entered = this.#options.store.transition(parent.task_id, {
      type: "start",
      timestamp: nowIso(this.#now),
    })
    if (!entered.applied) {
      return {
        kind: "delegation_start_failed",
        reason: "record_claim_failed",
        message: `delegated parent ${parent.task_id} could not enter the running state: ${entered.audit.type}`,
      }
    }

    // ONE timer for admission AND the terminal fold. The fold's host-side verification capture
    // races the SAME budget, so a slow approved check fails the parent at the deadline instead of
    // completing it after the caller-observable budget. The caller owns disposal.
    const deadline = this.#armDeadline(delegation.deadlineMs)
    try {
      const driven = await this.#driveAdmission(
        port,
        plan,
        spec.parent_session_id,
        spec.root_session_id ?? spec.parent_session_id,
        workingDirectory,
        deadline,
      )
      if (!("ok" in driven)) {
        // The deadline elapsed before the port reported a run identity; no node was admitted.
        this.#failDelegatedParent(parent.task_id, epoch, driven.message)
        return driven
      }
      if (!driven.ok) {
        // A deadline is never a completion: the parent is failed with the typed reason and the
        // checkbox-16 error travels to the caller unchanged.
        this.#failDelegatedParent(parent.task_id, epoch, driven.reason)
        return driven
      }
      const folded = await this.#foldDelegatedTerminal(
        parent.task_id,
        epoch,
        driven,
        catalogue,
        workingDirectory,
        baseline,
        deadline,
        plan.definition.nodes.map((node) => node.id),
      )
      if (folded.kind === "deadline") {
        // The run settled, but the host-side capture outlived the budget. The fold already failed
        // the parent; report the same typed refusal so no caller can read this as success.
        return {
          ok: false,
          kind: "deadline_unavailable_at_manager_seam",
          reason:
            `${this.#deadlineReason(folded.budgetMs)} during the host-side verification capture; ` +
            "the delegated parent was failed instead of completed past its deadline",
          runId: driven.runId,
          outcomes: driven.outcomes,
          unresolved: driven.unresolved,
        }
      }
      return {
        kind: "delegated",
        task_id: parent.task_id,
        runId: driven.runId,
        outcomes: driven.outcomes,
        unresolved: driven.unresolved,
      }
    } catch (error) {
      this.#failDelegatedParent(
        parent.task_id,
        epoch,
        `delegated run failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      throw error
    } finally {
      deadline?.clear()
    }
  }

  // Drive the port through the planned node set under the CALLER-owned deadline. The port owns
  // dependency gating: admit resolves each node's child (waiting for readiness where the node is
  // not yet admissible), so admitting the planned set together adds no ordering of this class's own.
  // startRun, admit, and wait all race the SAME budget: a port that parks in any phase can never
  // keep the caller past its caller-observable deadline, and an already-admitted run is cancelled
  // through the port before the typed refusal is returned. The timer is NOT disposed here: the
  // ordinary start path carries it into the terminal fold so the verification capture is bounded
  // by the same budget instead of receiving a fresh one.
  async #driveAdmission(
    port: ManagerAdmissionPort,
    plan: DelegationPlan,
    parentSessionId: string,
    rootSessionId: string,
    workingDirectory: string,
    deadline: DeadlineTimer | undefined,
  ): Promise<DelegationDriveResult> {
    // SAFETY: every node id in this definition was branded by delegationNodeId() inside the plan
    // builder; DagNodeInput widens ids back to string, so the plan owns this narrowing.
    const plannedNodeIds = plan.definition.nodes.map((node) => node.id as DagNodeId)
    const startPromise = port.startRun({
      definition: plan.definition,
      parentSessionId,
      rootSessionId,
      workingDirectory,
    })
    const started = await this.#settleBeforeDeadline(startPromise, deadline)
    if (started.kind === "deadline") {
      // No run identity exists yet, so a run-scoped deadline refusal would have to invent one.
      // Cancel the run the moment the port reports it: a late creation must not run unowned.
      const reason = this.#deadlineReason(started.budgetMs)
      void startPromise.then(
        (run) => this.#cancelAdmittedRun(port, run.runId, reason),
        () => undefined,
      )
      return {
        kind: "delegation_start_failed",
        reason: "admission_start_timeout",
        message:
          `${reason} while the admission port was creating the run; no node was admitted, ` +
          "and any run the port reports after the deadline is cancelled",
      }
    }

    const run = started.value
    // SAFETY: every node id in this definition was branded by delegationNodeId() inside the plan
    // builder; DagNodeInput widens ids back to string, so the plan owns this narrowing.
    const admits = await this.#settleBeforeDeadline(
      Promise.all(plan.definition.nodes.map((node) =>
        port.admit({ runId: run.runId, nodeId: node.id as DagNodeId }))),
      deadline,
    )
    if (admits.kind === "deadline") {
      return this.#deadlineAdmission(port, run.runId, plannedNodeIds, admits.budgetMs, "while nodes were being admitted")
    }

    const waited = await this.#settleBeforeDeadline(
      Promise.all(admits.value.map((child) => port.wait(child.taskId))),
      deadline,
    )
    if (waited.kind === "deadline") {
      return this.#deadlineAdmission(port, run.runId, plannedNodeIds, waited.budgetMs, "while admitted children were running")
    }

    const observed = this.#observeDelegation(port, run.runId, plannedNodeIds)
    return { ok: true, runId: run.runId, ...observed }
  }

  // The run identity exists, so the deadline is a run-scoped refusal. Cancel through the port when
  // it exposes one BEFORE reporting, so a parent terminal failure never leaves admitted children
  // editing the workspace after the caller returned.
  async #deadlineAdmission(
    port: ManagerAdmissionPort,
    runId: DagRunId,
    plannedNodeIds: readonly DagNodeId[],
    deadlineMs: number,
    phase: string,
  ): Promise<EngineeringDelegationDeadlineUnavailable> {
    const cancel = await this.#cancelAdmittedRun(port, runId, this.#deadlineReason(deadlineMs))
    const observed = this.#observeDelegation(port, runId, plannedNodeIds)
    return {
      ok: false,
      kind: "deadline_unavailable_at_manager_seam",
      reason:
        `${this.#deadlineReason(deadlineMs)} ${phase} before run ${runId} reached a terminal state; ` +
        DEADLINE_CANCEL_REASON[cancel],
      runId,
      outcomes: observed.outcomes,
      unresolved: observed.unresolved,
    }
  }

  #deadlineReason(deadlineMs: number): string {
    return `deadline of ${deadlineMs}ms elapsed`
  }

  // Best-effort cancellation at the seam's last authority. Absence is reported as `unavailable` so
  // the deadline text never claims a stop that never happened; a rejection is reported as `failed`.
  async #cancelAdmittedRun(
    port: ManagerAdmissionPort,
    runId: DagRunId,
    reason: string,
  ): Promise<AdmissionCancelOutcome> {
    if (port.cancel === undefined) return "unavailable"
    try {
      await port.cancel(runId, reason)
      return "cancelled"
    } catch (error) { // no-excuse-ok: catch - the cancel is the seam's last action; a rejection is reported, not trusted as a stop.
      log("senpi-task delegated run cancel failed", { runId, error: String(error) })
      return "failed"
    }
  }

  #requireValidDeadline(deadlineMs: number | undefined): void {
    if (deadlineMs !== undefined && (!Number.isFinite(deadlineMs) || deadlineMs < 0)) {
      throw new DelegationRunError(
        "invalid_deadline",
        `deadlineMs must be a finite non-negative number, received ${deadlineMs}`,
      )
    }
  }

  // ONE timer for the WHOLE delegated start: time spent in startRun, admit, and the waits is
  // charged to the same budget as the host-side verification capture, so a slow phase cannot hand
  // the next phase a fresh deadline. Ownership sits with the caller that finishes the request - it
  // disposes in its own finally - never with a phase that returns early.
  #armDeadline(deadlineMs: number | undefined): DeadlineTimer | undefined {
    if (deadlineMs === undefined) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let fired = false
    const expired = new Promise<{ readonly kind: "deadline"; readonly budgetMs: number }>((resolve) => {
      timer = setTimeout(() => {
        fired = true
        resolve({ kind: "deadline", budgetMs: deadlineMs })
      }, deadlineMs)
    })
    return {
      budgetMs: deadlineMs,
      expired,
      elapsed: () => fired,
      clear: () => {
        if (timer !== undefined) clearTimeout(timer)
      },
    }
  }

  async #settleBeforeDeadline<T>(
    work: Promise<T>,
    deadline: DeadlineTimer | undefined,
  ): Promise<{ readonly kind: "settled"; readonly value: T } | { readonly kind: "deadline"; readonly budgetMs: number }> {
    if (deadline === undefined) return { kind: "settled", value: await work }
    // The settle handler is attached to the SAME promise the deadline races, so a late rejection
    // can never surface as an unhandled rejection after the deadline won.
    const settled = work.then((value) => ({ kind: "settled", value } as const))
    return Promise.race([settled, deadline.expired])
  }

  #observeDelegation(
    port: ManagerAdmissionPort,
    runId: DagRunId,
    plannedNodeIds: readonly DagNodeId[],
  ): DelegationObservation {
    try {
      const { results } = collectDelegationResults(port.record(runId).nodes)
      // Explicit planned-id sets, never a count: a reused/amended record carrying one extra terminal
      // node and missing one planned node has the same length but is NOT this plan's result.
      const comparison = compareDelegationNodeSets(plannedNodeIds, results)
      if (comparison.mismatch === undefined) {
        return {
          outcomes: results,
          unresolved: false,
          unresolvedReason: undefined,
          missingNodeIds: [],
          foreignNodeIds: [],
        }
      }
      return {
        outcomes: results,
        unresolved: true,
        unresolvedReason: comparison.mismatch,
        missingNodeIds: comparison.missingNodeIds,
        foreignNodeIds: comparison.foreignNodeIds,
      }
    } catch (error) {
      // A record read that fails is not evidence of a completed run: report the nodes as unresolved
      // with the typed cause, rather than inventing outcomes the persisted record never carried.
      log("senpi-task delegated run record read failed", { runId, error: String(error) })
      return {
        outcomes: [],
        unresolved: true,
        unresolvedReason: "run_record_unreadable",
        missingNodeIds: [],
        foreignNodeIds: [],
      }
    }
  }

  // The coordinator record is NOT a spawned child: it is created non-resident so it can never hold
  // a residency slot the admitted nodes need. It still travels the same claim/name machinery and
  // carries the same durable terminal fields an ordinary task does.
  #claimDelegatedParent(
    spec: ManagerStartSpec,
    plan: ResolvedChildPlan,
    executionMode: ExecutionMode,
  ): { readonly ok: true; readonly record: TaskRecord } | { readonly ok: false; readonly message: string } {
    const trimmed = spec.name?.trim()
    const requestedName = trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
    const requestedRegistration = requestedName === undefined
      ? undefined
      : this.#names.register(spec.parent_session_id, requestedName)
    try {
      const draft = createTaskRecord(buildRecordInput({
        spec,
        plan,
        name: "",
        executionMode,
        taskSeq: this.#taskSequence.next(spec.parent_session_id),
      }), this.#now())
      const claimOptions = requestedRegistration === undefined
        ? {
            nameFollowsId: true,
            nameAvailable: (name: string) => this.#names.isAvailable(spec.parent_session_id, name),
          }
        : { nameFollowsId: false }
      const claimed = claimTaskRecord(this.#options.store, {
        ...draft,
        name: requestedRegistration?.name ?? draft.task_id,
        host_pid: this.#hostPid,
        residency_state: "disposed",
      }, claimOptions)
      if (requestedRegistration === undefined) {
        this.#names.register(spec.parent_session_id, undefined, claimed.task_id)
      }
      return { ok: true, record: claimed }
    } catch (error) {
      if (!(error instanceof TaskRecordCollisionError) && !(error instanceof TaskIdSpaceExhaustedError)) throw error
      if (requestedRegistration !== undefined) this.#names.release(spec.parent_session_id, requestedRegistration.name)
      return { ok: false, message: "task id allocation failed under contention; retry the spawn" }
    }
  }

  #delegationCatalogue(workspaceDir: string): OrdinaryCatalogue {
    const authority = approvalAuthorityFor(workspaceDir, this.#options.verificationAuthorityRoot)
    const approvals = readApprovals(authority, WORKSPACE_ID)
    return resolveCatalogue({ projectRoot: workspaceDir, workspaceId: WORKSPACE_ID, changedFiles: null, authority, approvals })
  }

  // Fold the run's terminal evidence into the parent record. A non-completed node, an unresolved
  // node, or a blocked gate verdict is a terminal failure - never a completed parent. A child's
  // success is never treated as verification: only evaluateOrdinaryCompletion may stamp a
  // verification claim, and only its "verified" verdict ever writes "verified".
  async #foldDelegatedTerminal(
    taskId: string,
    epoch: number,
    driven: EngineeringDelegationRunCompletion,
    catalogue: OrdinaryCatalogue,
    workspaceDir: string,
    baseline: WorkspaceBaseline | null,
    deadline: DeadlineTimer | undefined,
    plannedNodeIds: readonly string[],
  ): Promise<DelegatedFoldOutcome> {
    // Durability marker: written BEFORE any verification work and removed only after THIS writer
    // publishes a terminal. A process that dies in between leaves exactly the state a later
    // resumeDelegatedVerifications re-drives, and a second fold that finds a terminal publishes
    // nothing. The intent is host state only - it carries no verdict, exit code, or check result.
    const intentPath = writeDelegatedVerificationIntent(this.#options.store.stateDir, {
      taskId,
      epoch,
      dagRunId: driven.runId,
      workspaceDir,
      catalogue,
      baseline,
      plannedNodeIds,
      createdAt: nowIso(this.#now),
    })
    const discardIntent = (): void => {
      try {
        deleteDelegatedVerificationIntent(intentPath)
      } catch (error) { // no-excuse-ok: catch - the terminal is already published; a dangling intent is cleaned by the next re-drive.
        log("senpi-task delegated verification intent not removed", { taskId, epoch, error: String(error) })
      }
    }
    // Epoch fence: the folded results belong to THIS run of the parent record. If the epoch moved
    // (or another writer already terminalized it) while the nodes ran, this writer no longer owns
    // the record and must not stamp a terminal or a verification claim onto it.
    if (!this.#delegatedParentStillOwned(taskId, epoch)) {
      log("senpi-task delegated parent moved before fold; terminal not written", { taskId, epoch })
      return { kind: "folded" }
    }
    const notCompleted = driven.outcomes.filter((outcome) => outcome.outcome !== "completed")
    if (driven.unresolved || notCompleted.length > 0) {
      const detail = driven.unresolved
        ? "the run record did not carry exactly the planned node set when it was read"
        : notCompleted.map((outcome) => `${outcome.nodeId} ended ${outcome.outcome}`).join("; ")
      this.#failDelegatedParent(taskId, epoch, `delegation run ${driven.runId} did not complete: ${detail}`)
      discardIntent()
      return { kind: "folded" }
    }

    // Host-side verification: the approved catalogue runs HERE, against the settled workspace, and
    // its evidence lands in the namespace the gate reads. DAG-owned children never receive the
    // worker verification tool (the DAG gate owns that path), so the parent cannot inherit a claim
    // from them; it must produce the evidence itself or the gate honestly blocks.
    //
    // The capture races the SAME budget admission used. A check that outlives it can no longer
    // produce a completed parent: the timeout wins, the parent is failed as deadline-exceeded, and
    // the late evidence (marked cancelled) is never consulted because no gate evaluation runs here.
    // ONE requirement set is computed here from the spawn-time catalogue and handed to BOTH the
    // capture and the gate: the two sides can never disagree about which checks are required.
    const required = catalogueChecks(catalogue)
    // ONE revision for the whole capture. It is taken AFTER the delegated writes settled and
    // BEFORE the first approved check runs, then stamped on every record and handed to the gate
    // unchanged - the same safe shape repair/execute.ts already uses. A per-check re-read would
    // stamp records against several trees, so a check's own write would invalidate the evidence
    // that check just produced.
    let pinnedRevision: string | null = null
    if (baseline !== null && required.length > 0) {
      try {
        pinnedRevision = workspaceRevision(workspaceDir)
      } catch {
        // The host cannot describe the settled tree. The capture must not run checks against a tree
        // it cannot attribute; the gate reports provenance_unknown below.
        pinnedRevision = null
      }
    }
    const capture = this.#captureDelegatedVerification(
      taskId,
      epoch,
      driven.runId,
      catalogue,
      required,
      workspaceDir,
      baseline,
      pinnedRevision,
      deadline,
    )
    const settledCapture = await this.#settleBeforeDeadline(capture, deadline)
    if (settledCapture.kind === "deadline") {
      this.#failDelegatedParent(
        taskId,
        epoch,
        `${this.#deadlineReason(settledCapture.budgetMs)} while the host-side verification capture ran; ` +
        "the delegated parent was failed instead of completed past its deadline",
      )
      discardIntent()
      return { kind: "deadline", budgetMs: settledCapture.budgetMs }
    }
    const captureOutcome = settledCapture.value
    // The capture executes real commands and therefore yields. If the parent moved to another run
    // while it ran, this writer no longer owns the record: stamp nothing. The intent stays for the
    // next re-drive, which publishes the honest terminal or reports the moved record.
    if (!this.#delegatedParentStillOwned(taskId, epoch)) {
      log("senpi-task delegated parent moved during verification capture; terminal not written", { taskId, epoch })
      return { kind: "folded" }
    }

    // A check that writes the tree (or any concurrent edit) leaves the records describing a tree
    // that no longer exists. Compare ONCE, after the checks, against the SAME pinned revision the
    // records carry; acceptance is never evaluated for a moved tree.
    if (pinnedRevision !== null) {
      let postCaptureRevision: string | null = null
      try {
        postCaptureRevision = workspaceRevision(workspaceDir)
      } catch {
        postCaptureRevision = null
      }
      if (postCaptureRevision !== pinnedRevision) {
        const stale: CompletionGateVerdict = {
          verification: "blocked",
          code: "verification_stale",
          reason:
            "the workspace revision changed while the approved checks ran: " +
            `pinned ${pinnedRevision}, observed ${postCaptureRevision ?? "unavailable"}`,
        }
        this.#options.store.appendEvent(taskId, {
          type: "verification_blocked",
          payload: this.#verificationEventPayload(stale, captureOutcome),
        })
        const terminal = this.#transitionDelegatedParent(taskId, epoch, {
          type: "fail",
          timestamp: nowIso(this.#now),
          error_message: completionBlockedMessage(stale),
        }, "blocked")
        discardIntent()
        if (terminal !== undefined) this.#settleWaiters(taskId, terminal)
        return { kind: "folded" }
      }
    }

    const verdict = evaluateOrdinaryCompletion({
      // Evidence is keyed by the PARENT task record id, never by the reusable DAG run id: reusing a
      // run (same definition fingerprint) must never let a second parent read the first one's
      // evidence. The DAG run id stays in the capture binding and receipt for traceability only.
      taskId,
      catalogue,
      requirements: required,
      evidenceRoot: captureOutcome.evidenceRoot,
      workspaceDir,
      epoch,
      // The gate judges the SAME revision the records were stamped with. When the host could not
      // pin one, the baseline itself was unavailable: provenance, not missing evidence.
      ...(pinnedRevision !== null
        ? { sourceRevision: pinnedRevision }
        : { preconditions: { baseline: "unavailable" } }),
    })
    const timestamp = nowIso(this.#now)
    if (verdict.verification === "blocked") {
      this.#options.store.appendEvent(taskId, {
        type: "verification_blocked",
        payload: this.#verificationEventPayload(verdict, captureOutcome),
      })
      const terminal = this.#transitionDelegatedParent(taskId, epoch, {
        type: "fail",
        timestamp,
        error_message: completionBlockedMessage(verdict),
      }, "blocked")
      discardIntent()
      if (terminal !== undefined) this.#settleWaiters(taskId, terminal)
      return { kind: "folded" }
    }
    if (verdict.verification === "unverified") {
      this.#options.store.appendEvent(taskId, {
        type: "verification_unverified",
        payload: this.#verificationEventPayload(verdict, captureOutcome),
      })
    }
    const finalResponse = JSON.stringify({
      run_id: driven.runId,
      outcomes: driven.outcomes.map((outcome) => ({
        node_id: outcome.nodeId,
        role: outcome.role,
        outcome: outcome.outcome,
        output_bytes: outcome.outputBytes,
      })),
    })
    const terminal = this.#transitionDelegatedParent(taskId, epoch, {
      type: "complete",
      timestamp,
      final_response: finalResponse,
    }, verdict.verification)
    discardIntent()
    if (terminal !== undefined) this.#settleWaiters(taskId, terminal)
    return { kind: "folded" }
  }

  // Run the approved catalogue through the SAME ordinary capture the worker tool uses, into the
  // SAME evidence root the completion gate reads. The model supplies nothing: the run id, epoch,
  // workspace, change scope and check set all come from host state. A capture failure is logged and
  // left to the gate, which fails closed when the evidence it requires is absent or malformed -
  // never a manager-computed verdict.
  // The deadline predicate stops the capture from starting another check once the budget elapsed
  // and marks an in-flight check `cancelled`; its command is still bounded by its own timeoutMs,
  // but a cancelled record can never be read as a pass by any later gate evaluation.
  // One event shape for both verification events. The verdict stays exactly as the gate produced
  // it; the capture fields add the host's own account of what it could and did run.
  #verificationEventPayload(
    verdict: CompletionGateVerdict,
    capture: DelegatedCaptureOutcome,
  ): VerificationEventPayload {
    return {
      code: verdict.code,
      reason: verdict.reason,
      verification_status: verdict.verification,
      capture_outcome: capture.code,
      evidence_root: capture.evidenceRoot,
      records: capture.records.length,
      receipt_path: capture.receiptPath,
      dag_run_id: capture.dagRunId,
      catalogue_status: capture.catalogueStatus,
      selection: capture.selection,
      ...(capture.detail === undefined ? {} : { capture_detail: capture.detail }),
    }
  }

  // Run the approved catalogue through the SAME ordinary capture the worker tool uses, into the
  // SAME evidence root the completion gate reads. The model supplies nothing: the run id, epoch,
  // workspace, change scope, pinned revision and check set all come from host state. Every early
  // exit returns a NAMED outcome instead of a silent `void`, so the gate's "no evidence" can be
  // read next to the host's actual reason. No verdict is computed here.
  // The deadline predicate stops the capture from starting another check once the budget elapsed
  // and marks an in-flight check `cancelled`; its command is still bounded by its own timeoutMs,
  // but a cancelled record can never be read as a pass by any later gate evaluation.
  async #captureDelegatedVerification(
    taskId: string,
    epoch: number,
    runId: string,
    catalogue: OrdinaryCatalogue,
    required: readonly DagVerifyCheck[],
    workspaceDir: string,
    baseline: WorkspaceBaseline | null,
    pinnedRevision: string | null,
    deadline: DeadlineTimer | undefined,
  ): Promise<DelegatedCaptureOutcome> {
    const evidenceRoot = join(this.#options.store.stateDir, "verifications")
    const selection: DelegatedCaptureSelection = { required: required.length, omitted: 0 }
    const notCaptured = (
      code: Exclude<DelegatedCaptureCode, "captured">,
      detail?: string,
    ): DelegatedCaptureOutcome => ({
      code,
      evidenceRoot,
      records: [],
      receiptPath: null,
      dagRunId: runId,
      catalogueStatus: catalogue.status,
      selection,
      ...(detail === undefined ? {} : { detail }),
    })

    if (catalogue.status !== "configured") return notCaptured("catalogue_not_configured")
    if (required.length === 0) return notCaptured("no_approved_checks")
    // A baseline or a pinned revision the host could not produce is an attribution failure, not an
    // empty change set: run no check, and let the gate name provenance_unknown.
    if (baseline === null || pinnedRevision === null) return notCaptured("baseline_unavailable")
    const parent = this.#tryLoad(taskId)
    if (parent === null) return notCaptured("parent_missing")
    let changedFiles: readonly string[]
    try {
      changedFiles = changedPathsSince(workspaceDir, baseline)
    } catch (error) {
      log("senpi-task delegated change scope unavailable; verification not captured", {
        taskId,
        error: String(error),
      })
      return notCaptured("change_scope_unavailable", String(error))
    }
    const revision = pinnedRevision
    try {
      const capture = createOrdinaryVerificationCapture({
        store: createFileEvidenceStore(evidenceRoot),
        projectDir: workspaceDir,
        // The fold pinned this ONCE, after the delegated writes settled and before the first check.
        // Every record and the gate use this same value; a check's own write cannot move it.
        currentRevision: () => revision,
        ...(deadline === undefined ? {} : { isCancelled: () => deadline.elapsed() }),
      })
      const captured = await capture.capture({
        // Identity is (parent task id, epoch, attempt). A late writer for a lower epoch lands at a
        // lower attempt and can never overwrite the newer epoch's record; the DAG run id is carried
        // only as traceability metadata on the record and receipt.
        binding: { taskId, dagRunId: runId, sessionId: parent.parent_session_id, epoch },
        changedFiles,
        available: required,
        required,
        attempt: epoch + 1,
      })
      return {
        code: "captured",
        evidenceRoot,
        records: captured.records,
        receiptPath: captured.receiptPath,
        dagRunId: runId,
        catalogueStatus: catalogue.status,
        selection: {
          required: captured.selection.required.length,
          omitted: captured.selection.omitted.length,
        },
      }
    } catch (error) {
      // A staging failure is not a pass: the gate reads what actually landed and decides.
      log("senpi-task delegated verification capture failed", { taskId, runId, error: String(error) })
      return notCaptured("capture_failed", String(error))
    }
  }

  #failDelegatedParent(taskId: string, epoch: number, message: string): void {
    const terminal = this.#transitionDelegatedParent(taskId, epoch, {
      type: "fail",
      timestamp: nowIso(this.#now),
      error_message: message,
    })
    if (terminal !== undefined) this.#settleWaiters(taskId, terminal)
  }

  #delegatedParentStillOwned(taskId: string, epoch: number): boolean {
    const record = this.#tryLoad(taskId)
    return record !== null && record !== undefined &&
      !isTerminalRecord(record) && record.notification.run_epoch === epoch
  }

  // The delegated parent's terminal write, fenced on its run epoch. The fence check and the write
  // happen inside ONE store.mutate critical section - the same per-record lock store.transition()
  // takes - so a revival that moves the epoch can never slip between the check and the write. The
  // gate's verification claim, when present, lands in that SAME write: a terminal from a gated run
  // can never exist without the verdict that belongs to it. Returns the terminal record only when
  // THIS writer applied the transition; a moved/fenced record and a rejected transition write
  // nothing and settle nothing.
  #transitionDelegatedParent(
    taskId: string,
    epoch: number,
    transition: TaskTransition,
    verification?: VerificationStatus,
  ): TaskRecord | undefined {
    const observed: FencedTerminal = {}
    this.#options.store.mutate(taskId, (record) => {
      if (isTerminalRecord(record) || record.notification.run_epoch !== epoch) return record
      const result = transitionTaskRecord(record, transition)
      observed.audit = result.audit
      if (!result.applied) return record
      const stamped: TaskRecord = verification === undefined
        ? result.record
        : { ...result.record, verification_status: verification }
      observed.terminal = stamped
      return stamped
    })
    // The transition audit keeps the same event the store's own transition() appends. Bookkeeping
    // must never change the terminal this writer already published.
    if (observed.audit !== undefined) {
      try {
        this.#options.store.appendEvent(taskId, { type: observed.audit.type, payload: observed.audit })
      } catch (error) {
        log("senpi-task delegated parent transition audit not appended", { taskId, error: String(error) })
      }
    }
    return observed.terminal
  }

  async startOwned(spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
    const refused = memberKernelToolRefusal(spec)
    if (refused !== undefined) return refused
    const lockPath = ownerLockPath(this.#options.store.stateDir, owner)
    const resolution = this.#options.planner(spec)
    if (resolution.kind === "error") return { kind: "plan_unresolved", error: resolution.error }

    return withTaskRecordLockAsync(lockPath, async () => {
      const raced = this.#ownedResult(owner)
      if (raced !== undefined) return raced
      const result = await withResidentStart(this.#options, spec.parent_session_id,
        release => this.#startResolved(spec, resolution.plan, owner, release))
      return result.kind === "started" ? { ...result, reused: false } : result
    })
  }

  // The LAST match wins: a retried DAG node claims the same (kind,runId,nodeId) under a new
  // execAttempt-scoped fingerprint, and task ids sort by creation, so the newest claim is the live
  // one. The superseded record keeps its dag owner marker (spawn-time launcher stripping reads it).
  findOwnedTask(owner: DagTaskOwnerKey): TaskRecord | undefined {
    return this.#options.store.list().records.findLast((record) =>
      record.owner?.kind === owner.kind &&
      record.owner.runId === owner.runId &&
      record.owner.nodeId === owner.nodeId,
    )
  }

  #ownedResult(owner: DagTaskOwner): OwnedStartResult | undefined {
    const record = this.findOwnedTask(owner)
    if (record === undefined) return undefined
    if (record.owner?.fingerprint !== owner.fingerprint) {
      // A settled record cannot be re-run in place, so a differing fingerprint on it is a retry:
      // ownership moves to the fresh task. Only a LIVE task with a different fingerprint is a
      // genuine conflict between two callers over one running child.
      if (isTerminalRecord(record)) return undefined
      return {
        kind: "owner_conflict",
        task_id: record.task_id,
        existing_fingerprint: record.owner?.fingerprint ?? "",
        requested_fingerprint: owner.fingerprint,
      }
    }
    return {
      kind: "started",
      reused: true,
      task_id: record.task_id,
      status: record.status,
      name: record.name ?? record.task_id,
      ...(record.resolved_model !== undefined ? { resolved_model: record.resolved_model } : {}),
    }
  }

  async #startResolved(
    spec: ManagerStartSpec,
    plan: ResolvedChildPlan,
    owner?: DagTaskOwner,
    releaseResidency?: () => void,
  ): Promise<StartResult> {
    const normalizeSpecName = (value: string | undefined): string | undefined => {
      const trimmed = value?.trim()
      return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
    }

    const maxDepth = plan.maxDepth ?? this.#options.config.max_depth
    const allowedSubagents = [...(spec.allowed_subagents ?? []), ...(plan.allowedSubagents ?? [])]
    const targetAgentType = spec.subagent_type ?? plan.agentType
    const decision = decideDepthPolicy({
      childDepth: spec.depth,
      maxDepth,
      ...(targetAgentType !== undefined ? { targetAgentType } : {}),
      allowedSubagents,
    })
    if (!decision.allowed) {
      return { kind: "depth_denied", reason: decision.reason, child_depth: spec.depth, max_depth: maxDepth }
    }

    const executionMode: ExecutionMode = resolveExecutionMode({
      ...(spec.execution_mode !== undefined && { specMode: spec.execution_mode }),
      ...(plan.agentExecutionMode !== undefined && { agentMode: plan.agentExecutionMode }),
      configMode: this.#options.config.default_execution_mode,
      ...(await this.#autoExecutionMode(spec, plan)),
    })

    const requestedName = normalizeSpecName(spec.name)
    const requestedRegistration = requestedName === undefined
      ? undefined
      : this.#names.register(spec.parent_session_id, requestedName)

    let claimed: TaskRecord
    try {
      const draft = createTaskRecord({
        ...buildRecordInput({
          spec,
          plan,
          name: "",
          executionMode,
          taskSeq: this.#taskSequence.next(spec.parent_session_id),
        }),
        ...(owner === undefined ? {} : { owner }),
      }, this.#now())
      const claimDraft: TaskRecord = { ...draft, name: requestedRegistration?.name ?? draft.task_id, host_pid: this.#hostPid }
      claimed = claimTaskRecord(this.#options.store, claimDraft, {
        nameFollowsId: requestedRegistration === undefined,
        ...(requestedRegistration === undefined
          ? { nameAvailable: (name) => this.#names.isAvailable(spec.parent_session_id, name) }
          : {}),
      })
    } catch (error) {
      if (!(error instanceof TaskRecordCollisionError) && !(error instanceof TaskIdSpaceExhaustedError)) throw error
      if (requestedRegistration !== undefined) this.#names.release(spec.parent_session_id, requestedRegistration.name)
      return {
        kind: "start_failed",
        task_id: "",
        name: requestedName ?? "",
        ...(spec.category ?? plan.category !== undefined ? { category: spec.category ?? plan.category } : {}),
        ...(spec.subagent_type ?? plan.agentType !== undefined ? { subagent_type: spec.subagent_type ?? plan.agentType } : {}),
        execution_mode: executionMode,
        model: plan.model,
        ...(plan.resolved_model !== undefined ? { resolved_model: plan.resolved_model } : {}),
        run_in_background: spec.run_in_background === true,
        error_message: "task id allocation failed under contention; retry the spawn",
      }
    }

    const registration = requestedRegistration ?? this.#names.register(spec.parent_session_id, undefined, claimed.task_id)
    const admission = admitSpill(plan, this.#concurrency, claimed.task_id, claimed.notification.run_epoch)
    const effectivePlan = admission.plan
    const lease = admission.lease
    let finalRecord: TaskRecord
    let managedSpec: ManagedStartSpec
    let isolation: PreparedIsolation | undefined
    if (this.#isolation.isolates(spec)) {
      const prepared = await this.#isolation.prepare(spec, claimed.task_id)
      if (!prepared.ok) {
        return this.#failSpawn({
          claimed, registration, spec, executionMode, lease,
          error_message: `isolation_unavailable: ${prepared.reason}`,
          failure_kind: "isolation_unavailable",
        })
      }
      isolation = prepared
    }
    try {
      const renamedRecord: TaskRecord = registration.name === claimed.name ? claimed : { ...claimed, name: registration.name }
      const effectiveRecord: TaskRecord = {
        ...renamedRecord,
        model: effectivePlan.model,
        ...(effectivePlan.resolved_model === undefined ? {} : { resolved_model: effectivePlan.resolved_model }),
        ...(effectivePlan.fallback_models === undefined ? {} : { fallback_models: effectivePlan.fallback_models }),
        ...(isolation === undefined ? {} : { isolation: isolation.spec }),
      }
      managedSpec = buildManagedSpec({
        record: effectiveRecord,
        spec,
        plan: effectivePlan,
        cwd: isolation === undefined ? this.#options.cwd : isolation.handle.mergedDir,
        stateDir: this.#options.store.stateDir,
      })
      // Persist the mode-neutral rebuild spec for BOTH execution modes: v1 carries only safe
      // launch facts (effective prompt, instructions, tool names, cwd) - never executable tools,
      // extensions, or member env.
      const spawnSpec = buildSpawnSpecV1(managedSpec)
      finalRecord = {
        ...effectiveRecord,
        spawn_spec: isolation === undefined ? spawnSpec : { ...spawnSpec, isolation: isolation.spec },
      }
      this.#options.store.replace(finalRecord)
      if (isolation !== undefined) this.#isolation.bind(finalRecord.task_id, isolation.handle, isolation.baseline)
      if (spec.run_in_background === true) this.#background.add(finalRecord.task_id)
    } catch {
      if (isolation !== undefined) await this.#isolation.discard(claimed.task_id)
      return this.#failSpawn({
        claimed, registration, spec, executionMode, lease, error_message: "spawn bookkeeping failed",
      })
    }
    releaseResidency?.()
    const runner = this.#options.runners[executionMode]
    const context: LaunchContext = { record: finalRecord, managedSpec, runner, model: effectivePlan.model }
    const startParts = {
      run_epoch: finalRecord.notification.run_epoch,
      ...(isolation === undefined ? {} : { isolation: { backend: isolation.spec.backend, merged_dir: isolation.spec.merged_dir } }),
      ...(effectivePlan.resolved_model !== undefined ? { resolved_model: effectivePlan.resolved_model } : {}),
      ...(registration.warning !== undefined ? { name_warning: registration.warning } : {}),
    }

    if (lease !== undefined) {
      const launched = await this.#launch(context)
      if (!launched.ok) {
        return {
          kind: "start_failed",
          task_id: finalRecord.task_id,
          name: registration.name,
          ...(finalRecord.category !== undefined ? { category: finalRecord.category } : {}),
          ...(finalRecord.agent_type !== undefined ? { subagent_type: finalRecord.agent_type } : {}),
          execution_mode: executionMode,
          model: finalRecord.model,
          ...(finalRecord.resolved_model !== undefined ? { resolved_model: finalRecord.resolved_model } : {}),
          run_in_background: spec.run_in_background === true,
          error_message: launched.error,
          ...(launched.failure_kind === undefined ? {} : { failure_kind: launched.failure_kind }),
          ...(launched.failure_reason === undefined ? {} : { failure_reason: launched.failure_reason }),
        }
      }
      return {
        kind: "started",
        task_id: finalRecord.task_id,
        status: launched.queue_position === undefined ? "running" : "pending",
        name: registration.name,
        ...(launched.queue_position === undefined ? {} : { queue_position: launched.queue_position }),
        ...startParts,
        // A start-time chain fallback rewrote both before the child came up, so the caller must be
        // told the model it actually got and the epoch its completion will arrive under.
        ...(launched.run_epoch === undefined ? {} : { run_epoch: launched.run_epoch }),
        ...(launched.resolved_model === undefined ? {} : { resolved_model: launched.resolved_model }),
      }
    }

    const position = this.#concurrency.enqueue(plan.model, finalRecord.task_id, finalRecord.notification.run_epoch, () => {
      void this.#launch(context)
    })
    return {
      kind: "started",
      task_id: finalRecord.task_id,
      status: "pending",
      name: registration.name,
      queue_position: position,
      ...startParts,
    }
  }

  async continueTask(
    taskIdOrName: string,
    prompt: string,
    deliverAs: "steer" | "followUp" = "followUp",
  ): Promise<ContinueResult> {
    const outcome = await this.#steering.sendToTask({ idOrName: taskIdOrName, message: prompt, deliverAs })
    return toContinueResult(outcome)
  }

  sendToTask(input: SendInput): Promise<SendOutcome> {
    return this.#steering.sendToTask(input)
  }

  async interruptTask(idOrName: string): Promise<InterruptOutcome> {
    const outcome = await this.#steering.interruptTask(idOrName)
    if (outcome.kind === "interrupted") {
      this.#removeCapacityWaiter(outcome.task_id)
      this.#releaseSlotForTask(outcome.task_id)
    }
    return outcome
  }

  async cancelTask(idOrName: string, reason?: string, options?: CancelOptions): Promise<CancelOutcome> {
    const outcome = await this.#steering.cancelTask(idOrName, reason, options)
    if (outcome.kind === "cancelled") {
      this.#removeCapacityWaiter(outcome.task_id)
      this.#releaseSlotForTask(outcome.task_id)
      // A cancelled task never runs again, so no epoch of it may keep a lane slot - including a run
      // whose live handle this manager already let go of, or never had (still launching). Only a live
      // handle whose abort was skipped keeps its slot until its settled outcome releases it.
      if (options?.abort !== "skip" || !this.#live.has(outcome.task_id)) this.#concurrency.releaseTask(outcome.task_id)
    }
    return outcome
  }

  get(taskId: string): TaskRecord | undefined {
    return this.#tryLoad(taskId) ?? undefined
  }

  hasPendingSends(taskId: string): boolean {
    return (this.#sendCounts.get(taskId) ?? 0) > 0 || (this.#steering.hasPendingSends(taskId) ?? false)
  }

  tryClaimEviction(taskId: string): boolean {
    if ((this.#sendCounts.get(taskId) ?? 0) > 0 || this.#evicting.has(taskId)) return false
    this.#evicting.add(taskId)
    return true
  }

  releaseEviction(taskId: string): void {
    this.#evicting.delete(taskId)
  }

  isEvicting(taskId: string): boolean {
    return this.#evicting.has(taskId)
  }

  tryBeginSend(taskId: string): boolean {
    if (this.#evicting.has(taskId)) return false
    this.#sendCounts.set(taskId, (this.#sendCounts.get(taskId) ?? 0) + 1)
    return true
  }

  endSend(taskId: string): void {
    const count = this.#sendCounts.get(taskId) ?? 0
    if (count <= 1) {
      this.#sendCounts.delete(taskId)
      // The last pending send drained: a terminal resident that was unevictable is evictable now.
      this.#residency.notify(this.#tryLoad(taskId)?.parent_session_id)
    } else {
      this.#sendCounts.set(taskId, count - 1)
    }
  }

  get concurrency(): TaskConcurrency { return this.#concurrency }

  findTaskByChildSession(sessionId: string): TaskRecord | undefined {
    return this.#options.store.list().records.find((record) => record.child_session_id === sessionId
      && record.status === "running" && this.#live.has(record.task_id))
  }

  list(scope: ListScope): readonly ListedTask[] {
    const records = this.#options.store.list().records
    const filtered = scope.scope === "all" ? records : records.filter((record) => inSession(record, scope.session_id))
    return filtered.map((record) => {
      const position = record.status === "pending" ? this.#concurrency.queuePosition(record.model, record.task_id) : undefined
      return position === undefined ? { record } : { record, queue_position: position }
    })
  }

  forget(taskId: string): void {
    // A cancel tears the child down through here before its caller releases the slot, and the live
    // entry that names the stopped run's lease is gone after this line.
    if (this.#tryLoad(taskId)?.status === "cancelled") this.#releaseSlotForTask(taskId)
    // Eviction, suspension, and destruction all land here; each frees (or is about to free) a slot.
    this.#residency.notify(this.#tryLoad(taskId)?.parent_session_id)
    // The outcome tracker stops settling a handle once it is forgotten, so a run suspended here
    // never reaches its own release: free its lane now or every suspension leaks a slot (#8973).
    this.#releaseSlotForTask(taskId)
    this.#outcome.release(taskId)
    this.#verificationCatalogue.delete(taskId)
    this.#verificationBaseline.delete(taskId)
    this.#repairInFlight.delete(taskId)
    this.#live.get(taskId)?.unsubscribe()
    this.#live.delete(taskId)
    const subscribers = this.#childSubscribers.get(taskId)
    if (subscribers !== undefined) {
      for (const unsubscribe of subscribers.values()) unsubscribe()
      this.#childSubscribers.delete(taskId)
    }
    this.#background.delete(taskId)
    this.#released.delete(taskId)
    this.#runStats.delete(taskId)
    const residency = this.#tryLoad(taskId)?.residency_state
    if (residency !== "persisted_only" && residency !== "rpc_detached") this.#steering.dropPending(taskId)
  }

  getResidentHandle(taskId: string): ManagedChildHandle | undefined { return this.#live.get(taskId)?.handle ?? this.#cleanupOwners.get(taskId) }

  subscribeChild(taskId: string, listener: ManagedChildListener): () => void {
    const live = this.#live.get(taskId)?.handle
    // Idempotent cleanup: callers (task_output waits) may release twice, and the manager sweeps too.
    if (live !== undefined) return onceOnly(live.subscribe(listener))
    const subscribers = this.#childSubscribers.get(taskId) ?? new Map<ManagedChildListener, () => void>()
    this.#childSubscribers.set(taskId, subscribers)
    // Pending listeners have no handle yet. A placeholder lets cleanup remove them before promotion.
    subscribers.set(listener, () => {
      subscribers.delete(listener)
      if (subscribers.size === 0) this.#childSubscribers.delete(taskId)
    })
    return () => subscribers.get(listener)?.()
  }

  runStatsSnapshot(taskId: string): TaskRunStats | undefined { return this.#runStats.get(taskId)?.snapshot(this.#now()) }

  residentTaskIds(): readonly string[] { return [...new Set([...this.#live.keys(), ...this.#cleanupOwners.keys()])] }

  residencyChanged(parentSessionId: string): Promise<void> { return this.#residency.changed(parentSessionId) }

  promoteToBackground(taskId: string): boolean {
    const promoted = !this.wasBackground(taskId)
    this.#background.add(taskId)
    // Background intent must survive the owning process: a resumed manager reads the RECORD to
    // decide terminal notification, so promotion is persisted, not just held in memory.
    // A promoted task is neither a background spawn nor a plain foreground run: the mode records
    // the hand-off so terminal accounting keeps the two populations apart.
    this.#options.store.mutate(taskId, (record) => {
      const backgroundMode = promotedBackgroundMode(record)
      if (record.notify_on_terminal && record.background_mode === backgroundMode) return record
      return { ...record, notify_on_terminal: true, background_mode: backgroundMode }
    })
    return promoted
  }

  // The record is authoritative (it outlives this process); the in-memory set only answers for
  // tasks whose record is unsaved or unreadable.
  wasBackground(taskId: string): boolean {
    const record = this.#tryLoad(taskId)
    if (record === null) return this.#background.has(taskId)
    return record.notify_on_terminal
  }

  respawn(record: TaskRecord, resumeSessionPath?: string): Promise<RespawnResult> {
    return respawnWithWorkpool({
      record,
      sessionPath: resumeSessionPath,
      stateDir: this.#options.store.stateDir,
      runners: this.#options.runners,
      rpcRunner: this.#rpcRespawnRunner,
      // A revived ordinary child gets the same spawn-time verification snapshot a fresh launch
      // takes (catalogue + baseline), so the host can still capture evidence at its completion.
      // No child, revived or initial, carries a verification tool (see #verificationSnapshotFor).
      attachVerification: (spec) => this.#verificationSnapshotFor(record, spec),
      beforeLaunch: () => {
        // Respawn bypasses start's status transition; persist the same durable launch boundary
        // without changing the status or epoch that lifecycle reattachment owns. It is also the last
        // point before the child runs: a stop, a kill or another owner that landed while the revival
        // was preparing refuses the launch here instead of starting work nobody will keep.
        let moved = false
        const stamped = this.#options.store.mutate(record.task_id, (fresh) => {
          moved = (isTerminalRecord(fresh) && !isTerminalRecord(record)) || fresh.killed === true || fresh.host_pid !== record.host_pid || fresh.notification.run_epoch !== record.notification.run_epoch
          return moved || fresh.started_at !== undefined ? fresh : { ...fresh, started_at: nowIso(this.#now) }
        })
        if (stamped === null) throw new Error(`Task record not found before respawn: ${record.task_id}`)
        if (moved) throw new Error(`Task ${record.task_id} was stopped or moved before its respawn launched`)
      },
      ...(this.#options.trustedRespawnLaunch === undefined
        ? {}
        : { trustedLaunch: this.#options.trustedRespawnLaunch }),
      ...(this.#options.resolveInheritedExtensions === undefined
        ? {}
        : { inheritedExtensions: this.#options.resolveInheritedExtensions }),
    }, this.workpools, () => this.get(record.task_id)?.notification.run_epoch ?? -1)
  }

  reattach(record: TaskRecord, handle: ManagedChildHandle): Promise<ReattachResult> {
    return reattachManagedTask({
      record,
      handle,
      store: this.#options.store,
      hostPid: this.#hostPid,
      now: this.#now,
      isAttached: (taskId) => this.#live.has(taskId),
      attachLive: (fresh, attachedHandle) => {
        const unsubscribe = this.#subscribeChildFacts(attachedHandle, fresh.task_id)
        this.#live.set(fresh.task_id, { handle: attachedHandle, model: fresh.model, unsubscribe })
        this.#attachChildSubscribers(fresh.task_id, attachedHandle)
        return unsubscribe
      },
      detachLive: (taskId, attachedHandle, unsubscribe) => {
        unsubscribe()
        if (this.#live.get(taskId)?.handle === attachedHandle) this.#live.delete(taskId)
      },
      destroyAttached: (taskId: string) =>
        (this.#options.destruction ?? NOOP_DESTRUCTION).destroyResidentTask(taskId, "revive_failure"),
      armOutcome: (fresh, attachedHandle, epoch) => {
        this.#outcome.trackOutcome(fresh.task_id, attachedHandle, fresh.model, epoch)
        void this.#steering.notifyStarted(fresh.task_id)
      },
    })
  }

  waitFor(taskId: string, options?: { readonly signal?: AbortSignal }): Promise<TaskRecord> {
    const signal = options?.signal
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("waitFor aborted"))
    const id = parseTaskId(taskId)
    const current = this.#tryLoad(id)
    if (current !== null && current !== undefined && isTerminalRecord(current)) return Promise.resolve(current)
    const list = this.#waiters.get(id) ?? []
    if (signal === undefined) {
      // task_output races completion.then() against a timeout without a catch; keeping this path
      // resolve-only is safe until that caller starts passing an AbortSignal.
      return new Promise((resolve) => {
        list.push({ resolve, reject: () => undefined, cleanup: () => undefined })
        this.#waiters.set(id, list)
      })
    }
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const index = list.indexOf(waiter)
        if (index < 0) return
        list.splice(index, 1)
        if (list.length === 0) this.#waiters.delete(id)
        waiter.reject(signal.reason ?? new Error("waitFor aborted"))
      }
      const waiter: TaskWaiter = {
        resolve,
        reject,
        cleanup: () => signal.removeEventListener("abort", onAbort),
      }
      list.push(waiter)
      this.#waiters.set(id, list)
      signal.addEventListener("abort", onAbort, { once: true })
    })
  }

  // Test-only observability for proving waitFor never retains empty waiter-map keys.
  waiterKeyCount(): number { return this.#waiters.size }

  // Test-only observability for proving the release guard never grows unboundedly across revives.
  releasedKeyCount(): number { return this.#released.size }

  async #launch(initial: LaunchContext): Promise<LaunchOutcome> {
    const startResult = this.#options.store.transition(initial.record.task_id, { type: "start", timestamp: nowIso(this.#now) })
    if (!startResult.applied) {
      this.#releaseSlot(initial.record.task_id, initial.model, initial.record.notification.run_epoch)
      this.#steering.dropPending(initial.record.task_id)
      this.#settleWaiters(initial.record.task_id)
      return { ok: false, error: "task was cancelled before launch" }
    }

    let context = this.#withVerificationSnapshot(initial)
    let handle: ManagedChildHandle
    for (;;) {
      const { record, managedSpec, runner, model } = context
      try {
        handle = await runner.start(managedSpec)
        break
      } catch (error) { // no-excuse-ok: catch - runner boundary converts every thrown value into a public classification.
        // A child that cannot serve this model can still serve the next entry of its chain, and
        // nothing has run yet, so advancing costs no duplicated work. Every other failure kind would
        // reproduce identically on the next entry, so only an admission refusal walks the chain.
        const advanced = this.#advanceStartFallback(context, error)
        if (advanced !== undefined) {
          if (advanced.kind === "queued") {
            return { ok: true, run_epoch: advanced.runEpoch, resolved_model: advanced.resolvedModel, queue_position: advanced.queuePosition }
          }
          if (advanced.kind === "stale") {
            this.#releaseSlot(record.task_id, model, record.notification.run_epoch)
            this.#settleWaiters(record.task_id)
            return { ok: false, error: "task stopped during launch" }
          }
          // The next chain rung is a fresh launch: take the spawn-time verification snapshot again
          // so a child that starts after an admission-refusal fallback is captured host-side under
          // the run it actually became.
          context = this.#withVerificationSnapshot(advanced.context)
          continue
        }
        const failure = describeStartFailure(error)
        this.#releaseSlot(record.task_id, model, record.notification.run_epoch)
        if (failOwnedRun(this.#options.store, launchRunOf(record), nowIso(this.#now), failure)) {
          this.#options.store.appendEvent(record.task_id, {
            type: "task_start_failed",
            payload: { error_message: failure.errorMessage, ...failure.eventFacts },
          })
          this.#steering.dropPending(record.task_id)
        }
        this.#settleWaiters(record.task_id)
        return {
          ok: false,
          error: failure.errorMessage,
          ...(failure.failureKind === undefined ? {} : { failure_kind: failure.failureKind }),
          ...(failure.failureReason === undefined ? {} : { failure_reason: failure.failureReason }),
        }
      }
    }

    const { record, managedSpec, runner, model } = context
    const current = this.#tryLoad(record.task_id)
    const cancelled = current?.status === "cancelled"
    if (!this.#ownsLaunch(context, current)) {
      await this.#discardStaleLaunch(context, handle)
      return { ok: false, error: cancelled ? "task was cancelled during launch" : "task stopped during launch" }
    }

    const unsubscribe = this.#subscribeChildFacts(handle, record.task_id)
    this.#live.set(record.task_id, {
      handle,
      model,
      unsubscribe,
      managedSpec,
      runner,
    })
    this.#attachChildSubscribers(record.task_id, handle)
    this.#recordSpawnFacts(record.task_id, handle)
    void this.#isolation.stamp(record.task_id, handle)
    this.#outcome.trackOutcome(record.task_id, handle, model, record.notification.run_epoch)
    void this.#steering.notifyStarted(record.task_id)
    return {
      ok: true,
      run_epoch: record.notification.run_epoch,
      ...(record.resolved_model === undefined ? {} : { resolved_model: record.resolved_model }),
    }
  }

  /**
   * Take the spawn-time verification snapshot for an ordinary run. Ordinary means NOT a DAG node
   * (the DAG gate owns that path) and NOT a team member (out-of-process, unreachable from a live
   * host closure). The snapshot is retaken on every launch — start, queued promotion, runtime
   * fallback, revival — so the completion capture runs the catalogue and baseline of the run that
   * actually started. It is HOST state: never the store, never the spawn_spec, never JSONL.
   */
  #withVerificationSnapshot(context: LaunchContext): LaunchContext {
    return { ...context, managedSpec: this.#verificationSnapshotFor(context.record, context.managedSpec) }
  }

  // The single trust decision for ordinary verification. DAG nodes (the DAG gate owns that path),
  // team members (out-of-process, unreachable from a live host closure) and curated read-only
  // children (a command-executing capability would widen their documented contract) take no
  // snapshot at all. EVERY child - ordinary included - leaves this method without a verification
  // tool: verification authority is the host's, and only the host capture at completion may write
  // evidence or a verdict. The returned spec is the one that was passed in.
  #verificationSnapshotFor(record: TaskRecord, managedSpec: ManagedStartSpec): ManagedStartSpec {
    if (record.owner?.kind === "dag" || record.team_role === "member") return managedSpec
    if (record.agent_type !== undefined && CURATED_READONLY_AGENT_NAMES.has(record.agent_type)) return managedSpec
    // A tree the host cannot snapshot must fail closed as verification_provenance_unknown, never
    // as an invented empty change set.
    let baseline: WorkspaceBaseline | null
    try {
      baseline = snapshotWorkspace(managedSpec.cwd)
    } catch {
      baseline = null
    }
    const taskId = record.task_id
    const authority = approvalAuthorityFor(managedSpec.cwd, this.#options.verificationAuthorityRoot)
    // ONE approval snapshot for both halves of the gate: the catalogue the host capture executes
    // and the completion gate that accepts. Reading twice would let a mid-run write reach one.
    const approvals = readApprovals(authority, WORKSPACE_ID)
    // The catalogue is resolved once, at spawn, from that snapshot: the required set cannot be
    // relaxed later by deleting an approval record the run can write to.
    this.#verificationCatalogue.set(
      taskId,
      resolveCatalogue({ projectRoot: managedSpec.cwd, workspaceId: WORKSPACE_ID, changedFiles: null, authority, approvals }),
    )
    this.#verificationBaseline.set(taskId, baseline)
    return managedSpec
  }

  // The ordinary-completion gate. Only runs the host actually equipped (a catalogue snapshot exists)
  // are gated; a DAG node, a team member or a curated child never reaches this map and keeps its own
  // path. A run without a catalogue keeps its historical behaviour - it still publishes success -
  // but honestly marked "unverified": only a gate verdict of "verified" may ever write "verified".
  //
  // Authority boundary: the host runs the approved catalogue HERE, through the SAME capture and
  // evidence/receipt machinery the delegated fold uses, BEFORE the gate is asked. No child can
  // produce this evidence (no child has a verification tool), so a configured run either verifies
  // from host-written evidence or blocks honestly. The gate remains the sole decider; this method
  // only stages evidence and never computes a verdict of its own.
  // Repair wiring: when the verdict is "blocked" AND the block is attributable to a failed
  // approved check, exactly one repair attempt starts (fire-and-forget) for this (task, epoch).
  // Every other block keeps its current behaviour and gains an explicit repair_skipped reason.
  async #verifyOrdinaryCompletion(taskId: string, owned: TaskRecord, captureEvidence = true): Promise<CompletionGateVerdict> {
    const catalogue = this.#verificationCatalogue.get(taskId)
    if (catalogue === undefined) {
      return { verification: "unverified", reason: "this run carried no verification catalogue, so no verification is claimed" }
    }
    const epoch = owned.notification.run_epoch
    const evidenceRoot = join(this.#options.store.stateDir, "verifications")
    const workspaceDir = this.#repairWorkspaceDir(owned)
    // ONE requirement set from the spawn-time catalogue, shared by the capture and the gate (the
    // delegated fold's rule): the two sides can never disagree about which checks are required.
    const required = catalogueChecks(catalogue)
    const baseline = this.#verificationBaseline.get(taskId) ?? null
    // ONE pinned revision for the whole capture, taken after the child settled and before the first
    // approved check runs. Every record and the gate use this value, so a check's own write cannot
    // invalidate the evidence it just produced. An unattributable tree is left unpinned and the
    // gate names provenance_unknown instead of this method inventing a verdict.
    let pinnedRevision: string | null = null
    let staleVerdict: CompletionGateVerdict | null = null
    if (captureEvidence && catalogue.status === "configured" && required.length > 0 && baseline !== null) {
      let revision: string | null = null
      try {
        revision = workspaceRevision(workspaceDir)
      } catch (error) {
        log("senpi-task ordinary verification revision unavailable", { taskId, error: String(error) })
        revision = null
      }
      if (revision !== null) {
        pinnedRevision = revision
        try {
          const capture = createOrdinaryVerificationCapture({
            store: createFileEvidenceStore(evidenceRoot),
            projectDir: workspaceDir,
            currentRevision: () => revision,
            isCancelled: () => this.#tryLoad(taskId)?.status === "cancelled",
          })
          await capture.capture({
            // Identity is (parent task id, epoch, attempt). The attempt advances with the epoch so
            // a late writer from an older run cannot overwrite a newer run's evidence.
            binding: { taskId, sessionId: owned.parent_session_id, epoch },
            changedFiles: changedPathsSince(workspaceDir, baseline),
            available: required,
            required,
            attempt: epoch + 1,
          })
        } catch (error) {
          // A staging failure is not a pass: the gate reads what actually landed and reports the
          // missing evidence. No fallback and no second runner.
          log("senpi-task ordinary verification capture failed", { taskId, error: String(error) })
        }
        // Compare ONCE, after the checks, against the SAME pinned revision the records carry. A
        // check that writes the tree (or a concurrent edit) leaves records describing a tree that
        // no longer exists; acceptance is never evaluated for a moved tree.
        let postCaptureRevision: string | null = null
        try {
          postCaptureRevision = workspaceRevision(workspaceDir)
        } catch {
          postCaptureRevision = null
        }
        if (postCaptureRevision !== revision) {
          staleVerdict = {
            verification: "blocked",
            code: "verification_stale",
            reason:
              "the workspace revision changed while the approved checks ran: " +
              `pinned ${revision}, observed ${postCaptureRevision ?? "unavailable"}`,
          }
        }
      }
    }
    const provenanceUnavailable = catalogue.status === "configured" && required.length > 0 && baseline === null
    const preconditions: CompletionGatePreconditions | undefined = provenanceUnavailable
      ? { baseline: "unavailable" }
      : undefined
    const verdict = staleVerdict ?? evaluateOrdinaryCompletion({
      taskId,
      catalogue,
      requirements: required,
      evidenceRoot,
      workspaceDir,
      epoch,
      ...(pinnedRevision === null ? {} : { sourceRevision: pinnedRevision }),
      ...(preconditions === undefined ? {} : { preconditions }),
    })
    this.#maybeStartRepair(taskId, owned, verdict, catalogue)
    return verdict
  }

  // Repair eligibility: only a failed approved check is repairable. Cancellation, an invalid
  // catalogue, malformed/foreign/untrusted evidence (missing/stale/malformed), and
  // verification_provenance_unknown all keep their current blocked behaviour plus an explicit
  // reason. Only verification_failed on a configured catalogue may start a repair attempt.
  #isRepairEligible(
    owned: TaskRecord,
    verdict: CompletionGateVerdict,
    catalogue: OrdinaryCatalogue,
  ): RepairEligibility {
    if (verdict.verification !== "blocked") return { eligible: false, reason: "not_blocked" }
    if (owned.status === "cancelled" || owned.cancel_requested !== undefined) return { eligible: false, reason: "cancelled" }
    if (catalogue.status === "invalid") return { eligible: false, reason: "invalid_catalogue" }
    if (catalogue.status !== "configured") return { eligible: false, reason: `catalogue_not_configured:${catalogue.status}` }
    switch (verdict.code) {
      case "verification_failed":
        return { eligible: true, reason: "failed_approved_check" }
      case "verification_provenance_unknown":
        return { eligible: false, reason: "verification_provenance_unknown" }
      case "verification_evidence_malformed":
        return { eligible: false, reason: "verification_evidence_malformed" }
      case "verification_evidence_missing":
        return { eligible: false, reason: "verification_evidence_missing" }
      case "verification_stale":
        return { eligible: false, reason: "verification_stale" }
      default:
        return { eligible: false, reason: `non_repairable:${verdict.code ?? "unknown"}` }
    }
  }

  #repairWorkspaceDir(record: TaskRecord): string {
    const spec = record.spawn_spec
    if (spec !== undefined && Object.prototype.toString.call(spec.cwd) === "[object String]" && spec.cwd.length > 0) return spec.cwd
    return this.#options.cwd
  }

  // Workspace identity derived from the spawn spec cwd. The repair attempt id forbids path
  // separators, so the cwd is hashed to a safe segment instead of being stored verbatim; the
  // hash still attributes the attempt to exactly the tree the run executed in.
  #repairWorkspaceIdentity(workspaceDir: string): string {
    return createHash("sha256").update(workspaceDir).digest("hex").slice(0, 16)
  }

  // Original failed evidence for attributability: the failed check ids and evidence file names
  // for this epoch. Malformed/unreadable files are skipped (the gate already judged them); when
  // nothing failed is found the lists stay empty and the orchestrator fails closed as
  // diagnosis_unavailable instead of inventing a failure.
  #collectRepairEvidence(
    taskId: string,
    epoch: number,
    evidenceRoot: string,
  ): RepairEvidenceCollection {
    let listed: readonly string[]
    try {
      listed = createFileEvidenceStore(evidenceRoot).listVerifications(taskId)
    } catch {
      return { failedCheckIds: [], failedEvidenceIds: [] }
    }
    const failedCheckIds = new Set<string>()
    const failedEvidenceIds = new Set<string>()
    for (const file of listed) {
      if (!file.endsWith(".json")) continue
      let text: string
      try {
        text = readFileSync(join(evidenceRoot, taskId, file), "utf8")
      } catch {
        continue
      }
      const record = parseVerificationRecord(text)
      if (record === null) continue
      if (record.workerAttempt !== undefined && record.workerAttempt !== epoch) continue
      if (isVerificationAccepting(record.status)) continue
      failedCheckIds.add(record.checkId)
      failedEvidenceIds.add(file)
    }
    return { failedCheckIds: [...failedCheckIds].sort(), failedEvidenceIds: [...failedEvidenceIds].sort() }
  }

  // Injectable invoker seam: tests supply a scripted orchestrator invoker; production defaults
  // to the real host adapter from src/repair/model-diagnosis.ts. Without a live model the adapter
  // throws typed model_unavailable before any model call, so the attempt settles repair_failed
  // and the task stays blocked - a diagnosis is never fabricated.
  #resolveRepairInvoker(workspaceDir: string): RepairAttemptInvoker {
    const injected = this.#options.repair?.invoker
    if (injected !== undefined) return injected
    return async (request) => {
      const raw = createHostDiagnosisInvoker({
        runner: {
          start: async () => {
            throw new RunnerError({
              kind: "model_unavailable",
              message: "model_unavailable: repair diagnosis has no live model in this host; no diagnosis child was started",
            })
          },
        },
        childSpecFor: (prompt) => {
          // SAFETY: the host builds the same launch fields toChildSpec sets; ChildSpec names that closed shape.
          const childSpec = {
            taskId: request.diagnosis.taskId,
            cwd: workspaceDir,
            sessionDir: join(this.#options.store.stateDir, "children", request.diagnosis.taskId, "sessions", request.diagnosis.taskId),
            depth: 1,
            parentSessionId: "",
            rootSessionId: "",
            prompt,
          } as ChildSpec;
          return childSpec;
        },
      })
      await raw({
        systemInstructions: "Repair diagnosis host context: cite only the host-observed diagnosis JSON.",
        diagnosisContextJson: JSON.stringify(request.diagnosis),
        outputContract: "No plan is synthesized by the default host adapter.",
      }).catch((error) => {
        // Preserve the production adapter's typed model_unavailable failure with the code in the
        // message, so the attempt settles repair_failed naming model_unavailable explicitly.
        if (RunnerError.is(error) && error.failure.kind === "model_unavailable") {
          throw new RunnerError({
            kind: "model_unavailable",
            message: `model_unavailable: ${error.failure.message}`,
          })
        }
        throw error
      })
      return {
        status: "no_defensible_diagnosis",
        reason: "model_unavailable: default host adapter produced no plan; refusing to fabricate a repair",
      }
    }
  }

  // Default repair applier: the real authorized executor over the run's own workspace and the
  // pre-repair revision baseline the manager snapshotted for this attempt. The plan's file set is
  // the closed write allowlist (applyRepairEdits enforces it), and a rejected receipt - revision
  // conflict, out-of-plan path, protected path, no on-disk change, edit failure - throws so the
  // orchestrator settles repair_failed. A rejection is never reported as a successful empty change
  // set. An injected executor still overrides the whole seam for tests.
  #resolveRepairEditExecutor(workspaceDir: string, baselineRevision: string): RepairEditExecutor {
    const injected = this.#options.repair?.editExecutor
    if (injected !== undefined) return injected
    return async (request) => {
      const receipt = await applyRepairEdits({
        plan: request.plan,
        workspaceDir,
        baselineRevision,
        edits: request.edits,
      })
      if (receipt.status !== "applied") {
        const failures = receipt.failures
          .map((failure) =>
            failure.path === undefined
              ? `${failure.code}: ${failure.message}`
              : `${failure.code}(${failure.path}): ${failure.message}`,
          )
          .join("; ")
        throw new Error(`repair edits rejected: ${failures.length > 0 ? failures : "no failure detail"}`)
      }
      return { changedFiles: receipt.files.map((file) => file.path) }
    }
  }

  #resolveRepairRunner(): VerificationRunner {
    return this.#options.repair?.runner ?? runVerificationCommand
  }

  // Fire-and-forget entry from the sync gate path. Starts exactly one attempt per (task, epoch);
  // non-repairable blocks keep current behaviour and gain an explicit repair_skipped reason.
  #maybeStartRepair(taskId: string, owned: TaskRecord, verdict: CompletionGateVerdict, catalogue: OrdinaryCatalogue): void {
    const epoch = owned.notification.run_epoch
    if (verdict.verification !== "blocked") return
    const eligibility = this.#isRepairEligible(owned, verdict, catalogue)
    if (!eligibility.eligible) {
      try {
        this.#options.store.appendEvent(taskId, {
          type: "repair_skipped",
          payload: { reason: eligibility.reason, code: verdict.code, verification_status: "blocked" },
        })
      } catch {
        // The event log must never change gate behaviour.
      }
      return
    }
    const live = this.#tryLoad(taskId)
    if (live?.status === "cancelled" || live?.cancel_requested !== undefined) {
      try {
        this.#options.store.appendEvent(taskId, {
          type: "repair_skipped",
          payload: { reason: "cancelled", code: verdict.code, verification_status: "blocked" },
        })
      } catch {
        // The event log must never change gate behaviour.
      }
      return
    }
    if (this.#repairInFlight.get(taskId) === epoch) return
    this.#repairInFlight.set(taskId, epoch)
    const pending = this.#runRepairForBlocked(taskId, epoch, verdict, catalogue)
    void pending.then(
      () => {
        if (this.#repairInFlight.get(taskId) === epoch) this.#repairInFlight.delete(taskId)
      },
      (error) => {
        if (this.#repairInFlight.get(taskId) === epoch) this.#repairInFlight.delete(taskId)
        log("senpi-task repair attempt failed", { taskId, error: String(error) })
      },
    )
  }

  // One repair attempt for a blocked run. Persists task id, epoch, attempt id, workspace identity
  // and the original failed evidence (via runRepairAttempt's durable save) before any model call.
  // A stale epoch publishes nothing: when the record moved on, no event is appended and no record
  // field is touched. On repair_failed/blocked the task stays blocked and the repair_finished
  // event says so; only a re-asked gate verdict of "verified" may correct the terminal (see
  // #publishVerifiedRepair) - never the repair state or a model claim.
  async #runRepairForBlocked(
    taskId: string,
    epoch: number,
    verdict: CompletionGateVerdict,
    catalogue: OrdinaryCatalogue,
  ): Promise<void> {
    const live = this.#tryLoad(taskId)
    if (live === null || live.notification.run_epoch !== epoch) return
    if (live.status === "cancelled" || live.cancel_requested !== undefined) return
    const workspaceDir = this.#repairWorkspaceDir(live)
    const evidenceRoot = join(this.#options.store.stateDir, "verifications")
    const repairStoreRoot = join(this.#options.store.stateDir, "repairs")
    const { failedCheckIds, failedEvidenceIds } = this.#collectRepairEvidence(taskId, epoch, evidenceRoot)
    let diagnosisRevision: string
    try {
      diagnosisRevision = workspaceRevision(workspaceDir)
    } catch {
      diagnosisRevision = "unknown"
    }
    const outcome = await runRepairAttempt({
      taskId,
      runEpoch: epoch,
      workspaceId: this.#repairWorkspaceIdentity(workspaceDir),
      catalogue,
      evidenceRoot,
      workspaceDir,
      repairStoreRoot,
      failedCheckIds,
      failedEvidenceIds,
      diagnosisRevision,
      invoker: this.#resolveRepairInvoker(workspaceDir),
      editExecutor: this.#resolveRepairEditExecutor(workspaceDir, diagnosisRevision),
      runner: this.#resolveRepairRunner(),
      isCancelled: () => {
        const current = this.#tryLoad(taskId)
        return current?.status === "cancelled" || current?.cancel_requested !== undefined
      },
    })
    // Stale epoch guard: the record moved on while the attempt ran - publish nothing.
    const current = this.#tryLoad(taskId)
    if (current === null || current.notification.run_epoch !== epoch) return
    // CANONICAL TERMINAL-RECORD SEMANTICS
    // - status is the run's lifecycle fact (the terminal transition that ended the run).
    // - verification_status is the completion gate's final word about the CURRENT evidence.
    // - error_message is the CURRENT terminal error only; it is absent on a clean success.
    // A gate-verified repair upgrades the gate-blocked terminal IN PLACE through the same
    // store.mutate primitive and the same epoch fence, clearing the error text the block wrote.
    // The original verification failure is HISTORY and stays readable elsewhere: the pre-repair
    // evidence file (attempt 1) stays on disk, the repair attempt store keeps failedCheckIds /
    // failedEvidenceIds / outcome, and the task event log keeps verification_blocked and
    // repair_finished. History is never re-used as the live error_message.
    // Re-ask the gate over the fresh evidence - never trusting the repair state or the model - and
    // only a verified verdict reaches the correction. Anything short of verified leaves the
    // existing terminal untouched, so a failed repair is still reported as the failure it is.
    let publishedVerification: RepairFinishedPayload["verification_status"] = "blocked"
    if (outcome.finalState === "repaired") {
      // The repair already ran the shared capture over the fresh tree; this re-ask only judges its
      // evidence, so it must not execute the catalogue a second time.
      const fresh = await this.#verifyOrdinaryCompletion(taskId, current, false)
      if (fresh.verification === "verified" && this.#publishVerifiedRepair(taskId, epoch, verdict)) {
        publishedVerification = "verified"
      }
    }
    let finishedPayload: RepairFinishedPayload = {
      reason: outcome.reason ?? outcome.gateCode ?? outcome.finalState,
      attempt_id: outcome.attemptId,
      final_state: outcome.finalState,
      gate_verdict: outcome.gateVerdict ?? "blocked",
      verification_status: publishedVerification,
      changed_files: [...outcome.changedFiles],
    };
    if (outcome.gateCode !== undefined) finishedPayload = { ...finishedPayload, gate_code: outcome.gateCode };
    if (outcome.detail !== undefined) finishedPayload = { ...finishedPayload, detail: outcome.detail };
    try {
      this.#options.store.appendEvent(taskId, {
        type: "repair_finished",
        payload: finishedPayload,
      })
    } catch {
      // Bookkeeping must never change the published terminal.
    }
  }

  // The ONLY path that upgrades a gate-blocked terminal to a verified success, and only for the
  // run that produced the block. It runs inside the repair's own epoch fence and the store's own
  // mutate lock, so there is no second completion authority and no write around the gate:
  // - the caller re-asked the gate over fresh evidence and only its "verified" verdict gets here;
  // - the record must still carry the gate's failed terminal for this epoch, identified by the
  //   exact blocked message the gate wrote. An infrastructure failure, a cancellation, a repair
  //   failure, and another epoch's terminal never match, so their real error text is never cleared;
  // - clearing error_message is the point: the gate block it described is no longer the outcome.
  #publishVerifiedRepair(taskId: string, epoch: number, blocked: CompletionGateVerdict): boolean {
    const expectedError = completionBlockedMessage(blocked)
    let published = false
    this.#options.store.mutate(taskId, (record) => {
      if (record.notification.run_epoch !== epoch) return record
      if (record.status !== "error" && record.status !== "completed") return record
      if (record.error_message !== expectedError) return record
      published = true
      return {
        ...record,
        status: "completed",
        error_message: undefined,
        verification_status: "verified",
        updated_at: nowIso(this.#now),
      }
    })
    return published
  }

  /**
   * Advance a refused start onto the next entry of its model chain.
   *
   * Only `model_unavailable` qualifies: it is the one start failure that says "THIS child cannot
   * serve THIS model", so a different model is a real remedy. Every other kind - a depth refusal, a
   * failed session create - would reproduce identically on the next entry and walking would just
   * multiply one failure into N.
   *
   * The epoch MUST advance. `#releaseSlot` is guarded per (task, epoch) and records the highest
   * epoch it has released, so retrying under the same epoch would make the eventual completion's
   * release a silent no-op and leak the lane's lease for the life of the process.
   */
  #advanceStartFallback(
    context: LaunchContext,
    error: unknown,
  ): { kind: "retry"; context: LaunchContext } | { kind: "queued"; runEpoch: number; resolvedModel: ResolvedModelRecord | undefined; queuePosition: number } | { kind: "stale" } | undefined {
    if (!RunnerError.is(error) || error.failure.kind !== "model_unavailable") return undefined
    const record = this.#tryLoad(context.record.task_id)
    // A stop (or another owner) that landed while this start was refusing must end the walk here.
    if (!this.#ownsLaunch(context, record)) return { kind: "stale" }
    const nextModel = record.fallback_models?.[0]
    if (nextModel === undefined) return undefined

    this.#releaseSlot(record.task_id, context.model, record.notification.run_epoch)

    const nextEpoch = nextRunEpoch(record)
    const nextRecord: TaskRecord = {
      ...record,
      model: nextModel.display,
      resolved_model: nextModel,
      fallback_models: record.fallback_models?.slice(1) ?? [],
      fallback_attempts: [
        ...(record.fallback_attempts ?? (record.resolved_model === undefined ? [] : [record.resolved_model])),
        nextModel,
      ],
      updated_at: nowIso(this.#now),
      notification: { ...record.notification, run_epoch: nextEpoch },
      ...(isFallbackHandoff(record) ? { fallback_handoff_epoch: nextEpoch } : {}),
    }
    let advanced = false
    this.#options.store.mutate(record.task_id, (fresh) => {
      if (!this.#ownsLaunch(context, fresh)) return fresh
      advanced = true
      return nextRecord
    })
    if (!advanced) return { kind: "stale" }
    const failure = describeStartFailure(error)
    this.#options.store.appendEvent(record.task_id, {
      type: "task_model_fallback",
      payload: {
        from_model: record.model,
        to_model: nextModel.display,
        error_message: failure.errorMessage,
        ...failure.eventFacts,
      },
    })

    const nextContext: LaunchContext = {
      record: nextRecord,
      managedSpec: {
        ...context.managedSpec,
        model: nextModel.display,
        fallbackModels: nextRecord.fallback_models ?? [],
        ...resolvedReasoningFields(nextModel),
      },
      runner: context.runner,
      model: nextModel.display,
    }
    if (this.#concurrency.tryAcquire(nextModel.display, record.task_id, nextEpoch)) {
      return { kind: "retry", context: nextContext }
    }
    const queuePosition = this.#concurrency.enqueue(nextModel.display, record.task_id, nextEpoch, () => {
      void this.#launchRuntimeFallback(nextContext)
    })
    // The fallback model's lane is full: nothing runs until a slot frees. Say so on the record
    // instead of leaving a bare `running` with no child behind it (omo#9069).
    const queued = { model: nextModel.display, queued_at: nowIso(this.#now), queue_position: queuePosition }
    this.#options.store.mutate(record.task_id, (fresh) =>
      fresh.notification.run_epoch === nextEpoch ? { ...fresh, start_queued: queued } : fresh)
    this.#options.store.appendEvent(record.task_id, { type: "task_start_queued", payload: queued })
    return { kind: "queued", runEpoch: nextEpoch, resolvedModel: nextModel, queuePosition }
  }

  /**
   * The `auto` resolution, asked ONLY when nothing more specific already decided and the config
   * really says `auto` - a user-set mode or a per-agent override must never make a parent session
   * ensure the daemon. The gate memoizes, so one parent session asks at most once and every later
   * child reuses that answer even after the daemon goes down.
   */
  async #autoExecutionMode(
    spec: ManagerStartSpec,
    plan: ResolvedChildPlan,
  ): Promise<{ readonly autoMode?: ExecutionMode }> {
    const gate = this.#options.executionModeGate
    if (gate === undefined || this.#options.config.default_execution_mode !== "auto") return {}
    if (spec.execution_mode !== undefined || plan.agentExecutionMode !== undefined) return {}
    return { autoMode: await gate.ensure() }
  }

  #attachChildSubscribers(taskId: string, handle: ManagedChildHandle): void {
    const subscribers = this.#childSubscribers.get(taskId)
    if (subscribers === undefined) return
    for (const [listener] of subscribers) {
      const detach = handle.subscribe(listener)
      subscribers.set(listener, onceOnly(() => {
        detach()
        subscribers.delete(listener)
        if (subscribers.size === 0) this.#childSubscribers.delete(taskId)
      }))
    }
  }

  // Persist spawn-time facts onto the running record: OS pid (rpc children) and the child's own
  // session id (both modes) so task_output, session_start reconciliation, and external readers
  // (omo-desktop) can join a grandchild session back to this task. Pure folds live in
  // recordSpawnedPid / recordSpawnedChildSession; already-terminal records are left untouched.
  // One exit for every pre-launch refusal: the lease, the reserved name, the background flag and the
  // record's start/fail transitions are released together, so a refusal can never strand capacity.
  #failSpawn(input: {
    readonly claimed: TaskRecord
    readonly registration: { readonly name: string }
    readonly spec: ManagerStartSpec
    readonly executionMode: ExecutionMode
    readonly lease: { release(): void } | undefined
    readonly error_message: string
    readonly failure_kind?: Extract<StartResult, { kind: "start_failed" }>["failure_kind"]
  }): StartResult {
    const { claimed, registration, spec, executionMode, lease } = input
    lease?.release()
    if (registration.name !== claimed.name) this.#names.release(spec.parent_session_id, registration.name)
    this.#background.delete(claimed.task_id)
    const timestamp = nowIso(this.#now)
    const started = this.#options.store.transition(claimed.task_id, { type: "start", timestamp })
    const failed = this.#options.store.transition(claimed.task_id, {
      type: "fail",
      timestamp,
      error_message: input.error_message,
    })
    if (!started.applied || !failed.applied) throw new Error("spawn bookkeeping failure transitions were not applied")
    return {
      kind: "start_failed",
      task_id: claimed.task_id,
      name: registration.name,
      ...(claimed.category !== undefined ? { category: claimed.category } : {}),
      ...(claimed.agent_type !== undefined ? { subagent_type: claimed.agent_type } : {}),
      execution_mode: executionMode,
      model: claimed.model,
      ...(claimed.resolved_model !== undefined ? { resolved_model: claimed.resolved_model } : {}),
      run_in_background: spec.run_in_background === true,
      error_message: input.error_message,
      ...(input.failure_kind === undefined ? {} : { failure_kind: input.failure_kind }),
    }
  }

  #recordSpawnFacts(taskId: string, handle: ManagedChildHandle): void {
    const current = this.#tryLoad(taskId)
    if (current === null || isTerminalRecord(current)) return
    const spawned = endFallbackHandoff(current)
    const withPid = recordSpawnedPid(spawned, handle.pid) ?? spawned
    const withRunner = recordSpawnedRunner(withPid, handle.kind, handle.hostSession) ?? withPid
    const withSession = recordSpawnedChildSession(withRunner, handle.sessionId) ?? withRunner
    const spawnSpec = handle.spawnSpec
    // A v1 spawn_spec persisted at spawn is authoritative: the rpc echo would rewrite it as the
    // legacy {cwd, extensions, member_env} shape, dropping the rebuild facts v1 carries.
    const updated: TaskRecord = spawnSpec === undefined || (current.spawn_spec !== undefined && isSpawnSpecV1(current.spawn_spec))
      ? withSession
      : {
          ...withSession,
          spawn_spec: {
            cwd: spawnSpec.cwd,
            ...(spawnSpec.extensions === undefined ? {} : { extensions: spawnSpec.extensions }),
            ...(spawnSpec.memberEnv === undefined ? {} : { member_env: spawnSpec.memberEnv }),
          },
        }
    if (updated !== current) this.#options.store.replace(updated)
  }

  // One child subscription feeds BOTH durable facts: the JSONL transcript log and the run-stats
  // tracker whose snapshot lands on the terminal record. Looked up per event so a revive can
  // swap in a fresh tracker without resubscribing.
  get #selfResumedPorts(): SelfResumedTurnPorts {
    return {
      store: this.#options.store,
      now: this.#now,
      liveHandle: (taskId) => this.#live.get(taskId)?.handle,
      liveModel: (taskId) => this.#live.get(taskId)?.model,
      tryLoad: (taskId) => this.#tryLoad(taskId) ?? null,
      waitForTerminal: (taskId) => this.waitFor(taskId),
      reserveForRevive: (taskId) => this.#reserveForRevive(taskId),
      trackOutcome: (taskId, handle, model, epoch) => this.#outcome.trackOutcome(taskId, handle, model, epoch),
    }
  }

  #subscribeChildFacts(handle: ManagedChildHandle, taskId: string): () => void {
    return subscribeChildFacts({
      handle, taskId, store: this.#options.store, now: this.#now,
      runStats: this.#runStats, fallbackExhaustions: this.#nativeFallbackExhaustions,
      reopen: () => reopenSelfResumedTurn(this.#selfResumedPorts, taskId, handle),
      onExtensionEvent: (event) => {
        const record = this.#tryLoad(taskId)
        if (record != null && record.host_pid === this.#hostPid) this.#options.onChildExtensionEvent?.(event, record)
      },
    })
  }

  async #tryRuntimeFallback(input: {
    readonly taskId: string
    readonly handle: ManagedChildHandle
    readonly model: string
    readonly epoch: number
    readonly outcome: Awaited<ReturnType<ManagedChildHandle["waitForOutcome"]>>
    readonly runStats: TaskRunStats | undefined
    readonly timestamp: string
  }): Promise<boolean> {
    if (this.workpools.ownsTask(input.taskId)) return false
    if (
      input.outcome.status !== "error"
      || input.outcome.killed === true
      || (
        input.outcome.failure.kind !== "child-turn-failed"
        && input.outcome.failure.kind !== "child-prompt-failed"
      )
      || (input.runStats?.tool_calls ?? 0) > 0
    ) {
      return false
    }

    const record = this.#tryLoad(input.taskId)
    const candidates = record == null ? undefined : runtimeFallbackCandidates(record, input.outcome.failure.message)
    const nextModel = candidates?.remaining[0]
    const live = this.#live.get(input.taskId)
    const fallbackExhausted = record !== null
      && candidates !== undefined
      && nextModel === undefined
      && live?.handle === input.handle
      && (record.fallback_attempts?.length ?? 0) > 1
      && !this.#nativeFallbackExhaustions.has(input.handle)
    if (fallbackExhausted && record !== null) {
      this.#options.store.appendEvent(input.taskId, {
        type: "retry_fallback_exhausted",
        payload: {
          chain_key: record.requested_model?.display ?? record.fallback_attempts?.[0]?.display ?? record.model,
          last_error: input.outcome.failure.message,
        },
      })
    }
    if (
      record == null
      || candidates === undefined
      || nextModel === undefined
      || live?.handle !== input.handle
      || live.managedSpec === undefined
      || live.runner === undefined
    ) {
      return false
    }
    const managedSpec = live.managedSpec
    const runner = live.runner

    // Committed BEFORE the failed rung's teardown can yield: while the daemon closes that session, a
    // reconciler must already see a handoff owned by this live pid, never a vanished session it could
    // reclaim as an orphan (the 2026-09-26 `omo -p` hang). Fenced on this outcome's epoch and owner.
    const handoff: { record?: TaskRecord; closed?: ChildIdentity; stopped?: boolean } = {}
    this.#options.store.mutate(input.taskId, (fresh) => {
      if (fresh.notification.run_epoch !== input.epoch || fresh.host_pid !== record.host_pid) return fresh
      // A cancel or interrupt that landed first stands: its own teardown ends the failed rung.
      if (fresh.status !== "running") {
        handoff.stopped = true
        return fresh
      }
      handoff.closed = childIdentityOf(fresh)
      handoff.record = handOffToNextRung(fresh, { model: nextModel, remaining: candidates.remaining.slice(1), timestamp: input.timestamp })
      return handoff.record
    })
    const nextRecord = handoff.record
    if (handoff.stopped === true) {
      // The stop is this run's terminal and its own teardown ends the child; the stop may already have
      // forgotten the live entry, so this run's lease and waiters are settled here, not by the caller.
      this.#releaseSlot(input.taskId, input.model, input.epoch)
      this.#settleWaiters(input.taskId)
      return true
    }
    if (nextRecord === undefined) {
      this.#retireLostRun(input.taskId, live, input.epoch)
      return false
    }
    const remainingModels = nextRecord.fallback_models ?? []
    const nextEpoch = nextRecord.notification.run_epoch

    // A rejection may carry any value, `undefined` included, so the outcome is tracked on its own.
    const teardown: { failed: boolean; error?: unknown } = { failed: false }
    this.#closingRungs.set(input.taskId, { epoch: input.epoch, handle: input.handle })
    try {
      await (this.#options.destruction ?? NOOP_DESTRUCTION)
        .destroyResidentTask(input.taskId, "fallback_handoff")
    } catch (error) {
      teardown.failed = true
      teardown.error = error
    } finally {
      this.#closingRungs.delete(input.taskId)
    }

    // The failed rung may still be alive, so the next rung must not start beside it. End the handed-off
    // task instead of leaving it running behind this owner's pid fence with nothing to finish it, and
    // give the failed child a cleanup owner BEFORE its slot is freed.
    if (teardown.failed) {
      this.#failStrandedHandoff({ taskId: input.taskId, epoch: nextEpoch, owner: record.host_pid, nextModel: nextModel.display, error: teardown.error })
      live.unsubscribe()
      // A lifecycle revival may already have attached a newer run while this close was pending.
      if (this.#live.get(input.taskId) === live) this.#live.delete(input.taskId)
      const kept = this.#keepUnclosedChild({ taskId: input.taskId, epoch: nextEpoch, handle: input.handle, identity: handoff.closed ?? {}, error: teardown.error })
      this.#releaseSlot(input.taskId, input.model, input.epoch)
      this.#settleWaiters(input.taskId)
      if (kept === "orphan") await this.#terminateOrphanedChild(input.taskId)
      return true
    }

    live.unsubscribe()
    if (this.#live.get(input.taskId) === live) this.#live.delete(input.taskId)
    this.#releaseSlot(input.taskId, input.model, input.epoch)
    this.#options.store.mutate(input.taskId, (fresh) => forgetClosedChild(fresh, nextRecord.fallback_closing_child))

    this.#options.store.appendEvent(input.taskId, {
      type: "task_model_fallback",
      payload: {
        from_model: record.model,
        to_model: nextModel.display,
        error_message: input.outcome.failure.message,
        ...(candidates.skipped.length === 0 ? {} : { skipped_models: candidates.skipped.map((model) => model.display) }),
        ...(candidates.limit === undefined ? {} : { usage_limit: candidates.limit }),
      },
    })

    // A stop, a lifecycle revival or another owner may have moved the task while the failed rung
    // closed: the obsolete next rung is refused here, before it takes a slot.
    const current = this.#tryLoad(input.taskId)
    if (!ownsRun({ taskId: input.taskId, epoch: nextEpoch, owner: nextRecord.host_pid }, current)) {
      this.#settleWaiters(input.taskId)
      return true
    }

    const nextSpec: ManagedStartSpec = {
      ...managedSpec,
      model: nextModel.display,
      requestedModel: record.requested_model,
      fallbackModels: remainingModels,
      ...resolvedReasoningFields(nextModel),
    }
    const launch = (): void => {
      void this.#launchRuntimeFallback({
        record: nextRecord,
        managedSpec: nextSpec,
        runner,
        model: nextModel.display,
      })
    }

    if (this.#concurrency.tryAcquire(nextModel.display, input.taskId, nextEpoch)) {
      launch()
    } else {
      this.#concurrency.enqueue(nextModel.display, input.taskId, nextEpoch, launch)
    }
    return true
  }

  /**
   * End a handoff whose failed rung could not be closed. One fenced write clears the marker only while
   * this owner still holds this epoch's handoff; the fail transition then applies only from `running`,
   * so a cancel or interrupt that landed first stands.
   */
  #failStrandedHandoff(input: {
    readonly taskId: string
    readonly epoch: number
    readonly owner: number | undefined
    readonly nextModel: string
    readonly error: unknown
  }): void {
    const reason = input.error instanceof Error ? input.error.message : String(input.error)
    log("senpi-task runtime fallback teardown rejected", { taskId: input.taskId, error: reason })
    let owned = false
    this.#options.store.mutate(input.taskId, (fresh) => {
      if (!isFallbackHandoff(fresh) || fresh.status !== "running" || fresh.notification.run_epoch !== input.epoch || fresh.host_pid !== input.owner) return fresh
      owned = true
      // Only the handoff marker goes: fallback_closing_child stays until #keepUnclosedChild hands the
      // child's identity to its cleanup owner in one write, so no committed state lacks both.
      const { fallback_handoff_epoch: _ended, ...rest } = fresh
      return rest
    })
    if (!owned) return
    const message = `Runtime fallback could not close the failed model's child (${reason}); ${input.nextModel} was not started.`
    const failed = this.#options.store.transition(input.taskId, { type: "fail", timestamp: nowIso(this.#now), error_message: message })
    if (failed.applied) {
      this.#options.store.appendEvent(input.taskId, { type: "task_fallback_teardown_failed", payload: { error_message: reason, next_model: input.nextModel } })
    }
  }

  /** A launch still owns its task only while the task runs on the same epoch under the same owner. */
  #ownsLaunch(context: LaunchContext, fresh: TaskRecord | null | undefined): fresh is TaskRecord {
    return ownsRun(launchRunOf(context.record), fresh)
  }

  /**
   * A child whose start resolved after its launch went stale (stopped, or moved to another epoch or
   * owner) is torn down, never attached. If its cleanup rejects it may still be alive, so it keeps a
   * cleanup owner instead of being forgotten.
   */
  async #discardStaleLaunch(context: LaunchContext, handle: ManagedChildHandle): Promise<void> {
    const taskId = context.record.task_id
    const epoch = context.record.notification.run_epoch
    const current = this.#tryLoad(taskId)
    try {
      if (current?.status === "cancelled" && current.notification.run_epoch === epoch) {
        // This run's own cancel: the destruction port tears the child down and records the disposal.
        this.#live.set(taskId, { handle, model: context.model, unsubscribe: () => undefined })
        await (this.#options.destruction ?? NOOP_DESTRUCTION).destroyResidentTask(taskId, "cancel")
      } else {
        await discardManagedHandle(handle)
      }
    } catch (error) {
      if (this.#live.get(taskId)?.handle === handle) this.#live.delete(taskId)
      const kept = this.#keepUnclosedChild({ taskId, epoch, handle, identity: childIdentityOf(handle), error })
      this.#releaseSlot(taskId, context.model, epoch)
      this.#settleWaiters(taskId)
      if (kept === "orphan") await this.#terminateOrphanedChild(taskId)
      return
    }
    this.#releaseSlot(taskId, context.model, epoch)
    this.#settleWaiters(taskId)
  }

  /**
   * A child whose cleanup rejected may still be alive, so it keeps an owner on the record its run ended
   * (a newer epoch belongs to another run and is never touched). A child reachable from outside this
   * process has its pid or daemon session written back for the orphan path (`"orphan"`). An in-process
   * child has neither, so it becomes a cleanup owner (`"resident"`): its record stays `resident`, the
   * lifecycle's eviction, idle reclaim, shutdown and TTL see it and retry its teardown, steering never
   * reaches it, and only a teardown that succeeds releases it.
   */
  #keepUnclosedChild(input: {
    readonly taskId: string
    readonly epoch: number
    readonly handle: ManagedChildHandle
    readonly identity: ChildIdentity
    readonly error: unknown
  }): "orphan" | "resident" | "unowned" {
    const { taskId, identity } = input
    log("senpi-task child cleanup rejected", { taskId, error: String(input.error), pid: identity.pid, session: identity.host_session?.session_path })
    const external = hasChildIdentity(identity)
    // A newer run already owns the record, so it cannot carry this child; an in-process child, which
    // nothing outside this process can reach, still keeps this process as its cleanup owner.
    const current = this.#tryLoad(taskId)
    if (!external && current != null && current.notification.run_epoch > input.epoch) {
      if (!this.#cleanupOwners.has(taskId)) this.#holdForCleanup(taskId, input.handle)
      return "resident"
    }
    let owned = false
    this.#options.store.mutate(taskId, (fresh) => {
      if (!isTerminalRecord(fresh) || fresh.notification.run_epoch !== input.epoch) return fresh
      if (!external && this.#cleanupOwners.has(taskId)) return fresh
      owned = true
      if (!external) return fresh
      const { fallback_closing_child: _transferred, ...rest } = fresh
      return { ...rest, ...identity }
    })
    if (!owned) {
      this.#options.store.appendEvent(taskId, {
        type: "child_cleanup_failed",
        payload: { error_message: String(input.error), ...(identity.pid === undefined ? {} : { pid: identity.pid }), ...(identity.host_session === undefined ? {} : { session_path: identity.host_session.session_path }) },
      })
      return "unowned"
    }
    if (external) return "orphan"
    this.#holdForCleanup(taskId, input.handle)
    if (this.#tryLoad(taskId)?.residency_state !== "resident") {
      this.#options.store.transition(taskId, { type: "mark_resident", timestamp: nowIso(this.#now) })
    }
    return "resident"
  }

  #holdForCleanup(taskId: string, handle: ManagedChildHandle): void {
    this.#cleanupOwners.set(taskId, releaseOnDispose(handle, (owner) => {
      if (this.#cleanupOwners.get(taskId) === owner) this.#cleanupOwners.delete(taskId)
    }))
  }

  /** The recorded child has no live handle here: the destruction port ends it by pid or session. */
  async #terminateOrphanedChild(taskId: string): Promise<void> {
    try {
      await (this.#options.destruction ?? NOOP_DESTRUCTION).destroyResidentTask(taskId, "reconcile_lost")
    } catch (error) {
      log("senpi-task orphaned child termination rejected", { taskId, error: String(error) })
    }
  }

  async #launchRuntimeFallback(initial: LaunchContext): Promise<void> {
    // A fallback relaunch is still a launch: without this the new rung would lose its spawn-time
    // verification snapshot (catalogue + baseline), so its completion could not be captured.
    const context = this.#withVerificationSnapshot(initial)
    this.#options.store.mutate(context.record.task_id, (fresh) => {
      if (fresh.start_queued === undefined) return fresh
      const { start_queued: _granted, ...rest } = fresh
      return rest
    })
    // Checked before anything starts: a cancel, an interrupt or another owner that moved the task while
    // this launch waited (for the old rung's close, or for capacity) must not get a child started.
    if (!this.#ownsLaunch(context, this.#tryLoad(context.record.task_id))) {
      this.#releaseSlot(context.record.task_id, context.model, context.record.notification.run_epoch)
      failOwnedRun(this.#options.store, launchRunOf(context.record), nowIso(this.#now), { errorMessage: "Runtime fallback launch aborted before the child could start." })
      this.#settleWaiters(context.record.task_id)
      return
    }

    let handle: ManagedChildHandle
    try {
      handle = await context.runner.start(context.managedSpec)
    } catch (error) {
      const advanced = this.#advanceStartFallback(context, error)
      if (advanced !== undefined) {
        if (advanced.kind === "retry") void this.#launchRuntimeFallback(advanced.context)
        if (advanced.kind === "stale") {
          this.#releaseSlot(context.record.task_id, context.model, context.record.notification.run_epoch)
          this.#settleWaiters(context.record.task_id)
        }
        return
      }
      const failure = describeStartFailure(error)
      this.#releaseSlot(
        context.record.task_id,
        context.model,
        context.record.notification.run_epoch,
      )
      // The primary launch path records this breadcrumb; a fallback launch that dies must not be the
      // one failure that leaves the event log with no cause at all. A stale attempt records nothing.
      if (failOwnedRun(this.#options.store, launchRunOf(context.record), nowIso(this.#now), failure)) {
        this.#options.store.appendEvent(context.record.task_id, {
          type: "task_start_failed",
          payload: { error_message: failure.errorMessage, ...failure.eventFacts },
        })
      }
      this.#settleWaiters(context.record.task_id)
      return
    }

    // The start awaited: a cancel, interrupt or another owner may have moved the task meanwhile. A
    // late child of a run that is no longer this one's is discarded, never attached.
    if (!this.#ownsLaunch(context, this.#tryLoad(context.record.task_id))) {
      await this.#discardStaleLaunch(context, handle)
      return
    }

    const unsubscribe = this.#subscribeChildFacts(handle, context.record.task_id)
    this.#live.set(context.record.task_id, {
      handle,
      model: context.model,
      unsubscribe,
      managedSpec: context.managedSpec,
      runner: context.runner,
    })
    this.#attachChildSubscribers(context.record.task_id, handle)
    this.#recordSpawnFacts(context.record.task_id, handle)
    void this.#isolation.stamp(context.record.task_id, handle)
    this.#outcome.trackOutcome(
      context.record.task_id,
      handle,
      context.model,
      context.record.notification.run_epoch,
    )
  }

  // A revived child is running again and SHOULD occupy a slot; re-acquire it and re-arm outcome
  // tracking under the new run_epoch so the eventual second completion releases the slot cleanly.
  #reserveForRevive(taskId: string): { readonly ok: false } | { readonly ok: true; commit(): void; release(): void } {
    const live = this.#live.get(taskId)
    const record = this.#tryLoad(taskId)
    if (live === undefined || record === null || record === undefined) return { ok: false }
    const epoch = nextRunEpoch(record)
    if (!this.#concurrency.tryAcquire(live.model, taskId, epoch)) return { ok: false }
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      this.#concurrency.releaseLease(taskId, epoch)
    }
    return {
      ok: true,
      release,
      commit: () => {
        this.#runStats.set(taskId, createRunStatsTracker(this.#now(), this.#now))
        this.#outcome.trackOutcome(taskId, live.handle, live.model, epoch)
      },
    }
  }

  #reserveForDetachedRevive(record: TaskRecord): { readonly ok: false } | { readonly ok: true; commit(): void; release(): void } {
    const epoch = nextRunEpoch(record)
    if (!this.#concurrency.tryAcquire(record.model, record.task_id, epoch)) return { ok: false }
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      this.#concurrency.releaseLease(record.task_id, epoch)
    }
    return {
      ok: true,
      release,
      commit: () => {
        const live = this.#live.get(record.task_id)
        if (live === undefined) {
          release()
          return
        }
        this.#runStats.set(record.task_id, createRunStatsTracker(this.#now(), this.#now))
        this.#outcome.trackOutcome(record.task_id, live.handle, live.model, epoch)
      },
    }
  }

  #reserveForReattach(record: TaskRecord): { readonly ok: false } | { readonly ok: true; release(): void } {
    if (isTerminalRecord(record)) return { ok: true, release: () => undefined }
    const epoch = nextRunEpoch(record)
    if (!this.#concurrency.tryAcquire(record.model, record.task_id, epoch)) return { ok: false }
    return { ok: true, release: () => this.#concurrency.releaseLease(record.task_id, epoch) }
  }

  #releaseSlot(taskId: string, _model: string, epoch: number): void {
    // Release once per (task, epoch). A stale re-release of an already-released epoch is a no-op;
    // a revived task's higher epoch supersedes the prior one so its later release still counts.
    // A lease an older run still holds is released even after a newer epoch was: runtime fallback can
    // finish closing an old rung after a revived run has already completed.
    const released = this.#released.get(taskId)
    if (released !== undefined && released >= epoch && this.#concurrency.leaseState(taskId, epoch) === undefined) return
    this.#released.set(taskId, Math.max(released ?? epoch, epoch))
    this.#concurrency.releaseLease(taskId, epoch)
  }

  // Another owner took this task over: drop only this process's copy of the run (subscription, live
  // entry, its own lease) and let go of the handle, which for a daemon session is a detach. The record
  // and the session are the winner's and stay untouched.
  #retireLostRun(taskId: string, live: LiveTask, epoch: number): void {
    live.unsubscribe()
    if (this.#live.get(taskId) === live) this.#live.delete(taskId)
    this.#releaseSlot(taskId, live.model, epoch)
    void releaseSupersededHandle(live.handle).catch((error: unknown) => {
      log("senpi-task superseded fallback handle release failed", { taskId, error: String(error) })
    })
  }

  #releaseSlotForTask(taskId: string): void {
    const live = this.#live.get(taskId)
    if (live === undefined) return
    const closing = this.#closingRungs.get(taskId)
    const epoch = closing?.handle === live.handle ? closing.epoch : this.#tryLoad(taskId)?.notification.run_epoch ?? 0
    this.#releaseSlot(taskId, live.model, epoch)
  }

  #removeCapacityWaiter(taskId: string): void {
    const record = this.#tryLoad(taskId)
    if (record === null || record === undefined) return
    this.#concurrency.remove(record.model, taskId)
  }

  // `terminal` overrides the store read for the one case where the on-disk record cannot be terminal:
  // the terminal write itself failed (#8050) and the tracker synthesized the record the waiters are owed.
  #settleWaiters(taskId: string, terminal?: TaskRecord): void {
    const record = terminal ?? this.#tryLoad(taskId)
    if (record === null || record === undefined || !isTerminalRecord(record)) return
    // Terminal = LRU-evictable (once its sends drain), so every session waiter re-probes (#8396).
    this.#residency.notify(record.parent_session_id)
    const waiters = this.#waiters.get(taskId)
    if (waiters === undefined) return
    const settling = waiters.splice(0)
    if (waiters.length === 0) this.#waiters.delete(taskId)
    for (const waiter of settling) {
      waiter.cleanup()
      waiter.resolve(record)
    }
  }

  #tryLoad(taskId: string): TaskRecord | null {
    try {
      return this.#options.store.load(taskId)
    } catch {
      return null
    }
  }
}

export function createTaskManager(options: TaskManagerImplOptions): ReattachingTaskManager {
  return new TaskManagerImpl(options)
}
