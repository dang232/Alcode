// run-verification.ts — the host-captured verification leg for a product run. This module can never
// approve a check: authority stays host-owned and outside the workspace.

import { createHash } from "node:crypto"

import { catalogueChecks, type OrdinaryCatalogue } from "../../../../senpi-task/src/verification/catalogue"
import { evaluateOrdinaryCompletion } from "../../../../senpi-task/src/verification/completion-gate"
import type { CompletionGateVerdict } from "../../../../senpi-task/src/verification/completion-status"
import { createFileEvidenceStore } from "../../../../senpi-task/src/verification/evidence-store"
import { createOrdinaryVerificationCapture } from "../../../../senpi-task/src/verification/ordinary-capture"
import { resolveCatalogue, WORKSPACE_ID } from "../../../../senpi-task/src/verification/resolution"
import { resolveProjectStateDirectory } from "../../../../senpi-task/src/store/project-state-directory"

export type RunVerificationResult = {
  readonly verification: CompletionGateVerdict["verification"]
  readonly reason?: string
  readonly code?: string
  readonly evidencePaths: readonly string[]
}

export type RunVerificationInput = {
  readonly directory: string
  readonly taskId: string
  readonly sessionId: string
  readonly epoch: number
  readonly changedPaths: readonly string[]
}

export function changeSetRevision(changedPaths: readonly string[]): string {
  const digest = createHash("sha256")
  for (const path of [...changedPaths].sort()) digest.update(path).update("\n")
  return digest.digest("hex").slice(0, 16)
}

function verdictOf(verdict: CompletionGateVerdict, evidencePaths: readonly string[]): RunVerificationResult {
  return {
    verification: verdict.verification,
    ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
    ...(verdict.code === undefined ? {} : { code: verdict.code }),
    evidencePaths,
  }
}

function catalogueFor(input: RunVerificationInput): OrdinaryCatalogue {
  return resolveCatalogue({
    projectRoot: input.directory,
    workspaceId: WORKSPACE_ID,
    changedFiles: input.changedPaths.length === 0 ? null : input.changedPaths,
  })
}

export async function verifyRunChanges(input: RunVerificationInput): Promise<RunVerificationResult> {
  try {
    const store = createFileEvidenceStore(resolveProjectStateDirectory(input.directory, "senpi-task"))
    const catalogue = catalogueFor(input)

    if (catalogue.status !== "configured") {
      return verdictOf(
        evaluateOrdinaryCompletion({
          taskId: input.taskId,
          catalogue,
          evidenceRoot: store.rootDir,
          workspaceDir: input.directory,
          epoch: input.epoch,
        }),
        [],
      )
    }

    const required = catalogueChecks(catalogue)
    const revision = changeSetRevision(input.changedPaths)
    const capture = createOrdinaryVerificationCapture({
      store,
      projectDir: input.directory,
      currentRevision: () => revision,
    })
    const captured = await capture.capture({
      binding: { taskId: input.taskId, sessionId: input.sessionId, epoch: input.epoch },
      changedFiles: input.changedPaths,
      available: required,
      required,
      attempt: input.epoch + 1,
    })

    return verdictOf(
      evaluateOrdinaryCompletion({
        taskId: input.taskId,
        catalogue,
        requirements: required,
        evidenceRoot: store.rootDir,
        workspaceDir: input.directory,
        epoch: input.epoch,
        sourceRevision: revision,
      }),
      captured.persistedPaths,
    )
  } catch (error) {
    return {
      verification: "blocked",
      reason: error instanceof Error ? error.message : String(error),
      evidencePaths: [],
    }
  }
}
