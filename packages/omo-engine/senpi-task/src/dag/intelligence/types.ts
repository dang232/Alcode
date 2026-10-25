import type { DagVerifyCheck } from "../verification"

// Bounded evidence vocabulary shared by every intelligence module. Query inputs mirror the
// code-graph envelope structurally (no package dependency), so a host owning the graph passes
// real query results and a host without one passes nothing.

export const UNDERSTANDING_LIMITS = {
  symbols: 24,
  impacted: 24,
  tests: 12,
  constraints: 8,
  uncertainties: 24,
  nodeSymbols: 8,
  nodeImpacted: 4,
  nodeTests: 4,
  nodeConstraints: 4,
  renderBytes: 4096,
} as const

export type UnderstandingLimits = {
  readonly [K in keyof typeof UNDERSTANDING_LIMITS]?: number
}

export const EVIDENCE_QUERY_KINDS = [
  "search",
  "symbolContext",
  "impact",
  "findTests",
  "detectChanges",
  "trace",
] as const

export type EvidenceQueryKind = (typeof EVIDENCE_QUERY_KINDS)[number]

export type QueryCoverage = "indexed" | "partial" | "unindexed"

export type EvidenceFreshness = "fresh" | "stale"

export type KnowledgeTrust =
  | "source-verified"
  | "previously-verified"
  | "unverified-hypothesis"
  | "environment-specific"
  | "superseded"

export type UnderstandingScope = {
  readonly projectId: string
  readonly worktreeId: string
  readonly revision: string
  readonly fingerprint: string
}

export type EvidenceItemInput = {
  readonly id: string
  readonly file: string
  readonly line: number
  readonly name?: string
  readonly confidence: number
  readonly knowledgeIds?: readonly string[]
}

export type EvidenceEnvelopeInput = {
  readonly projectId: string
  readonly worktreeId: string
  readonly revision: string
  readonly fingerprint: string
  readonly freshness: EvidenceFreshness
  readonly coverage: QueryCoverage
  readonly truncated: boolean
  readonly knowledgeIds?: readonly string[]
  readonly unresolved?: readonly string[]
  readonly unsupported?: readonly string[]
  readonly items: readonly EvidenceItemInput[]
}

export type SymbolContextEnvelopeInput = EvidenceEnvelopeInput & {
  readonly definition?: EvidenceItemInput
  readonly callers?: readonly EvidenceItemInput[]
  readonly callees?: readonly EvidenceItemInput[]
}

export type ImpactEnvelopeInput = EvidenceEnvelopeInput & {
  readonly subject?: EvidenceItemInput
  readonly impacted?: readonly EvidenceItemInput[]
}

export type FindTestsEnvelopeInput = EvidenceEnvelopeInput & {
  readonly subjectFile?: string
  readonly candidates?: readonly EvidenceItemInput[]
}

export type ChangeItemInput = {
  readonly id: string
  readonly file: string
  readonly line: number
  readonly cause: string
  readonly confidence: number
}

export type DetectChangesEnvelopeInput = EvidenceEnvelopeInput & {
  readonly changes?: readonly ChangeItemInput[]
}

export type TraceEnvelopeInput = EvidenceEnvelopeInput

export type TaskUnderstandingQueries = {
  readonly search?: EvidenceEnvelopeInput
  readonly symbolContext?: SymbolContextEnvelopeInput
  readonly impact?: ImpactEnvelopeInput
  readonly findTests?: FindTestsEnvelopeInput
  readonly detectChanges?: DetectChangesEnvelopeInput
  readonly trace?: TraceEnvelopeInput
}

export type KnowledgeRecordInput = {
  readonly id: string
  readonly claim: string
  readonly category: string
  readonly sourceFile: string
  readonly sourceRevision: string
  readonly validatedAt?: string
  readonly supersededBy?: string
  readonly projectId?: string
  readonly fingerprint?: string
}

export type TaskUnderstandingInput = {
  readonly scope: UnderstandingScope
  readonly queries?: TaskUnderstandingQueries
  readonly knowledge?: readonly KnowledgeRecordInput[]
  readonly limits?: UnderstandingLimits
}

export type UnderstandingSymbol = {
  readonly id: string
  readonly file: string
  readonly line: number
  readonly name?: string
  readonly confidence: number
  readonly knowledgeIds: readonly string[]
  readonly sources: readonly EvidenceQueryKind[]
}

export type UnderstandingChange = {
  readonly id: string
  readonly file: string
  readonly line: number
  readonly cause: string
  readonly confidence: number
}

export type UnderstandingConstraint = {
  readonly id: string
  readonly claim: string
  readonly trust: KnowledgeTrust
  readonly sourceFile: string
  readonly sourceRevision: string
  readonly validatedAt?: string
  readonly authoritative: boolean
}

export type UnderstandingUncertaintyKind =
  | "stale"
  | "cross-project"
  | "revision-mismatch"
  | "missing-query"
  | "partial"
  | "unindexed"
  | "unresolved"
  | "low-confidence"

export type UnderstandingUncertainty = {
  readonly kind: UnderstandingUncertaintyKind
  readonly note: string
  readonly symbolIds?: readonly string[]
}

export type QueryObservation = {
  readonly kind: EvidenceQueryKind
  readonly present: boolean
  readonly coverage: QueryCoverage
  readonly truncated: boolean
  readonly freshness: EvidenceFreshness
  readonly answered: boolean
}

export type TaskUnderstanding = {
  readonly scope: UnderstandingScope | undefined
  readonly freshness: EvidenceFreshness | "unknown"
  readonly symbols: readonly UnderstandingSymbol[]
  readonly advisorySymbols: readonly UnderstandingSymbol[]
  readonly impacted: readonly UnderstandingSymbol[]
  readonly tests: readonly UnderstandingSymbol[]
  readonly testSubjects?: ReadonlyMap<string, string>
  readonly changes: readonly UnderstandingChange[]
  readonly constraints: readonly UnderstandingConstraint[]
  readonly uncertainties: readonly UnderstandingUncertainty[]
  readonly queries: readonly QueryObservation[]
  readonly usableForCaution: boolean
  readonly truncated: boolean
  readonly truncationReasons: readonly string[]
}

export type NodeEvidenceInput = {
  readonly nodeId: string
  readonly prompt: string
  readonly writeScopes?: readonly string[]
}

export type NodeContextPackage = {
  readonly nodeId: string
  readonly freshness: EvidenceFreshness | "unknown"
  readonly revision: string
  readonly symbols: readonly UnderstandingSymbol[]
  readonly impacted: readonly UnderstandingSymbol[]
  readonly tests: readonly UnderstandingSymbol[]
  readonly constraints: readonly UnderstandingConstraint[]
  readonly uncertainties: readonly UnderstandingUncertainty[]
  readonly truncated: boolean
  readonly text: string
}

export type PlanHints = {
  readonly writeScopes: ReadonlyMap<string, readonly string[]>
  readonly risks: readonly string[]
}
