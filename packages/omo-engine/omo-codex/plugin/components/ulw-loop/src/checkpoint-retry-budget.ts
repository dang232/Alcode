import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import { readLedgerAt } from "./ledger.js";
import { atomicWriteJson } from "./spawn-budget-io.js";

// Bounded recovery for repeated identical checkpoint rejections. A rejected
// checkpoint mutates nothing, so retries leave no ledger trace; without a
// bound the agent spins on the same error. Counters live beside state (never
// in the log), mirroring the stop-resume hook budget: the count resets on any
// ledger progress or when the unresolved set changes, and the cap writes a
// .stuck marker for operators. Counters are advisory best-effort; a race that
// double-counts only reaches the cap one attempt early.

const RETRY_CAP = 3;

export interface CheckpointRetryBudget {
	readonly allowed: boolean;
	readonly attempts: number;
}

interface Counter {
	readonly count: number;
	readonly ledgerLineCount: number;
	readonly signature: string;
}

function isInsideDir(dir: string, candidate: string): boolean {
	return candidate.startsWith(resolve(dir) + sep);
}

function readCounter(counterPath: string): Counter | null {
	try {
		if (!existsSync(counterPath)) return null;
		const parsed = JSON.parse(readFileSync(counterPath, "utf8")) as Record<string, unknown>;
		if (
			typeof parsed["count"] !== "number" ||
			typeof parsed["ledgerLineCount"] !== "number" ||
			typeof parsed["signature"] !== "string"
		)
			return null;
		return { count: parsed["count"], ledgerLineCount: parsed["ledgerLineCount"], signature: parsed["signature"] };
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
}

export function checkpointRejectionSignature(unresolved: readonly { id: string; status: string }[]): string {
	return `ulw_loop_criteria_not_all_pass:${unresolved.map((criterion) => `${criterion.id}:${criterion.status}`).join(",")}`;
}

export function consumeCheckpointRetryBudget(
	stateDir: string,
	goalId: string,
	signature: string,
): CheckpointRetryBudget {
	const ledgerLineCount = readLedgerAt(stateDir).length;
	const counterPath = resolve(stateDir, `checkpoint-retry-${goalId}.json`);
	const stuckPath = resolve(stateDir, `checkpoint-retry-${goalId}.stuck`);
	// goals.json is untrusted input: a crafted goal id must never drive a
	// write outside the session state dir. Deny the budget (fail closed).
	if (!isInsideDir(stateDir, counterPath) || !isInsideDir(stateDir, stuckPath)) return { allowed: true, attempts: 0 };
	const previous = readCounter(counterPath);
	const same = previous !== null && previous.ledgerLineCount === ledgerLineCount && previous.signature === signature;
	const count = same ? previous.count : 0;
	if (count >= RETRY_CAP) {
		writeFileSync(stuckPath, `no state change after ${count} identical checkpoint rejections\n`);
		return { allowed: false, attempts: count };
	}
	atomicWriteJson(counterPath, { count: count + 1, ledgerLineCount, signature });
	return { allowed: true, attempts: count + 1 };
}
