import { afterAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { approveVerificationCandidate } from "../../../../senpi-task/src/verification/approval-service"
import { WORKSPACE_ID } from "../../../../senpi-task/src/verification/resolution"
import { verifyRunChanges } from "./run-verification"

const roots: string[] = []
const originalAgentDir = process.env.OMO_CODING_AGENT_DIR
const originalAuthority = process.env.ALCODE_APPROVAL_AUTHORITY_DIR

function prepare(label: string) {
  const root = mkdtempSync(join(tmpdir(), "omo-run-verification-"))
  roots.push(root)
  const project = join(root, label)
  const agentDir = join(root, "agent")
  const authority = join(root, "authority")
  mkdirSync(join(project, ".alcode"), { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(authority, { recursive: true })
  process.env.OMO_CODING_AGENT_DIR = agentDir
  process.env.ALCODE_APPROVAL_AUTHORITY_DIR = authority
  return { project, agentDir }
}

function writeConfig(project: string, exitCode: number): void {
  writeFileSync(
    join(project, ".alcode", "verification.json"),
    JSON.stringify({
      version: 1,
      checks: [
        {
          id: "check-unit",
          name: "unit",
          category: "unit",
          command: [process.execPath, "-e", `process.exit(${exitCode})`],
        },
      ],
    }),
  )
}

function approve(project: string, checkId = "check-unit") {
  return approveVerificationCandidate({
    projectRoot: project,
    workspaceId: WORKSPACE_ID,
    changedFiles: ["src/a.ts"],
    checkId,
    principal: { sub: "qa-fixture" },
  })
}

function capture(label: string, payload: unknown): void {
  const dir = process.env.OMO_DELIVERY_EVIDENCE_DIR
  if (dir === undefined) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `c2-${label}.json`), JSON.stringify(payload, null, 1))
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  if (originalAgentDir === undefined) delete process.env.OMO_CODING_AGENT_DIR
  else process.env.OMO_CODING_AGENT_DIR = originalAgentDir
  if (originalAuthority === undefined) delete process.env.ALCODE_APPROVAL_AUTHORITY_DIR
  else process.env.ALCODE_APPROVAL_AUTHORITY_DIR = originalAuthority
})

const runInput = (project: string) => ({
  directory: project,
  taskId: "st_01a1d400",
  sessionId: "ses_c2_fixture",
  epoch: 0,
  changedPaths: ["src/a.ts"],
})

describe("verifyRunChanges", () => {
  it("verifies a run whose approved check passes", async () => {
    const { project } = prepare("verified")
    writeConfig(project, 0)
    const approved = approve(project)
    expect(approved.ok).toBe(true)

    const result = await verifyRunChanges(runInput(project))
    capture("verified", { input: runInput(project), result, approved })

    expect(result.verification).toBe("verified")
    expect(result.evidencePaths.length).toBeGreaterThan(0)
  }, 60000)

  it("blocks a run whose approved check fails", async () => {
    const { project } = prepare("blocked")
    writeConfig(project, 1)
    const approved = approve(project)
    expect(approved.ok).toBe(true)

    const result = await verifyRunChanges(runInput(project))
    capture("blocked", { input: runInput(project), result, approved })

    expect(result.verification).toBe("blocked")
    expect(result.evidencePaths.length).toBeGreaterThan(0)
  }, 60000)

  it("never verifies when a declared check has no approval", async () => {
    const { project } = prepare("unapproved")
    writeConfig(project, 0)

    const result = await verifyRunChanges(runInput(project))
    capture("unapproved", { input: runInput(project), result })

    expect(result.verification).toBe("unverified")
    expect(result.evidencePaths).toHaveLength(0)
    expect(result.reason ?? "").toContain("approved")
  }, 60000)
})
