/**
 * dispatch.ts — the `ulw_dispatch` native tool.
 *
 * Records goal dispatches in the native roster (the native counterpart of
 * the CLI loop's `dispatch`: one attempt per pending goal).
 *
 * Two shapes, one tool:
 * - single: `{ runId, goalId, workerSessionId }` records one dispatch
 *   directly; the worker session already exists.
 * - batch: `{ runId, goals: [{ goalId, workerSessionId?, prompt?, agent? }] }`
 *   records every entry that names its worker session, and spawns the rest
 *   — one worker session per goal — through `spawnTeamMembers`, the same
 *   bounded pool `createTeam` in `../../team/runtime.ts` uses. No pool is
 *   re-implemented here: parallelism caps and the shared-index drain live
 *   in that module. Bounds below reuse the `TeamBounds` vocabulary from the
 *   team runtime.
 *
 * No gate is added here. Plan-gate enforcement stays where it belongs: the
 * `tool.execute.before` hook denies gated task dispatches without session
 * evidence, and `spawnTeamMembers` itself refuses gate-only roles and
 * plan-gated members without proof. This tool only passes the call through,
 * so a denial surfaces as the pool's `member_start_rejected` failure and
 * records nothing.
 *
 * The pool needs a host client, which the frozen `OmoCreateTools` contract
 * cannot plumb — so `createTools` wires this tool without one. A batch that
 * must spawn without an injected client is refused with a plain error
 * telling the caller to pass `workerSessionId` per goal instead. Tests
 * inject the fake host client; production fan-out arrives with the client.
 */

import { z } from "zod"

