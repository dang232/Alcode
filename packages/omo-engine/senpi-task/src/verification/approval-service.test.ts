import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { approvalAuthorityFor, type ApprovalAuthority } from "./approval-authority"
import { readApprovals, revokeApproval } from "./approval-store"
import { approveVerificationCandidate, listCandidateReviews, rejectVerificationCandidate, reviewCandidate } from "./approval-service"
import { VERIFICATION_CONFIG_PATH } from "./config"

const MARKER = "APPROVAL_EXECUTED.txt"

const principal = { sub: "user-42", sid: "session-9" }

const declared = (overrides: { id?: string; command?: string[]; cwd?: string } = {}) => ({
  id: overrides.id ?? "unit-core",
  name: "Core unit tests",
  category: "unit",
  command: overrides.command ?? ["bun", "test"],
  cwd: overrides.cwd ?? ".",
  packageScope: "fixture",
  timeoutMs: 120_000,
  required: true,
})

function workspace(checks: readonly object[] = [declared()]) {
  const root = track(mkdtempSync(join(tmpdir(), "alcode-svc-")))
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: {} }), "utf8")
  mkdirSync(join(root, ".alcode"), { recursive: true })
  writeFileSync(join(root, ...VERIFICATION_CONFIG_PATH.split("/")), JSON.stringify({ version: 1, checks }), "utf8")
  const authority = approvalAuthorityFor(root, track(mkdtempSync(join(tmpdir(), "p2110-auth-"))))
  return { root, authority }
}

const approveInput = (
  root: string,
  authority: ApprovalAuthority,
  overrides: Partial<Parameters<typeof approveVerificationCandidate>[0]> = {},
) => ({
  projectRoot: root,
  workspaceId: ".",
  changedFiles: null,
  authority,
  checkId: "unit-core",
  principal,
  ...overrides,
})

// Every temp dir this file creates is tracked so a test run leaves no QA state behind.
const createdDirs: string[] = []

