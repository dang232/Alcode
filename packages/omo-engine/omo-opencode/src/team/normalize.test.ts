import { describe, expect, test } from "bun:test"

import { normalizeTeamSpec, TeamSpecError } from "./normalize.ts"

describe("normalizeTeamSpec", () => {
  test("normalizes a valid spec and pins the lead sentinel", () => {
    const spec = normalizeTeamSpec(
      {
        name: "alpha",
        members: [{ name: "worker-one", kind: "category", category: "general", prompt: "do the assigned work well" }],
      },
      "alpha",
    )

    expect(spec.name).toBe("alpha")
    expect(spec.leadAgentId).toBe("lead")
    expect(spec.members.map((member) => member.name)).toEqual(["worker-one"])
  })

  test("accepts a JSON string spec", () => {
    const spec = normalizeTeamSpec(
      JSON.stringify({
        members: [{ kind: "subagent_type", subagent_type: "sisyphus" }],
      }),
      "beta",
    )

    expect(spec.name).toBe("beta")
    expect(spec.members).toHaveLength(1)
  })

  test("wraps a single member object into a member list", () => {
    const spec = normalizeTeamSpec(
      { members: { kind: "category", category: "general", prompt: "do the assigned work well" } },
      "gamma",
    )

    expect(spec.members).toHaveLength(1)
  })

  test("remaps the agent kind alias onto subagent_type", () => {
    const spec = normalizeTeamSpec(
      { members: [{ name: "w", kind: "agent", agent: "sisyphus" }] },
      "delta",
    )

    const member = spec.members[0]
    expect(member?.kind).toBe("subagent_type")
  })

  test("rejects a raw lead field", () => {
    expect(() => normalizeTeamSpec({ lead: { name: "boss" }, members: [] }, "epsilon")).toThrow(TeamSpecError)
  })

  test("rejects a member named with the lead sentinel", () => {
    expect(() =>
      normalizeTeamSpec(
        { members: [{ name: "lead", kind: "category", category: "general", prompt: "do the assigned work well" }] },
        "zeta",
      ),
    ).toThrow(TeamSpecError)
  })
})
