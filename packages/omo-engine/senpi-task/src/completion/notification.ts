import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { isolationDetails, isolationLine } from "../isolation/details"
import { messageability } from "../state"
import type { TaskRecord } from "../state"
import { formatTargetWithModel } from "../status-line"
import { formatRunDuration } from "../tools/run-stats-format"
import {
  excerptRendererPromptText,
  joinRendererTokens,
  normalizeRendererText,
  rendererVisibleWidth,
} from "../tools/task/renderers"
import { DAG_VERIFICATION_DIRECTIVE } from "./dag-verification-directive"
import type { RepairState } from "../repair/state"
import type { VerificationStatus } from "../verification/completion-status"

// The gate's claim rides on the persisted record JSON but is intentionally absent from the
// TaskRecord type (typed loads drop it until the state/store lane parses it), so it is read
// through this narrow structural view instead of widening TaskRecord itself.
type VerifiableRecord = TaskRecord & { readonly verification_status?: VerificationStatus }

function recordGateVerdict(record: TaskRecord): VerificationStatus | undefined {
  // SAFETY: VerifiableRecord only names the persisted verification_status claim the store
  // parses; the cast reads that optional field without widening TaskRecord.
  return (record as VerifiableRecord).verification_status
}
import type {
  CompletionDetails,
  ParentNotifierMessage,
  RepairOutcomeForCompletion,
  RepairOutcomeStatus,
} from "./types"

const FINAL_RESPONSE_TRANSPORT_LIMIT = 32_000

// Input for deriving the completion repair outcome. The outcome is derived ONLY from the gate
// verdict plus the persisted attempt state: `gateVerdict` is the completion gate verdict for the
// run (defaults to the record's `verification_status`), and `attemptState` is the persisted
// repair attempt state. No model claim is read here, and a repair state alone never decides the
// outcome - only the gate verdict can authorize a "verified" word downstream.
export type RepairOutcomeDerivationInput = {
  readonly gateVerdict?: VerificationStatus
  readonly attemptState?: RepairState
  readonly attemptId?: string
  readonly reason?: string
  readonly cancelled?: boolean
}

export type BuildDetailsOptions = {
  readonly tokens?: number
  readonly stateDir?: string
  readonly repair?: RepairOutcomeDerivationInput
}

// Derives the parent-facing repair outcome from the gate verdict plus the persisted attempt
// state. Returns undefined when no repair ran (no attempt state and not cancelled), so callers
// only carry `repair_outcome` for completions a repair actually touched.
//
// The security invariant: a "repaired" attempt with a gate verdict that is not "verified"
// reports "edited_but_blocked" when the gate is "blocked" (and never "repaired_and_verified"),
// so a repair state alone can never publish a verified word the gate did not earn. A repaired
// attempt against an "unverified" gate reports "repaired_but_unverified": work was done but no
// verification was claimed.
export function deriveRepairOutcomeForCompletion(
  input: RepairOutcomeDerivationInput,
): RepairOutcomeForCompletion | undefined {
  const gateVerdict = input.gateVerdict
  const attemptState = input.attemptState
  const attemptId = input.attemptId
  const reason = input.reason
  const withContext = (status: RepairOutcomeStatus): RepairOutcomeForCompletion => {
    let outcome: RepairOutcomeForCompletion = { status }
    if (gateVerdict !== undefined) outcome = { ...outcome, gateVerdict }
    if (attemptState !== undefined) outcome = { ...outcome, attemptState }
    if (attemptId !== undefined) outcome = { ...outcome, attemptId }
    if (reason !== undefined) outcome = { ...outcome, reason }
    return outcome
  }
  if (input.cancelled === true || attemptState === "repair_cancelled") {
    return withContext("repair_cancelled")
  }
  if (attemptState === undefined) return undefined
  if (attemptState === "repair_failed") return withContext("repair_failed")
  if (attemptState === "repaired") {
    if (gateVerdict === "verified") return withContext("repaired_and_verified")
    if (gateVerdict === "blocked") return withContext("edited_but_blocked")
    if (gateVerdict === "unverified") return withContext("repaired_but_unverified")
    return withContext("edited_but_blocked")
  }
  return undefined
}

