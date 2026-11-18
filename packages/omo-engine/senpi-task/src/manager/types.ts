import type { ToolDefinition } from "@code-yeongyu/senpi"
import type { DelegateFallbackEntry } from "../../../delegate-core/src/index.ts"
import type { OmoTaskSettings } from "../../../omo-config-core/src/index.ts"

import type { VerificationRunner } from "../verification/contract"
import type { RepairDiagnosisInvoker as RepairAttemptInvoker, RepairEditExecutor } from "../repair/orchestrator"
import type { DagTaskOwner, DagTaskOwnerKey, OwnedStartResult } from "../dag/owner"
import type { DagDefinition } from "../dag/graph"
import type { DagNode, DagNodeId, DagRunId } from "../dag/types"
import type {
  DelegationNodeOutcome,
  DelegationPlanRejectionCode,
  DelegationRole,
  EngineeringDelegationRequest,
  RoleSpec,
} from "../delegation/plan"
// The typed deadline refusal from the delegation run seam (p25 todo 16). Type-only: the manager
// propagates this exact error instead of inventing a `timed_out` status or a success shape.
import type { EngineeringDelegationDeadlineUnavailable, DelegationUnresolvedReason } from "../delegation/run"
import type { IsolationRuntime, IsolationStartedDetails } from "../isolation"
import type { KernelToolBindingRegistry } from "../kernel-tools/bindings"
import type { KernelToolGrant } from "../kernel-tools/resolve"
import type {
  ResolvedModelRecord,
  TaskRecord,
  TaskRunStats,
  TaskStartFailureKind,
  TaskStartFailureReason,
  TaskStatus,
} from "../state"
import type {
  CancelOptions,
  CancelOutcome,
  DestructionPort,
  InterruptOutcome,
  SendInput,
  SendOutcome,
} from "../steering"
import type { TaskRecordStore } from "../store"
import type { ManagedChildHandle, ManagedChildListener } from "./child-handle"
import type { ExecutionMode, ExecutionModeGate } from "./execution-mode"
import type { TaskConcurrency } from "./concurrency"
import type { InheritedExtensions } from "../runners/rpc/parent-extensions"
import type { WorkpoolEngine } from "../workpool/engine"
import type { ChildExtensionEvent } from "../runners/child-extension-events"

export type { ExecutionMode } from "./execution-mode"

// The terminal projection of an ordinary completion. TaskRecord parses the completion gate's
// verification_status itself, so this alias names the terminal use of a record rather than adding a
// field. The claim stays optional: records written before the gate existed carry none, and absence
// means no verification was ever claimed.
export type TerminalTaskRecord = TaskRecord

// The unified spec both runner adapters accept. A superset: the rpc adapter uses the subset it
// needs (task_id, cwd, state_dir, prompt); the in-process adapter also consumes model/tools/agent.
export type ManagedStartSpec = {
  readonly taskId: string
  readonly cwd: string
  readonly stateDir: string
  readonly prompt: string
  readonly depth: number
  readonly parentSessionId: string
  readonly rootSessionId: string
  readonly model?: string
  readonly requestedModel?: ResolvedModelRecord
  readonly fallbackModels?: readonly ResolvedModelRecord[]
  // The canonical resolved model (provider + model_id) chosen at plan time. Resume-time resolution
  // matches on this pair - never on the human display string, which need not be a registry id.
  readonly resolvedModel?: ResolvedModelRecord
  readonly variant?: string
  readonly agentType?: string
  readonly instructions?: string
  readonly toolAllowlist?: readonly string[]
  // Names of tools the child must NOT get (the agent definition's disallowedTools), applied through
  // senpi's excludeTools so a resumed child never comes back with a wider tool surface.
  readonly toolDenylist?: readonly string[]
  readonly includeTaskTools?: boolean
  // Names of the member-scoped ToolDefinitions, persisted on spawn_spec so a respawn can re-resolve
  // the executable definitions against the live parent registries.
  readonly memberScopedToolNames?: readonly string[]
  readonly memberScopedTools?: readonly ToolDefinition[]
  // TRANSIENT parent kernel-tool grant (item 6). Process-lifetime only: never persisted onto the
  // record or the v1 spawn_spec, which carry plain launch data exclusively.
  readonly kernelTools?: KernelToolGrant
  // TRANSIENT ordinary-worker verification tool. Same lifetime rule as kernelTools: a live
  // host-built closure, never persisted onto the record or the v1 spawn_spec.
  readonly verificationTool?: ToolDefinition
  readonly extensions?: readonly string[]
  readonly memberEnv?: Readonly<Record<string, string>>
}

