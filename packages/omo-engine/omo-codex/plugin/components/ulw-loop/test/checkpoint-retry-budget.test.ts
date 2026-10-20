import { existsSync } from "node:fs";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { checkpointRejectionSignature, consumeCheckpointRetryBudget } from "../src/checkpoint-retry-budget.js";

const SIG = "ulw_loop_criteria_not_all_pass:C001:pending,C002:pending";

async function stateDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "ug-retry-budget-"));
	await writeFile(join(dir, "ledger.jsonl"), `{"kind":"plan_created"}\n`);
	return dir;
}

describe("#given identical checkpoint rejections #when consuming the budget #then the first three pass and the fourth stops", () => {
	it("allows three attempts then denies without state change", async () => {
		const dir = await stateDir();

		expect(consumeCheckpointRetryBudget(dir, "G001", SIG)).toMatchObject({ allowed: true, attempts: 1 });
		expect(consumeCheckpointRetryBudget(dir, "G001", SIG)).toMatchObject({ allowed: true, attempts: 2 });
		expect(consumeCheckpointRetryBudget(dir, "G001", SIG)).toMatchObject({ allowed: true, attempts: 3 });
		expect(consumeCheckpointRetryBudget(dir, "G001", SIG)).toMatchObject({ allowed: false, attempts: 3 });
		expect(existsSync(join(dir, "checkpoint-retry-G001.stuck"))).toBe(true);
	});
});

describe("#given ledger progress between rejections #when consuming the budget #then the count resets", () => {
	it("allows again after a state change", async () => {
		const dir = await stateDir();
		consumeCheckpointRetryBudget(dir, "G001", SIG);
		consumeCheckpointRetryBudget(dir, "G001", SIG);
		await appendFile(join(dir, "ledger.jsonl"), `{"kind":"evidence_captured"}\n`);

		expect(consumeCheckpointRetryBudget(dir, "G001", SIG)).toMatchObject({ allowed: true, attempts: 1 });
	});
});

describe("#given a changed unresolved set #when consuming the budget #then the count resets", () => {
	it("treats a new signature as a new failure", async () => {
		const dir = await stateDir();
		consumeCheckpointRetryBudget(dir, "G001", SIG);
		consumeCheckpointRetryBudget(dir, "G001", SIG);

		expect(consumeCheckpointRetryBudget(dir, "G001", "ulw_loop_criteria_not_all_pass:C001:pending")).toMatchObject({
			allowed: true,
			attempts: 1,
		});
	});
});

describe("#given a hostile goal id #when consuming the budget #then no write escapes the state dir", () => {
	it("fails closed without counting", async () => {
		const dir = await stateDir();
		const hostile = `sub${sep}..${sep}..${sep}escape`;
		const escaped = resolve(dir, `checkpoint-retry-${hostile}.json`);

		expect(consumeCheckpointRetryBudget(dir, hostile, SIG)).toMatchObject({ allowed: true, attempts: 0 });
		expect(existsSync(escaped)).toBe(false);
	});
});

describe("#given unresolved criteria #when building the signature #then identical sets match regardless of extraction path", () => {
	it("builds a stable signature string", () => {
		expect(
			checkpointRejectionSignature([
				{ id: "C001", status: "pending" },
				{ id: "C002", status: "pending" },
			]),
		).toBe(SIG);
	});
});
