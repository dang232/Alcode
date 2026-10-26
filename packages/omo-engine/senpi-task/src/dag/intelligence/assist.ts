import type { GraphAssistInput, GraphAssistNeighbor } from "../graph-assist"
import type { DagNodeId } from "../types"
import type { DagVerifyCheck } from "../verification"
import type { TaskUnderstanding } from "./types"

export type GraphAssistBuildInput = {
  readonly understanding: TaskUnderstanding
  readonly nodeSymbols?: ReadonlyMap<DagNodeId, readonly string[]>
  readonly candidateChecks?: readonly DagVerifyCheck[]
}

export function toGraphAssist(input: GraphAssistBuildInput): GraphAssistInput {
  const understanding = input.understanding
  const passthrough: Pick<GraphAssistInput, "nodeSymbols" | "candidateChecks"> = {
    nodeSymbols: input.nodeSymbols,
    candidateChecks: input.candidateChecks,
  }
  const detectChanges = understanding.queries.find((observation) => observation.kind === "detectChanges")
  // Missing evidence serializes; it never clears the caller-provided attribution and checks.
  if (!understanding.usableForCaution || detectChanges === undefined || !detectChanges.answered) {
    return { neighborhood: undefined, ...passthrough }
  }
  const changedSymbols: string[] = []
  for (const change of understanding.changes) {
    if (change.confidence >= 1 && !changedSymbols.includes(change.id)) changedSymbols.push(change.id)
  }
  const impact = understanding.queries.find((observation) => observation.kind === "impact")
  const impactIndexed = impact !== undefined && impact.answered && impact.coverage === "indexed"
  // TaskUnderstanding does not retain the impact subject, so confirmed-symbol membership is the
  // conservative proxy for subject match: over-attribution only adds serialization, never relaxes it.
  const confirmed = new Set(understanding.symbols.map((symbol) => symbol.id))
  const impactedBy = new Map<string, readonly GraphAssistNeighbor[]>()
  for (const id of changedSymbols) {
    if (confirmed.has(id)) {
      impactedBy.set(
        id,
        understanding.impacted.map((symbol) => ({ symbol: symbol.id, confidence: symbol.confidence, resolved: symbol.confidence >= 1 })),
      )
    } else if (impactIndexed) {
      impactedBy.set(id, [])
    }
  }
  const unresolvedSymbols: string[] = []
  for (const uncertainty of understanding.uncertainties) {
    if (uncertainty.kind !== "unresolved" && uncertainty.kind !== "low-confidence") continue
    for (const id of uncertainty.symbolIds ?? []) {
      if (!unresolvedSymbols.includes(id)) unresolvedSymbols.push(id)
    }
  }
  return {
    neighborhood: { changedSymbols, impactedBy, unresolvedSymbols },
    ...passthrough,
  }
}
