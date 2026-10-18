/**
 * Native team member operations: member identity and session mapping.
 *
 * Each member maps to the runtime-lane task that backs it. The map lives in a
 * sidecar next to the team-core runtime state so recovery can find member
 * tasks without holding process-only state. Member task names carry the
 * `team:<teamRunId>:<memberName>` identity used to join a task back to its
 * member.
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { atomicWrite } from "../../../team-core/src/team-state-store/locks.ts"
import type { RuntimeState } from "../../../team-core/src/types.ts"

export type MemberTaskMap = Readonly<Record<string, string>>

export type TeamMemberTaskIdentity = {
  readonly teamRunId: string
  readonly memberName: string
}

const MEMBER_MAP_FILE = "member-tasks.json"

export function memberTaskMapPath(runtimeDir: string): string {
  return join(runtimeDir, MEMBER_MAP_FILE)
}

/**
 * Atomically writes the member -> task map: team-core's atomic write stages a
 * uniquely-named temp sibling then renames it over the target, so a crash
 * mid-write never leaves a torn or partial map on disk.
 */
export async function writeMemberTaskMap(runtimeDir: string, map: MemberTaskMap): Promise<void> {
  await atomicWrite(memberTaskMapPath(runtimeDir), `${JSON.stringify(map, null, 2)}\n`)
}

/**
 * Reads the sidecar map. A missing file or malformed content yields an empty
 * map so callers treat a fresh or corrupted runtime dir as "no members
 * recorded" instead of throwing.
 */
export async function readMemberTaskMap(runtimeDir: string): Promise<MemberTaskMap> {
  try {
    const raw = await readFile(memberTaskMapPath(runtimeDir), "utf8")
    const parsed: unknown = JSON.parse(raw)
    return isStringRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  return Object.values(value).every((entry) => typeof entry === "string")
}

export function memberTaskName(teamRunId: string, memberName: string): string {
  return `team:${teamRunId}:${memberName}`
}

const MEMBER_TASK_NAME_PATTERN = /^team:([0-9a-f-]{36}):([a-z0-9-]+)$/

export function parseTeamMemberTaskIdentity(name: string | undefined): TeamMemberTaskIdentity | undefined {
  if (name === undefined) return undefined
  const match = MEMBER_TASK_NAME_PATTERN.exec(name)
  const teamRunId = match?.[1]
  const memberName = match?.[2]
  return teamRunId === undefined || memberName === undefined ? undefined : { teamRunId, memberName }
}

/**
 * Projects the runtime state's best-known member -> session mapping: every
 * member that currently carries a session id. Members without a session are
 * absent, never inferred.
 */
export function memberSessionMap(state: RuntimeState): Readonly<Record<string, string>> {
  const map: Record<string, string> = {}
  for (const member of state.members) {
    if (member.sessionId !== undefined) {
      map[member.name] = member.sessionId
    }
  }
  return map
}
