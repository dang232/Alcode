import { describe, expect, mock, test } from "bun:test";

const fetches: Array<string> = [];
let answers: Array<Response | Error> = [];

const statusJson = <T>(body: T, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const validBody = () => ({
  entry: "/user/engine/bin/oh-my-opencode.js",
  builtin: false,
  available: true,
  compatible: true,
  version: "1.2.3",
  runFlags: ["--port", "--attach", "--session-id", "--json"],
  missingRunFlags: [],
  message: null,
  binding: { alcoreModels: ["al-1-2", "al-1-2-flash", "al-1-3-max"], defaultRole: "default" },
});

mock.module("@/lib/runtime-fetch", () => ({
  runtimeFetch: mock((input: string) => {
    fetches.push(input);
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return Promise.resolve(next ?? statusJson(validBody()));
  }),
}));

const { fetchEngineStatus } = await import("./engineStatus");

const reset = (next: Array<Response | Error>) => {
  fetches.length = 0;
  answers = [...next];
};

describe("fetchEngineStatus", () => {
  test("accepts the server shape", async () => {
    reset([]);
    const result = await fetchEngineStatus();
    expect(fetches).toEqual(["/api/engine/status"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status.available).toBe(true);
      expect(result.status.binding.alcoreModels).toEqual(["al-1-2", "al-1-2-flash", "al-1-3-max"]);
    }
  });

  test("transport failure and non-ok read as unreachable", async () => {
    reset([new Error("down")]);
    expect(await fetchEngineStatus()).toEqual({ ok: false, error: "unreachable" });
    reset([statusJson(validBody(), 503)]);
    expect(await fetchEngineStatus()).toEqual({ ok: false, error: "unreachable" });
  });

  test("off-shape bodies read as malformed, never as trusted state", async () => {
    reset([statusJson({ nope: true })]);
    expect(await fetchEngineStatus()).toEqual({ ok: false, error: "malformed" });
    reset([statusJson({ ...validBody(), binding: null })]);
    expect(await fetchEngineStatus()).toEqual({ ok: false, error: "malformed" });
  });
});
