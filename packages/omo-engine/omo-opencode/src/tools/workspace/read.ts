/**
 * read.ts — the native `read` tool: authorized, bounded text reads from the project.
 *
 * The path is resolved through the shared containment rule, so traversal and link
 * escapes fail closed. Content is bounded and refused when it is not text, and the
 * returned slice names its line range so a model can continue reading deliberately
 * instead of assuming it saw the whole file.
 */

import { readFileSync, statSync } from "node:fs"
import { z } from "zod"

import type { OmoJsonObject, OmoToolDefinition } from "../../plugin-types.ts"
import { resolveInsideWorkspace } from "./containment.ts"
import {
  workspaceBinary,
  workspaceInputRefused,
  workspaceIoFailed,
  workspaceNotFound,
  workspaceNotAFile,
  workspaceTooLarge,
} from "./errors.ts"

export const READ_TOOL_NAME = "read"

const MAX_BYTES = 512 * 1024
const HARD_MAX_BYTES = 8 * 1024 * 1024
const MAX_LINES = 5000
const BINARY_PROBE_BYTES = 8192

const READ_DESCRIPTION =
  "Read a UTF-8 text file from the project workspace. Returns the requested line range and states which lines were returned."

const ReadArgs = z.object({
  path: z.string().trim().min(1),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(MAX_LINES).optional(),
})

const looksBinary = (buffer: Buffer): boolean => {
  const probe = buffer.subarray(0, Math.min(buffer.length, BINARY_PROBE_BYTES))
  return probe.includes(0)
}

export function createWorkspaceReadTool(options: { readonly directory: string }): OmoToolDefinition {
  return {
    description: READ_DESCRIPTION,
    args: {
      properties: {
        path: { type: "string", description: "File to read, relative to the project workspace." },
        offset: { type: "number", description: "Zero-based line to start at; defaults to the first line." },
        limit: { type: "number", description: `Maximum lines to return, 1-${MAX_LINES}.` },
      },
    },
    execute: async (toolArgs: OmoJsonObject) => {
      const parsed = ReadArgs.safeParse(toolArgs)
      if (!parsed.success) {
        const named = z.object({ path: z.string() }).safeParse(toolArgs)
        workspaceInputRefused(named.success ? named.data.path : "", parsed.error.issues[0]?.message ?? "invalid arguments")
      }
      const requested = parsed.data.path
      const target = resolveInsideWorkspace(options.directory, requested)

      let stat: { isDirectory: () => boolean; size: number }
      try {
        stat = statSync(target)
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : ""
        if (code === "ENOENT" || code === "ENOTDIR") workspaceNotFound(requested)
        workspaceIoFailed(requested, code.length > 0 ? code : "stat failed")
      }
      if (stat.isDirectory()) workspaceNotAFile(requested)
      const size = stat.size

      const offset = parsed.data.offset ?? 0
      const limit = parsed.data.limit ?? MAX_LINES
      // The byte bound applies on EVERY path: a range must not become a way to load
      // a file the tool would otherwise refuse.
      if (size > HARD_MAX_BYTES) workspaceTooLarge(requested, size, HARD_MAX_BYTES)
      if (parsed.data.offset === undefined && parsed.data.limit === undefined && size > MAX_BYTES) {
        workspaceTooLarge(requested, size, MAX_BYTES)
      }

      let buffer: Buffer
      try {
        buffer = readFileSync(target)
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : ""
        workspaceIoFailed(requested, code.length > 0 ? code : "read failed")
      }
      if (looksBinary(buffer)) workspaceBinary(requested)

      const lines = buffer.toString("utf8").split("\n")
      const bodyLines = lines.length > 0 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines
      if (offset > bodyLines.length) {
        workspaceInputRefused(requested, `offset ${offset} is past the last line (${bodyLines.length})`)
      }
      const from = offset
      const slice = bodyLines.slice(from, from + limit)
      const lastLine = from + slice.length
      const header = `lines ${from + 1}-${lastLine} of ${bodyLines.length}`
      const joined = slice.join("\n")
      const capped = Buffer.from(joined, "utf8").subarray(0, MAX_BYTES).toString("utf8")
      return `${header}\n${capped}`
    },
  }
}
