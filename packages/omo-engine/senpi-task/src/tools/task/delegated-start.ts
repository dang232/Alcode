import type { AgentToolResult } from "@code-yeongyu/senpi"

import type { DelegationNodeOutcome, RoleSpec } from "../../delegation/plan"
import type {
  ManagerDelegationSpec,
  ManagerStartSpec,
  PlanResolutionError,
  TerminalTaskRecord,
} from "../../manager"
import type { VerificationStatus } from "../../verification/completion-status"
import type { TaskToolParamsStatic } from "./params"
import { buildStartSpec } from "./execute-spec"
import { evaluateSpawnPolicy } from "./spawn-policy"
import type { TaskDelegationDetail, TaskToolContext, TaskToolDeps, TaskToolDetails } from "./types"
import { validateTaskTarget } from "./validation"

type DelegationParams = NonNullable<TaskToolParamsStatic["delegation"]>

// Named drafts keep the known property types while allowing optional fields to be added only when
// present (the published contracts are readonly, so they cannot be built field by field).
type DelegationSpecDraft = {
  objective: string
  workingDirectory?: string
  roles: RoleSpec[]
  maxNodes?: number
  deadlineMs?: number
}

type DelegationDetailDraft = {
  run_id: string
  terminal_status: string
  outcomes: readonly DelegationNodeOutcome[]
  unresolved: boolean
  verification_status?: VerificationStatus
}

export type RunDelegatedTaskInput = {
  readonly params: TaskToolParamsStatic
  readonly delegation: DelegationParams
  readonly signal: AbortSignal | undefined
  readonly ctx: TaskToolContext
}

// A delegated start rides the manager's delegated start() overload, whose result type is
// `StartResult | ManagerDelegatedStartResult`. The ordinary set stays in that union on purpose: a
// wiring that ignores the delegation request must be refused here, never called a delegated parent.
// No port is imported here: the admission port stays inside the manager's construction.

const TERMINAL_STATUSES = new Set(["completed", "error", "cancelled", "interrupted", "lost"])

function result(text: string, details: TaskToolDetails): AgentToolResult<TaskToolDetails> {
  return { content: [{ type: "text", text }], details }
}

function invalidArguments(message: string): AgentToolResult<TaskToolDetails> {
  return result(message, { task_id: "", status: "invalid_arguments", mode: "spawn", reason: message })
}

function managerDelegation(delegation: DelegationParams): ManagerDelegationSpec {
  const roles: RoleSpec[] = delegation.roles.map((role) => {
    const mapped: RoleSpec = { key: role.key, assignment: role.assignment }
    return role.depends_on === undefined ? mapped : { ...mapped, dependsOn: role.depends_on }
  })
  const spec: DelegationSpecDraft = { objective: delegation.objective, roles }
  if (delegation.working_directory !== undefined) spec.workingDirectory = delegation.working_directory
  if (delegation.max_nodes !== undefined) spec.maxNodes = delegation.max_nodes
  if (delegation.deadline_ms !== undefined) spec.deadlineMs = delegation.deadline_ms
  return spec
}

// The persisted terminal record is the gate's carrier. The typed store lane parses
// verification_status, so the manager's own record is authoritative inside this process. A host may
// still inject `readTerminalRecord` to read the raw persisted claim when the record was written by
// another process or store instance; it takes precedence when present. Absence never invents
// "verified".
function terminalRecord(deps: TaskToolDeps, taskId: string): TerminalTaskRecord | undefined {
  if (deps.readTerminalRecord !== undefined) {
    try {
      const injected = deps.readTerminalRecord(taskId)
      if (injected !== undefined) return injected
    } catch {
      // An unreadable claim is not evidence of a completed run: fall through to the manager record
      // and let the fail-closed verdict rule below report unverified, never verified.
    }
  }
  return deps.manager.get(taskId)
}

// A completed parent whose claim is absent or not "verified" is never reported as completed: the
// completion gate is the only judge, and an unreadable claim fails CLOSED to unverified.
function effectiveVerdict(record: TerminalTaskRecord): VerificationStatus | undefined {
  if (record.verification_status !== undefined) return record.verification_status
  return record.status === "completed" ? "unverified" : undefined
}

function toolStatus(record: TerminalTaskRecord, verdict: VerificationStatus | undefined): string {
  if (record.status !== "completed") return verdict === "blocked" ? "blocked" : record.status
  return verdict === "verified" ? "completed" : "unverified"
}

