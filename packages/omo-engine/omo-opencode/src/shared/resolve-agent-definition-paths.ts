import { homedir } from "node:os"
import { existsSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { isWithinProject } from "./contains-path"
import { log } from "./logger"

// Build-time constant injected by the plugin bundler (see
// server/lib/omo-native/build-entry.js): relative path from the emitted
// bundle to the materialized agents/ directory. Absent in source runs.
declare const OMO_BUNDLED_AGENTS_DIR: string | undefined

/**
 * Directory holding the product-bundled agent definitions (`agents/*.md`).
 * Single source of truth for the location. In source runs it is two levels
 * above `shared/`; in the bundled plugin the build injects
 * OMO_BUNDLED_AGENTS_DIR and it resolves beside the emitted bundle.
 * The packaged desktop app stages the engine outside the source tree
 * (extraResources `omo-engine`), so probe that location before falling
 * back: without it the bundled tier resolves to an empty directory and
 * the product agents silently vanish on machines without a checkout.
 */
export function resolveBundledAgentsDir(): string {
  if (typeof OMO_BUNDLED_AGENTS_DIR === "string" && OMO_BUNDLED_AGENTS_DIR.length > 0) {
    return join(dirname(fileURLToPath(import.meta.url)), OMO_BUNDLED_AGENTS_DIR)
  }
  // Electron-only field; absent under plain Node (see env-runtime.js, which
  // resolves the staged OpenCode CLI the same way).
  // SAFETY: process.resourcesPath exists only under Electron; the read is
  // unknown-typed and the string check below keeps plain Node on fallback.
  const resourcesPath: unknown = (process as { resourcesPath?: unknown }).resourcesPath
  if (typeof resourcesPath === "string" && resourcesPath.length > 0) {
    const staged = join(resourcesPath, "omo-engine", "omo-opencode", "agents")
    if (existsSync(staged)) return staged
  }
  return join(import.meta.dir, "..", "..", "agents")
}

export function resolveAgentDefinitionPaths(
  paths: string[],
  baseDir: string,
  containmentDir: string | null
): string[] {
  return paths.flatMap((p) => {
    const expanded = p.startsWith("~/") ? join(homedir(), p.slice(2)) : p
    const resolved = isAbsolute(expanded) ? expanded : resolve(baseDir, expanded)

    if (containmentDir !== null && !isWithinProject(resolved, containmentDir)) {
      log(`agent_definitions path rejected (outside project boundary): ${p} -> ${resolved}`)
      return []
    }

    return [resolved]
  })
}
