/**
 * goal-create.ts — the `ulw_goal_create` native tool.
 *
 * Opens a native ULW run from a brief (the native counterpart of the
 * CLI loop's `create-goals`). The owning session defaults to the calling
 * session; an explicit `id` is a test seam for deterministic runs.
 */

import { z } from "zod"

import type { OmoJsonObject, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
import { UlwStore } from "../../ulw/store.ts"
import { NonEmptyText, refuseArgs, runIdOf } from "./args.ts"
import { getUlwStore } from "./store-instance.ts"

export const ULW_GOAL_CREATE_NAME = "ulw_goal_create"

export const ULW_GOAL_CREATE_DESCRIPTION = "Open a native ULW run from a brief; returns the run record."

export type UlwGoalCreateDeps = {
  readonly store?: UlwStore
}

const UlwGoalCreateArgs = z.object({
  brief: NonEmptyText,
  sessionScope: NonEmptyText.optional(),
  id: NonEmptyText.optional(),
})

export function createUlwGoalCreateTool(deps: UlwGoalCreateDeps = {}): OmoToolDefinition {
  const store = deps.store ?? getUlwStore()
  return {
    description: ULW_GOAL_CREATE_DESCRIPTION,
    args: {
      properties: {
        brief: { type: "string", description: "What the run must deliver." },
        sessionScope: {
          type: "string",
          description: "Owning session id; defaults to the calling session.",
        },
        id: { type: "string", description: "Optional run id; generated when omitted." },
      },
      required: ["brief"],
    },
    execute: async (toolArgs: OmoJsonObject, context: OmoToolContext) => {
      const parsed = UlwGoalCreateArgs.safeParse(toolArgs)
      if (!parsed.success) refuseArgs(runIdOf(toolArgs), "ULW brief must be a non-empty string.")
      return JSON.stringify(
        store.createRun({
          brief: parsed.data.brief,
          sessionScope: parsed.data.sessionScope ?? context.sessionID,
          id: parsed.data.id,
        }),
      )
    },
  }
}
