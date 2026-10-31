// omo-loop-driver: host-callable session driver for the ULW loop.
//
// The driver owns one loop session directory (plan.json + ledger.jsonl, the
// same state shape `--loop-status` reads) from the host side: goal admission
// at start, a bounded one-step iteration contract, stop/resume hooks, and
// ownership (sessionId + parentSessionId + hostPid) checked on every
// mutation. Failure is fail-closed: domain problems return
// { ok: false, code, message } and never throw, and a refused call writes
// nothing.
//
// Deliberately file-based: the driver never imports engine internals,
// never spawns, never phones the network, and spends nothing. Shared
// dependency-free helpers (record guard, atomic file writes) come from
// @oh-my-opencode/utils; node:fs/path/os cover the rest. Production wires the same ownership and
// iteration contract around `omo-agent-toolkit ulw-loop ... --session-id`
// spawns; the state files are the shared contract, so the driver and the
// CLI cannot disagree about what happened (the ledger is the audit trail).
//
// State layout inside loopSrc:
//   plan.json   { title, status: "running" | "complete", goal, totalSteps, completedSteps }
//   ledger.jsonl  one JSON object per line: { seq, event, at, ... }
//   driver.json { sessionId, parentSessionId, hostPid, startedAt }
//   .stop       present while a stop is armed: { reason, at }

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPlainRecord as isRecord, writeFileAtomically } from "../../../../omo-engine/utils/src/index.ts";

export const DRIVER_FILENAME = "driver.json";
export const DRIVER_PLAN_FILENAME = "plan.json";
export const DRIVER_LEDGER_FILENAME = "ledger.jsonl";
export const DRIVER_STOP_FILENAME = ".stop";

export const MAX_DRIVER_PLAN_BYTES = 1_048_576;
export const MAX_DRIVER_LEDGER_BYTES = 8_388_608;
export const MAX_DRIVER_GOAL_CHARS = 4096;
export const MAX_DRIVER_STEPS = 100;
export const MAX_DRIVER_REASON_CHARS = 1024;

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface LoopDriverOwnership {
  sessionId: string;
  parentSessionId: string;
  hostPid: number;
}

export interface LoopDriverStart extends LoopDriverOwnership {
  loopSrc: string;
  goal: string;
  totalSteps: number;
}

export interface LoopDriverCall extends LoopDriverOwnership {
  loopSrc: string;
}

export interface LoopDriverPlan {
  title: string;
  status: "running" | "complete";
  goal: string;
  totalSteps: number;
  completedSteps: number;
}

export interface LoopDriverLedgerEntry {
  seq: number;
  event: string;
  at: string;
  [key: string]: unknown;
}

export interface LoopDriverSnapshot {
  plan: LoopDriverPlan | null;
  ledgerTail: LoopDriverLedgerEntry[];
  stopped: boolean;
  ownership: LoopDriverOwnership | null;
}

export type LoopDriverFailureCode =
  | "OMO_LOOP_DRIVER_SESSION_INVALID"
  | "OMO_LOOP_DRIVER_PARENT_INVALID"
  | "OMO_LOOP_DRIVER_HOST_PID_INVALID"
  | "OMO_LOOP_DRIVER_LOOP_SRC_INVALID"
  | "OMO_LOOP_DRIVER_GOAL_REQUIRED"
  | "OMO_LOOP_DRIVER_STEPS_INVALID"
  | "OMO_LOOP_DRIVER_REASON_INVALID"
  | "OMO_LOOP_DRIVER_FOREIGN_SESSION"
  | "OMO_LOOP_DRIVER_OWNERSHIP_MISMATCH"
  | "OMO_LOOP_DRIVER_NO_STATE"
  | "OMO_LOOP_DRIVER_ALREADY_STARTED"
  | "OMO_LOOP_DRIVER_STATE_CORRUPT";

export interface LoopDriverFailure {
  ok: false;
  code: LoopDriverFailureCode;
  message: string;
}

export interface LoopDriverStartOk {
  ok: true;
  started: true;
  snapshot: LoopDriverSnapshot;
}

export interface LoopDriverStepOk {
  ok: true;
  done: boolean;
  halted: boolean;
  snapshot: LoopDriverSnapshot;
}

export interface LoopDriverStopOk {
  ok: true;
  stopped: true;
  snapshot: LoopDriverSnapshot;
}

export interface LoopDriverStatusOk {
  ok: true;
  snapshot: LoopDriverSnapshot;
}

export type LoopDriverResult = LoopDriverStartOk | LoopDriverStepOk | LoopDriverStopOk | LoopDriverStatusOk | LoopDriverFailure;

const fail = (code: LoopDriverFailureCode, message: string): LoopDriverFailure => ({ ok: false, code, message });

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

