import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { toTeamCoreConfig } from "./runtime-config"
import {
  ensureTeamRuntimeDirs,
  resolveProjectTeamSpecPath,
  resolveTeamMemberInboxDir,
  resolveTeamRuntimeDirs,
  teamStorageBaseDir,
} from "./storage"

const created: string[] = []

function makeBaseDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-team-storage-"))
  created.push(dir)
  return dir
}

function configFor(baseDir: string): Parameters<typeof teamStorageBaseDir>[0] {
  return toTeamCoreConfig({ max_members: 8, max_parallel_members: 4, max_wall_clock_minutes: 120 }, baseDir)
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe("team storage layout", () => {
  test("#given a base dir config #when resolved #then runtime and tasks dirs live under the base dir", () => {
    // given
    const config = configFor(makeBaseDir())
    const teamRunId = "11111111-1111-1111-1111-111111111111"

    // when
    const dirs = resolveTeamRuntimeDirs(config, teamRunId)

    // then
    expect(dirs.baseDir).toBe(teamStorageBaseDir(config))
    expect(dirs.runtimeDir).toBe(join(dirs.baseDir, "runtime", teamRunId))
    expect(dirs.tasksDir).toBe(join(dirs.baseDir, "runtime", teamRunId, "tasks"))
    expect(resolveTeamMemberInboxDir(config, teamRunId, "finder")).toBe(
      join(dirs.baseDir, "runtime", teamRunId, "inboxes", "finder"),
    )
  })

  test("#given a team run #when runtime dirs are ensured #then the directories are created at the right paths", async () => {
    // given
    const config = configFor(makeBaseDir())
    const teamRunId = "22222222-2222-2222-2222-222222222222"

    // when
    const dirs = await ensureTeamRuntimeDirs(config, teamRunId, ["finder", "quick-1"])

    // then
    expect(existsSync(dirs.runtimeDir)).toBe(true)
    expect(existsSync(dirs.tasksDir)).toBe(true)
    expect(existsSync(resolveTeamMemberInboxDir(config, teamRunId, "finder"))).toBe(true)
    expect(existsSync(resolveTeamMemberInboxDir(config, teamRunId, "quick-1"))).toBe(true)
  })

  test("#given the discovery-only project spec path #when resolved #then it maps to the .omo/teams path", () => {
    // given
    const projectDir = makeBaseDir()

    // when
    const specPath = resolveProjectTeamSpecPath(projectDir, "research-team")

    // then
    expect(specPath).toBe(join(projectDir, ".omo", "teams", "research-team", "config.json"))
    expect(specPath.includes(`${sep}runtime${sep}`)).toBe(false)
  })
})
