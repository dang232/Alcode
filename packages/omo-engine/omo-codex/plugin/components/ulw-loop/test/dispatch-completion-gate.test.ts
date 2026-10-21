import { describe, expect, it } from "vitest";

import { recordChildCompleted, recordGoalDispatched } from "../src/dispatch.js";
import { readUlwLoopPlan } from "../src/plan-io.js";
import { criterion, expectCode, goal, lastLedger, plan, repoWith } from "./fixtures/checkpoint-builders.js";

describe("recordChildCompleted completion gate", () => {
	it("#given a dispatched goal with unresolved criteria #when recording the child result #then refuses and leaves the goal open", async () => {
		// given
		const repo = await repoWith(
			plan([
				goal({
					id: "G001",
					status: "pending",
					successCriteria: [criterion("C001", "pending"), criterion("C002", "pass")],
				}),
			]),
		);
		await recordGoalDispatched(repo, { goalId: "G001" });
		// when
		await expectCode(
			() => recordChildCompleted(repo, { goalId: "G001", childId: "ses_child1", resultRef: "a0/report.md" }),
			"ulw_loop_criteria_not_all_pass",
		);
		// then
		expect((await lastLedger(repo)).kind).toBe("goal_dispatched");
		const reread = await readUlwLoopPlan(repo);
		expect(reread.goals.find((candidate) => candidate.id === "G001")?.status).toBe("in_progress");
	});

	it("#given a goal with stale failure metadata #when the child result completes it #then the failure fields are cleared", async () => {
		// given
		const repo = await repoWith(
			plan([
				goal({
					id: "G001",
					status: "pending",
					successCriteria: [criterion("C001", "pass")],
					failedAt: "2026-10-21T00:00:00.000Z",
					failureReason: "earlier attempt failed",
					nonRetriable: true,
				}),
			]),
		);
		await recordGoalDispatched(repo, { goalId: "G001" });
		// when
		const result = await recordChildCompleted(repo, {
			goalId: "G001",
			childId: "ses_child2",
			resultRef: "a1/report.md",
		});
		// then
		expect(result.goal.status).toBe("complete");
		expect(result.goal).not.toHaveProperty("failedAt");
		expect(result.goal).not.toHaveProperty("failureReason");
		expect(result.goal).not.toHaveProperty("nonRetriable");
	});
});
