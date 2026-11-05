const UUID_V4ISH_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

const TEAM_SESSION_PATTERN = new RegExp(`^omo-team-(${UUID_V4ISH_PATTERN})$`)

export type TeamSweepDeps = {
	listCandidates: () => Promise<string[]>
	killSession: (name: string) => Promise<void>
	log: (message: string, payload?: unknown) => void
}

export async function sweepStaleTeamSessionsWith(
	activeTeamRunIds: ReadonlySet<string>,
	deps: TeamSweepDeps,
): Promise<string[]> {
	const { sweepTmuxSessionsWith } = await import("@oh-my-opencode/tmux-core")

	return sweepTmuxSessionsWith(
		{
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			listCandidateSessions: async () => deps.listCandidates(),
			killSession: async (sessionName) => {
				await deps.killSession(sessionName)
				return true
			},
			log: deps.log,
		},
		{
			predicate: (sessionName) => {
				const teamRunId = sessionName.match(TEAM_SESSION_PATTERN)?.[1]
				return teamRunId !== undefined && teamRunId.length > 0 && !activeTeamRunIds.has(teamRunId)
			},
		},
	)
}
