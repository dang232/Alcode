import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DagVerifyCheck } from "../dag/verification"
import {
  catalogueChecks,
  catalogueErrorCode,
  catalogueFrom,
  type OrdinaryCatalogue,
  type OrdinaryCheck,
} from "./catalogue"
import { createOrdinaryVerificationCapture, type OrdinaryEvidenceStore } from "./ordinary-capture"
import { createVerificationWorkerTool } from "./verify-tool"

const UNIT: DagVerifyCheck = {
  checkId: "unit-core",
  category: "unit",
  command: ["node", "-e", "process.exit(0)"],
  timeoutMs: 20_000,
  criteria: ["core tests pass"],
}

const ENTRY: OrdinaryCheck = {
  check: UNIT,
  provenance: { source: "manifest", location: "package.json#scripts.test", reason: "package declares a test script" },
}

function configuredCatalogue(): OrdinaryCatalogue {
  return { status: "configured", checks: [ENTRY] }
}

function tempStore() {
  const root = mkdtempSync(join(tmpdir(), "catalogue-"))
  const dir = (runId: string) => join(root, "verifications", runId)
  return {
    root,
    store: {
      writeVerification(runId, _nodeId, checkId, _attempt, record) {
        mkdirSync(dir(runId), { recursive: true })
        const target = join(dir(runId), `run.${checkId}.1.json`)
        writeFileSync(target, record)
        return target
      },
      readVerification(runId, _nodeId, checkId) {
        const target = join(dir(runId), `run.${checkId}.1.json`)
        return existsSync(target) ? readFileSync(target, "utf8") : null
      },
      listVerifications(runId) {
        return existsSync(dir(runId)) ? readdirSync(dir(runId)) : []
      },
    },
  }
}

function toolWith(
  store: OrdinaryEvidenceStore,
  catalogue: OrdinaryCatalogue,
  changedFiles: readonly string[] | null = ["src/a.ts"],
) {
  const capture = createOrdinaryVerificationCapture({ store, projectDir: process.cwd(), currentRevision: () => "rev-1" })
  return createVerificationWorkerTool({
    capture,
    binding: () => ({ runId: "run-c", sessionId: "sess-c", epoch: 1 }),
    changedFiles: () => changedFiles,
    catalogue: () => catalogue,
  })
}

describe("ordinary catalogue contract", () => {
  test("#given no declared checks #when built #then the catalogue is none and maps to a configuration error", () => {
    const catalogue = catalogueFrom([])
    expect(catalogue.status).toBe("none")
    expect(catalogueErrorCode(catalogue)).toBe("verification_no_checks_configured")
    expect(catalogueChecks(catalogue)).toHaveLength(0)
  })

  test("#given declared checks #when built #then the catalogue is configured and exposes them", () => {
    const catalogue = catalogueFrom([ENTRY])
    expect(catalogue.status).toBe("configured")
    expect(catalogueErrorCode(catalogue)).toBeNull()
    expect(catalogueChecks(catalogue).map((check) => check.checkId)).toEqual(["unit-core"])
  })
})

describe("verify tool - empty catalogue", () => {
  test("#given no configured checks #when the child requests verification #then it is a configuration error, not a pass", async () => {
    const { store, root } = tempStore()
    const result = await toolWith(store, { status: "none", reason: "no verification checks are declared" }).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_no_checks_configured")
    expect(result.details.records).toBe(0)
    expect(result.details.executed).toHaveLength(0)
    expect(existsSync(join(root, "verifications", "run-c"))).toBe(false)
  })

  test("#given a configured catalogue with no checks #when invoked #then it is refused without writing evidence", async () => {
    const { store, root } = tempStore()
    const result = await toolWith(store, { status: "configured", checks: [] }).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_no_checks_configured")
    expect(result.details.records).toBe(0)
    expect(result.details.persisted).toBe(0)
    expect(store.listVerifications("run-c")).toHaveLength(0)
    expect(existsSync(join(root, "verifications", "run-c"))).toBe(false)
  })

  test("#given an invalid catalogue #when invoked #then the joined diagnostics are reported without writing evidence", async () => {
    const { store, root } = tempStore()
    const diagnostics = ["manifest declares no command", "config check is missing a category"]
    const result = await toolWith(store, { status: "invalid", diagnostics }).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_catalogue_invalid")
    expect(result.details.error?.message).toBe(diagnostics.join("; "))
    expect(result.details.records).toBe(0)
    expect(result.details.persisted).toBe(0)
    expect(store.listVerifications("run-c")).toHaveLength(0)
    expect(existsSync(join(root, "verifications", "run-c"))).toBe(false)
  })

  test("#given an unsupported project #when invoked #then the catalogue reason is reported without writing evidence", async () => {
    const { store, root } = tempStore()
    const reason = "this project type has no verification adapter"
    const result = await toolWith(store, { status: "unsupported", reason }).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_unsupported_project")
    expect(result.details.error?.message).toContain(reason)
    expect(result.details.records).toBe(0)
    expect(result.details.persisted).toBe(0)
    expect(store.listVerifications("run-c")).toHaveLength(0)
    expect(existsSync(join(root, "verifications", "run-c"))).toBe(false)
  })

  test("#given candidates awaiting approval #when invoked #then approval is required and nothing executes", async () => {
    const { store, root } = tempStore()
    const pending = ["unit-core", "lint-core"]
    const reason = "candidates need explicit approval before they may run"
    const result = await toolWith(store, { status: "approval_required", pending, reason }).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_approval_required")
    expect(result.details.error?.message).toContain(String(pending.length))
    expect(result.details.error?.message).toContain(reason)
    expect(result.details.records).toBe(0)
    expect(result.details.persisted).toBe(0)
    expect(store.listVerifications("run-c")).toHaveLength(0)
    expect(existsSync(join(root, "verifications", "run-c"))).toBe(false)
  })

  test("#given no configured checks and unattributable changes #when invoked #then it fails closed with no record either way", async () => {
    const { store, root } = tempStore()
    const result = await toolWith(store, { status: "none", reason: "no verification checks are declared" }, null).execute()
    expect(result.isError).toBe(true)
    // Provenance is resolved first, so it reports before the catalogue does. Either code fails closed.
    expect(result.details.error?.code).toBe("verification_provenance_unknown")
    expect(existsSync(join(root, "verifications", "run-c"))).toBe(false)
  })

  test("#given a configured catalogue but unattributable changes #when invoked #then the provenance error is reported, not the catalogue one", async () => {
    const { store } = tempStore()
    const result = await toolWith(store, configuredCatalogue(), null).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_provenance_unknown")
  })

  test("#given a configured catalogue and a documentation-only change #when invoked #then it is not an error and nothing runs", async () => {
    const { store } = tempStore()
    const result = await toolWith(store, configuredCatalogue(), ["docs/agent-quality-gate.md"]).execute()
    expect(result.isError).toBe(false)
    expect(result.details.required).toHaveLength(0)
    expect(result.details.records).toBe(0)
  })

  test("#given a configured catalogue and a code change #when invoked #then the real check executes and its record is durable", async () => {
    const { store } = tempStore()
    const result = await toolWith(store, configuredCatalogue()).execute()
    expect(result.isError).toBe(false)
    expect(result.details.records).toBe(1)
    expect(result.details.executed[0]?.status).toBe("passed")
    expect(store.listVerifications("run-c")).toEqual(["run.unit-core.1.json"])
  })
})
