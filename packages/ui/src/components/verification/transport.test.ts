import { describe, expect, test } from "bun:test"

import { createVerificationApprovalTransport } from "./transport"

const selector = { projectRoot: "/repo", workspaceId: ".", checkId: "unit-core" }

type Payload = {
  ok: boolean
  reason?: string
  outcome?: { kind: "missing"; checkId: string }
  listing?: { kind: string; reviews?: readonly { checkId: string }[] }
}

function recorder(payloadFor: (path: string) => Payload) {
  const calls: { path: string; method: string; body: string | undefined }[] = []
  const request = async (path: string, init?: { method?: string; body?: string }) => {
    calls.push({ path, method: init?.method ?? "GET", body: init?.body })
    return new Response(JSON.stringify(payloadFor(path)), { status: 200 })
  }
  return { calls, request }
}

describe("verification approval transport", () => {
  test("names only the check under review, never an approver or fingerprint", async () => {
    const { calls, request } = recorder(() => ({ ok: true, outcome: { kind: "missing", checkId: "unit-core" } }))
    await createVerificationApprovalTransport(request, selector).load()
    const url = calls[0]?.path ?? ""
    expect(url).toContain("projectRoot=%2Frepo")
    expect(url).toContain("checkId=unit-core")
    expect(url).not.toContain("approvedBy")
    expect(url).not.toContain("fingerprint")
    expect(url).not.toContain("command")
  })

  test("approves with an empty body", async () => {
    const { calls, request } = recorder(() => ({ ok: true }))
    const result = await createVerificationApprovalTransport(request, selector).approve()
    expect(result.ok).toBe(true)
    expect(calls[0]?.method).toBe("POST")
    expect(calls[0]?.body).toBe("{}")
  })

  test("sends the rejection reason", async () => {
    const { calls, request } = recorder(() => ({ ok: true }))
    await createVerificationApprovalTransport(request, selector).reject("not wanted")
    expect(calls[0]?.body).toBe(JSON.stringify({ reason: "not wanted" }))
  })

  test("lists candidates from the candidates endpoint", async () => {
    const { calls, request } = recorder(() => ({
      ok: true,
      listing: { kind: "list", reviews: [{ checkId: "unit-core" }] },
    }))
    const listed = await createVerificationApprovalTransport(request, selector).list()
    expect(calls[0]?.path).toContain("approvals/candidates")
    expect(listed.map((entry) => entry.checkId)).toEqual(["unit-core"])
  })

  test("reports an empty list when the listing is refused", async () => {
    const { request } = recorder(() => ({ ok: false, reason: "denied" }))
    expect(await createVerificationApprovalTransport(request, selector).list()).toEqual([])
  })

  test("reports a refused load as an invalid catalogue rather than an empty review", async () => {
    const { request } = recorder(() => ({ ok: false, reason: "no verified host principal was presented" }))
    const outcome = await createVerificationApprovalTransport(request, selector).load()
    expect(outcome.kind).toBe("invalid")
    expect(outcome.kind === "invalid" ? outcome.diagnostics[0] : "").toContain("no verified host principal")
  })
})
