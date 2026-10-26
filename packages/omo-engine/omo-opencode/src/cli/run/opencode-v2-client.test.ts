import { describe, test, expect, afterEach } from "bun:test";
import {
  assertSupportedServerVersion,
  createV2EngineClient,
  normalizeV2Failure,
  spawnManagedV2Server,
  translateV2Event,
  V2ProtocolError,
  V2UnsupportedServerError,
} from "./opencode-v2-client";

interface SeenRequest {
  method: string
  path: string
  bodyText: string
}

interface StubServer {
  baseUrl: string
  seen: SeenRequest[]
  stop: () => void
}

type RouteHandler = (request: Request) => Response | Promise<Response>

const openServers: Array<{ stop: () => Promise<void> }> = [];

afterEach(async () => {
  const pending = openServers.splice(0, openServers.length);
  await Promise.all(pending.map((server) => server.stop().catch(() => undefined)));
});

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function startStub(routes: Record<string, RouteHandler>): Promise<StubServer> {
  const seen: SeenRequest[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const url = new URL(request.url);
      const bodyText = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
      seen.push({ method: request.method, path: url.pathname, bodyText });
      const handler = routes[`${request.method} ${url.pathname}`] ?? routes[url.pathname];
      if (handler) return handler(request);
      return jsonResponse({ _tag: "UnknownError", message: "not stubbed" }, 500);
    },
  });
  openServers.push({ stop: async () => server.stop() });
  return { baseUrl: `http://127.0.0.1:${server.port}`, seen, stop: () => server.stop() };
}

describe("assertSupportedServerVersion", () => {
  test("accepts the pinned 2.0.32 server", () => {
    expect(() => assertSupportedServerVersion("2.0.32")).not.toThrow();
  });

  test("rejects the 1.x generation", () => {
    expect(() => assertSupportedServerVersion("1.18.31")).toThrow(V2UnsupportedServerError);
  });

  test("rejects an unmet future major", () => {
    expect(() => assertSupportedServerVersion("3.0.0")).toThrow(V2UnsupportedServerError);
  });

  test("rejects a missing version", () => {
    expect(() => assertSupportedServerVersion("")).toThrow(V2UnsupportedServerError);
  });
});

