import type { OhMyOpenCodeConfig } from "../config/schema/oh-my-opencode-config";
import type { OmoHostConfig, OmoMcpServerEntry } from "../plugin-types";

function isServerEntry(value: unknown): value is OmoMcpServerEntry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Gates the host MCP map: entries the user already disabled keep their
 * disabled marker, and every server on the disabled_mcps list is removed
 * with exact-name matching. Server bodies from the host file pass through
 * untouched; discovery of additional tiers belongs to the components index.
 */
export function applyMcpConfig(params: {
  hostConfig: OmoHostConfig;
  pluginConfig: OhMyOpenCodeConfig;
}): void {
  const merged: Record<string, OmoMcpServerEntry> = {};
  for (const [name, value] of Object.entries(params.hostConfig.mcp ?? {})) {
    if (!isServerEntry(value)) continue;
    merged[name] = { ...value };
  }
  const disabled = new Set(params.pluginConfig.disabled_mcps ?? []);
  for (const name of disabled) {
    delete merged[name];
  }
  params.hostConfig.mcp = merged;
}
