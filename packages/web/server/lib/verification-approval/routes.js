// Mount points for the verification approval surface.
//
// `resolvePrincipal` is injected rather than read here: the route must never derive an approver from
// the request body, and keeping the session lookup outside this module makes that boundary visible
// at the mount site instead of buried in a handler. `requireAuth` is passed through unchanged so the
// host's own authentication gate runs before any of this code.
import { createVerificationApprovalRuntime } from "./host-action"

// Re-exported so this entry (the only one `build:verification` bundles for the Node server)
// carries the engine-backed repair reader the run-graph runtime loads from dist.
/** @public Consumed by `run-graph/runtime.js` through the built verification bundle, not by a source import. */
export { createRepairStateReader } from "./repair-state"

const REVIEW_PATH = "/api/verification/approvals/review"
const LIST_PATH = "/api/verification/approvals/candidates"
const APPROVE_PATH = "/api/verification/approvals/approve"
const REJECT_PATH = "/api/verification/approvals/reject"

function statusFor(result) {
  if (result.ok) return 200
  if (result.code === "invalid_request") return 400
  if (result.code === "candidate_unknown") return 404
  return 403
}

async function principalOf(resolvePrincipal, req) {
  const resolved = await resolvePrincipal(req)
  if (resolved === null || resolved === undefined) return null
  return { sub: String(resolved.sub ?? ""), sid: String(resolved.sid ?? "") }
}

// Adapts the host's own verified-subject accessor into the principal this route layer accepts.
// `resolveRequestAlcoreSub` answers '' when the request carries no verified identity, and that empty
// string becomes null here so it lands on the denial path rather than reaching the service.
export function createPrincipalResolver(uiAuthController) {
  return async (req) => {
    const sub = String((await uiAuthController.resolveRequestAlcoreSub(req)) ?? "")
    return sub === "" ? null : { sub }
  }
}

export function registerVerificationApprovalRoutes(app, deps) {
  const runtime = createVerificationApprovalRuntime()
  const guard = deps.requireAuth

  app.get(LIST_PATH, guard, async (req, res) => {
    const result = runtime.list({ principal: await principalOf(deps.resolvePrincipal, req), query: req.query })
    res.status(statusFor(result)).json(result)
  })

  app.get(REVIEW_PATH, guard, async (req, res) => {
    const result = runtime.review({ principal: await principalOf(deps.resolvePrincipal, req), query: req.query })
    res.status(statusFor(result)).json(result)
  })

  app.post(APPROVE_PATH, guard, async (req, res) => {
    const body = req.body ?? {}
    const result = runtime.approve({
      principal: await principalOf(deps.resolvePrincipal, req),
      query: req.query,
      displayedFingerprint: body.displayedFingerprint,
    })
    res.status(statusFor(result)).json(result)
  })

  app.post(REJECT_PATH, guard, async (req, res) => {
    const body = req.body ?? {}
    const result = runtime.reject({
      principal: await principalOf(deps.resolvePrincipal, req),
      query: req.query,
      reason: body.reason,
    })
    res.status(statusFor(result)).json(result)
  })

  return { paths: [LIST_PATH, REVIEW_PATH, APPROVE_PATH, REJECT_PATH] }
}
