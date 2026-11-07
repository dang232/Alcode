// Adversarial proof that the host-authority approval store defeats workspace forgery.
//
// Threat model: .omo/ulw/p2110-threat-model.md. The child runs as the same OS user as the
// host, so it can write anywhere in the project tree - and anywhere else it can reach. What
// it cannot do is mint authority: records live under a host-owned root outside every
// workspace, are scoped by an authority id derived from the workspace's real path, and are
// authenticated by an HMAC key only a recording action creates. Every test below builds the
// mounted worker tool exactly the way production does, executes it, and proves the outcome
// twice: once through the tool result (`isError`) and once through the marker file the
// check command would have written outside the workspace. A refusal message alone is never
// the signal; the marker state is.
//
// Production code is FINAL: this file only reads it, never changes it.
import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTaskRecord, type TaskRecord } from "../state"
import { approvalAuthorityFor, authorityKeyPath, type ApprovalAuthority } from "./approval-authority"
import { approveVerificationCandidate } from "./approval-service"
import { readApprovals, revokeApproval, type ApprovalRecord } from "./approval-store"
import { VERIFICATION_CONFIG_VERSION } from "./config"
import { snapshotWorkspace } from "./run-provenance"
import { createWorkerVerificationTool } from "./worker-tool-factory"
import type { VerifyTool } from "./verify-tool"

const CHECK_ID = "unit-core"
const WORKSPACE_ID = "."

const tempRoots: string[] = []

