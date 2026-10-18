/**
 * core-hooks.ts — first hook tier: session, model, and monitor fundamentals.
 *
 * Each hook is created independently: it is skipped when its flag is off and
 * guarded at creation time so one throwing factory never breaks startup.
 * Hooks that own mutable per-session state contribute a small cleanup
 * callback that the top-level assembly folds into `disposeHooks`.
 */

import { HookNameSchema } from "../../config/schema/hooks";
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
export interface CoreHookGroup {
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
    log(`[core-hooks] Skipping unknown hook name: ${name}`);
    return;
  }
  registry[name] = handler;
}

/**
 * Ask the live fallback controller what should replace a failed model and
 * surface the decision as a note. No-ops when the envelope carries no model
 * or when no controller is currently installed.
 */
function createModelFallbackHook(managers: OmoHookManagers): OmoHookHandler {
  return (input, output) => {
    const failedModelID = input.modelID;
    if (!failedModelID) {
      return;
    }
    const controller = managers.modelFallbackControllerAccessor.current();
    if (!controller) {
      return;
    }
    const decision = controller.decideFallback(failedModelID);
    if (decision.fallbackModelID) {
      output.note?.(
        `Model fallback: ${failedModelID} -> ${decision.fallbackModelID} (${decision.reason})`,
      );
    }
  };
}

/**
 * Announce each session once. The seen-set keeps repeat invocations quiet;
 * clearing it on dispose releases the only state this hook owns.
 */
function createSessionNotificationHook(): {
  handler: OmoHookHandler;
  dispose: () => void;
} {
  const seenSessions = new Set<string>();
  return {
    handler: (input, output) => {
      const sessionID = input.sessionID;
      if (!sessionID || seenSessions.has(sessionID)) {
        return;
      }
      seenSessions.add(sessionID);
      output.note?.(`Session started: ${sessionID}`);
    },
    dispose: () => {
      seenSessions.clear();
    },
  };
}

/**
 * Report monitor availability. Returns null — and therefore stays absent from
 * the registry — unless a monitor manager is installed and enabled, so the
 * flag alone cannot publish a hook with nothing behind it.
 */
function createMonitorStatusHook(managers: OmoHookManagers): OmoHookHandler | null {
  const monitor = managers.monitorManager;
  if (!monitor || !monitor.enabled) {
    return null;
  }
  return (_input, output) => {
    output.note?.("Monitor is enabled for this session.");
  };
}

export function createCoreHooks(
  _ctx: OmoPluginContext,
  flags: OmoHookFlags,
  managers: OmoHookManagers,
): CoreHookGroup {
  const hooks: { [hookName: string]: OmoHookHandler | undefined } = {};
  const disposables: Array<() => void> = [];
  const guard = <T>(name: string, factory: () => T): T | null =>
    safeCreateHook(name, factory, { enabled: flags.safeHookEnabled });

  if (flags.isHookEnabled("model-fallback")) {
    registerHook(
      hooks,
      "model-fallback",
      guard("model-fallback", () => createModelFallbackHook(managers)),
    );
  }

  if (flags.isHookEnabled("session-notification")) {
    const built = guard("session-notification", () => createSessionNotificationHook());
    if (built !== null) {
      registerHook(hooks, "session-notification", built.handler);
      disposables.push(built.dispose);
    }
  }

  if (flags.isHookEnabled("monitor-status-injector")) {
    registerHook(
      hooks,
      "monitor-status-injector",
      guard("monitor-status-injector", () => createMonitorStatusHook(managers)),
    );
  }

  return { hooks, disposables };
}
