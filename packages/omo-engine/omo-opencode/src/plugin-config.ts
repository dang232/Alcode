import type { OhMyOpenCodeConfig } from "./config"
import { validatePluginConfig } from "./config/validate"

export function loadPluginConfig(directory: string, _context: unknown): OhMyOpenCodeConfig {
  return validatePluginConfig(directory).config
}
