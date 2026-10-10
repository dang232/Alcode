import { getPaneDimensions as getPaneDimensionsCore } from "../../../../../tmux-core/src/index.ts"
import type { PaneDimensions } from "../../../../../tmux-core/src/index.ts"

export async function getPaneDimensions(
	paneId: string,
): Promise<PaneDimensions | null> {
  const [{ getTmuxPath }, { runTmuxCommand }] = await Promise.all([
    import("../../../tools/interactive-bash/tmux-path-resolver"),
    import("../runner"),
  ])
	return getPaneDimensionsCore(paneId, { getTmuxPath, runTmuxCommand })
}

export type { PaneDimensions }