function validHostPid(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function checkOwnership(ownership: LoopDriverOwnership): LoopDriverFailure | null {
  if (!validSessionId(ownership.sessionId)) {
    return fail("OMO_LOOP_DRIVER_SESSION_INVALID", "A session id matching [A-Za-z0-9_-]{1,128} is required.");
  }
  if (!validSessionId(ownership.parentSessionId)) {
    return fail("OMO_LOOP_DRIVER_PARENT_INVALID", "A parent session id matching [A-Za-z0-9_-]{1,128} is required.");
  }
  if (!validHostPid(ownership.hostPid)) {
    return fail("OMO_LOOP_DRIVER_HOST_PID_INVALID", "A positive integer host pid is required.");
  }
  return null;
}

function checkLoopSrc(loopSrc: unknown): LoopDriverFailure | null {
  if (typeof loopSrc !== "string" || loopSrc.trim() === "") {
    return fail("OMO_LOOP_DRIVER_LOOP_SRC_INVALID", "A state directory (loopSrc) is required.");
  }
  return null;
}

function planPath(loopSrc: string): string {
  return path.join(loopSrc, DRIVER_PLAN_FILENAME);
}

function ledgerPath(loopSrc: string): string {
  return path.join(loopSrc, DRIVER_LEDGER_FILENAME);
}

function driverPath(loopSrc: string): string {
  return path.join(loopSrc, DRIVER_FILENAME);
}

function stopPath(loopSrc: string): string {
  return path.join(loopSrc, DRIVER_STOP_FILENAME);
}

function readOwnership(loopSrc: string): LoopDriverOwnership | null {
  let text: string;
  try {
    text = fs.readFileSync(driverPath(loopSrc), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { sessionId, parentSessionId, hostPid } = parsed;
  if (!validSessionId(sessionId) || !validSessionId(parentSessionId) || !validHostPid(hostPid)) return null;
  return { sessionId, parentSessionId, hostPid };
}

/** Fail-closed when the caller is not the recorded owner: foreign sessions never write. */
function checkOwner(loopSrc: string, ownership: LoopDriverOwnership): LoopDriverFailure | null {
  const recorded = readOwnership(loopSrc);
  if (recorded === null) return fail("OMO_LOOP_DRIVER_NO_STATE", "No driver-owned state here: start a goal first.");
  if (recorded.sessionId !== ownership.sessionId) {
    return fail(
      "OMO_LOOP_DRIVER_FOREIGN_SESSION",
      `Session "${ownership.sessionId}" does not own this loop (owned by "${recorded.sessionId}"): refused.`,
    );
  }
  if (recorded.parentSessionId !== ownership.parentSessionId || recorded.hostPid !== ownership.hostPid) {
    return fail("OMO_LOOP_DRIVER_OWNERSHIP_MISMATCH", "Parent session or host pid does not match the recorded owner: refused.");
  }
  return null;
}

function readPlan(loopSrc: string): LoopDriverPlan | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(planPath(loopSrc));
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_DRIVER_PLAN_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(planPath(loopSrc), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { title, status, goal, totalSteps, completedSteps } = parsed;
  if (typeof title !== "string" || typeof goal !== "string") return null;
  if (status !== "running" && status !== "complete") return null;
  if (!Number.isInteger(totalSteps) || !Number.isInteger(completedSteps)) return null;
  if ((totalSteps as number) < 1 || (completedSteps as number) < 0 || (completedSteps as number) > (totalSteps as number)) {
    return null;
  }
  return { title, status, goal, totalSteps: totalSteps as number, completedSteps: completedSteps as number };
}

function readLedgerTail(loopSrc: string, limit: number): { entries: LoopDriverLedgerEntry[]; malformed: boolean } {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(ledgerPath(loopSrc));
  } catch {
    return { entries: [], malformed: false };
  }
  if (!stat.isFile()) return { entries: [], malformed: false };
  if (stat.size > MAX_DRIVER_LEDGER_BYTES) return { entries: [], malformed: true };
  let text: string;
  try {
    text = fs.readFileSync(ledgerPath(loopSrc), "utf8");
  } catch {
    return { entries: [], malformed: false };
  }
  const entries: LoopDriverLedgerEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { entries: [], malformed: true };
    }
    if (!isRecord(parsed) || typeof parsed.seq !== "number" || typeof parsed.event !== "string") {
      return { entries: [], malformed: true };
    }
    entries.push({ at: new Date(0).toISOString(), ...parsed, seq: parsed.seq, event: parsed.event });
  }
  entries.sort((a, b) => a.seq - b.seq);
  return { entries: entries.slice(-limit), malformed: false };
}

