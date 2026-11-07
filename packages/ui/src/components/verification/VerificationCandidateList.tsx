import { VerificationApprovalPanel, type VerificationReview } from "./VerificationApprovalPanel"

export type VerificationCandidateListProps = {
  reviews: readonly VerificationReview[]
  busy?: boolean
  onApprove: (checkId: string) => void
  onReject: (checkId: string) => void
}

// One panel per candidate, each carrying its own decision. The callback receives only the check id:
// the fingerprint that binds an approval is recomputed by the host from the catalogue, so nothing
// rendered here can name what it is authorizing beyond which check it belongs to.
export function VerificationCandidateList({ reviews, busy = false, onApprove, onReject }: VerificationCandidateListProps) {
  if (reviews.length === 0) {
    return (
      <section data-outcome="empty">
        <h3>No verification checks are declared for this project</h3>
        <p>Declare checks in .alcode/verification.json, or add test or lint scripts to the package manifest.</p>
      </section>
    )
  }
  return (
    <ul data-outcome="list">
      {reviews.map((review) => (
        <li key={review.checkId}>
          <VerificationApprovalPanel
            review={review}
            busy={busy}
            onApprove={() => onApprove(review.checkId)}
            onReject={() => onReject(review.checkId)}
          />
        </li>
      ))}
    </ul>
  )
}
