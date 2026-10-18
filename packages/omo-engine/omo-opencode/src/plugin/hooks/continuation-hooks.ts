/**
 * continuation-hooks.ts — second hook tier: keeping long runs alive across
 * stops, compactions, and loop iterations.
 *
 * Stop and background signals are read from the run-continuation marker store,
 * loop context comes from the ralph-loop state file, todo enforcement records
 * back into the marker store, and the atlas hook tracks the last-seen agent
 * per session at the envelope level. As in every tier, each hook is gated by
 * its own flag and guarded at creation so a single failure cannot break
 * startup; stateful hooks contribute cleanup for `disposeHooks`.
 */

import { HookNameSchema } from "../../config/schema/hooks";
import {
  getActiveContinuationMarkerReason,
  isContinuationMarkerActive,
  readContinuationMarker,
  setContinuationMarkerSource,
} from "../../features/run-continuation-state/storage";
import { HOOK_NAME as ATLAS_HOOK_NAME } from "../../hooks/atlas/hook-name";
import { readState as readRalphLoopState } from "../../hooks/ralph-loop/storage";
import type {
  OmoHookFlags,
  OmoHookHandler,
  OmoHookManagers,
  OmoHookRegistry,
  OmoPluginContext,
} from "../../plugin-types";
import { log } from "../../shared/logger";
import { safeCreateHook } from "../../shared/safe-create-hook";

/** Registry plus cleanup callbacks produced by this tier. */
export interface ContinuationHookGroup {
  readonly hooks: OmoHookRegistry;
  readonly disposables: readonly (() => void)[];
}

/**
 * Publish one handler under a validated hook name. Names that drifted out of
 * the schema are skipped with a log instead of leaking an unknown key to the
 * interface lane.
 */
function registerHook(
  registry: { [hookName: string]: OmoHookHandler | undefined },
  name: string,
  handler: OmoHookHandler | null,
): void {
  if (handler === null) {
    return;
  }
  if (!HookNameSchema.safeParse(name).success) {
    log(`[continuation-hooks] Skipping unknown hook name: ${name}`);
    return;
  }
  registry[name] = handler;
}

/**
 * Surface an active continuation marker once per session so a stopped run is
 * not silently resumed. The announced-set is the only owned state.
 */
function createStopContinuationGuardHook(directory: string): {
  handler: OmoHookHandler;
  dispose: () => void;
} {
  const announced = new Set<string>();
  return {
    handler: (input, output) => {
      const sessionID = input.sessionID;
      if (!sessionID || announced.has(sessionID)) {
        return;
      }
      const marker = readContinuationMarker(directory, sessionID);
      if (!isContinuationMarkerActive(marker)) {
        return;
      }
      announced.add(sessionID);
      const reason =
        getActiveContinuationMarkerReason(marker) ?? "continuation is stopped for this session";
      output.note?.(`Stop continuation guard: ${reason}`);
    },
    dispose: () => {
      announced.clear();
    },
  };
}

/**
 * Resurface the active loop state (if any) as session context. Reads are
 * stateless — a missing or inactive state file simply means no note.
 */
function createCompactionContextInjectorHook(directory: string): OmoHookHandler {
  return (input, output) => {
    const sessionID = input.sessionID;
    if (!sessionID) {
      return;
    }
    const state = readRalphLoopState(directory);
    if (!state || !state.active) {
      return;
    }
    if (state.session_id && state.session_id !== sessionID) {
      return;
    }
    output.note?.(
      `Loop context: iteration ${state.iteration} in progress (${state.completion_promise})`,
    );
  };
}

/**
 * Remember the last non-empty text per session and re-surface it when a later
 * call for the same session arrives empty, so context survives a compaction
 * that drops the visible transcript. Clearing the cache disposes the hook.
 */
function createCompactionTodoPreserverHook(): {
  handler: OmoHookHandler;
  dispose: () => void;
} {
  const lastTextBySession = new Map<string, string>();
  return {
    handler: (input, output) => {
      const sessionID = input.sessionID;
      if (!sessionID) {
        return;
      }
      const text = input.text?.trim();
      if (text) {
        lastTextBySession.set(sessionID, text);
        return;
      }
      const preserved = lastTextBySession.get(sessionID);
      if (preserved) {
        output.note?.(`Preserved context: ${preserved.slice(0, 500)}`);
      }
    },
    dispose: () => {
      lastTextBySession.clear();
    },
  };
}

/**
 * When session text mentions a todo, record a `todo` source as active in the
 * marker store so downstream guards keep the run going. Dispose removes the
 * markers this hook created and drops the tracking set.
 */
