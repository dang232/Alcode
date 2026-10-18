/**
 * create-managers.ts — native managers assembly for the OpenCode plugin entry.
 *
 * Builds the five manager handles the downstream lanes consume. Each manager
 * is a small in-memory native object; nothing here spawns processes, opens
 * sockets, or touches the host SDK. Upstream once wrapped tmux sessions,
 * team-mode runs, TUI mirrors, and process-wide cleanup around these same
 * slots — this lane keeps only the contract surface: birth/death tracking,
 * skill-tool serving, a live fallback-controller holder, an optional
 * monitor, and the staged config pipeline.
 */

import type {
  OmoCreateManagers,
  OmoManagers,
  OmoModelFallbackController,
} from "./plugin-types";
import { createConfigHandler } from "./plugin-handlers/config-handler";
import { log } from "./shared/logger";

/**
 * Build the shared managers from the entry context. The monitor slot is
 * present only when `ctx.pluginConfig.monitor.enabled` is true; every other
 * slot is always present.
 */
export const createManagers: OmoCreateManagers = (ctx) => {
  const liveSubagents = new Map<string, { parentID: string; title: string }>();

  const backgroundManager: OmoManagers["backgroundManager"] = {
    async noteSubagentBirth(event) {
      liveSubagents.set(event.sessionID, {
        parentID: event.parentID,
        title: event.title,
      });
      log("[create-managers] subagent born", { sessionID: event.sessionID });
    },
    async noteSubagentDeath(event) {
      liveSubagents.delete(event.sessionID);
      log("[create-managers] subagent gone", { sessionID: event.sessionID });
    },
    async shutdown() {
      liveSubagents.clear();
      log("[create-managers] background manager shut down");
    },
  };

  const skillMcpManager: OmoManagers["skillMcpManager"] = {
    async callSkillTool(request) {
      log("[create-managers] skill tool call", {
        serverName: request.serverName,
        toolName: request.toolName,
      });
      return {
        output: `unknown skill tool ${request.serverName}.${request.toolName}`,
        isError: true,
      };
    },
    async disconnectAll() {
      log("[create-managers] skill MCP connections closed");
    },
  };

  let currentFallbackController: OmoModelFallbackController | undefined = {
    decideFallback(failedModelID) {
      return { reason: `no fallback configured for ${failedModelID}` };
    },
  };

  const modelFallbackControllerAccessor: OmoManagers["modelFallbackControllerAccessor"] = {
    current: () => currentFallbackController,
  };

  const managers: OmoManagers = {
    backgroundManager,
    skillMcpManager,
    modelFallbackControllerAccessor,
    configHandler: createConfigHandler({ directory: ctx.directory }),
  };

  if (ctx.pluginConfig.monitor?.enabled === true) {
    managers.monitorManager = {
      enabled: true,
      async shutdown() {
        log("[create-managers] monitor manager shut down");
      },
    };
  }

  return managers;
};