export type ManagedRunner = {
  start(spec: ManagedStartSpec): Promise<ManagedChildHandle>
  // Rebuild a persisted child from its session transcript without replaying its prompt. Optional
  // until the mode adapters grow their resume paths (todo 10); start-only fakes keep compiling.
  resume?(spec: ManagedStartSpec, sessionPath: string): Promise<ManagedChildHandle>
}

export type ManagerStartSpec = {
  readonly isolated?: boolean
  readonly apply?: boolean
  readonly merge?: "patch" | "branch"
  readonly prompt: string
  readonly task_summary?: string
  readonly parent_session_id: string
  readonly root_session_id?: string
  readonly depth: number
  readonly category?: string
  readonly subagent_type?: string
  readonly execution_mode?: ExecutionMode
  readonly model?: string
  readonly name?: string
  readonly description?: string
  readonly team_run_id?: string
  readonly team_name?: string
  readonly team_member_name?: string
  readonly team_role?: "member"
  readonly cwd?: string
  readonly instructions?: string
  readonly allowed_subagents?: readonly string[]
  readonly run_in_background?: boolean
  readonly memberScopedTools?: readonly ToolDefinition[]
  // TRANSIENT parent kernel-tool grant resolved by the caller against its LIVE capability.
  readonly kernelTools?: KernelToolGrant
  readonly extensions?: readonly string[]
  readonly memberEnv?: Readonly<Record<string, string>>
  // A delegated request riding the ordinary start() path. Present => the manager builds the plan
  // and owns the run lifecycle through TaskManagerOptions.admission; absent => today's spawn path
  // runs byte-identically. `workingDirectory` defaults to spec.cwd and then TaskManagerOptions.cwd.
  readonly delegation?: ManagerDelegationSpec
}

// The delegation-shaped part of an ordinary start spec. It carries only the plan input: objective,
// roles, optional node cap, and the caller-observable deadline. It is NOT a second spawn request:
// the manager never starts these children itself (see ManagerAdmissionPort).
export type ManagerDelegationSpec = {
  readonly objective: string
  readonly workingDirectory?: string
  readonly roles: readonly RoleSpec[]
  readonly maxNodes?: number
  // The caller-observable budget for the delegated start. The timer starts when the admission drive
  // starts (after the catalogue/baseline snapshot, which is host setup rather than admitted work)
  // and covers startRun, admit, the waits, AND the host-side verification capture that runs the
  // approved checks. Elapsed in any of those phases => the parent is failed as deadline-exceeded and
  // the typed refusal propagates; never a completed (and never a completed+verified) parent. The
  // budget cannot kill a check command already in flight - that command keeps its own timeoutMs -
  // but its late result is marked cancelled and is never consulted for the parent's terminal.
  readonly deadlineMs?: number
}

export type ResolvedChildPlan = {
  readonly model: string
  readonly requested_model?: ResolvedModelRecord
  readonly fallback_models?: readonly ResolvedModelRecord[]
  readonly resolved_model?: ResolvedModelRecord
  readonly variant?: string
  readonly agentExecutionMode?: ExecutionMode
  readonly agentType?: string
  readonly category?: string
  readonly instructions?: string
  readonly toolAllowlist?: readonly string[]
  // The resolved agent's disallowedTools, threaded onto the record as tool_deny.
  readonly toolDenylist?: readonly string[]
  readonly promptAppend?: string
  readonly allowedSubagents?: readonly string[]
  readonly maxDepth?: number
}

export type PlanResolutionError = {
  readonly code: "unknown_target" | "model_unavailable" | "category_disabled" | "invalid_target"
  readonly message: string
  readonly availableAgents?: readonly string[]
  readonly availableCategories?: readonly string[]
  // Dead-chain spawn detail: the category whose builtin fallback chain had zero resolvable rungs,
  // the rungs that were attempted, and the chain providers missing from the live registry.
  readonly category?: string
  readonly attempted_chain?: readonly DelegateFallbackEntry[]
  readonly missing_providers?: readonly string[]
  readonly unlisted_provider_model?: string
}

