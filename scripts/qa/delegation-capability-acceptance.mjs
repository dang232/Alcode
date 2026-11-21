/**
 * Live acceptance script for Alcode's delegation capability.
 *
 * Run (the exact command, from a POSIX shell on this machine):
 *
 *   cd I:/migration/Alwork && ALCODE_CAPABILITY_TOKEN=ulw-probe-token node scripts/qa/delegation-capability-acceptance.mjs
 *
 * This is a deliberate, manually-run live check: it starts real tasks on the
 * live model, so a full run costs 3 model calls (checks 1+2, 3 and 7). Never
 * wire it into CI, package.json "test", run-isolated-tests or any scheduler.
 *
 * It starts nothing itself. The Alcode web server must already serve
 * /capability/* on http://127.0.0.1:3902 with its task host ready and a bound
 * parent session, and a live model must be configured for the children. Every
 * request is POST, content-type application/json, authorization: Bearer
 * $ALCODE_CAPABILITY_TOKEN (read from the environment; the script refuses to
 * start without it). Two endpoints only: /capability/task (launch) and
 * /capability/task/output (read). Polling is state-based with a bounded
 * deadline (1 s interval, never a fixed sleep loop); a read answers
 * {"taskID": "...", "output": {...}} where output.kind is "status" (carrying a
 * snapshot) or "not_found".
 *
 * The seven checks (execution order 4, 5, 1, 2, 6, 3, 7 — 4 and 5 are free and
 * double as the preflight that proves the gateway answers and the manager is
 * live; total cost 3 live model calls):
 *
 *   1. launch-task
 *      POST /capability/task with {"description": "alcode-acceptance-fg",
 *      "prompt": "Reply with exactly: DELEGATION-OK"} and NO parentSessionID in
 *      the body (see check 6). PASS: HTTP 200 with a non-empty taskID (st_...)
 *      and state in accepted | running | completed | failed | cancelled |
 *      unknown; the 200 arrives before the child finishes.
 *
 *   2. read-to-completed
 *      Poll that task (deadline 120 s) until output.kind === "status" and
 *      snapshot.status === "completed"; error / cancelled / interrupted / lost
 *      fail with the observed status. PASS: snapshot.final_response trims to
 *      DELEGATION-OK and snapshot.child_session_id is non-empty.
 *
 *   3. background-bg-ready
 *      Launch {"description": "alcode-acceptance-bg", "prompt": "Reply with
 *      exactly: BG-READY", "background": true}. The key MUST be "background":
 *      the host endpoint forwards only description, prompt, agent, category and
 *      background to the manager (oh-my-openAlcore/packages/omo-senpi/src/
 *      capability/task-endpoint.ts:75-81), so "run_in_background" would be
 *      silently dropped and the launch would block. PASS: HTTP 200 with a
 *      usable taskID and state !== "completed" (the launch did not block), then
 *      the read loop (deadline 180 s) reaches completed with final_response
 *      trimming to BG-READY.
 *
 *   4. unknown-id-not-found  (free, no model call)
 *      Read taskID "st_acceptance_does_not_exist". PASS: HTTP 200 with
 *      output.kind === "not_found" and output.reason naming the requested id.
 *
 *   5. empty-id-refused  (free, no model call)
 *      Read taskID "". PASS: HTTP 400 with
 *      {"error":"INVALID_ARGUMENT","message":"taskID and parentSessionID are
 *      required strings."}.
 *
 *   6. extra-parent-ignored  (two observations, no extra model call)
 *      (i) check 1's launch body carried no parentSessionID yet its snapshot
 *      carries a non-empty parent_session_id (the gateway resolved the host's
 *      bound session); (ii) re-reading check 1's task with parentSessionID
 *      "ses_extra_must_not_win" added still answers HTTP 200 with a
 *      parent_session_id that is non-empty and differs from it (the bound
 *      parent wins over the body). PASS when both hold.
 *
 *   7. call-omo-agent-child-session
 *      Launch the call_omo_agent prompt (deadline 300 s). PASS when
 *      final_response carries (i) a tool result JSON with a non-empty
 *      childSessionID differing from the task's own snapshot.child_session_id,
 *      (ii) that result's parentSessionID equal to snapshot.child_session_id,
 *      and (iii) the sentinel CALL-OK. CAPABILITY_UNAVAILABLE or an agent
 *      denial fails with the refusal text.
 *
 * Output: one "[check] <n>/7 <name> PASS|FAIL <observed>" line per check (the
 * observed value is mandatory on failure, and the verbatim response is printed
 * for every failure), then one RESULT line. The very last line is exactly
 * "ALL GREEN" only when all seven checks passed.
 *
 * Exit codes:
 *   0  every check passed; last line ALL GREEN
 *   1  any check failed (RESULT: FAIL; verbatim response printed per failure)
 *   2  BLOCKED <reason>, no verdict: ALCODE_CAPABILITY_TOKEN unset, gateway
 *      unreachable or answering 401, or the task host not ready (503
 *      TASK_MANAGER_UNAVAILABLE, or a launch 400 because no parent is bound)
 */

