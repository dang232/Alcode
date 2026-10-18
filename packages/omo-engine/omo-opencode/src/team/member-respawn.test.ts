import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import type { TeamModeConfig } from "../../../team-core/src/config.ts"
import {
  createRuntimeState,
  loadRuntimeState,
  transitionRuntimeState,
} from "../../../team-core/src/team-state-store/index.ts"
import type { TeamSpec } from "../../../team-core/src/types.ts"

import { readMemberTaskMap, writeMemberTaskMap } from "./member-map"
import { resolveMemberRespawnLaunch, respawnLostMember } from "./member-respawn"
import { createStaticMemberPorts, normalizeNativeTeamSpec, toTeamCoreConfig } from "./runtime-config"
import { MemberRespawnError } from "./runtime-types"
import type { MemberStartSpec, MemberTaskRecord, MemberTaskStatus } from "./runtime-types"

let baseDir: string
let config: TeamModeConfig

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "omo-member-respawn-"))
  config = toTeamCoreConfig({ max_members: 8, max_parallel_members: 4, max_wall_clock_minutes: 120 }, baseDir)
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

function spec(): TeamSpec {
  return normalizeNativeTeamSpec(
    { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "do work" }] },
    "squad",
  )
}

class FakeManager {
  readonly starts: MemberStartSpec[] = []
  private readonly records = new Map<string, { status: MemberTaskStatus; sessionId?: string }>()
  private next = 2
  failStart?: Error

  set(taskId: string, status: MemberTaskStatus, sessionId?: string): void {
    this.records.set(taskId, sessionId === undefined ? { status } : { status, sessionId })
  }

  async start(startSpec: MemberStartSpec): Promise<{ taskId: string; sessionId?: string }> {
    this.starts.push(startSpec)
    if (this.failStart !== undefined) throw this.failStart
    const taskId = `task-${this.next++}`
    const sessionId = "session-new"
    this.records.set(taskId, { status: "running", sessionId })
    return { taskId, sessionId }
  }

  get(taskId: string): MemberTaskRecord | undefined {
    const record = this.records.get(taskId)
    if (record === undefined) return undefined
    return record.sessionId === undefined
      ? { status: record.status }
      : { status: record.status, childSessionId: record.sessionId }
  }

  getResidentHandle(taskId: string): { sessionId: string | undefined } | undefined {
    const sessionId = this.records.get(taskId)?.sessionId
    return sessionId === undefined ? undefined : { sessionId }
  }
}

async function activeRuntime(): Promise<{ teamRunId: string; runtimeDir: string }> {
  const created = await createRuntimeState(spec(), "lead-session", "user", config)
  await transitionRuntimeState(created.teamRunId, (state) => ({ ...state, status: "active" as const }), config)
  return { teamRunId: created.teamRunId, runtimeDir: join(baseDir, "runtime", created.teamRunId) }
}

