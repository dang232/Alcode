// Approval that binds to one exact command in one exact workspace.
//
// The property this module exists to guarantee: an approval authorizes the argv it was granted for,
// in the workspace it was granted in, and nothing else. Changing the executable, an argument, the
// working directory, the timeout or the workspace therefore produces a different fingerprint, so the
// earlier approval simply no longer matches - there is no invalidation step to forget. A worker
// cannot mint one, because a fingerprint is derived here from host-owned fields and the child-facing
// request schema is empty.
import { createHash } from "node:crypto"

export type ApprovalSubject = {
  readonly workspaceId: string
  readonly checkId: string
  readonly command: readonly string[]
  readonly cwd: string
  readonly packageScope: string
  readonly timeoutMs: number
  readonly configVersion: number
}

export type VerificationApproval = {
  readonly fingerprint: string
  readonly approvedAt: string
}

// Ordered, delimiter-escaped fields: the argv array is length-prefixed so ["a", "b"] and ["a b"]
// cannot collide, and a field containing the separator cannot shift the remaining fields.
export function approvalFingerprint(subject: ApprovalSubject): string {
  const parts = [
    `v${subject.configVersion}`,
    subject.workspaceId,
    subject.checkId,
    subject.packageScope,
    subject.cwd,
    String(subject.timeoutMs),
    ...subject.command.map((argv) => `${argv.length}:${argv}`),
  ]
  return createHash("sha256").update(parts.join("\u0000")).digest("hex")
}

export function isApproved(subject: ApprovalSubject, approvals: readonly VerificationApproval[]): boolean {
  const fingerprint = approvalFingerprint(subject)
  return approvals.some((approval) => approval.fingerprint === fingerprint)
}

type CandidateSource = "manifest" | "config"

// A candidate is a proposal, never a permission. It carries the fingerprint an approval WOULD bind
// to, which is what makes "approve this exact thing" possible without making it automatic.
export type OrdinaryCheckCandidate = {
  readonly checkId: string
  readonly category: string
  readonly command: readonly string[]
  readonly cwd: string
  readonly packageScope: string
  readonly timeoutMs: number
  readonly reason: string
  readonly source: CandidateSource
  readonly location: string
  readonly fingerprint: string
}

export type CandidateApproval =
  | { readonly state: "approved"; readonly candidates: readonly OrdinaryCheckCandidate[] }
  | { readonly state: "approval_required"; readonly candidates: readonly OrdinaryCheckCandidate[] }
  | { readonly state: "none" }

// Discovery alone never yields an approved state: with no approval record every candidate stays
// pending, which is the difference between "we found something to run" and "we may run it".
export function classifyCandidates(
  candidates: readonly OrdinaryCheckCandidate[],
  approvals: readonly VerificationApproval[],
): CandidateApproval {
  if (candidates.length === 0) return { state: "none" }
  const approved: OrdinaryCheckCandidate[] = []
  for (const candidate of candidates) {
    if (approvals.some((approval) => approval.fingerprint === candidate.fingerprint)) approved.push(candidate)
  }
  if (approved.length === 0) return { state: "approval_required", candidates }
  return { state: "approved", candidates: approved }
}