import { writeSync } from "node:fs";

import { asNonBlankString, asRecord } from "./wire-values.mjs";

const BASE_URL = "http://127.0.0.1:3902";
const REQUEST_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;
const CHECK2_DEADLINE_MS = 120_000;
const CHECK3_DEADLINE_MS = 180_000;
const CHECK7_DEADLINE_MS = 300_000;
const EXTRA_PARENT_SESSION_ID = "ses_extra_must_not_win";
const UNKNOWN_TASK_ID = "st_acceptance_does_not_exist";
const LAUNCH_STATES = new Set(["accepted", "running", "completed", "failed", "cancelled", "unknown"]);
const BAD_TERMINAL_STATUSES = new Set(["error", "cancelled", "interrupted", "lost"]);
const REFUSAL_PATTERN = /CAPABILITY_UNAVAILABLE|AGENT_NOT_ALLOWED/;

const TOKEN = process.env.ALCODE_CAPABILITY_TOKEN ?? "";
if (TOKEN.trim().length === 0) {
  writeSync(1, "BLOCKED ALCODE_CAPABILITY_TOKEN is unset; export it before running this acceptance script\n");
  process.exit(2);
}

// All harness output is buffered so a BLOCKED exit can print exactly one line.
const output = [];
function say(line) {
  output.push(line);
}
function flushOutput() {
  for (const line of output) writeSync(1, `${line}\n`);
  output.length = 0;
}

class BlockedExit extends Error {}

function blockAndExit(reason) {
  writeSync(1, `BLOCKED ${reason}\n`);
  throw new BlockedExit(reason);
}

function errorMessage(error) {
  const parts = [];
  let current = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth += 1) {
    if (current instanceof Error) {
      if (current.message) parts.push(current.message);
      current = current.cause;
    } else {
      const text = String(current);
      if (text.length > 0) parts.push(text);
      current = undefined;
    }
  }
  return parts.length > 0 ? parts.join(": ") : "unknown error";
}

