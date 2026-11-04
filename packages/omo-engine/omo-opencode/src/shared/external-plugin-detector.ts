/**
 * Detects external plugins that may conflict with oh-my-opencode features.
 * Used to prevent crashes from concurrent notification plugins.
 */

import { loadOpencodePlugins } from "./load-opencode-plugins"
import { log } from "./logger"
import { PLUGIN_NAME } from "./plugin-identity"

const OMO_PACKAGE_PLUGINS = [
  "oh-my-opencode",
  "oh-my-openagent",
  "@code-yeongyu/oh-my-opencode",
  "@code-yeongyu/oh-my-openagent",
]

function matchesKnownPlugin(entry: string, knownPlugins: readonly string[]): string | null {
  const normalized = entry.toLowerCase()
  for (const known of knownPlugins) {
    if (normalized === known) return known
    if (normalized.startsWith(`${known}@`)) return known
    if (normalized === `npm:${known}` || normalized.startsWith(`npm:${known}@`)) return known
    if (normalized.startsWith("file://") && (
      normalized.endsWith(`/${known}`) ||
      normalized.endsWith(`\\${known}`)
    )) return known
  }

  return null
}

function isOmoFilePlugin(entry: string): boolean {
  const normalized = entry.toLowerCase().replaceAll("\\", "/")
  if (!normalized.startsWith("file://")) return false

  return /\/(omo(?:-[^/]*)?|oh-my-opencode|oh-my-openagent)\/(src|dist)\/index\.(ts|js)$/.test(normalized)
}

function matchesOmoPlugin(entry: string): string | null {
  const packageMatch = matchesKnownPlugin(entry, OMO_PACKAGE_PLUGINS)
  if (packageMatch) return packageMatch
  if (isOmoFilePlugin(entry)) return "oh-my-openagent"
  return null
}

export interface DuplicateOmoPluginResult {
  detected: boolean
  pluginName: string | null
  duplicatePlugins: string[]
  allPlugins: string[]
}

export function detectDuplicateOmoPlugin(directory: string): DuplicateOmoPluginResult {
  const plugins = loadOpencodePlugins(directory)
  const duplicatePlugins = plugins.filter((plugin) => matchesOmoPlugin(plugin) !== null)

  if (duplicatePlugins.length > 1) {
    log("[oh-my-openagent] Duplicate OMO plugin entries detected", {
      duplicatePlugins,
      allPlugins: plugins,
    })
    return {
      detected: true,
      pluginName: "oh-my-openagent",
      duplicatePlugins,
      allPlugins: plugins,
    }
  }

  return {
    detected: false,
    pluginName: null,
    duplicatePlugins,
    allPlugins: plugins,
  }
}

export function getDuplicateOmoPluginWarning(duplicatePlugins: readonly string[]): string {
  const formattedPlugins = duplicatePlugins.map((plugin) => `   - ${plugin}`).join("\n")

  return `[${PLUGIN_NAME}] Duplicate OMO plugin entries detected:
${formattedPlugins}

Multiple ${PLUGIN_NAME} instances can inject internal prompts into the same live OpenCode session.
   That can create overlapping assistant turns and corrupt session state.

   ${PLUGIN_NAME} startup has been disabled for this plugin instance.

   Keep exactly one OMO plugin entry in your OpenCode config. Check both:
   1. ~/.config/opencode/opencode.json
   2. Any active OPENCODE_CONFIG_DIR profile, such as ~/.config/opencode/profiles/<name>/opencode.json`
}
