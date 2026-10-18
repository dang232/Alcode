import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const ulwExecuteSkill: BuiltinSkill = {
	name: "ulw-execute",
	description: "Executes a written ulw-plan work plan with Boulder state, evidence ledger, worktree discipline, and parallel subagents. Use when the user says ulw-execute or asks to run a .omo/plans plan.",
	template: loadSharedSkillTemplate("ulw-execute"),
	argumentHint: "[plan-name] [--worktree <absolute-path>] [--make-pr] [--ship]",
}
