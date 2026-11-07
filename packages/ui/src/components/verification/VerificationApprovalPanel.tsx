export type VerificationReviewStatus = "approval_required" | "approved" | "rejected" | "changed"

export type VerificationReview = {
  checkId: string
  executable: string
  args: readonly string[]
  cwd: string
  timeoutMs: number
  packageScope: string
  fingerprint: string
  source: string
  location: string
  reason: string
  status: VerificationReviewStatus
}

export type VerificationApprovalPanelProps = {
  review: VerificationReview
  onApprove: () => void
  onReject: () => void
  busy?: boolean
}

// The action callbacks take no arguments on purpose. Approving is a decision about the candidate on
// screen; the fingerprint that binds it is recomputed by the host, so this component must never be
// able to send one - a stale or forged fingerprint cannot originate here.
const STATUS_LABEL = new Map<VerificationReviewStatus, string>([
  ["approval_required", "Approval required"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["changed", "Changed since approval"],
])

export function VerificationApprovalPanel({ review, onApprove, onReject, busy = false }: VerificationApprovalPanelProps) {
  const canDecide = review.status !== "approved"
  return (
    <section aria-label={`Verification check ${review.checkId}`} data-status={review.status}>
      <header>
        <h3>{review.checkId}</h3>
        <span data-status={review.status}>{STATUS_LABEL.get(review.status) ?? review.status}</span>
      </header>
      <p>{review.reason}</p>
      <dl>
        <dt>Executable</dt>
        <dd>
          <code>{review.executable}</code>
        </dd>
        <dt>Arguments</dt>
        <dd>
          {/* One element per token: a joined command line would hide where one argument ends. */}
          {review.args.length === 0 ? (
            <em>none</em>
          ) : (
            <ol>
              {review.args.map((arg, index) => (
                <li key={`${index}-${arg}`}>
                  <code>{arg}</code>
                </li>
              ))}
            </ol>
          )}
        </dd>
        <dt>Working directory</dt>
        <dd>
          <code>{review.cwd}</code>
        </dd>
        <dt>Timeout</dt>
        <dd>{review.timeoutMs} ms</dd>
        <dt>Scope</dt>
        <dd>{review.packageScope === "" ? "workspace root" : review.packageScope}</dd>
        <dt>Declared by</dt>
        <dd>{review.location}</dd>
        <dt>Fingerprint</dt>
        <dd>
          <code>{review.fingerprint}</code>
        </dd>
      </dl>
      <footer>
        <button type="button" onClick={onApprove} disabled={busy || !canDecide}>
          Approve this exact command
        </button>
        <button type="button" onClick={onReject} disabled={busy}>
          Reject
        </button>
      </footer>
    </section>
  )
}
