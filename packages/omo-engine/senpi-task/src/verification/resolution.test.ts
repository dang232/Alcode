import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { approvalAuthorityFor, type ApprovalAuthority } from "./approval-authority"
import { approveCandidate } from "./approval-store"
import { catalogueChecks, catalogueErrorCode } from "./catalogue"
import { VERIFICATION_CONFIG_PATH } from "./config"
import { candidateForApproval, resolveCatalogue } from "./resolution"

function workspace(options: { config?: unknown; scripts?: Record<string, string> } = {}): string {
  const root = track(mkdtempSync(join(tmpdir(), "alcode-res-")))
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: options.scripts ?? {} }), "utf8")
  if (options.config !== undefined) {
    mkdirSync(join(root, ".alcode"), { recursive: true })
    writeFileSync(join(root, ...VERIFICATION_CONFIG_PATH.split("/")), JSON.stringify(options.config), "utf8")
  }
  return root
}

const authorityFor = (root: string): ApprovalAuthority =>
  approvalAuthorityFor(root, track(mkdtempSync(join(tmpdir(), "p2110-auth-"))))

const baseDeclared = {
  id: "unit-core",
  name: "Core unit tests",
  category: "unit",
  command: ["bun", "test"],
  cwd: ".",
  packageScope: "fixture",
  timeoutMs: 120_000,
  required: true,
}

const declaredCheck = (overrides: Partial<typeof baseDeclared> = {}) => ({ ...baseDeclared, ...overrides })

const explicit = (checks: readonly object[]) => ({ version: 1, checks })

function approveFrom(root: string, authority: ApprovalAuthority, checkId: string, workspaceId = "ws-1"): void {
  const candidate = candidateForApproval({ projectRoot: root, workspaceId, changedFiles: null, checkId })
  if (candidate === null) throw new Error(`no candidate ${checkId}`)
  approveCandidate({ authority, candidate, workspaceId, configVersion: 1, approvedBy: "host:qa" })
}

// Every temp dir this file creates is tracked so a test run leaves no QA state behind.
const createdDirs: string[] = []

function track<T extends string>(dir: T): T {
  createdDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("catalogue resolution precedence", () => {
  test("#given no configuration and no scripts #when resolved #then no-checks is the outcome", () => {
    const root = workspace()
    const authority = authorityFor(root)
    const catalogue = resolveCatalogue({ projectRoot: root, workspaceId: "ws-1", changedFiles: null, authority })
    expect(catalogue.status).toBe("none")
    expect(catalogueErrorCode(catalogue)).toBe("verification_no_checks_configured")
    expect(catalogueChecks(catalogue)).toEqual([])
  })

  test("#given no package manifest #when resolved #then the ecosystem is unsupported", () => {
    const root = track(mkdtempSync(join(tmpdir(), "alcode-res-bare-")))
    const authority = authorityFor(root)
    expect(resolveCatalogue({ projectRoot: root, workspaceId: "ws-1", changedFiles: null, authority }).status).toBe(
      "unsupported",
    )
  })

  test("#given manifest scripts and no approval #when resolved #then the outcome is approval_required", () => {
    const root = workspace({ scripts: { test: "bun test" } })
    const authority = authorityFor(root)
    const catalogue = resolveCatalogue({ projectRoot: root, workspaceId: "ws-1", changedFiles: null, authority })
    expect(catalogue.status).toBe("approval_required")
    expect(catalogueErrorCode(catalogue)).toBe("verification_approval_required")
    expect(catalogueChecks(catalogue)).toEqual([])
  })

  test("#given one approved manifest candidate #when resolved #then only that candidate becomes executable", () => {
    const root = workspace({ scripts: { test: "bun test", lint: "bunx oxlint" } })
    const authority = authorityFor(root)
    approveFrom(root, authority, "unit:root")
    const catalogue = resolveCatalogue({ projectRoot: root, workspaceId: "ws-1", changedFiles: null, authority })
    expect(catalogue.status).toBe("configured")
    expect(catalogueChecks(catalogue).map((check) => check.checkId)).toEqual(["unit:root"])
  })

  test("#given an explicit configuration with no approval #when resolved #then it is approval_required, not configured", () => {
    const root = workspace({ config: explicit([declaredCheck()]) })
    const authority = authorityFor(root)
    const catalogue = resolveCatalogue({ projectRoot: root, workspaceId: "ws-1", changedFiles: null, authority })
    expect(catalogue.status).toBe("approval_required")
  })

  test("#given an approved explicit configuration #when resolved #then the declared check is executable", () => {
    const root = workspace({ config: explicit([declaredCheck()]) })
    const authority = authorityFor(root)
    approveFrom(root, authority, "unit-core")
    const catalogue = resolveCatalogue({ projectRoot: root, workspaceId: "ws-1", changedFiles: null, authority })
    expect(catalogue.status).toBe("configured")
    const checks = catalogueChecks(catalogue)
    expect(checks.length).toBe(1)
    expect(checks[0]?.command).toEqual(["bun", "test"])
    expect(checks[0]?.category).toBe("unit")
  })

  test("#given an invalid configuration and runnable package scripts #when resolved #then it is invalid and never falls back", () => {
    const root = workspace({ config: explicit([declaredCheck({ cwd: "../escape" })]), scripts: { test: "bun test" } })
    const authority = authorityFor(root)
    const catalogue = resolveCatalogue({ projectRoot: root, workspaceId: "ws-1", changedFiles: null, authority })
    expect(catalogue.status).toBe("invalid")
    expect(catalogueErrorCode(catalogue)).toBe("verification_catalogue_invalid")
    expect(catalogueChecks(catalogue)).toEqual([])
  })

  test("#given an approval granted in another workspace #when resolved here #then it does not authorize", () => {
    const root = workspace({ config: explicit([declaredCheck()]) })
    const authority = authorityFor(root)
    approveFrom(root, authority, "unit-core", "ws-other")
    const catalogue = resolveCatalogue({ projectRoot: root, workspaceId: "ws-1", changedFiles: null, authority })
    expect(catalogue.status).toBe("invalid")
    expect(catalogueErrorCode(catalogue)).toBe("verification_catalogue_invalid")
    expect(catalogueChecks(catalogue)).toEqual([])
  })

  test("#given a corrupt approval store #when resolved #then it fails closed as invalid, not as no-checks", () => {
    const root = workspace({ config: explicit([declaredCheck()]) })
    const authority = authorityFor(root)
    approveFrom(root, authority, "unit-core")
    writeFileSync(join(authority.workspaceDir, `${"c".repeat(64)}.json`), "{ broken", "utf8")
    const catalogue = resolveCatalogue({ projectRoot: root, workspaceId: "ws-1", changedFiles: null, authority })
    expect(catalogue.status).toBe("invalid")
    expect(catalogueErrorCode(catalogue)).toBe("verification_catalogue_invalid")
    expect(catalogueChecks(catalogue)).toEqual([])
  })

  test("#given a configuration that changed after approval #when resolved #then the old approval no longer applies", () => {
    const root = workspace({ config: explicit([declaredCheck()]) })
    const authority = authorityFor(root)
    approveFrom(root, authority, "unit-core")
    writeFileSync(
      join(root, ...VERIFICATION_CONFIG_PATH.split("/")),
      JSON.stringify(explicit([declaredCheck({ command: ["bun", "test", "--bail"] })])),
      "utf8",
    )
    const catalogue = resolveCatalogue({ projectRoot: root, workspaceId: "ws-1", changedFiles: null, authority })
    expect(catalogue.status).toBe("approval_required")
  })
})
