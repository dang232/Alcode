import { afterAll, describe, expect, it } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { createVerificationApprovalRuntime } from "./host-action"
import { approvalAuthorityFor } from "../../../../omo-engine/senpi-task/src/verification/approval-authority"


// Every temp dir this file creates is tracked so a test run leaves no QA state behind.
const createdDirs = []
function track(dir) {
  createdDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
// Every runtime in this file is pinned to a temp authority root: a test must never read or write the
// real host authority under the user's home.
const runtime = createVerificationApprovalRuntime({ authorityRoot: track(mkdtempSync(join(tmpdir(), "alcode-authority-"))) })
const principal = { sub: "user-42", sid: "session-9" }

const query = (projectRoot) => ({ projectRoot, workspaceId: ".", checkId: "unit-core" })

describe("verification approval host action", () => {
  it("denies review when no verified principal is presented", () => {
    const result = runtime.review({ principal: null, query: query(tmpdir()) })
    expect(result.ok).toBe(false)
    expect(result.code).toBe("approval_denied")
  })

  it("denies approve when no verified principal is presented, rather than throwing", () => {
    const result = runtime.approve({ principal: null, query: query(tmpdir()) })
    expect(result.ok).toBe(false)
    expect(result.code).toBe("approval_denied")
  })

  it("denies reject when no verified principal is presented", () => {
    const result = runtime.reject({ principal: null, query: query(tmpdir()) })
    expect(result.ok).toBe(false)
    expect(result.code).toBe("approval_denied")
  })

  it("rejects a request that names no project root", () => {
    const result = runtime.review({ principal, query: {} })
    expect(result.ok).toBe(false)
    expect(result.code).toBe("invalid_request")
  })

  it("refuses to approve a check that does not exist in the project", () => {
    const root = track(mkdtempSync(join(tmpdir(), "alcode-host-action-")))
    const result = runtime.approve({ principal, query: query(root) })
    expect(result.ok).toBe(false)
    expect(result.ok).toBe(false)
  })

  it("never reports success for a rejection that was not recorded", () => {
    const root = track(mkdtempSync(join(tmpdir(), "alcode-host-action-")))
    const result = runtime.reject({ principal, query: query(root), reason: "not wanted" })
    expect(result.ok).toBe(false)
  })

  it("records an approval outside the project tree and writes nothing inside it", () => {
    // The Phase 2.1.10 property: authority lives in host state, so a project (and anyone who can
    // write the project) cannot carry approval authority.
    const projectRoot = track(mkdtempSync(join(tmpdir(), "alcode-host-authority-project-")))
    mkdirSync(join(projectRoot, ".alcode"), { recursive: true })
    writeFileSync(
      join(projectRoot, ".alcode", "verification.json"),
      JSON.stringify({
        version: 1,
        checks: [{ id: "unit-core", name: "core", category: "unit", command: ["node", "-e", "process.exit(0)"], timeoutMs: 20_000 }],
      }),
    )
    const authorityRoot = track(mkdtempSync(join(tmpdir(), "alcode-host-authority-")))
    const scoped = createVerificationApprovalRuntime({ authorityRoot })

    const approved = scoped.approve({ principal, query: query(projectRoot) })
    expect(approved.ok).toBe(true)

    const authority = approvalAuthorityFor(projectRoot, authorityRoot)
    expect(existsSync(join(projectRoot, ".alcode", "approvals"))).toBe(false)
    expect(existsSync(authority.workspaceDir)).toBe(true)
  })
})
