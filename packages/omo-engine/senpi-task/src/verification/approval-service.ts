// The host action that turns a candidate into an approval.
//
// The authority question this module answers: the caller may name WHICH check it wants approved, and
// nothing else. It cannot supply a fingerprint, a command, a workspace path, or an approver - those
// are recomputed here from trusted catalogue state and the verified session principal. A fingerprint
// the user was shown is accepted only as a staleness check, so a candidate that changed between
// display and approval is refused rather than silently approved under the old identity.
import { resolve, isAbsolute, relative } from "node:path"
import { approvalAuthorityFor, type ApprovalAuthority } from "./approval-authority"
import { approveCandidate, readApprovals, rejectCandidate, type ApprovalRecord } from "./approval-store"
import { candidateForApproval } from "./resolution"
import { discoverCandidates } from "./discovery"
import { loadVerificationConfig, VERIFICATION_CONFIG_VERSION } from "./config"

// Mirrors what the host can actually verify about the caller. `sub` is the authority: it comes from
// `resolveRequestAlcoreSub` (a signature-verified Alcore token, or the verified profile bound to a
// session cookie). `sid` is optional attribution - the cookie path has no session id to report, and
// inventing one would put a fabricated identity into an approval record.
export type HostPrincipal = {
  readonly sub: string
  readonly sid?: string
}

export type ApprovalDenialCode =
  | "approval_denied"
  | "candidate_unknown"
  | "fingerprint_mismatch"
  | "catalogue_invalid"
  | "workspace_mismatch"

export type ApprovalOutcome =
  | { readonly ok: true; readonly record: ApprovalRecord }
  | { readonly ok: false; readonly code: ApprovalDenialCode; readonly reason: string }

export type RejectionOutcome = { readonly rejected: true; readonly checkId: string; readonly reason: string; readonly fingerprint: string }

export type ApproveInput = {
  readonly projectRoot: string
  readonly workspaceId: string
  readonly changedFiles: readonly string[] | null
  // Host-owned authority. Omitted means "derive it from projectRoot", which is the production shape:
  // the approval surface never gets to choose where authority lives.
  readonly authority?: ApprovalAuthority
  readonly checkId: string
  readonly principal: HostPrincipal
  readonly displayedFingerprint?: string
  readonly approvedAt?: string
}

function deny(code: ApprovalDenialCode, reason: string): ApprovalOutcome {
  return { ok: false, code, reason }
}

function principalIsUsable(principal: HostPrincipal): boolean {
  return principal.sub.trim() !== ""
}

