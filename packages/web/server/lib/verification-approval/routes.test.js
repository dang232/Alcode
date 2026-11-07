import { describe, expect, it } from "vitest"

import { createPrincipalResolver, registerVerificationApprovalRoutes } from "./routes"

function fakeApp() {
  const routes = new Map()
  const app = {
    get(path, _guard, handler) {
      routes.set(`GET ${path}`, handler)
    },
    post(path, _guard, handler) {
      routes.set(`POST ${path}`, handler)
    },
  }
  return { app, routes }
}

function fakeRes() {
  const captured = { status: null, body: null }
  const res = {
    status(code) {
      captured.status = code
      return res
    },
    json(body) {
      captured.body = body
      return res
    },
  }
  return { res, captured }
}

const passthrough = (_req, _res, next) => next()

function mount(resolvePrincipal) {
  const { app, routes } = fakeApp()
  registerVerificationApprovalRoutes(app, { requireAuth: passthrough, resolvePrincipal })
  return routes
}

describe("principal resolver", () => {
  it("yields the verified subject from the host accessor", async () => {
    const resolve = createPrincipalResolver({ resolveRequestAlcoreSub: async () => "user-42" })
    expect(await resolve({})).toEqual({ sub: "user-42" })
  })

  it("yields null when the host reports no verified subject", async () => {
    const resolve = createPrincipalResolver({ resolveRequestAlcoreSub: async () => "" })
    expect(await resolve({})).toBeNull()
  })
})

describe("verification approval routes", () => {
  it("mounts review, approve and reject", async () => {
    const routes = mount(() => ({ sub: "u", sid: "s" }))
    expect([...routes.keys()].sort()).toEqual([
      "GET /api/verification/approvals/candidates",
      "GET /api/verification/approvals/review",
      "POST /api/verification/approvals/approve",
      "POST /api/verification/approvals/reject",
    ])
  })

  it("answers 403 on listing when the session yields no principal", async () => {
    const routes = mount(() => null)
    const { res, captured } = fakeRes()
    await routes.get("GET /api/verification/approvals/candidates")({ query: {} }, res)
    expect(captured.status).toBe(403)
    expect(captured.body.code).toBe("approval_denied")
  })

  it("answers 400 when listing without a project root", async () => {
    const routes = mount(() => ({ sub: "u", sid: "s" }))
    const { res, captured } = fakeRes()
    await routes.get("GET /api/verification/approvals/candidates")({ query: {} }, res)
    expect(captured.status).toBe(400)
    expect(captured.body.code).toBe("invalid_request")
  })

  it("answers 403 when the session yields no principal", async () => {
    const routes = mount(() => null)
    const { res, captured } = fakeRes()
    await routes.get("GET /api/verification/approvals/review")({ query: {} }, res)
    expect(captured.status).toBe(403)
    expect(captured.body.code).toBe("approval_denied")
  })

  it("answers 403 on approve when the session yields no principal", async () => {
    const routes = mount(() => null)
    const { res, captured } = fakeRes()
    await routes.get("POST /api/verification/approvals/approve")({ query: {}, body: {} }, res)
    expect(captured.status).toBe(403)
    expect(captured.body.code).toBe("approval_denied")
  })

  it("ignores a principal supplied in the request body", async () => {
    const routes = mount(() => null)
    const { res, captured } = fakeRes()
    await routes.get("POST /api/verification/approvals/approve")(
      { query: {}, body: { principal: { sub: "attacker", sid: "forged" } } },
      res,
    )
    expect(captured.status).toBe(403)
    expect(captured.body.code).toBe("approval_denied")
  })

  it("answers 400 when the request names no project root", async () => {
    const routes = mount(() => ({ sub: "u", sid: "s" }))
    const { res, captured } = fakeRes()
    await routes.get("GET /api/verification/approvals/review")({ query: {} }, res)
    expect(captured.status).toBe(400)
    expect(captured.body.code).toBe("invalid_request")
  })

  it("answers 403 on reject when the session yields no principal", async () => {
    const routes = mount(() => null)
    const { res, captured } = fakeRes()
    await routes.get("POST /api/verification/approvals/reject")({ query: {}, body: {} }, res)
    expect(captured.status).toBe(403)
  })
})
