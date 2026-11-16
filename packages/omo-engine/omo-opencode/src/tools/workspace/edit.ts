/**
 * edit.ts — the native `edit` tool: one exact, atomic text replacement.
 *
 * A targeted edit names the old text verbatim and succeeds only when it occurs
 * exactly once, so an ambiguous anchor is a refusal instead of a guess. The file
 * is resolved through the shared containment rule, an optional expected digest
 * makes a stale replacement an explicit refusal, and the bytes land through a
 * same-directory temp file plus rename so a partial write never replaces a good
 * file.
 */

import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"

import type { OmoJsonObject, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
import { resolveForWrite, workspaceRootFor } from "./containment.ts"
import {
  WorkspaceToolError,
  workspaceBinary,
  workspaceInputRefused,
  workspaceIoFailed,
  workspaceNotFound,
  workspaceTooLarge,
} from "./errors.ts"

export const EDIT_TOOL_NAME = "edit"

const MAX_EDIT_BYTES = 512 * 1024
const BINARY_PROBE_BYTES = 8192

const EDIT_DESCRIPTION =
  "Replace one exact text span inside a project file. The old text must occur exactly once; ambiguous or missing anchors are refused."

const EditArgs = z.object({
  path: z.string().trim().min(1),
  oldText: z.string().min(1),
  newText: z.string(),
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

const occurrencesOf = (content: string, anchor: string): number => {
  let count = 0
  let from = 0
  while (true) {
    const at = content.indexOf(anchor, from)
    if (at === -1) return count
    count += 1
    from = at + anchor.length
  }
}

export function createWorkspaceEditTool(options: { readonly directory: string }): OmoToolDefinition {
  return {
    description: EDIT_DESCRIPTION,
    args: {
      properties: {
        path: { type: "string", description: "File to edit, relative to the project workspace." },
        oldText: { type: "string", description: "Exact text to replace; it must occur exactly once in the file." },
        newText: { type: "string", description: "Replacement text (may be empty to delete the span)." },
        expectedDigest: {
          type: "string",
          description: "Optional sha256 of the current content; the edit is refused when the file differs.",
        },
      },
    },
    execute: async (toolArgs: OmoJsonObject, context?: OmoToolContext) => {
      const parsed = EditArgs.safeParse(toolArgs)
      if (!parsed.success) {
        const named = z.object({ path: z.string() }).safeParse(toolArgs)
        workspaceInputRefused(named.success ? named.data.path : "", parsed.error.issues[0]?.message ?? "invalid arguments")
      }
      const requested = parsed.data.path
      const target = resolveForWrite(workspaceRootFor(options.directory, context), requested)

      let stat: { isDirectory: () => boolean; size: number }
      try {
        stat = statSync(target)
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : ""
        if (code === "ENOENT" || code === "ENOTDIR") workspaceNotFound(requested)
        workspaceIoFailed(requested, code.length > 0 ? code : "stat failed")
      }
      if (stat.isDirectory()) {
        throw new WorkspaceToolError(`'${requested}' is a directory.`, "NOT_A_FILE", requested)
      }
      if (stat.size > MAX_EDIT_BYTES) workspaceTooLarge(requested, stat.size, MAX_EDIT_BYTES)

      let buffer: Buffer
      try {
        buffer = readFileSync(target)
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : ""
        workspaceIoFailed(requested, code.length > 0 ? code : "read failed")
      }
      if (buffer.subarray(0, Math.min(buffer.length, BINARY_PROBE_BYTES)).includes(0)) workspaceBinary(requested)
      const content = buffer.toString("utf8")

      const expected = parsed.data.expectedDigest
      if (expected !== undefined && digestOf(buffer) !== expected) {
        staleContent(requested, expected, digestOf(buffer))
      }

      const hits = occurrencesOf(content, parsed.data.oldText)
      if (hits === 0) {
        workspaceInputRefused(requested, "the old text does not occur in the file")
      }
      if (hits > 1) {
        workspaceInputRefused(requested, `the old text occurs ${hits} times; it must occur exactly once`)
      }
      const next = Buffer.from(content.replace(parsed.data.oldText, parsed.data.newText), "utf8")

      try {
        mkdirSync(dirname(target), { recursive: true })
        const temp = join(dirname(target), `.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`)
        writeFileSync(temp, next)
        renameSync(temp, target)
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : ""
        workspaceIoFailed(requested, code.length > 0 ? code : "write failed")
      }

      return `updated ${requested} (sha256 ${digestOf(next)}, ${next.length} bytes)`
    },
  }
}
