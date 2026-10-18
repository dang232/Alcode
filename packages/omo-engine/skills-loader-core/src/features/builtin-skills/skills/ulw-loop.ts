import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const ulwLoopSkill: BuiltinSkill = {
	name: "ulw-loop",
	description: "A goal-like loop that decomposes work into systematic, evidence-bound ultrawork steps. Use when the user wants a goal loop or durable, checkpointed execution.",
	template: loadSharedSkillTemplate("ulw-loop"),
}