export type PlanResolution =
  | { readonly kind: "resolved"; readonly plan: ResolvedChildPlan }
  | { readonly kind: "error"; readonly error: PlanResolutionError }

export type ChildPlanner = (spec: ManagerStartSpec) => PlanResolution

export type StartResult =
  | {
      readonly kind: "started"
      readonly task_id: string
      // Emitted by the manager; optional for existing host implementations of TaskManager.
      readonly run_epoch?: number
      readonly status: "running" | "pending"
      readonly name: string
      readonly resolved_model?: ResolvedModelRecord
      readonly queue_position?: number
      readonly name_warning?: string
      // Where an isolated child is working. The merge outcome is NOT here: it does not exist yet.
      readonly isolation?: IsolationStartedDetails
    }
  | {
      readonly kind: "depth_denied"
      readonly reason: string
      readonly child_depth: number
      readonly max_depth: number
    }
  | { readonly kind: "plan_unresolved"; readonly error: PlanResolutionError }
  | {
      readonly kind: "start_failed"
      readonly task_id: string
      readonly name: string
      readonly category?: string
      readonly subagent_type?: string
      readonly execution_mode: ExecutionMode
      readonly model: string
      readonly resolved_model?: ResolvedModelRecord
      readonly run_in_background: boolean
      readonly error_message: string
      // The runner's typed failure kind (RunnerFailure["kind"]) when the runner rejected the start,
      // or `isolation_unavailable` when the child's copy-on-write clone could not be created.
      // so a caller can classify the refusal without parsing the sanitized message.
      readonly failure_kind?: TaskStartFailureKind | "isolation_unavailable"
      readonly failure_reason?: TaskStartFailureReason
    }
  | ResidencyDenied

// A resident child named by a residency rejection: enough for the caller to tell whether the cap
// is held by live work (wait for it) or by nothing that could ever free a slot (give up).
type ResidentSummary = {
  readonly task_id: string
  readonly name: string
  readonly status: TaskStatus
}

// #8396: a residency denial states WHY admission failed so the caller can decide whether waiting
// helps. `residents` = the session's resident children occupy the cap; every one of them frees its
// slot on settlement, eviction, or when its pending sends drain, so a caller parks and re-probes
// after `TaskManager.residencyChanged(parentSessionId)`. A denial that names NO resident can never
// be helped by waiting. `lease` = the per-session admission lease was contended or displaced; the
// lease acquisition itself is a bounded wait, so the caller simply probes again.
export type ResidencyDenied =
  | {
      readonly kind: "residency_denied"
      readonly reason: string
      readonly cause: "residents"
      readonly max_children?: number | "unlimited"
      readonly residents: readonly ResidentSummary[]
    }
  | { readonly kind: "residency_denied"; readonly reason: string; readonly cause: "lease" }

export type ContinueDelivery = "steer" | "followUp" | "revive"

export type ContinueResult =
  | {
      readonly kind: "continued"
      readonly task_id: string
      readonly status: TaskStatus
      readonly delivered: ContinueDelivery
    }
  | { readonly kind: "not_continuable"; readonly task_id?: string; readonly reason: string; readonly suggestion: string }

export type ListScope =
  | { readonly scope: "parent-session"; readonly session_id: string }
  | { readonly scope: "all" }

export type ListedTask = {
  readonly record: TaskRecord
  readonly queue_position?: number
}

// Residency admission decision consulted by manager.start() at spawn (W1-V F7). The wiring adapts
// lifecycle.admitResident into this harness-neutral shape so the manager never imports lifecycle:
// `evicted` means a terminal resident was reclaimed to make room and the spawn may proceed.
export type SpawnAdmission =
  | { readonly kind: "admitted" }
  | { readonly kind: "evicted"; readonly evicted_task_id: string }
  | {
      readonly kind: "rejected"
      readonly message: string
      // The residents that hold the cap (lifecycle AgentLimitReached). Omitted = the adapter could
      // not name them, which the manager reports as a denial nothing can free (#8396).
      readonly max_children?: number | "unlimited"
      readonly residents?: readonly ResidentSummary[]
    }

export type AdmitResident = (parentSessionId: string) => Promise<SpawnAdmission>