export function buildCompletionDetails(record: TaskRecord, options: BuildDetailsOptions = {}): CompletionDetails {
  const isolation = isolationDetails(record)
  const finalResponse = finalResponseForNotification(record, options.stateDir)
  const runStats = record.run_stats
  const tokens = options.tokens ?? runStats?.total_tokens
  const base: CompletionDetails = {
    task_id: record.task_id,
    name: record.name ?? record.task_id,
    status: record.status,
    ...(record.category === undefined ? {} : { category: record.category }),
    ...(record.agent_type === undefined ? {} : { agent_type: record.agent_type }),
    model: record.model,
    ...(record.requested_model === undefined
      ? {}
      : { requested_model: record.requested_model }),
    ...(record.fallback_models === undefined
      ? {}
      : { fallback_models: record.fallback_models }),
    ...(record.resolved_model === undefined ? {} : { resolved_model: record.resolved_model }),
    duration_ms: durationMs(record),
    ...(runStats === undefined ? {} : { run_stats: runStats }),
    final_response: finalResponse.text,
    ...(finalResponse.file === undefined ? {} : { final_response_file: finalResponse.file }),
    continuation_hint: continuationHint(record),
    ...(record.resumed_run_epoch !== undefined && record.resumed_run_epoch === record.notification.run_epoch
      ? { resumed_turn: true as const }
      : {}),
    ...(record.owner?.kind === "dag"
      ? { dag: { run_id: record.owner.runId, node_id: record.owner.nodeId } }
      : {}),
    ...(isolation === undefined ? {} : { isolation }),
  }
  // The gate's claim is added by statement, not by an empty-object spread: a completed run with
  // no claim predates the gate and reads as unverified downstream, never as verified.
  const recordVerdict = recordGateVerdict(record)
  const claimed: CompletionDetails =
    recordVerdict === undefined ? base : { ...base, verification_status: recordVerdict }
  const gateVerdict = options.repair?.gateVerdict ?? recordVerdict
  const repairOutcome =
    options.repair === undefined
      ? undefined
      : deriveRepairOutcomeForCompletion({
        gateVerdict,
        attemptState: options.repair.attemptState,
        attemptId: options.repair.attemptId,
        reason: options.repair.reason,
        cancelled: options.repair.cancelled,
      })
  const repaired: CompletionDetails =
    repairOutcome === undefined ? claimed : { ...claimed, repair_outcome: repairOutcome }
  return tokens === undefined ? repaired : { ...repaired, tokens }
}

export function buildCompletionMessage(
  details: readonly CompletionDetails[],
  verificationDirective = DAG_VERIFICATION_DIRECTIVE,
): ParentNotifierMessage {
  const body = completionMessageLines(details).join("\n")
  const carriesDag = details.some((detail) => detail.dag !== undefined)
  return {
    customType: "senpi-task.completion",
    content: carriesDag ? `${body}\n\n${verificationDirective}` : body,
    display: false,
    details,
  }
}

export function completionMessageLines(details: readonly CompletionDetails[], width?: number): readonly string[] {
  return details.flatMap((detail) => completionDetailLines(detail, width))
}

function finalResponseForNotification(record: TaskRecord, stateDir: string | undefined): { readonly text: string; readonly file?: string } {
  const source = record.final_response ?? record.error_message ?? ""
  if (source.length <= FINAL_RESPONSE_TRANSPORT_LIMIT) return { text: source }
  if (stateDir === undefined) return { text: source.slice(0, FINAL_RESPONSE_TRANSPORT_LIMIT) }

  const path = completionSpillPath(stateDir, record.task_id)
  mkdirSync(join(stateDir, "completion-results"), { recursive: true })
  writeFileSync(path, source, "utf8")
  return { text: source.slice(0, FINAL_RESPONSE_TRANSPORT_LIMIT), file: `local://${path}` }
}

function completionSpillPath(stateDir: string, taskId: string): string {
  return join(stateDir, "completion-results", `${taskId}.txt`)
}

function durationMs(record: TaskRecord): number {
  const started = Date.parse(record.created_at)
  const ended = Date.parse(record.updated_at)
  if (Number.isNaN(started) || Number.isNaN(ended)) return 0
  return Math.max(0, ended - started)
}

