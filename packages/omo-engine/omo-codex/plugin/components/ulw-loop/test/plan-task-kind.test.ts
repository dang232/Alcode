import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createUlwLoopPlan } from "../src/plan-crud.js";
import { makeGoal, seedDefaultSuccessCriteria } from "../src/plan-goal-factory.js";
import { makeGoal as makeSteeredGoal } from "../src/steering-mutations.js";
import type { UlwLoopPlan } from "../src/types.js";

const OBJECTIVE = "Survey the repository layout";

describe("#given no task kind #when seeding default criteria #then the implementation triple is unchanged", () => {
	it("seeds happy, edge, and regression placeholders", () => {
		const criteria = seedDefaultSuccessCriteria(0, OBJECTIVE);

		expect(criteria.map((criterion) => criterion.userModel)).toEqual(["happy", "edge", "regression"]);
		expect(criteria.map((criterion) => criterion.id)).toEqual(["C001", "C002", "C003"]);
		expect(criteria.every((criterion) => criterion.status === "pending")).toBe(true);
		expect(criteria[0]?.scenario).toContain("happy path");
	});
});

describe("#given a readonly task kind #when seeding default criteria #then survey criteria replace the implementation triple", () => {
	it("seeds findings, evidence, and limitations with no happy-path language", () => {
		const criteria = seedDefaultSuccessCriteria(0, OBJECTIVE, { taskKind: "readonly" });

		expect(criteria.map((criterion) => criterion.userModel)).toEqual(["findings", "evidence", "limitations"]);
		expect(criteria.map((criterion) => criterion.id)).toEqual(["C001", "C002", "C003"]);
		expect(criteria.every((criterion) => criterion.status === "pending")).toBe(true);
		expect(
			criteria.map((criterion) => `${criterion.scenario} ${criterion.expectedEvidence}`).join(" "),
		).not.toContain("happy path");
		expect(criteria[0]?.scenario).toContain("findings");
		expect(criteria[2]?.scenario).toContain("limitations");
	});
});

describe("#given a mixed task kind #when seeding default criteria #then both triples are present in order", () => {
	it("seeds six criteria with continuous ids", () => {
		const criteria = seedDefaultSuccessCriteria(0, OBJECTIVE, { taskKind: "mixed" });

		expect(criteria.map((criterion) => criterion.userModel)).toEqual([
			"findings",
			"evidence",
			"limitations",
			"happy",
			"edge",
			"regression",
		]);
		expect(criteria.map((criterion) => criterion.id)).toEqual(["C001", "C002", "C003", "C004", "C005", "C006"]);
	});
});

describe("#given a readonly task kind #when making a goal #then the goal carries the kind and survey criteria", () => {
	it("persists taskKind on the goal", () => {
		const goal = makeGoal("Survey repo", OBJECTIVE, 0, "2026-05-23T00:00:00.000Z", { taskKind: "readonly" });

		expect(goal.taskKind).toBe("readonly");
		expect(goal.successCriteria.map((criterion) => criterion.userModel)).toEqual([
			"findings",
			"evidence",
			"limitations",
		]);
	});

	it("#given no task kind #then the goal stays unmarked with the implementation triple", () => {
		const goal = makeGoal("Build endpoint", "Implement the endpoint", 0, "2026-05-23T00:00:00.000Z");

		expect(goal.taskKind).toBeUndefined();
		expect(goal.successCriteria.map((criterion) => criterion.userModel)).toEqual(["happy", "edge", "regression"]);
	});
});

describe("#given a readonly plan #when creating the plan #then every goal inherits the kind", () => {
	it("stores taskKind on the plan and each goal", async () => {
		const repo = await mkdtemp(join(tmpdir(), "ug-task-kind-"));

		const plan = await createUlwLoopPlan(repo, { brief: "- Survey the repo layout", taskKind: "readonly" });

		expect(plan.taskKind).toBe("readonly");
		expect(plan.goals.length).toBe(1);
		expect(plan.goals[0]?.taskKind).toBe("readonly");
		expect(plan.goals[0]?.successCriteria.map((criterion) => criterion.userModel)).toEqual([
			"findings",
			"evidence",
			"limitations",
		]);
	});
});

describe("#given a readonly plan #when steering adds a subgoal #then the child inherits survey criteria", () => {
	it("seeds the steered child from the plan task kind", () => {
		const plan = { goals: [], taskKind: "readonly" } as unknown as UlwLoopPlan;

		const child = makeSteeredGoal(
			plan,
			{ title: "Survey facet", objective: "Survey one facet" },
			"evidence",
			"2026-05-23T00:00:00.000Z",
			1,
		);

		expect(child.taskKind).toBe("readonly");
		expect(child.successCriteria.map((criterion) => criterion.userModel)).toEqual([
			"findings",
			"evidence",
			"limitations",
		]);
	});
});
