import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createAgentToolkit } from "../src/sdk.js";

describe("agent toolkit dispatch operations", () => {
	it("#given a toolkit #when dispatch then child result round-trips #then the goal completes", async () => {
		// given
		const cwd = await mkdtemp(join(tmpdir(), "ulw-sdk-dispatch-"));
		try {
			const toolkit = createAgentToolkit({ cwd, sessionId: "sdk-roundtrip", surface: "lazycodex" });
			const created = await toolkit.createGoals({ brief: "- alpha goal\n- beta goal" });
			expect(created.ok).toBe(true);
			// when
			const dispatched = await toolkit.dispatchGoals({});
			expect(dispatched.ok).toBe(true);
			if (!dispatched.ok) return;
			expect(dispatched.result.handoffs).toHaveLength(2);
			const first = dispatched.result.handoffs[0];
			if (first === undefined) throw new Error("expected handoff");
			const recorded = await toolkit.recordChildResult({
				goalId: first.goalId,
				childId: "ses_child1",
				resultRef: "a0/report.md",
			});
			expect(recorded.ok).toBe(true);
			// then
			const status = await toolkit.status();
			expect(status.ok).toBe(true);
			if (!status.ok) return;
			expect(status.result.summary.complete).toBe(1);
			expect(status.result.summary.in_progress).toBe(1);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("#given a dispatched goal #when the child fails #then the failure records with reason", async () => {
		// given
		const cwd = await mkdtemp(join(tmpdir(), "ulw-sdk-dispatch-"));
		try {
			const toolkit = createAgentToolkit({ cwd, sessionId: "sdk-fail", surface: "lazycodex" });
			const created = await toolkit.createGoals({ brief: "- alpha goal" });
			expect(created.ok).toBe(true);
			const dispatched = await toolkit.dispatchGoals({ goalIds: [] });
			expect(dispatched.ok).toBe(true);
			if (!dispatched.ok) return;
			const target = dispatched.result.handoffs[0]?.goalId;
			if (target === undefined) throw new Error("expected handoff");
			// when
			const recorded = await toolkit.recordChildFailure({ goalId: target, childId: "ses_x", reason: "timeout" });
			expect(recorded.ok).toBe(true);
			// then
			const status = await toolkit.status();
			expect(status.ok).toBe(true);
			if (!status.ok) return;
			expect(status.result.summary.failed).toBe(1);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
