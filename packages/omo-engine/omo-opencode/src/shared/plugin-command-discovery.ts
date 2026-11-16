import {
  discoverInstalledPlugins,
  loadPluginCommands,
  loadPluginSkillsAsCommands,
} from "../../../claude-code-compat-core/src/features/claude-code-plugin-loader/index.ts"
import type { CommandDefinition } from "../../../claude-code-compat-core/src/features/claude-code-command-loader/types.ts"

export interface PluginCommandDiscoveryOptions {
  pluginsEnabled?: boolean
  enabledPluginsOverride?: Record<string, boolean>
}

export function discoverPluginCommandDefinitions(
  options?: PluginCommandDiscoveryOptions,
): Record<string, CommandDefinition> {
  if (options?.pluginsEnabled === false) {
    return {}
  }

  const { plugins } = discoverInstalledPlugins({
    enabledPluginsOverride: options?.enabledPluginsOverride,
  })

  return {
    ...loadPluginCommands(plugins),
    ...loadPluginSkillsAsCommands(plugins),
  }
}
