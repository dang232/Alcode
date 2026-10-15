import type { UlwLoopScope } from "./paths.js";
import { commit } from "./plan-commit.js";
import { readUlwLoopPlan, withUlwLoopMutationLock } from "./plan-io.js";
import { DEFAULT_FANOUT_LIMIT } from "./spawn-guard.js";
import type { UlwLoopItem, UlwLoopLedgerEntry, UlwLoopPlan } from "./types.js";
import { iso, UlwLoopError } from "./types.js";

type DispatchArgs = {
	readonly goalId: string;
	readonly childRole?: string;
};

type ChildResultArgs = {
	readonly goalId: string;
	readonly childId: string;
	readonly resultRef: string;
};

type ChildFailureArgs = {
	readonly goalId: string;
	readonly childId: string;
	readonly reason: string;
	readonly retryable?: boolean;
};

function ulwLoopFail(message: string, code: string, details: Record<string, unknown>): never {
	throw new UlwLoopError(message, code, { details });
}

function findGoal(plan: UlwLoopPlan, goalId: string): UlwLoopItem {
	const goal = plan.goals.find((candidate) => candidate.id === goalId);
	return goal ?? ulwLoopFail(`UlwLoop goal not found: ${goalId}.`, "ULW_LOOP_GOAL_NOT_FOUND", { goalId });
}

function requireDispatchable(goal: UlwLoopItem): void {
	if (goal.status !== "pending" || goal.steeringStatus === "superseded" || goal.steeringStatus === "blocked") {
		ulwLoopFail(`UlwLoop goal is not dispatchable: ${goal.id}.`, "ULW_LOOP_GOAL_NOT_DISPATCHABLE", {
			goalId: goal.id,
			status: goal.status,
		});
	}
}

function requireDispatched(goal: UlwLoopItem): void {
	if (goal.status !== "in_progress") {
		ulwLoopFail(`UlwLoop goal has no open dispatch: ${goal.id}.`, "ULW_LOOP_GOAL_NOT_DISPATCHED", {
			goalId: goal.id,
			status: goal.status,
		});
	}
}

function nonEmpty(value: string, message: string, code: string): string {
	const trimmed = value.trim();
	return trimmed || ulwLoopFail(message, code, {});
}

export async function recordGoalDispatched(
	repoRoot: string,
	args: DispatchArgs,
	scope?: UlwLoopScope,
): Promise<{ plan: UlwLoopPlan; goal: UlwLoopItem; ledgerEntry: UlwLoopLedgerEntry }> {
	return withUlwLoopMutationLock(repoRoot, scope, async () => {
		const plan = await readUlwLoopPlan(repoRoot, scope);
		const goal = findGoal(plan, args.goalId);
		requireDispatchable(goal);
		const now = iso();
		goal.status = "in_progress";
		goal.attempt += 1;
		goal.startedAt = now;
		goal.updatedAt = now;
		const role = args.childRole?.trim() ? ` as ${args.childRole.trim()}` : "";
		const entry: UlwLoopLedgerEntry = {
			at: now,
			kind: "goal_dispatched",
			goalId: goal.id,
			status: goal.status,
			message: `Dispatched${role}: attempt ${goal.attempt}`,
		};
		plan.updatedAt = now;
		await commit(repoRoot, scope, { plan, entries: [entry] });
		return { plan, goal, ledgerEntry: entry };
	});
}

export async function recordChildCompleted(
	repoRoot: string,
	args: ChildResultArgs,
	scope?: UlwLoopScope,
): Promise<{ plan: UlwLoopPlan; goal: UlwLoopItem; ledgerEntry: UlwLoopLedgerEntry }> {
	return withUlwLoopMutationLock(repoRoot, scope, async () => {
		const plan = await readUlwLoopPlan(repoRoot, scope);
		const goal = findGoal(plan, args.goalId);
		requireDispatched(goal);
		const resultRef = nonEmpty(
			args.resultRef,
			"Child result reference is required.",
			"ULW_LOOP_CHILD_RESULT_REQUIRED",
		);
		const now = iso();
		goal.status = "complete";
		goal.completedAt = now;
		goal.updatedAt = now;
		goal.evidence = resultRef;
		const entry: UlwLoopLedgerEntry = {
			at: now,
			kind: "child_completed",
			goalId: goal.id,
			status: goal.status,
			message: `Child ${args.childId.trim()} result: ${resultRef}`,
		};
		plan.updatedAt = now;
		await commit(repoRoot, scope, { plan, entries: [entry] });
		return { plan, goal, ledgerEntry: entry };
	});
}