function continuationHint(record: TaskRecord): string {
  const mode = messageability(record.status, record.residency_state, record.execution_mode, record.killed)
  if (mode === "not-continuable") return ""
  return `Use task_send({ to: "${record.task_id}", message: "..." }) to continue.`
}

function completionDetailLines(detail: CompletionDetails, width: number | undefined): readonly string[] {
  const identity = joinRendererTokens([
    detail.resumed_turn === true ? "task completion (resumed turn)" : "task completion",
    `name:${normalizeRendererText(detail.name)}`,
    `id:${normalizeRendererText(detail.task_id)}`,
    formatTargetWithModel({
      category: detail.category,
      agentType: detail.agent_type,
      resolvedModel: detail.resolved_model,
      model: detail.model,
    }),
    fallbackToken(detail),
    `status:${normalizeRendererText(detail.status)}`,
    verificationToken(detail),
    repairToken(detail),
  ])
  const stats = joinRendererTokens([
    `duration:${formatDuration(detail.duration_ms)}`,
    detail.tokens === undefined ? undefined : `tokens:${detail.tokens}`,
    detail.run_stats?.tool_calls === undefined ? undefined : `tools:${detail.run_stats.tool_calls}`,
    detail.run_stats?.tokens_per_second === undefined ? undefined : `tps:${detail.run_stats.tokens_per_second}`,
  ])
  const summaryLines = width === undefined
    ? [joinRendererTokens([identity, stats])]
    : [excerptRendererPromptText(identity, width), excerptRendererPromptText(stats, width)]
  const response = width === undefined ? detail.final_response : normalizeRendererText(detail.final_response)
  const continuation = width === undefined ? detail.continuation_hint : normalizeRendererText(detail.continuation_hint)
  const resultPrefix = 'result:"'
  const resultFilePrefix = "result_file:"
  const nextPrefix = "next:"
  return [
    ...summaryLines,
    ...(response.length === 0
      ? []
      : [`${resultPrefix}${excerptForWidth(response, width, resultPrefix, '"')}"`]),
    ...(detail.final_response_file === undefined
      ? []
      : [`${resultFilePrefix}${excerptForWidth(detail.final_response_file, width, resultFilePrefix, "")}`]),
    ...(detail.isolation === undefined ? [] : [isolationLine(detail.isolation)]),
    ...(continuation.length === 0
      ? []
      : [`${nextPrefix}${excerptForWidth(continuation, width, nextPrefix, "")}`]),
  ]
}

// The parent agent reads this line to decide whether the work is done. A completed run whose record
// carries no claim predates the gate (or was never gated), so it reports unverified - never verified.
function verificationToken(detail: CompletionDetails): string | undefined {
  if (detail.verification_status !== undefined) {
    return `verification:${normalizeRendererText(detail.verification_status)}`
  }
  return detail.status === "completed" ? "verification:unverified" : undefined
}

// The parent agent reads this token to learn the repair outcome without parsing structured
// details. Absent when no repair ran; present as `repair:<status>` otherwise.
function repairToken(detail: CompletionDetails): string | undefined {
  if (detail.repair_outcome === undefined) return undefined
  return `repair:${normalizeRendererText(detail.repair_outcome.status)}`
}

function fallbackToken(detail: CompletionDetails): string | undefined {
  const requested = detail.requested_model?.display
  const resolved = detail.resolved_model?.display ?? detail.model
  if (requested === undefined || requested === resolved) return undefined
  return `fallback:${normalizeRendererText(requested)}->${normalizeRendererText(resolved)}`
}

function excerptForWidth(value: string, width: number | undefined, prefix: string, suffix: string): string {
  if (width === undefined) return value
  return excerptRendererPromptText(value, availableExcerptWidth(width, prefix, suffix))
}

function availableExcerptWidth(width: number | undefined, prefix: string, suffix: string): number | undefined {
  if (width === undefined) return undefined
  return Math.max(0, width - rendererVisibleWidth(prefix) - rendererVisibleWidth(suffix))
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs}ms`
  if (durationMs >= 60_000) return formatRunDuration(durationMs)
  const seconds = (durationMs / 1_000).toFixed(2).replace(/\.00$/u, "").replace(/(\.\d)0$/u, "$1")
  return `${seconds}s`
}
