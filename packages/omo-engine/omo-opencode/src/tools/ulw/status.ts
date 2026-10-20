/**
 * status.ts — the `ulw_status` native tool.
 *
 * Reports native ULW state (the native counterpart of the CLI loop's
 * `status`). With a `runId` it returns that run's record plus its dispatch
 * roster, child-result receipts, and goals still missing receipts; without
 * one it lists every run. Reads never throw for settled runs — only an
 * unknown run id is refused.
 */

import { z } from "zod"

import type { OmoJsonObject, OmoToolDefinition } from "../../plugin-types.ts"
import { runNotFoundError } from "../../ulw/errors.ts"
import { UlwStore } from "../../ulw/store.ts"
import { NonEmptyText, refuseArgs, runIdOf } from "./args.ts"
import { getUlwStore } from "./store-instance.ts"

export const ULW_STATUS_NAME = "ulw_status"

export const ULW_STATUS_DESCRIPTION =
  "Report a native ULW run (record, roster, receipts, missing) or list runs."

export type UlwStatusDeps = {
  readonly store?: UlwStore
}

const UlwStatusArgs = z.object({
  runId: NonEmptyText.optional(),
})

export function createUlwStatusTool(deps: UlwStatusDeps = {}): OmoToolDefinition {
  const store = deps.store ?? getUlwStore()
  return {
    description: ULW_STATUS_DESCRIPTION,
    args: {
      properties: {
        runId: { type: "string", description: "Run to inspect; omitted lists every run." },
      },
    },
    execute: async (toolArgs: OmoJsonObject) => {
      const parsed = UlwStatusArgs.safeParse(toolArgs)
      if (!parsed.success) refuseArgs(runIdOf(toolArgs), "ULW runId must be a non-empty string when provided.")
      const runId = parsed.data.runId
      if (runId === undefined) {
        return JSON.stringify({ runs: store.listRuns() })
      }
      const run = store.getRun(runId)
      if (run === undefined) {
        throw runNotFoundError(runId)
      }
      return JSON.stringify({
        run,
        roster: store.rosterFor(runId),
        receipts: store.receiptsFor(runId),
        missingReceipts: store.missingReceipts(runId),
      })
    },
  }
}