function stopArmed(loopSrc: string): boolean {
  try {
    return fs.statSync(stopPath(loopSrc)).isFile();
  } catch {
    return false;
  }
}

function snapshot(loopSrc: string, limit = 50): LoopDriverSnapshot {
  const ledger = readLedgerTail(loopSrc, limit);
  return {
    plan: ledger.malformed ? null : readPlan(loopSrc),
    ledgerTail: ledger.malformed ? [] : ledger.entries,
    stopped: stopArmed(loopSrc),
    ownership: readOwnership(loopSrc),
  };
}

function nextSeq(loopSrc: string): number {
  const { entries } = readLedgerTail(loopSrc, Number.MAX_SAFE_INTEGER);
  return entries.length === 0 ? 1 : (entries[entries.length - 1]?.seq ?? 0) + 1;
}

function appendLedger(loopSrc: string, event: string, extra: Record<string, unknown> = {}): void {
  fs.appendFileSync(
    ledgerPath(loopSrc),
    `${JSON.stringify({ seq: nextSeq(loopSrc), event, at: new Date().toISOString(), ...extra })}\n`,
  );
}

/**
 * Goal admission: validate everything before writing anything, then create
 * plan.json + ledger.jsonl + driver.json atomically enough for a host tool
 * (a refused start leaves no files behind).
 */
export function startLoopGoal(args: LoopDriverStart): LoopDriverStartOk | LoopDriverFailure {
  const badSrc = checkLoopSrc(args.loopSrc);
  if (badSrc) return badSrc;
  const badOwner = checkOwnership(args);
  if (badOwner) return badOwner;
  const goal = args.goal?.trim() ?? "";
  if (goal === "" || goal.length > MAX_DRIVER_GOAL_CHARS) {
    return fail("OMO_LOOP_DRIVER_GOAL_REQUIRED", "A non-empty goal (max 4096 chars) is required.");
  }
  if (!Number.isInteger(args.totalSteps) || args.totalSteps < 1 || args.totalSteps > MAX_DRIVER_STEPS) {
    return fail("OMO_LOOP_DRIVER_STEPS_INVALID", `totalSteps must be an integer 1..${MAX_DRIVER_STEPS}.`);
  }
  const loopSrc = args.loopSrc;
  const existing = readOwnership(loopSrc);
  if (existing !== null) {
    if (existing.sessionId !== args.sessionId) {
      return fail(
        "OMO_LOOP_DRIVER_FOREIGN_SESSION",
        `State here belongs to "${existing.sessionId}": session "${args.sessionId}" is refused.`,
      );
    }
    return fail("OMO_LOOP_DRIVER_ALREADY_STARTED", "This session already owns a goal here: resume it instead.");
  }
  // A stray plan without ownership is corrupt state, not an invitation to adopt it.
  if (readPlan(loopSrc) !== null) {
    return fail("OMO_LOOP_DRIVER_STATE_CORRUPT", "Unowned plan state here: refusing to adopt it.");
  }
  // startLoopGoal truncates ledger.jsonl below: refuse when the existing
  // ledger is not driver-owned (CLI `kind` rows, unparseable lines, or an
  // oversize file), so a shared session dir's audit trail is never destroyed.
  if (readLedgerTail(loopSrc, Number.MAX_SAFE_INTEGER).malformed) {
    return fail("OMO_LOOP_DRIVER_STATE_CORRUPT", "Foreign ledger state here: refusing to overwrite it.");
  }
  try {
    fs.mkdirSync(loopSrc, { recursive: true });
  } catch {
    return fail("OMO_LOOP_DRIVER_LOOP_SRC_INVALID", "The state directory cannot be created.");
  }
  const plan: LoopDriverPlan = {
    title: goal.split("\n")[0]?.slice(0, 120) ?? goal,
    status: "running",
    goal,
    totalSteps: args.totalSteps,
    completedSteps: 0,
  };
  try {
    writeFileAtomically(planPath(loopSrc), `${JSON.stringify(plan, null, 2)}\n`);
    writeFileAtomically(ledgerPath(loopSrc), "");
    appendLedger(loopSrc, "started", { sessionId: args.sessionId, totalSteps: args.totalSteps });
    writeFileAtomically(
      driverPath(loopSrc),
      `${JSON.stringify({ sessionId: args.sessionId, parentSessionId: args.parentSessionId, hostPid: args.hostPid, startedAt: new Date().toISOString() }, null, 2)}\n`,
    );
  } catch {
    return fail("OMO_LOOP_DRIVER_LOOP_SRC_INVALID", "The state directory is not writable.");
  }
  return { ok: true, started: true, snapshot: snapshot(loopSrc) };
}

