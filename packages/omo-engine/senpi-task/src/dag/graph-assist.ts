// Conservative graph assist: a code-graph impact neighborhood may only recommend MORE
// caution (extra serialization, extra verification checks), never less. The scheduler's
// writeScopes conflict admission and the verification acceptance gate stay authoritative:
// this module has no "safe" or "skip" output, only additional constraints to union in.
//
// Confidence discipline comes from the code-graph schema (s53-phase-a schema-draft.md
// sections 2-3): unresolved dynamics (CALLS_UNRESOLVED-style edges, unknown callees,
// missing graph data) are capped at <= 0.50, labeled uncertain, and never consumed as
// fact. A missing graph or an unresolved symbol therefore forces caution, never clearance.
import type { DagNodeId } from "./types"
import type { DagVerifyCheck } from "./verification"

// One impact edge out of a changed symbol. `resolved: false` marks a CALLS_UNRESOLVED-style
// uncertain edge (unknown callee); it is never upgraded by heuristics, only replaced by a
// later static resolution. Confidence follows the schema scale (number in [0,1]).
export type GraphAssistNeighbor = {
  readonly symbol: string
  readonly confidence: number
  readonly resolved: boolean
}

// The impact neighborhood for one changed-symbol set. `impactedBy` maps each changed symbol
// to its impacted neighbors; a changed symbol with NO entry means the graph has no data for
// it (unknown, not empty). `unresolvedSymbols` carries the CALLS_UNRESOLVED-style uncertain
// symbols that touch this change scope.
export type GraphImpactNeighborhood = {
  readonly changedSymbols: readonly string[]
  readonly impactedBy: ReadonlyMap<string, readonly GraphAssistNeighbor[]>
  readonly unresolvedSymbols: readonly string[]
}

// Optional scheduler input. Absent entirely, the scheduler behaves exactly like today:
// admission and gates are byte-identical with and without graph input.
export type GraphAssistInput = {
  // Undefined = the graph is missing for this run: maximal caution, never clearance.
  readonly neighborhood?: GraphImpactNeighborhood
  // Symbols each node touches. Nodes with no entry are unattributed (unknown, not clean).
  readonly nodeSymbols?: ReadonlyMap<DagNodeId, readonly string[]>
  // Candidate extra checks the graph may recommend. Only ever appended, never substituted.
  readonly candidateChecks?: readonly DagVerifyCheck[]
}

export type GraphAssistRecommendation = {
  // Additional admittable nodes to hold back this pass (serialized behind their peers).
  // Always a subset of the admittable set the caller passed in.
  readonly extraSerialized: readonly DagNodeId[]
  // Additional verification checks to require. Unioned after the base required checks.
  readonly extraChecks: readonly DagVerifyCheck[]
  readonly reasons: readonly string[]
}

// The single hook: neighborhood in, extra caution out. It cannot lift a writeScopes
// conflict (it only names further nodes to serialize) and it cannot drop a required
// check (it only names further checks to require).
export function recommendGraphAssist(input: {
  readonly neighborhood?: GraphImpactNeighborhood
  readonly admittable: readonly DagNodeId[]
  readonly nodeSymbols: ReadonlyMap<DagNodeId, readonly string[]>
  readonly availableChecks: readonly DagVerifyCheck[]
}): GraphAssistRecommendation {
  const serialization = recommendExtraSerialization({
    admittable: input.admittable,
    nodeSymbols: input.nodeSymbols,
    neighborhood: input.neighborhood,
  })
  const verification = recommendExtraVerification({
    neighborhood: input.neighborhood,
    nodeSymbols: input.nodeSymbols,
    admittable: input.admittable,
    available: input.availableChecks,
  })
  return {
    extraSerialized: serialization.extraSerialized,
    extraChecks: verification.extraChecks,
    reasons: [...serialization.reasons, ...verification.reasons],
  }
}

