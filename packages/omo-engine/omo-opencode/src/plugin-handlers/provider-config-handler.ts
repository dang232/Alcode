import type { OhMyOpenCodeConfig } from "../config/schema/oh-my-opencode-config";
import type { OmoHostConfig } from "../plugin-types";

function providerOf(model: string): string | undefined {
  const separator = model.indexOf("/");
  if (separator <= 0) return undefined;
  return model.slice(0, separator).toLowerCase();
}

/**
 * Enforces the disabled_providers list against resolved agent models. An
 * agent whose model names a disabled provider loses its explicit model and
 * falls back to the host default; models without a provider prefix and
 * entries without models are left alone.
 */
export function applyProviderConfig(params: {
  hostConfig: OmoHostConfig;
  pluginConfig: OhMyOpenCodeConfig;
}): void {
  const disabled = new Set(
    (params.pluginConfig.disabled_providers ?? []).map((prefix) => prefix.toLowerCase()),
  );
  if (disabled.size === 0) return;
  for (const [name, entry] of Object.entries(params.hostConfig.agent)) {
    if (!entry.model) continue;
    const provider = providerOf(entry.model.trim());
    if (provider && disabled.has(provider)) {
      params.hostConfig.agent[name] = { ...entry, model: undefined };
    }
  }
}
