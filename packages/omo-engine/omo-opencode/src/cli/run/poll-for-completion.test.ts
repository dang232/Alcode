import { describe, test, expect } from "bun:test";
import { pollForCompletion } from "./poll-for-completion";
import { createEventState } from "./event-state";
import { handleToolResult } from "./event-tool-handlers";
import type { RunContext } from "./types";

function virtualClock() {
  let nowMs = 0;
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms;
    },
  };
}

function stubClient(statuses: Array<Record<string, { type: string }>>) {
  let calls = 0;
  const client = {
    session: {
      status: async () => ({ data: statuses[Math.min(calls++, statuses.length - 1)] ?? {} }),
      children: async () => ({ data: [] }),
      todo: async () => ({ data: [] }),
    },
  };
  return {
    client,
    statusCalls: () => calls,
  };
}

function stubContext(
  stub: ReturnType<typeof stubClient>,
  abortController: AbortController,
): RunContext {
  // SAFETY: pollForCompletion only reads ctx.client.session.status/children/todo
  // plus ctx.sessionID, ctx.directory, and ctx.verbose; the stub provides exactly that surface.
  return {
    client: stub.client,
    sessionID: "ses_1",
    directory: "I:/repo",
    abortController,
    verbose: false,
  } as RunContext;
}

const idle = { ses_1: { type: "idle" } };
const busy = { ses_1: { type: "busy" } };

describe("pollForCompletion failure set", () => {
  test("D01 delayed valid output stays observable: busy sessions are never exited early", async () => {
    const clock = virtualClock();
    const stub = stubClient([busy, busy, busy, idle]);
    const state = createEventState();
    const code = await pollForCompletion(
      stubContext(stub, new AbortController()),
      state,
      new AbortController(),
      { now: clock.now, sleep: clock.sleep, pollIntervalMs: 500 },
    );
    expect(code).toBe(0);
    expect(stub.statusCalls()).toBeGreaterThan(3);
  });

  test("D02 no first output reaches its deadline and fails instead of succeeding", async () => {
    const clock = virtualClock();
    const stub = stubClient([idle]);
    const state = createEventState();
    const code = await pollForCompletion(
      stubContext(stub, new AbortController()),
      state,
      new AbortController(),
      { now: clock.now, sleep: clock.sleep, pollIntervalMs: 500, requireMeaningfulWork: true },
    );
    expect(code).toBe(1);
    expect(clock.now()).toBeGreaterThan(60_000);
  });

  test("D05 cancellation wins the race: abort during pending work exits 130 once", async () => {
    const clock = virtualClock();
    const stub = stubClient([busy]);
    const state = createEventState();
    const runnerAbort = new AbortController();
    let sleeps = 0;
    const code = await pollForCompletion(
      stubContext(stub, runnerAbort),
      state,
      runnerAbort,
      {
        now: clock.now,
        sleep: async (ms: number) => {
          sleeps += 1;
          if (sleeps >= 2) runnerAbort.abort();
          await clock.sleep(ms);
        },
        pollIntervalMs: 500,
      },
    );
    expect(code).toBe(130);
  });

  test("D06 duplicate completion signals produce a single exit without extra work", async () => {
    const clock = virtualClock();
    const stub = stubClient([idle, idle, idle]);
    const state = createEventState();
    const code = await pollForCompletion(
      stubContext(stub, new AbortController()),
      state,
      new AbortController(),
      { now: clock.now, sleep: clock.sleep, pollIntervalMs: 500 },
    );
    expect(code).toBe(0);
  });

  test("D07 a session error during the run fails after grace cycles, never succeeds", async () => {
    const clock = virtualClock();
    const stub = stubClient([idle]);
    const state = createEventState();
    state.mainSessionError = true;
    state.lastError = "boom";
    const code = await pollForCompletion(
      stubContext(stub, new AbortController()),
      state,
      new AbortController(),
      { now: clock.now, sleep: clock.sleep, pollIntervalMs: 500 },
    );
    expect(code).toBe(1);
    expect(stub.statusCalls()).toBeGreaterThanOrEqual(3);
  });

  test("D09 a tool result for another session is dropped, never attributed", () => {
    const state = createEventState();
    state.currentTool = null;
    // SAFETY: handleToolResult only reads ctx.sessionID; the stub provides exactly that field.
    const ctx = { sessionID: "ses_a" } as RunContext;
    handleToolResult(
      ctx,
      { type: "tool.result", properties: { sessionID: "ses_b", output: "other-work" } },
      state,
    );
    expect(state.currentTool).toBeNull();
    expect(state.lastPartText).toBe("");
  });
});