// Manager-owned delegation admission (p25 todo 13). The manager must never import the DAG runtime:
// the host composes this port around the real DAG manager, scheduler admission, and task wait
// surface, while tests compose a fake. Every DAG-facing shape below is structural and imported
// TYPE-ONLY, so this module adds no runtime edge into ../dag.
export type ManagerAdmissionRunSpec = {
  readonly definition: DagDefinition
  readonly parentSessionId: string
  readonly rootSessionId: string
  // The tree this run's nodes execute in: the request's `workingDirectory`, defaulted to the
  // caller's spec cwd and then the manager's construction cwd. It is a REQUEST fact, never the
  // manager's construction cwd when the request names its own directory; the gate runs against the
  // same value, so children and verification can never observe two different trees.
  readonly workingDirectory: string
}

// The run identity startRun returns. A production adapter projects `DagStartResult` onto this:
// `{ runId: started.snapshot.runId, reused: started.reused }`.
export type ManagerAdmissionRun = {
  readonly runId: DagRunId
  readonly reused?: boolean
}

// A node the manager asks the port to admit. The engine's node id is the unambiguous target; a
// role-only target exists for ports that resolve a plan's role to its node themselves, and such a
// port owns rejecting an ambiguous role. The target addresses a RUN, and the run spec above owns
// that run's working directory: the directory is deliberately not repeated here, because two
// copies could disagree and an admitted child could run in a different tree than the gate.
export type ManagerAdmissionNodeTarget =
  | { readonly runId: DagRunId; readonly nodeId: DagNodeId; readonly role?: DelegationRole }
  | { readonly runId: DagRunId; readonly role: DelegationRole }

// The child that executes an admitted node. `taskId` is the engine task id the manager waits on.
export type ManagerAdmissionChild = {
  readonly taskId: string
  readonly nodeId?: DagNodeId
  readonly role?: DelegationRole
}

export type ManagerAdmissionWaitOptions = {
  readonly signal?: AbortSignal
}

// The terminal projection of a child the manager waited on. A production adapter maps
// `TaskRecord` onto `{ taskId: record.task_id, status: record.status }`; the manager never needs
// the rest of the record to know the wait settled.
export type ManagerAdmissionTerminal = {
  readonly taskId: string
  readonly status: TaskStatus
}

// The persisted run projection the manager folds outcomes from. A production adapter serves the
// DAG manager's record, whose `nodes` are the authoritative node records already.
export type ManagerAdmissionRunRecord = {
  readonly runId: DagRunId
  readonly nodes: readonly DagNode[]
}

export type ManagerAdmissionPort = {
  /** Create or reuse the fingerprint-keyed run and return its identity. */
  startRun(spec: ManagerAdmissionRunSpec): Promise<ManagerAdmissionRun>
  /**
   * Admit one planned node and return its child. The PORT owns dependency gating and readiness:
   * admitting a node whose dependencies are not complete either waits or rejects there, so the
   * manager never grows a scheduler of its own.
   */
  admit(target: ManagerAdmissionNodeTarget): Promise<ManagerAdmissionChild>
  /** Resolve only when the child reaches a terminal state (or the caller aborts). */
  wait(taskId: string, options?: ManagerAdmissionWaitOptions): Promise<ManagerAdmissionTerminal>
  /** Read the persisted run record. `nodes` stays authoritative for node outcomes. */
  record(runId: DagRunId): ManagerAdmissionRunRecord
  /**
   * Optional cancellation. The manager CALLS this when a deadline elapses after the run identity
   * exists, so a deadline-failed parent cannot leave admitted children running. Absent means the
   * host exposes no run cancel at this seam, and the typed deadline result says so explicitly.
   * A port that defines cancel must stop admitting new nodes for that run once it is cancelled.
   */
  cancel?(runId: DagRunId, reason?: string): Promise<void>
}

export type ManagerDelegationStartRequest = EngineeringDelegationRequest & {
  readonly parent_session_id: string
  readonly root_session_id?: string
  // Elapsed after the run identity exists => `deadline_unavailable_at_manager_seam` (with the
  // port's cancel invoked when it has one); elapsed while the port is still creating the run =>
  // `delegation_start_failed` with reason `admission_start_timeout`, because a run-scoped refusal
  // cannot name a run the port never reported without inventing an id. This seam has no terminal
  // fold, so the budget covers startRun, admit, and the waits only. Never a completed run.
  readonly deadlineMs?: number
}

