import { useCallback, useEffect, useState } from "react"

import { VerificationApprovalSection, type VerificationReviewOutcome } from "./VerificationApprovalSection"
import type { VerificationReview } from "./VerificationApprovalPanel"

export type VerificationApprovalTransport = {
  list: () => Promise<readonly VerificationReview[]>
  load: () => Promise<VerificationReviewOutcome>
  approve: () => Promise<{ ok: boolean; code?: string; reason?: string }>
  reject: (reason: string) => Promise<{ ok: boolean; code?: string; reason?: string }>
}

export type VerificationApprovalContainerProps = {
  transport: VerificationApprovalTransport
}

// The container never builds a request body. It asks the transport to load, approve or reject, and
// the transport is where identity and fingerprint live - so nothing a person clicks can smuggle
// either into the request.
export function VerificationApprovalContainer({ transport }: VerificationApprovalContainerProps) {
  const [outcome, setOutcome] = useState<VerificationReviewOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setBusy(true)
    setFailure(null)
    try {
      setOutcome(await transport.load())
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "the review could not be loaded")
    } finally {
      setBusy(false)
    }
  }, [transport])

  useEffect(() => {
    void reload()
  }, [reload])

  const decide = useCallback(
    async (action: () => Promise<{ ok: boolean; code?: string; reason?: string }>) => {
      setBusy(true)
      setFailure(null)
      try {
        const result = await action()
        if (!result.ok) {
          // A refusal stays on screen: reloading here would clear it and make a rejected decision look
          // like a clean state the person never acted on.
          setFailure(result.reason ?? result.code ?? "the decision was refused")
          return
        }
        await reload()
      } catch (error) {
        setFailure(error instanceof Error ? error.message : "the decision could not be sent")
      } finally {
        setBusy(false)
      }
    },
    [reload],
  )

  if (failure !== null) {
    return (
      <section role="alert" data-outcome="error">
        <h3>Verification approval unavailable</h3>
        <p>{failure}</p>
      </section>
    )
  }
  if (outcome === null) {
    return (
      <section data-outcome="loading">
        <p>Loading verification checks…</p>
      </section>
    )
  }
  return (
    <VerificationApprovalSection
      outcome={outcome}
      busy={busy}
      onApprove={() => void decide(transport.approve)}
      onReject={() => void decide(() => transport.reject("rejected from the approval surface"))}
    />
  )
}
