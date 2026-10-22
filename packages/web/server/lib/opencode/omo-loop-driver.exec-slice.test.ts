// Step A trustworthy-execution slice (G5): fail-closed branch execution proof
// for the loop driver (`omo-loop-driver.ts:211-236,334,375`).
//
// The pre-existing driver suite pins the happy path, foreign-session
// refusal, and corrupt-ledger status degrade. These cases close the
// remaining execution gaps: corrupt-plan and oversize-plan advance refusal
// (readPlan fail-closed branches + advanceLoop STATE_CORRUPT), oversize and
// corrupt ledger status degrade (readLedgerTail size/malformed branches),
// and foreign-session refusal across every mutation entry. Every refusal
// asserts the state files are byte-identical afterwards: a refused call
// writes nothing.
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  advanceLoop,
  createLoopFixtureDir,
  getLoopDriverStatus,
  MAX_DRIVER_LEDGER_BYTES,
  MAX_DRIVER_PLAN_BYTES,
  requestLoopStop,
  resumeLoop,
  startLoopGoal,
} from "./omo-loop-driver.ts";

const OWNER = { sessionId: "sess-exec-slice", parentSessionId: "parent-exec", hostPid: 4242 };
const FOREIGN = { sessionId: "sess-intruder", parentSessionId: "parent-exec", hostPid: 4242 };

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function stateDir(): string {
  const dir = createLoopFixtureDir();
  dirs.push(dir);
  return dir;
}

function startedDir(): string {
  const loopSrc = stateDir();
  const started = startLoopGoal({ ...OWNER, loopSrc, goal: "exec slice", totalSteps: 2 });
  if (!started.ok) throw new Error(`expected start: ${started.code}`);
  return loopSrc;
}

function readBytes(loopSrc: string, name: string): string {
  try {
    return fs.readFileSync(path.join(loopSrc, name), "utf8");
  } catch {
    return "";
  }
}

describe("exec slice: corrupt plan fails closed", () => {
  test("unparseable plan.json refuses advance with STATE_CORRUPT and zero writes", () => {
    const loopSrc = startedDir();
    fs.writeFileSync(path.join(loopSrc, "plan.json"), "{corrupt{{{\n");
    const ledgerBefore = readBytes(loopSrc, "ledger.jsonl");
    const planBefore = readBytes(loopSrc, "plan.json");

    const advanced = advanceLoop({ ...OWNER, loopSrc });
    if (advanced.ok) throw new Error("expected corrupt-plan refusal");
    expect(advanced.code).toBe("OMO_LOOP_DRIVER_STATE_CORRUPT");
    expect(readBytes(loopSrc, "ledger.jsonl")).toBe(ledgerBefore);
    expect(readBytes(loopSrc, "plan.json")).toBe(planBefore);
  });

  test("corrupt plan degrades status reads to plan null while the good ledger tail survives", () => {
    const loopSrc = startedDir();
    fs.writeFileSync(path.join(loopSrc, "plan.json"), "{corrupt{{{\n");
    const status = getLoopDriverStatus({ ...OWNER, loopSrc });
    if (!status.ok) throw new Error(`expected degraded status: ${status.code}`);
    expect(status.snapshot.plan).toBeNull();
    expect(status.snapshot.ledgerTail.map((entry) => entry.event)).toEqual(["started"]);
    expect(status.snapshot.ownership).toEqual(OWNER);
  });

  test("wrong-shape plan.json (bad status enum) refuses advance the same way", () => {
    const loopSrc = startedDir();
    fs.writeFileSync(
      path.join(loopSrc, "plan.json"),
      JSON.stringify({ title: "t", status: "bogus", goal: "g", totalSteps: 2, completedSteps: 0 }),
    );
    const ledgerBefore = readBytes(loopSrc, "ledger.jsonl");
    const advanced = advanceLoop({ ...OWNER, loopSrc });
    if (advanced.ok) throw new Error("expected wrong-shape refusal");
    expect(advanced.code).toBe("OMO_LOOP_DRIVER_STATE_CORRUPT");
    expect(readBytes(loopSrc, "ledger.jsonl")).toBe(ledgerBefore);
  });
});

