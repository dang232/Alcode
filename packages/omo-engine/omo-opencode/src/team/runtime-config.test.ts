import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import {
  TEAM_LEAD_SENTINEL,
  createStaticMemberPorts,
  loadTeamRegistry,
  normalizeNativeTeamSpec,
  toTeamCoreConfig,
  toTeamCoreSpecSource,
  validateNativeTeamMembers,
} from "./runtime-config"
import { TeamSpecError } from "./errors"

const created: string[] = []

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-team-registry-"))
  created.push(dir)
  return dir
}

function writeProjectSpec(projectDir: string, name: string, spec: unknown): void {
  const dir = join(projectDir, ".omo", "teams", name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "config.json"), JSON.stringify(spec), "utf8")
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe("toTeamCoreConfig", () => {
  test("#given native bounds #when converted #then the team-core config carries the bounds and base dir", () => {
    // when
    const config = toTeamCoreConfig(
      { max_members: 5, max_parallel_members: 2, max_wall_clock_minutes: 30 },
      "/tmp/state/teams",
    )

    // then
    expect(config.base_dir).toBe("/tmp/state/teams")
    expect(config.max_members).toBe(5)
    expect(config.max_parallel_members).toBe(2)
    expect(config.max_wall_clock_minutes).toBe(30)
  })

  test("#given defaults #when converted #then transport fields keep team-core defaults", () => {
    // when
    const config = toTeamCoreConfig(
      { max_members: 8, max_parallel_members: 4, max_wall_clock_minutes: 120 },
      "/tmp/base",
    )

    // then
    expect(config.enabled).toBe(true)
    expect(config.tmux_visualization).toBe(false)
    expect(config.max_messages_per_run).toBe(10000)
  })
})

describe("toTeamCoreSpecSource", () => {
  test("#given a project source #when mapped #then it stays project", () => {
    expect(toTeamCoreSpecSource("project")).toBe("project")
  })

  test("#given an omo-json source #when mapped #then it maps to the user slot", () => {
    expect(toTeamCoreSpecSource("omo-json")).toBe("user")
  })
})

describe("normalizeNativeTeamSpec", () => {
  test("#given a raw spec #when normalized #then the lead sentinel is pinned and members parse", () => {
    // when
    const spec = normalizeNativeTeamSpec(
      { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "do work" }] },
      "squad",
    )

    // then
    expect(spec.name).toBe("squad")
    expect(spec.leadAgentId).toBe(TEAM_LEAD_SENTINEL)
    expect(spec.members.map((member) => member.name)).toEqual(["alpha"])
  })

  test("#given a member named lead #when normalized #then the reserved-name error is thrown", () => {
    // when / then
    expect(() =>
      normalizeNativeTeamSpec(
        { members: [{ name: "lead", kind: "category", category: "quick", prompt: "do work" }] },
        "squad",
      ),
    ).toThrow(expect.objectContaining({ name: "TeamSpecError", code: "RESERVED_LEAD_MEMBER" }))
  })

  test("#given an unknown category #when validated #then the vocabulary error names the member", () => {
    // given
    const spec = normalizeNativeTeamSpec(
      { members: [{ name: "alpha", kind: "category", category: "nope", prompt: "do work" }] },
      "squad",
    )

    // when / then
    expect(() => validateNativeTeamMembers(spec, createStaticMemberPorts(["quick"], []))).toThrow(
      expect.objectContaining({ name: "TeamSpecError", code: "UNRESOLVABLE_CATEGORY" }),
    )
  })

  test("#given an unknown agent #when validated #then the vocabulary error names the member", () => {
    // given
    const spec = normalizeNativeTeamSpec(
      { members: [{ name: "alpha", kind: "subagent_type", subagent_type: "nope" }] },
      "squad",
    )

    // when / then
    expect(() => validateNativeTeamMembers(spec, createStaticMemberPorts([], ["worker"]))).toThrow(
      expect.objectContaining({ name: "TeamSpecError", code: "UNKNOWN_SUBAGENT_TYPE" }),
    )
  })
})

describe("loadTeamRegistry", () => {
  const ports = (): ReturnType<typeof createStaticMemberPorts> =>
    createStaticMemberPorts(["quick"], ["worker"])

  test("#given a project spec colliding with omo.json #when loaded #then the project spec wins", async () => {
    // given
    const projectDir = makeProjectDir()
    writeProjectSpec(projectDir, "squad", {
      members: [{ name: "from-project", kind: "category", category: "quick", prompt: "do work" }],
    })
    const omoTeams = {
      squad: { members: [{ name: "from-omo-json", kind: "category", category: "quick", prompt: "do work" }] },
    }

    // when
    const { teams, errors } = await loadTeamRegistry({ projectRoot: projectDir, omoTeams, ports: ports() })

    // then
    expect(errors).toEqual([])
    expect(teams.map((team) => team.name)).toEqual(["squad"])
    expect(teams[0]?.source).toBe("project")
    expect(teams[0]?.spec.members.map((member) => member.name)).toEqual(["from-project"])
  })

  test("#given one failing and one valid team #when loaded #then the failure lands in errors and spawns zero members", async () => {
    // given
    const projectDir = makeProjectDir()
    const omoTeams = {
      broken: { members: [{ name: "alpha", kind: "category", category: "missing", prompt: "do work" }] },
      fine: { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "do work" }] },
    }

    // when
    const { teams, errors } = await loadTeamRegistry({ projectRoot: projectDir, omoTeams, ports: ports() })

    // then
    expect(teams.map((team) => team.name)).toEqual(["fine"])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ name: "broken", source: "omo-json", code: "UNRESOLVABLE_CATEGORY" })
  })

  test("#given malformed project JSON #when loaded #then an invalid-json error is recorded", async () => {
    // given
    const projectDir = makeProjectDir()
    const dir = join(projectDir, ".omo", "teams", "bad")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "config.json"), "{ nope", "utf8")

    // when
    const { teams, errors } = await loadTeamRegistry({ projectRoot: projectDir, ports: ports() })

    // then
    expect(teams).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe("INVALID_JSON")
  })

  test("#given a spec error #when inspected #then it carries the typed code", () => {
    // when
    const error = new TeamSpecError("x", "TEAM_SPEC_NOT_FOUND", "ghost")

    // then
    expect(error.code).toBe("TEAM_SPEC_NOT_FOUND")
    expect(error.teamName).toBe("ghost")
  })
})
