import { describe, expect, test } from "bun:test"

import { validateTeamMembers, type TeamMemberPorts } from "./member-validator.ts"
import { normalizeTeamSpec, TeamSpecError } from "./normalize.ts"

const ports: TeamMemberPorts = {
  isCategoryResolvable: (category) => category === "general",
  isKnownAgent: (agent) => agent === "sisyphus",
  categoryNames: ["general"],
  agentNames: ["sisyphus"],
}

describe("validateTeamMembers", () => {
  test("accepts known categories and agents", () => {
    const spec = normalizeTeamSpec(
      {
        name: "alpha",
        members: [
          { name: "cat", kind: "category", category: "general", prompt: "do the assigned work well" },
          { name: "agt", kind: "subagent_type", subagent_type: "sisyphus" },
        ],
      },
      "alpha",
    )

    expect(() => validateTeamMembers(spec, ports)).not.toThrow()
  })

  test("rejects an unresolvable category", () => {
    const spec = normalizeTeamSpec(
      {
        name: "alpha",
        members: [{ name: "cat", kind: "category", category: "nope", prompt: "do the assigned work well" }],
      },
      "alpha",
    )

    expect(() => validateTeamMembers(spec, ports)).toThrow(TeamSpecError)
  })

  test("rejects an unknown subagent_type", () => {
    const spec = normalizeTeamSpec(
      {
        name: "alpha",
        members: [{ name: "agt", kind: "subagent_type", subagent_type: "mystery" }],
      },
      "alpha",
    )

    expect(() => validateTeamMembers(spec, ports)).toThrow(TeamSpecError)
  })

  test("rejects a category prompt that is too short", () => {
    const spec = normalizeTeamSpec(
      {
        name: "alpha",
        members: [{ name: "cat", kind: "category", category: "general", prompt: "long enough prompt here" }],
      },
      "alpha",
    )
    spec.members[0] = { ...(spec.members[0] as object), prompt: "short" } as never

    expect(() => validateTeamMembers(spec, ports)).toThrow(TeamSpecError)
  })
})
