import type { VerificationApprovalTransport } from "./VerificationApprovalContainer"
import type { VerificationReview } from "./VerificationApprovalPanel"
import type { VerificationReviewOutcome } from "./VerificationApprovalSection"

export type VerificationApprovalSelector = {
  projectRoot: string
  workspaceId: string
  checkId: string
}

type Reply = { ok: boolean; code?: string; reason?: string }

type ReviewPayload = { ok: boolean; outcome?: VerificationReviewOutcome; reason?: string }

// Binds the three authenticated endpoints to the transport the container expects. Note what is NOT
// here: no approver, no fingerprint, no command. The selector names which check is under review and
// nothing else, so a compromised caller cannot widen what it is allowed to authorize.
export function createVerificationApprovalTransport(
  request: (path: string, init?: { method?: string; body?: string }) => Promise<Response>,
  selector: VerificationApprovalSelector,
): VerificationApprovalTransport {
  const query = new URLSearchParams(selector).toString()
  const url = (path: string) => `/api/verification/approvals/${path}?${query}`

  const post = async (path: string, body: string): Promise<Reply> => {
    const response = await request(url(path), { method: "POST", body })
    const payload: Reply = await response.json()
    const reply: Reply = { ok: payload.ok === true }
    if (payload.code !== undefined) reply.code = payload.code
    if (payload.reason !== undefined) reply.reason = payload.reason
    return reply
  }

type ListingPayload = { ok: boolean; listing?: { kind: string; reviews?: readonly VerificationReview[] } }

  return {
    list: async (): Promise<readonly VerificationReview[]> => {
      const response = await request(url("candidates"))
      const payload: ListingPayload = await response.json()
      if (payload.ok !== true || payload.listing === undefined) return []
      return payload.listing.reviews ?? []
    },
    load: async (): Promise<VerificationReviewOutcome> => {
      const response = await request(url("review"))
      const payload: ReviewPayload = await response.json()
      if (payload.ok !== true || payload.outcome === undefined) {
        return { kind: "invalid", diagnostics: [payload.reason ?? "the review could not be loaded"] }
      }
      return payload.outcome
    },
    approve: () => post("approve", "{}"),
    reject: (reason: string) => post("reject", JSON.stringify({ reason })),
  }
}