// The delegated start's ONLY outcomes. There is deliberately no `verified`, `success`, or verdict
// field: node outcomes are readable evidence, and the completion gate remains the sole judge.
export type ManagerDelegationStartResult =
  | {
      readonly kind: "delegated"
      // The authoritative parent TaskRecord id produced by the production scheduler for this
      // delegation. Correlates the delegation operation, child tasks, task epoch, subsequent
      // terminal events, and verification intent/evidence. A successful return does NOT imply
      // that delegated work or verification has completed.
      readonly task_id: string
      readonly runId: DagRunId
      readonly outcomes: readonly DelegationNodeOutcome[]
      // Some planned node had no terminal record when the run was read: never report that as done.
      readonly unresolved: boolean
    }
  // The run settled, but its terminal node set is not this plan's result, or its record could not
  // be read. The seam refuses with the typed reason and the observed ids instead of answering a
  // success-shaped `delegated` with no cause; the ordinary start path folds and fails the parent.
  | {
      readonly kind: "delegation_unresolved"
      // The authoritative parent TaskRecord id produced by the production scheduler for this
      // delegation, even when the run did not settle. Correlates the delegation operation,
      // child tasks, task epoch, and subsequent terminal events.
      readonly task_id: string
      readonly runId: DagRunId
      readonly reason: DelegationUnresolvedReason
      readonly message: string
      readonly outcomes: readonly DelegationNodeOutcome[]
      readonly missingNodeIds: readonly DagNodeId[]
      readonly foreignNodeIds: readonly DagNodeId[]
    }
  // The plan (objective/roles/working directory) could not be turned into a definition: nothing ran.
  | {
      readonly kind: "plan_unresolved"
      readonly error: PlanResolutionError
    }
  // The parent record could not be claimed (id/name contention). No child was admitted.
  | {
      readonly kind: "delegation_start_failed"
      // `admission_start_timeout`: the deadline elapsed before `startRun` reported a run identity,
      // so no run-scoped deadline refusal could be built. A late run is cancelled when it appears.
      readonly reason: "record_claim_failed" | "verification_catalogue_unavailable" | "admission_start_timeout"
      readonly message: string
    }
  // The deadline elapsed before the delegated start finished. The checkbox-16 typed error rides
  // through unchanged: `ok: false` means the caller cannot read it as success, and a cancelled run
  // is never claimed when the seam cannot honour the deadline. On the ordinary start path this also
  // covers a capture that outlived the budget after the run settled; the parent record is failed as
  // deadline-exceeded and the `reason` names the capture phase.
  | EngineeringDelegationDeadlineUnavailable
  | {
      readonly kind: "admission_unavailable"
      readonly reason: "admission_unavailable"
      readonly message: string
    }
  | {
      readonly kind: "delegation_plan_rejected"
      readonly code: DelegationPlanRejectionCode
      readonly message: string
      readonly roleKeys: readonly string[]
    }

// The ordinary start() path's delegated success additionally names the manager-owned parent
// TaskRecord that carries the terminal state and the gate's verification claim. There is still no
// verdict field here: the record and the completion gate own that judgement.
export type ManagerDelegatedStartResult =
  | (Extract<ManagerDelegationStartResult, { readonly kind: "delegated" }> & {
      readonly task_id: string
    })
  // `delegation_unresolved` belongs to the public startDelegated seam only; the ordinary start path
  // folds the same observation into a failed parent and returns its `delegated` result unchanged.
  | Exclude<ManagerDelegationStartResult, { readonly kind: "delegated" | "delegation_unresolved" }>

// One re-drive result per persisted intent. `folded` means this call ran capture + gate + terminal;
// the other outcomes say why it published nothing. A caller merges these into its session-start
// reconciliation instead of treating an untouched parent as verified.
export type DelegatedVerificationResumeOutcome = {
  readonly taskId: string
  readonly epoch: number
  readonly outcome:
    | "folded"
    | "already_terminal"
    | "stale_epoch"
    | "record_missing"
    | "run_not_completed"
    | "run_record_unreadable"
  readonly status?: TaskRecord["status"]
  readonly verification_status?: TaskRecord["verification_status"]
}

export type TrustedRespawnLaunch = {
  readonly extensions?: readonly string[]
  readonly memberEnv?: Readonly<Record<string, string>>
}

