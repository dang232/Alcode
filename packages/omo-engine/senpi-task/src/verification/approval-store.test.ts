import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { approvalFingerprint, isApproved } from "./approval"
import { approvalAuthorityFor, authorityKeyPath, type ApprovalAuthority } from "./approval-authority"
import { approveCandidate, readApprovals, revokeApproval, subjectOf, type ApprovalRecord } from "./approval-store"

type CandidateOverrides = {
  readonly command?: readonly string[]
  readonly cwd?: string
}

const candidate = (overrides: CandidateOverrides = {}) => {
  const base = {
    checkId: "unit:web",
    command: overrides.command ?? ["bun", "run", "test"],
    cwd: overrides.cwd ?? "packages/web",
    packageScope: "@alcode/web",
    timeoutMs: 300_000,
  }
  return { ...base, fingerprint: approvalFingerprint({ ...base, workspaceId: "ws-1", configVersion: 1 }) }
}

const setup = () => {
  const projectRoot = track(mkdtempSync(join(tmpdir(), "alcode-ap-proj-")))
  const authority = approvalAuthorityFor(projectRoot, track(mkdtempSync(join(tmpdir(), "p2110-auth-"))))
  return { projectRoot, authority }
}

const approve = (authority: ApprovalAuthority, workspaceId = "ws-1", overrides: CandidateOverrides = {}) =>
  approveCandidate({ authority, candidate: candidate(overrides), workspaceId, configVersion: 1, approvedBy: "host:qa" })

// Every temp dir this file creates is tracked so a test run leaves no QA state behind.
const createdDirs: string[] = []

