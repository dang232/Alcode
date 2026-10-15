import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulwLoopCommand } from "../src/cli-commands.ts";
import { ulwLoopLedgerPath } from "../src/paths.ts";
import { CLI_TEST_SESSION_ID } from "./fixtures/cli-session.js";

let testDir: string;
let out: string[];
let originalCodexSessionId: string | undefined;
let originalCodexThreadId: string | undefined;
let originalOmoSessionId: string | undefined;
let originalPiSessionId: string | undefined;

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "ug-cli-dispatch-"));
	out = [];
	originalCodexSessionId = process.env["CODEX_SESSION_ID"];
	originalCodexThreadId = process.env["CODEX_THREAD_ID"];
	originalOmoSessionId = process.env["OMO_ULW_LOOP_SESSION_ID"];
	originalPiSessionId = process.env["PI_SESSION_ID"];
	delete process.env["CODEX_SESSION_ID"];
	delete process.env["CODEX_THREAD_ID"];
	delete process.env["OMO_ULW_LOOP_SESSION_ID"];
	delete process.env["PI_SESSION_ID"];
	process.env["OMO_ULW_LOOP_SESSION_ID"] = CLI_TEST_SESSION_ID;
	vi.spyOn(process, "cwd").mockReturnValue(testDir);
	vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array): boolean => {
		out.push(chunk.toString());
		return true;
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	if (originalCodexSessionId === undefined) delete process.env["CODEX_SESSION_ID"];
	else process.env["CODEX_SESSION_ID"] = originalCodexSessionId;
	if (originalCodexThreadId === undefined) delete process.env["CODEX_THREAD_ID"];
	else process.env["CODEX_THREAD_ID"] = originalCodexThreadId;
	if (originalOmoSessionId === undefined) delete process.env["OMO_ULW_LOOP_SESSION_ID"];
	else process.env["OMO_ULW_LOOP_SESSION_ID"] = originalOmoSessionId;
	if (originalPiSessionId === undefined) delete process.env["PI_SESSION_ID"];
	else process.env["PI_SESSION_ID"] = originalPiSessionId;
	await rm(testDir, { recursive: true, force: true });
});

function resetOutput(): void {
	out = [];
}

function stdoutJson(): { ok: boolean; handoffs: Array<{ goalId: string; attempt: number }>; skipped: unknown[] } {
	return JSON.parse(out.join("")) as {
		ok: boolean;
		handoffs: Array<{ goalId: string; attempt: number }>;
		skipped: unknown[];
	};
}

async function ledgerKinds(): Promise<string[]> {
	const raw = await readFile(ulwLoopLedgerPath(testDir, { sessionId: CLI_TEST_SESSION_ID }), "utf8");
	return raw
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => (JSON.parse(line) as { kind: string }).kind);
}

async function createPlan(): Promise<void> {
	expect(await ulwLoopCommand(["create-goals", "--brief", "- Goal A\n- Goal B\n- Goal C", "--json"])).toBe(0);
	resetOutput();
}

describe("ulwLoopCommand dispatch", () => {
	describe("#given three pending goals #when dispatch runs #then every goal opens with a handoff", () => {
		it("emits one handoff per goal and records goal_dispatched", async () => {
			// given
			await createPlan();
			// when
			expect(await ulwLoopCommand(["dispatch", "--json"])).toBe(0);
			// then
			const body = stdoutJson();
			expect(body.ok).toBe(true);
			expect(body.handoffs.map((handoff) => handoff.goalId).sort()).toEqual([
				"G001-goal-a",
				"G002-goal-b",
				"G003-goal-c",
			]);
			expect(body.handoffs.every((handoff) => handoff.attempt === 1)).toBe(true);
			expect(body.skipped).toEqual([]);
			expect(await ledgerKinds()).toEqual(["plan_created", "goal_dispatched", "goal_dispatched", "goal_dispatched"]);
		});
	});

	describe("#given dispatched goals #when dispatch runs again #then it skips without new events", () => {
		it("is idempotent across retries", async () => {
			// given
			await createPlan();
			expect(await ulwLoopCommand(["dispatch", "--json"])).toBe(0);
			resetOutput();
			// when
			expect(await ulwLoopCommand(["dispatch", "--json"])).toBe(0);
			// then
			const body = stdoutJson();
			expect(body.handoffs).toEqual([]);
			expect(body.skipped).toHaveLength(3);
			expect(await ledgerKinds()).toEqual(["plan_created", "goal_dispatched", "goal_dispatched", "goal_dispatched"]);
		});
	});

	describe("#given an explicit goal id #when dispatch targets it #then only that goal opens", () => {
		it("dispatches the named goal with the child role", async () => {
			// given
			await createPlan();
			// when
			expect(
				await ulwLoopCommand(["dispatch", "--goal-id", "G002-goal-b", "--child-role", "explorer", "--json"]),
			).toBe(0);
			// then
			const body = stdoutJson();
			expect(body.handoffs.map((handoff) => handoff.goalId)).toEqual(["G002-goal-b"]);
			expect(await ledgerKinds()).toEqual(["plan_created", "goal_dispatched"]);
		});
	});

	describe("#given an unknown goal id #when dispatch targets it #then the command fails", () => {
		it("exits nonzero with the not-found code", async () => {
			// given
			await createPlan();
			// when
			const code = await ulwLoopCommand(["dispatch", "--goal-id", "G999", "--json"]);
			// then
			expect(code).toBe(1);
			expect(stdoutJson()).toMatchObject({ ok: false });
			expect(await ledgerKinds()).toEqual(["plan_created"]);
		});
	});
});