import type { OmoJsonObject, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
import { normalizeTeamSpec } from "../../team/normalize.ts"
import { cancelChildSession } from "../../shared/session-lifecycle.ts"
import {
  spawnTeamMembers,
  type SpawnedMember,
  type SpawnMembersInput,
  type SpawnMembersResult,
  type TeamHostClient,
} from "../../team/spawn-members.ts"
import type { TeamBounds } from "../../team/runtime.ts"
import { invalidInputError, runNotActiveError, runNotFoundError } from "../../ulw/errors.ts"
import { UlwStore } from "../../ulw/store.ts"
import { NonEmptyText, refuseArgs, runIdOf } from "./args.ts"
import { getUlwStore } from "./store-instance.ts"

export const ULW_DISPATCH_NAME = "ulw_dispatch"

export const ULW_DISPATCH_DESCRIPTION =
  "Dispatch ULW goals: record worker sessions, or spawn them through the team pool."

/** Pool bounds in the team runtime's vocabulary; `createTeam` defaults are 4 members and 120 minutes. */
export type UlwDispatchPoolBounds = Pick<TeamBounds, "maxParallelMembers" | "maxWallClockMinutes">

const DEFAULT_POOL_BOUNDS: UlwDispatchPoolBounds = {
  maxParallelMembers: 4,
  maxWallClockMinutes: 120,
}

/** Team specs hold at most 8 members; one batch never exceeds a single team. */
const MAX_BATCH_SPAWNS = 8

const MS_PER_MINUTE = 60_000

export type UlwDispatchDeps = {
  readonly store?: UlwStore
  readonly spawnMembers?: (input: SpawnMembersInput) => Promise<SpawnMembersResult>
  readonly getClient?: () => TeamHostClient | undefined
  readonly bounds?: UlwDispatchPoolBounds
  readonly now?: () => number
}

const SingleDispatchArgs = z.object({
  runId: NonEmptyText,
  goalId: NonEmptyText,
  workerSessionId: NonEmptyText,
})

const BatchGoalSchema = z.object({
  goalId: NonEmptyText,
  workerSessionId: NonEmptyText.optional(),
  prompt: NonEmptyText.optional(),
  agent: NonEmptyText.optional(),
})

const BatchDispatchArgs = z.object({
  runId: NonEmptyText,
  goals: z.array(BatchGoalSchema).min(1),
  maxParallel: z.number().int().min(1).optional(),
})

type UlwDispatchEntry = {
  readonly goalId: string
  readonly memberName: string
  workerSessionId?: string
  prompt?: string
  agent?: string
}

type UlwDispatchRecord = {
  readonly goalId: string
  readonly workerSessionId: string
  readonly workers: readonly string[]
}

function teamNameFor(runId: string): string {
  const slug =
    runId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "run"
  return `ulw-${slug}`
}

/** Maps a goal id onto a unique team member name (`MemberBaseSchema` allows `[a-z0-9-]`). */
function memberNameFor(goalId: string, used: ReadonlySet<string>): string {
  const base =
    goalId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "goal"
  let candidate = base
  let suffix = 2
  const taken = new Set<string>(used)
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

function specPrompt(runId: string, entry: UlwDispatchEntry): string {
  const assignment = `Work ULW goal '${entry.goalId}' for run '${runId}'.`
  if (entry.prompt === undefined) {
    return `${assignment} Complete the assigned work, report back to the lead, then end your turn and wait.`
  }
  return `${assignment}\n\n${entry.prompt}`
}

/** Refuses the batch before any session exists, so invalid runs never orphan workers. */
function requireActiveRun(store: UlwStore, runId: string): void {
  const run = store.getRun(runId)
  if (run === undefined) {
    throw runNotFoundError(runId)
  }
  if (run.status !== "active") {
    throw runNotActiveError(runId, run.status)
  }
}

/**
 * Best-effort rollback of workers this batch spawned: a failed batch must
 * not leave running children behind (the `createTeam` rollback contract).
 * Caller-provided explicit sessions are never cancelled here — only workers
 * this batch spawned. Cancel errors never mask the original failure.
 */
async function rollbackSpawnedWorkers(
  client: TeamHostClient,
  parentSessionId: string,
  directory: string,
  runId: string,
  spawned: ReadonlyMap<string, SpawnedMember>,
): Promise<void> {
  for (const member of spawned.values()) {
    try {
      await cancelChildSession(client, {
        parentSessionID: parentSessionId,
        childSessionID: member.sessionId,
        directory,
        reason: `ulw ${runId} dispatch rollback`,
      })
    } catch {
      // Best-effort: the original dispatch failure travels below.
    }
  }
}

export function createUlwDispatchTool(deps: UlwDispatchDeps = {}): OmoToolDefinition {
  const store = deps.store ?? getUlwStore()
  const spawnMembers = deps.spawnMembers ?? spawnTeamMembers
  const bounds: UlwDispatchPoolBounds = { ...DEFAULT_POOL_BOUNDS, ...deps.bounds }
  const now = deps.now ?? Date.now
  return {
    description: ULW_DISPATCH_DESCRIPTION,
    args: {
      properties: {
        runId: { type: "string", description: "Run that owns the goals." },
        goalId: { type: "string", description: "Single-dispatch goal id." },
        workerSessionId: { type: "string", description: "Single-dispatch worker session id." },
        goals: {
          type: "array",
          description: "Batch goals: [{ goalId, workerSessionId?, prompt?, agent? }].",
        },
        maxParallel: { type: "number", description: "Pool cap for batch spawns; defaults to 4." },
      },
      required: ["runId"],
    },
    execute: async (toolArgs: OmoJsonObject, context: OmoToolContext) => {
      if (toolArgs["goals"] === undefined) {
        const parsed = SingleDispatchArgs.safeParse(toolArgs)
        if (!parsed.success) {
          refuseArgs(runIdOf(toolArgs), "ULW goalId and workerSessionId must be non-empty strings.")
        }
        const workers = store.dispatchGoal(parsed.data.runId, parsed.data.goalId, parsed.data.workerSessionId)
        return JSON.stringify({
          runId: parsed.data.runId,
          goalId: parsed.data.goalId,
          workerSessionId: parsed.data.workerSessionId,
          workers,
        })
      }
      const parsed = BatchDispatchArgs.safeParse(toolArgs)
      if (!parsed.success) {
        refuseArgs(runIdOf(toolArgs), "ULW goals must be a non-empty array of { goalId, workerSessionId?, prompt?, agent? }.")
      }
      const runId = parsed.data.runId
      const used = new Set<string>()
      const entries: UlwDispatchEntry[] = parsed.data.goals.map((goal) => {
        const memberName = memberNameFor(goal.goalId, used)
        used.add(memberName)
        const entry: UlwDispatchEntry = { goalId: goal.goalId, memberName }
        if (goal.workerSessionId !== undefined) entry.workerSessionId = goal.workerSessionId
        if (goal.prompt !== undefined) entry.prompt = goal.prompt
        if (goal.agent !== undefined) entry.agent = goal.agent
        return entry
      })
      const recorded: UlwDispatchRecord[] = []
      const toSpawn = entries.filter((entry) => entry.workerSessionId === undefined)
      const explicit = entries.filter((entry) => entry.workerSessionId !== undefined)
      requireActiveRun(store, runId)
      // Explicit sessions are caller-owned: they are recorded only after any
      // spawn succeeds, so a failed batch records nothing and callers can
      // safely retry (re-recording an explicit dispatch is idempotent).
      let batchClient: TeamHostClient | undefined
      let spawnedByBatch: ReadonlyMap<string, SpawnedMember> = new Map()
      if (toSpawn.length > 0) {
        if (toSpawn.length > MAX_BATCH_SPAWNS) {
          throw invalidInputError(
            runId,
            `ULW batch dispatch spawns at most ${MAX_BATCH_SPAWNS} workers; split the batch.`,
          )
        }
        const client = deps.getClient?.()
        if (client === undefined) {
          const pending = toSpawn.map((entry) => entry.goalId).join(", ")
          throw new Error(
            `ULW run '${runId}': batch dispatch needs a host client to spawn ${toSpawn.length} worker(s) (${pending}); pass workerSessionId per goal to record explicit sessions instead.`,
          )
        }
        batchClient = client
        const teamName = teamNameFor(runId)
        const spec = normalizeTeamSpec(
          {
            name: teamName,
            members: toSpawn.map((entry) =>
              entry.agent === undefined
                ? { name: entry.memberName, kind: "category", category: "general", prompt: specPrompt(runId, entry) }
                : {
                    name: entry.memberName,
                    kind: "subagent_type",
                    subagent_type: entry.agent,
                    prompt: specPrompt(runId, entry),
                  },
            ),
          },
          teamName,
        )
        const result = await spawnMembers({
          spec,
          teamRunId: runId,
          parentSessionId: context.sessionID,
          directory: context.directory,
          client,
          maxParallel: parsed.data.maxParallel ?? bounds.maxParallelMembers,
          deadlineAt: now() + bounds.maxWallClockMinutes * MS_PER_MINUTE,
          now,
        })
        if (result.failure !== undefined) {
          await rollbackSpawnedWorkers(client, context.sessionID, context.directory, runId, result.spawned)
          throw result.failure
        }
        for (const entry of toSpawn) {
          if (!result.spawned.has(entry.memberName)) {
            await rollbackSpawnedWorkers(client, context.sessionID, context.directory, runId, result.spawned)
            throw new Error(
              `ULW run '${runId}': pool returned no session for goal '${entry.goalId}'; nothing was recorded.`,
            )
          }
        }
        spawnedByBatch = result.spawned
      }
      try {
        for (const entry of explicit) {
          const workerSessionId = entry.workerSessionId
          if (workerSessionId === undefined) continue
          recorded.push({
            goalId: entry.goalId,
            workerSessionId,
            workers: store.dispatchGoal(runId, entry.goalId, workerSessionId),
          })
        }
        for (const entry of toSpawn) {
          const spawned = spawnedByBatch.get(entry.memberName)
          if (spawned === undefined) {
            throw new Error(
              `ULW run '${runId}': pool returned no session for goal '${entry.goalId}'; nothing was recorded.`,
            )
          }
          recorded.push({
            goalId: entry.goalId,
            workerSessionId: spawned.sessionId,
            workers: store.dispatchGoal(runId, entry.goalId, spawned.sessionId),
          })
        }
      } catch (error) {
        if (batchClient !== undefined && spawnedByBatch.size > 0) {
          await rollbackSpawnedWorkers(batchClient, context.sessionID, context.directory, runId, spawnedByBatch)
        }
        throw error
      }
      recorded.sort((left, right) => (left.goalId < right.goalId ? -1 : left.goalId > right.goalId ? 1 : 0))
      return JSON.stringify({ runId, dispatches: recorded })
    },
  }
}
