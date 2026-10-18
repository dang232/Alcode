import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createFakeHostClient, callArgs } from "./fake-host-client.ts"
import type { TeamMemberPorts } from "./member-validator.ts"
import { normalizeTeamSpec, TeamSpecError } from "./normalize.ts"
import { createTeam, deleteTeam, requireTeamMember, TeamRuntimeError } from "./runtime.ts"

const directory = process.platform === "win32" ? "I:/work/project" : "/work/project"

const ports: TeamMemberPorts = {
  isCategoryResolvable: (category) => category === "general",
  isKnownAgent: (agent) => agent === "sisyphus",
}

function spec() {
  return normalizeTeamSpec(
    {
      name: "alpha",
      members: [
        { name: "cat", kind: "category", category: "general", prompt: "do the assigned work well" },
        { name: "agt", kind: "subagent_type", subagent_type: "sisyphus" },
      ],
    },
    "alpha",
  )
}

describe("native team runtime", () => {
  test("createTeam spawns real child sessions and persists state under <stateDir>/teams", async () => {
    const fake = createFakeHostClient()
    const stateDir = await mkdtemp(join(tmpdir(), "team-runtime-"))

    const result = await createTeam({
      spec: spec(),
      source: "inline",
      ports,
      parentSessionId: "ses_lead",
      directory,
      stateDir,
      client: fake.client,
    })

    expect(result.runtimeState.status).toBe("active")
    expect(result.runtimeState.leadSessionId).toBe("ses_lead")
    expect(result.members).toHaveLength(2)
    for (const member of result.members) {
      expect(member.sessionId.startsWith("ses_fake_")).toBe(true)
      expect(fake.sessions.has(member.sessionId)).toBe(true)
    }

    const statePath = join(stateDir, "teams", "runtime", result.runtimeState.teamRunId, "state.json")
    expect(existsSync(statePath)).toBe(true)
    const persisted = JSON.parse(await readFile(statePath, "utf8"))
    expect(persisted.status).toBe("active")
    expect(persisted.members.map((member: { sessionId?: string }) => member.sessionId).sort()).toEqual(
      result.members.map((member) => member.sessionId).sort(),
    )
  })

  test("createTeam validates members before spawning anything", async () => {
    const fake = createFakeHostClient()
    const stateDir = await mkdtemp(join(tmpdir(), "team-runtime-"))
    const badSpec = normalizeTeamSpec(
      { name: "alpha", members: [{ name: "w", kind: "subagent_type", subagent_type: "mystery" }] },
      "alpha",
    )

    await expect(
      createTeam({
        spec: badSpec,
        source: "inline",
        ports,
        parentSessionId: "ses_lead",
        directory,
        stateDir,
        client: fake.client,
      }),
    ).rejects.toBeInstanceOf(TeamSpecError)
    expect(fake.sessions.size).toBe(0)
  })

  test("createTeam rejects specs over the member bound", async () => {
    const fake = createFakeHostClient()
    const stateDir = await mkdtemp(join(tmpdir(), "team-runtime-"))

    await expect(
      createTeam({
        spec: spec(),
        source: "inline",
        ports,
        parentSessionId: "ses_lead",
        directory,
        stateDir,
        client: fake.client,
        bounds: { maxMembers: 1 },
      }),
    ).rejects.toMatchObject({ name: "TeamRuntimeError", code: "bounds_exceeded" })
    expect(fake.sessions.size).toBe(0)
  })

  test("deleteTeam cancels every member note-first and removes the runtime dir", async () => {
    const fake = createFakeHostClient()
    const stateDir = await mkdtemp(join(tmpdir(), "team-runtime-"))
    const created = await createTeam({
      spec: spec(),
      source: "inline",
      ports,
      parentSessionId: "ses_lead",
      directory,
      stateDir,
      client: fake.client,
      shutdownReason: undefined,
    })
    const teamRunId = created.runtimeState.teamRunId
    const childIds = created.members.map((member) => member.sessionId)
    const callsBefore = fake.calls.length

    const result = await deleteTeam({
      teamRunId,
      stateDir,
      directory,
      client: fake.client,
      shutdownReason: "team complete",
    })

    expect(result.failed).toEqual([])
    expect([...result.cancelledSessionIds].sort()).toEqual([...childIds].sort())

    const shutdownCalls = fake.calls.slice(callsBefore)
    expect(shutdownCalls.filter((call) => call.method === "synthetic")).toHaveLength(2)
    expect(shutdownCalls.filter((call) => call.method === "interrupt")).toHaveLength(2)
    for (const call of shutdownCalls.filter((call) => call.method === "interrupt")) {
      expect(childIds).toContain(callArgs(call)["sessionID"])
      expect(callArgs(call)["query"]).toMatchObject({ directory })
    }
    const noteTexts = shutdownCalls
      .filter((call) => call.method === "synthetic")
      .map((call) => String(callArgs(call)["text"]))
    for (const text of noteTexts) {
      expect(text).toContain("team complete")
    }

    expect(existsSync(join(stateDir, "teams", "runtime", teamRunId))).toBe(false)

    const second = await deleteTeam({ teamRunId, stateDir, directory, client: fake.client })
    expect(second.cancelledSessionIds).toEqual([])
  })

  test("requireTeamMember errors on unknown members", async () => {
    const fake = createFakeHostClient()
    const stateDir = await mkdtemp(join(tmpdir(), "team-runtime-"))
    const created = await createTeam({
      spec: spec(),
      source: "inline",
      ports,
      parentSessionId: "ses_lead",
      directory,
      stateDir,
      client: fake.client,
    })

    expect(() => requireTeamMember(created.runtimeState, created.runtimeState.teamRunId, "ghost")).toThrow(
      TeamRuntimeError,
    )
  })

  test("runtime state never lands under .omo/teams", async () => {
    const fake = createFakeHostClient()
    const stateDir = await mkdtemp(join(tmpdir(), "team-runtime-"))
    const projectRoot = await mkdtemp(join(tmpdir(), "team-project-"))

    await createTeam({
      spec: spec(),
      source: "inline",
      ports,
      parentSessionId: "ses_lead",
      directory,
      stateDir,
      client: fake.client,
    })

    expect(existsSync(join(projectRoot, ".omo", "teams"))).toBe(false)
    expect(await readdir(join(stateDir, "teams", "runtime"))).toHaveLength(1)
  })
})
