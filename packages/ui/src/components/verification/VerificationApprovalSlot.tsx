import { useCallback, useEffect, useState } from "react"

import { VerificationCandidateList } from "./VerificationCandidateList"
import { createVerificationApprovalTransport } from "./transport"
import type { VerificationReview } from "./VerificationApprovalPanel"
import { useDirectoryStore } from "@/stores/useDirectoryStore"

const passThrough = (path: string, init?: { method?: string; body?: string }) => fetch(path, init)

// Self-gating: with no current project, or nothing awaiting a decision, this renders nothing at all.
// That keeps it safe to mount at the app root beside the other ambient dialogs - a surface that
// cannot identify a project has nothing it is allowed to authorize.
export function VerificationApprovalSlot() {
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory)
  const [reviews, setReviews] = useState<readonly VerificationReview[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const transport = useCallback(
    (checkId: string) =>
      createVerificationApprovalTransport(passThrough, {
        projectRoot: currentDirectory,
        workspaceId: ".",
        checkId,
      }),
    [currentDirectory],
  )

  const reload = useCallback(async () => {
    if (currentDirectory === "") {
      setReviews([])
      return
    }
    try {
      const listed = await createVerificationApprovalTransport(passThrough, {
        projectRoot: currentDirectory,
        workspaceId: ".",
        checkId: "",
      }).list()
      setReviews(listed)
      setFailure(null)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "the verification catalogue could not be read")
    }
  }, [currentDirectory])

  useEffect(() => {
    void reload()
  }, [reload])

  const decide = useCallback(
    async (checkId: string, action: "approve" | "reject") => {
      setBusy(true)
      setFailure(null)
      try {
        const result = action === "approve" ? await transport(checkId).approve() : await transport(checkId).reject("rejected from the approval surface")
        if (!result.ok) {
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
    [reload, transport],
  )

  if (currentDirectory === "" || (reviews.length === 0 && failure === null)) return null

  return (
    <section aria-label="Verification approvals" data-surface="verification-approvals">
      {failure === null ? null : <p role="alert">{failure}</p>}
      <VerificationCandidateList
        reviews={reviews}
        busy={busy}
        onApprove={(checkId) => void decide(checkId, "approve")}
        onReject={(checkId) => void decide(checkId, "reject")}
      />
    </section>
  )
}
