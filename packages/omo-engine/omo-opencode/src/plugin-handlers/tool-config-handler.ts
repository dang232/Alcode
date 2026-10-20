import type { OhMyOpenCodeConfig } from "../config/schema/oh-my-opencode-config";
import type { OmoAgentPermission, OmoAgentToolPolicy, OmoHostConfig } from "../plugin-types";
import { getAgentConfigKey } from "../shared/agent-display-names";
import { getAgentToolRestrictions } from "../shared/agent-tool-restrictions";

export type ForceDisableToolPredicate = (toolName: string) => boolean;

const ALLOW_ALL: ForceDisableToolPredicate = () => false;

function lookupOverride(
  pluginConfig: OhMyOpenCodeConfig,
  displayName: string,
): Record<string, unknown> | undefined {
  const overrides = pluginConfig.agents as Record<string, unknown> | undefined;
  if (!overrides) return undefined;
  const configKey = getAgentConfigKey(displayName);
  return (overrides[displayName] ?? overrides[configKey]) as Record<string, unknown> | undefined;
}

function policyFromOverride(override: Record<string, unknown> | undefined): OmoAgentToolPolicy | undefined {
  const tools = override?.tools;
  if (!tools || typeof tools !== "object") return undefined;
  const policy: OmoAgentToolPolicy = {};
  for (const [tool, granted] of Object.entries(tools as Record<string, unknown>)) {
    if (granted === true) policy[tool] = true;
    else if (granted === false) policy[tool] = false;
  }
  if (Object.keys(policy).length === 0) return undefined;
  return policy;
}

/**
 * Applies per-agent tool permission overrides. Each agent inherits the
 * tools map from its config override, then the global disabled_tools list
 * adds denials around explicit allows. The static-registry force-disable
 * predicate is owned by the tools lane and wins over everything: any tool
 * it flags is denied even when an override allows it. It defaults to
 * allow-all so this lane never invents registry entries on its own.
 */
export function applyToolConfig(params: {
  hostConfig: OmoHostConfig;
  pluginConfig: OhMyOpenCodeConfig;
  isForceDisabledTool?: ForceDisableToolPredicate;
}): void {
  const isForceDisabled = params.isForceDisabledTool ?? ALLOW_ALL;
  const globallyDenied = new Set(params.pluginConfig.disabled_tools ?? []);
  for (const [displayName, entry] of Object.entries(params.hostConfig.agent)) {
    // Seed denies from the curated per-agent restrictions so read-only
    // agents are enforced by the host, not just filtered from the registry.
    const curated = getAgentToolRestrictions(displayName, { includeTeamToolDenylist: false });
    const base = policyFromOverride(lookupOverride(params.pluginConfig, displayName));
    const merged: OmoAgentToolPolicy = {};
    if (entry.tools && typeof entry.tools === "object") Object.assign(merged, entry.tools);
    for (const [tool, granted] of Object.entries(curated)) {
      if (granted === false) merged[tool] = false;
    }
    if (base) Object.assign(merged, base);
    for (const tool of globallyDenied) {
      if (merged[tool] !== true) merged[tool] = false;
    }
    for (const tool of Object.keys(merged)) {
      if (isForceDisabled(tool)) merged[tool] = false;
    }
    const denied = Object.entries(merged)
      .filter(([, granted]) => granted === false)
      .map(([tool]) => tool)
      .sort();
    const flat: OmoAgentToolPolicy = {};
    for (const [tool, granted] of Object.entries(merged)) flat[tool] = granted;
    const permission: OmoAgentPermission = {};
    for (const tool of denied) permission[tool] = "deny";
    if (Object.keys(flat).length === 0 && denied.length === 0) continue;
    params.hostConfig.agent[displayName] = {
      ...entry,
      tools: flat,
      ...(denied.length > 0 ? { permission: { ...(typeof entry.permission === "object" ? entry.permission : {}), ...permission } } : {}),
    };
  }
}