function outcomeLines(outcomes: readonly DelegationNodeOutcome[]): string[] {
  if (outcomes.length === 0) return ["- no node outcomes were recorded"]
  return outcomes.map((outcome) => {
    const role = outcome.role ?? "node"
    return `- ${role} ${outcome.nodeId}: ${outcome.outcome} (${outcome.outputBytes} bytes)`
  })
}

function verificationLine(verdict: VerificationStatus | undefined): string {
  return verdict === undefined ? "verification: not claimed" : `verification: ${verdict}`
}

function notVerifiedLine(verdict: VerificationStatus | undefined): string[] {
  if (verdict === "verified") return []
  return ["This is NOT a verified completion; do not report the work as verified."]
}

function delegationDetail(
  runId: string,
  terminalStatus: string,
  outcomes: readonly DelegationNodeOutcome[],
  unresolved: boolean,
  verdict: VerificationStatus | undefined,
): TaskDelegationDetail {
  const detail: DelegationDetailDraft = {
    run_id: runId,
    terminal_status: terminalStatus,
    outcomes,
    unresolved,
  }
  if (verdict !== undefined) detail.verification_status = verdict
  return detail
}

function planErrorMessage(error: PlanResolutionError): string {
  const agents = error.availableAgents
  const categories = error.availableCategories
  const agentSuffix = agents === undefined || agents.length === 0
    ? ""
    : ` Available agents: ${agents.join(", ")}.`
  const categorySuffix = categories === undefined || categories.length === 0
    ? ""
    : error.code === "model_unavailable"
      ? ` Valid category names: ${categories.join(", ")}. Retry one of these, or configure categories.<name>.models in omo.json.`
      : ` Available categories: ${categories.join(", ")}.`
  return error.message + agentSuffix + categorySuffix
}

function readableTerminal(
  deps: TaskToolDeps,
  taskId: string,
  runId: string,
  outcomes: readonly DelegationNodeOutcome[],
  unresolved: boolean,
): AgentToolResult<TaskToolDetails> {
  const record = terminalRecord(deps, taskId)
  if (record === undefined) {
    const reason =
      `the delegated parent ${taskId} has no readable terminal record; ` +
      "the run's verdict is NOT available and the work is not reported complete"
    return result(
      [
        `Delegated run ${runId} (parent ${taskId}): terminal record unavailable.`,
        "verification: unavailable - do not report the work as verified.",
        ...outcomeLines(outcomes),
      ].join("\n"),
      {
        task_id: taskId,
        status: "delegated_unsettled",
        mode: "spawn",
        reason,
        delegation: delegationDetail(runId, "unrecorded", outcomes, unresolved, undefined),
      },
    )
  }

  const epoch = record.notification.run_epoch
  if (!TERMINAL_STATUSES.has(record.status)) {
    const reason = `the delegated parent ${taskId} is still ${record.status}; it is not a terminal result`
    return result(
      [
        `Delegated run ${runId} (parent ${taskId}, epoch ${epoch}): ${record.status}.`,
        "Verification is not claimed before a terminal record exists.",
        ...outcomeLines(outcomes),
      ].join("\n"),
      {
        task_id: taskId,
        run_epoch: epoch,
        status: "delegated_unsettled",
        mode: "spawn",
        reason,
        delegation: delegationDetail(runId, record.status, outcomes, unresolved, undefined),
      },
    )
  }

  const verdict = effectiveVerdict(record)
  const status = toolStatus(record, verdict)
  const text = [
    `Delegated run ${runId} (parent ${taskId}, epoch ${epoch}): ${record.status}.`,
    verificationLine(verdict),
    ...notVerifiedLine(verdict),
    ...outcomeLines(outcomes),
    ...(unresolved ? ["Unresolved: some planned nodes had no terminal record when the run was read."] : []),
  ].join("\n")
  return result(text, {
    task_id: taskId,
    run_epoch: epoch,
    status,
    mode: "spawn",
    delegation: delegationDetail(runId, record.status, outcomes, unresolved, verdict),
  })
}

/**
 * Start a delegated parent through the ordinary manager. The manager owns run creation, node
 * admission through its construction-injected port, the fold, and the terminal write; this tool
 * only validates the request, names the parent record, and projects the gate's persisted claim.
 * There is deliberately no verdict computation here: an unreadable claim reads as unverified.
 */
