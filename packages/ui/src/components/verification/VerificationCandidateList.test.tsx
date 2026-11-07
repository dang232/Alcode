import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { VerificationCandidateList } from "./VerificationCandidateList"
import type { VerificationReview } from "./VerificationApprovalPanel"

const review = (checkId: string, overrides: Partial<VerificationReview> = {}): VerificationReview => ({
  checkId,
  executable: "bun",
  args: ["test"],
  cwd: ".",
  timeoutMs: 120_000,
  packageScope: "fixture",
  fingerprint: "d".repeat(64),
  source: "config",
  location: `.alcode/verification.json#checks.${checkId}`,
  reason: "declared",
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

async function render(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(element)
  })
}

const noop = () => {}

describe("VerificationCandidateList", () => {
  test("renders one panel per candidate", async () => {
    await render(
      <VerificationCandidateList reviews={[review("unit-core"), review("lint-core")]} onApprove={noop} onReject={noop} />,
    )
    const sections = container.querySelectorAll("section[data-status]")
    expect(sections.length).toBe(2)
    expect(container.textContent).toContain("unit-core")
    expect(container.textContent).toContain("lint-core")
  })

  test("says so plainly when nothing is declared, and offers no decision", async () => {
    await render(<VerificationCandidateList reviews={[]} onApprove={noop} onReject={noop} />)
    expect(container.querySelector("[data-outcome='empty']")).not.toBeNull()
    expect(container.querySelectorAll("button").length).toBe(0)
  })

  test("passes the check id of the row whose button was pressed", async () => {
    const approved: string[] = []
    await render(
      <VerificationCandidateList
        reviews={[review("unit-core"), review("lint-core")]}
        onApprove={(checkId) => approved.push(checkId)}
        onReject={noop}
      />,
    )
    const buttons = [...container.querySelectorAll("button")].filter((button) => /approve/i.test(button.textContent ?? ""))
    await act(async () => {
      buttons[1]?.click()
    })
    expect(approved).toEqual(["lint-core"])
  })
})
