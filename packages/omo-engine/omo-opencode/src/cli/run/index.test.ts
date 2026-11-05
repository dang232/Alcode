import { describe, expect, test } from "bun:test";

import {
  createEventState,
  createJsonOutputManager,
  createServerConnection,
  executeOnCompleteHook,
  processEvents,
  resolveRunAgent,
  resolveRunModel,
  resolveSession,
  run,
  serializeError,
} from "./index";
import type {
  EventState,
  RunContext,
  RunOptions,
  RunResult,
  ServerConnection,
} from "./index";

// Guards the CLI runner barrel consumed at runtime by path (dag-pane
// service OMO_ENGINE_RUN_BARREL, omo-invoker-worker, vendor closure seeds),
// which static analysis cannot see: every export must stay wired.
describe("cli/run barrel", () => {
  test("exposes every runner entry point as a function", () => {
    const fns = [
      run,
      resolveRunAgent,
      resolveRunModel,
      createServerConnection,
      resolveSession,
      createJsonOutputManager,
      executeOnCompleteHook,
      createEventState,
      processEvents,
      serializeError,
    ];
    expect(fns.every((fn) => fn instanceof Function)).toBe(true);
  });

  test("exposes every runner type", () => {
    const states: EventState[] = [];
    const contexts: RunContext[] = [];
    const options: RunOptions[] = [];
    const results: RunResult[] = [];
    const connections: ServerConnection[] = [];
    expect([states, contexts, options, results, connections]).toHaveLength(5);
  });
});
