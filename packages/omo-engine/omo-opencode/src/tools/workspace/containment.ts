/**
 * containment.ts — resolve a model-supplied path inside the authorized workspace.
 *
 * Every workspace tool funnels its path argument through `resolveInsideWorkspace`
 * so one implementation decides what "inside the project" means. The check is
 * both lexical (traversal, absolute escapes, drive changes) and physical
 * (symlink/junction resolution against the real root), because a lexical check
 * alone lets a link inside the project point anywhere.
 */

import { existsSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"

import { workspacePathRefused } from "./errors.ts"

const isInside = (root: string, target: string): boolean => {
  const rel = relative(root, target)
  if (rel.length === 0) return true
  if (isAbsolute(rel)) return false
  return rel !== ".." && !rel.startsWith(`..${sep}`)
}

const realOrNull = (path: string): string | null => {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/**
 * Returns the absolute path of `candidate` when it lies inside `root`, and throws
 * a `WorkspaceToolError` otherwise. The lexical check runs first so a traversal
 * is refused without touching the disk; the physical check then resolves links
 * in both the root and the target so a junction cannot smuggle a path outside.
 */
export function resolveInsideWorkspace(root: string, candidate: string): string {
  const trimmed = candidate.trim()
  if (trimmed.length === 0) workspacePathRefused(candidate, "a path is required")
  if (trimmed.includes("\0")) workspacePathRefused(candidate, "a path may not contain NUL")

  const rootLexical = resolve(root)
  const targetLexical = isAbsolute(trimmed) ? resolve(trimmed) : resolve(rootLexical, trimmed)
  if (!isInside(rootLexical, targetLexical)) {
    workspacePathRefused(candidate, "the path leaves the workspace")
  }

  const rootReal = realOrNull(rootLexical) ?? rootLexical
  const targetReal = realOrNull(targetLexical)
  if (targetReal !== null && !isInside(rootReal, targetReal)) {
    workspacePathRefused(candidate, "the path resolves outside the workspace through a link")
  }
  return targetLexical
}

const deepestExisting = (path: string): string => {
  let probe = path
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) return probe
    probe = parent
  }
  return probe
}

/**
 * Resolves a path a writer intends to create or replace. The target itself may not
 * exist yet, so containment is proven against the deepest existing ancestor: a new
 * file cannot be smuggled outside through a junction in its parent chain.
 */
export function resolveForWrite(root: string, candidate: string): string {
  const target = resolveInsideWorkspace(root, candidate)
  const rootReal = realOrNull(resolve(root)) ?? resolve(root)
  const ancestor = deepestExisting(dirname(target))
  const ancestorReal = realOrNull(ancestor) ?? ancestor
  if (!isInside(rootReal, ancestorReal)) {
    workspacePathRefused(candidate, "the path would be created outside the workspace through a link")
  }
  return target
}