describe("normalizeV2Failure", () => {
  test("maps a tagged 404 body to a classified protocol error", () => {
    try {
      normalizeV2Failure("session.get", { _tag: "SessionNotFoundError", message: "gone" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(V2ProtocolError);
      // SAFETY: normalizeV2Failure only throws V2ProtocolError for tagged bodies; the cast names that contract.
      expect((error as V2ProtocolError).status).toBe(404);
      // SAFETY: same contract as above; the message names the failing operation.
      expect((error as V2ProtocolError).message).toContain("session.get");
    }
  });

  test("rethrows transport failures untouched so classifiers keep the cause", () => {
    const cause = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
    const clientError = Object.assign(new Error("Transport"), { name: "ClientError", reason: "Transport", cause });
    try {
      normalizeV2Failure("session.get", clientError);
      expect.unreachable();
    } catch (error) {
      expect(error).toBe(cause);
    }
  });
});

describe("translateV2Event", () => {
  const sessionID = "ses_test123456789012345678901234";

  test("execution start maps to a busy status", () => {
    expect(translateV2Event({ type: "session.execution.started", data: { sessionID } })).toEqual([
      { type: "session.status", properties: { sessionID, status: { type: "busy" } } },
    ]);
  });

  test("execution failure maps to an error plus an idle status, never success", () => {
    const payloads = translateV2Event({
      type: "session.execution.failed",
      data: { sessionID, error: { message: "boom" } },
    });
    expect(payloads[0]).toEqual({ type: "session.error", properties: { sessionID, error: "boom" } });
    expect(payloads[1]).toEqual({ type: "session.status", properties: { sessionID, status: { type: "idle" } } });
  });

  test("text deltas map to text part deltas with a stable part id", () => {
    expect(translateV2Event({
      type: "session.text.delta",
      data: { sessionID, assistantMessageID: "msg_1", ordinal: 0, delta: "hi" },
    })).toEqual([{
      type: "message.part.delta",
      properties: { sessionID, messageID: "msg_1", partID: "msg_1:text", field: "text", delta: "hi" },
    }]);
  });

  test("reasoning deltas map to the reasoning part id so think blocks stay separate", () => {
    expect(translateV2Event({
      type: "session.reasoning.delta",
      data: { sessionID, assistantMessageID: "msg_1", ordinal: 0, delta: "hmm" },
    })).toEqual([{
      type: "message.part.delta",
      properties: { sessionID, messageID: "msg_1", partID: "msg_1:reasoning", field: "text", delta: "hmm" },
    }]);
  });

  test("tool calls map to tool.execute without inventing a tool name", () => {
    expect(translateV2Event({
      type: "session.tool.called",
      data: { sessionID, assistantMessageID: "msg_1", id: "call_1", input: { a: 1 }, executed: true },
    })).toEqual([{
      type: "tool.execute",
      properties: { sessionID, name: "unknown", input: { a: 1 }, id: "call_1" },
    }]);
  });

  test("location never gates translation; session correlation is by session id", () => {
    const expected = [{
      type: "message.part.delta",
      properties: { sessionID, messageID: "m", partID: "m:text", field: "text", delta: "x" },
    }];
    expect(translateV2Event({
      type: "session.text.delta",
      data: { sessionID, assistantMessageID: "m", ordinal: 0, delta: "x" },
      location: { directory: "I:\\repo" },
    })).toEqual(expected);
    expect(translateV2Event({
      type: "session.text.delta",
      data: { sessionID, assistantMessageID: "m", ordinal: 0, delta: "x" },
      location: { directory: "/elsewhere" },
    })).toEqual(expected);
    expect(translateV2Event({
      type: "session.text.delta",
      data: { sessionID, assistantMessageID: "m", ordinal: 0, delta: "x" },
    })).toEqual(expected);
  });

  test("events without a session id are ignored instead of crashing the stream", () => {
    expect(translateV2Event({ type: "server.connected", data: {} })).toEqual([]);
    expect(translateV2Event({ type: "session.text.delta", data: {} })).toEqual([]);
  });

  test("unknown event types are ignored instead of crashing the stream", () => {
    expect(translateV2Event({ type: "session.something.new", data: { sessionID } })).toEqual([]);
  });

  test("an unrecognized status type maps to idle, never busy", () => {
    expect(translateV2Event({
      type: "session.status",
      data: { sessionID, status: { type: "weird" } },
    })).toEqual([
      { type: "session.status", properties: { sessionID, status: { type: "idle" } } },
    ]);
  });

  test("duplicate execution events translate identically with no accumulated state", () => {
    const event = { type: "session.execution.succeeded", data: { sessionID } };
    const first = translateV2Event(event);
    const second = translateV2Event(event);
    expect(second).toEqual(first);
    expect(first).toEqual([
      { type: "session.status", properties: { sessionID, status: { type: "idle" } } },
    ]);
  });

  test("tool results keep their own session id so handlers can correlate them", () => {
    expect(translateV2Event({
      type: "session.tool.success",
      data: { sessionID: "ses_other", assistantMessageID: "msg_1", id: "call_9", content: [{ type: "text", text: "ok" }] },
    })).toEqual([{
      type: "tool.result",
      properties: { sessionID: "ses_other", output: "ok" },
    }]);
  });
});

describe("createV2EngineClient against a stub 2.x server", () => {
  test("session.create posts to /api/session with mapped permissions and location", async () => {
    const stub = await startStub({
      "POST /api/session": () => jsonResponse({ data: { id: "ses_abc", title: "t" } }),
    });
    const client = createV2EngineClient({ baseUrl: stub.baseUrl });
    const res = await client.session.create({
      body: { title: "t", permission: [{ permission: "question", action: "deny", pattern: "*" }] },
      query: { directory: "I:/repo" },
    });
    expect(res.error).toBeUndefined();
    expect(res.data?.id).toBe("ses_abc");
    expect(stub.seen).toHaveLength(1);
    expect(stub.seen[0]?.path).toBe("/api/session");
    expect(JSON.parse(stub.seen[0]?.bodyText ?? "{}")).toEqual({
      title: "t",
      permissions: [{ action: "question", resource: "*", effect: "deny" }],
      location: { directory: "I:/repo" },
    });
  });

  test("a tagged 404 becomes an error envelope, not a throw", async () => {
    const stub = await startStub({
      "GET /api/session/ses_missing": () => jsonResponse({ _tag: "SessionNotFoundError", message: "gone" }, 404),
    });
    const client = createV2EngineClient({ baseUrl: stub.baseUrl });
    const res = await client.session.get({ path: { id: "ses_missing" } });
    expect(res.data).toBeUndefined();
    expect(res.error?.status).toBe(404);
    expect(res.error?.message).toContain("session.get");
  });

  test("session.status matches directories across slash forms instead of reporting idle", async () => {
    const stub = await startStub({
      "GET /api/session/active": () => jsonResponse({ data: { ses_1: {} } }),
      "GET /api/session/ses_1": () => jsonResponse({ data: { id: "ses_1", location: { directory: "I:\\migration\\Alwork" } } }),
    });
    const client = createV2EngineClient({ baseUrl: stub.baseUrl });
    const res = await client.session.status({ query: { directory: "I:/migration/Alwork" } });
    expect(res.error).toBeUndefined();
    expect(res.data).toEqual({ ses_1: { type: "busy" } });
  });

  test("transport failures reject untouched", async () => {
    const cause = Object.assign(new Error("down"), { code: "ECONNREFUSED" });
    const client = createV2EngineClient({
      baseUrl: "http://127.0.0.1:1",
      fetchImpl: (async () => {
        throw cause;
      }),
    });
    await expect(client.session.get({ path: { id: "ses_1" } })).rejects.toBe(cause);
  });

  test("session.todo derives completion from transcript tool states", async () => {
    const stub = await startStub({
      "GET /api/session/ses_1/message": () => jsonResponse({
        data: [{
          id: "msg_1",
          type: "assistant",
          agent: "a",
          model: { providerID: "p", id: "m" },
          time: { created: 1 },
          content: [{
            type: "tool",
            name: "todowrite",
            state: {
              status: "completed",
              content: [{ type: "text", text: JSON.stringify([{ content: "x", status: "in_progress", priority: "high" }]) }],
            },
          }],
        }],
        cursor: {},
      }),
    });
    const client = createV2EngineClient({ baseUrl: stub.baseUrl });
    const res = await client.session.todo({ path: { id: "ses_1" } });
    expect(res.error).toBeUndefined();
    expect(res.data).toEqual([{ id: undefined, content: "x", status: "in_progress", priority: "high" }]);
  });

  test("unparseable todo output fails closed instead of reporting complete", async () => {
    const stub = await startStub({
      "GET /api/session/ses_1/message": () => jsonResponse({
        data: [{
          id: "msg_1",
          type: "assistant",
          agent: "a",
          time: { created: 1 },
          content: [{
            type: "tool",
            name: "todo",
            state: { status: "completed", content: [{ type: "text", text: "not-json{{{" }] },
          }],
        }],
        cursor: {},
      }),
    });
    const client = createV2EngineClient({ baseUrl: stub.baseUrl });
    const res = await client.session.todo({ path: { id: "ses_1" } });
    expect(res.data).toBeUndefined();
    expect(res.error?.code).toBe("V2_TODO_UNPARSEABLE");
  });

  test("session.create forwards parentage, agent, and model when provided", async () => {
    const stub = await startStub({
      "POST /api/session": () => jsonResponse({ data: { id: "ses_child" } }),
    });
    const client = createV2EngineClient({ baseUrl: stub.baseUrl });
    const res = await client.session.create({
      body: { parentID: "ses_parent", agent: "atlas", model: { providerID: "p", modelID: "m" } },
    });
    expect(res.error).toBeUndefined();
    expect(JSON.parse(stub.seen[0]?.bodyText ?? "{}")).toEqual({
      parentID: "ses_parent",
      agent: "atlas",
      model: { providerID: "p", id: "m" },
    });
  });

  test("promptAsync applies the requested model before dispatching", async () => {
    const stub = await startStub({
      "POST /api/session/ses_1/model": () => new Response(null, { status: 204 }),
      "POST /api/session/ses_1/prompt": () => jsonResponse({ data: { id: "msg_1" } }),
    });
    const client = createV2EngineClient({ baseUrl: stub.baseUrl });
    const res = await client.session.promptAsync({
      path: { id: "ses_1" },
      body: { model: { providerID: "p", modelID: "m" }, parts: [{ type: "text", text: "hi" }] },
    });
    expect(res.error).toBeUndefined();
    expect(stub.seen.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      "POST /api/session/ses_1/model",
      "POST /api/session/ses_1/prompt",
    ]);
  });

  test("a failed model switch blocks the prompt instead of running the wrong model", async () => {
    const stub = await startStub({
      "POST /api/session/ses_1/model": () => jsonResponse({ _tag: "ProviderNotFoundError", message: "nope" }, 404),
    });
    const client = createV2EngineClient({ baseUrl: stub.baseUrl });
    const res = await client.session.promptAsync({
      path: { id: "ses_1" },
      body: { model: { providerID: "p", modelID: "m" }, parts: [{ type: "text", text: "hi" }] },
    });
    expect(res.data).toBeUndefined();
    expect(res.error?.status).toBe(404);
    expect(stub.seen.map((entry) => entry.path)).not.toContain("/api/session/ses_1/prompt");
  });

  test("promptAsync refuses empty prompts before any request leaves", async () => {
    const stub = await startStub({});
    const client = createV2EngineClient({ baseUrl: stub.baseUrl });
    const res = await client.session.promptAsync({
      path: { id: "ses_1" },
      body: { agent: "a", model: { providerID: "p", modelID: "m" }, parts: [] },
    });
    expect(res.error?.code).toBe("V2_PROMPT_EMPTY");
    expect(stub.seen).toHaveLength(0);
  });
});

describe("event subscription contract", () => {
  test("subscribe returns a directly iterable stream, not a { stream } envelope", async () => {
    const stub = await startStub({
      "GET /api/event": () => new Response(
        'data: {"type":"session.status","data":{"sessionID":"ses_1","status":{"type":"busy"}}}\n\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    });
    const client = createV2EngineClient({ baseUrl: stub.baseUrl });
    const events = await client.event.subscribe();
    expect(events[Symbol.asyncIterator]).toBeDefined();
    const received: Array<{ type?: string }> = [];
    const done = (async () => {
      for await (const event of events) {
        received.push(event);
        break;
      }
    })();
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 5000))]);
    expect(received).toEqual([{
      type: "session.status",
      properties: { sessionID: "ses_1", status: { type: "busy" } },
    }]);
  });
});

