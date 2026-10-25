import {
  EVIDENCE_QUERY_KINDS,
  UNDERSTANDING_LIMITS,
  type EvidenceEnvelopeInput,
  type EvidenceItemInput,
  type EvidenceQueryKind,
  type KnowledgeTrust,
  type QueryObservation,
  type TaskUnderstanding,
  type TaskUnderstandingInput,
  type TaskUnderstandingQueries,
  type UnderstandingChange,
  type UnderstandingConstraint,
  type UnderstandingSymbol,
  type UnderstandingUncertainty,
  type UnderstandingScope,
} from "./types"

type SymbolFlags = {
  readonly toSymbols: boolean
  readonly toImpacted: boolean
  readonly toTests: boolean
}

type Contribution = {
  readonly item: EvidenceItemInput
  readonly flags: SymbolFlags
}

type MergedSymbol = {
  readonly id: string
  file: string
  line: number
  name: string | undefined
  confidence: number
  knowledgeIds: string[]
  sources: EvidenceQueryKind[]
}

const SYMBOL_ONLY: SymbolFlags = { toSymbols: true, toImpacted: false, toTests: false }
const SYMBOL_AND_IMPACTED: SymbolFlags = { toSymbols: true, toImpacted: true, toTests: false }
const TEST_ONLY: SymbolFlags = { toSymbols: false, toImpacted: false, toTests: true }

const MISSING_QUERY_KINDS: readonly EvidenceQueryKind[] = ["symbolContext", "impact", "findTests", "detectChanges"]

const KNOWLEDGE_TRUST_VALUES: readonly KnowledgeTrust[] = [
  "source-verified",
  "previously-verified",
  "unverified-hypothesis",
  "environment-specific",
  "superseded",
]

function knowledgeTrust(category: string): KnowledgeTrust {
  return KNOWLEDGE_TRUST_VALUES.find((value) => value === category) ?? "unverified-hypothesis"
}

function scopeMismatch(
  envelope: EvidenceEnvelopeInput,
  scope: UnderstandingScope,
): "cross-project" | "revision-mismatch" | undefined {
  if (envelope.projectId !== scope.projectId || envelope.worktreeId !== scope.worktreeId) return "cross-project"
  if (envelope.revision !== scope.revision) return "revision-mismatch"
  return undefined
}

function contributionsForKind(kind: EvidenceQueryKind, queries: TaskUnderstandingQueries): Contribution[] {
  switch (kind) {
    case "search":
      return (queries.search?.items ?? []).map((item) => ({ item, flags: SYMBOL_ONLY }))
    case "trace":
      return (queries.trace?.items ?? []).map((item) => ({ item, flags: SYMBOL_ONLY }))
    case "symbolContext": {
      const envelope = queries.symbolContext
      if (envelope === undefined) return []
      return [
        ...(envelope.definition === undefined ? [] : [{ item: envelope.definition, flags: SYMBOL_ONLY }]),
        ...(envelope.callers ?? []).map((item) => ({ item, flags: SYMBOL_AND_IMPACTED })),
        ...(envelope.callees ?? []).map((item) => ({ item, flags: SYMBOL_ONLY })),
      ]
    }
    case "impact": {
      const envelope = queries.impact
      if (envelope === undefined) return []
      return [
        ...(envelope.subject === undefined ? [] : [{ item: envelope.subject, flags: SYMBOL_ONLY }]),
        ...(envelope.impacted ?? []).map((item) => ({ item, flags: SYMBOL_AND_IMPACTED })),
      ]
    }
    case "findTests": {
      const envelope = queries.findTests
      if (envelope === undefined) return []
      return [
        ...(envelope.candidates ?? []).map((item) => ({ item, flags: TEST_ONLY })),
        ...envelope.items.map((item) => ({ item, flags: TEST_ONLY })),
      ]
    }
    case "detectChanges":
      return []
  }
}