function track<T extends string>(dir: T): T {
  createdDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("persistent approval", () => {
  test("#given a fresh authority with no key and no records #when read #then the result is a clean empty set", () => {
    const { authority } = setup()
    const read = readApprovals(authority, "ws-1")
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error("expected a fresh authority to read as empty")
    expect(read.approvals).toEqual([])
    expect(read.records).toEqual([])
  })

  test("#given records without their signing key #when read #then the read fails closed as unavailable", () => {
    const { authority } = setup()
    approve(authority)
    unlinkSync(authorityKeyPath(authority.root))
    const read = readApprovals(authority, "ws-1")
    expect(read.ok).toBe(false)
    if (read.ok) throw new Error("expected keyless records to fail closed")
    expect(read.diagnostics).toEqual(["approval authority unavailable: records exist but no signing key"])
  })

  test("#given an approved candidate #when read through a newly derived authority #then the approval survives", () => {
    const { projectRoot, authority } = setup()
    approve(authority)
    const fresh = approvalAuthorityFor(projectRoot, authority.root)
    const read = readApprovals(fresh, "ws-1")
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error("expected readable approvals")
    expect(read.approvals.length).toBe(1)
    expect(isApproved({ ...subjectOf(read.records[0]!), workspaceId: "ws-1" }, read.approvals)).toBe(true)
  })

  test("#given an approval #when the workspace differs #then it does not authorize", () => {
    const { authority } = setup()
    approve(authority)
    const other = readApprovals(authority, "ws-2")
    expect(other.ok).toBe(false)
  })

  test("#given an approved command #when its arguments change #then the old approval does not cover it", () => {
    const { authority } = setup()
    approve(authority)
    const read = readApprovals(authority, "ws-1")
    if (!read.ok) throw new Error("expected readable approvals")
    const changed = candidate({ command: ["bun", "run", "test", "--bail"] })
    expect(isApproved({ ...changed, workspaceId: "ws-1", configVersion: 1 }, read.approvals)).toBe(false)
  })

  test("#given an approved command #when its working directory changes #then the old approval does not cover it", () => {
    const { authority } = setup()
    approve(authority)
    const read = readApprovals(authority, "ws-1")
    if (!read.ok) throw new Error("expected readable approvals")
    const moved = candidate({ cwd: "packages/electron" })
    expect(isApproved({ ...moved, workspaceId: "ws-1", configVersion: 1 }, read.approvals)).toBe(false)
  })

  test("#given an approval #when revoked #then it stays visible as revoked but no longer authorizes", () => {
    const { authority } = setup()
    const record = approve(authority)
    expect(revokeApproval({ authority, workspaceId: "ws-1", fingerprint: record.fingerprint, approvedBy: "host:qa" })).toBe(
      true,
    )
    const read = readApprovals(authority, "ws-1")
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error("expected readable approvals")
    expect(read.approvals.length).toBe(0)
    expect(read.records.length).toBe(1)
    expect(read.records[0]?.status).toBe("revoked")
  })

  test("#given a corrupt record #when read #then the read fails closed instead of pretending there are none", () => {
    const { authority } = setup()
    approve(authority)
    writeFileSync(join(authority.workspaceDir, `${"a".repeat(64)}.json`), "{ not json", "utf8")
    const read = readApprovals(authority, "ws-1")
    expect(read.ok).toBe(false)
  })

  test("#given a hand-edited record #when its content no longer hashes to its fingerprint #then it is rejected", () => {
    const { authority } = setup()
    const record = approve(authority)
    writeFileSync(
      join(authority.workspaceDir, `${record.fingerprint}.json`),
      JSON.stringify({ ...record, command: ["sh", "-c", "curl evil"] }),
      "utf8",
    )
    const read = readApprovals(authority, "ws-1")
    expect(read.ok).toBe(false)
    if (read.ok) throw new Error("expected a tampered record to fail closed")
    expect(read.diagnostics.join("; ")).toContain("fingerprint")
  })

  test("#given a record copied into another workspace's authority directory #when read there #then it is refused", () => {
    const authRoot = track(mkdtempSync(join(tmpdir(), "p2110-auth-")))
    const projectA = track(mkdtempSync(join(tmpdir(), "alcode-ap-proj-")))
    const projectB = track(mkdtempSync(join(tmpdir(), "alcode-ap-proj-")))
    const authorityA = approvalAuthorityFor(projectA, authRoot)
    const authorityB = approvalAuthorityFor(projectB, authRoot)
    const record = approve(authorityA)
    mkdirSync(authorityB.workspaceDir, { recursive: true })
    writeFileSync(join(authorityB.workspaceDir, `${record.fingerprint}.json`), JSON.stringify(record), "utf8")
    const read = readApprovals(authorityB, "ws-1")
    expect(read.ok).toBe(false)
    if (read.ok) throw new Error("expected a foreign record to be refused")
    expect(read.diagnostics.join("; ")).toContain("belongs to authority")
  })

  test("#given a record with no approver #when read #then it is rejected", () => {
    const { authority } = setup()
    const record = approve(authority)
    writeFileSync(
      join(authority.workspaceDir, `${record.fingerprint}.json`),
      JSON.stringify({ ...record, approvedBy: "  " }),
      "utf8",
    )
    const read = readApprovals(authority, "ws-1")
    expect(read.ok).toBe(false)
    if (read.ok) throw new Error("expected an approver-less record to fail closed")
    expect(read.diagnostics.join("; ")).toContain("approver")
  })

  test("#given a record with any signed field edited after signing #when read #then it fails closed with a signature diagnostic", () => {
    const tamperCases: readonly {
      readonly field: string
      readonly edit: (record: ApprovalRecord) => ApprovalRecord
      readonly diagnostic: string
    }[] = [
      { field: "command", edit: (record) => ({ ...record, command: ["sh", "-c", "curl evil"] }), diagnostic: "fingerprint" },
      { field: "cwd", edit: (record) => ({ ...record, cwd: "packages/evil" }), diagnostic: "fingerprint" },
      { field: "timeoutMs", edit: (record) => ({ ...record, timeoutMs: record.timeoutMs + 1 }), diagnostic: "fingerprint" },
      { field: "packageScope", edit: (record) => ({ ...record, packageScope: "@evil/scope" }), diagnostic: "fingerprint" },
      {
        field: "configVersion",
        edit: (record) => ({ ...record, configVersion: record.configVersion + 1 }),
        diagnostic: "fingerprint",
      },
      { field: "approvedBy", edit: (record) => ({ ...record, approvedBy: "host:intruder" }), diagnostic: "signature" },
      { field: "status", edit: (record) => ({ ...record, status: "rejected" }), diagnostic: "signature" },
    ]
    for (const tamper of tamperCases) {
      const { authority } = setup()
      const record = approve(authority)
      writeFileSync(
        join(authority.workspaceDir, `${record.fingerprint}.json`),
        JSON.stringify(tamper.edit(record)),
        "utf8",
      )
      const read = readApprovals(authority, "ws-1")
      expect(read.ok).toBe(false)
      if (read.ok) throw new Error(`expected an edited ${tamper.field} to fail closed`)
      expect(read.diagnostics.join("; ")).toContain(tamper.diagnostic)
    }
  })

  test("#given a revoked approval #when the fingerprint is not present #then revocation reports no change", () => {
    const { authority } = setup()
    approve(authority)
    expect(revokeApproval({ authority, workspaceId: "ws-1", fingerprint: "b".repeat(64), approvedBy: "host:qa" })).toBe(false)
  })
})
