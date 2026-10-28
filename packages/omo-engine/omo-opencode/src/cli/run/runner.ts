import { appendFileSync } from "node:fs"
import pc from "picocolors"
import type { RunOptions, RunContext } from "./types"
import { createEventState, processEvents, serializeError } from "./events"
import { loadPluginConfig } from "../../plugin-config"
import { createServerConnection } from "./server-connection"
import { resolveSession } from "./session-resolver"
import { createJsonOutputManager } from "./json-output"
import { executeOnCompleteHook } from "./on-complete-hook"
import { resolveRunAgent } from "./agent-resolver"
import { resolveRunModel } from "./model-resolver"
import { pollForCompletion } from "./poll-for-completion"
import { waitForPromptStart } from "./prompt-start"
import { loadAgentProfileColors } from "./agent-profile-colors"
import { suppressRunInput } from "./stdin-suppression"
import { createTimestampedStdoutController } from "./timestamp-output"
import { createCliPostHog, getPostHogDistinctId } from "../../shared/posthog"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../../shared/prompt-async-gate"
import { isAmbiguousPostDispatchPromptFailure } from "../../shared/prompt-failure-classifier"
import { resolveRunnableRunAgent } from "./runnable-agent-resolver"
import { buildRunnerProfileInput, buildWorkflowProfile, resolveExecutionOptions } from "./workflow-profile"
import { selectWorkflow } from "./workflow-select"
import { isGraphPreflightForcedOff, selectGraphContextLevel } from "./graph-policy"
import { createGraphTelemetry } from "./graph-telemetry"
import { analyzePostEdit } from "./post-edit-impact"
import { buildPromptInput, preparePlannerTurn } from "./plan-evidence"

export { resolveRunAgent }

const EVENT_PROCESSOR_SHUTDOWN_TIMEOUT_MS = 2_000

export async function waitForEventProcessorShutdown(
  eventProcessor: Promise<void>,
  timeoutMs = EVENT_PROCESSOR_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  const completed = await Promise.race([
    eventProcessor.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ])

  void completed
}

