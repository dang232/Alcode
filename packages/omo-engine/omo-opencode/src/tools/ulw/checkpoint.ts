/**
 * checkpoint.ts — the `ulw_checkpoint` native tool.
 *
 * Gates a checkpoint on recorded child results (the native counterpart of
 * the CLI loop's `checkpoint`): the call is refused while any in-scope
 * dispatched goal has no receipt, so closing a goal can never silently drop
 * a child's work. The refusal names every goal still missing a receipt.
 * Goals that were never dispatched need no receipt and never block.
 */

import { z } from "zod"

import type { OmoJsonObject, OmoToolDefinition } from "../../plugin-types.ts"
import { gateCheckpoint } from "../../ulw/checkpoint.ts"
import { UlwStore } from "../../ulw/store.ts"
import { NonEmptyText, refuseArgs, runIdOf } from "./args.ts"
import { getUlwStore } from "./store-instance.ts"

export const ULW_CHECKPOINT_NAME = "ulw_checkpoint"

export const ULW_CHECKPOINT_DESCRIPTION = "Gate a ULW checkpoint on recorded child results."

export type UlwCheckpointDeps = {
  readonly store?: UlwStore
}

const UlwCheckpointArgs = z.object({
  runId: NonEmptyText,
  goalIds: z.array(NonEmptyText).optional(),
})

export function createUlwCheckpointTool(deps: UlwCheckpointDeps = {}): OmoToolDefinition {
  const store = deps.store ?? getUlwStore()
  return {
    description: ULW_CHECKPOINT_DESCRIPTION,
    args: {
      properties: {
        runId: { type: "string", description: "Run to checkpoint." },
        goalIds: {
          type: "array",
          description: "Goals to close; omitted checks the whole run.",
        },
      },
      required: ["runId"],
    },
    execute: async (toolArgs: OmoJsonObject) => {
      const parsed = UlwCheckpointArgs.safeParse(toolArgs)
      if (!parsed.success) refuseArgs(runIdOf(toolArgs), "ULW runId must be a non-empty string.")
      const goalIds = parsed.data.goalIds
      const result = gateCheckpoint(
        store,
        parsed.data.runId,
        goalIds === undefined ? { kind: "run" } : { kind: "goals", goalIds: [...goalIds] },
      )
      return JSON.stringify(result)
    },
  }
}
