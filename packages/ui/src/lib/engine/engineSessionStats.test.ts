import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { opencodeClient } from "@/lib/opencode/client";
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from "@/lib/runtime-url";
import { defaultEngineSessionStatsQuery, fetchEngineSessionStats } from "./engineSessionStats";

const previous = getRuntimeUrlResolver();
beforeEach(() => {
  configureRuntimeUrlResolver({ apiBaseUrl: "https://engine-stats.test" });
  opencodeClient.reconnectToRuntimeBaseUrl();
});
afterEach(() => {
  setRuntimeUrlResolver(previous);
  opencodeClient.reconnectToRuntimeBaseUrl();
});

const tokens = (input: number) => ({ input, output: 2, reasoning: 1, cache: { read: 3, write: 4 } });

const wire = {
  range: { from: 1_000, to: 2_000 },
  sessions: 2,
  subagents: 1,
  prompts: 5,
  steps: 9,
  tokens: tokens(10),
  cost: 1.25,
  tools: { mode: "none" },
  activeDays: 2,
  streak: 2,
  activity: [{ date: "2026-09-01", steps: 4 }],
  models: [],
};

describe("fetchEngineSessionStats", () => {
  test("projects the 7-day summary the Engine tab renders", async () => {
    let url: URL | null = null;
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      url = new URL(input instanceof Request ? input.url : input.toString());
      return Response.json({ data: wire });
    });
    try {
      const result = await fetchEngineSessionStats({ from: 1_000, timezone: "UTC" });
      expect(url!.pathname).toBe("/api/experimental/session/stats");
      expect(Object.fromEntries(url!.searchParams)).toEqual({
        from: "1000",
        timezone: "UTC",
        tools: "none",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.summary.sessions).toBe(2);
        expect(result.summary.prompts).toBe(5);
        expect(result.summary.steps).toBe(9);
        expect(result.summary.tokens.total).toBe(20);
        expect(result.summary.cost).toBe(1.25);
      }
    } finally {
      fetch.mockRestore();
    }
  });

  test("transport failure and non-ok read as unreachable, never as zeros", async () => {
    const down = spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("down");
    });
    try {
      expect(await fetchEngineSessionStats({ timezone: "UTC" })).toEqual({ ok: false, error: "unreachable" });
    } finally {
      down.mockRestore();
    }
    const gone = spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ _tag: "NotFoundError", message: "nope" }, { status: 404 }),
    );
    try {
      expect(await fetchEngineSessionStats({ timezone: "UTC" })).toEqual({ ok: false, error: "unreachable" });
    } finally {
      gone.mockRestore();
    }
  });

  test("off-shape bodies read as malformed, never as trusted tab state", async () => {
    const wrongType = spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ data: { ...wire, sessions: "two" } }),
    );
    try {
      expect(await fetchEngineSessionStats({ timezone: "UTC" })).toEqual({ ok: false, error: "malformed" });
    } finally {
      wrongType.mockRestore();
    }
    const nullTokens = spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ data: { ...wire, tokens: null } }),
    );
    try {
      expect(await fetchEngineSessionStats({ timezone: "UTC" })).toEqual({ ok: false, error: "malformed" });
    } finally {
      nullTokens.mockRestore();
    }
  });

  test("default window starts at local midnight six days ago", async () => {
    const now = new Date(2026, 9, 11, 15, 30, 0);
    const query = defaultEngineSessionStatsQuery(now);
    const start = new Date(query.from);
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 9, 5]);
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
    expect(query.from).toBeLessThanOrEqual(now.getTime());
    expect(query.timezone.length).toBeGreaterThan(0);
  });
});
