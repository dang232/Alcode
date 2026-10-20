/**
 * complete.ts — the `ulw_complete` native tool.
 *
 * Moves a run to its terminal status (the native counterpart of the CLI
 * loop's `complete-goals`). Completing reuses the existing receipt gate:
 * the run is refused while any dispatched goal has no recorded result.
 * Failing or blocking a run needs no receipts — abandoning work must never
 * wait on the work being abandoned. No new gating logic lives here; the
 * gate is `gateCheckpoint` from the store lane.
 */

import { z } from "zod"

import type { OmoJsonObject, OmoToolDefinition } from "../../plugin-types.ts"
import { gateCheckpoint } from "../../ulw/checkpoint.ts"
import { UlwStore } from "../../ulw/store.ts"
import { NonEmptyText, refuseArgs, runIdOf } from "./args.ts"
import { getUlwStore } from "./store-instance.ts"

export const ULW_COMPLETE_NAME = "ulw_complete"

export const ULW_COMPLETE_DESCRIPTION = "Close a ULW run once every dispatched goal has its result."

export type UlwCompleteDeps = {
  readonly store?: UlwStore
}

const UlwCompleteArgs = z.object({
  runId: NonEmptyText,
  status: z.enum(["complete", "failed", "blocked"]),
})

export function createUlwCompleteTool(deps: UlwCompleteDeps = {}): OmoToolDefinition {
  const store = deps.store ?? getUlwStore()
  return {
    description: ULW_COMPLETE_DESCRIPTION,
    args: {
      properties: {
        runId: { type: "string", description: "Run to close." },
        status: {
          type: "string",
          description: "Terminal status for the run.",
          allowedValues: ["complete", "failed", "blocked"],
        },
      },
      required: ["runId", "status"],
    },
    execute: async (toolArgs: OmoJsonObject) => {
      const parsed = UlwCompleteArgs.safeParse(toolArgs)
      if (!parsed.success) refuseArgs(runIdOf(toolArgs), "ULW runId must be non-empty and status one of complete, failed, blocked.")
      if (parsed.data.status === "complete") {
        gateCheckpoint(store, parsed.data.runId)
      }
      return JSON.stringify(store.setRunStatus(parsed.data.runId, parsed.data.status))
    },
  }
}
