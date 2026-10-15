import { describe, expect, it } from "vitest";

import { checkpointUlwLoop } from "../src/checkpoint.js";
import { recordChildCompleted, recordGoalDispatched } from "../src/dispatch.js";
import { isUlwLoopDone } from "../src/goal-status.js";
import { criterion, expectCode, goal, lastLedger, plan, repoWith, snapshot } from "./fixtures/checkpoint-builders.js";

function passCriteriaGoal(id: string, status: "pending" | "in_progress" = "pending"): ReturnType<typeof goal> {
	return goal({
		id,
		status,
		successCriteria: [criterion("C001", "pass"), criterion("C002", "pass"), criterion("C003", "pass")],
	});
}

describe("checkpointUlwLoop dispatch settlement gate", () => {
	it("#given a dispatched goal with no child result #when checkpointing it complete #then refuses and writes nothing", async () => {
		// given
		const repo = await repoWith(plan([passCriteriaGoal("G001"), passCriteriaGoal("G002")]));
		await recordGoalDispatched(repo, { goalId: "G001" });
		// when
		await expectCode(
			() =>
				checkpointUlwLoop(repo, {
					goalId: "G001",
					status: "complete",
					evidence: "work done",
					codexGoalJson: snapshot("complete"),
				}),
			"ULW_LOOP_DISPATCHED_CHILDREN_PENDING",
		);
		// then
		expect((await lastLedger(repo)).kind).toBe("goal_dispatched");
	});

	it("#given a dispatched goal whose child completed #when checkpointing it complete #then succeeds", async () => {
		// given
		const repo = await repoWith(plan([passCriteriaGoal("G001"), passCriteriaGoal("G002")]));
		await recordGoalDispatched(repo, { goalId: "G001" });
		await recordChildCompleted(repo, { goalId: "G001", childId: "ses_child1", resultRef: "a0/report.md" });
		// when
		const result = await checkpointUlwLoop(repo, {
			goalId: "G001",
			status: "complete",
			evidence: "work done with collected child result",
			codexGoalJson: snapshot("complete"),
		});
		// then
		expect(result.goal.status).toBe("complete");
		expect((await lastLedger(repo)).kind).toBe("goal_completed");
	});

	it("#given a dispatched goal #when checkpointing it failed directly #then refuses until the child result is recorded", async () => {
		// given
		const repo = await repoWith(plan([passCriteriaGoal("G001"), passCriteriaGoal("G002")]));
		await recordGoalDispatched(repo, { goalId: "G001" });
		// when
		await expectCode(
			() =>
				checkpointUlwLoop(repo, {
					goalId: "G001",
					status: "failed",
					evidence: "work failed",
					codexGoalJson: snapshot("complete"),
				}),
			"ULW_LOOP_DISPATCHED_CHILDREN_PENDING",
		);
		// then
		expect((await lastLedger(repo)).kind).toBe("goal_dispatched");
	});

	it("#given the last dispatched child completed #when finalizing #then the run is done without forcing an aggregate verdict", async () => {
		// given
		const repo = await repoWith(plan([passCriteriaGoal("G001")], { activeGoalId: "G001" }));
		await recordGoalDispatched(repo, { goalId: "G001" });
		await recordChildCompleted(repo, { goalId: "G001", childId: "ses_child1", resultRef: "a0/report.md" });
		// when
		const result = await checkpointUlwLoop(repo, {
			goalId: "G001",
			status: "complete",
			evidence: "final work complete with collected child result",
			codexGoalJson: snapshot("complete"),
		});
		// then
		expect(result.goal.status).toBe("complete");
		expect(isUlwLoopDone(result.plan)).toBe(true);
		expect(result.plan.aggregateCompletion).toBeUndefined();
		expect((await lastLedger(repo)).kind).toBe("goal_completed");
	});
});