// Pairwise safety predicate. True ONLY when the graph affirmatively proves independence:
// a present neighborhood, full attribution for both sides, no unresolved symbols touched,
// and disjoint resolved high-confidence closures. Every other input — missing graph,
// missing attribution, unresolved dynamics, intersecting impact — returns false. There is
// no path that declares two tasks safe from ignorance.
export function isGraphSafeToParallelize(
  aSymbols: readonly string[],
  bSymbols: readonly string[],
  neighborhood: GraphImpactNeighborhood | undefined,
): boolean {
  if (neighborhood === undefined) return false
  const unresolved = new Set(neighborhood.unresolvedSymbols)
  if (aSymbols.some((symbol) => unresolved.has(symbol))) return false
  if (bSymbols.some((symbol) => unresolved.has(symbol))) return false
  const closureA = resolvedClosure(aSymbols, neighborhood)
  const closureB = resolvedClosure(bSymbols, neighborhood)
  if (closureA === undefined || closureB === undefined) return false
  for (const symbol of closureA) {
    if (closureB.has(symbol)) return false
  }
  return true
}

// Resolved high-confidence closure of a symbol set: the symbols themselves plus neighbors
// that are resolved AND above the 0.50 promotion-style gate. Returns undefined when any
// symbol's neighborhood is unknown (no entry) or carries an unresolved/low-confidence
// edge — unknown is not empty, so the caller must stay cautious.
function resolvedClosure(
  symbols: readonly string[],
  neighborhood: GraphImpactNeighborhood,
): Set<string> | undefined {
  const closure = new Set<string>()
  for (const symbol of symbols) {
    const neighbors = neighborhood.impactedBy.get(symbol)
    if (neighbors === undefined) return undefined
    closure.add(symbol)
    for (const neighbor of neighbors) {
      if (!neighbor.resolved || neighbor.confidence <= 0.5) return undefined
      closure.add(neighbor.symbol)
    }
  }
  return closure
}

function riskySymbolSet(neighborhood: GraphImpactNeighborhood): { readonly risky: Set<string>; readonly unknown: boolean } {
  const risky = new Set<string>(neighborhood.changedSymbols)
  for (const symbol of neighborhood.unresolvedSymbols) risky.add(symbol)
  let unknown = false
  for (const changed of neighborhood.changedSymbols) {
    const neighbors = neighborhood.impactedBy.get(changed)
    if (neighbors === undefined) {
      unknown = true
      continue
    }
    for (const neighbor of neighbors) risky.add(neighbor.symbol)
  }
  return { risky, unknown }
}

export function recommendExtraSerialization(input: {
  readonly admittable: readonly DagNodeId[]
  readonly nodeSymbols: ReadonlyMap<DagNodeId, readonly string[]>
  readonly neighborhood?: GraphImpactNeighborhood
}): { readonly extraSerialized: readonly DagNodeId[]; readonly reasons: readonly string[] } {
  const { admittable, nodeSymbols, neighborhood } = input
  if (admittable.length < 2) return { extraSerialized: [], reasons: [] }
  // Missing graph: ignorance is never clearance. Hold every node past the first so at most
  // one frontier node runs at a time until real evidence exists.
  if (neighborhood === undefined) {
    return {
      extraSerialized: admittable.slice(1),
      reasons: ["graph missing for this run: serializing the frontier past the first node"],
    }
  }
  // Unresolved dynamics are never proven safe: any uncertainty in scope serializes the
  // frontier past the first node instead of trusting node attribution to prove it untouched.
  if (neighborhood.unresolvedSymbols.length > 0) {
    return {
      extraSerialized: admittable.slice(1),
      reasons: [`graph reports ${neighborhood.unresolvedSymbols.length} unresolved symbols: serializing the frontier past the first node`],
    }
  }
  const { risky, unknown } = riskySymbolSet(neighborhood)
  // A changed symbol with no neighborhood entry, or a node with no symbol attribution, is
  // unknown — unknown serializes, exactly like a missing graph.
  const riskyNodes = admittable.filter((nodeId) => {
    const symbols = nodeSymbols.get(nodeId)
    if (symbols === undefined || symbols.length === 0) return true
    return symbols.some((symbol) => risky.has(symbol))
  })
  if (unknown) {
    return {
      extraSerialized: admittable.slice(1),
      reasons: ["graph has no neighborhood for a changed symbol: serializing the frontier past the first node"],
    }
  }
  if (riskyNodes.length < 2) return { extraSerialized: [], reasons: [] }
  return {
    extraSerialized: riskyNodes.slice(1),
    reasons: [`graph impact overlaps on ${riskyNodes.length} frontier nodes: serializing past the first`],
  }
}

