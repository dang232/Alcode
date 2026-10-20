import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import type { TeamModeConfig } from "../../../team-core/src/config.ts"
import type { TeamSessionContext } from "../../../team-core/src/session-client.ts"
import {
  createRuntimeState,
  loadRuntimeState,
  transitionRuntimeState,
} from "../../../team-core/src/team-state-store/index.ts"
import type { TeamSpec } from "../../../team-core/src/types.ts"

import { writeMemberTaskMap } from "./member-map"
import { reviveFinishedResident } from "./member-revival"
import { normalizeNativeTeamSpec, toTeamCoreConfig } from "./runtime-config"

let baseDir: string
let config: TeamModeConfig

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "omo-member-revival-"))
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

function sessionContext(liveIds: readonly string[]): TeamSessionContext {
  return {
    client: {
      session: {
        get: async (input: { path: { id: string } }) =>
          liveIds.includes(input.path.id)
            ? { data: { id: input.path.id } }
            : { error: { status: 404, message: "session not found" } },
      },
    },
  }
}

async function finishedRuntime(sessionId?: string): Promise<{ teamRunId: string; runtimeDir: string }> {
  const created = await createRuntimeState(spec(), "lead-session", "user", config)
  await transitionRuntimeState(
    created.teamRunId,
    (state) => ({
      ...state,
      status: "active" as const,
      members: state.members.map((member) => ({
        ...member,
        status: "completed" as const,
        ...(sessionId !== undefined ? { sessionId } : {}),
      })),
    }),
    config,
  )
  return { teamRunId: created.teamRunId, runtimeDir: join(baseDir, "runtime", created.teamRunId) }
}

describe("reviveFinishedResident", () => {
  test("#given a completed member with a live session #when revived #then it returns to running", async () => {
    // given
    const { teamRunId, runtimeDir } = await finishedRuntime("session-live")
    const sessions = sessionContext(["session-live"])

    // when
    const result = await reviveFinishedResident(teamRunId, "alpha", { sessions, config, runtimeDir })

    // then
    expect(result).toEqual({ memberName: "alpha", sessionId: "session-live" })
    const reloaded = await loadRuntimeState(teamRunId, config)
    expect(reloaded.members[0]?.status).toBe("running")
    expect(reloaded.members[0]?.sessionId).toBe("session-live")
  })

  test("#given a completed member whose session is gone #when revived #then the unavailable error records the member", async () => {
    // given
    const { teamRunId, runtimeDir } = await finishedRuntime("session-gone")
    const sessions = sessionContext([])

    // when / then
    await expect(
      reviveFinishedResident(teamRunId, "alpha", { sessions, config, runtimeDir }),
    ).rejects.toThrow(expect.objectContaining({ name: "MemberRevivalError", code: "session_unavailable" }))
    const reloaded = await loadRuntimeState(teamRunId, config)
    expect(reloaded.members[0]?.status).toBe("completed")
  })

  test("#given a live member #when revived #then the not-finished error is thrown", async () => {
    // given
    const created = await createRuntimeState(spec(), "lead-session", "user", config)
    await transitionRuntimeState(
      created.teamRunId,
      (state) => ({ ...state, status: "active" as const }),
      config,
    )
    const runtimeDir = join(baseDir, "runtime", created.teamRunId)
    const sessions = sessionContext(["session-live"])

    // when / then
    await expect(
      reviveFinishedResident(created.teamRunId, "alpha", { sessions, config, runtimeDir }),
    ).rejects.toThrow(expect.objectContaining({ name: "MemberRevivalError", code: "member_not_finished" }))
  })

  test("#given a session known only to the live manager channel #when revived #then the handle is adopted", async () => {
    // given
    const { teamRunId, runtimeDir } = await finishedRuntime()
    await writeMemberTaskMap(runtimeDir, { alpha: "task-1" })
    const sessions = sessionContext(["session-adopted"])
    const manager = {
      get: (_taskId: string) => ({ status: "completed" as const, childSessionId: "session-adopted" as string | undefined }),
      getResidentHandle: (_taskId: string) => ({ sessionId: "session-adopted" as string | undefined }),
    }

    // when
    const result = await reviveFinishedResident(teamRunId, "alpha", { sessions, manager, config, runtimeDir })

    // then
    expect(result.sessionId).toBe("session-adopted")
    const reloaded = await loadRuntimeState(teamRunId, config)
    expect(reloaded.members[0]?.status).toBe("running")
  })
})
