import { type CheckpointUlwLoopArgs, type CheckpointUlwLoopResult, checkpointUlwLoop } from "./checkpoint.js";
import { checkpointRejectionSignature, consumeCheckpointRetryBudget } from "./checkpoint-retry-budget.js";
import { checkpointTemplate } from "./checkpoint-template.js";
import { hasFlag, parseCodexGoalJson, readValue } from "./cli-arg-parser.js";
import { blockedDecisionHandoff, printJson } from "./cli-output.js";
import { buildCodexGoalInstruction, type UlwLoopGoalInstruction } from "./codex-goal-instruction.js";
import type { UlwLoopScope } from "./paths.js";
import { normalizeUlwLoopSessionId, ulwLoopDir } from "./paths.js";
import { startNextUlwLoop, summarizeUlwLoopPlan } from "./plan-crud.js";
import type { UlwLoopItem, UlwLoopPlan } from "./types.js";
import { UlwLoopError } from "./types.js";

type ContinuationNext =
	| { readonly resumed: boolean; readonly goal: UlwLoopItem; readonly instruction: UlwLoopGoalInstruction }
	| { readonly done: true; readonly blocked: boolean; readonly handoff: string };

export type CheckpointAndContinueResult = CheckpointUlwLoopResult & { readonly next?: ContinuationNext };

export async function checkpointAndContinue(
	repoRoot: string,
	args: CheckpointUlwLoopArgs & { readonly advance: boolean },
	scope?: UlwLoopScope,
): Promise<CheckpointAndContinueResult> {
	const result = await checkpointUlwLoop(repoRoot, args, scope);
	if (args.status !== "complete" || result.aggregateCompletion !== undefined || !args.advance) return result;
	const next = await startNextUlwLoop(repoRoot, {}, scope);
	if ("done" in next) return { ...result, plan: next.plan, next: doneNext(next.plan) };
	const instruction = buildCodexGoalInstruction({ plan: next.plan, goal: next.goal });
	return { ...result, plan: next.plan, next: { resumed: next.resumed, goal: next.goal, instruction } };
}

interface UnresolvedCriterion {
	readonly goalId: string;
	readonly id: string;
	readonly status: string;
}

function unresolvedFrom(error: UlwLoopError, fallbackGoalId: string): UnresolvedCriterion[] {
	const raw = error.details?.["unresolved"];
	if (!Array.isArray(raw)) return [];
	const out: UnresolvedCriterion[] = [];
	for (const item of raw) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		const id = record["id"];
		const status = record["status"];
		if (typeof id !== "string" || typeof status !== "string") continue;
		const goalId = record["goalId"];
		out.push({ goalId: typeof goalId === "string" ? goalId : fallbackGoalId, id, status });
	}
	return out;
}

function sessionOption(scope: UlwLoopScope | undefined): string {
	const normalized = normalizeUlwLoopSessionId(scope?.sessionId);
	return normalized === null ? "" : ` --session-id ${normalized}`;
}

function exhaustedMessage(goalId: string, attempts: number, unresolved: UnresolvedCriterion[], option: string): string {
	const lines = [
		`Checkpoint recovery exhausted for ${goalId}: ${attempts} identical rejections with no state change.`,
		`Unresolved: ${unresolved.map((criterion) => `${criterion.goalId} ${criterion.id} (${criterion.status})`).join(", ")}.`,
		"Stop retrying checkpoint. Resolve exactly one of:",
	];
	for (const criterion of unresolved)
		lines.push(
			`- record evidence: omo-agent-toolkit ulw-loop record-evidence${option} --goal-id ${criterion.goalId} --criterion-id ${criterion.id} --status pass --evidence "<proof>"`,
		);
	lines.push(
		`- revise an incompatible criterion: omo-agent-toolkit ulw-loop steer${option} --kind revise_criterion --goal-id ${goalId} --criterion-id <id> --scenario "<scenario>" --expected-evidence "<proof>" --evidence "<why>" --rationale "<why>"`,
	);
	lines.push(
		"Do not create probe goals to bypass this; record evidence against the existing goals and reuse recorded worker results.",
	);
	lines.push(
		`If genuinely blocked, checkpoint${option} --goal-id ${goalId} --status blocked with the reason instead.`,
	);
	return lines.join("\n");
}

