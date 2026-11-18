import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { VerificationApprovalSection } from "./VerificationApprovalSection"
import type { VerificationReview } from "./VerificationApprovalPanel"

const review = (): VerificationReview => ({
  checkId: "unit-core",
  executable: "bun",
  args: ["test"],
  cwd: ".",
  timeoutMs: 120_000,
  packageScope: "fixture",
  fingerprint: "b".repeat(64),
  source: "config",
  location: ".alcode/verification.json#checks.unit-core",
  reason: "declared",
  status: "approval_required",
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

async function renderSection(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(element)
  })
}

const noop = () => {}

describe("VerificationApprovalSection", () => {
  test("shows the panel when a candidate can be decided", async () => {
    await renderSection(<VerificationApprovalSection outcome={{ kind: "review", review: review() }} onApprove={noop} onReject={noop} />)
    expect(container.querySelector("[data-outcome='review']")).not.toBeNull()
    expect(container.textContent).toContain("unit-core")
  })

  test("reports a broken catalogue and offers nothing to approve", async () => {
    await renderSection(
      <VerificationApprovalSection
        outcome={{ kind: "invalid", diagnostics: ["checks[0].cwd: must not traverse outside the project root"] }}
        onApprove={noop}
        onReject={noop}
      />,
    )
    expect(container.querySelector("[data-outcome='invalid']")).not.toBeNull()
    expect(container.textContent).toContain("must not traverse")
    expect(container.querySelectorAll("button").length).toBe(0)
  })

  test("reports a missing check and offers nothing to approve", async () => {
    await renderSection(
      <VerificationApprovalSection outcome={{ kind: "missing", checkId: "lint-missing" }} onApprove={noop} onReject={noop} />,
    )
    expect(container.querySelector("[data-outcome='missing']")).not.toBeNull()
    expect(container.textContent).toContain("lint-missing")
    expect(container.querySelectorAll("button").length).toBe(0)
  })
})
