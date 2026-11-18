import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { VerificationApprovalPanel, type VerificationReview } from "./VerificationApprovalPanel"

const review = (overrides: Partial<VerificationReview> = {}): VerificationReview => ({
  checkId: "unit-core",
  executable: "bun",
  args: ["test", "--grep", "a b"],
  cwd: "packages/web",
  timeoutMs: 120_000,
  packageScope: "@alcode/web",
  fingerprint: "a".repeat(64),
  source: "config",
  location: ".alcode/verification.json#checks.unit-core",
  reason: "declared in .alcode/verification.json",
  status: "approval_required",
  ...overrides,
})

let window: Window
let container: HTMLElement
let root: Root

beforeEach(() => {
  window = new Window()
  Object.assign(globalThis, { window, document: window.document, navigator: window.navigator })
  container = document.createElement("div")
  document.body?.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
})

async function renderPanel(element: React.ReactElement): Promise<void> {  await act(async () => {
    root.render(element)
  })
}

const noop = () => {}

describe("VerificationApprovalPanel", () => {
  test("renders each argument as its own token so boundaries stay visible", async () => {
    await renderPanel(<VerificationApprovalPanel review={review()} onApprove={noop} onReject={noop} />)
    const tokens = [...container.querySelectorAll("ol li code")].map((node) => node.textContent)
    expect(tokens).toEqual(["test", "--grep", "a b"])
    expect(container.textContent).toContain("a b")
  })

  test("shows the working directory, timeout, scope and fingerprint", async () => {
    await renderPanel(<VerificationApprovalPanel review={review()} onApprove={noop} onReject={noop} />)
    const text = container.textContent ?? ""
    expect(text).toContain("packages/web")
    expect(text).toContain("120000 ms")
    expect(text).toContain("@alcode/web")
    expect(text).toContain("a".repeat(64))
  })

  test("distinguishes every approval state", async () => {
    for (const status of ["approval_required", "approved", "rejected", "changed"] as const) {
      await renderPanel(<VerificationApprovalPanel review={review({ status })} onApprove={noop} onReject={noop} />)
      expect(container.querySelector("section")?.getAttribute("data-status")).toBe(status)
    }
  })

  test("approves without sending any fingerprint of its own", async () => {
    const calls: unknown[][] = []
    await renderPanel(
      <VerificationApprovalPanel review={review()} onApprove={() => calls.push([])} onReject={noop} />,
    )
    const approve = [...container.querySelectorAll("button")].find((button) => /approve/i.test(button.textContent ?? ""))
    await act(async () => {
      approve?.click()
    })
    expect(calls.length).toBe(1)
    expect(calls[0]).toEqual([])
  })

  test("offers no usable approve button once the command is already approved", async () => {
    await renderPanel(
      <VerificationApprovalPanel review={review({ status: "approved" })} onApprove={noop} onReject={noop} />,
    )
    const approve = [...container.querySelectorAll("button")].find((button) => /approve/i.test(button.textContent ?? ""))
    expect(approve?.disabled).toBe(true)
  })
})
