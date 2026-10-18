import type { OhMyOpenCodeConfig } from "../config/schema/oh-my-opencode-config";
import type { OmoAgentConfigMap, OmoHostConfig } from "../plugin-types";
import { getAgentConfigKey, getAgentDisplayName } from "../shared/agent-display-names";

/**
 * Remaps config-keyed agent entries to their display names, applies the
 * configured agent_order, and records the default agent on the host config.
 * Unknown order names are ignored; agents outside the order keep
 * alphabetical placement after the ordered ones.
 */
export function finalizeAgentConfig(params: {
  hostConfig: OmoHostConfig;
  pluginConfig: OhMyOpenCodeConfig;
  agents: OmoAgentConfigMap;
}): OmoAgentConfigMap {
  const overrides = params.pluginConfig.agents as
    | Record<string, { displayName?: string } | undefined>
    | undefined;
  const remapped: OmoAgentConfigMap = {};
  for (const [key, entry] of Object.entries(params.agents)) {
    remapped[getAgentDisplayName(key, overrides)] = entry;
  }
  const ordered = applyAgentOrder(remapped, params.pluginConfig.agent_order, overrides);
  const configuredDefault =
    typeof params.hostConfig.default_agent === "string" &&
    params.hostConfig.default_agent.trim()
      ? params.hostConfig.default_agent.trim()
      : undefined;
  if (configuredDefault) {
    params.hostConfig.default_agent = getAgentDisplayName(
      getAgentConfigKey(configuredDefault),
      overrides,
    );
  } else {
    const sisyphusDisplay = getAgentDisplayName("sisyphus", overrides);
    params.hostConfig.default_agent = ordered[sisyphusDisplay]
      ? sisyphusDisplay
      : Object.keys(ordered)[0];
  }
  params.hostConfig.agent = ordered;
  return ordered;
}

function applyAgentOrder(
  agents: OmoAgentConfigMap,
  agentOrder: readonly string[] | undefined,
  overrides: Record<string, { displayName?: string } | undefined> | undefined,
): OmoAgentConfigMap {
  if (!agentOrder || agentOrder.length === 0) return agents;
  const ordered: OmoAgentConfigMap = {};
  const seen = new Set<string>();
  for (const name of agentOrder) {
    const displayName = getAgentDisplayName(getAgentConfigKey(String(name)), overrides);
    if (Object.hasOwn(agents, displayName) && !seen.has(displayName)) {
      ordered[displayName] = agents[displayName];
      seen.add(displayName);
    }
  }
  for (const key of Object.keys(agents).sort((left, right) => left.localeCompare(right))) {
    if (!seen.has(key)) ordered[key] = agents[key];
  }
  return ordered;
}
