/**
 * index.ts — the single native code-graph tool as one host-ready map.
 *
 * `createTools` overlays this map onto the gated registry entries, so the
 * tool travels the existing path: `createTools` → `tool-registry.ts` →
 * `plugin-setup.ts` `ctx.tool.transform`. Only names the registry keeps
 * (after user disables, per-agent denies, and the size cap) are exposed.
 */

import type { OmoToolMap } from "../../plugin-types.ts"
import { CODE_GRAPH_NAME, createCodeGraphTool, type CodeGraphToolDeps } from "./code-graph.ts"

export const CODE_GRAPH_TOOL_NAMES = [CODE_GRAPH_NAME] as const

export type CodeGraphToolName = (typeof CODE_GRAPH_TOOL_NAMES)[number]

export type CodeGraphToolsDeps = CodeGraphToolDeps

/** Builds the single code-graph tool definition. */
export function createCodeGraphTools(deps: CodeGraphToolsDeps = {}): OmoToolMap {
  return {
    [CODE_GRAPH_NAME]: createCodeGraphTool(deps),
  }
}