function track<T extends string>(dir: T): T {
  createdDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("host approval action", () => {
  test("#given a verified principal and a known candidate #when approved #then a workspace-bound record is written", () => {
    const { root, authority } = workspace()
    const outcome = approveVerificationCandidate(approveInput(root, authority))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.record.approvedBy).toBe("alcode:user-42")
    expect(outcome.record.workspaceId).toBe(".")
  })

  test("#given an approval #when a freshly constructed store reads it #then the record survives reconstruction", () => {
    const { root, authority } = workspace()
    approveVerificationCandidate(approveInput(root, authority))
    const fresh = approvalAuthorityFor(root, authority.root)
    const read = readApprovals(fresh, ".")
    expect(read.ok).toBe(true)
    expect(read.ok ? read.approvals.length : -1).toBe(1)
  })

  test("#given a verified subject with no session id #when approved #then the subject alone authorizes it", () => {
    const { root, authority } = workspace()
    const outcome = approveVerificationCandidate(approveInput(root, authority, { principal: { sub: "user-42" } }))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.record.approvedBy).toBe("alcode:user-42")
  })

  test("#given no verified principal #when approved #then the action is denied and nothing is written", () => {
    const { root, authority } = workspace()
    const outcome = approveVerificationCandidate(approveInput(root, authority, { principal: { sub: "", sid: "s" } }))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe("approval_denied")
    const read = readApprovals(authority, ".")
    expect(read.ok && read.records.length).toBe(0)
  })

  test("#given a principal other than the caller's own #when approved #then the recorded approver is that principal and nothing else", () => {
    const { root, authority } = workspace()
    const outcome = approveVerificationCandidate(
      approveInput(root, authority, { principal: { sub: "other-user", sid: "other-session" } }),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.record.approvedBy).toBe("alcode:other-user")
  })

  test("#given a candidate that changed since display #when approved with the old fingerprint #then it is refused", () => {
    const { root, authority } = workspace()
    const shown = reviewCandidate({ projectRoot: root, workspaceId: ".", changedFiles: null, authority, checkId: "unit-core" })
    if (shown.kind !== "review") throw new Error("expected a review")
    writeFileSync(
      join(root, ...VERIFICATION_CONFIG_PATH.split("/")),
      JSON.stringify({ version: 1, checks: [declared({ command: ["bun", "test", "--bail"] })] }),
      "utf8",
    )
    const outcome = approveVerificationCandidate(
      approveInput(root, authority, { displayedFingerprint: shown.review.fingerprint }),
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe("fingerprint_mismatch")
    const read = readApprovals(authority, ".")
    expect(read.ok && read.records.length).toBe(0)
  })

  test("#given an unchanged candidate #when approved with the displayed fingerprint #then it is accepted", () => {
    const { root, authority } = workspace()
    const shown = reviewCandidate({ projectRoot: root, workspaceId: ".", changedFiles: null, authority, checkId: "unit-core" })
    if (shown.kind !== "review") throw new Error("expected a review")
    expect(approveVerificationCandidate(approveInput(root, authority, { displayedFingerprint: shown.review.fingerprint })).ok).toBe(
      true,
    )
  })

  test("#given an invalid configuration #when approved #then it reports the catalogue as invalid, not the candidate as unknown", () => {
    const { root, authority } = workspace([declared({ cwd: "../escape" })])
    const outcome = approveVerificationCandidate(approveInput(root, authority))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe("catalogue_invalid")
  })

  test("#given an unrelated check id #when approved #then the candidate is unknown and nothing is written", () => {
    const { root, authority } = workspace()
    const outcome = approveVerificationCandidate(approveInput(root, authority, { checkId: "lint-missing" }))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe("candidate_unknown")
  })

  test("#given a workspace identity outside the project root #when approved #then it is refused", () => {
    const { root, authority } = workspace()
    const outcome = approveVerificationCandidate(approveInput(root, authority, { workspaceId: "../other" }))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe("workspace_mismatch")
  })

  test("#given declared checks #when listed #then every one appears with its status", () => {
    const { root, authority } = workspace([declared(), declared({ id: "lint-core", command: ["bun", "run", "lint"] })])
    const listed = listCandidateReviews({ projectRoot: root, workspaceId: ".", changedFiles: null, authority })
    expect(listed.kind).toBe("list")
    if (listed.kind !== "list") return
    expect(listed.reviews.map((r) => r.checkId)).toEqual(["unit-core", "lint-core"])
    expect(listed.reviews.every((r) => r.status === "approval_required")).toBe(true)
  })

  test("#given one approved check #when listed #then only that entry reads approved", () => {
    const { root, authority } = workspace([declared(), declared({ id: "lint-core", command: ["bun", "run", "lint"] })])
    approveVerificationCandidate(approveInput(root, authority, { checkId: "unit-core" }))
    const listed = listCandidateReviews({ projectRoot: root, workspaceId: ".", changedFiles: null, authority })
    if (listed.kind !== "list") throw new Error("expected a list")
    expect(listed.reviews.find((r) => r.checkId === "unit-core")?.status).toBe("approved")
    expect(listed.reviews.find((r) => r.checkId === "lint-core")?.status).toBe("approval_required")
  })

  test("#given an invalid configuration #when listed #then the catalogue is reported invalid", () => {
    const { root, authority } = workspace([declared({ cwd: "../escape" })])
    const listed = listCandidateReviews({ projectRoot: root, workspaceId: ".", changedFiles: null, authority })
    expect(listed.kind).toBe("invalid")
  })

  test("#given a candidate whose command would write a marker #when reviewed and approved #then nothing executes", () => {
    const { root, authority } = workspace([declared({ command: ["node", "-e", `require('fs').writeFileSync('${MARKER}','x')`] })])
    reviewCandidate({ projectRoot: root, workspaceId: ".", changedFiles: null, authority, checkId: "unit-core" })
    approveVerificationCandidate(approveInput(root, authority))
    expect(existsSync(join(root, MARKER))).toBe(false)
  })

  test("#given a rejection #when recorded #then the decision is visible but never counts as an approval", () => {
    const { root, authority } = workspace()
    const outcome = rejectVerificationCandidate({
      projectRoot: root,
      workspaceId: ".",
      changedFiles: null,
      authority,
      checkId: "unit-core",
      principal,
      reason: "not wanted",
    })
    expect(outcome.rejected).toBe(true)
    const read = readApprovals(authority, ".")
    expect(read.ok ? read.approvals.length : -1).toBe(0)
    expect(read.ok ? read.records.length : -1).toBe(1)
    expect(read.ok ? read.records[0]?.status : "").toBe("rejected")
  })

  test("#given a rejected candidate #when reviewed #then its status reads rejected", () => {
    const { root, authority } = workspace()
    rejectVerificationCandidate({
      projectRoot: root,
      workspaceId: ".",
      changedFiles: null,
      authority,
      checkId: "unit-core",
      principal,
      reason: "not wanted",
    })
    const shown = reviewCandidate({ projectRoot: root, workspaceId: ".", changedFiles: null, authority, checkId: "unit-core" })
    if (shown.kind !== "review") throw new Error("expected a review")
    expect(shown.review.status).toBe("rejected")
  })

  test("#given two approved candidates #when one is revoked #then the other stays approved", () => {
    const { root, authority } = workspace([declared(), declared({ id: "lint-core", command: ["bun", "run", "lint"] })])
    const first = approveVerificationCandidate(approveInput(root, authority, { checkId: "unit-core" }))
    const second = approveVerificationCandidate(approveInput(root, authority, { checkId: "lint-core" }))
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok) return
    revokeApproval({ authority, workspaceId: ".", fingerprint: first.record.fingerprint, approvedBy: "alcode:user-42" })
    const read = readApprovals(authority, ".")
    expect(read.ok ? read.approvals.length : -1).toBe(1)
    expect(read.ok ? read.records.length : -1).toBe(2)
    expect(read.ok ? read.approvals[0]?.fingerprint : "").not.toBe(first.record.fingerprint)
  })

  test("#given an approved candidate that then changed #when reviewed #then its status reads changed, not approval_required", () => {
    const { root, authority } = workspace()
    approveVerificationCandidate(approveInput(root, authority))
    writeFileSync(
      join(root, ...VERIFICATION_CONFIG_PATH.split("/")),
      JSON.stringify({ version: 1, checks: [declared({ command: ["bun", "test", "--bail"] })] }),
      "utf8",
    )
    const shown = reviewCandidate({ projectRoot: root, workspaceId: ".", changedFiles: null, authority, checkId: "unit-core" })
    if (shown.kind !== "review") throw new Error("expected a review")
    expect(shown.review.status).toBe("changed")
  })

  test("#given an invalid configuration #when reviewed #then the surface is told the catalogue is invalid, not that the check is missing", () => {
    const { root, authority } = workspace([declared({ cwd: "../escape" })])
    const outcome = reviewCandidate({ projectRoot: root, workspaceId: ".", changedFiles: null, authority, checkId: "unit-core" })
    expect(outcome.kind).toBe("invalid")
    expect(outcome.kind === "invalid" ? outcome.diagnostics.join() : "").toContain("traverse")
  })

  test("#given an unknown check id #when reviewed #then the outcome is missing rather than invalid", () => {
    const { root, authority } = workspace()
    const outcome = reviewCandidate({ projectRoot: root, workspaceId: ".", changedFiles: null, authority, checkId: "nope" })
    expect(outcome.kind).toBe("missing")
  })

  test("#given an argument containing a space #when reviewed #then it stays one token instead of splitting into two", () => {
    const { root, authority } = workspace([declared({ command: ["bun", "test", "--grep", "a b"] })])
    const shown = reviewCandidate({ projectRoot: root, workspaceId: ".", changedFiles: null, authority, checkId: "unit-core" })
    if (shown.kind !== "review") throw new Error("expected a review")
    expect(shown.review.executable).toBe("bun")
    expect(shown.review.args).toEqual(["test", "--grep", "a b"])
    expect(shown.review.args.length).toBe(3)
  })

  test("#given a candidate #when reviewed #then executable, argv, cwd, timeout, scope and fingerprint are all shown", () => {
    const { root, authority } = workspace()
    const shown = reviewCandidate({ projectRoot: root, workspaceId: ".", changedFiles: null, authority, checkId: "unit-core" })
    if (shown.kind !== "review") throw new Error("expected a review")
    expect(shown.review.executable).toBe("bun")
    expect(shown.review.args).toEqual(["test"])
    expect(shown.review.cwd).toBe(".")
    expect(shown.review.timeoutMs).toBe(120_000)
    expect(shown.review.packageScope).toBe("fixture")
    expect(shown.review.workspaceId).toBe(".")
    expect(shown.review.checkId).toBe("unit-core")
    expect(shown.review.status).toBe("approval_required")
    expect(shown.review.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })
})
