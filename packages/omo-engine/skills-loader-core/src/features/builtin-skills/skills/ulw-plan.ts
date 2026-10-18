import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const ulwPlanSkill: BuiltinSkill = {
	name: "ulw-plan",
	description: "ACTIVATES ONLY on an explicit user request for the ulw-plan workflow: the user themselves saying ulw-plan, ulw plan, /skill:ulw-plan, or asking in their own words for a work plan before coding. NEVER self-activates: a bare ulw/ultrawork run, an agent-side routing decision, or reading this file is not a request, and the plan-gated reviewers (metis/momus) stay locked without a user request plus a written .omo/plans plan file. Explore-first planning consultant (Prometheus) that grounds in the codebase, asks only the forks exploration cannot resolve - or researches them to best practice when the intent is fuzzy - waits for explicit approval, then writes ONE decision-complete work plan a worker executes with zero further interview. Triggers: ulw-plan, ulw plan, plan this, make a plan, plan before coding, interview me, break this down, start planning, plan mode.",
	template: loadSharedSkillTemplate("ulw-plan"),
}
