import { closeTmuxPaneWithDependencies } from "../../../../../tmux-core/src/index.ts"

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function closeTmuxPane(paneId: string): Promise<boolean> {
	const [{ log }, { isTmuxPaneCompatible }, { getTmuxPath }, { runTmuxCommand }] = await Promise.all([
		import("../../logger"),
		import("./environment"),
		import("../../../tools/interactive-bash/tmux-path-resolver"),
		import("../runner"),
	])

	return closeTmuxPaneWithDependencies(paneId, {
		isInsideTmux: isTmuxPaneCompatible,
		getTmuxPath,
		runTmuxCommand,
		log,
		delay,
	})
}
