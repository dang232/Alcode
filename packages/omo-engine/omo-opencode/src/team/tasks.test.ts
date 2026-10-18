import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { createTeamTask, claimTeamTask, canClaimTeamTask, getTeamTask, listTeamTasks, updateTeamTaskStatus } from "./tasks"
import type { TeamTasklistContext } from "./tasks"
import { toTeamCoreConfig } from "./runtime-config"

const TEAM_RUN_ID = "33333333-3333-3333-3333-333333333333"

let ctx: TeamTasklistContext
let dirs: string[] = []

beforeEach(() => {
  const baseDir = mkdtempSync(join(tmpdir(), "omo-team-tasks-"))
  dirs.push(baseDir)
  ctx = {
    teamRunId: TEAM_RUN_ID,
    config: toTeamCoreConfig({ max_members: 8, max_parallel_members: 4, max_wall_clock_minutes: 120 }, baseDir),
  }
})

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe("team tasklist", () => {
  test("#given a created task #when claimed and progressed #then the owner and status track the member", async () => {
    // given
    const created = await createTeamTask(ctx, {
      subject: "write code",
      description: "write the code",
      status: "pending",
    })

    // when
    const claimed = await claimTeamTask(ctx, created.id, "alpha")
    const progressed = await updateTeamTaskStatus(ctx, created.id, "in_progress", "alpha")

    // then
    expect(claimed.status).toBe("claimed")
    expect(claimed.owner).toBe("alpha")
    expect(progressed.status).toBe("in_progress")
    expect((await listTeamTasks(ctx)).map((task) => task.id)).toEqual([created.id])
    expect((await getTeamTask(ctx, created.id)).status).toBe("in_progress")
  })

  test("#given a blocked task #when claimability is checked #then it cannot be claimed until the blocker completes", async () => {
    // given
    const blocker = await createTeamTask(ctx, {
      subject: "blocker",
      description: "must finish first",
      status: "pending",
    })
    const blocked = await createTeamTask(ctx, {
      subject: "blocked",
      description: "waits on blocker",
      status: "pending",
      blockedBy: [blocker.id],
    })

    // when / then
    expect(await canClaimTeamTask(ctx, blocked.id)).toBe(false)
    await expect(claimTeamTask(ctx, blocked.id, "alpha")).rejects.toThrow(
      expect.objectContaining({ name: "BlockedByError" }),
    )

    // when the blocker completes
    await claimTeamTask(ctx, blocker.id, "alpha")
    await updateTeamTaskStatus(ctx, blocker.id, "in_progress", "alpha")
    await updateTeamTaskStatus(ctx, blocker.id, "completed", "alpha")

    // then
    expect(await canClaimTeamTask(ctx, blocked.id)).toBe(true)
  })

  test("#given a completed task #when moved backwards #then the transition is rejected", async () => {
    // given
    const created = await createTeamTask(ctx, {
      subject: "once",
      description: "finish once",
      status: "pending",
    })
    await claimTeamTask(ctx, created.id, "alpha")
    await updateTeamTaskStatus(ctx, created.id, "in_progress", "alpha")
    await updateTeamTaskStatus(ctx, created.id, "completed", "alpha")

    // when / then
    await expect(updateTeamTaskStatus(ctx, created.id, "claimed", "alpha")).rejects.toThrow(
      expect.objectContaining({ name: "InvalidTaskTransitionError" }),
    )
  })

  test("#given a task owned by another member #when updated #then the cross-owner update is rejected", async () => {
    // given
    const created = await createTeamTask(ctx, {
      subject: "mine",
      description: "owned by alpha",
      status: "pending",
    })
    await claimTeamTask(ctx, created.id, "alpha")

    // when / then
    await expect(updateTeamTaskStatus(ctx, created.id, "in_progress", "beta")).rejects.toThrow(
      expect.objectContaining({ name: "CrossOwnerUpdateError" }),
    )
  })
})
