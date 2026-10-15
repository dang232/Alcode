import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { recordChildCompleted, recordChildFailed, recordGoalDispatched } from "../src/dispatch.js";
import { ulwLoopDir } from "../src/paths.js";
import { readUlwLoopPlan, writePlan } from "../src/plan-io.js";
import type { UlwLoopItem, UlwLoopLedgerEntry, UlwLoopPlan } from "../src/types.js";
import { UlwLoopError } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";

async function bootstrapRepo(plan: UlwLoopPlan): Promise<string> {
	const repo = await mkdtemp(join(tmpdir(), "ug-dispatch-"));
	await mkdir(ulwLoopDir(repo), { recursive: true });
	await writePlan(repo, plan);
	return repo;
}

async function ledgerKinds(repo: string): Promise<string[]> {
	const text = await readFile(join(ulwLoopDir(repo), "ledger.jsonl"), "utf8");
	return text
		.trim()
		.split("\n")
		.map((line) => (JSON.parse(line) as UlwLoopLedgerEntry).kind);
}

function makeGoal(overrides: Partial<UlwLoopItem> = {}): UlwLoopItem {
	return {
		id: "G001",
		title: "Survey arch",
		objective: "Survey the architecture",
		status: "pending",
		successCriteria: [],
		attempt: 0,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function makePlan(goals: UlwLoopItem[]): UlwLoopPlan {
	return {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		brief: "Survey.\n",
		briefPath: ".omo/ulw-loop/brief.md",
		goalsPath: ".omo/ulw-loop/goals.json",
		ledgerPath: ".omo/ulw-loop/ledger.jsonl",
		goals,
	};
}

describe("recordGoalDispatched", () => {
	describe("#given a pending goal #when dispatched #then it opens an attempt and records the event", () => {
		it("marks in_progress with attempt and ledger entry", async () => {
			// given
			const repo = await bootstrapRepo(makePlan([makeGoal()]));
			// when
			const { goal, ledgerEntry } = await recordGoalDispatched(repo, { goalId: "G001", childRole: "explorer" });
			// then
			expect(goal.status).toBe("in_progress");
			expect(goal.attempt).toBe(1);
			expect(ledgerEntry.kind).toBe("goal_dispatched");
			expect(await ledgerKinds(repo)).toEqual(["goal_dispatched"]);
		});
	});

	describe("#given a running goal #when dispatched again #then it refuses", () => {
		it("throws NOT_DISPATCHABLE and writes nothing", async () => {
			// given
			const repo = await bootstrapRepo(makePlan([makeGoal()]));
			await recordGoalDispatched(repo, { goalId: "G001" });
			// when
			const attempt = recordGoalDispatched(repo, { goalId: "G001" });
			// then
			await expect(attempt).rejects.toMatchObject({ code: "ULW_LOOP_GOAL_NOT_DISPATCHABLE" });
			expect(await ledgerKinds(repo)).toEqual(["goal_dispatched"]);
		});
	});

	describe("#given an unknown goal #when dispatched #then it reports not found", () => {
		it("throws GOAL_NOT_FOUND", async () => {
			// given
			const repo = await bootstrapRepo(makePlan([makeGoal()]));
			// when
			const attempt = recordGoalDispatched(repo, { goalId: "G999" });
			// then
			await expect(attempt).rejects.toBeInstanceOf(UlwLoopError);
			await expect(attempt).rejects.toMatchObject({ code: "ULW_LOOP_GOAL_NOT_FOUND" });
		});
	});
});

describe("recordChildCompleted", () => {
	describe("#given a dispatched goal #when its child completes #then the goal completes with the result ref", () => {
		it("marks complete and records child_completed", async () => {
			// given
			const repo = await bootstrapRepo(makePlan([makeGoal()]));
			await recordGoalDispatched(repo, { goalId: "G001" });
			// when
			const { goal } = await recordChildCompleted(repo, {
				goalId: "G001",
				childId: "ses_child1",
				resultRef: ".omo/evidence/ulw/ses_x/G001/a0/report.md",
			});
			// then
			expect(goal.status).toBe("complete");
			expect(goal.evidence).toContain("report.md");
			expect(await ledgerKinds(repo)).toEqual(["goal_dispatched", "child_completed"]);
			const plan = await readUlwLoopPlan(repo);
			expect(plan.goals[0]?.status).toBe("complete");
		});
	});

	describe("#given a goal with no open dispatch #when a child completes #then it refuses", () => {
		it("throws NOT_DISPATCHED", async () => {
			// given
			const repo = await bootstrapRepo(makePlan([makeGoal()]));
			// when
			const attempt = recordChildCompleted(repo, { goalId: "G001", childId: "ses_x", resultRef: "r.md" });
			// then
			await expect(attempt).rejects.toMatchObject({ code: "ULW_LOOP_GOAL_NOT_DISPATCHED" });
		});
	});

	describe("#given a dispatched goal #when the result ref is empty #then it refuses", () => {
		it("throws RESULT_REQUIRED and keeps the dispatch open", async () => {
			// given
			const repo = await bootstrapRepo(makePlan([makeGoal()]));
			await recordGoalDispatched(repo, { goalId: "G001" });
			// when
			const attempt = recordChildCompleted(repo, { goalId: "G001", childId: "ses_x", resultRef: "  " });
			// then
			await expect(attempt).rejects.toMatchObject({ code: "ULW_LOOP_CHILD_RESULT_REQUIRED" });
			const plan = await readUlwLoopPlan(repo);
			expect(plan.goals[0]?.status).toBe("in_progress");
		});
	});
});

describe("recordChildFailed", () => {
	describe("#given a dispatched goal #when its child fails #then the goal fails with the reason", () => {
		it("marks failed, keeps retryable, and records child_failed", async () => {
			// given
			const repo = await bootstrapRepo(makePlan([makeGoal()]));
			await recordGoalDispatched(repo, { goalId: "G001" });
			// when
			const { goal } = await recordChildFailed(repo, { goalId: "G001", childId: "ses_x", reason: "timeout" });
			// then
			expect(goal.status).toBe("failed");
			expect(goal.failureReason).toBe("timeout");
			expect(goal.nonRetriable).toBe(false);
			expect(await ledgerKinds(repo)).toEqual(["goal_dispatched", "child_failed"]);
		});
	});

	describe("#given a non-retryable failure #when recorded #then the goal is marked non-retriable", () => {
		it("sets nonRetriable so the scheduler skips it", async () => {
			// given
			const repo = await bootstrapRepo(makePlan([makeGoal()]));
			await recordGoalDispatched(repo, { goalId: "G001" });
			// when
			const { goal } = await recordChildFailed(repo, {
				goalId: "G001",
				childId: "ses_x",
				reason: "bad objective",
				retryable: false,
			});
			// then
			expect(goal.nonRetriable).toBe(true);
		});
	});
});