export async function run(options: RunOptions): Promise<number> {
  process.env.OPENCODE_CLI_RUN_MODE = "true"
  process.env.OPENCODE_CLIENT = "run"

  const startTime = Date.now()
  const {
    message,
    directory = process.cwd(),
  } = options

  const jsonManager = options.json ? createJsonOutputManager() : null
  if (jsonManager) jsonManager.redirectToStderr()
  const timestampOutput = options.json || options.timestamp === false
    ? null
    : createTimestampedStdoutController()
  timestampOutput?.enable()

  const pluginConfig = loadPluginConfig(directory, { command: "run" })
  const resolvedAgent = resolveRunAgent(options, pluginConfig)
  const abortController = new AbortController()

  const posthog = createCliPostHog({ configEnabled: pluginConfig.telemetry })
  const distinctId = getPostHogDistinctId()
  try {
    posthog.trackActive(distinctId, "run_started")
  } catch (error) {
    if (!(error instanceof Error)) {
      void error
    }
  }

  try {
    const resolvedModel = resolveRunModel(options.model)

    const { client, cleanup: serverCleanup } = await createServerConnection({
      port: options.port,
      attach: options.attach,
      signal: abortController.signal,
    })

    const cleanup = () => {
      serverCleanup()
    }

    const restoreInput = suppressRunInput()
    const handleSigint = () => {
      console.log(pc.yellow("\nInterrupted. Shutting down..."))
      restoreInput()
      cleanup()
      process.exit(130)
    }

    process.on("SIGINT", handleSigint)

    try {
      const sessionID = await resolveSession({
        client,
        sessionId: options.sessionId,
        directory,
      })
      const runnableAgent = await resolveRunnableRunAgent(client, resolvedAgent, pluginConfig, directory)

      console.log(pc.dim(`Session: ${sessionID}`))

      if (resolvedModel) {
        console.log(pc.dim(`Model: ${resolvedModel.providerID}/${resolvedModel.modelID}`))
      }

      const profileInput = buildRunnerProfileInput({
        message,
        sessionId: sessionID,
        requestedAgent: options.agent,
        resolvedAgent,
        requestedModel: options.model,
        resolvedModel,
        directory,
        explicitMode: options.workflow,
      })
      const enriched = buildWorkflowProfile(profileInput)
      const workflowDecision = selectWorkflow(enriched.profile)
      if (options.verbose) {
        console.log(pc.dim(`Workflow: ${workflowDecision.strategy} \u2014 ${workflowDecision.reason} [${enriched.basis.join(", ")}]`))
      }
      const execOpts = resolveExecutionOptions(workflowDecision.strategy)

      const graphDecision = selectGraphContextLevel({
        explicitMode: enriched.profile.explicitMode,
        complexity: enriched.profile.complexity,
        clarity: enriched.profile.clarity,
        risk: enriched.profile.risk,
        fileCount: enriched.profile.fileCount,
        strategy: workflowDecision.strategy,
        message,
        replanCount: enriched.profile.replanCount,
      })
      const graphLevel = isGraphPreflightForcedOff(process.env) ? 0 as const : graphDecision.level
      if (options.verbose) {
        console.log(pc.dim(`Graph preflight: level ${graphLevel} \u2014 ${graphDecision.reasonCode} [${graphDecision.notes.join(", ") || "no notes"}]`))
      }
      // Telemetry is audit-only: it records the decision, never model or source text.
      // A run may point it at a JSONL file so a completed run can be inspected
      // after the fact; without the file it stays in memory for the verbose line.
      const telemetryFile = (process.env.OMO_GRAPH_TELEMETRY_FILE ?? "").trim()
      const graphTelemetry = createGraphTelemetry({
        env: process.env,
        ...(telemetryFile === "" ? {} : {
          sink: (event) => {
            try {
              appendFileSync(telemetryFile, `${JSON.stringify(event)}\n`)
            } catch {
              // Telemetry must never fail a run.
            }
          },
        }),
      })

      const plannerTurn = await preparePlannerTurn({
        message,
        directory,
        strategy: workflowDecision.strategy,
        enabled: options.planEvidence,
        level: graphLevel,
        maxBytes: graphLevel === 0 ? 0 : graphDecision.maxBytes,
        maxSubjects: graphLevel === 0 ? 0 : graphDecision.maxSubjects,
        includeImpactAndTests: graphLevel >= 3,
      })
      if (options.verbose && plannerTurn.evidence !== undefined) {
        const diagnostics = plannerTurn.evidence.diagnostics
        console.log(pc.dim(
          `Plan evidence: ${plannerTurn.evidence.status}` +
          `${diagnostics.reason === undefined ? "" : ` (${diagnostics.reason})`}` +
          ` \u2014 files ${diagnostics.files}, symbols ${diagnostics.subjects.length}, ` +
          `knowledge ${diagnostics.knowledgeRecords}, ${plannerTurn.evidence.bytes} bytes, ${diagnostics.durationMs}ms`,
        ))
      }

      const evidenceDiagnostics = plannerTurn.evidence?.diagnostics
      const graphEscalated = graphDecision.escalateToHighAssurance
        && plannerTurn.evidence?.status !== "available"
      graphTelemetry.record({
        type: "graph-preflight",
        level: graphLevel,
        reasonCode: graphEscalated ? "graph-unavailable-escalated" : graphDecision.reasonCode,
        ...(evidenceDiagnostics?.scope?.revision === undefined ? {} : { generation: evidenceDiagnostics.scope.revision }),
        freshness: plannerTurn.evidence?.status === "available" ? "fresh" : "unknown",
        coverage: plannerTurn.evidence?.status === "available" ? "indexed" : graphLevel === 0 ? "unindexed" : "partial",
        queries: graphLevel === 0 || plannerTurn.skipped !== undefined
          ? []
          : graphLevel >= 3
            ? ["search", "symbolContext", "impact", "findTests"]
            : ["search", "symbolContext"],
        itemCount: evidenceDiagnostics?.subjects.length ?? 0,
        unresolvedCount: 0,
        included: plannerTurn.promptText !== message,
      })
      const ctx: RunContext = {
        client,
        sessionID,
        directory,
        abortController,
        verbose: options.verbose ?? false,
        workflowDecision,
      }
      // The workflow decision selects downstream behavior: direct runs skip
      // the meaningful-work gate while exploratory/planned runs enforce it.
      // (Provably identical to execOpts.requireMeaningfulWork: the execution
      // table maps direct -> false and every other strategy -> true.)
      const requireMeaningfulWork = workflowDecision.strategy !== "direct"
      const events = await client.event.subscribe({ signal: abortController.signal })
      const eventState = createEventState()
      eventState.agentColorsByName = await loadAgentProfileColors(client, directory)
      const eventProcessor = processEvents(ctx, events, eventState).catch(
        () => {},
      )

      if (
        (workflowDecision.strategy === "high-assurance" ||
          workflowDecision.strategy === "bounded-recovery") &&
        workflowDecision.gates.length === 0
      ) {
        throw new Error("gated strategies must never run gateless")
      }
      const promptResult = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID,
        source: "cli-run",
        settleMs: 0,
        queueBehavior: "defer",
        input: buildPromptInput({
          sessionID,
          directory,
          message,
          agent: runnableAgent,
          model: resolvedModel,
          evidence: plannerTurn.evidence,
        }),
      })
      const promptMayHaveBeenAccepted = promptResult.status === "failed"
        && isAmbiguousPostDispatchPromptFailure(promptResult)
      if (promptResult.status === "failed") {
        if (promptMayHaveBeenAccepted) {
          if (options.verbose) {
            console.error(pc.dim("promptAsync returned an ambiguous error after dispatch; continuing to poll session"))
          }
        } else {
          throw promptResult.error
        }
      }
      if (!promptMayHaveBeenAccepted && !isInternalPromptDispatchAccepted(promptResult)) {
        throw new Error(`Session ${sessionID} is not idle; promptAsync skipped by gate: ${promptResult.status}`)
      }
      await waitForPromptStart(ctx, eventState, abortController)
      const exitCode = await pollForCompletion(ctx, eventState, abortController, {
        requireMeaningfulWork,
        // A high-risk request whose graph evidence was unavailable falls back to
        // the existing stricter completion gate instead of inventing one.
        requiredConsecutive: graphEscalated
          ? Math.max(execOpts.requiredConsecutive, 2)
          : execOpts.requiredConsecutive,
      })

      // Post-edit impact runs against the generation THIS run started from, so a
      // stale snapshot is reported as stale instead of being presented as current.
      try {
        const baselineRevision = evidenceDiagnostics?.scope?.revision
        const postEdit = await analyzePostEdit({
          directory,
          ...(baselineRevision === undefined ? {} : { graphRevision: baselineRevision }),
        })
        graphTelemetry.record({
          type: "graph-post-edit",
          level: graphLevel,
          reasonCode: postEdit.invalidated
            ? "graph-invalidated"
            : postEdit.refresh === "unavailable" ? "graph-unavailable" : "graph-current",
          ...(postEdit.envelope.correlation.generation === undefined
            ? {}
            : { generation: postEdit.envelope.correlation.generation }),
          freshness: postEdit.envelope.status.freshness,
          coverage: postEdit.envelope.status.coverage,
          queries: postEdit.changed.length === 0 ? [] : ["impact", "findTests"],
          itemCount: postEdit.envelope.items.length,
          unresolvedCount: postEdit.envelope.unresolved.length,
          included: false,
        })
        if (options.verbose) {
          console.log(pc.dim(
            `Graph post-edit: ${postEdit.changed.length} changed, refresh ${postEdit.refresh}` +
            `${postEdit.invalidated ? ", invalidated" : ""}`,
          ))
        }
      } catch {
        // Post-edit analysis is advisory: it never fails a completed run.
      }

      abortController.abort()

      await waitForEventProcessorShutdown(eventProcessor)
      cleanup()

      const durationMs = Date.now() - startTime

      if (options.onComplete) {
        await executeOnCompleteHook({
          command: options.onComplete,
          sessionId: sessionID,
          exitCode,
          durationMs,
          messageCount: eventState.messageCount,
        })
      }

      if (jsonManager) {
        jsonManager.emitResult({
          sessionId: sessionID,
          success: exitCode === 0,
          durationMs,
          messageCount: eventState.messageCount,
          summary: eventState.lastPartText.slice(0, 200) || "Run completed",
        })
      }

      return exitCode
    } catch (err) {
      cleanup()
      throw err
    } finally {
      process.removeListener("SIGINT", handleSigint)
      restoreInput()
    }
  } catch (err) {
    if (jsonManager) jsonManager.restore()
    timestampOutput?.restore()
    if (err instanceof Error && err.name === "AbortError") {
      return 130
    }
    console.error(pc.red(`Error: ${serializeError(err)}`))
    return 1
  } finally {
    try {
      await posthog.shutdown()
    } catch (error) {
      if (!(error instanceof Error)) {
        void error
      }
    }
    timestampOutput?.restore()
  }
}
