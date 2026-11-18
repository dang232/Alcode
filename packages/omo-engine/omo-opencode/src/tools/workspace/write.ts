/**
 * write.ts — the native `write` tool: validated, atomic, host-applied file changes.
 *
 * A model proposal is not a disk change: the destination is resolved through the
 * shared containment rule (including the deepest existing ancestor, so a new file
 * cannot be created through a link that leaves the project), the content is bounded,
 * an optional expected digest makes a stale overwrite an explicit refusal, and the
 * bytes land through a same-directory temp file plus rename so a partial write never
 * replaces a good file.
 */

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"

import type { OmoJsonObject, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
import { resolveForWrite, workspaceRootFor } from "./containment.ts"
import { WorkspaceToolError, workspaceInputRefused, workspaceIoFailed } from "./errors.ts"

export const WRITE_TOOL_NAME = "write"

const MAX_CONTENT_BYTES = 2 * 1024 * 1024

const WRITE_DESCRIPTION =
  "Write a UTF-8 text file inside the project workspace. Refuses paths that leave the workspace and, when expectedDigest is given, refuses to overwrite different content."

const WriteArgs = z.object({
  path: z.string().trim().min(1),
  content: z.string(),
  expectedDigest: z.string().trim().regex(/^[0-9a-f]{64}$/).optional(),
})

const digestOf = (buffer: Buffer): string => createHash("sha256").update(buffer).digest("hex")

const staleContent = (path: string, expected: string, actual: string): never => {
  throw new WorkspaceToolError(
    `'${path}' changed since it was read: expected sha256 ${expected}, found ${actual}. Re-read the file and retry.`,
    "INVALID_INPUT",
    path,
  )
}

export function createWorkspaceWriteTool(options: { readonly directory: string }): OmoToolDefinition {
  return {
    description: WRITE_DESCRIPTION,
    args: {
      properties: {
        path: { type: "string", description: "File to write, relative to the project workspace." },
        content: { type: "string", description: "Full UTF-8 content to write." },
        expectedDigest: {
          type: "string",
          description: "Optional sha256 of the current content; the write is refused when the file differs.",
        },
      },
    },
    execute: async (toolArgs: OmoJsonObject, context?: OmoToolContext) => {
      const parsed = WriteArgs.safeParse(toolArgs)
      if (!parsed.success) {
        const named = z.object({ path: z.string() }).safeParse(toolArgs)
        workspaceInputRefused(named.success ? named.data.path : "", parsed.error.issues[0]?.message ?? "invalid arguments")
      }
      const requested = parsed.data.path
      const bytes = Buffer.from(parsed.data.content, "utf8")
      if (bytes.length > MAX_CONTENT_BYTES) {
        workspaceInputRefused(requested, `content is ${bytes.length} bytes; the limit is ${MAX_CONTENT_BYTES}`)
      }

      const target = resolveForWrite(workspaceRootFor(options.directory, context), requested)
      const existed = existsSync(target)
      let previous: string | null = null
      if (existed) {
        if (statSync(target).isDirectory()) {
          throw new WorkspaceToolError(`'${requested}' is a directory.`, "NOT_A_FILE", requested)
        }
        try {
          previous = digestOf(readFileSync(target))
        } catch (error) {
          const code = error instanceof Error && "code" in error ? String(error.code) : ""
          workspaceIoFailed(requested, code.length > 0 ? code : "read failed")
        }
      }
      const expected = parsed.data.expectedDigest
      if (expected !== undefined) {
        if (previous === null) staleContent(requested, expected, "(file did not exist)")
        if (previous !== expected) staleContent(requested, expected, previous)
      }

      const next = digestOf(bytes)
      if (previous === next) {
        return `unchanged ${requested} (sha256 ${next}, ${bytes.length} bytes)`
      }

      try {
        mkdirSync(dirname(target), { recursive: true })
        const temp = join(dirname(target), `.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`)
        writeFileSync(temp, bytes)
        renameSync(temp, target)
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : ""
        workspaceIoFailed(requested, code.length > 0 ? code : "write failed")
      }

      return `${existed ? "updated" : "created"} ${requested} (sha256 ${next}, ${bytes.length} bytes)`
    },
  }
}
