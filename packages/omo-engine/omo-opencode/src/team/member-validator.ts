import { validateDualSupport, TeamSpecValidationError } from "../../../team-core/src/team-registry/validator.ts"
import type { TeamSpec } from "../../../team-core/src/types.ts"

import { TeamSpecError } from "./normalize.ts"

/**
 * Ports binding team member validation to the live OpenCode vocabulary.
 * Kept injectable so the registry never couples to a full model or agent
 * registry just to validate a spec.
 */
export type TeamMemberPorts = {
  readonly isCategoryResolvable: (category: string) => boolean
  readonly isKnownAgent: (subagentType: string) => boolean
  readonly categoryNames?: readonly string[]
  readonly agentNames?: readonly string[]
}

const ALLOWED_KINDS_HINT =
  "member kind must be 'category' (a resolvable dispatch category), 'subagent_type' (a loaded agent definition), or the 'agent' alias for a subagent_type"

/**
 * Validates parsed team members against the live OpenCode vocabulary.
 * The team-core roster eligibility check is not used: it hard-codes a
 * different harness roster. Prompt hygiene reuses the team-core dual-support
 * check; its errors are rethrown as TeamSpecError so callers see one type.
 */
export function validateTeamMembers(spec: TeamSpec, ports: TeamMemberPorts): void {
  for (const member of spec.members) {
    try {
      validateDualSupport(member)
    } catch (error) {
      if (error instanceof TeamSpecValidationError) {
        throw new TeamSpecError(error.message, "INVALID_SPEC", spec.name)
      }
      throw error
    }

    if (member.kind === "category") {
      if (!ports.isCategoryResolvable(member.category)) {
        const available = ports.categoryNames !== undefined && ports.categoryNames.length > 0
          ? ` Available categories: ${[...ports.categoryNames].sort().join(", ")}.`
          : ""
        throw new TeamSpecError(
          `Team '${spec.name}' member '${member.name}' references unknown category '${member.category}'.${available} ${ALLOWED_KINDS_HINT}.`,
          "INVALID_SPEC",
          spec.name,
        )
      }
      continue
    }

    const subagentType = member.subagent_type.trim()
    if (subagentType.length === 0) {
      throw new TeamSpecError(
        `Team '${spec.name}' member '${member.name}' has an empty subagent_type. ${ALLOWED_KINDS_HINT}.`,
        "INVALID_SPEC",
        spec.name,
      )
    }
    if (!ports.isKnownAgent(subagentType)) {
      const available = ports.agentNames !== undefined && ports.agentNames.length > 0
        ? ` Available agents: ${[...ports.agentNames].sort().join(", ")}.`
        : ""
      throw new TeamSpecError(
        `Team '${spec.name}' member '${member.name}' references unknown subagent_type '${subagentType}'.${available} ${ALLOWED_KINDS_HINT}.`,
        "INVALID_SPEC",
        spec.name,
      )
    }
  }
}