export async function recordChildFailed(
	repoRoot: string,
	args: ChildFailureArgs,
	scope?: UlwLoopScope,
): Promise<{ plan: UlwLoopPlan; goal: UlwLoopItem; ledgerEntry: UlwLoopLedgerEntry }> {
	return withUlwLoopMutationLock(repoRoot, scope, async () => {
		const plan = await readUlwLoopPlan(repoRoot, scope);
		const goal = findGoal(plan, args.goalId);
		requireDispatched(goal);
		const reason = nonEmpty(args.reason, "Child failure reason is required.", "ULW_LOOP_CHILD_REASON_REQUIRED");
		const now = iso();
		goal.status = "failed";
		goal.failedAt = now;
		goal.failureReason = reason;
		goal.nonRetriable = args.retryable === false;
		goal.updatedAt = now;
		const entry: UlwLoopLedgerEntry = {
			at: now,
			kind: "child_failed",
			goalId: goal.id,
			status: goal.status,
			message: `Child ${args.childId.trim()} failed: ${reason}`,
		};
		plan.updatedAt = now;
		await commit(repoRoot, scope, { plan, entries: [entry] });
		return { plan, goal, ledgerEntry: entry };
	});
}

export type DispatchRequestArgs = {
	readonly goalIds?: readonly string[];
	readonly childRole?: string;
};

export type DispatchHandoff = {
	readonly goalId: string;
	readonly attempt: number;
	readonly childRole?: string;
	readonly instruction: { readonly text: string; readonly json: unknown };
};

export type DispatchSkip = {
	readonly goalId: string;
	readonly status: string;
	readonly reason: string;
};

export async function dispatchPendingGoals(
	repoRoot: string,
	args: DispatchRequestArgs,
	scope?: UlwLoopScope,
	buildInstruction?: (plan: UlwLoopPlan, goal: UlwLoopItem) => { readonly text: string; readonly json: unknown },
): Promise<{ handoffs: DispatchHandoff[]; skipped: DispatchSkip[]; plan: UlwLoopPlan }> {
	const role = args.childRole?.trim() || undefined;
	const only = (args.goalIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
	const explicit = only.length > 0;
	const plan = await readUlwLoopPlan(repoRoot, scope);
	const eligible = (goal: UlwLoopItem): boolean =>
		goal.status === "pending" && goal.steeringStatus !== "superseded" && goal.steeringStatus !== "blocked";
	const wanted = (explicit ? only : plan.goals.map((goal) => goal.id)).slice(0, DEFAULT_FANOUT_LIMIT);
	const handoffs: DispatchHandoff[] = [];
	const skipped: DispatchSkip[] = [];
	for (const goalId of wanted) {
		if (!explicit) {
			const current = plan.goals.find((goal) => goal.id === goalId);
			if (current === undefined) {
				skipped.push({ goalId, status: "unknown", reason: "goal not in plan" });
				continue;
			}
			if (!eligible(current)) {
				skipped.push({ goalId, status: current.status, reason: "not dispatchable" });
				continue;
			}
		}
		const record = await recordGoalDispatched(
			repoRoot,
			{ goalId, ...(role === undefined ? {} : { childRole: role }) },
			scope,
		);
		const instruction =
			buildInstruction === undefined
				? {
						text: `Dispatched goal ${record.goal.id}: attempt ${record.goal.attempt}`,
						json: { goalId: record.goal.id },
					}
				: buildInstruction(record.plan, record.goal);
		handoffs.push({
			goalId: record.goal.id,
			attempt: record.goal.attempt,
			...(role === undefined ? {} : { childRole: role }),
			instruction,
		});
	}
	const settled = await readUlwLoopPlan(repoRoot, scope);
	return { handoffs, skipped, plan: settled };
}
