/**
 * Native team member operations: on-disk layout.
 *
 * Runtime state, tasklists, and member inboxes live under the team-core base
 * directory (`base_dir`, defaulting to `~/.omo`); project spec files under
 * `<projectRoot>/.omo/teams/<name>/config.json` are discovery-only and never
 * a runtime-write target.
 */
import { mkdir } from "node:fs/promises"

import type { TeamModeConfig } from "../../../team-core/src/config.ts"
import {
  getInboxDir,
  getRuntimeStateDir,
  getTasksDir,
  getTeamSpecPath,
  resolveBaseDir,
} from "../../../team-core/src/team-registry/index.ts"

export type TeamRuntimeDirs = {
  readonly baseDir: string
  readonly runtimeDir: string
  readonly tasksDir: string
}

export function teamStorageBaseDir(config: TeamModeConfig): string {
  return resolveBaseDir(config)
}

export function resolveTeamRuntimeDirs(config: TeamModeConfig, teamRunId: string): TeamRuntimeDirs {
  const baseDir = resolveBaseDir(config)
  return {
    baseDir,
    runtimeDir: getRuntimeStateDir(baseDir, teamRunId),
    tasksDir: getTasksDir(baseDir, teamRunId),
  }
}

export function resolveTeamMemberInboxDir(
  config: TeamModeConfig,
  teamRunId: string,
  memberName: string,
): string {
  return getInboxDir(resolveBaseDir(config), teamRunId, memberName)
}

/**
 * The `<projectRoot>/.omo/teams/<name>/config.json` path. Discovery-only:
 * it is read for spec discovery and is never a runtime-write target.
 */
export function resolveProjectTeamSpecPath(projectRoot: string, teamName: string): string {
  return getTeamSpecPath(projectRoot, teamName, "project", projectRoot)
}

export async function ensureTeamRuntimeDirs(
  config: TeamModeConfig,
  teamRunId: string,
  memberNames: readonly string[],
): Promise<TeamRuntimeDirs> {
  const dirs = resolveTeamRuntimeDirs(config, teamRunId)
  await mkdir(dirs.runtimeDir, { recursive: true, mode: 0o700 })
  await mkdir(dirs.tasksDir, { recursive: true, mode: 0o700 })
  for (const memberName of memberNames) {
    await mkdir(resolveTeamMemberInboxDir(config, teamRunId, memberName), { recursive: true, mode: 0o700 })
  }
  return dirs
}
