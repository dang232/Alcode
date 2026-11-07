import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseVerificationRecord, type DagVerifyCheck } from "../dag/verification"
import type { OrdinaryCatalogue, OrdinaryCheck } from "./catalogue"
import { createOrdinaryVerificationCapture, type OrdinaryEvidenceStore } from "./ordinary-capture"
import { VERIFY_TOOL_NAME, VerifyParams, createVerificationWorkerTool, type VerifyTool } from "./verify-tool"

function tempStore() {
  const root = mkdtempSync(join(tmpdir(), "verify-tool-"))
  const dir = (runId: string) => join(root, "verifications", runId)
  const store = {
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
  } satisfies OrdinaryEvidenceStore
  return { root, store }
}

const PASSING: DagVerifyCheck = {
  checkId: "unit-core",
  category: "unit",
  command: ["node", "-e", "process.exit(0)"],
  timeoutMs: 20_000,
  criteria: ["core tests pass"],
  coveredPaths: ["src/a.ts"],
}

const FAILING: DagVerifyCheck = { ...PASSING, checkId: "unit-fail", command: ["node", "-e", "process.exit(2)"] }

function toCatalogue(checks: readonly DagVerifyCheck[]): OrdinaryCatalogue {
  const entries: readonly OrdinaryCheck[] = checks.map((check) => ({
    check,
    provenance: { source: "manifest", location: "package.json#scripts.test", reason: "declared check" },
  }))
  return { status: "configured", checks: entries }
}

function buildTool(
  store: OrdinaryEvidenceStore,
  binding: { runId: string; sessionId: string; epoch: number } | null,
  catalogue: OrdinaryCatalogue,
  changedFiles: readonly string[] | null = ["src/a.ts"],
): VerifyTool {
  const capture = createOrdinaryVerificationCapture({ store, projectDir: process.cwd(), currentRevision: () => "rev-1" })
  return createVerificationWorkerTool({
    capture,
    binding: () => binding,
    changedFiles: () => changedFiles,
    catalogue: () => catalogue,
  })
}

function evidenceDir(root: string, runId: string): string {
  return join(root, "verifications", runId)
}

describe("verify tool - ownership", () => {
  test("#given an empty parameter schema #when inspected #then the request cannot express identity or status", () => {
    expect(VERIFY_TOOL_NAME).toBe("verify")
    expect(Object.keys(VerifyParams.properties)).toHaveLength(0)
    expect(VerifyParams.additionalProperties).toBe(false)
  })

  test("#given no live run owns the call #when the child requests verification #then it is refused as unavailable", async () => {
    const { store } = tempStore()
    const result = await buildTool(store, null, toCatalogue([PASSING])).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_unavailable")
    expect(store.listVerifications("run-a")).toHaveLength(0)
  })

  test("#given a live binding #when the child requests verification #then the host binding owns the evidence", async () => {
    const { store } = tempStore()
    const result = await buildTool(
      store,
      { runId: "run-a", sessionId: "sess-a", epoch: 3 },
      toCatalogue([PASSING]),
    ).execute()
    expect(result.isError).toBe(false)
    const record = parseVerificationRecord(store.readVerification("run-a", "run", "unit-core")!)
    expect(record?.runId).toBe("run-a")
    expect(record?.parentSessionId).toBe("sess-a")
    expect(record?.workerAttempt).toBe(3)
    expect(record?.status).toBe("passed")
    expect(result.details.executed[0]?.sourceRevision).toBe("rev-1")
  })

  test("#given two children #when both request verification #then each keeps its own evidence", async () => {
    const { store } = tempStore()
    await buildTool(store, { runId: "run-a", sessionId: "sess-a", epoch: 1 }, toCatalogue([PASSING])).execute()
    await buildTool(store, { runId: "run-b", sessionId: "sess-b", epoch: 1 }, toCatalogue([FAILING])).execute()
    expect(store.listVerifications("run-a")).toHaveLength(1)
    expect(store.listVerifications("run-b")).toHaveLength(1)
    expect(parseVerificationRecord(store.readVerification("run-a", "run", "unit-core")!)?.status).toBe("passed")
    expect(parseVerificationRecord(store.readVerification("run-b", "run", "unit-fail")!)?.status).toBe("failed")
  })

  test("#given changes the host cannot attribute #when the child requests verification #then provenance is reported before the catalogue", async () => {
    const { store } = tempStore()
    const result = await buildTool(
      store,
      { runId: "run-u", sessionId: "sess-u", epoch: 1 },
      toCatalogue([PASSING]),
      null,
    ).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_provenance_unknown")
    expect(result.details.records).toBe(0)
    expect(store.listVerifications("run-u")).toHaveLength(0)
  })
})

