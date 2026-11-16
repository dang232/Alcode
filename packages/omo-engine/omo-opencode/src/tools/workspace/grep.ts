/**
 * grep.ts — the native `grep` tool: bounded, contained content search.
 *
 * The pattern is a JavaScript regular expression matched per line, or a literal
 * string when `literal` is set — never shell, so there is no command surface to
 * escape. The scope is resolved through the shared containment rule; symlinked
 * entries are skipped rather than followed. Every bound is reported in the
 * header, so a truncated answer reads as truncated, never as complete.
 */

import { type Dirent, lstatSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { z } from "zod"

import type { OmoJsonObject, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
import { resolveInsideWorkspace, workspaceRootFor } from "./containment.ts"
import {
  workspaceBinary,
  workspaceInputRefused,
  workspaceIoFailed,
  workspaceNotFound,
  workspaceTooLarge,
} from "./errors.ts"

export const GREP_TOOL_NAME = "grep"

const DEFAULT_MAX_RESULTS = 100
const HARD_MAX_RESULTS = 500
const MAX_FILE_BYTES = 512 * 1024
const MAX_FILES_SCANNED = 5000
const MAX_LINE_CHARS = 1000
const BINARY_PROBE_BYTES = 8192
const OUTPUT_LIMIT_BYTES = 64 * 1024

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", "coverage", "vendor", ".next", "out"])

const GREP_DESCRIPTION =
  "Search file contents for a text pattern inside the project workspace. Returns path:line matches with a header stating the bounds."

const GrepArgs = z.object({
  pattern: z.string().trim().min(1),
  path: z.string().trim().min(1).optional(),
  literal: z.boolean().optional(),
  maxResults: z.number().int().min(1).max(HARD_MAX_RESULTS).optional(),
})

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const toPattern = (pattern: string, literal: boolean): RegExp => {
  try {
    return new RegExp(literal ? escapeRegExp(pattern) : pattern, "m")
  } catch {
    workspaceInputRefused(pattern, "the pattern is not a valid regular expression")
  }
}

type Scanned = {
  readonly root: string
  matches: string[]
  files: number
  skippedFiles: number
  skippedLinks: number
  fileCapReached: boolean
}

const isBinary = (buffer: Buffer): boolean => buffer.subarray(0, Math.min(buffer.length, BINARY_PROBE_BYTES)).includes(0)

const scanFile = (absolute: string, display: string, pattern: RegExp, limit: number, state: Scanned): void => {
  let stat: { size: number }
  try {
    stat = statSync(absolute)
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : ""
    workspaceIoFailed(display, code.length > 0 ? code : "stat failed")
  }
  if (stat.size > MAX_FILE_BYTES) {
    state.skippedFiles += 1
    return
  }
  let buffer: Buffer
  try {
    buffer = readFileSync(absolute)
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : ""
    workspaceIoFailed(display, code.length > 0 ? code : "read failed")
  }
  if (isBinary(buffer)) {
    state.skippedFiles += 1
    return
  }
  state.files += 1
  const lines = buffer.toString("utf8").split("\n")
  for (let index = 0; index < lines.length; index += 1) {
    if (state.matches.length >= limit) return
    pattern.lastIndex = 0
    if (!pattern.test(lines[index])) continue
    const text = lines[index].length > MAX_LINE_CHARS ? `${lines[index].slice(0, MAX_LINE_CHARS)}…` : lines[index]
    state.matches.push(`${display}:${index + 1}: ${text}`)
  }
}

const walk = (absolute: string, state: Scanned, pattern: RegExp, limit: number): void => {
  let entries: Dirent[]
  try {
    entries = readdirSync(absolute, { withFileTypes: true })
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : ""
    workspaceIoFailed(relative(state.root, absolute) || ".", code.length > 0 ? code : "read failed")
  }
  const names = entries.map((entry) => entry.name).sort()
  for (const name of names) {
    if (state.matches.length >= limit || state.files >= MAX_FILES_SCANNED) return
    if (SKIPPED_DIRECTORIES.has(name)) continue
    const child = join(absolute, name)
    let link: Dirent | Stats
    try {
      link = lstatSync(child)
    } catch {
      continue
    }
    if (link.isSymbolicLink() || (!link.isDirectory() && !link.isFile())) {
      if (link.isSymbolicLink()) state.skippedLinks += 1
      continue
    }
    if (link.isDirectory()) {
      walk(child, state, pattern, limit)
      continue
    }
    if (link.isFile()) {
      scanFile(child, relative(state.root, child), pattern, limit, state)
    }
  }
}

export function createWorkspaceGrepTool(options: { readonly directory: string }): OmoToolDefinition {
  return {
    description: GREP_DESCRIPTION,
    args: {
      properties: {
        pattern: { type: "string", description: "Regular expression matched per line (or a literal string when literal is true)." },
        path: { type: "string", description: "File or directory to search, relative to the project workspace; defaults to the root." },
        literal: { type: "boolean", description: "Match the pattern literally instead of as a regular expression." },
        maxResults: { type: "number", description: `Maximum matches to return, 1-${HARD_MAX_RESULTS}.` },
      },
    },
    execute: async (toolArgs: OmoJsonObject, context?: OmoToolContext) => {
      const parsed = GrepArgs.safeParse(toolArgs)
      if (!parsed.success) {
        workspaceInputRefused("", parsed.error.issues[0]?.message ?? "invalid arguments")
      }
      const limit = parsed.data.maxResults ?? DEFAULT_MAX_RESULTS
      const pattern = toPattern(parsed.data.pattern, parsed.data.literal ?? false)
      const scope = parsed.data.path ?? "."
      const root = workspaceRootFor(options.directory, context)
      const target = resolveInsideWorkspace(root, scope)

      let targetStat: { isDirectory: () => boolean; isFile: () => boolean }
      try {
        targetStat = statSync(target)
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : ""
        if (code === "ENOENT" || code === "ENOTDIR") workspaceNotFound(scope)
        workspaceIoFailed(scope, code.length > 0 ? code : "stat failed")
      }
      const canonicalRoot = resolveInsideWorkspace(root, ".")
      const state: Scanned = { root: canonicalRoot, matches: [], files: 0, skippedFiles: 0, skippedLinks: 0, fileCapReached: false }
      if (targetStat.isDirectory()) {
        walk(target, state, pattern, limit)
      } else if (targetStat.isFile()) {
        scanFile(target, scope, pattern, limit, state)
      } else {
        workspaceBinary(scope)
      }
      if (state.files >= MAX_FILES_SCANNED && state.matches.length >= limit) state.fileCapReached = true
      const header = `${state.matches.length} match(es) in ${state.files} file(s)` +
        (state.skippedFiles > 0 ? `, ${state.skippedFiles} file(s) skipped` : "") +
        (state.skippedLinks > 0 ? `, ${state.skippedLinks} link(s) skipped` : "") +
        (state.fileCapReached ? `, stopped at the ${MAX_FILES_SCANNED}-file scan cap` : "")
      const joined = state.matches.join("\n")
      const capped = Buffer.from(joined, "utf8").subarray(0, OUTPUT_LIMIT_BYTES).toString("utf8")
      return `${header}\n${capped}`
    },
  }
}
