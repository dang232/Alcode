/**
 * evidence.ts — the `ulw_evidence` native tool.
 *
 * Records a dispatched goal's child result as evidence (the native
 * counterpart of the CLI loop's `record-child-result`). The latest
 * recording wins per goal. A receipt for a goal that was never dispatched
 * is refused: evidence must always settle a real dispatch.
 */

import { z } from "zod"

import type { OmoJsonObject, OmoToolDefinition } from "../../plugin-types.ts"
import { UlwStore } from "../../ulw/store.ts"
import { NonEmptyText, refuseArgs, runIdOf } from "./args.ts"
import { getUlwStore } from "./store-instance.ts"

export const ULW_EVIDENCE_NAME = "ulw_evidence"

export const ULW_EVIDENCE_DESCRIPTION = "Record a dispatched ULW goal's child result as evidence."

export type UlwEvidenceDeps = {
  readonly store?: UlwStore
}

const UlwEvidenceArgs = z.object({
  runId: NonEmptyText,
  goalId: NonEmptyText,
  childSessionId: NonEmptyText,
  status: z.enum(["completed", "failed"]).optional(),
  resultRef: NonEmptyText.optional(),
  reason: NonEmptyText.optional(),
})

export function createUlwEvidenceTool(deps: UlwEvidenceDeps = {}): OmoToolDefinition {
  const store = deps.store ?? getUlwStore()
  return {
    description: ULW_EVIDENCE_DESCRIPTION,
    args: {
      properties: {
        runId: { type: "string", description: "Run that owns the goal." },
        goalId: { type: "string", description: "Dispatched goal the result settles." },
        childSessionId: { type: "string", description: "Worker session that produced the result." },
        status: {
          type: "string",
          description: "Result status; defaults to completed.",
          allowedValues: ["completed", "failed"],
        },
        resultRef: { type: "string", description: "Artifact reference for the result." },
        reason: { type: "string", description: "Why the child failed; for failed results." },
      },
      required: ["runId", "goalId", "childSessionId"],
    },
    execute: async (toolArgs: OmoJsonObject) => {
      const parsed = UlwEvidenceArgs.safeParse(toolArgs)
      if (!parsed.success) {
        refuseArgs(runIdOf(toolArgs), "ULW runId, goalId, and childSessionId must be non-empty strings.")
      }
      const input = {
        childSessionId: parsed.data.childSessionId,
        status: parsed.data.status ?? "completed",
        resultRef: parsed.data.resultRef,
        reason: parsed.data.reason,
      }
      return JSON.stringify(store.recordChildResult(parsed.data.runId, parsed.data.goalId, input))
    },
  }
}
