import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { VerificationApprovalSlot } from "./VerificationApprovalSlot"
import { useDirectoryStore } from "@/stores/useDirectoryStore"

let window: Window
let container: HTMLElement
let root: Root
let originalFetch: typeof globalThis.fetch

type Payload = {
  ok: boolean
  listing?: { kind: string; reviews?: readonly { checkId: string }[] }
}

const listing = (reviews: readonly { checkId: string }[]): Payload => ({
  ok: true,
  listing: {
    kind: "list",
    reviews: reviews.map((entry) => ({
      checkId: entry.checkId,
      executable: "bun",
      args: ["test"],
      cwd: ".",
      timeoutMs: 120_000,
      packageScope: "fixture",
      fingerprint: "e".repeat(64),
      source: "config",
      location: `.alcode/verification.json#checks.${entry.checkId}`,
      reason: "declared",
      status: "approval_required",
    })),
  },
})

function stubFetch(handler: () => Payload) {
  Object.assign(globalThis, { fetch: async () => new Response(JSON.stringify(handler()), { status: 200 }) })
}

beforeEach(() => {
  window = new Window()
  Object.assign(globalThis, { window, document: window.document, navigator: window.navigator })
  originalFetch = globalThis.fetch
  container = document.createElement("div")
  document.body?.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  Object.assign(globalThis, { fetch: originalFetch })
  useDirectoryStore.setState({ currentDirectory: "" })
})

async function renderSlot(): Promise<void> {
  await act(async () => {
    root.render(<VerificationApprovalSlot />)
  })
  await act(async () => {
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
}

describe("VerificationApprovalSlot", () => {
  test("renders nothing at all when no project is open", async () => {
    useDirectoryStore.setState({ currentDirectory: "" })
    stubFetch(() => listing([{ checkId: "unit-core" }]))
    await renderSlot()
    expect(container.querySelector("[data-surface='verification-approvals']")).toBeNull()
  })

  test("renders nothing when the project has no candidates", async () => {
    useDirectoryStore.setState({ currentDirectory: "/repo" })
    stubFetch(() => listing([]))
    await renderSlot()
    expect(container.querySelector("[data-surface='verification-approvals']")).toBeNull()
  })

  test("shows the candidates when the project has some awaiting a decision", async () => {
    useDirectoryStore.setState({ currentDirectory: "/repo" })
    stubFetch(() => listing([{ checkId: "unit-core" }]))
    await renderSlot()
    expect(container.querySelector("[data-surface='verification-approvals']")).not.toBeNull()
    expect(container.textContent).toContain("unit-core")
  })

  test("reports an unreadable catalogue instead of rendering nothing", async () => {
    useDirectoryStore.setState({ currentDirectory: "/repo" })
    Object.assign(globalThis, {
      fetch: async () => {
        throw new Error("network down")
      },
    })
    await renderSlot()
    expect(container.querySelector("[data-surface='verification-approvals']")).not.toBeNull()
    expect(container.textContent).toContain("network down")
  })
})