export async function runDelegatedTask(
  deps: TaskToolDeps,
  input: RunDelegatedTaskInput,
): Promise<AgentToolResult<TaskToolDetails>> {
  const { params, delegation, signal, ctx } = input

  if (signal?.aborted) {
    const reason = "Parent aborted before delegated start"
    return result(reason, { task_id: "", status: "cancelled", mode: "spawn", reason })
  }
  if (params.tasks !== undefined) {
    return invalidArguments("tasks is not supported with delegation: one delegated parent per call.")
  }
  if (params.tools !== undefined) {
    return invalidArguments(
      "tools is not supported with delegation: the delegated parent admits children through the manager's admission port, not a kernel-tool grant.",
    )
  }
  if (params.run_in_background === true) {
    return invalidArguments(
      "run_in_background true is not supported with delegation: the delegated parent settles before this tool returns.",
    )
  }
  if (params.isolated !== undefined || params.apply !== undefined || params.merge !== undefined) {
    return invalidArguments(
      "isolated, apply, and merge are not supported with delegation: the delegated parent owns a plan, not a checkout clone.",
    )
  }

  const selection = validateTaskTarget(params)
  if (selection.kind === "error") return invalidArguments(selection.error.message)
  const target = selection.kind === "category"
    ? { category: selection.category }
    : { subagentType: selection.subagentType }

  const sessionId = ctx.sessionManager.getSessionId()
  const requestedPrompt = params.prompt ?? delegation.objective
  const policy = selection.kind === "subagent_type"
    ? evaluateSpawnPolicy(deps, selection.subagentType, requestedPrompt, sessionId)
    : undefined
  if (policy?.kind === "deny") {
    return result(policy.message, { task_id: "", status: "denied", mode: "spawn", reason: policy.message })
  }
  const prompt = policy?.kind === "force" ? policy.prompt : requestedPrompt

  const spec: ManagerStartSpec & { readonly delegation: ManagerDelegationSpec } = {
    ...buildStartSpec(
      { ...params, prompt, load_skills: params.load_skills ?? [] },
      target,
      sessionId,
      deps,
      ctx.cwd,
    ),
    delegation: managerDelegation(delegation),
  }

  const started = await deps.manager.start(spec)
  switch (started.kind) {
    case "delegated":
      return readableTerminal(deps, started.task_id, started.runId, started.outcomes, started.unresolved)
    case "admission_unavailable":
      return result(started.message, {
        task_id: "",
        status: "admission_unavailable",
        mode: "spawn",
        reason: started.message,
      })
    case "delegation_start_failed":
      return result(started.message, {
        task_id: "",
        status: "delegation_start_failed",
        mode: "spawn",
        reason: `${started.reason}: ${started.message}`,
      })
    case "delegation_plan_rejected": {
      const message =
        `${started.message} (code: ${started.code}; roles: ${started.roleKeys.join(", ") || "none"})`
      return result(message, {
        task_id: "",
        status: "delegation_plan_rejected",
        mode: "spawn",
        reason: message,
      })
    }
    case "deadline_unavailable_at_manager_seam": {
      const text = [
        `Delegated run ${started.runId} did not settle before its deadline.`,
        "verification: not claimed - this is not a completion.",
        started.reason,
        ...outcomeLines(started.outcomes),
        ...(started.unresolved ? ["Unresolved: some planned nodes had no terminal record."] : []),
      ].join("\n")
      return result(text, {
        task_id: "",
        status: "deadline_unavailable_at_manager_seam",
        mode: "spawn",
        reason: started.reason,
        delegation: delegationDetail(
          started.runId,
          "deadline_unavailable_at_manager_seam",
          started.outcomes,
          started.unresolved,
          undefined,
        ),
      })
    }
    case "plan_unresolved": {
      const message = planErrorMessage(started.error)
      return result(message, { task_id: "", status: "plan_error", mode: "spawn", reason: message })
    }
    case "started":
    case "start_failed":
    case "depth_denied":
    case "residency_denied": {
      const message =
        `the manager returned an ordinary ${started.kind} result for a delegated request; ` +
        "no delegated parent was created"
      return result(message, {
        task_id: "",
        status: "delegation_start_failed",
        mode: "spawn",
        reason: message,
      })
    }
  }
}