async function checkpointWithRetryBudget(
	repoRoot: string,
	args: CheckpointUlwLoopArgs & { readonly advance: boolean },
	scope?: UlwLoopScope,
): Promise<CheckpointAndContinueResult> {
	try {
		return await checkpointAndContinue(repoRoot, args, scope);
	} catch (error) {
		if (!(error instanceof UlwLoopError) || error.code !== "ulw_loop_criteria_not_all_pass") throw error;
		const unresolved = unresolvedFrom(error, args.goalId);
		const budget = consumeCheckpointRetryBudget(
			ulwLoopDir(repoRoot, scope),
			args.goalId,
			checkpointRejectionSignature(unresolved),
		);
		if (budget.allowed) throw error;
		throw new UlwLoopError(
			exhaustedMessage(args.goalId, budget.attempts, unresolved, sessionOption(scope)),
			"ulw_loop_checkpoint_retry_exhausted",
			{ details: { ...(error.details ?? {}), attempts: budget.attempts } },
		);
	}
}

export async function checkpoint(
	repoRoot: string,
	argv: readonly string[],
	json: boolean,
	scope?: UlwLoopScope,
): Promise<number> {
	if (hasFlag(argv, "--print-template")) {
		const template = await checkpointTemplate(repoRoot, scope, readValue(argv, "--goal-id"));
		if (json) printJson({ ok: true, ...template });
		else printJson(template);
		return 0;
	}
	const goalId = required(argv, "--goal-id");
	const statusValue = checkpointStatus(required(argv, "--status"));
	const evidence = required(argv, "--evidence");
	const codexGoalJson = await parseCodexGoalJson(readValue(argv, "--codex-goal-json"));
	const qualityGateJson = readValue(argv, "--quality-gate-json");
	const args: CheckpointUlwLoopArgs & { readonly advance: boolean } = {
		goalId,
		status: statusValue,
		evidence,
		advance: !hasFlag(argv, "--no-advance"),
		...(codexGoalJson === undefined ? {} : { codexGoalJson }),
		...(qualityGateJson === undefined ? {} : { qualityGateJson }),
	};
	const result = await checkpointWithRetryBudget(repoRoot, args, scope);
	if (json) printJson({ ok: true, ...result, summary: summarizeUlwLoopPlan(result.plan) });
	else printCheckpointText(result);
	return 0;
}

function printCheckpointText(result: CheckpointAndContinueResult): void {
	process.stdout.write(`ulw-loop checkpoint: ${result.goal.id} -> ${result.goal.status}\n`);
	if (result.next === undefined) return;
	if ("instruction" in result.next) process.stdout.write(`${result.next.instruction.text}\n`);
	else process.stdout.write(`${result.next.handoff || "ulw-loop: all goals complete"}\n`);
}

function doneNext(plan: UlwLoopPlan): ContinuationNext {
	const handoff = blockedDecisionHandoff(plan);
	return { done: true, blocked: handoff.length > 0, handoff };
}

function required(argv: readonly string[], flag: string): string {
	const value = readValue(argv, flag)?.trim();
	if (value) return value;
	throw new UlwLoopError(`Missing ${flag}.`, "ULW_LOOP_ARGUMENT_MISSING", { details: { flag } });
}

function checkpointStatus(value: string): CheckpointUlwLoopArgs["status"] {
	if (value === "complete" || value === "failed" || value === "blocked") return value;
	throw new UlwLoopError(
		"Missing or invalid --status; expected complete, failed, or blocked.",
		"ULW_LOOP_STATUS_INVALID",
		{ details: { status: value } },
	);
}
