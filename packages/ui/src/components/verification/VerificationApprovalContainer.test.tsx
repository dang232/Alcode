import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { VerificationApprovalContainer } from "./VerificationApprovalContainer"
import type { VerificationReviewOutcome } from "./VerificationApprovalSection"

const review: VerificationReviewOutcome = {
  kind: "review",
  review: {
    checkId: "unit-core",
    executable: "bun",
    args: ["test"],
    cwd: ".",
    timeoutMs: 120_000,
    packageScope: "fixture",
    fingerprint: "c".repeat(64),
    source: "config",
    location: ".alcode/verification.json#checks.unit-core",
    reason: "declared",
    status: "approval_required",
  },
}

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

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function transport(overrides: { approve?: () => Promise<{ ok: boolean; reason?: string }> } = {}) {
  return {
    list: async () => [],
    load: async () => review,
    approve: overrides.approve ?? (async () => ({ ok: true })),
    reject: async () => ({ ok: true }),
  }
}

describe("VerificationApprovalContainer", () => {
  test("loads the review and shows the decision surface", async () => {
    await act(async () => {
      root.render(<VerificationApprovalContainer transport={transport()} />)
    })
    await settle()
    expect(container.querySelector("[data-outcome='review']")).not.toBeNull()
    expect(container.textContent).toContain("unit-core")
  })

  test("approving calls the transport and reloads", async () => {
    let approvals = 0
    let loads = 0
    const t = {
      list: async () => [],
      load: async () => {
        loads += 1
        return review
      },
      approve: async () => {
        approvals += 1
        return { ok: true }
      },
      reject: async () => ({ ok: true }),
    }
    await act(async () => {
      root.render(<VerificationApprovalContainer transport={t} />)
    })
    await settle()
    const approve = [...container.querySelectorAll("button")].find((button) => /approve/i.test(button.textContent ?? ""))
    await act(async () => {
      approve?.click()
    })
    await settle()
    expect(approvals).toBe(1)
    expect(loads).toBe(2)
  })

  test("surfaces a refused decision instead of pretending it succeeded", async () => {
    const t = transport({ approve: async () => ({ ok: false, reason: "the candidate changed after it was displayed" }) })
    await act(async () => {
      root.render(<VerificationApprovalContainer transport={t} />)
    })
    await settle()
    const approve = [...container.querySelectorAll("button")].find((button) => /approve/i.test(button.textContent ?? ""))
    await act(async () => {
      approve?.click()
    })
    await settle()
    expect(container.querySelector("[data-outcome='error']")).not.toBeNull()
    expect(container.textContent).toContain("changed after it was displayed")
  })
})