describe("respawnLostMember", () => {
  test("#given a member whose task is still live #when respawned #then it is left alone with no recorded loss", async () => {
    // given
    const { teamRunId, runtimeDir } = await activeRuntime()
    await writeMemberTaskMap(runtimeDir, { alpha: "task-1" })
    const manager = new FakeManager()
    manager.set("task-1", "running", "session-1")
    void createStaticMemberPorts(["quick"], [])

    // when
    const result = await respawnLostMember(teamRunId, "alpha", { manager, config, runtimeDir, spec: spec() })

    // then
    expect(result).toEqual({ taskId: "task-1", respawned: false })
    expect(manager.starts).toHaveLength(0)
  })

  test("#given a member whose task failed #when respawned #then one replacement spawns and the loss is recorded", async () => {
    // given
    const { teamRunId, runtimeDir } = await activeRuntime()
    await writeMemberTaskMap(runtimeDir, { alpha: "task-1" })
    const manager = new FakeManager()
    manager.set("task-1", "failed")

    // when
    const result = await respawnLostMember(teamRunId, "alpha", { manager, config, runtimeDir, spec: spec() })

    // then
    expect(result.respawned).toBe(true)
    expect(result.recordedError).toEqual({ previousTaskId: "task-1", status: "failed" })
    expect(manager.starts).toHaveLength(1)
    expect(manager.starts[0]?.name).toBe(`team:${teamRunId}:alpha`)
    expect(manager.starts[0]?.memberEnv?.["OMO_TEAM_MEMBER"]).toBe(`${teamRunId}::alpha`)

    const map = await readMemberTaskMap(runtimeDir)
    expect(map.alpha).toBe(result.taskId)
    const reloaded = await loadRuntimeState(teamRunId, config)
    expect(reloaded.members[0]?.status).toBe("pending")
    expect(reloaded.members[0]?.sessionId).toBe("session-new")
  })

  test("#given a member with no mapped task #when respawned #then the unmapped loss is recorded", async () => {
    // given
    const { teamRunId, runtimeDir } = await activeRuntime()
    const manager = new FakeManager()

    // when
    const result = await respawnLostMember(teamRunId, "alpha", { manager, config, runtimeDir, spec: spec() })

    // then
    expect(result.respawned).toBe(true)
    expect(result.recordedError).toEqual({ previousTaskId: "<unmapped>", status: "unmapped" })
  })

  test("#given a spawn failure #when respawned #then the typed error records the member identity", async () => {
    // given
    const { teamRunId, runtimeDir } = await activeRuntime()
    await writeMemberTaskMap(runtimeDir, { alpha: "task-1" })
    const manager = new FakeManager()
    manager.set("task-1", "lost")
    manager.failStart = new Error("manager refused")

    // when
    const respawn = respawnLostMember(teamRunId, "alpha", { manager, config, runtimeDir, spec: spec() })

    // then
    await expect(respawn).rejects.toThrow(
      expect.objectContaining({ name: "MemberRespawnError", code: "session_unavailable" }),
    )
    try {
      await respawn
    } catch (error) {
      expect(error).toBeInstanceOf(MemberRespawnError)
      expect((error as MemberRespawnError).teamRunId).toBe(teamRunId)
      expect((error as MemberRespawnError).memberName).toBe("alpha")
    }
  })

  test("#given an unknown member #when respawned #then the missing-member error records the identity", async () => {
    // given
    const { teamRunId, runtimeDir } = await activeRuntime()
    const manager = new FakeManager()

    // when / then
    await expect(
      respawnLostMember(teamRunId, "ghost", { manager, config, runtimeDir, spec: spec() }),
    ).rejects.toThrow(expect.objectContaining({ name: "MemberRespawnError", code: "member_missing" }))
  })
})

describe("resolveMemberRespawnLaunch", () => {
  test("#given a mapped member task #when resolved #then trusted extensions and identity are returned", async () => {
    // given
    const { teamRunId, runtimeDir } = await activeRuntime()
    await writeMemberTaskMap(runtimeDir, { alpha: "task-1" })

    // when
    const launch = await resolveMemberRespawnLaunch({ name: "alpha", task_id: "task-1" }, teamRunId, {
      config,
      runtimeDir,
      memberExtension: { entryPath: "/trusted/member.js", inheritedExtensions: ["/provider.js"] },
    })

    // then
    expect(launch.extensions).toEqual(["/trusted/member.js", "/provider.js"])
    expect(launch.memberEnv["OMO_TEAM_MEMBER"]).toBe(`${teamRunId}::alpha`)
    expect(launch.memberEnv["OMO_TEAM_MEMBER_TASK_ID"]).toBe("task-1")
  })

  test("#given a task missing from the member map #when resolved #then the mismatch error records the identity", async () => {
    // given
    const { teamRunId, runtimeDir } = await activeRuntime()
    await writeMemberTaskMap(runtimeDir, { alpha: "task-9" })

    // when / then
    await expect(
      resolveMemberRespawnLaunch({ name: "alpha", task_id: "task-1" }, teamRunId, { config, runtimeDir }),
    ).rejects.toThrow(expect.objectContaining({ name: "MemberRespawnError", code: "task_mapping_mismatch" }))
  })

  test("#given an unknown runtime #when resolved #then the unavailable error is recorded", async () => {
    // when / then
    await expect(
      resolveMemberRespawnLaunch(
        { name: "alpha", task_id: "task-1" },
        "99999999-9999-9999-9999-999999999999",
        { config, runtimeDir: join(baseDir, "runtime", "missing") },
      ),
    ).rejects.toThrow(expect.objectContaining({ name: "MemberRespawnError", code: "runtime_unavailable" }))
  })
})
