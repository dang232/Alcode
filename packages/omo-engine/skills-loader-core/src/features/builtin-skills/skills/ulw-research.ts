import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const ulwResearchSkill: BuiltinSkill = {
	name: "ulw-research",
	description: "Runs maximum-saturation research with a cooperating team, claim-graph gating, and a cited, QA'd deliverable. Use when the user explicitly asks for research or a deep investigation, including any 'ulw' research wording.",
	template: loadSharedSkillTemplate("ulw-research"),
}