export function buildTaskUnderstanding(input: TaskUnderstandingInput): TaskUnderstanding {
  const queries = input.queries ?? {}
  const merged = new Map<string, MergedSymbol>()
  const order: string[] = []
  const symbolIds = new Set<string>()
  const impactedIds = new Set<string>()
  const testIds = new Set<string>()
  const advisoryIds = new Set<string>()
  const uncertainties: UnderstandingUncertainty[] = []
  const observations: QueryObservation[] = []
  const changes: UnderstandingChange[] = []
  const testSubjects = new Map<string, string>()
  const referencedKnowledge: string[] = []
  const knowledgeReferrers = new Map<string, string[]>()
  let keptCount = 0
  let staleSeen = false
  let scopeClean = true

  const trackKnowledge = (knowledgeIds: readonly string[] | undefined, referrer: string | undefined): void => {
    for (const id of knowledgeIds ?? []) {
      if (!referencedKnowledge.includes(id)) referencedKnowledge.push(id)
      if (referrer === undefined) continue
      const list = knowledgeReferrers.get(id) ?? []
      if (!list.includes(referrer)) list.push(referrer)
      knowledgeReferrers.set(id, list)
    }
  }

  const ingest = (kind: EvidenceQueryKind, item: EvidenceItemInput, flags: SymbolFlags, stale: boolean): void => {
    const seen = merged.get(item.id)
    if (seen === undefined) {
      merged.set(item.id, {
        id: item.id,
        file: item.file,
        line: item.line,
        name: item.name,
        confidence: item.confidence,
        knowledgeIds: [...(item.knowledgeIds ?? [])],
        sources: [kind],
      })
      order.push(item.id)
    } else {
      if (item.confidence > seen.confidence) seen.confidence = item.confidence
      for (const knowledgeId of item.knowledgeIds ?? []) {
        if (!seen.knowledgeIds.includes(knowledgeId)) seen.knowledgeIds.push(knowledgeId)
      }
      if (!seen.sources.includes(kind)) seen.sources.push(kind)
    }
    if (stale || item.confidence < 1) {
      advisoryIds.add(item.id)
      return
    }
    if (flags.toSymbols) symbolIds.add(item.id)
    if (flags.toImpacted) impactedIds.add(item.id)
    if (flags.toTests) testIds.add(item.id)
  }

  for (const kind of EVIDENCE_QUERY_KINDS) {
    const envelope: EvidenceEnvelopeInput | undefined = queries[kind]
    if (envelope === undefined) {
      observations.push({ kind, present: false, coverage: "unindexed", truncated: false, freshness: "fresh", answered: false })
      if (MISSING_QUERY_KINDS.includes(kind)) uncertainties.push({ kind: "missing-query", note: `${kind} not queried (no evidence)` })
      continue
    }
    const mismatch = scopeMismatch(envelope, input.scope)
    if (mismatch !== undefined) {
      scopeClean = false
      observations.push({
        kind,
        present: true,
        coverage: envelope.coverage,
        truncated: envelope.truncated,
        freshness: envelope.freshness,
        answered: false,
      })
      uncertainties.push({
        kind: mismatch,
        note:
          mismatch === "cross-project"
            ? `${kind} excluded: cross-project evidence (projectId/worktreeId outside scope)`
            : `${kind} excluded: revision mismatch (revision outside scope)`,
      })
      continue
    }
    keptCount += 1
    const stale = envelope.freshness === "stale"
    if (stale) staleSeen = true
    const answered = envelope.coverage !== "unindexed"
    observations.push({
      kind,
      present: true,
      coverage: envelope.coverage,
      truncated: envelope.truncated,
      freshness: envelope.freshness,
      answered,
    })
    if (envelope.coverage === "unindexed") {
      uncertainties.push({ kind: "unindexed", note: `${kind} unindexed: subject not analyzed (no answer)` })
    } else if (envelope.coverage === "partial" || envelope.truncated) {
      const cut = (envelope.unresolved ?? []).length > 0 ? (envelope.unresolved ?? []).join("; ") : "answer cut by limit"
      uncertainties.push({ kind: "partial", note: `${kind} partial: ${cut}` })
    }
    const contributions = contributionsForKind(kind, queries)
    const lowConfidenceIds: string[] = []
    for (const contribution of contributions) {
      ingest(kind, contribution.item, contribution.flags, stale)
      if (contribution.item.confidence < 1 && !lowConfidenceIds.includes(contribution.item.id)) {
        lowConfidenceIds.push(contribution.item.id)
      }
    }
    if (lowConfidenceIds.length > 0) {
      uncertainties.push({
        kind: "low-confidence",
        note: `${kind} has ${lowConfidenceIds.length} low-confidence items (advisory only)`,
        symbolIds: lowConfidenceIds,
      })
    }
    if (kind === "detectChanges") {
      for (const change of queries.detectChanges?.changes ?? []) {
        changes.push({ id: change.id, file: change.file, line: change.line, cause: change.cause, confidence: change.confidence })
      }
    }
    if (kind === "findTests") {
      const subjectFile = queries.findTests?.subjectFile
      if (subjectFile !== undefined) {
        for (const contribution of contributions) testSubjects.set(contribution.item.id, subjectFile)
      }
    }
    trackKnowledge(envelope.knowledgeIds, undefined)
    for (const base of envelope.items) trackKnowledge(base.knowledgeIds, base.id)
    for (const contribution of contributions) trackKnowledge(contribution.item.knowledgeIds, contribution.item.id)
  }

  const toSymbol = (id: string): UnderstandingSymbol | undefined => {
    const acc = merged.get(id)
    if (acc === undefined) return undefined
    const base = {
      id: acc.id,
      file: acc.file,
      line: acc.line,
      confidence: acc.confidence,
      knowledgeIds: [...acc.knowledgeIds],
      sources: [...acc.sources],
    }
    return acc.name === undefined ? base : { ...base, name: acc.name }
  }
  const collect = (membership: ReadonlySet<string>): UnderstandingSymbol[] => {
    const out: UnderstandingSymbol[] = []
    for (const id of order) {
      if (!membership.has(id)) continue
      const symbol = toSymbol(id)
      if (symbol !== undefined) out.push(symbol)
    }
    return out
  }
  const symbols = collect(symbolIds)
  const advisorySymbols = collect(advisoryIds)
  const impacted = collect(impactedIds)
  const tests = collect(testIds)

  const constraints: UnderstandingConstraint[] = []
  const knownIds = new Set((input.knowledge ?? []).map((record) => record.id))
  for (const record of input.knowledge ?? []) {
    if (record.category === "superseded" || record.supersededBy !== undefined) continue
    if (record.projectId !== undefined && record.projectId !== input.scope.projectId) {
      uncertainties.push({ kind: "cross-project", note: `knowledge ${record.id} excluded: project scope mismatch` })
      continue
    }
    constraints.push({
      id: record.id,
      claim: record.claim,
      trust: knowledgeTrust(record.category),
      sourceFile: record.sourceFile,
      sourceRevision: record.sourceRevision,
      validatedAt: record.validatedAt,
      authoritative: record.category === "source-verified" && record.sourceRevision === input.scope.revision,
    })
  }
  for (const id of referencedKnowledge) {
    if (knownIds.has(id)) continue
    uncertainties.push({
      kind: "unresolved",
      note: `knowledge ${id} referenced by evidence but absent from input`,
      symbolIds: [...(knowledgeReferrers.get(id) ?? [])],
    })
  }

  const freshness = keptCount === 0 ? "unknown" : staleSeen ? "stale" : "fresh"
  const answeredBy = new Map(observations.map((observation) => [observation.kind, observation.answered]))
  const usableForCaution =
    scopeClean && freshness === "fresh" && answeredBy.get("symbolContext") === true && answeredBy.get("impact") === true

  const limits = { ...UNDERSTANDING_LIMITS, ...input.limits }
  const truncationReasons: string[] = []
  const cut = <T>(name: string, values: readonly T[], cap: number | undefined, fallback: number): T[] => {
    const limit = cap ?? fallback
    if (values.length <= limit) return [...values]
    truncationReasons.push(`${name} truncated to ${limit} of ${values.length}`)
    return values.slice(0, limit)
  }
  // UNDERSTANDING_LIMITS carries no advisorySymbols key; advisory symbols share the symbols cap.
  const finalSymbols = cut("symbols", symbols, limits.symbols, UNDERSTANDING_LIMITS.symbols)
  const finalAdvisory = cut("advisorySymbols", advisorySymbols, limits.symbols, UNDERSTANDING_LIMITS.symbols)
  const finalImpacted = cut("impacted", impacted, limits.impacted, UNDERSTANDING_LIMITS.impacted)
  const finalTests = cut("tests", tests, limits.tests, UNDERSTANDING_LIMITS.tests)
  const finalConstraints = cut("constraints", constraints, limits.constraints, UNDERSTANDING_LIMITS.constraints)
  const finalUncertainties = cut("uncertainties", uncertainties, limits.uncertainties, UNDERSTANDING_LIMITS.uncertainties)

  return {
    scope: input.scope,
    freshness,
    symbols: finalSymbols,
    advisorySymbols: finalAdvisory,
    impacted: finalImpacted,
    tests: finalTests,
    testSubjects,
    changes,
    constraints: finalConstraints,
    uncertainties: finalUncertainties,
    queries: observations,
    usableForCaution,
    truncated: truncationReasons.length > 0,
    truncationReasons,
  }
}
