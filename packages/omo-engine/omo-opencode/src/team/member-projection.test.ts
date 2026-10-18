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

import { writeMemberTaskMap } from "./member-map"
import { projectMemberStatus, refreshTeamMemberStatuses } from "./member-projection"
import { createStaticMemberPorts, normalizeNativeTeamSpec, toTeamCoreConfig } from "./runtime-config"
import type { MemberStatusSource, MemberTaskStatus } from "./runtime-types"

let baseDir: string
let config: TeamModeConfig

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "omo-member-projection-"))
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

function ports(): ReturnType<typeof createStaticMemberPorts> {
  return createStaticMemberPorts(["quick"], ["worker"])
}

async function activeRuntimeDir(teamSpec: TeamSpec): Promise<{ teamRunId: string; runtimeDir: string }> {
  const created = await createRuntimeState(teamSpec, "lead-session", "user", config)
  const activated = await transitionRuntimeState(
    created.teamRunId,
    (state) => ({ ...state, status: "active" as const }),
    config,
  )
  const runtimeDir = join(baseDir, "runtime", activated.teamRunId)
  return { teamRunId: activated.teamRunId, runtimeDir }
}

class FakeStatusSource implements MemberStatusSource {
  private readonly records = new Map<string, { status: MemberTaskStatus; childSessionId?: string }>()
  private readonly handles = new Map<string, string>()

  set(taskId: string, status: MemberTaskStatus, sessionId?: string): void {
    this.records.set(taskId, sessionId === undefined ? { status } : { status, childSessionId: sessionId })
    if (sessionId !== undefined) this.handles.set(taskId, sessionId)
  }

  get(taskId: string): { status: MemberTaskStatus; childSessionId?: string } | undefined {
    return this.records.get(taskId)
  }

  getResidentHandle(taskId: string): { sessionId: string | undefined } | undefined {
    const sessionId = this.handles.get(taskId)
    return sessionId === undefined ? undefined : { sessionId }
  }
}

describe("projectMemberStatus", () => {
  const cases: ReadonlyArray<readonly [MemberTaskStatus, string]> = [
    ["pending", "pending"],
    ["running", "running"],
    ["suspended", "idle"],
    ["completed", "completed"],
    ["failed", "errored"],
    ["cancelled", "errored"],
    ["lost", "errored"],
  ]

  for (const [taskStatus, memberStatus] of cases) {
    test(`#given task status ${taskStatus} #when projected #then member status is ${memberStatus}`, () => {
      // when / then
      expect(projectMemberStatus(taskStatus)).toBe(memberStatus)
    })
  }
})

describe("refreshTeamMemberStatuses", () => {
  test("#given a member task moved to completed #when refreshed #then the runtime member reflects live status", async () => {
    // given
    void ports()
    const teamSpec = spec()
    const { teamRunId, runtimeDir } = await activeRuntimeDir(teamSpec)
    await writeMemberTaskMap(runtimeDir, { alpha: "task-1" })
    const manager = new FakeStatusSource()
    manager.set("task-1", "completed", "session-9")

    // when
    await refreshTeamMemberStatuses(teamRunId, { manager, config, runtimeDir })

    // then
    const reloaded = await loadRuntimeState(teamRunId, config)
    expect(reloaded.members[0]?.status).toBe("completed")
    expect(reloaded.members[0]?.sessionId).toBe("session-9")
  })

  test("#given a member with no live record #when refreshed #then its status is left alone, never inferred", async () => {
    // given
    const teamSpec = spec()
    const { teamRunId, runtimeDir } = await activeRuntimeDir(teamSpec)
    await writeMemberTaskMap(runtimeDir, { alpha: "task-1" })
    const manager = new FakeStatusSource()

    // when
    await refreshTeamMemberStatuses(teamRunId, { manager, config, runtimeDir })

    // then
    const reloaded = await loadRuntimeState(teamRunId, config)
    expect(reloaded.members[0]?.status).toBe("pending")
    expect(reloaded.members[0]?.sessionId).toBeUndefined()
  })

  test("#given a suspended task #when refreshed #then the member reads idle", async () => {
    // given
    const teamSpec = spec()
    const { teamRunId, runtimeDir } = await activeRuntimeDir(teamSpec)
    await writeMemberTaskMap(runtimeDir, { alpha: "task-1" })
    const manager = new FakeStatusSource()
    manager.set("task-1", "suspended")

    // when
    await refreshTeamMemberStatuses(teamRunId, { manager, config, runtimeDir })

    // then
    const reloaded = await loadRuntimeState(teamRunId, config)
    expect(reloaded.members[0]?.status).toBe("idle")
  })
})