describe("exec slice: oversize state fails closed", () => {
  test("plan.json past MAX_DRIVER_PLAN_BYTES refuses advance with STATE_CORRUPT", () => {
    const loopSrc = startedDir();
    const valid = { title: "t", status: "running", goal: "g", totalSteps: 2, completedSteps: 0 };
    const padding = "x".repeat(MAX_DRIVER_PLAN_BYTES);
    fs.writeFileSync(path.join(loopSrc, "plan.json"), JSON.stringify({ ...valid, padding }));
    expect(fs.statSync(path.join(loopSrc, "plan.json")).size).toBeGreaterThan(MAX_DRIVER_PLAN_BYTES);
    const ledgerBefore = readBytes(loopSrc, "ledger.jsonl");

    const advanced = advanceLoop({ ...OWNER, loopSrc });
    if (advanced.ok) throw new Error("expected oversize-plan refusal");
    expect(advanced.code).toBe("OMO_LOOP_DRIVER_STATE_CORRUPT");
    expect(readBytes(loopSrc, "ledger.jsonl")).toBe(ledgerBefore);
  });

  test("ledger past MAX_DRIVER_LEDGER_BYTES degrades status to plan null plus empty tail", () => {
    const loopSrc = startedDir();
    fs.writeFileSync(path.join(loopSrc, "ledger.jsonl"), "x".repeat(MAX_DRIVER_LEDGER_BYTES + 1));
    const status = getLoopDriverStatus({ ...OWNER, loopSrc });
    if (!status.ok) throw new Error(`expected degraded status: ${status.code}`);
    expect(status.snapshot.plan).toBeNull();
    expect(status.snapshot.ledgerTail).toEqual([]);
    expect(status.snapshot.ownership).toEqual(OWNER);
    expect(status.snapshot.stopped).toBe(false);
  });

  test("corrupt ledger line degrades status reads and status itself writes nothing", () => {
    const loopSrc = startedDir();
    const ledgerBefore = readBytes(loopSrc, "ledger.jsonl");
    fs.appendFileSync(path.join(loopSrc, "ledger.jsonl"), "CORRUPT{{{\n");
    const status = getLoopDriverStatus({ ...OWNER, loopSrc });
    if (!status.ok) throw new Error(`expected degraded status: ${status.code}`);
    expect(status.snapshot.plan).toBeNull();
    expect(status.snapshot.ledgerTail).toEqual([]);
    expect(readBytes(loopSrc, "ledger.jsonl")).toBe(ledgerBefore + "CORRUPT{{{\n");
  });
});

describe("exec slice: foreign session refused on every mutation", () => {
  test("foreign advance, stop, resume, and start all refuse with state untouched", () => {
    const loopSrc = startedDir();
    const ledgerBefore = readBytes(loopSrc, "ledger.jsonl");
    const planBefore = readBytes(loopSrc, "plan.json");
    const driverBefore = readBytes(loopSrc, "driver.json");

    const advanced = advanceLoop({ ...FOREIGN, loopSrc });
    if (advanced.ok) throw new Error("expected foreign advance refusal");
    expect(advanced.code).toBe("OMO_LOOP_DRIVER_FOREIGN_SESSION");

    const stopped = requestLoopStop({ ...FOREIGN, loopSrc }, "intruder stop");
    if (stopped.ok) throw new Error("expected foreign stop refusal");
    expect(stopped.code).toBe("OMO_LOOP_DRIVER_FOREIGN_SESSION");

    const resumed = resumeLoop({ ...FOREIGN, loopSrc });
    if (resumed.ok) throw new Error("expected foreign resume refusal");
    expect(resumed.code).toBe("OMO_LOOP_DRIVER_FOREIGN_SESSION");

    const started = startLoopGoal({ ...FOREIGN, loopSrc, goal: "takeover", totalSteps: 1 });
    if (started.ok) throw new Error("expected foreign start refusal");
    expect(started.code).toBe("OMO_LOOP_DRIVER_FOREIGN_SESSION");

    expect(readBytes(loopSrc, "ledger.jsonl")).toBe(ledgerBefore);
    expect(readBytes(loopSrc, "plan.json")).toBe(planBefore);
    expect(readBytes(loopSrc, "driver.json")).toBe(driverBefore);

    const status = getLoopDriverStatus({ ...OWNER, loopSrc });
    if (!status.ok) throw new Error(`expected owner status: ${status.code}`);
    expect(status.snapshot.plan).toMatchObject({ status: "running", completedSteps: 0 });
  });
});
