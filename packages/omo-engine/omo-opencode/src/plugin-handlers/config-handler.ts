import { loadPluginConfig } from "../plugin-config";
import type { OmoConfigHandler, OmoHostConfig } from "../plugin-types";
import {
  applyAgentConfig,
  discoverSkillsForPromptInjection,
} from "./agent-config-handler";
import { applyCommandConfig } from "./command-config-handler";
import { applyHookConfig } from "./hook-config-handler";
import { applyMcpConfig } from "./mcp-config-handler";
import { applyProviderConfig } from "./provider-config-handler";
import { applyToolConfig, type ForceDisableToolPredicate } from "./tool-config-handler";
import { loadPluginComponents } from "./plugin-components-loader";

export interface ConfigHandlerOptions {
  readonly directory: string;
  readonly isForceDisabledTool?: ForceDisableToolPredicate;
}

/**
 * Native config pipeline: turns .omo/ config into the host agent, command,
 * hook-gate, MCP, provider-model, and tool-permission sections in fixed
 * stage order (agent -> command -> hook -> mcp -> provider -> tool).
 *
 * Each stage is skippable through its own disabled_* list with the same
 * matching semantics used throughout the pipeline: agent and skill names
 * match case-insensitively, while MCP servers, commands, tools, and
 * provider prefixes match exactly. Stages without entries to gate always
 * run. loadPluginConfig is the only config source; nothing here reads the
 * host files directly.
 */
export function createConfigHandler(options: ConfigHandlerOptions): OmoConfigHandler {
  const pluginConfig = loadPluginConfig(options.directory, { directory: options.directory });
  return async (hostConfig: OmoHostConfig) => {
    const pluginComponents = await loadPluginComponents({
      directory: options.directory,
      pluginConfig,
    });
    await applyAgentConfig({
      hostConfig,
      pluginConfig,
      projectDirectory: options.directory,
      pluginComponents,
    });
    const skills = await discoverSkillsForPromptInjection({
      directory: options.directory,
      pluginConfig,
      pluginComponents,
    });
    applyCommandConfig({ hostConfig, pluginConfig, pluginComponents, skills });
    applyHookConfig({ pluginConfig });
    applyMcpConfig({ hostConfig, pluginConfig });
    applyProviderConfig({ hostConfig, pluginConfig });
    applyToolConfig({
      hostConfig,
      pluginConfig,
      isForceDisabledTool: options.isForceDisabledTool,
    });
  };
}