export function recommendExtraVerification(input: {
  readonly neighborhood?: GraphImpactNeighborhood
  readonly nodeSymbols?: ReadonlyMap<DagNodeId, readonly string[]>
  readonly admittable?: readonly DagNodeId[]
  readonly available: readonly DagVerifyCheck[]
}): { readonly extraChecks: readonly DagVerifyCheck[]; readonly reasons: readonly string[] } {
  const { neighborhood, available } = input
  if (available.length === 0) return { extraChecks: [], reasons: [] }
  // Missing graph: recommend everything available. The caller unions these after its base
  // required checks, so nothing required is ever dropped — the run just proves more.
  if (neighborhood === undefined) {
    return {
      extraChecks: [...available],
      reasons: ["graph missing for this run: recommending every candidate check"],
    }
  }
  // Unresolved dynamics are never proven safe: any uncertainty in scope recommends the full
  // candidate set rather than a guessed subset.
  if (neighborhood.unresolvedSymbols.length > 0) {
    return {
      extraChecks: [...available],
      reasons: [`graph reports ${neighborhood.unresolvedSymbols.length} unresolved symbols: recommending every candidate check`],
    }
  }
  const { risky, unknown } = riskySymbolSet(neighborhood)
  if (unknown) {
    return {
      extraChecks: [...available],
      reasons: ["graph has no neighborhood for a changed symbol: recommending every candidate check"],
    }
  }
  const nodeSymbols = input.nodeSymbols
  const admittable = input.admittable
  // Without node attribution the impact cannot be scoped to unaffected nodes, so stay broad.
  // With full attribution and no risky node admitted, the graph adds nothing: the mandatory
  // gate then reads byte-identical requirements with and without graph input.
  if (nodeSymbols !== undefined && admittable !== undefined) {
    const touched = admittable.some((nodeId) => {
      const symbols = nodeSymbols.get(nodeId)
      if (symbols === undefined || symbols.length === 0) return true
      return symbols.some((symbol) => risky.has(symbol))
    })
    if (!touched) return { extraChecks: [], reasons: [] }
  }
  const impacted = neighborhood.changedSymbols.some((changed) =>
    (neighborhood.impactedBy.get(changed) ?? []).length > 0,
  )
  if (!impacted) return { extraChecks: [], reasons: [] }
  return {
    extraChecks: [...available],
    reasons: ["graph impact reaches beyond the changed symbols: recommending every candidate check"],
  }
}

// Append-only admission merge: moves nodes from admittable to conflicted, never the reverse.
// Nodes the base partition already parked stay parked; unknown ids in `extra` are ignored.
export function applyGraphSerialization(
  admittable: readonly DagNodeId[],
  conflicted: readonly DagNodeId[],
  extra: readonly DagNodeId[],
): { readonly admittable: readonly DagNodeId[]; readonly conflicted: readonly DagNodeId[] } {
  if (extra.length === 0) return { admittable, conflicted }
  const heldBack = new Set(extra)
  return {
    admittable: admittable.filter((nodeId) => !heldBack.has(nodeId)),
    conflicted: [...conflicted, ...admittable.filter((nodeId) => heldBack.has(nodeId))],
  }
}

// Append-only check merge: base required checks keep their order and identity, extras join
// behind them deduplicated by checkId. With no extras the result is element-identical to base,
// so mandatory gates read byte-identical requirements with and without graph input.
export function withGraphAssistChecks(
  baseRequired: readonly DagVerifyCheck[],
  extra: readonly DagVerifyCheck[],
): readonly DagVerifyCheck[] {
  if (extra.length === 0) return baseRequired
  const seen = new Set(baseRequired.map((check) => check.checkId))
  const merged = [...baseRequired]
  for (const check of extra) {
    if (seen.has(check.checkId)) continue
    seen.add(check.checkId)
    merged.push(check)
  }
  return merged
}
