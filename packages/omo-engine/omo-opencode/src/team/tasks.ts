/**
 * Native team member operations: team tasklist over team-core.
 *
 * Binds a team-core tasklist to a single native team run: the run id plus the
 * team-core config. Every orchestration call curries these two so callers
 * never re-thread them.
 */
import {
  AlreadyClaimedError as CoreAlreadyClaimedError,
  BlockedByError as CoreBlockedByError,
  CrossOwnerUpdateError as CoreCrossOwnerUpdateError,
  InvalidTaskTransitionError as CoreInvalidTaskTransitionError,
  canClaim,
  claimTask,
  createTask,
  getTask,
  listTasks,
  updateTaskStatus,
} from "../../../team-core/src/team-tasklist/index.ts"
import type { Task } from "../../../team-core/src/types.ts"

import type { TeamModeConfig } from "../../../team-core/src/config.ts"

export {
  CoreAlreadyClaimedError as TeamTaskAlreadyClaimedError,
  CoreBlockedByError as TeamTaskBlockedByError,
  CoreCrossOwnerUpdateError as TeamTaskCrossOwnerUpdateError,
  CoreInvalidTaskTransitionError as TeamTaskInvalidTransitionError,
}

export type TeamTasklistContext = {
  readonly teamRunId: string
  readonly config: TeamModeConfig
}

export type CreateTeamTaskInput = {
  readonly subject: string
  readonly description: string
  readonly status: Task["status"]
  readonly owner?: string
  readonly activeForm?: string
  readonly blocks?: readonly string[]
  readonly blockedBy?: readonly string[]
  readonly metadata?: Record<string, unknown>
}

export type TeamTaskFilter = {
  readonly status?: Task["status"]
  readonly owner?: string
}

export function createTeamTask(ctx: TeamTasklistContext, input: CreateTeamTaskInput): Promise<Task> {
  return createTask(
    ctx.teamRunId,
    {
      subject: input.subject,
      description: input.description,
      status: input.status,
      blocks: [...(input.blocks ?? [])],
      blockedBy: [...(input.blockedBy ?? [])],
      ...(input.owner !== undefined ? { owner: input.owner } : {}),
      ...(input.activeForm !== undefined ? { activeForm: input.activeForm } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    },
    ctx.config,
  )
}

export function listTeamTasks(ctx: TeamTasklistContext, filter?: TeamTaskFilter): Promise<Task[]> {
  return listTasks(ctx.teamRunId, ctx.config, filter)
}

export function getTeamTask(ctx: TeamTasklistContext, taskId: string): Promise<Task> {
  return getTask(ctx.teamRunId, taskId, ctx.config)
}

export function claimTeamTask(ctx: TeamTasklistContext, taskId: string, memberName: string): Promise<Task> {
  return claimTask(ctx.teamRunId, taskId, memberName, ctx.config)
}

export function updateTeamTaskStatus(
  ctx: TeamTasklistContext,
  taskId: string,
  status: Task["status"],
  memberName: string,
): Promise<Task> {
  return updateTaskStatus(ctx.teamRunId, taskId, status, memberName, ctx.config)
}

/**
 * Whether the task's `blockedBy` dependencies are all satisfied (completed or
 * absent), so a member may claim it now. Reads the task and the full run
 * tasklist and applies team-core's `canClaim`.
 */
export async function canClaimTeamTask(ctx: TeamTasklistContext, taskId: string): Promise<boolean> {
  const task = await getTeamTask(ctx, taskId)
  const allTasks = await listTeamTasks(ctx)
  return canClaim(task, allTasks)
}
