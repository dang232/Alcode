import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadTeamRegistry } from "./registry.ts"
import type { TeamMemberPorts } from "./member-validator.ts"

const ports: TeamMemberPorts = {
  isCategoryResolvable: (category) => category === "general",
  isKnownAgent: (agent) => agent === "sisyphus",
}

async function writeProjectSpec(projectRoot: string, name: string, spec: unknown): Promise<void> {
  const dir = join(projectRoot, ".omo", "teams", name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "config.json"), JSON.stringify(spec))
}

describe("loadTeamRegistry", () => {
  test("loads project specs and inline specs, recording failures", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "team-registry-"))
    await writeProjectSpec(projectRoot, "alpha", {
      name: "alpha",
      members: [{ name: "w", kind: "category", category: "general", prompt: "do the assigned work well" }],
    })
    await writeProjectSpec(projectRoot, "broken", {
      name: "broken",
      members: [{ name: "w", kind: "category", category: "missing", prompt: "do the assigned work well" }],
    })

    const result = await loadTeamRegistry({
      projectRoot,
      inlineTeams: {
        beta: {
          members: [{ name: "w", kind: "subagent_type", subagent_type: "sisyphus" }],
        },
        gamma: { members: [] },
      },
      ports,
    })

    expect(result.teams.map((team) => `${team.source}:${team.name}`).sort()).toEqual([
      "inline:beta",
      "project:alpha",
    ])
    expect(result.errors.map((entry) => entry.name).sort()).toEqual(["broken", "gamma"])
  })

  test("prefers the project spec on a name collision", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "team-registry-"))
    await writeProjectSpec(projectRoot, "alpha", {
      name: "alpha",
      members: [{ name: "w", kind: "category", category: "general", prompt: "do the assigned work well" }],
    })

    const result = await loadTeamRegistry({
      projectRoot,
      inlineTeams: {
        alpha: { members: [{ name: "w", kind: "subagent_type", subagent_type: "sisyphus" }] },
      },
      ports,
    })

    expect(result.teams).toHaveLength(1)
    expect(result.teams[0]?.source).toBe("project")
    expect(result.errors).toEqual([])
  })
})