// A workspace identity is only meaningful when it names a directory inside the project root; an
// absolute or escaping value would let one workspace write approvals into another's store.
function workspaceIsContained(projectRoot: string, workspaceId: string): boolean {
  const rel = relative(resolve(projectRoot), resolve(projectRoot, workspaceId))
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

export function approveVerificationCandidate(input: ApproveInput): ApprovalOutcome {
  if (!principalIsUsable(input.principal)) {
    return deny("approval_denied", "no verified host principal was presented")
  }
  if (!workspaceIsContained(input.projectRoot, input.workspaceId)) {
    return deny("workspace_mismatch", "the workspace identity is outside the project root")
  }

  // Loaded before discovery, so a broken configuration reports itself as broken instead of decaying
  // into "this candidate does not exist".
  const config = loadVerificationConfig(input.projectRoot)
  if (config.status === "invalid") {
    return deny("catalogue_invalid", config.diagnostics.join("; "))
  }

  const candidate = candidateForApproval({
    projectRoot: input.projectRoot,
    workspaceId: input.workspaceId,
    changedFiles: input.changedFiles,
    checkId: input.checkId,
  })
  if (candidate === null) return deny("candidate_unknown", `no verification candidate is named ${input.checkId}`)

  if (input.displayedFingerprint !== undefined && input.displayedFingerprint !== candidate.fingerprint) {
    return deny("fingerprint_mismatch", "the candidate changed after it was displayed; review it again")
  }

  const record = approveCandidate({
    authority: input.authority ?? approvalAuthorityFor(input.projectRoot),
    candidate,
    workspaceId: input.workspaceId,
    configVersion: VERIFICATION_CONFIG_VERSION,
    approvedBy: `alcode:${input.principal.sub}`,
    approvedAt: input.approvedAt ?? new Date().toISOString(),
  })
  return { ok: true, record }
}

// Rejection writes a rejection record, never an approval: `readApprovals` hands back only approved
// records as authorizations, so a rejection is visible to a person and invisible to the runner.
export function rejectVerificationCandidate(input: {
  readonly projectRoot: string
  readonly workspaceId: string
  readonly changedFiles: readonly string[] | null
  readonly authority?: ApprovalAuthority
  readonly checkId: string
  readonly principal: HostPrincipal
  readonly reason: string
}): RejectionOutcome | { readonly rejected: false; readonly code: ApprovalDenialCode; readonly reason: string } {
  if (!principalIsUsable(input.principal)) {
    return { rejected: false, code: "approval_denied", reason: "no verified host principal was presented" }
  }
  const config = loadVerificationConfig(input.projectRoot)
  if (config.status === "invalid") {
    return { rejected: false, code: "catalogue_invalid", reason: config.diagnostics.join("; ") }
  }
  const candidate = candidateForApproval({
    projectRoot: input.projectRoot,
    workspaceId: input.workspaceId,
    changedFiles: input.changedFiles,
    checkId: input.checkId,
  })
  if (candidate === null) {
    return { rejected: false, code: "candidate_unknown", reason: `no verification candidate is named ${input.checkId}` }
  }
  const record = rejectCandidate({
    authority: input.authority ?? approvalAuthorityFor(input.projectRoot),
    candidate,
    workspaceId: input.workspaceId,
    configVersion: VERIFICATION_CONFIG_VERSION,
    rejectedBy: `alcode:${input.principal.sub}`,
  })
  return { rejected: true, checkId: candidate.checkId, reason: input.reason, fingerprint: record.fingerprint }
}

// What the review surface renders. Every field here participates in the fingerprint, so the person
// sees exactly what they are authorizing rather than a reconstructed shell line.
export type CandidateReview = {
  readonly workspaceId: string
  readonly checkId: string
  readonly category: string
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
  readonly packageScope: string
  readonly fingerprint: string
  readonly source: string
  readonly location: string
  readonly reason: string
  // `rejected` is a real surface state: a decision the person already made must be visible as that
  // decision instead of collapsing into "approval_required".
  readonly status: "approval_required" | "approved" | "revoked" | "rejected" | "changed"
}

export type CandidateList =
  | { readonly kind: "list"; readonly reviews: readonly CandidateReview[] }
  | { readonly kind: "invalid"; readonly diagnostics: readonly string[] }

export function listCandidateReviews(input: {
  readonly projectRoot: string
  readonly workspaceId: string
  readonly changedFiles: readonly string[] | null
  readonly authority?: ApprovalAuthority
}): CandidateList {
  const config = loadVerificationConfig(input.projectRoot)
  if (config.status === "invalid") return { kind: "invalid", diagnostics: config.diagnostics }

  const fromDiscovery = (): readonly string[] => {
    const discovery = discoverCandidates({
      projectRoot: input.projectRoot,
      workspaceId: input.workspaceId,
      changedFiles: input.changedFiles,
    })
    return discovery.status === "candidates" ? discovery.candidates.map((candidate) => candidate.checkId) : []
  }
  const checkIds = config.status === "configured" ? config.checks.map((check) => check.checkId) : fromDiscovery()

  // Each entry is resolved through the same review path the single-check surface uses, so the list
  // and the detail can never disagree about what a person is being asked to approve.
  const reviews: CandidateReview[] = []
  for (const checkId of checkIds) {
    const outcome = reviewCandidate({
      projectRoot: input.projectRoot,
      workspaceId: input.workspaceId,
      changedFiles: input.changedFiles,
      authority: input.authority ?? approvalAuthorityFor(input.projectRoot),
      checkId,
    })
    if (outcome.kind === "review") reviews.push(outcome.review)
  }
  return { kind: "list", reviews }
}

export type ReviewOutcome =
  | { readonly kind: "review"; readonly review: CandidateReview }
  | { readonly kind: "invalid"; readonly diagnostics: readonly string[] }
  | { readonly kind: "missing"; readonly checkId: string }

export function reviewCandidate(input: {
  readonly projectRoot: string
  readonly workspaceId: string
  readonly changedFiles: readonly string[] | null
  readonly authority?: ApprovalAuthority
  readonly checkId: string
}): ReviewOutcome {
  // A broken configuration is its own outcome, not "no such candidate": the surface must be able to
  // say "this catalogue is invalid" rather than implying the check simply does not exist.
  const config = loadVerificationConfig(input.projectRoot)
  if (config.status === "invalid") return { kind: "invalid", diagnostics: config.diagnostics }

  const candidate = candidateForApproval({
    projectRoot: input.projectRoot,
    workspaceId: input.workspaceId,
    changedFiles: input.changedFiles,
    checkId: input.checkId,
  })
  if (candidate === null) return { kind: "missing", checkId: input.checkId }
  const read = readApprovals(input.authority ?? approvalAuthorityFor(input.projectRoot), input.workspaceId)
  const records = read.ok ? read.records : []
  const matching = records.find((record) => record.fingerprint === candidate.fingerprint)
  // A record for the same check under a DIFFERENT fingerprint means this candidate was approved in
  // an earlier form and has since changed. Reporting that as plain "approval_required" would hide
  // that someone already made a decision about it, which is exactly what the reviewer needs to see.
  const changed = matching === undefined && records.some((record) => record.checkId === candidate.checkId)
  const status: CandidateReview["status"] =
    matching !== undefined ? matching.status : changed ? "changed" : "approval_required"
  return {
    kind: "review",
    review: {
      workspaceId: input.workspaceId,
      checkId: candidate.checkId,
      category: candidate.category,
      executable: candidate.command[0] ?? "",
      args: candidate.command.slice(1),
      cwd: candidate.cwd,
      timeoutMs: candidate.timeoutMs,
      packageScope: candidate.packageScope,
      fingerprint: candidate.fingerprint,
      source: candidate.source,
      location: candidate.location,
      reason: candidate.reason,
      status,
    },
  }
}
