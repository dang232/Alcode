import {
  applyLayout,
  enforceMainPaneWidth as enforceMainPaneWidthCore,
} from "../../../../../tmux-core/src/index.ts"
import type { MainPaneWidthOptions } from "../../../../../tmux-core/src/index.ts"

export async function enforceMainPaneWidth(
	mainPaneId: string,
	windowWidth: number,
	mainPaneSizeOrOptions?: number | MainPaneWidthOptions,
): Promise<void> {
  const [{ log }, { getTmuxPath }, { runTmuxCommand }] = await Promise.all([
    import("../../logger"),
    import("../../../tools/interactive-bash/tmux-path-resolver"),
    import("../runner"),
  ])
	return enforceMainPaneWidthCore(mainPaneId, windowWidth, mainPaneSizeOrOptions, {
    log,
    getTmuxPath,
    runTmuxCommand,
  })
}

export { applyLayout }
export type { MainPaneWidthOptions }
