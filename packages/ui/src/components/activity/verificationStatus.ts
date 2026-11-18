/**
 * The terminal completion claim a task record carries, read from the
 * record's `verification_status` field. The engine's ordinary-completion
 * gate owns the verdict; this module only names the three words so every
 * run-status surface reads the same vocabulary instead of re-deriving a
 * pass/fail that cannot tell "checks passed" from "nothing ran".
 *
 * - `verified`: every approved required check passed against the run's workspace.
 * - `unverified`: no applicable approved checks exist, so no verification is claimed.
 * - `blocked`: required verification failed, is stale, is missing, is malformed,
 *   or cannot be trusted.
 */
export type VerificationStatus = 'verified' | 'unverified' | 'blocked';

/**
 * Fail-closed read of a zod-validated snapshot claim (`z.string().optional()`):
 * only the exact words count. Anything absent or malformed claims nothing,
 * which callers render as Unverified, never Verified.
 */
export type UntrustedVerificationClaim = string | undefined;

export const parseVerificationStatus = (value: UntrustedVerificationClaim): VerificationStatus | undefined => {
  if (value === 'verified' || value === 'unverified' || value === 'blocked') return value;
  return undefined;
};