function track(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function gitInit(workspace: string): void {
  execFileSync("git", ["-C", workspace, "init"], { stdio: "pipe" })
  execFileSync("git", ["-C", workspace, "add", "-A"], { stdio: "pipe" })
  execFileSync(
    "git",
    [
      "-C",
      workspace,
      "-c",
      "user.email=p2110-adv@example.com",
      "-c",
      "user.name=p2110-adv",
      "commit",
      "-m",
      "fixture",
      "--quiet",
    ],
    { stdio: "pipe" },
  )
}

// The single declared check writes a marker OUTSIDE the workspace, so the proof file can
// never pollute the provenance snapshot or the git tree the baseline covers.
function markerCommand(marker: string): string[] {
  return ["node", "-e", "require('node:fs').writeFileSync(process.argv[1],'ran')", marker]
}

function writeCheckConfig(workspace: string, command: string[]): void {
  mkdirSync(join(workspace, ".alcode"), { recursive: true })
  writeFileSync(
    join(workspace, ".alcode", "verification.json"),
    JSON.stringify({
      version: VERIFICATION_CONFIG_VERSION,
      checks: [{ id: CHECK_ID, name: "core unit check", category: "unit", command }],
    }),
  )
}

function makeWorkspace(marker: string): string {
  const workspace = track("p2110-adv-work-")
  writeCheckConfig(workspace, markerCommand(marker))
  gitInit(workspace)
  return workspace
}

function freshMarker(): string {
  return join(track("p2110-adv-marker-"), "marker.txt")
}

function makeAuthority(workspace: string): ApprovalAuthority {
  return approvalAuthorityFor(workspace, track("p2110-adv-auth-"))
}

function freshEvidenceRoot(): string {
  return join(track("p2110-adv-evidence-"), "verifications")
}

function liveRecord(projectRoot: string): TaskRecord {
  const base = createTaskRecord({
    parent_session_id: "p2110-adv-parent",
    root_session_id: "p2110-adv-root",
    depth: 1,
    execution_mode: "in-process",
    model: "test/model",
    notify_on_terminal: false,
  })
  return {
    ...base,
    notification: { ...base.notification, run_epoch: 1 },
    spawn_spec: { version: 1 as const, cwd: projectRoot, prompt: "verify the work" },
  }
}

function buildTool(
  workspace: string,
  authority: ApprovalAuthority,
  record: TaskRecord,
  evidenceRoot: string,
): VerifyTool {
  return createWorkerVerificationTool({
    taskId: record.task_id,
    projectRoot: workspace,
    authority,
    evidenceRoot,
    record: () => record,
    baseline: snapshotWorkspace(workspace),
    isCancelled: () => false,
  })
}

// The host's own approval action. The fixed synthetic principal here exercises the
// mechanism only; no test in this file treats it as a human authorization.
function approveHostCheck(workspace: string, authority: ApprovalAuthority): ApprovalRecord {
  const outcome = approveVerificationCandidate({
    projectRoot: workspace,
    workspaceId: WORKSPACE_ID,
    changedFiles: [],
    authority,
    checkId: CHECK_ID,
    principal: { sub: "human-1" },
  })
  expect(outcome.ok).toBe(true)
  if (!outcome.ok) throw new Error("p2110-adv: the host approval failed during setup")
  return outcome.record
}

function recordFile(authority: ApprovalAuthority, fingerprint: string): string {
  return join(authority.workspaceDir, `${fingerprint}.json`)
}

function linkDirectory(link: string, target: string): void {
  if (process.platform === "win32") {
    execFileSync("cmd", ["/c", "mklink", "/J", link, target], { stdio: "pipe" })
  } else {
    symlinkSync(target, link)
  }
}

// Refused executions still take seconds (git attribution, node startup), and case B runs
// six of them in one test: every test below carries an explicit upper bound so a slow
// machine fails loudly instead of tripping bun's 5s default mid-iteration.
const TEST_TIMEOUT_MS = 60000

describe("approval authority adversarial suite", () => {
  test("[A1] #given a forged authority record with a matching fingerprint but no MAC #when the tool executes #then it refuses as catalogue_invalid and the marker is absent", async () => {
    // given a key established by the real host action, with the real record removed
    const marker = freshMarker()
    const workspace = makeWorkspace(marker)
    const authority = makeAuthority(workspace)
    const legit = approveHostCheck(workspace, authority)
    rmSync(recordFile(authority, legit.fingerprint))

    // when the child plants a self-consistent record it cannot sign
    mkdirSync(authority.workspaceDir, { recursive: true })
    writeFileSync(
      recordFile(authority, legit.fingerprint),
      JSON.stringify({ ...legit, mac: "0".repeat(64) }),
    )
    const result = await buildTool(workspace, authority, liveRecord(workspace), freshEvidenceRoot()).execute()

    // then the MAC check refuses it and the command never runs
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_catalogue_invalid")
    expect(existsSync(marker)).toBe(false)
  }, TEST_TIMEOUT_MS)

  test("[A2] #given a fully valid record planted in the project approvals path #when the tool executes #then the project path is dead and the marker is absent", async () => {
    // given an authority whose key exists but holds no records
    const marker = freshMarker()
    const workspace = makeWorkspace(marker)
    const authority = makeAuthority(workspace)
    const legit = approveHostCheck(workspace, authority)
    rmSync(recordFile(authority, legit.fingerprint))

    // when even a byte-valid record is planted where the old store used to live
    const plantDir = join(workspace, ".alcode", "approvals", "planted")
    mkdirSync(plantDir, { recursive: true })
    writeFileSync(join(plantDir, `${legit.fingerprint}.json`), JSON.stringify(legit))
    const result = await buildTool(workspace, authority, liveRecord(workspace), freshEvidenceRoot()).execute()

    // then nothing outside the authority counts, so approval is still required
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_approval_required")
    expect(existsSync(marker)).toBe(false)
  }, TEST_TIMEOUT_MS)

  test("[B] #given a legitimate approval with one field edited in place #when the tool executes #then every edit refuses as catalogue_invalid and the marker is absent", async () => {
    // given one real approval whose file the child can rewrite
    const marker = freshMarker()
    const workspace = makeWorkspace(marker)
    const authority = makeAuthority(workspace)
    const record = liveRecord(workspace)
    const evidenceRoot = freshEvidenceRoot()
    const legit = approveHostCheck(workspace, authority)
    const file = recordFile(authority, legit.fingerprint)
    const edits: ApprovalRecord[] = [
      { ...legit, command: ["node", "-e", "require('node:fs').writeFileSync('pwned','x')"] },
      { ...legit, cwd: "elsewhere" },
      { ...legit, timeoutMs: 61000 },
      { ...legit, packageScope: "evil-scope" },
      { ...legit, configVersion: 2 },
      { ...legit, approvedBy: "alcode:attacker" },
    ]

    // when each edited body is the only record on disk
    for (const edited of edits) {
      approveHostCheck(workspace, authority)
      writeFileSync(file, JSON.stringify(edited))
      const result = await buildTool(workspace, authority, record, evidenceRoot).execute()

      // then the fingerprint or the MAC check refuses it and nothing runs
      expect(result.isError).toBe(true)
      expect(result.details.error?.code).toBe("verification_catalogue_invalid")
      expect(existsSync(marker)).toBe(false)
    }
  }, TEST_TIMEOUT_MS)

  test("[C] #given a legitimate-shaped record written after the tool was built #when the tool executes #then the spawn-time snapshot still refuses and the marker is absent", async () => {
    // given an authority with a key but no records, frozen into the tool at build time
    const marker = freshMarker()
    const workspace = makeWorkspace(marker)
    const authority = makeAuthority(workspace)
    const legit = approveHostCheck(workspace, authority)
    const file = recordFile(authority, legit.fingerprint)
    rmSync(file)
    const tool = buildTool(workspace, authority, liveRecord(workspace), freshEvidenceRoot())

    // when the child writes a legitimate-shaped record from disk mid-run
    writeFileSync(file, JSON.stringify({ ...legit, mac: "0".repeat(64) }))
    const result = await tool.execute()

    // then the snapshot taken at spawn knows nothing about it
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_approval_required")
    expect(existsSync(marker)).toBe(false)
  }, TEST_TIMEOUT_MS)

  test("[D] #given a record replayed from workspace X into workspace Y #when the tool executes in Y #then both the authority copy and the project copy refuse and neither marker appears", async () => {
    // given a legitimate approval in workspace X
    const markerX = freshMarker()
    const workspaceX = makeWorkspace(markerX)
    const authorityX = makeAuthority(workspaceX)
    const legitX = approveHostCheck(workspaceX, authorityX)
    const stolen = readFileSync(recordFile(authorityX, legitX.fingerprint), "utf8")

    // and workspace Y with its own authority, key established, records cleared
    const markerY = freshMarker()
    const workspaceY = makeWorkspace(markerY)
    const authorityY = makeAuthority(workspaceY)
    const legitY = approveHostCheck(workspaceY, authorityY)
    rmSync(recordFile(authorityY, legitY.fingerprint))

    // when X's record is replayed into Y's authority directory
    writeFileSync(recordFile(authorityY, legitX.fingerprint), stolen)
    const replayed = await buildTool(workspaceY, authorityY, liveRecord(workspaceY), freshEvidenceRoot()).execute()

    // then the authority binding rejects it and nothing runs anywhere
    expect(replayed.isError).toBe(true)
    expect(replayed.details.error?.code).toBe("verification_catalogue_invalid")
    expect(existsSync(markerY)).toBe(false)
    expect(existsSync(markerX)).toBe(false)

    // when the same bytes are replayed into Y's own project approvals path instead
    rmSync(recordFile(authorityY, legitX.fingerprint))
    const plantDir = join(workspaceY, ".alcode", "approvals", "replay")
    mkdirSync(plantDir, { recursive: true })
    writeFileSync(join(plantDir, `${legitX.fingerprint}.json`), stolen)
    const projectReplay = await buildTool(
      workspaceY,
      authorityY,
      liveRecord(workspaceY),
      freshEvidenceRoot(),
    ).execute()

    // then the project path is dead too and nothing runs anywhere
    expect(projectReplay.isError).toBe(true)
    expect(projectReplay.details.error?.code).toBe("verification_approval_required")
    expect(existsSync(markerY)).toBe(false)
    expect(existsSync(markerX)).toBe(false)
  }, TEST_TIMEOUT_MS)

  test("[E] #given an approved check whose config changed afterwards #when the tool executes #then the old approval no longer matches and the marker is absent", async () => {
    // given a legitimate approval for the declared argv
    const marker = freshMarker()
    const workspace = makeWorkspace(marker)
    const authority = makeAuthority(workspace)
    approveHostCheck(workspace, authority)

    // when the candidate changes into a different argv under the same check id
    writeCheckConfig(workspace, [...markerCommand(marker), "--changed"])
    const result = await buildTool(workspace, authority, liveRecord(workspace), freshEvidenceRoot()).execute()

    // then the stale approval authorizes nothing and the new command never runs
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_approval_required")
    expect(existsSync(marker)).toBe(false)

    // and the old approval is still intact: the refusal is staleness, not disappearance
    const read = readApprovals(authority, WORKSPACE_ID)
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error("p2110-adv: expected a readable authority")
    expect(read.approvals.length).toBe(1)
  }, TEST_TIMEOUT_MS)

  test("[F] #given a symlinked workspace spelling and a project-internal link to the authority #when authorization is attempted through either #then both refuse and the marker is absent", async () => {
    // given a legitimately approved workspace
    const marker = freshMarker()
    const workspace = makeWorkspace(marker)
    const authority = makeAuthority(workspace)
    approveHostCheck(workspace, authority)

    // when the same tree is addressed through an alias spelling (junction on Windows)
    const alias = join(track("p2110-adv-alias-"), "alias-work")
    linkDirectory(alias, workspace)
    const viaAlias = approvalAuthorityFor(alias, authority.root)

    // then the alias binds a DIFFERENT authority, so the real approval does not transfer
    expect(viaAlias.authorityId === authority.authorityId).toBe(false)
    expect(viaAlias.workspaceDir === authority.workspaceDir).toBe(false)
    const aliased = await buildTool(alias, viaAlias, liveRecord(alias), freshEvidenceRoot()).execute()
    expect(aliased.isError).toBe(true)
    expect(aliased.details.error?.code).toBe("verification_approval_required")
    expect(existsSync(marker)).toBe(false)

    // when a project-internal link reaches the live authority directory instead
    const link = join(workspace, "auth-link")
    linkDirectory(link, authority.root)
    const current = approveHostCheck(workspace, authority)
    mkdirSync(join(link, authority.authorityId), { recursive: true })
    writeFileSync(
      join(link, authority.authorityId, `${current.fingerprint}.json`),
      JSON.stringify({ ...current, mac: "0".repeat(64) }),
    )
    const smuggled = await buildTool(workspace, authority, liveRecord(workspace), freshEvidenceRoot()).execute()

    // then reaching the directory is not signing power: the plant is refused wholesale
    expect(smuggled.isError).toBe(true)
    expect(smuggled.details.error?.code).toBe("verification_catalogue_invalid")
    expect(existsSync(marker)).toBe(false)
  }, TEST_TIMEOUT_MS)

  test("[G] #given a legitimate approval #when a brand new tool instance reads the same authority #then the command executes and the marker exists", async () => {
    // given a real approval durable in the authority
    const marker = freshMarker()
    const workspace = makeWorkspace(marker)
    const authority = makeAuthority(workspace)
    approveHostCheck(workspace, authority)

    // when the first instance is dropped unexecuted and a new one reads the same root
    buildTool(workspace, authority, liveRecord(workspace), freshEvidenceRoot())
    const restarted = buildTool(workspace, authority, liveRecord(workspace), freshEvidenceRoot())
    const result = await restarted.execute()

    // then the approval survived the restart and the command really ran
    expect(result.isError).toBe(false)
    expect(existsSync(marker)).toBe(true)
    expect(readFileSync(marker, "utf8")).toBe("ran")
  }, TEST_TIMEOUT_MS)

  test("[H] #given a revoked approval #when the tool executes #then it refuses as approval_required and the marker is absent", async () => {
    // given a real approval that the host then revokes
    const marker = freshMarker()
    const workspace = makeWorkspace(marker)
    const authority = makeAuthority(workspace)
    const legit = approveHostCheck(workspace, authority)
    expect(
      revokeApproval({
        authority,
        workspaceId: WORKSPACE_ID,
        fingerprint: legit.fingerprint,
        approvedBy: "alcode:human-1",
      }),
    ).toBe(true)

    // when the tool executes after revocation
    const result = await buildTool(workspace, authority, liveRecord(workspace), freshEvidenceRoot()).execute()

    // then the revocation holds and nothing runs
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_approval_required")
    expect(existsSync(marker)).toBe(false)
  }, TEST_TIMEOUT_MS)

  test("[I1] #given a deleted authority key #when the tool executes #then every read fails closed and the marker is absent", async () => {
    // given a real approval whose signing key is then destroyed
    const marker = freshMarker()
    const workspace = makeWorkspace(marker)
    const authority = makeAuthority(workspace)
    approveHostCheck(workspace, authority)
    rmSync(authorityKeyPath(authority.root))

    // when the tool executes with no key to verify against
    const result = await buildTool(workspace, authority, liveRecord(workspace), freshEvidenceRoot()).execute()

    // then the missing key is unavailability, never an empty approval set: records exist
    // but the key that authenticated them is gone, so the read fails closed by name
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_catalogue_invalid")
    expect(result.details.error?.message).toContain("records exist but no signing key")
    expect(existsSync(marker)).toBe(false)
  }, TEST_TIMEOUT_MS)

  test("[I2] #given garbage bytes in an approval record #when the tool executes #then the read fails closed and the marker is absent", async () => {
    // given a real approval whose file is then corrupted
    const marker = freshMarker()
    const workspace = makeWorkspace(marker)
    const authority = makeAuthority(workspace)
    const legit = approveHostCheck(workspace, authority)
    writeFileSync(recordFile(authority, legit.fingerprint), "{ not json\n")

    // when the tool executes over the corrupt store
    const result = await buildTool(workspace, authority, liveRecord(workspace), freshEvidenceRoot()).execute()

    // then one bad record blocks the catalogue instead of being skipped
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_catalogue_invalid")
    expect(existsSync(marker)).toBe(false)
  }, TEST_TIMEOUT_MS)

  test("[I3] #given the authority workspace path replaced by a plain file #when the tool executes #then it refuses without a throw escaping as success", async () => {
    // given a real approval whose workspace directory is then replaced by a file
    const marker = freshMarker()
    const workspace = makeWorkspace(marker)
    const authority = makeAuthority(workspace)
    approveHostCheck(workspace, authority)
    rmSync(authority.workspaceDir, { recursive: true })
    writeFileSync(authority.workspaceDir, "a file, not a directory\n")

    // when the tool executes, the call itself must settle as a refusal, not throw
    const result = await buildTool(workspace, authority, liveRecord(workspace), freshEvidenceRoot()).execute()

    // then the unreadable authority fails closed and nothing runs
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_catalogue_invalid")
    expect(existsSync(marker)).toBe(false)
  }, TEST_TIMEOUT_MS)

  test("[J1] #given the host approval action with a verified principal #when the tool executes #then the command executes and the marker exists", async () => {
    // MECHANISM TEST ONLY: this synthetic principal exercises the host action's
    // plumbing. It is not a claim that a human authorized anything.
    const marker = freshMarker()
    const workspace = makeWorkspace(marker)
    const authority = makeAuthority(workspace)
    const outcome = approveVerificationCandidate({
      projectRoot: workspace,
      workspaceId: WORKSPACE_ID,
      changedFiles: [],
      authority,
      checkId: CHECK_ID,
      principal: { sub: "human-1" },
    })
    expect(outcome.ok).toBe(true)

    // when the tool executes under the granted approval
    const result = await buildTool(workspace, authority, liveRecord(workspace), freshEvidenceRoot()).execute()

    // then the supported path authorizes and the command really ran
    expect(result.isError).toBe(false)
    expect(existsSync(marker)).toBe(true)
    expect(readFileSync(marker, "utf8")).toBe("ran")
  }, TEST_TIMEOUT_MS)

  test("[J2] #given the host approval action with an empty principal #when approval is attempted #then it is denied, writes nothing, and the marker is absent", async () => {
    // given an approval attempt with no verified principal
    const marker = freshMarker()
    const workspace = makeWorkspace(marker)
    const authority = makeAuthority(workspace)
    const outcome = approveVerificationCandidate({
      projectRoot: workspace,
      workspaceId: WORKSPACE_ID,
      changedFiles: [],
      authority,
      checkId: CHECK_ID,
      principal: { sub: "" },
    })

    // then the action is denied and no authority state appears on disk
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("p2110-adv: an empty principal was authorized")
    expect(outcome.code).toBe("approval_denied")
    expect(existsSync(authority.workspaceDir)).toBe(false)

    // and the tool still refuses with nothing executed: no key and no records is simply
    // "nothing is approved", the calm branch of the same distinction I1 pins by name
    const result = await buildTool(workspace, authority, liveRecord(workspace), freshEvidenceRoot()).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_approval_required")
    expect(existsSync(marker)).toBe(false)
  }, TEST_TIMEOUT_MS)
})
