// The ordinary-completion gate: a run may publish success only with trusted, fresh evidence.
//
// This module owns ONE decision and reuses the shared contract for every rule: the catalogue decides
// which checks are required, \`readRunVerificationRecords\` reads them, and \`evaluateAcceptance\` decides
// acceptance fail-closed. Nothing here re-implements a check, a status or a freshness rule, so the DAG
// gate and this gate cannot drift apart.
//
// Scope, stated so it cannot be mistaken for more: the gate binds a run whose catalogue was APPROVED
// at spawn. A workspace with no approved catalogue requires no evidence, and its completion is not
// reported as verified - the gate does not invent a requirement the host never authorized.
import { workspaceRevision } from "./evidence-store"
import type { CompletionBlockCode, CompletionGateVerdict } from "./completion-status"
import { ordinaryEvidenceFreshness } from "./ordinary-capture"
import type { OrdinaryCatalogue } from "./catalogue"
import { catalogueChecks } from "./catalogue"
import {
  evaluateAcceptance,
  parseVerificationRecord,
  readRunVerificationRecords,
  type DagVerificationRecord,
  type DagVerificationRequirement,
} from "../dag/verification"
import { createFileEvidenceStore } from "./evidence-store"

export type CompletionGateInput = {
  readonly taskId: string
  readonly catalogue: OrdinaryCatalogue
  readonly evidenceRoot: string
  readonly workspaceDir: string
  readonly epoch: number
}

// A catalogue the host never approved requires nothing: the run is ordinary (ungated) and its
// completion is reported as UNVERIFIED - no approved checks applied, so no verification is claimed.
// A catalogue that is present but invalid DOES block, because an unreadable requirement is never
// the same as no requirement.
function catalogueVerdict(catalogue: OrdinaryCatalogue): CompletionGateVerdict | null {
  if (catalogue.status === "configured") return null
  if (catalogue.status === "invalid") {
    return { verification: "blocked", code: "verification_evidence_malformed", reason: `catalogue invalid: ${catalogue.diagnostics.join("; ")}` }
  }
  if (catalogue.status === "none") {
    return { verification: "unverified", reason: catalogue.reason }
  }
  if (rawCatalogueStatus(catalogue) === "absent") {
    // Defensive: the config layer reports "absent" when no configuration file exists. Resolution
    // currently folds that into "none", but an "absent" catalogue must never read as verified.
    return { verification: "unverified", reason: "no approved verification catalogue applies to this workspace" }
  }
  // "unsupported" and "approval_required": no approved checks apply to this run either. The run is
  // not blocked, but its completion carries no verification claim.
  return { verification: "unverified", reason: catalogue.reason }
}

function rawCatalogueStatus(catalogue: OrdinaryCatalogue): string {
  // SAFETY: every catalogue variant carries a string status; the read tolerates forward-compatible values like "absent" without narrowing the union.
  return (catalogue as { readonly status: string }).status
}

export function evaluateOrdinaryCompletion(input: CompletionGateInput): CompletionGateVerdict {
  const skip = catalogueVerdict(input.catalogue)
  if (skip !== null) return skip
  if (input.catalogue.status !== "configured") return { verification: "unverified", reason: "no approved verification checks apply to this workspace" }

  // The revision the record must match. A tree the host cannot describe blocks: an unattributable
  // completion is not a verified one.
  let sourceRevision: string
  try {
    sourceRevision = workspaceRevision(input.workspaceDir)
  } catch (error) {
    return {
      verification: "blocked",
      code: "verification_provenance_unknown",
      reason: `workspace revision unavailable: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const store = createFileEvidenceStore(input.evidenceRoot)
  let listed: readonly string[]
  try {
    listed = store.listVerifications(input.taskId)
  } catch {
    // No directory for this run: the worker never asked for verification.
    return { verification: "blocked", code: "verification_evidence_missing", reason: "this run produced no verification evidence" }
  }
  if (listed.length === 0) {
    return { verification: "blocked", code: "verification_evidence_missing", reason: "this run produced no verification evidence" }
  }

  const parsed: DagVerificationRecord[] = []
  for (const file of listed) {
    if (!file.endsWith(".json")) continue
    const parts = file.replace(/\.json$/, "").split(".")
    const nodeId = parts[0] ?? ""
    const checkId = parts[1] ?? ""
    const attempt = Number(parts[2] ?? "1")
    const raw = store.readVerification(input.taskId, nodeId, checkId, Number.isFinite(attempt) ? attempt : 1)
    const record = raw === null ? null : parseVerificationRecord(raw)
    // A file that cannot be parsed is evidence of a broken writer, never evidence of a pass.
    if (record === null) {
      return { verification: "blocked", code: "verification_evidence_malformed", reason: `unreadable verification record: ${file}` }
    }
    parsed.push(record)
  }
  if (parsed.length === 0) {
    return { verification: "blocked", code: "verification_evidence_missing", reason: "no parseable verification record for this run" }
  }

  // Epoch fencing first: a record from another epoch belongs to another run of this task id.
  for (const record of parsed) {
    const freshness = ordinaryEvidenceFreshness(record, { sourceRevision, epoch: input.epoch })
    if (!freshness.fresh && record.workerAttempt !== input.epoch) {
      return { verification: "blocked", code: "verification_stale", reason: `verification record from another epoch: ${freshness.reason}` }
    }
  }

  const byKey = new Map<string, DagVerificationRecord>()
  for (const record of parsed) {
    const key = record.nodeId === undefined ? record.checkId : `${record.nodeId}/${record.checkId}`
    byKey.set(key, record)
  }
  const requirements: DagVerificationRequirement[] = catalogueChecks(input.catalogue).map((check) => ({ check }))
  // An approved catalogue that requires nothing verifies nothing: the completion is unverified,
  // never reported as a pass.
  if (requirements.length === 0) {
    return { verification: "unverified", reason: "approved catalogue requires no checks, so no verification is claimed" }
  }
  const verdict = evaluateAcceptance({
    requirements,
    records: byKey,
    current: { sourceRevision, nodeFingerprints: new Map(), generation: 0 },
    latestAttempts: new Map(),
  })
  if (verdict.accepted) return { verification: "verified" }

  const failed = parsed.some((record) => record.status !== "passed")
  const stale = verdict.reasons.some((reason) => reason.startsWith("stale"))
  const missing = verdict.reasons.some((reason) => reason.startsWith("missing"))
  const code: CompletionBlockCode = failed ? "verification_failed" : stale ? "verification_stale" : missing ? "verification_evidence_missing" : "verification_evidence_malformed"
  return { verification: "blocked", code, reason: verdict.reasons.join("; ") }
}