interface FakeSpawnedProcess {
  proc: { stdout: ReadableStream<Uint8Array>; kill: () => void; exited: Promise<number> }
  killed: () => boolean
}

function fakeProc(lines: string[]): FakeSpawnedProcess {
  let dead = false;
  let resolveExited: (code: number) => void = () => undefined;
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(lines.join("\n") + "\n"));
    },
  });
  return {
    proc: {
      stdout,
      kill: () => {
        dead = true;
        resolveExited(0);
      },
      exited: new Promise<number>((resolve) => {
        resolveExited = resolve;
      }),
    },
    killed: () => dead,
  };
}

describe("spawnManagedV2Server", () => {
  test("a missing binary fails with the port-start marker and no spawn", async () => {
    let spawned = false;
    const error = await spawnManagedV2Server({
      port: 45901,
      findBinary: async () => {
        spawned = true;
        return null;
      },
    }).then(
      () => null,
      (failure: Error) => failure,
    );
    expect(spawned).toBe(true);
    expect(error).toBeInstanceOf(V2ProtocolError);
    expect(error.message).toContain("Failed to start server on port 45901");
  });

  test("a banner without API health times out bounded and kills the process", async () => {
    const fake = fakeProc(["server listening on http://127.0.0.1:45902"]);
    const error = await spawnManagedV2Server({
      port: 45902,
      findBinary: async () => "test-binary",
      spawnImpl: () => fake.proc,
      bannerTimeoutMs: 1000,
      healthTimeoutMs: 500,
      fetchImpl: (async () => {
        throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
      }),
    }).then(
      () => null,
      (failure: Error) => failure,
    );
    expect(error).toBeInstanceOf(V2ProtocolError);
    // SAFETY: readiness timeouts keep the V2ProtocolError class and carry the port marker for the retry contract.
    expect((error as V2ProtocolError).code).toBe("V2_READINESS_TIMEOUT");
    expect(error.message).toContain("Failed to start server on port 45902");
    expect(fake.killed()).toBe(true);
  }, 15000);

  test("a legacy 1.x banner is still recognized, then health-gated", async () => {
    const fake = fakeProc([
      "opencode server listening on http://127.0.0.1:45904",
      "server password pw-legacy",
    ]);
    const seen: string[] = [];
    const managed = await spawnManagedV2Server({
      port: 45904,
      findBinary: async () => "test-binary",
      spawnImpl: () => fake.proc,
      bannerTimeoutMs: 1000,
      healthTimeoutMs: 1000,
      fetchImpl: async (input: string | URL | Request) => {
        seen.push(String(input));
        return jsonResponse({ version: "2.0.32" });
      },
    });
    expect(managed.baseUrl).toBe("http://127.0.0.1:45904");
    expect(managed.password).toBe("pw-legacy");
    expect(seen).toEqual(["http://127.0.0.1:45904/api/info"]);
    await managed.stop();
    expect(fake.killed()).toBe(true);
  }, 15000);

  test("a wrong-version server is rejected as unsupported, not retried", async () => {
    const fake = fakeProc(["server listening on http://127.0.0.1:45903"]);
    const error = await spawnManagedV2Server({
      port: 45903,
      findBinary: async () => "test-binary",
      spawnImpl: () => fake.proc,
      bannerTimeoutMs: 1000,
      healthTimeoutMs: 1000,
      fetchImpl: (async () => jsonResponse({ version: "1.99.0" })),
    }).then(
      () => null,
      (failure: Error) => failure,
    );
    expect(error).toBeInstanceOf(V2UnsupportedServerError);
    expect(fake.killed()).toBe(true);
  }, 15000);
});