/**
 * Iteration contract: at most ONE step per call. A disarmed stop lets the
 * step through; an armed stop appends a halt marker and changes nothing
 * else, so the ledger — not log text — proves the halt.
 */
export function advanceLoop(args: LoopDriverCall): LoopDriverStepOk | LoopDriverFailure {
  const badSrc = checkLoopSrc(args.loopSrc);
  if (badSrc) return badSrc;
  const badOwner = checkOwnership(args);
  if (badOwner) return badOwner;
  const refused = checkOwner(args.loopSrc, args);
  if (refused) return refused;
  if (stopArmed(args.loopSrc)) {
    try {
      appendLedger(args.loopSrc, "halted", { sessionId: args.sessionId });
    } catch {
      return fail("OMO_LOOP_DRIVER_LOOP_SRC_INVALID", "The state directory is not writable.");
    }
    return { ok: true, done: false, halted: true, snapshot: snapshot(args.loopSrc) };
  }
  const plan = readPlan(args.loopSrc);
  if (plan === null) return fail("OMO_LOOP_DRIVER_STATE_CORRUPT", "Plan state is missing or corrupt: cannot advance.");
  if (plan.status === "complete") return { ok: true, done: true, halted: false, snapshot: snapshot(args.loopSrc) };
  const completedSteps = plan.completedSteps + 1;
  const done = completedSteps >= plan.totalSteps;
  const next: LoopDriverPlan = { ...plan, status: done ? "complete" : "running", completedSteps };
  try {
    writeFileAtomically(planPath(args.loopSrc), `${JSON.stringify(next, null, 2)}\n`);
    appendLedger(args.loopSrc, done ? "completed" : "advanced", {
      sessionId: args.sessionId,
      completedSteps,
      totalSteps: plan.totalSteps,
    });
  } catch {
    return fail("OMO_LOOP_DRIVER_LOOP_SRC_INVALID", "The state directory is not writable.");
  }
  return { ok: true, done, halted: false, snapshot: snapshot(args.loopSrc) };
}

/** Stop hook: arm the halt. The next advance() records it in the ledger. */
export function requestLoopStop(args: LoopDriverCall, reason = "stop requested"): LoopDriverStopOk | LoopDriverFailure {
  const badSrc = checkLoopSrc(args.loopSrc);
  if (badSrc) return badSrc;
  const badOwner = checkOwnership(args);
  if (badOwner) return badOwner;
  const refused = checkOwner(args.loopSrc, args);
  if (refused) return refused;
  const text = reason?.trim() ?? "";
  if (text === "" || text.length > MAX_DRIVER_REASON_CHARS) {
    return fail("OMO_LOOP_DRIVER_REASON_INVALID", "A non-empty stop reason (max 1024 chars) is required.");
  }
  try {
    writeFileAtomically(stopPath(args.loopSrc), `${JSON.stringify({ reason: text, at: new Date().toISOString() })}\n`);
  } catch {
    return fail("OMO_LOOP_DRIVER_LOOP_SRC_INVALID", "The state directory is not writable.");
  }
  return { ok: true, stopped: true, snapshot: snapshot(args.loopSrc) };
}

/**
 * Resume hook: clear an armed stop (if any) and continue from ledger state
 * with exactly one step. Ledger movement — not the call log — proves the
 * resume did work.
 */
export function resumeLoop(args: LoopDriverCall): LoopDriverStepOk | LoopDriverFailure {
  const badSrc = checkLoopSrc(args.loopSrc);
  if (badSrc) return badSrc;
  const badOwner = checkOwnership(args);
  if (badOwner) return badOwner;
  const refused = checkOwner(args.loopSrc, args);
  if (refused) return refused;
  try {
    if (stopArmed(args.loopSrc)) {
      fs.rmSync(stopPath(args.loopSrc), { force: true });
      appendLedger(args.loopSrc, "resumed", { sessionId: args.sessionId });
    }
  } catch {
    return fail("OMO_LOOP_DRIVER_LOOP_SRC_INVALID", "The state directory is not writable.");
  }
  return advanceLoop(args);
}

/** Reads-only status over the owned state dir. Malformed state degrades, never throws. */
export function getLoopDriverStatus(args: LoopDriverCall): LoopDriverStatusOk | LoopDriverFailure {
  const badSrc = checkLoopSrc(args.loopSrc);
  if (badSrc) return badSrc;
  const badOwner = checkOwnership(args);
  if (badOwner) return badOwner;
  try {
    return { ok: true, snapshot: snapshot(args.loopSrc) };
  } catch {
    return fail("OMO_LOOP_DRIVER_STATE_CORRUPT", "State cannot be read.");
  }
}

/** Fixture helper: an isolated state dir for tests and manual QA. */
export function createLoopFixtureDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "omo-loop-driver-"));
}
