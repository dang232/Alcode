// The host-owned catalogue of checks an ordinary worker may be verified against.
//
// The distinction this module exists to preserve: "no catalogue configured" is NOT "the catalogue
// found nothing to run for these changes". The first is a configuration gap that must never read as a
// pass; the second is a legitimate policy outcome (a documentation-only change needs no checks).
// Collapsing them is how a verification system starts reporting green while running nothing.
import type { DagVerifyCheck } from "../dag/verification"

type CatalogueSource = "config" | "manifest"

export type OrdinaryCheckProvenance = {
  readonly source: CatalogueSource
  readonly location: string
  readonly reason: string
}

export type OrdinaryCheck = {
  readonly check: DagVerifyCheck
  readonly provenance: OrdinaryCheckProvenance
}

export type OrdinaryCatalogue =
  | { readonly status: "configured"; readonly checks: readonly OrdinaryCheck[] }
  | { readonly status: "none"; readonly reason: string }
  | { readonly status: "invalid"; readonly diagnostics: readonly string[] }
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "approval_required"; readonly pending: readonly string[]; readonly reason: string }

export type CatalogueErrorCode =
  | "verification_no_checks_configured"
  | "verification_catalogue_invalid"
  | "verification_unsupported_project"
  | "verification_approval_required"

// An explicit configuration that fails validation stays invalid: there is no fallback to inferred
// checks, because a user who wrote a configuration must see it rejected, not quietly ignored.
export function catalogueFrom(checks: readonly OrdinaryCheck[]): OrdinaryCatalogue {
  if (checks.length === 0) {
    return { status: "none", reason: "no verification checks are declared for this workspace" }
  }
  return { status: "configured", checks }
}

export function catalogueChecks(catalogue: OrdinaryCatalogue): readonly DagVerifyCheck[] {
  return catalogue.status === "configured" ? catalogue.checks.map((entry) => entry.check) : []
}

export function catalogueErrorCode(catalogue: OrdinaryCatalogue): CatalogueErrorCode | null {
  if (catalogue.status === "none") return "verification_no_checks_configured"
  if (catalogue.status === "invalid") return "verification_catalogue_invalid"
  if (catalogue.status === "unsupported") return "verification_unsupported_project"
  if (catalogue.status === "approval_required") return "verification_approval_required"
  return null
}

// Candidates exist but nobody approved them: a distinct non-success state, never a pass and never
// the same code as "nothing is configured".
export function approvalRequiredCatalogue(pending: readonly string[]): OrdinaryCatalogue {
  return {
    status: "approval_required",
    pending,
    reason: `${pending.length} candidate check(s) were discovered but none is approved for execution`,
  }
}

// Diagnostics are returned as written so a bad configuration can be fixed from the message alone.