export type TrustedRespawnLaunchResolver = (record: TaskRecord) => Promise<TrustedRespawnLaunch | undefined>

export type TaskManagerOptions = {
  readonly onChildExtensionEvent?: (event: ChildExtensionEvent, owner: TaskRecord) => void
  readonly concurrency?: TaskConcurrency
  // Injected by row 17. Absent, `isolated` children are refused rather than silently run against the
  // parent checkout, so a wiring that forgot it can never break the isolation promise.
  readonly isolation?: IsolationRuntime
  readonly store: TaskRecordStore
  readonly runners: Readonly<Record<ExecutionMode, ManagedRunner>>
  readonly planner: ChildPlanner
  readonly config: OmoTaskSettings
  readonly cwd: string
  readonly now?: () => number
  // Injected by lifecycle (todo 12). Steering-driven cancel delegates destruction here; defaults to
  // a no-op so the manager stays usable before lifecycle wiring lands.
  readonly destruction?: DestructionPort
  // Injected by the todo-17 wiring. Consulted at spawn so the residency cap (LRU eviction) gates a
  // new child; absent -> admission is skipped (pre-wiring/unit behaviour, no cap enforcement).
  readonly admit?: AdmitResident
  // Manager-owned delegation seam, supplied at construction. Absent => an ordinary start behaves
  // exactly as before, and a delegated start refuses as `admission_unavailable` instead of
  // silently admitting nothing. Present => the manager drives this port for a delegated request
  // without importing the DAG runtime.
  readonly admission?: ManagerAdmissionPort
  // Resolves launch inputs from the current runtime. Persisted task records never supply executable
  // extensions or environment during a respawn.
  readonly trustedRespawnLaunch?: TrustedRespawnLaunchResolver
  // What a child of this session inherits when the caller names no explicit list. The composition
  // root passes a resolver that includes settings-installed package providers (#8492); absent, the
  // parent's argv entries are used, which is what a wiring without a package manager can know.
  readonly resolveInheritedExtensions?: InheritedExtensions
  // Pid recorded as host_pid on every claimed record so sibling processes sharing the project store
  // can tell a live owner from a dead one. Defaults to process.pid; injectable for tests.
  readonly hostPid?: number
  // The parent engine's RUNTIME-ONLY kernel-tool capability map (item 6). Shared with the runner so
  // a same-host parked child revives onto the same live parent closures; absent = no kernel tools.
  readonly kernelToolBindings?: KernelToolBindingRegistry
  // The names a child of this parent already carries (same list the task tool grant reads).
  readonly resolveChildToolNames?: () => readonly string[]
  // Resolves `task.default_execution_mode: "auto"` ONCE per parent session (the shared-daemon
  // capability check). Absent -> `auto` reads as in-process, which is what a wiring without a
  // daemon (tests, a pinned engine without the host surface) must do.
  readonly executionModeGate?: ExecutionModeGate
  // Host-owned root for approval authority. Absent uses the host default (a directory under the
  // user's home, never inside a workspace); a host that keeps state elsewhere injects its own.
  // Tests MUST inject a temp root so no test can read or write the real authority.
  readonly verificationAuthorityRoot?: string
  // Model-driven repair of a blocked ordinary completion (senpi-task repair vertical slice).
  // The invoker is the orchestrator's RepairDiagnosisInvoker seam: tests inject a scripted one
  // (unit test of the wiring); production defaults to the real host adapter built from
  // src/repair/model-diagnosis.ts, which fails closed as model_unavailable when no live model
  // can be resolved. The editor defaults to the real authorized applier seeded with the run's
  // workspace and pre-repair revision baseline; the runner defaults to the real verification
  // command runner. All three keep the existing gate the sole authority.
  readonly repair?: {
    readonly invoker?: RepairAttemptInvoker
    readonly editExecutor?: RepairEditExecutor
    readonly runner?: VerificationRunner
  }
}

