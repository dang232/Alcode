// The ONE authoritative completion-status vocabulary for the ordinary-completion gate.
//
// Three outcomes, three meanings, no overlap:
//
// - "verified": every approved required check passed against the CURRENT workspace revision.
// - "unverified": no applicable approved checks exist, so no verification is claimed.
// - "blocked": required verification failed, is stale, is missing, is malformed, or cannot be
//   trusted.
//
// Only this module defines the vocabulary. The gate in ./completion-gate.ts expresses its verdict
// in these terms; every consumer (manager lanes, UI, tests) reads the same words instead of
// re-deriving a two-valued pass/fail that cannot tell "checks passed" from "nothing ran".

const COMPLETION_BLOCK_CODES = [
  "verification_evidence_missing",
  "verification_failed",
  "verification_stale",
  "verification_evidence_malformed",
  "verification_provenance_unknown",
] as const;

export type CompletionBlockCode = (typeof COMPLETION_BLOCK_CODES)[number];

export type VerificationStatus = "verified" | "unverified" | "blocked";

export type CompletionGateVerdict = {
  readonly verification: VerificationStatus;
  readonly code?: CompletionBlockCode;
  readonly reason?: string;
};

// A run may publish success only when the gate verified it. Anything else is not a pass.
export function isVerified(verdict: CompletionGateVerdict): boolean {
  return verdict.verification === "verified";
}

// A run whose required verification failed, is stale, is missing, is malformed, or cannot be
// trusted must not complete. An unverified run is NOT blocked: nothing applicable was required,
// so there is nothing to fail - only no claim to make.
export function isBlocked(verdict: CompletionGateVerdict): boolean {
  return verdict.verification === "blocked";
}
