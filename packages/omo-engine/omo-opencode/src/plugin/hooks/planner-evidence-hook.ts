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
  readonly buildEvidence?: (input: { readonly message: string; readonly directory: string; readonly env: Record<string, string | undefined> }) => Promise<PlannerEvidence>
}

export type PlannerEvidenceHookInput = { readonly sessionID: string }
export type PlannerEvidenceHookOutput = { readonly note?: (text: string) => void }

export function createPlannerEvidenceHook(deps: PlannerEvidenceHookDeps) {
  const build = deps.buildEvidence ?? buildPlannerEvidence
  return {
    async handler(input: PlannerEvidenceHookInput, output: PlannerEvidenceHookOutput): Promise<void> {
      if (!isPlanEvidenceEnabled(deps.env)) return
      const message = await deps.readLastUserText(input.sessionID).catch(() => undefined)
      if (message === undefined || message.trim().length === 0) return
      const evidence = await build({ message, directory: deps.directory(), env: deps.env }).catch(() => undefined)
      const text = evidence?.text
      if (typeof text !== "string" || text.length === 0) return
      output.note?.(text)
    },
  }
}