describe("verify tool - truthfulness", () => {
  test("#given a failing check #when the child requests verification #then the result is an error carrying the real status", async () => {
    const { store } = tempStore()
    const result = await buildTool(
      store,
      { runId: "run-f", sessionId: "sess-f", epoch: 1 },
      toCatalogue([FAILING]),
    ).execute()
    expect(result.isError).toBe(true)
    expect(result.details.executed[0]?.status).toBe("failed")
    expect(result.details.executed[0]?.exitCode).toBe(2)
  })

  test("#given a documentation-only change #when the child requests verification #then no check runs", async () => {
    const { store } = tempStore()
    const result = await buildTool(
      store,
      { runId: "run-doc", sessionId: "sess-doc", epoch: 1 },
      toCatalogue([PASSING]),
      ["docs/architecture/agent-quality-gate.md"],
    ).execute()
    expect(result.isError).toBe(false)
    expect(result.details.required).toHaveLength(0)
    expect(result.details.records).toBe(0)
    expect(store.listVerifications("run-doc")).toHaveLength(0)
  })
})

describe("verify tool - catalogue refusals", () => {
  test("#given a configured catalogue with no checks #when the child requests verification #then it is refused without writing evidence", async () => {
    const { root, store } = tempStore()
    const result = await buildTool(
      store,
      { runId: "run-empty", sessionId: "sess-empty", epoch: 1 },
      { status: "configured", checks: [] },
    ).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_no_checks_configured")
    expect(result.details.records).toBe(0)
    expect(result.details.persisted).toBe(0)
    expect(store.listVerifications("run-empty")).toHaveLength(0)
    expect(existsSync(evidenceDir(root, "run-empty"))).toBe(false)
  })

  test("#given no catalogue #when the child requests verification #then the catalogue reason is reported without writing evidence", async () => {
    const { root, store } = tempStore()
    const reason = "no verification checks are declared for this workspace"
    const result = await buildTool(
      store,
      { runId: "run-none", sessionId: "sess-none", epoch: 1 },
      { status: "none", reason },
    ).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_no_checks_configured")
    expect(result.details.error?.message).toContain(reason)
    expect(result.details.records).toBe(0)
    expect(result.details.persisted).toBe(0)
    expect(store.listVerifications("run-none")).toHaveLength(0)
    expect(existsSync(evidenceDir(root, "run-none"))).toBe(false)
  })

  test("#given an invalid catalogue #when the child requests verification #then the joined diagnostics are reported without writing evidence", async () => {
    const { root, store } = tempStore()
    const diagnostics = ["manifest declares no command", "config check is missing a category"]
    const result = await buildTool(
      store,
      { runId: "run-invalid", sessionId: "sess-invalid", epoch: 1 },
      { status: "invalid", diagnostics },
    ).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_catalogue_invalid")
    expect(result.details.error?.message).toBe(diagnostics.join("; "))
    expect(result.details.records).toBe(0)
    expect(result.details.persisted).toBe(0)
    expect(store.listVerifications("run-invalid")).toHaveLength(0)
    expect(existsSync(evidenceDir(root, "run-invalid"))).toBe(false)
  })

  test("#given an unsupported project #when the child requests verification #then the catalogue reason is reported without writing evidence", async () => {
    const { root, store } = tempStore()
    const reason = "this project type has no verification adapter"
    const result = await buildTool(
      store,
      { runId: "run-unsupported", sessionId: "sess-unsupported", epoch: 1 },
      { status: "unsupported", reason },
    ).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_unsupported_project")
    expect(result.details.error?.message).toContain(reason)
    expect(result.details.records).toBe(0)
    expect(result.details.persisted).toBe(0)
    expect(store.listVerifications("run-unsupported")).toHaveLength(0)
    expect(existsSync(evidenceDir(root, "run-unsupported"))).toBe(false)
  })

  test("#given candidates awaiting approval #when the child requests verification #then approval is required and nothing executes", async () => {
    const { root, store } = tempStore()
    const pending = ["unit-core", "lint-core"]
    const reason = "candidates need explicit approval before they may run"
    const result = await buildTool(
      store,
      { runId: "run-approval", sessionId: "sess-approval", epoch: 1 },
      { status: "approval_required", pending, reason },
    ).execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_approval_required")
    expect(result.details.error?.message).toContain(String(pending.length))
    expect(result.details.error?.message).toContain(reason)
    expect(result.details.records).toBe(0)
    expect(result.details.persisted).toBe(0)
    expect(store.listVerifications("run-approval")).toHaveLength(0)
    expect(existsSync(evidenceDir(root, "run-approval"))).toBe(false)
  })
})
