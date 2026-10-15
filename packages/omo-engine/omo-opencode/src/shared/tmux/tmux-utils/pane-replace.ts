import { replaceTmuxPane as replaceTmuxPaneCore } from "../../../../../tmux-core/src/index.ts"
import type { ReplaceTmuxPaneDeps, TmuxConfig } from "../../../../../tmux-core/src/index.ts"
import type { SpawnPaneResult } from "../types"
import { withPaneReplaceDeps } from "./adapter-deps"

export async function replaceTmuxPane(
	paneId: string,
	sessionId: string,
	description: string,
	config: TmuxConfig,
	_serverUrl: string,
	_directory: string,
	depsInput?: Partial<ReplaceTmuxPaneDeps>,
): Promise<SpawnPaneResult> {
	return replaceTmuxPaneCore(
		paneId,
		sessionId,
		description,
		config,
		_serverUrl,
		_directory,
		withPaneReplaceDeps(depsInput),
	)
}
