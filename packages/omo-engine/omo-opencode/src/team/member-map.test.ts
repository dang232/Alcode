import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { createRuntimeState, transitionRuntimeState } from "../../../team-core/src/team-state-store/index.ts"

import { memberSessionMap, memberTaskMapPath, parseTeamMemberTaskIdentity, readMemberTaskMap, writeMemberTaskMap } from "./member-map"
import { createStaticMemberPorts, normalizeNativeTeamSpec, toTeamCoreConfig } from "./runtime-config"

let baseDir: string
let runtimeDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "omo-member-map-"))
  runtimeDir = mkdtempSync(join(tmpdir(), "omo-member-map-runtime-"))
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
  rmSync(runtimeDir, { recursive: true, force: true })
})

describe("member task map sidecar", () => {
  test("#given a written map #when read back #then the member -> task mapping round-trips", async () => {
    // given
    await writeMemberTaskMap(runtimeDir, { alpha: "task-1", beta: "task-2" })

    // when
    const map = await readMemberTaskMap(runtimeDir)

    // then
    expect(map).toEqual({ alpha: "task-1", beta: "task-2" })
    expect(memberTaskMapPath(runtimeDir).endsWith("member-tasks.json")).toBe(true)
  })

  test("#given no sidecar file #when read #then an empty map is returned", async () => {
    // when
    const map = await readMemberTaskMap(runtimeDir)

    // then
    expect(map).toEqual({})
  })

  test("#given a malformed sidecar #when read #then an empty map is returned", async () => {
    // given
    writeFileSync(memberTaskMapPath(runtimeDir), "{ not json", "utf8")

    // when
    const map = await readMemberTaskMap(runtimeDir)

    // then
    expect(map).toEqual({})
  })

  test("#given a completed write #when the directory is listed #then no temp file remains", async () => {
    // given
    await writeMemberTaskMap(runtimeDir, { alpha: "task-1" })

    // when
    const entries = readdirSync(runtimeDir)

    // then
    expect(entries).toEqual(["member-tasks.json"])
  })
})

describe("member task identity", () => {
  test("#given a member task name #when parsed #then the team run and member round-trip", () => {
    // when
    const identity = parseTeamMemberTaskIdentity("team:11111111-1111-1111-1111-111111111111:alpha")

    // then
    expect(identity).toEqual({ teamRunId: "11111111-1111-1111-1111-111111111111", memberName: "alpha" })
  })

  test("#given a non-member name #when parsed #then no identity is returned", () => {
    // when / then
    expect(parseTeamMemberTaskIdentity("something-else")).toBeUndefined()
    expect(parseTeamMemberTaskIdentity(undefined)).toBeUndefined()
  })
})

describe("member session map", () => {
  test("#given members without sessions #when projected #then the map is empty", async () => {
    // given
    const config = toTeamCoreConfig({ max_members: 8, max_parallel_members: 4, max_wall_clock_minutes: 120 }, baseDir)
    const ports = createStaticMemberPorts(["quick"], ["worker"])
    const spec = normalizeNativeTeamSpec(
      { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "do work" }] },
      "squad",
    )
    const created = await createRuntimeState(spec, "lead-session", "user", config)
    void ports

    // when
    const map = memberSessionMap(created)

    // then
    expect(map).toEqual({})
  })

  test("#given a member with a session #when projected #then the member maps to its session", async () => {
    // given
    const config = toTeamCoreConfig({ max_members: 8, max_parallel_members: 4, max_wall_clock_minutes: 120 }, baseDir)
    const spec = normalizeNativeTeamSpec(
      { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "do work" }] },
      "squad",
    )
    const created = await createRuntimeState(spec, "lead-session", "user", config)
    const withSession = await transitionRuntimeState(
      created.teamRunId,
      (state) => ({
        ...state,
        members: state.members.map((member) => ({ ...member, sessionId: "session-1" })),
      }),
      config,
    )

    // when
    const map = memberSessionMap(withSession)

    // then
    expect(map).toEqual({ alpha: "session-1" })
  })
})
