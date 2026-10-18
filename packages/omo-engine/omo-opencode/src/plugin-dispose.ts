/**
 * plugin-dispose.ts — idempotent teardown for the native plugin entry.
 *
 * Runs the three shutdown steps in a fixed order — background sessions
 * first so no new subagent state appears mid-teardown, then skill MCP
 * connections, then the hook disposables — and isolates each step so one
 * failure cannot block the rest. The first call wins: every later call
 * awaits the same promise instead of shutting down twice.
 */

import type { OmoCreatePluginDispose } from "./plugin-types";
import { log } from "./shared/logger";

export const createPluginDispose: OmoCreatePluginDispose = (parts) => {
  let settled: Promise<void> | null = null;

  return async () => {
    settled ??= (async (): Promise<void> => {
      try {
        await parts.managers.backgroundManager.shutdown();
      } catch (error) {
        log("[plugin-dispose] background shutdown failed", { error });
      }
      try {
        await parts.managers.skillMcpManager.disconnectAll();
      } catch (error) {
        log("[plugin-dispose] skill MCP disconnect failed", { error });
      }
      try {
        parts.hooks.disposeHooks();
      } catch (error) {
        log("[plugin-dispose] hook dispose failed", { error });
      }
    })();

    await settled;
  };
};
