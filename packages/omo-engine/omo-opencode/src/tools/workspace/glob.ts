/**
 * glob.ts — the native `glob` tool: bounded filename search inside the workspace.
 *
 * The pattern supports `*`, `?`, and `**` segments and is matched against paths
 * relative to the search scope, never against the shell. Symlinked entries are
 * skipped rather than followed, and the result states its bound so a capped
 * answer reads as capped, never as complete.
 */

import { type Dirent, lstatSync, readdirSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { z } from "zod"

import type { OmoJsonObject, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
import { resolveInsideWorkspace, workspaceRootFor } from "./containment.ts"
import { workspaceInputRefused, workspaceIoFailed, workspaceNotFound } from "./errors.ts"

export const GLOB_TOOL_NAME = "glob"

const DEFAULT_MAX_RESULTS = 100
const HARD_MAX_RESULTS = 500
const MAX_FILES_SCANNED = 5000

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", "coverage", "vendor", ".next", "out"])

const GLOB_DESCRIPTION =
  "Find files by name pattern inside the project workspace. Supports * , ? and ** segments; returns paths relative to the search scope."

const GlobArgs = z.object({
  pattern: z.string().trim().min(1),
  path: z.string().trim().min(1).optional(),
  maxResults: z.number().int().min(1).max(HARD_MAX_RESULTS).optional(),
})

const segmentToRegExp = (segment: string): RegExp => {
  const source = segment.split("*").map((part) => part.split("?").map(escapeRegExp).join("[^/\\\\]")).join("[^/\\\\]*")
  return new RegExp(`^${source}$`)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const compileGlob = (pattern: string): ((relativePath: string) => boolean) => {
  const normalized = pattern.split(sep).join("/").replace(/^\/+/, "")
  if (normalized.length === 0 || normalized.includes("\0")) {
    workspaceInputRefused(pattern, "the pattern must name something to match")
  }
  const segments = normalized.split("/")
  const parts = segments.map((segment) => (segment === "**" ? null : segmentToRegExp(segment)))
  return (candidate: string): boolean => {
    const pieces = candidate.split("/")
    const match = (patternIndex: number, pieceIndex: number): boolean => {
      if (patternIndex === parts.length) return pieceIndex === pieces.length
      if (parts[patternIndex] === null) {
        for (let skip = pieceIndex; skip <= pieces.length; skip += 1) {
          if (match(patternIndex + 1, skip)) return true
        }
        return false
      }
      if (pieceIndex >= pieces.length) return false
      const test = parts[patternIndex]
      if (test === null || !test.test(pieces[pieceIndex])) return false
      return match(patternIndex + 1, pieceIndex + 1)
    }
    return match(0, 0)
  }
}

type Collected = {
  readonly root: string
  paths: string[]
  files: number
  skippedLinks: number
  fileCapReached: boolean
}

const walk = (absolute: string, state: Collected, matches: (relativePath: string) => boolean, limit: number): void => {
  let entries: Dirent[]
  try {
    entries = readdirSync(absolute, { withFileTypes: true })
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : ""
    workspaceIoFailed(relative(state.root, absolute) || ".", code.length > 0 ? code : "read failed")
  }
  const names = entries.map((entry) => entry.name).sort()
  for (const name of names) {
    if (state.paths.length >= limit || state.files >= MAX_FILES_SCANNED) return
    if (SKIPPED_DIRECTORIES.has(name)) continue
    const child = join(absolute, name)
    let link: ReturnType<typeof lstatSync>
    try {
      link = lstatSync(child)
    } catch {
      continue
    }
    if (link.isSymbolicLink()) {
      state.skippedLinks += 1
      continue
    }
    if (link.isDirectory()) {
      walk(child, state, matches, limit)
      continue
    }
    if (!link.isFile()) continue
    state.files += 1
    const display = relative(state.root, child).split(sep).join("/")
    if (matches(display)) state.paths.push(display)
  }
}

export function createWorkspaceGlobTool(options: { readonly directory: string }): OmoToolDefinition {
  return {
    description: GLOB_DESCRIPTION,
    args: {
      properties: {
        pattern: { type: "string", description: "File name pattern with * , ? and ** segments, relative to the search scope." },
        path: { type: "string", description: "Directory to search, relative to the project workspace; defaults to the root." },
        maxResults: { type: "number", description: `Maximum paths to return, 1-${HARD_MAX_RESULTS}.` },
      },
    },
    execute: async (toolArgs: OmoJsonObject, context?: OmoToolContext) => {
      const parsed = GlobArgs.safeParse(toolArgs)
      if (!parsed.success) {
        workspaceInputRefused("", parsed.error.issues[0]?.message ?? "invalid arguments")
      }
      const limit = parsed.data.maxResults ?? DEFAULT_MAX_RESULTS
      const matches = compileGlob(parsed.data.pattern)
      const root = workspaceRootFor(options.directory, context)
      const target = resolveInsideWorkspace(root, parsed.data.path ?? ".")
      const canonicalRoot = resolveInsideWorkspace(root, ".")
      const state: Collected = { root: canonicalRoot, paths: [], files: 0, skippedLinks: 0, fileCapReached: false }
      let targetStat: { isDirectory: () => boolean }
      try {
        targetStat = lstatSync(target)
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : ""
        if (code === "ENOENT" || code === "ENOTDIR") workspaceNotFound(parsed.data.path ?? ".")
        workspaceIoFailed(parsed.data.path ?? ".", code.length > 0 ? code : "stat failed")
      }
      if (!targetStat.isDirectory()) {
        workspaceInputRefused(parsed.data.path ?? ".", "the search scope must be a directory")
      }
      walk(target, state, matches, limit)
      if (state.files >= MAX_FILES_SCANNED) state.fileCapReached = true
      const header = `${state.paths.length} path(s)` +
        (state.skippedLinks > 0 ? `, ${state.skippedLinks} link(s) skipped` : "") +
        (state.fileCapReached ? `, stopped at the ${MAX_FILES_SCANNED}-file scan cap` : "")
      return `${header}\n${state.paths.join("\n")}`
    },
  }
}
