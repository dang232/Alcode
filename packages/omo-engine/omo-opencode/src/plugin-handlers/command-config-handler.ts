import type { OhMyOpenCodeConfig } from "../config/schema/oh-my-opencode-config";
import type {
  OmoCommandDefinition,
  OmoHostConfig,
  OmoLoadedSkill,
  OmoPluginComponents,
} from "../plugin-types";
import { getAgentConfigKey, getAgentDisplayName } from "../shared/agent-display-names";

function skillToCommand(skill: OmoLoadedSkill): OmoCommandDefinition {
  return {
    name: skill.name,
    ...(skill.definition.description ? { description: skill.definition.description } : {}),
    template: skill.definition.template,
    ...(skill.definition.agent ? { agent: skill.definition.agent } : {}),
    ...(skill.definition.model ? { model: skill.definition.model } : {}),
  };
}

/**
 * Merges skill-backed and plugin-component commands into the host command
 * map, then enforces the disabled_commands list with exact-name matching
 * and remaps every command agent field through display names. Pre-existing
 * host commands survive unless explicitly disabled; component entries fill
 * gaps without overwriting them.
 */
export function applyCommandConfig(params: {
  hostConfig: OmoHostConfig;
  pluginConfig: OhMyOpenCodeConfig;
  pluginComponents: OmoPluginComponents;
  skills: readonly OmoLoadedSkill[];
}): void {
  const merged: Record<string, OmoCommandDefinition> = {};
  for (const skill of params.skills) {
    merged[skill.name] = skillToCommand(skill);
  }
  for (const name of params.pluginComponents.commandNames) {
    if (!Object.hasOwn(merged, name)) {
      merged[name] = { name, template: "" };
    }
  }
  const existing = params.hostConfig.command ?? {};
  const next: Record<string, OmoCommandDefinition> = { ...merged };
  for (const [name, command] of Object.entries(existing)) {
    next[name] = command;
  }
  for (const disabled of params.pluginConfig.disabled_commands ?? []) {
    delete next[disabled];
  }
  remapCommandAgentFields(next, params.pluginConfig);
  params.hostConfig.command = next;
}

function remapCommandAgentFields(
  commands: Record<string, OmoCommandDefinition>,
  pluginConfig: OhMyOpenCodeConfig,
): void {
  const overrides = pluginConfig.agents as
    | Record<string, { displayName?: string } | undefined>
    | undefined;
  for (const command of Object.values(commands)) {
    if (command.agent && typeof command.agent === "string") {
      const displayName = getAgentDisplayName(getAgentConfigKey(command.agent), overrides);
      if (displayName !== command.agent) {
        Object.assign(command, { agent: displayName });
      }
    }
  }
}
