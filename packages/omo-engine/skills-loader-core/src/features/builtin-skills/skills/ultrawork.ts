import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const ultraworkSkill: BuiltinSkill = {
	name: "ultrawork",
	description: "Binding ultrawork mode directive for omo on Codex. When a prompt contains ultrawork or ulw, the omo UserPromptSubmit hook injects a short bootstrap that points at this file. Read the whole file and follow every rule in it for the rest of the task.",
	template: loadSharedSkillTemplate("ultrawork"),
}
