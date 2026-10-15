import { spawnTmuxWindow as spawnTmuxWindowCore } from "../../../../../tmux-core/src/index.ts"
import type { SpawnTmuxWindowDeps, TmuxConfig } from "../../../../../tmux-core/src/index.ts"
import type { SpawnPaneResult } from "../types"
import { withWindowSpawnDeps } from "./adapter-deps"

export async function spawnTmuxWindow(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverUrl: string,
	_directory: string,
	depsInput?: Partial<SpawnTmuxWindowDeps>,
): Promise<SpawnPaneResult> {
	return spawnTmuxWindowCore(
		sessionId,
		description,
		config,
		serverUrl,
		_directory,
		withWindowSpawnDeps(depsInput),
	)
}
