// The child-facing verification request. A worker may ask the host to verify its work; it names
// nothing and decides nothing. The parameter schema is intentionally EMPTY, so a request cannot
// even express a run id, an epoch, a status or a command - ownership is not something the caller
// is trusted with, it is something the host already knows.
import { Type } from "typebox"
import { catalogueChecks, type OrdinaryCatalogue } from "./catalogue"
import type { OrdinaryVerificationCapture } from "./ordinary-capture"

export const VERIFY_TOOL_NAME = "verify"

export const VerifyParams = Type.Object({}, { additionalProperties: false })

type VerifyExecutedCheck = {
  readonly checkId: string
  readonly category: string
  readonly status: string
  readonly exitCode: number | null
  readonly sourceRevision: string
}

type VerifyToolDetails = {
  readonly required: readonly string[]
  readonly omitted: readonly { readonly checkId: string; readonly reason: string }[]
  readonly executed: readonly VerifyExecutedCheck[]
  readonly records: number
  readonly persisted: number
  readonly error?: { readonly code: string; readonly message: string }
}

export type VerifyToolResult = {
  readonly content: { readonly type: "text"; readonly text: string }[]
  readonly details: VerifyToolDetails
  readonly isError: boolean
}

export type VerifyTool = {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly parameters: typeof VerifyParams
  readonly execute: () => Promise<VerifyToolResult>
}

type VerifyBinding = {
  readonly runId: string
  readonly sessionId: string
  readonly epoch: number
}

export type VerifyToolDeps = {
  readonly capture: OrdinaryVerificationCapture
  // Resolved from host-owned task state at call time, never from the request.
  readonly binding: () => VerifyBinding | null
  // Host-observed working-tree changes; the caller supplies none. `null` means the host cannot
  // attribute changes to this run, which must fail closed rather than assume an empty change set.
  readonly changedFiles: () => readonly string[] | null
  // Host-owned catalogue state resolved at call time, never from the request. A non-executable
  // state must surface as its own precise refusal so a gap never reads as a pass.
  readonly catalogue: () => OrdinaryCatalogue
}

function toolResult(details: VerifyToolDetails, isError = false): VerifyToolResult {
  return { content: [{ type: "text", text: JSON.stringify(details) }], details, isError }
}

function errorDetails(code: string, message: string): VerifyToolDetails {
  return { required: [], omitted: [], executed: [], records: 0, persisted: 0, error: { code, message } }
}

export function createVerificationWorkerTool(deps: VerifyToolDeps): VerifyTool {
  return {
    name: VERIFY_TOOL_NAME,
    label: "Verify",
    description:
      "Run the checks the host requires for your current changes and return the real execution evidence. The host decides which checks are required from the files that actually changed; you cannot choose checks, claim results, or report a status. A failed, timed-out or cancelled check is never reported as a pass.",
    parameters: VerifyParams,
    execute: async () => {
      const binding = deps.binding()
      if (binding === null) {
        return toolResult(
          errorDetails("verification_unavailable", "No live run owns this call, so no evidence can be recorded for it."),
          true,
        )
      }
      const changedFiles = deps.changedFiles()
      if (changedFiles === null) {
        return toolResult(
          errorDetails(
            "verification_provenance_unknown",
            "This run's changes cannot be attributed to it, so no check was selected and no evidence was recorded.",
          ),
          true,
        )
      }
      try {
        const catalogue = deps.catalogue()
        // An executable catalogue runs the capture path as before; every other state refuses
        // before any evidence directory can be created.
        if (catalogue.status === "configured") {
          const available = catalogueChecks(catalogue)
          // An empty configured list is a configuration gap, never a pass: it must not reach the
          // capture path, where an empty selection would look like a legitimate "nothing to run".
          if (available.length === 0) {
            return toolResult(
              errorDetails(
                "verification_no_checks_configured",
                "No verification checks are configured for this workspace, so nothing was executed and no evidence was recorded.",
              ),
              true,
            )
          }
          const outcome = await deps.capture.capture({
            binding,
            changedFiles,
            available,
          })
          const failed = outcome.records.some((record) => record.status !== "passed")
          return toolResult(
            {
              required: outcome.selection.required.map((check) => check.checkId),
              omitted: outcome.selection.omitted.map((entry) => ({ checkId: entry.check.checkId, reason: entry.reason })),
              executed: outcome.records.map((record) => ({
                checkId: record.checkId,
                category: record.category,
                status: record.status,
                exitCode: record.exitCode ?? null,
                sourceRevision: record.sourceRevision,
              })),
              records: outcome.records.length,
              persisted: outcome.persistedPaths.length,
            },
            failed,
          )
        }
        if (catalogue.status === "none") {
          return toolResult(
            errorDetails(
              "verification_no_checks_configured",
              `No verification checks are configured for this workspace: ${catalogue.reason}, so nothing was executed and no evidence was recorded.`,
            ),
            true,
          )
        }
        if (catalogue.status === "invalid") {
          return toolResult(errorDetails("verification_catalogue_invalid", catalogue.diagnostics.join("; ")), true)
        }
        if (catalogue.status === "unsupported") {
          return toolResult(errorDetails("verification_unsupported_project", catalogue.reason), true)
        }
        // Only approval_required remains: candidates exist but none may run until approved.
        // This state must never fall through to execution.
        return toolResult(
          errorDetails(
            "verification_approval_required",
            `${catalogue.pending.length} candidate check(s) are awaiting approval and were not executed: ${catalogue.reason}`,
          ),
          true,
        )
      } catch (error) {
        return toolResult(
          errorDetails("verification_failed", error instanceof Error ? error.message : String(error)),
          true,
        )
      }
    },
  }
}
