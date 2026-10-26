import type { TaskUnderstanding } from "./types"
import {
  checkVerificationFreshness,
  verificationRecordKey,
  type DagAcceptanceVerdict,
  type DagVerificationCurrent,
  type DagVerificationRecord,
} from "../verification"

export type KnowledgeCandidate = {
  readonly claim: string
  readonly sourceFile: string
  readonly sourceRevision: string
  readonly category: "source-verified"
  readonly evidenceCheckIds: readonly string[]
  readonly at: string
}

export type DeriveKnowledgeCandidateInput = {
  readonly claim: string
  readonly sourceFile: string
  readonly understanding: TaskUnderstanding
  readonly acceptance: DagAcceptanceVerdict
  readonly records: readonly DagVerificationRecord[]
  readonly current: DagVerificationCurrent
  readonly latestAttempts: ReadonlyMap<string, number>
  readonly at?: string
}

function isKnownSourceFile(input: DeriveKnowledgeCandidateInput): boolean {
  const file = input.sourceFile
  for (const symbol of input.understanding.symbols) {
    if (symbol.file === file) return true
  }
  for (const change of input.understanding.changes) {
    if (change.file === file) return true
  }
  for (const constraint of input.understanding.constraints) {
    if (constraint.authoritative === true && constraint.sourceFile === file) return true
  }
  return false
}

export function deriveKnowledgeCandidate(input: DeriveKnowledgeCandidateInput): KnowledgeCandidate | undefined {
  if (input.acceptance.accepted !== true) return undefined
  const trimmed = input.claim.trim()
  if (trimmed.length === 0 || trimmed.length > 500 || input.claim.length > 500) return undefined
  if (input.sourceFile.trim().length === 0) return undefined
  if (input.records.length === 0) return undefined
  const scope = input.understanding.scope
  if (scope === undefined || scope.revision !== input.current.sourceRevision) return undefined
  if (!isKnownSourceFile(input)) return undefined
  for (const record of input.records) {
    if (record.sourceRevision !== input.current.sourceRevision) return undefined
  }
  let hasGenuinePass = false
  for (const record of input.records) {
    if (record.status === "passed" && record.started === true && record.exitCode === 0) {
      hasGenuinePass = true
    }
    const key = verificationRecordKey(record.nodeId, record.checkId)
    const latest = input.latestAttempts.get(key) ?? record.repairAttempt
    const freshness = checkVerificationFreshness(record, input.current, latest)
    if (freshness.fresh !== true) return undefined
  }
  if (!hasGenuinePass) return undefined
  const evidence = [...new Set(input.records.filter((record) => record.status === "passed").map((record) => record.checkId))].sort()
  let at = input.at
  if (at === undefined) {
    let latest = input.records[0].completedAt
    for (const record of input.records) {
      if (record.completedAt > latest) latest = record.completedAt
    }
    at = latest
  }
  return {
    claim: input.claim,
    sourceFile: input.sourceFile,
    sourceRevision: input.current.sourceRevision,
    category: "source-verified",
    evidenceCheckIds: evidence,
    at,
  }
}
