// The host-owned entry point for verification approvals.
//
// The security shape is the whole point of this file: `principal` is passed in by the caller from
// the authenticated session, and no request body is ever read for it. A payload naming its own
// approver cannot reach the service, because the service signature has nowhere to put it.
import {
  approveVerificationCandidate,
  listCandidateReviews,
  rejectVerificationCandidate,
  reviewCandidate,
} from "../../../../omo-engine/senpi-task/src/verification/approval-service"
import { approvalAuthorityFor } from "../../../../omo-engine/senpi-task/src/verification/approval-authority"

const PROJECT_ROOT_KEY = "projectRoot"
const WORKSPACE_KEY = "workspaceId"
const CHECK_KEY = "checkId"

function selectorFrom(query) {
  const projectRoot = String(query[PROJECT_ROOT_KEY] ?? "")
  const workspaceId = String(query[WORKSPACE_KEY] ?? "")
  const checkId = String(query[CHECK_KEY] ?? "")
  if (projectRoot === "") return { error: "projectRoot is required" }
  if (workspaceId === "") return { error: "workspaceId is required" }
  if (checkId === "") return { error: "checkId is required" }
  return { projectRoot, workspaceId, checkId }
}

export function createVerificationApprovalRuntime(options = {}) {
  // The authority root is a HOST setting, never a request field: the query only names which project
  // is being reviewed, and the directory authority is read from is derived from that project's real
  // path. Absent an injected root, the host default applies (a directory under the user's home).
  const authorityOf = (projectRoot) => approvalAuthorityFor(projectRoot, options.authorityRoot)
  return {
    // The approver identity is supplied by the authenticated route handler, never by the caller's
    // payload: this argument is the only place a principal enters the system.
    list({ principal, query }) {
      if (principal === null || principal === undefined) {
        return { ok: false, code: "approval_denied", reason: "no verified host principal was presented" }
      }
      const projectRoot = String(query[PROJECT_ROOT_KEY] ?? "")
      const workspaceId = String(query[WORKSPACE_KEY] ?? "")
      if (projectRoot === "" || workspaceId === "") {
        return { ok: false, code: "invalid_request", reason: "projectRoot and workspaceId are required" }
      }
      return {
        ok: true,
        listing: listCandidateReviews({
          projectRoot,
          workspaceId,
          changedFiles: null,
          authority: authorityOf(projectRoot),
        }),
      }
    },

    review({ principal, query }) {
      if (principal === null || principal === undefined) {
        return { ok: false, code: "approval_denied", reason: "no verified host principal was presented" }
      }
      const selector = selectorFrom(query)
      if (selector.error !== undefined) return { ok: false, code: "invalid_request", reason: selector.error }
      return {
        ok: true,
        outcome: reviewCandidate({
          projectRoot: selector.projectRoot,
          workspaceId: selector.workspaceId,
          changedFiles: null,
          authority: authorityOf(selector.projectRoot),
          checkId: selector.checkId,
        }),
      }
    },

    approve({ principal, query, displayedFingerprint }) {
      // Guarded before the service is called: a missing principal must be a denial, never a throw.
      if (principal === null || principal === undefined) {
        return { ok: false, code: "approval_denied", reason: "no verified host principal was presented" }
      }
      const selector = selectorFrom(query)
      if (selector.error !== undefined) return { ok: false, code: "invalid_request", reason: selector.error }
      const outcome = approveVerificationCandidate({
        projectRoot: selector.projectRoot,
        workspaceId: selector.workspaceId,
        changedFiles: null,
        authority: authorityOf(selector.projectRoot),
        checkId: selector.checkId,
        principal,
        // Only a staleness check: the fingerprint that counts is recomputed by the service.
        displayedFingerprint,
      })
      return outcome.ok ? { ok: true, record: outcome.record } : { ok: false, code: outcome.code, reason: outcome.reason }
    },

    reject({ principal, query, reason }) {
      if (principal === null || principal === undefined) {
        return { ok: false, code: "approval_denied", reason: "no verified host principal was presented" }
      }
      const selector = selectorFrom(query)
      if (selector.error !== undefined) return { ok: false, code: "invalid_request", reason: selector.error }
      const outcome = rejectVerificationCandidate({
        projectRoot: selector.projectRoot,
        workspaceId: selector.workspaceId,
        changedFiles: null,
        authority: authorityOf(selector.projectRoot),
        checkId: selector.checkId,
        principal,
        reason: String(reason ?? ""),
      })
      return outcome.rejected
        ? { ok: true, fingerprint: outcome.fingerprint }
        : { ok: false, code: outcome.code, reason: outcome.reason }
    },
  }
}
