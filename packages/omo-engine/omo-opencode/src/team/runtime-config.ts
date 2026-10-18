/**
 * Native team member operations: spec-source resolution and registry loading.
 *
 * Specs come from two project-scoped sources: `<projectRoot>/.omo/teams/<name>/config.json`
 * files and the `omo.json` `teams` section. The project directory wins a name
 * collision. Every failing team lands in `errors` and spawns zero members:
 * the registry never throws for a single bad team.
 */
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import type { TeamModeConfig } from "../../../team-core/src/config.ts"
import { normalizeTeamSpecInput } from "../../../team-core/src/team-registry/index.ts"
import { TeamSpecSchema, type TeamSpec } from "../../../team-core/src/types.ts"
import { isPlainRecord } from "../../../utils/src/record-type-guard.ts"

import { TeamSpecError } from "./errors.ts"
import { resolveProjectTeamSpecPath } from "./storage.ts"

export const TEAM_LEAD_SENTINEL = "lead"

export type TeamSpecSource = "project" | "omo-json"

export type TeamBounds = {
  readonly max_members: number
  readonly max_parallel_members: number
  readonly max_wall_clock_minutes: number
}

export type TeamCoreSpecSource = "project" | "user"

export type NativeMemberPorts = {
  readonly isCategoryResolvable: (category: string) => boolean
  readonly isKnownAgent: (subagentType: string) => boolean
  readonly categoryNames?: readonly string[]
  readonly agentNames?: readonly string[]
}

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
  readonly omoTeams?: Record<string, unknown>
  readonly ports: NativeMemberPorts
}

export type LoadTeamRegistryResult = {
  readonly teams: readonly TeamRegistryEntry[]
  readonly errors: readonly TeamRegistryError[]
}

const TEAM_CORE_TRANSPORT_DEFAULTS = {
  enabled: true,
  tmux_visualization: false,
  max_messages_per_run: 10000,
  max_member_turns: 500,
  message_payload_max_bytes: 32768,
  recipient_unread_max_bytes: 262144,
  mailbox_poll_interval_ms: 3000,
} as const

/**
 * Projects the native `task.team` bounds onto a team-core config, pinning
 * `base_dir` to the native team storage root so team-core writes runtime
 * state under it instead of `~/.omo`.
 */
export function toTeamCoreConfig(bounds: TeamBounds, baseDir: string): TeamModeConfig {
  return {
    ...TEAM_CORE_TRANSPORT_DEFAULTS,
    base_dir: baseDir,
    max_members: bounds.max_members,
    max_parallel_members: bounds.max_parallel_members,
    max_wall_clock_minutes: bounds.max_wall_clock_minutes,
  }
}

/**
 * team-core records spec provenance as "project" | "user"; the native
 * registry distinguishes project spec files from `omo.json` inline specs.
 * Inline specs land in the non-project ("user") slot.
 */
export function toTeamCoreSpecSource(source: TeamSpecSource): TeamCoreSpecSource {
  return source === "project" ? "project" : "user"
}

export function createStaticMemberPorts(
  categories: readonly string[],
  agents: readonly string[],
): NativeMemberPorts {
  const categorySet = new Set(categories)
  const agentSet = new Set(agents)
  return {
    isCategoryResolvable: (category) => categorySet.has(category),
    isKnownAgent: (subagentType) => agentSet.has(subagentType),
    categoryNames: categories,
    agentNames: agents,
  }
}

type RawProjectSpec = {
  readonly name: string
  readonly rawText: string
}

