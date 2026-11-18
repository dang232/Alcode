import { describe, expect, test } from "bun:test"
import {
  approvalFingerprint,
  classifyCandidates,
  isApproved,
  type ApprovalSubject,
  type OrdinaryCheckCandidate,
  type VerificationApproval,
} from "./approval"
import { approvalRequiredCatalogue, catalogueErrorCode, catalogueFrom } from "./catalogue"

function subject(overrides: Partial<ApprovalSubject> = {}): ApprovalSubject {
  return {
    workspaceId: "ws-alpha",
    checkId: "unit-core",
    command: ["node", "-e", "process.exit(0)"],
    cwd: "packages/web",
    packageScope: "@alcode/web",
    timeoutMs: 20_000,
    configVersion: 1,
    ...overrides,
  }
}

const approvalOf = (value: ApprovalSubject): VerificationApproval => ({
  fingerprint: approvalFingerprint(value),
  approvedAt: "2026-11-05T00:00:00.000Z",
})

describe("approval fingerprint", () => {
  test("#given an identical command #when fingerprinted twice #then the fingerprint is stable", () => {
    expect(approvalFingerprint(subject())).toBe(approvalFingerprint(subject()))
  })

  test("#given a changed argument #when fingerprinted #then the earlier approval no longer applies", () => {
    const approval = approvalOf(subject())
    const changed = subject({ command: ["node", "-e", "process.exit(1)"] })
    expect(approvalFingerprint(changed)).not.toBe(approval.fingerprint)
    expect(isApproved(changed, [approval])).toBe(false)
  })

  test("#given a changed executable #when fingerprinted #then the earlier approval no longer applies", () => {
    const approval = approvalOf(subject())
    const changed = subject({ command: ["bash", "-e", "process.exit(0)"] })
    expect(isApproved(changed, [approval])).toBe(false)
  })

  test("#given a changed working directory #when fingerprinted #then the earlier approval no longer applies", () => {
    const approval = approvalOf(subject())
    expect(isApproved(subject({ cwd: "packages/electron" }), [approval])).toBe(false)
  })

  test("#given the same command in another workspace #when checked #then the approval does not transfer", () => {
    const approval = approvalOf(subject())
    expect(isApproved(subject({ workspaceId: "ws-beta" }), [approval])).toBe(false)
  })

  test("#given a changed timeout #when checked #then the earlier approval no longer applies", () => {
    const approval = approvalOf(subject())
    expect(isApproved(subject({ timeoutMs: 60_000 }), [approval])).toBe(false)
  })

  test("#given arguments that would collide under naive joining #when fingerprinted #then they differ", () => {
    const joined = approvalFingerprint(subject({ command: ["a", "b"] }))
    const spaced = approvalFingerprint(subject({ command: ["a b"] }))
    expect(joined).not.toBe(spaced)
  })

  test("#given the exact approved command #when checked #then it is approved", () => {
    const approval = approvalOf(subject())
    expect(isApproved(subject(), [approval])).toBe(true)
  })
})

const CANDIDATE: OrdinaryCheckCandidate = {
  checkId: "unit-core",
  category: "unit",
  command: ["bun", "test"],
  cwd: "packages/web",
  packageScope: "@alcode/web",
  timeoutMs: 120_000,
  reason: "package declares a test script",
  source: "manifest",
  location: "packages/web/package.json#scripts.test",
  fingerprint: approvalFingerprint({
    workspaceId: "ws-alpha",
    checkId: "unit-core",
    command: ["bun", "test"],
    cwd: "packages/web",
    packageScope: "@alcode/web",
    timeoutMs: 120_000,
    configVersion: 1,
  }),
}

describe("candidates are proposals, not permissions", () => {
  test("#given a discovered candidate with no approval #when classified #then it is approval_required", () => {
    const result = classifyCandidates([CANDIDATE], [])
    expect(result.state).toBe("approval_required")
    expect(result.state === "approval_required" ? result.candidates.length : 0).toBe(1)
  })

  test("#given a candidate whose approval names another workspace #when classified #then it stays unapproved", () => {
    const foreign: VerificationApproval = {
      fingerprint: approvalFingerprint({
        workspaceId: "ws-beta",
        checkId: "unit-core",
        command: ["bun", "test"],
        cwd: "packages/web",
        packageScope: "@alcode/web",
        timeoutMs: 120_000,
        configVersion: 1,
      }),
      approvedAt: "2026-11-05T00:00:00.000Z",
    }
    expect(classifyCandidates([CANDIDATE], [foreign]).state).toBe("approval_required")
  })

  test("#given the exact approved candidate #when classified #then it is approved", () => {
    const approval: VerificationApproval = { fingerprint: CANDIDATE.fingerprint, approvedAt: "2026-11-05T00:00:00.000Z" }
    expect(classifyCandidates([CANDIDATE], [approval]).state).toBe("approved")
  })

  test("#given no candidates at all #when classified #then the state is none, not approval_required", () => {
    expect(classifyCandidates([], []).state).toBe("none")
  })
})

describe("catalogue approval semantics", () => {
  test("#given pending candidates #when built #then the code is approval_required, distinct from no-checks", () => {
    const pending = approvalRequiredCatalogue(["unit-core"])
    expect(catalogueErrorCode(pending)).toBe("verification_approval_required")
    expect(catalogueErrorCode(catalogueFrom([]))).toBe("verification_no_checks_configured")
  })
})