function createTodoContinuationEnforcerHook(directory: string): {
  handler: OmoHookHandler;
  dispose: () => void;
} {
  const markedSessions = new Set<string>();
  return {
    handler: (input, output) => {
      const sessionID = input.sessionID;
      const text = input.text;
      if (!sessionID || !text || !/todo/i.test(text)) {
        return;
      }
      setContinuationMarkerSource(
        directory,
        sessionID,
        "todo",
        "active",
        "todo mentioned in session text",
      );
      markedSessions.add(sessionID);
      output.note?.("Todo continuation enforced for this session.");
    },
    dispose: () => {
      for (const sessionID of markedSessions) {
        try {
          setContinuationMarkerSource(directory, sessionID, "todo", "idle", "hook disposed");
        } catch (error) {
          log("[continuation-hooks] Failed to release todo marker on dispose", {
            sessionID,
            error,
          });
        }
      }
      markedSessions.clear();
    },
  };
}

/**
 * Note an active background continuation, if the marker store has one for
 * this session. Stateless read; nothing to dispose.
 */
function createBackgroundNotificationHook(directory: string): OmoHookHandler {
  return (input, output) => {
    const sessionID = input.sessionID;
    if (!sessionID) {
      return;
    }
    const reason = getActiveContinuationMarkerReason(readContinuationMarker(directory, sessionID));
    if (reason) {
      output.note?.(`Background continuation active: ${reason}`);
    }
  };
}

/**
 * Track the last-seen agent per session at the envelope level and report it
 * when a later call carries no agent. Mirrors the session-last-agent behavior
 * without needing host session APIs. Clearing the map disposes the hook.
 */
function createAtlasHook(): { handler: OmoHookHandler; dispose: () => void } {
  const lastAgentBySession = new Map<string, string>();
  return {
    handler: (input, output) => {
      const sessionID = input.sessionID;
      if (!sessionID) {
        return;
      }
      const agent = input.agentName?.toLowerCase();
      if (agent) {
        lastAgentBySession.set(sessionID, agent);
        return;
      }
      const lastAgent = lastAgentBySession.get(sessionID);
      if (lastAgent) {
        log(`[${ATLAS_HOOK_NAME}] Resolved last agent for session`, { sessionID });
        output.note?.(`Last agent for this session: ${lastAgent}`);
      }
    },
    dispose: () => {
      lastAgentBySession.clear();
    },
  };
}

export function createContinuationHooks(
  ctx: OmoPluginContext,
  flags: OmoHookFlags,
  _managers: OmoHookManagers,
): ContinuationHookGroup {
  const directory = ctx.directory;
  const hooks: { [hookName: string]: OmoHookHandler | undefined } = {};
  const disposables: Array<() => void> = [];
  const guard = <T>(name: string, factory: () => T): T | null =>
    safeCreateHook(name, factory, { enabled: flags.safeHookEnabled });

  if (flags.isHookEnabled("stop-continuation-guard")) {
    const built = guard("stop-continuation-guard", () =>
      createStopContinuationGuardHook(directory),
    );
    if (built !== null) {
      registerHook(hooks, "stop-continuation-guard", built.handler);
      disposables.push(built.dispose);
    }
  }

  if (flags.isHookEnabled("compaction-context-injector")) {
    registerHook(
      hooks,
      "compaction-context-injector",
      guard("compaction-context-injector", () => createCompactionContextInjectorHook(directory)),
    );
  }

  if (flags.isHookEnabled("compaction-todo-preserver")) {
    const built = guard("compaction-todo-preserver", () => createCompactionTodoPreserverHook());
    if (built !== null) {
      registerHook(hooks, "compaction-todo-preserver", built.handler);
      disposables.push(built.dispose);
    }
  }

  if (flags.isHookEnabled("todo-continuation-enforcer")) {
    const built = guard("todo-continuation-enforcer", () =>
      createTodoContinuationEnforcerHook(directory),
    );
    if (built !== null) {
      registerHook(hooks, "todo-continuation-enforcer", built.handler);
      disposables.push(built.dispose);
    }
  }

  if (flags.isHookEnabled("background-notification")) {
    registerHook(
      hooks,
      "background-notification",
      guard("background-notification", () => createBackgroundNotificationHook(directory)),
    );
  }

  if (flags.isHookEnabled("atlas")) {
    const built = guard("atlas", () => createAtlasHook());
    if (built !== null) {
      registerHook(hooks, "atlas", built.handler);
      disposables.push(built.dispose);
    }
  }

  return { hooks, disposables };
}