async function readProjectTeamSpecs(projectRoot: string): Promise<readonly RawProjectSpec[]> {
  const teamsDir = join(projectRoot, ".omo", "teams")
  let entries: Array<{ name: string; isDirectory: () => boolean }>
  try {
    entries = await readdir(teamsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const candidates: RawProjectSpec[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const rawText = await readFile(resolveProjectTeamSpecPath(projectRoot, entry.name), "utf8")
      candidates.push({ name: entry.name, rawText })
    } catch {
      continue
    }
  }
  return candidates
}

function coerceStringSpec(rawSpec: unknown, teamName: string): unknown {
  if (typeof rawSpec !== "string") return rawSpec
  try {
    return JSON.parse(rawSpec)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new TeamSpecError(
      `Team '${teamName}' spec is a string that is not valid JSON (${detail}). Pass the spec as an object like { members: [{ name, category|subagent_type, prompt? }] }, or as a valid JSON string of that object.`,
      "INVALID_SPEC",
      teamName,
    )
  }
}

function wrapSingleMember(rawSpec: unknown): unknown {
  if (isPlainRecord(rawSpec) && isPlainRecord(rawSpec.members)) {
    return { ...rawSpec, members: [rawSpec.members] }
  }
  return rawSpec
}

function remapAgentAliasKind(members: readonly unknown[]): unknown[] {
  return members.map((member) => {
    if (isPlainRecord(member) && member.kind === "agent") {
      return { ...member, kind: "subagent_type" }
    }
    return member
  })
}

function assertNoReservedNames(rawSpec: unknown, teamName: string): void {
  if (isPlainRecord(rawSpec) && rawSpec.lead !== undefined && rawSpec.lead !== null) {
    throw new TeamSpecError(
      `Team '${teamName}' declares a 'lead' field. '${TEAM_LEAD_SENTINEL}' is reserved for the current-session sentinel; declare workers under 'members' only.`,
      "RESERVED_LEAD_FIELD",
      teamName,
    )
  }
  if (isPlainRecord(rawSpec) && Array.isArray(rawSpec.members)) {
    for (const member of rawSpec.members) {
      if (isPlainRecord(member) && member.name === TEAM_LEAD_SENTINEL) {
        throw new TeamSpecError(
          `Team '${teamName}' has a member named '${TEAM_LEAD_SENTINEL}', which is reserved for the current-session sentinel. Rename the member.`,
          "RESERVED_LEAD_MEMBER",
          teamName,
        )
      }
    }
  }
}

/**
 * Normalizes one raw native team spec (from an `omo.json` `teams` value or a
 * `.omo/teams/<name>` `config.json`) into a parsed team-core `TeamSpec`.
 *
 * The current session is always the `lead` sentinel and is never a spawnable
 * member, so `leadAgentId` is pinned to the sentinel and team-core's
 * `validateSpec` (which matches the lead to a member) is never called;
 * members are validated against the native vocabulary ports instead.
 */
export function normalizeNativeTeamSpec(rawSpec: unknown, teamName: string): TeamSpec {
  const coerced = wrapSingleMember(coerceStringSpec(rawSpec, teamName))
  assertNoReservedNames(coerced, teamName)
  if (!isPlainRecord(coerced)) {
    throw new TeamSpecError(
      `Team '${teamName}' spec must be an object with a 'members' array.`,
      "INVALID_SPEC",
      teamName,
    )
  }

  const withIdentity: Record<string, unknown> = {
    ...coerced,
    name: typeof coerced.name === "string" ? coerced.name : teamName,
    leadAgentId: TEAM_LEAD_SENTINEL,
  }
  if (Array.isArray(withIdentity.members)) {
    withIdentity.members = remapAgentAliasKind(withIdentity.members)
  }

  const normalized = normalizeTeamSpecInput(withIdentity)
  const parsed = TeamSpecSchema.safeParse(normalized)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    const field = firstIssue?.path.join(".") || undefined
    const message = field !== undefined
      ? `Invalid team spec field '${field}': ${firstIssue.message}`
      : `Invalid team spec: ${parsed.error.message}`
    throw new TeamSpecError(`Team '${teamName}': ${message}`, "INVALID_SPEC", teamName)
  }
  return parsed.data
}

const ALLOWED_KINDS_HINT =
  "member kind must be 'category' (a resolvable delegate category), 'subagent_type' (a known agent definition), or the 'agent' alias for a subagent_type"

/**
 * Validates parsed team members against the native vocabulary. team-core
 * `validateSpec` is deliberately not used: it hard-calls the opencode-roster
 * eligibility registry and rejects the `lead` sentinel.
 */
export function validateNativeTeamMembers(spec: TeamSpec, ports: NativeMemberPorts): void {
  if (spec.members.length > 8) {
    throw new TeamSpecError(
      `Team '${spec.name}' exceeds max 8 members.`,
      "MEMBER_LIMIT_EXCEEDED",
      spec.name,
    )
  }

  for (const member of spec.members) {
    if (member.kind === "category") {
      if (!ports.isCategoryResolvable(member.category)) {
        const available = ports.categoryNames !== undefined && ports.categoryNames.length > 0
          ? ` Available categories: ${[...ports.categoryNames].sort().join(", ")}.`
          : ""
        throw new TeamSpecError(
          `Team '${spec.name}' member '${member.name}' references unknown category '${member.category}'.${available} ${ALLOWED_KINDS_HINT}.`,
          "UNRESOLVABLE_CATEGORY",
          spec.name,
        )
      }
      continue
    }

    if (!ports.isKnownAgent(member.subagent_type)) {
      const available = ports.agentNames !== undefined && ports.agentNames.length > 0
        ? ` Available agents: ${[...ports.agentNames].sort().join(", ")}.`
        : ""
      throw new TeamSpecError(
        `Team '${spec.name}' member '${member.name}' references unknown subagent_type '${member.subagent_type}'.${available} ${ALLOWED_KINDS_HINT}.`,
        "UNKNOWN_SUBAGENT_TYPE",
        spec.name,
      )
    }
  }
}

function toRegistryError(name: string, source: TeamSpecSource, error: unknown): TeamRegistryError {
  if (error instanceof TeamSpecError) {
    return { name, source, code: error.code, message: error.message }
  }
  return { name, source, code: "UNKNOWN", message: error instanceof Error ? error.message : String(error) }
}

function ingest(
  name: string,
  source: TeamSpecSource,
  rawSpec: unknown,
  ports: NativeMemberPorts,
  teams: TeamRegistryEntry[],
  errors: TeamRegistryError[],
): void {
  try {
    const spec = normalizeNativeTeamSpec(rawSpec, name)
    validateNativeTeamMembers(spec, ports)
    teams.push({ name, source, spec })
  } catch (error) {
    errors.push(toRegistryError(name, source, error))
  }
}

/**
 * Loads named team specs from the two project-scoped sources. The project
 * directory beats `omo.json` on a name collision. Each candidate is
 * normalized and vocabulary-checked; a failing team is recorded in `errors`
 * and spawns zero members, while valid teams still load.
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

  const omoTeams = input.omoTeams ?? {}
  for (const name of Object.keys(omoTeams)) {
    if (projectNames.has(name)) continue
    ingest(name, "omo-json", Object.hasOwn(omoTeams, name) ? omoTeams[name] : undefined, input.ports, teams, errors)
  }

  return { teams, errors }
}