function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function bounded(text, max = 700) {
  const flat = oneLine(text);
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

function sleep(ms) {
  // Deliberately not unref'd: this timer is the poll cadence and must keep the
  // run alive until the state condition or the deadline is reached.
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// HTTP: one POST helper. Unreachable gateway and 401 are BLOCKED (exit 2),
// never check failures.
// ---------------------------------------------------------------------------
async function post(pathname, body) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") {
      blockAndExit(`gateway did not answer ${pathname} within ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    blockAndExit(`gateway unreachable at ${BASE_URL}${pathname}: ${errorMessage(error)}`);
  }
  if (response.status === 401) {
    blockAndExit(`gateway answered 401 UNAUTHORIZED for ${pathname}; ALCODE_CAPABILITY_TOKEN is not the server's token`);
  }
  const raw = await response.text();
  let json = null;
  try {
    json = raw.length > 0 ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  return { status: response.status, raw, json };
}

// A launch 400 means description/prompt/parentSessionID is missing, and the
// first two are always supplied here — so it means no bound parent (environment).
// A 503 is TASK_MANAGER_UNAVAILABLE (host starting / not bound) — also environment.
async function launch(body) {
  const res = await post("/capability/task", body);
  if (res.status === 400) {
    blockAndExit(`launch refused 400 (the host has no bound parent session): ${bounded(res.raw)}`);
  }
  if (res.status === 503) {
    blockAndExit(`task host not ready: ${bounded(res.raw)}`);
  }
  if (res.status === 200) liveModelCalls += 1;
  return res;
}

// A read 503 is TASK_MANAGER_UNAVAILABLE; a read 400 with a non-empty taskID
// can only be the missing bound parent (the empty-taskID 400 is check 5, which
// calls post() directly).
async function read(taskID, extraBody) {
  const res = await post("/capability/task/output", extraBody === undefined ? { taskID } : { taskID, ...extraBody });
  if (res.status === 503) {
    blockAndExit(`task manager unavailable while reading ${taskID}: ${bounded(res.raw)}`);
  }
  if (res.status === 400 && taskID.length > 0) {
    blockAndExit(`read refused 400 (the host has no bound parent session): ${bounded(res.raw)}`);
  }
  return res;
}

// State-based polling with a bounded deadline: read, evaluate the observed
// state, sleep 1 s, repeat — never a fixed number of attempts or sleeps.
async function pollToCompleted(taskID, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let lastObserved = "unread";
  let lastSnapshot = null;
  for (;;) {
    const res = await read(taskID);
    if (res.status !== 200) {
      return { kind: "http", res, lastObserved, lastSnapshot };
    }
    const outputBody = asRecord(asRecord(res.json)?.output);
    if (outputBody !== null && outputBody.kind === "status") {
      const snapshot = asRecord(outputBody.snapshot);
      const status = snapshot === null ? "unknown" : (asNonBlankString(snapshot.status) ?? "unknown");
      lastObserved = status;
      lastSnapshot = snapshot;
      if (status === "completed") return { kind: "completed", res, lastObserved, lastSnapshot };
      if (BAD_TERMINAL_STATUSES.has(status)) return { kind: "terminal", res, lastObserved, lastSnapshot };
    } else {
      lastObserved = `output:${outputBody === null ? "unreadable" : String(outputBody.kind ?? "unknown")}`;
    }
    if (Date.now() >= deadline) {
      return { kind: "deadline", res, lastObserved, lastSnapshot };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// Check recording.
// ---------------------------------------------------------------------------
const results = new Map();
let liveModelCalls = 0;

function record(n, name, pass, observed, raw) {
  results.set(n, { pass });
  say(`[check] ${n}/7 ${name} ${pass ? "PASS" : "FAIL"} ${bounded(observed)}`);
  if (!pass && raw !== undefined) {
    if (raw === null || raw.length === 0) {
      say("response: (empty body)");
    } else {
      say("response:");
      say(raw);
    }
  }
}

function notAttempted(n, name, reason) {
  record(n, name, false, `not attempted: ${reason}`);
}

// ---------------------------------------------------------------------------
// check 7 helpers: find the tool result JSON in the child's final response.
// ---------------------------------------------------------------------------
function balancedJsonAt(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function toolResultIn(text) {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{") continue;
    const raw = balancedJsonAt(text, index);
    if (raw === null) continue;
    try {
      const parsed = JSON.parse(raw);
      const candidate = asRecord(parsed);
      if (candidate !== null && asNonBlankString(candidate.childSessionID) !== null) return candidate;
    } catch {
      // Not the tool result JSON; keep scanning.
    }
  }
  return null;
}

function lineContaining(text, token) {
  const lines = String(text).split(/\r?\n/);
  return lines.find((line) => line.includes(token)) ?? token;
}

function launchObservation(res) {
  const body = asRecord(res.json);
  return {
    taskID: asNonBlankString(body?.taskID) ?? "",
    state: asNonBlankString(body?.state) ?? "",
  };
}

function launchFailure(n, name, res) {
  const { taskID, state } = launchObservation(res);
  record(n, name, false, `status=${res.status} taskID=${taskID || "none"} state=${state || "none"}`, res.raw);
}

function pollFailure(n, name, polled) {
  if (polled.kind === "terminal") {
    record(n, name, false, `status=${polled.lastObserved}`, polled.res.raw);
  } else if (polled.kind === "deadline") {
    record(n, name, false, `deadline reached, last=${polled.lastObserved}`, polled.res.raw);
  } else {
    record(n, name, false, `read status=${polled.res.status}`, polled.res.raw);
  }
}

// The parent must be a live OpenCode session: the gateway verifies it against the engine. This QA run
// happens on the operator's machine, so the newest session in the target project is the natural default;
// both inputs stay overridable so the harness never guesses on another layout.
async function resolveOpenCodeParent() {
  const explicit = asNonBlankString(process.env.ALCODE_ACCEPTANCE_PARENT_SESSION);
  const wanted = asNonBlankString(process.env.ALCODE_ACCEPTANCE_PROJECT_DIR) ?? "";
  if (explicit !== null) return { sessionID: explicit, directory: wanted };
  const dbPath =
    asNonBlankString(process.env.ALCODE_ACCEPTANCE_OPENCODE_DB) ??
    `${process.env.USERPROFILE ?? ""}\\.local\\share\\opencode\\opencode.db`;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row =
      wanted.length > 0
        ? db.prepare("SELECT id, directory FROM session_v2 WHERE directory = ? ORDER BY time_updated DESC LIMIT 1").get(wanted)
        : db.prepare("SELECT id, directory FROM session_v2 ORDER BY time_updated DESC LIMIT 1").get();
    db.close();
    const id = asNonBlankString(row?.id);
    return id === null ? null : { sessionID: id, directory: asNonBlankString(row?.directory) ?? wanted };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main: execution order 1, 4, 5, 2, 6, 3, 7 (a read before any launch has no bound parent).
// ---------------------------------------------------------------------------
let firstTaskID = "";
let firstSnapshot = null;

try {
  // check 1 — launch the foreground task with NO parentSessionID in the body.
  {
    const res = await launch({
      description: "alcode-acceptance-fg",
      prompt: "Reply with exactly: DELEGATION-OK",
    });
    if (res.status !== 200) {
      launchFailure(1, "launch-task", res);
    } else {
      const { taskID, state } = launchObservation(res);
      if (taskID.length > 0 && LAUNCH_STATES.has(state)) {
        firstTaskID = taskID;
        record(1, "launch-task", true, `taskID=${taskID} state=${state}`);
      } else {
        record(
          1,
          "launch-task",
          false,
          `status=200 taskID=${taskID || "none"} state=${state || "none"}`,
          res.raw,
        );
      }
    }
  }

  // check 4 — free preflight: an unknown id answers not_found.
  {
    const res = await read(UNKNOWN_TASK_ID);
    const outputBody = asRecord(asRecord(res.json)?.output);
    const reason = outputBody === null ? "" : String(outputBody.reason ?? "");
    const pass =
      res.status === 200 && outputBody?.kind === "not_found" && reason.includes(UNKNOWN_TASK_ID);
    record(
      4,
      "unknown-id-not-found",
      pass,
      pass ? "kind=not_found" : `status=${res.status} kind=${outputBody?.kind ?? "none"} reason=${bounded(reason)}`,
      res.raw,
    );
  }

  // check 5 — free preflight: an empty id is refused with 400.
  {
    const res = await post("/capability/task/output", { taskID: "" });
    if (res.status === 503) {
      blockAndExit(`task manager unavailable: ${bounded(res.raw)}`);
    }
    const body = asRecord(res.json);
    const error = asNonBlankString(body?.error) ?? "none";
    const message = asNonBlankString(body?.message) ?? "";
    const pass =
      res.status === 400 &&
      error === "INVALID_ARGUMENT" &&
      message === "taskID and parentSessionID are required strings.";
    record(
      5,
      "empty-id-refused",
      pass,
      pass
        ? "status=400 error=INVALID_ARGUMENT"
        : `status=${res.status} error=${error} message=${bounded(message)}`,
      res.raw,
    );
  }

  // check 2 — read the shared task to completed (deadline 120 s).
  if (firstTaskID.length === 0) {
    notAttempted(2, "read-to-completed", "check 1 produced no taskID");
  } else {
    const polled = await pollToCompleted(firstTaskID, CHECK2_DEADLINE_MS);
    if (polled.lastSnapshot !== null) firstSnapshot = polled.lastSnapshot;
    if (polled.kind === "completed") {
      const snapshot = polled.lastSnapshot;
      const finalResponse = asNonBlankString(snapshot?.final_response) ?? "";
      const childSessionID = asNonBlankString(snapshot?.child_session_id) ?? "";
      if (finalResponse.trim() !== "DELEGATION-OK") {
        record(2, "read-to-completed", false, `final_response=${bounded(finalResponse)}`, polled.res.raw);
      } else if (childSessionID.length === 0) {
        record(2, "read-to-completed", false, "child_session_id is empty", polled.res.raw);
      } else {
        record(2, "read-to-completed", true, "final_response=DELEGATION-OK");
      }
    } else {
      pollFailure(2, "read-to-completed", polled);
    }
  }

  // check 6 — the extra parentSessionID in the body must not win.
  if (firstTaskID.length === 0) {
    notAttempted(6, "extra-parent-ignored", "check 1 produced no taskID");
  } else {
    const res = await read(firstTaskID, { parentSessionID: EXTRA_PARENT_SESSION_ID });
    if (res.status !== 200) {
      record(6, "extra-parent-ignored", false, `status=${res.status}`, res.raw);
    } else {
      const snapshot = asRecord(asRecord(asRecord(res.json)?.output)?.snapshot);
      const rereadParent = snapshot === null ? null : asNonBlankString(snapshot.parent_session_id);
      const launchParent =
        firstSnapshot === null ? null : asNonBlankString(firstSnapshot.parent_session_id);
      // (i) the task got a parent although check 1's launch body carried none;
      // (ii) the bound parent still wins over the body's extra id.
      const gotParent = (launchParent ?? rereadParent) ?? null;
      const extraIgnored = rereadParent !== null && rereadParent !== EXTRA_PARENT_SESSION_ID;
      const pass = gotParent !== null && extraIgnored;
      record(
        6,
        "extra-parent-ignored",
        pass,
        pass
          ? `parent=${rereadParent} (not ${EXTRA_PARENT_SESSION_ID})`
          : `parent_from_launch=${launchParent ?? "empty"} parent_with_extra=${rereadParent ?? "empty"}`,
        res.raw,
      );
    }
  }

  // check 3 — background launch (background: true, NOT run_in_background).
  {
    const res = await launch({
      description: "alcode-acceptance-bg",
      prompt: "Reply with exactly: BG-READY",
      background: true,
    });
    const { taskID, state } = launchObservation(res);
    if (res.status !== 200 || taskID.length === 0) {
      launchFailure(3, "background-bg-ready", res);
    } else if (!LAUNCH_STATES.has(state)) {
      record(3, "background-bg-ready", false, `state=${state || "none"} is not a known launch state`, res.raw);
    } else if (state === "completed") {
      record(
        3,
        "background-bg-ready",
        false,
        "state=completed at launch; the launch blocked instead of returning early",
        res.raw,
      );
    } else {
      const polled = await pollToCompleted(taskID, CHECK3_DEADLINE_MS);
      if (polled.kind === "completed") {
        const finalResponse = asNonBlankString(polled.lastSnapshot?.final_response) ?? "";
        if (finalResponse.trim() !== "BG-READY") {
          record(3, "background-bg-ready", false, `final_response=${bounded(finalResponse)}`, polled.res.raw);
        } else {
          record(3, "background-bg-ready", true, "final_response=BG-READY");
        }
      } else {
        pollFailure(3, "background-bg-ready", polled);
      }
    }
  }

  // check 7 - child-session capability: a real OpenCode parent mints a child, a bogus parent is refused.
  // The task host's native children do not carry the OpenCode-side call_omo_agent tool, so this drives the
  // same gateway route that tool uses: POST /capability/session.
  {
    const parent = await resolveOpenCodeParent();
    if (parent === null) {
      notAttempted(
        7,
        "child-session-capability",
        "no OpenCode parent session found; set ALCODE_ACCEPTANCE_PARENT_SESSION (and ALCODE_ACCEPTANCE_PROJECT_DIR)",
      );
    } else {
      const created = await post("/capability/session", {
        parentID: parent.sessionID,
        title: "alcode-acceptance-child",
        directory: parent.directory,
      });
      const createdBody = asRecord(created.json);
      const childID = asNonBlankString(createdBody?.sessionID) ?? "";
      // Starting the child is the second half of the capability: creating a session proves nothing if the
      // prompt never reaches the engine (routes.js dispatched with the raw SDK shape and answered "unknown").
      const started = await post("/capability/session/start", {
        sessionID: childID,
        prompt: "Reply with exactly: CHILD-OK",
        directory: parent.directory,
      });
      const startedBody = asRecord(started.json);
      const startOutcome = asNonBlankString(startedBody?.outcome) ?? "none";
      // The child answers asynchronously: read until it produces an assistant message or the deadline passes.
      const readDeadline = Date.now() + 90000;
      let readBody = null;
      let readRaw = "";
      while (Date.now() < readDeadline) {
        const read = await post("/capability/session/read", { sessionID: childID, directory: parent.directory });
        readRaw = read.raw;
        readBody = asRecord(read.json);
        if (asNonBlankString(readBody?.final_response) !== null) break;
        await sleep(2000);
      }
      const finalText = asNonBlankString(readBody?.final_response) ?? "";
      const refused = await post("/capability/session", {
        parentID: "ses_does_not_exist",
        title: "alcode-acceptance-bogus",
        directory: parent.directory,
      });
      const refusedBody = asRecord(refused.json);
      if (created.status !== 200 || childID.length === 0) {
        record(
          7,
          "child-session-capability",
          false,
          `create status=${created.status} error=${asNonBlankString(createdBody?.error) ?? "none"}`,
          created.raw,
        );
      } else if (started.status !== 200 || startOutcome !== "accepted") {
        record(7, "child-session-capability", false, `start status=${started.status} outcome=${startOutcome}`, started.raw);
      } else if (asNonBlankString(readBody?.kind) !== "status" || finalText.length === 0) {
        record(7, "child-session-capability", false, `read kind=${asNonBlankString(readBody?.kind) ?? "none"} final=${bounded(finalText)}`, readRaw);
      } else if (refused.status !== 403 || asNonBlankString(refusedBody?.error) !== "FORBIDDEN") {
        record(7, "child-session-capability", false, `a bogus parent was not refused: status=${refused.status}`, refused.raw);
      } else {
        record(
          7,
          "child-session-capability",
          true,
          `child=${childID} start=${startOutcome} read=${bounded(finalText)} bogus403`,
          created.raw,
        );
      }
    }
  }

  const passed = [...results.values()].filter((entry) => entry.pass).length;
  const liveCalls = `${liveModelCalls} live model call${liveModelCalls === 1 ? "" : "s"}`;
  if (passed === 7) {
    say(`RESULT: PASS (7/7 checks passed; ${liveCalls})`);
    say("ALL GREEN");
  } else {
    say(`RESULT: FAIL (${passed}/7 checks passed; ${liveCalls})`);
  }
  flushOutput();
  process.exitCode = passed === 7 ? 0 : 1;
} catch (error) {
  if (error instanceof BlockedExit) {
    flushOutput();
    process.exitCode = 2;
  } else {
  const passed = [...results.values()].filter((entry) => entry.pass).length;
  say(
    `RESULT: FAIL (${passed}/7 checks passed; ` +
      `${liveModelCalls} live model call${liveModelCalls === 1 ? "" : "s"}; ` +
      `unexpected error: ${bounded(errorMessage(error))})`,
  );
  flushOutput();
  process.exitCode = 1;
  }
}