export type TaskManager = {
  readonly workpools?: WorkpoolEngine
  // Optional for structural adapters; the concrete manager exposes its live lease allocator.
  readonly concurrency?: TaskConcurrency
  findTaskByChildSession?(sessionId: string): TaskRecord | undefined
  // A spec that carries a delegation request is answered by the delegated start's own result set;
  // the ordinary signature below stays unchanged for every existing caller. The return is the UNION
  // rather than only the delegated set so a caller can still refuse a wiring that ignored
  // `spec.delegation` and returned an ordinary outcome, instead of silently calling it delegated.
  // The concrete manager returns the delegated set alone; returning a supertype keeps every
  // structural start() fake (which answers ordinary specs) satisfying this overload too.
  start(
    spec: ManagerStartSpec & { readonly delegation: ManagerDelegationSpec },
  ): Promise<StartResult | ManagerDelegatedStartResult>
  start(spec: ManagerStartSpec): Promise<StartResult>
  // Manager-owned delegated start. The port owns run creation and node admission; the manager owns
  // the call sequence, collects the persisted node outcomes, and never writes a verdict. Optional so
  // structural TaskManager fakes keep compiling; the concrete manager always implements it.
  startDelegated?(request: ManagerDelegationStartRequest): Promise<ManagerDelegationStartResult>
  // Late-bound admission (p27 todo 7). A composition root that builds this manager before its DAG
  // runtime can install the port here; the setter replaces any port supplied at construction and
  // creates nothing itself. Optional so structural fakes keep compiling, and absent-before-set still
  // refuses a delegated start as `admission_unavailable`.
  // Re-drive delegated parents whose host-side verification was interrupted, from the durable
  // intent the fold writes before capture. Optional so structural fakes keep compiling; the concrete
  // manager always implements it. A terminal parent is never re-published.
  resumeDelegatedVerifications?(sessionId?: string): Promise<readonly DelegatedVerificationResumeOutcome[]>
  setAdmissionPort?(port: ManagerAdmissionPort): void
  startOwned(spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult>
  findOwnedTask(owner: DagTaskOwnerKey): TaskRecord | undefined
  continueTask(taskIdOrName: string, prompt: string, deliverAs?: "steer" | "followUp"): Promise<ContinueResult>
  sendToTask(input: SendInput): Promise<SendOutcome>
  interruptTask(idOrName: string): Promise<InterruptOutcome>
  cancelTask(idOrName: string, reason?: string, options?: CancelOptions): Promise<CancelOutcome>
  get(taskId: string): TaskRecord | undefined
  hasPendingSends?(taskId: string): boolean
  tryClaimEviction?(taskId: string): boolean
  releaseEviction?(taskId: string): void
  isEvicting?(taskId: string): boolean
  tryBeginSend?(taskId: string): boolean
  endSend?(taskId: string): void
  list(scope: ListScope): readonly ListedTask[]
  waitFor(taskId: string, options?: { readonly signal?: AbortSignal }): Promise<TaskRecord>
  // Live read of the manager-owned run-stats accumulator. Snapshot and live TUI surfaces need
  // in-flight turns/tool-calls/tok-s; the record only carries run_stats once terminal.
  // Optional so downstream structural fakes keep compiling; the concrete manager always implements it.
  runStatsSnapshot?(taskId: string): TaskRunStats | undefined
  // W1-V F3: prune a live handle (and its per-epoch release/background bookkeeping) so the lifecycle
  // destruction port and eviction path never leave a stale handle behind or grow #live unbounded.
  forget(taskId: string): void
  // Live-handle read seam for the wiring's ResidencyRegistry (W1-V F7: registry and #live share one
  // forget path). Returns the ManagedChildHandle for a task this process still owns, if any.
  getResidentHandle(taskId: string): ManagedChildHandle | undefined
  // Subscribe at the runner-agnostic handle seam now or when a queued task is promoted.
  subscribeChild(taskId: string, listener: ManagedChildListener): () => void
  residentTaskIds(): readonly string[]
  // #8396: session-scoped residency wake. Resolves the next time the parent session's residency
  // picture changes - a resident child reaches a terminal status, is forgotten (evicted, suspended,
  // destroyed), or has its last pending send drained - so a caller denied for residency can park
  // and re-probe instead of judging the SESSION by its own bookkeeping. Repeatable: each call arms
  // the NEXT change, so arm it BEFORE the probe whose denial you intend to wait out.
  residencyChanged(parentSessionId: string): Promise<void>
  // Promote a foreground task when the tool stops waiting inline. The completion bridge reads this
  // state live at terminal transition, so promotion makes the eventual completion notify normally.
  promoteToBackground(taskId: string): boolean
  // Whether a task is currently background, either from its spawn spec or a later promotion.
  wasBackground(taskId: string): boolean
}
