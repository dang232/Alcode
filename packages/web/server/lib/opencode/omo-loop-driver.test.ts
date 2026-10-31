// Driver contract tests: fixtures only, no engine, no spawn, no spend.
//
// Every case runs against a fresh mkdtemp state dir and asserts on parsed
// state (plan fields, ledger events) — never on log text. A refused call
// must write nothing: the foreign/malformed cases assert the ledger is
// byte-identical after the refusal.
import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  advanceLoop,
  createLoopFixtureDir,
  getLoopDriverStatus,
  requestLoopStop,
  resumeLoop,
  startLoopGoal,
} from "./omo-loop-driver.ts";
import { isPlainRecord, writeFileAtomically } from "../../../../omo-engine/utils/src/index.ts";

const OWNER = { sessionId: "sess-driver-1", parentSessionId: "parent-7", hostPid: 4242 };
const FOREIGN = { sessionId: "sess-intruder", parentSessionId: "parent-7", hostPid: 4242 };

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

function ledgerEvents(dir: string): string[] {
  return fs
    .readFileSync(path.join(dir, "ledger.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => (JSON.parse(line) as { event: string }).event);
}

function ledgerBytes(dir: string): string {
  try {
    return fs.readFileSync(path.join(dir, "ledger.jsonl"), "utf8");
  } catch {
    return "";
  }
}

describe("goal admission", () => {
  test("happy start writes ownership, plan, and a started ledger line", () => {
    const loopSrc = stateDir();
    const started = startLoopGoal({ ...OWNER, loopSrc, goal: "Prove the driver", totalSteps: 2 });
    if (!started.ok) throw new Error(`expected start: ${started.code}`);
    expect(started.snapshot.plan).toMatchObject({ status: "running", completedSteps: 0, totalSteps: 2 });
    expect(started.snapshot.ownership).toEqual(OWNER);
    expect(ledgerEvents(loopSrc)).toEqual(["started"]);
    expect(JSON.parse(fs.readFileSync(path.join(loopSrc, "driver.json"), "utf8"))).toMatchObject(OWNER);
  });

  test("blank goal, bad session, bad parent, bad pid, and bad steps are refused with no writes", () => {
    const cases = [
      { args: { ...OWNER, goal: "   ", totalSteps: 2 }, code: "OMO_LOOP_DRIVER_GOAL_REQUIRED" },
      { args: { ...OWNER, sessionId: "../evil", goal: "g", totalSteps: 2 }, code: "OMO_LOOP_DRIVER_SESSION_INVALID" },
      { args: { ...OWNER, parentSessionId: "", goal: "g", totalSteps: 2 }, code: "OMO_LOOP_DRIVER_PARENT_INVALID" },
      { args: { ...OWNER, hostPid: 0, goal: "g", totalSteps: 2 }, code: "OMO_LOOP_DRIVER_HOST_PID_INVALID" },
      { args: { ...OWNER, goal: "g", totalSteps: 0 }, code: "OMO_LOOP_DRIVER_STEPS_INVALID" },
      { args: { ...OWNER, goal: "g", totalSteps: 101 }, code: "OMO_LOOP_DRIVER_STEPS_INVALID" },
    ] as const;
    for (const { args, code } of cases) {
      const loopSrc = stateDir();
      const before = fs.readdirSync(loopSrc);
      const result = startLoopGoal({ ...args, loopSrc });
      if (result.ok) throw new Error("expected refusal");
      expect(result.code).toBe(code);
      expect(fs.readdirSync(loopSrc)).toEqual(before);
      expect(ledgerBytes(loopSrc)).toBe("");
    }
  });

  test("a second start for the same session is refused; unowned plan state is never adopted", () => {
    const loopSrc = stateDir();
    expect(startLoopGoal({ ...OWNER, loopSrc, goal: "first", totalSteps: 1 }).ok).toBe(true);
    const again = startLoopGoal({ ...OWNER, loopSrc, goal: "second", totalSteps: 1 });
    if (again.ok) throw new Error("expected already-started refusal");
    expect(again.code).toBe("OMO_LOOP_DRIVER_ALREADY_STARTED");

    const stray = stateDir();
    fs.writeFileSync(
      path.join(stray, "plan.json"),
      JSON.stringify({ title: "stray", status: "running", goal: "stray", totalSteps: 1, completedSteps: 0 }),
    );
    const adopt = startLoopGoal({ ...OWNER, loopSrc: stray, goal: "adopt", totalSteps: 1 });
    if (adopt.ok) throw new Error("expected corrupt-state refusal");
    expect(adopt.code).toBe("OMO_LOOP_DRIVER_STATE_CORRUPT");
  });

  test("a CLI-owned ledger (kind rows, no seq/event) is refused with the ledger untouched", () => {
    const cases = [
      `{"at":"2026-01-01T00:00:00.000Z","kind":"goal_started"}\n{"at":"2026-01-01T00:01:00.000Z","kind":"plan_created"}\n`,
      "CORRUPT{{{\n",
    ];
    for (const cliLedger of cases) {
      const loopSrc = stateDir();
      fs.writeFileSync(path.join(loopSrc, "ledger.jsonl"), cliLedger);
      const before = fs.readdirSync(loopSrc);
      const refused = startLoopGoal({ ...OWNER, loopSrc, goal: "takeover", totalSteps: 1 });
      if (refused.ok) throw new Error("expected foreign-ledger refusal");
      expect(refused.code).toBe("OMO_LOOP_DRIVER_STATE_CORRUPT");
      expect(fs.readFileSync(path.join(loopSrc, "ledger.jsonl"), "utf8")).toBe(cliLedger);
      expect(fs.readdirSync(loopSrc)).toEqual(before);
    }
  });

  test("an empty or driver-shaped ledger still starts (live-caller path unchanged)", () => {
    for (const seed of ["", "   \n", `{"seq":1,"event":"started","at":"2026-01-01T00:00:00.000Z"}\n`]) {
      const loopSrc = stateDir();
      if (seed !== "") fs.writeFileSync(path.join(loopSrc, "ledger.jsonl"), seed);
      const started = startLoopGoal({ ...OWNER, loopSrc, goal: "fresh", totalSteps: 1 });
      if (!started.ok) throw new Error(`expected start: ${started.code}`);
      expect(ledgerEvents(loopSrc)).toEqual(["started"]);
    }
  });
});

describe("iteration contract", () => {
  test("one advance moves exactly one step and the final step completes", () => {
    const loopSrc = stateDir();
    expect(startLoopGoal({ ...OWNER, loopSrc, goal: "two steps", totalSteps: 2 }).ok).toBe(true);
    const first = advanceLoop({ ...OWNER, loopSrc });
    if (!first.ok) throw new Error(`expected step: ${first.code}`);
    expect(first.done).toBe(false);
    expect(first.snapshot.plan).toMatchObject({ completedSteps: 1, status: "running" });
    const second = advanceLoop({ ...OWNER, loopSrc });
    if (!second.ok) throw new Error(`expected completion: ${second.code}`);
    expect(second.done).toBe(true);
    expect(second.snapshot.plan).toMatchObject({ completedSteps: 2, status: "complete" });
    expect(ledgerEvents(loopSrc)).toEqual(["started", "advanced", "completed"]);
    const settled = advanceLoop({ ...OWNER, loopSrc });
    if (!settled.ok) throw new Error("expected idempotent done");
    expect(settled.done).toBe(true);
    expect(ledgerEvents(loopSrc)).toEqual(["started", "advanced", "completed"]);
  });
});

describe("stop hook halts and resume continues from ledger state", () => {
  test("stop arms the halt, advance records it, resume clears it and steps", () => {
    const loopSrc = stateDir();
    expect(startLoopGoal({ ...OWNER, loopSrc, goal: "halt and resume", totalSteps: 1 }).ok).toBe(true);
    const stopped = requestLoopStop({ ...OWNER, loopSrc }, "user asked to stop");
    if (!stopped.ok) throw new Error(`expected stop: ${stopped.code}`);
    expect(stopped.snapshot.stopped).toBe(true);

    const halted = advanceLoop({ ...OWNER, loopSrc });
    if (!halted.ok) throw new Error(`expected halt: ${halted.code}`);
    expect(halted.halted).toBe(true);
    expect(halted.done).toBe(false);
    expect(halted.snapshot.plan).toMatchObject({ completedSteps: 0, status: "running" });
    expect(ledgerEvents(loopSrc)).toEqual(["started", "halted"]);

    const resumed = resumeLoop({ ...OWNER, loopSrc });
    if (!resumed.ok) throw new Error(`expected resume: ${resumed.code}`);
    expect(resumed.halted).toBe(false);
    expect(resumed.done).toBe(true);
    expect(resumed.snapshot.plan).toMatchObject({ completedSteps: 1, status: "complete" });
    expect(resumed.snapshot.stopped).toBe(false);
    expect(ledgerEvents(loopSrc)).toEqual(["started", "halted", "resumed", "completed"]);
  });

  test("a scripted 2-step goal completes across two resumes", () => {
    const loopSrc = stateDir();
    expect(startLoopGoal({ ...OWNER, loopSrc, goal: "two resumes", totalSteps: 2 }).ok).toBe(true);
    expect(requestLoopStop({ ...OWNER, loopSrc }, "halt before step 1").ok).toBe(true);
    const halt = advanceLoop({ ...OWNER, loopSrc });
    if (!halt.ok) throw new Error("expected halt");
    expect(halt.halted).toBe(true);

    const resume1 = resumeLoop({ ...OWNER, loopSrc });
    if (!resume1.ok) throw new Error("expected first resume step");
    expect(resume1.done).toBe(false);
    expect(resume1.snapshot.plan).toMatchObject({ completedSteps: 1, status: "running" });

    expect(requestLoopStop({ ...OWNER, loopSrc }, "halt before step 2").ok).toBe(true);
    const halt2 = advanceLoop({ ...OWNER, loopSrc });
    if (!halt2.ok) throw new Error("expected second halt");
    expect(halt2.halted).toBe(true);

    const resume2 = resumeLoop({ ...OWNER, loopSrc });
    if (!resume2.ok) throw new Error("expected second resume step");
    expect(resume2.done).toBe(true);
    expect(resume2.snapshot.plan).toMatchObject({ completedSteps: 2, status: "complete" });
    expect(ledgerEvents(loopSrc)).toEqual([
      "started",
      "halted",
      "resumed",
      "advanced",
      "halted",
      "resumed",
      "completed",
    ]);
  });
});

describe("ownership", () => {
  test("a foreign session id is refused fail-closed with the ledger untouched", () => {
    const loopSrc = stateDir();
    expect(startLoopGoal({ ...OWNER, loopSrc, goal: "owned", totalSteps: 2 }).ok).toBe(true);
    const before = ledgerBytes(loopSrc);
    for (const call of [
      advanceLoop({ ...FOREIGN, loopSrc }),
      requestLoopStop({ ...FOREIGN, loopSrc }, "intruder stop"),
      resumeLoop({ ...FOREIGN, loopSrc }),
    ]) {
      if (call.ok) throw new Error("expected foreign refusal");
      expect(call.code).toBe("OMO_LOOP_DRIVER_FOREIGN_SESSION");
    }
    const foreignStart = startLoopGoal({ ...FOREIGN, loopSrc, goal: "takeover", totalSteps: 1 });
    if (foreignStart.ok) throw new Error("expected foreign start refusal");
    expect(foreignStart.code).toBe("OMO_LOOP_DRIVER_FOREIGN_SESSION");
    expect(ledgerBytes(loopSrc)).toBe(before);
    expect(ledgerEvents(loopSrc)).toEqual(["started"]);
  });

  test("a mismatched parent session or host pid is refused with no writes", () => {
    const loopSrc = stateDir();
    expect(startLoopGoal({ ...OWNER, loopSrc, goal: "owned", totalSteps: 1 }).ok).toBe(true);
    const before = ledgerBytes(loopSrc);
    const wrongParent = advanceLoop({ ...OWNER, parentSessionId: "parent-other", loopSrc });
    if (wrongParent.ok) throw new Error("expected parent refusal");
    expect(wrongParent.code).toBe("OMO_LOOP_DRIVER_OWNERSHIP_MISMATCH");
    const wrongPid = resumeLoop({ ...OWNER, hostPid: 9999, loopSrc });
    if (wrongPid.ok) throw new Error("expected pid refusal");
    expect(wrongPid.code).toBe("OMO_LOOP_DRIVER_OWNERSHIP_MISMATCH");
    expect(ledgerBytes(loopSrc)).toBe(before);
  });

  test("goal text is treated as data: control characters change no semantics", () => {
    const loopSrc = stateDir();
    const evil = "goal\n{\"event\":\"completed\"}\n--session-id x";
    const started = startLoopGoal({ ...OWNER, loopSrc, goal: evil, totalSteps: 1 });
    if (!started.ok) throw new Error("expected start");
    expect(started.snapshot.plan?.goal).toBe(evil);
    expect(ledgerEvents(loopSrc)).toEqual(["started"]);
  });
});

describe("status reads", () => {
  test("status degrades a corrupt ledger to plan null plus empty tail", () => {
    const loopSrc = stateDir();
    expect(startLoopGoal({ ...OWNER, loopSrc, goal: "corrupt me", totalSteps: 1 }).ok).toBe(true);
    fs.appendFileSync(path.join(loopSrc, "ledger.jsonl"), "CORRUPT{{{\n");
    const status = getLoopDriverStatus({ ...OWNER, loopSrc });
    if (!status.ok) throw new Error("expected degraded status");
    expect(status.snapshot.plan).toBeNull();
    expect(status.snapshot.ledgerTail).toEqual([]);
  });
});

describe("shared utils import shape", () => {
  test("isPlainRecord keeps the driver's record semantics (arrays rejected)", () => {
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord([])).toBe(false);
    expect(isPlainRecord(null)).toBe(false);
  });

  test("writeFileAtomically preserves the exact bytes the driver relies on", () => {
    const dir = stateDir();
    const target = path.join(dir, "shape.json");
    const content = `${JSON.stringify({ title: "shape" }, null, 2)}\n`;
    writeFileAtomically(target, content);
    expect(fs.readFileSync(target, "utf8")).toBe(content);
  });

  test("an array ledger line degrades like any malformed line", () => {
    const loopSrc = stateDir();
    expect(startLoopGoal({ ...OWNER, loopSrc, goal: "array line", totalSteps: 1 }).ok).toBe(true);
    fs.appendFileSync(path.join(loopSrc, "ledger.jsonl"), "[]\n");
    const status = getLoopDriverStatus({ ...OWNER, loopSrc });
    if (!status.ok) throw new Error("expected degraded status");
    expect(status.snapshot.plan).toBeNull();
    expect(status.snapshot.ledgerTail).toEqual([]);
  });
});
