/**
 * index.ts — the six native ULW tools as one host-ready map.
 *
 * `createTools` overlays this map onto the gated registry entries, so the
 * tools travel the existing path: `createTools` → `tool-registry.ts` →
 * `plugin-setup.ts` `ctx.tool.transform`. Only names the registry keeps
 * (after user disables, per-agent denies, and the size cap) are exposed.
 */

import type { OmoToolMap } from "../../plugin-types.ts"
import { UlwStore } from "../../ulw/store.ts"
import { createUlwCheckpointTool, ULW_CHECKPOINT_NAME } from "./checkpoint.ts"
import { createUlwCompleteTool, ULW_COMPLETE_NAME } from "./complete.ts"
import { createUlwDispatchTool, ULW_DISPATCH_NAME, type UlwDispatchDeps } from "./dispatch.ts"
import { createUlwEvidenceTool, ULW_EVIDENCE_NAME } from "./evidence.ts"
import { createUlwGoalCreateTool, ULW_GOAL_CREATE_NAME } from "./goal-create.ts"
import { createUlwStatusTool, ULW_STATUS_NAME } from "./status.ts"
import { getUlwStore } from "./store-instance.ts"

export const ULW_TOOL_NAMES = [
  ULW_GOAL_CREATE_NAME,
  ULW_STATUS_NAME,
  ULW_DISPATCH_NAME,
  ULW_EVIDENCE_NAME,
  ULW_CHECKPOINT_NAME,
  ULW_COMPLETE_NAME,
] as const

export type UlwToolName = (typeof ULW_TOOL_NAMES)[number]

export type UlwToolsDeps = {
  readonly store?: UlwStore
  readonly dispatch?: Omit<UlwDispatchDeps, "store">
}

/** Builds all six tool definitions against one store (the shared singleton by default). */
export function createUlwTools(deps: UlwToolsDeps = {}): OmoToolMap {
  const store = deps.store ?? getUlwStore()
  const dispatchDeps: UlwDispatchDeps = { ...deps.dispatch, store }
  return {
    [ULW_GOAL_CREATE_NAME]: createUlwGoalCreateTool({ store }),
    [ULW_STATUS_NAME]: createUlwStatusTool({ store }),
    [ULW_DISPATCH_NAME]: createUlwDispatchTool(dispatchDeps),
    [ULW_EVIDENCE_NAME]: createUlwEvidenceTool({ store }),
    [ULW_CHECKPOINT_NAME]: createUlwCheckpointTool({ store }),
    [ULW_COMPLETE_NAME]: createUlwCompleteTool({ store }),
  }
}
