// The single place where a workspace turns into a catalogue the host may act on.
//
// The precedence is fixed and one-directional: explicit configuration wins, manifest discovery is
// only consulted when no configuration exists, and NOTHING reaches the approved set without an
// approval record that matches its own fingerprint. A corrupt approval store is a catalogue error,
// never an empty approval set, because "we could not read the approvals" must not degrade into
// "no approvals are needed".
import type { DagVerifyCheck } from "../dag/verification"
import { approvalFingerprint, classifyCandidates, type OrdinaryCheckCandidate } from "./approval"
import { approvalAuthorityFor, type ApprovalAuthority } from "./approval-authority"
import { readApprovals, type ApprovalRead } from "./approval-store"
import type { OrdinaryCatalogue, OrdinaryCheck } from "./catalogue"
import { loadVerificationConfig, type ConfiguredCheck } from "./config"
import { discoverCandidates } from "./discovery"

// The single workspace identity an ordinary run is approved under. One run per spawn_spec.cwd, so the
// root identity is both sufficient and tighter than a name the child could influence.
export const WORKSPACE_ID = "."

export type ResolutionInput = {
  readonly projectRoot: string
  readonly workspaceId: string
  readonly changedFiles: readonly string[] | null
  // Host-owned authority. Omitted derives it from projectRoot, so no caller has to (or may) point
  // the resolver at a directory of its choosing.
  readonly authority?: ApprovalAuthority
  // Approval authority already read by the host, e.g. the snapshot an ordinary worker took at
  // spawn. Supplying it is STRICTER than omitting it: nothing written after that read is honoured.
  readonly approvals?: ApprovalRead
}

function asCheck(checkId: string, category: string, command: readonly string[], timeoutMs: number): DagVerifyCheck {
  return {
    checkId,
    // SAFETY: candidate categories come from discovery's fixed script table or config validation.
    category: category as DagVerifyCheck["category"],
    command,
    timeoutMs,
    criteria: [],
  }
}

function fromConfig(check: ConfiguredCheck, workspaceId: string): OrdinaryCheckCandidate {
  return {
    checkId: check.checkId,
    category: check.category,
    command: check.command,
    cwd: check.cwd,
    packageScope: check.packageScope,
    timeoutMs: check.timeoutMs,
    reason: `declared in .alcode/verification.json as "${check.name}"`,
    source: "config",
    location: `.alcode/verification.json#checks.${check.checkId}`,
    fingerprint: approvalFingerprint({
      workspaceId,
      checkId: check.checkId,
      command: check.command,
      cwd: check.cwd,
      packageScope: check.packageScope,
      timeoutMs: check.timeoutMs,
      configVersion: check.configVersion,
    }),
  }
}

function toOrdinaryCheck(candidate: OrdinaryCheckCandidate): OrdinaryCheck {
  return {
    check: asCheck(candidate.checkId, candidate.category, candidate.command, candidate.timeoutMs),
    provenance: { source: candidate.source, location: candidate.location, reason: candidate.reason },
  }
}

function approvedCatalogue(
  candidates: readonly OrdinaryCheckCandidate[],
  read: ApprovalRead,
): OrdinaryCatalogue {
  if (!read.ok) return { status: "invalid", diagnostics: read.diagnostics }
  const classification = classifyCandidates(candidates, read.approvals)
  if (classification.state === "none") {
    return { status: "none", reason: "no verification checks are declared for this workspace" }
  }
  if (classification.state === "approval_required") {
    return {
      status: "approval_required",
      pending: candidates.map((candidate) => candidate.checkId),
      reason: `${candidates.length} candidate check(s) were discovered but none is approved for execution`,
    }
  }
  return { status: "configured", checks: classification.candidates.map(toOrdinaryCheck) }
}

export function resolveCatalogue(input: ResolutionInput): OrdinaryCatalogue {
  const config = loadVerificationConfig(input.projectRoot)
  // Read once per resolution: the approval set must be the same one every branch classifies, and a
  // caller-supplied snapshot is used verbatim instead of silently re-reading a mutable store.
  const approvals =
    input.approvals ?? readApprovals(input.authority ?? approvalAuthorityFor(input.projectRoot), input.workspaceId)

  // An explicit configuration that fails validation is final: falling through to manifest discovery
  // here would run commands the author never authorized under a file they were told was broken.
  if (config.status === "invalid") return { status: "invalid", diagnostics: config.diagnostics }

  if (config.status === "configured") {
    const candidates = config.checks.map((check) => fromConfig(check, input.workspaceId))
    return approvedCatalogue(candidates, approvals)
  }

  const discovery = discoverCandidates({
    projectRoot: input.projectRoot,
    workspaceId: input.workspaceId,
    changedFiles: input.changedFiles,
  })
  if (discovery.status === "unsupported") return { status: "unsupported", reason: discovery.reason }
  if (discovery.status === "none") return { status: "none", reason: discovery.reason }
  return approvedCatalogue(discovery.candidates, approvals)
}

// The approver is passed in from the host authorization context rather than invented here; this
// helper exists so the approval call names the exact candidate the user was shown.
export function candidateForApproval(input: {
  readonly projectRoot: string
  readonly workspaceId: string
  readonly changedFiles: readonly string[] | null
  readonly checkId: string
}): OrdinaryCheckCandidate | null {
  const config = loadVerificationConfig(input.projectRoot)
  if (config.status === "invalid") return null
  if (config.status === "configured") {
    const match = config.checks.find((check) => check.checkId === input.checkId)
    return match === undefined ? null : fromConfig(match, input.workspaceId)
  }
  const discovery = discoverCandidates({
    projectRoot: input.projectRoot,
    workspaceId: input.workspaceId,
    changedFiles: input.changedFiles,
  })
  if (discovery.status !== "candidates") return null
  return discovery.candidates.find((candidate) => candidate.checkId === input.checkId) ?? null
}
