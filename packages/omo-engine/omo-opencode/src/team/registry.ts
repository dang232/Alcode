import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

import type { TeamSpec } from "../../../team-core/src/types.ts"

import { validateTeamMembers, type TeamMemberPorts } from "./member-validator.ts"
import { normalizeTeamSpec, TeamSpecError } from "./normalize.ts"

export type TeamSpecSource = "project" | "inline"

export type TeamRegistryEntry = {
  readonly name: string
  readonly source: TeamSpecSource
  readonly spec: TeamSpec
}

export type TeamRegistryError = {
  readonly name: string
  readonly source: TeamSpecSource
  readonly code: string
  readonly message: string
}

export type LoadTeamRegistryInput = {
  readonly projectRoot: string
  readonly inlineTeams?: Record<string, unknown>
  readonly ports: TeamMemberPorts
}

export type LoadTeamRegistryResult = {
  readonly teams: readonly TeamRegistryEntry[]
  readonly errors: readonly TeamRegistryError[]
}

function toRegistryError(name: string, source: TeamSpecSource, error: unknown): TeamRegistryError {
  if (error instanceof TeamSpecError) {
    return { name, source, code: error.code, message: error.message }
  }
  return { name, source, code: "UNKNOWN", message: error instanceof Error ? error.message : String(error) }
}

async function readProjectTeamSpecs(projectRoot: string): Promise<readonly { name: string; rawText: string }[]> {
  const teamsDir = join(projectRoot, ".omo", "teams")
  let entries: import("node:fs").Dirent[]
  try {
    entries = await readdir(teamsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const candidates: { name: string; rawText: string }[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const rawText = await readFile(join(teamsDir, entry.name, "config.json"), "utf8")
      candidates.push({ name: entry.name, rawText })
    } catch {
      continue
    }
  }
  return candidates
}

function ingest(
  name: string,
  source: TeamSpecSource,
  rawSpec: unknown,
  ports: TeamMemberPorts,
  teams: TeamRegistryEntry[],
  errors: TeamRegistryError[],
): void {
  try {
    const spec = normalizeTeamSpec(rawSpec, name)
    validateTeamMembers(spec, ports)
    teams.push({ name, source, spec })
  } catch (error) {
    errors.push(toRegistryError(name, source, error))
  }
}

/**
 * Loads named team specs from the two project-scoped sources: the
 * discovery-only `<projectRoot>/.omo/teams/<name>/config.json` directory
 * specs and inline spec records. The directory spec wins on a name
 * collision. Each candidate is normalized and validated against the live
 * vocabulary; a failing team is recorded in `errors` and spawns zero
 * members. This registry only reads specs: runtime state always lives
 * under `<stateDir>/teams`, never under `.omo/teams`.
 */
export async function loadTeamRegistry(input: LoadTeamRegistryInput): Promise<LoadTeamRegistryResult> {
  const teams: TeamRegistryEntry[] = []
  const errors: TeamRegistryError[] = []

  const projectSpecs = await readProjectTeamSpecs(input.projectRoot)
  const projectNames = new Set(projectSpecs.map((candidate) => candidate.name))

  for (const candidate of projectSpecs) {
    let rawSpec: unknown
    try {
      rawSpec = JSON.parse(candidate.rawText)
    } catch (error) {
      errors.push({
        name: candidate.name,
        source: "project",
        code: "INVALID_JSON",
        message: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    ingest(candidate.name, "project", rawSpec, input.ports, teams, errors)
  }

  const inlineTeams = input.inlineTeams ?? {}
  for (const name of Object.keys(inlineTeams)) {
    if (projectNames.has(name)) continue
    ingest(name, "inline", inlineTeams[name], input.ports, teams, errors)
  }

  return { teams, errors }
}
