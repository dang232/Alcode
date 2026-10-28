import { appendFileSync } from "node:fs"
import { createGraphTelemetry } from "../../cli/run/graph-telemetry"
import { isGraphPreflightForcedOff, selectGraphContextLevel } from "../../cli/run/graph-policy"
import { buildPlannerEvidence, isPlanEvidenceEnabled, type PlannerEvidence } from "../../cli/run/plan-evidence"

/**
 * Planner-evidence host wiring: appends the graph-and-rationale block to the model's system prompt
 * for a normal chat turn, which is what `run()` does for CLI turns. Without this the plugin renders
 * no evidence and never consults the project-knowledge store, so the engine's retrieval path has no
 * runtime home inside the app.
 */
export type PlannerEvidenceHookDeps = {
  readonly env: Record<string, string | undefined>
  readonly directory: () => string
  readonly readLastUserText: (sessionID: string) => Promise<string | undefined>
  readonly buildEvidence?: (input: { readonly message: string; readonly directory: string; readonly env: Record<string, string | undefined>; readonly maxBytes?: number }) => Promise<PlannerEvidence>
}

export type PlannerEvidenceHookInput = { readonly sessionID: string }
export type PlannerEvidenceHookOutput = { readonly note?: (text: string) => void }

export function createPlannerEvidenceHook(deps: PlannerEvidenceHookDeps) {
  const build = deps.buildEvidence ?? buildPlannerEvidence
  const telemetryFile = (deps.env.OMO_GRAPH_TELEMETRY_FILE ?? "").trim()
  const telemetry = createGraphTelemetry({
    env: deps.env,
    ...(telemetryFile === ""
      ? {}
      : {
        sink: (event) => {
          try {
            appendFileSync(telemetryFile, `${JSON.stringify(event)}\n`)
          } catch {
            // Telemetry must never fail a chat turn.
          }
        },
      }),
  })
  return {
    async handler(input: PlannerEvidenceHookInput, output: PlannerEvidenceHookOutput): Promise<void> {
      if (!isPlanEvidenceEnabled(deps.env)) return
      if (isGraphPreflightForcedOff(deps.env)) return
      const message = await deps.readLastUserText(input.sessionID).catch(() => undefined)
      if (message === undefined || message.trim().length === 0) return
      // Same deterministic policy as the CLI run path, decided from the chat
      // message alone because a chat turn carries no workflow profile yet.
      const decision = selectGraphContextLevel({ message })
      if (decision.level === 0) {
        telemetry.record({
          type: "graph-preflight",
          level: 0,
          reasonCode: decision.reasonCode,
          freshness: "unknown",
          coverage: "unindexed",
          queries: [],
          itemCount: 0,
          unresolvedCount: 0,
          included: false,
        })
        return
      }
      const evidence = await build({
        message,
        directory: deps.directory(),
        env: deps.env,
        maxBytes: decision.maxBytes,
      }).catch(() => undefined)
      const text = evidence?.text
      const included = typeof text === "string" && text.length > 0
      telemetry.record({
        type: "graph-preflight",
        level: decision.level,
        reasonCode: decision.reasonCode,
        ...(evidence?.diagnostics?.scope?.revision === undefined
          ? {}
          : { generation: evidence.diagnostics.scope.revision }),
        freshness: evidence?.status === "available" ? "fresh" : "unknown",
        coverage: evidence?.status === "available" ? "indexed" : "partial",
        queries: included ? ["search", "symbolContext", "impact", "findTests"] : [],
        itemCount: evidence?.diagnostics?.subjects?.length ?? 0,
        unresolvedCount: 0,
        included,
      })
      if (!included) return
      output.note?.(text as string)
    },
  }
}
