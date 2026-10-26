// Store home for project-knowledge records.
//
// Follows the memory-core convention (identity/layout.ts): a per-user durable root
// under ~/.omo, overridable by one env var. Deliberately NOT under the source
// repository and NOT under a temp directory, so records survive worktree churn and
// never travel into a fixture or a worktree copy.

import { existsSync, mkdirSync, accessSync, constants } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

export const PROJECT_KNOWLEDGE_ROOT_ENV_VAR = "OMO_PROJECT_KNOWLEDGE_HOME"

export function defaultProjectKnowledgeRoot(): string {
  return join(homedir(), ".omo", "project-knowledge")
}

/** An absolute override wins; a relative one is resolved against `cwd`, like memory-core. */
export function resolveProjectKnowledgeRoot(
  env: Record<string, string | undefined>,
  cwd: string,
): string {
  const override = env[PROJECT_KNOWLEDGE_ROOT_ENV_VAR]
  if (override === undefined || override.trim() === "") {
    return defaultProjectKnowledgeRoot()
  }
  const value = override.trim()
  return isAbsolute(value) ? value : resolve(cwd, value)
}

export type StoreHomeResult =
  | { readonly ok: true; readonly root: string; readonly created: boolean }
  | { readonly ok: false; readonly root: string; readonly reason: "unwritable"; readonly message: string }

/**
 * Create the store root when absent and report honestly when it cannot be used.
 * Never substitutes another directory: a failure here means "no knowledge store",
 * not "try somewhere else".
 */
export function ensureProjectKnowledgeStore(root: string): StoreHomeResult {
  const existed = existsSync(root)
  try {
    if (!existed) {
      mkdirSync(root, { recursive: true })
    }
    accessSync(root, constants.W_OK)
    return { ok: true, root, created: !existed }
  } catch (error) {
    return {
      ok: false,
      root,
      reason: "unwritable",
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
