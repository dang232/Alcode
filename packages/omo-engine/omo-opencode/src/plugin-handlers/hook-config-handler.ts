import type { OhMyOpenCodeConfig } from "../config/schema/oh-my-opencode-config";
import type { OmoHookName } from "../plugin-types";

/**
 * Normalizes the hook gate for the pipeline: hook wiring itself is owned by
 * the hooks lane, so this stage resolves which hook names are disabled and
 * hands that gate back. Matching is exact after trimming; unknown or blank
 * entries are dropped so a typo cannot disable the whole tier.
 */
export function applyHookConfig(params: {
  pluginConfig: OhMyOpenCodeConfig;
}): readonly OmoHookName[] {
  if (params.pluginConfig.claude_code?.hooks === false) {
    return [];
  }
  const disabled = new Set(
    (params.pluginConfig.disabled_hooks ?? [])
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );
  return [...disabled] as OmoHookName[];
}
