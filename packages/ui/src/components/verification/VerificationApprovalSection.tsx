import { VerificationApprovalPanel, type VerificationReview } from "./VerificationApprovalPanel"

export type VerificationReviewOutcome =
  | { kind: "review"; review: VerificationReview }
  | { kind: "invalid"; diagnostics: readonly string[] }
  | { kind: "missing"; checkId: string }

export type VerificationApprovalSectionProps = {
  outcome: VerificationReviewOutcome
  onApprove: () => void
  onReject: () => void
  busy?: boolean
}

// The three outcomes a person can actually meet: a candidate they may decide on, a catalogue that is
// broken, or a check that is not declared. The last two render no approve control at all - a broken
// or absent configuration must never look like something awaiting a decision, because approving it
// would be approving nothing.
export function VerificationApprovalSection({ outcome, onApprove, onReject, busy = false }: VerificationApprovalSectionProps) {
  if (outcome.kind === "invalid") {
    return (
      <section role="alert" data-outcome="invalid">
        <h3>Verification catalogue is invalid</h3>
        <ul>
          {outcome.diagnostics.map((diagnostic) => (
            <li key={diagnostic}>{diagnostic}</li>
          ))}
        </ul>
      </section>
    )
  }
  if (outcome.kind === "missing") {
    return (
      <section data-outcome="missing">
        <h3>No verification check named {outcome.checkId}</h3>
      </section>
    )
  }
  return (
    <div data-outcome="review">
      <VerificationApprovalPanel review={outcome.review} onApprove={onApprove} onReject={onReject} busy={busy} />
    </div>
  )
}
