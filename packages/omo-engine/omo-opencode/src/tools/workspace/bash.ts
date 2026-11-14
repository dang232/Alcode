/**
 * bash.ts — the native `bash` tool: bounded command execution inside the workspace.
 *
 * What this enforces: the working directory is contained by the shared rule, the run
 * has a deadline, both streams are capped, and the whole process tree is killed on
 * timeout so a shell cannot outlive its call. The exit code is reported as it was — a
 * non-zero exit is a failure, never an empty success.
 *
 * What this does NOT do: there is no OS sandbox, no host approval round-trip in this
 * package, and no filesystem boundary at all — the workspace is only the default
 * working directory, so a command may read or write any path the app's OS identity can
 * reach. On Windows the tree kill cannot be guaranteed: `taskkill /T` needs a live
 * leader, so a grandchild that outlives its shell may survive the deadline. Treat this
 * tool as an audited action, not as containment.
 */

import { spawn } from "node:child_process"
import { z } from "zod"

import type { OmoJsonObject, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
import { resolveInsideWorkspace } from "./containment.ts"
import { workspaceApprovalDenied, workspaceInputRefused, workspaceUnauthenticated } from "./errors.ts"

export const BASH_TOOL_NAME = "bash"

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const OUTPUT_LIMIT_BYTES = 64 * 1024

const BASH_DESCRIPTION =
  "Run a shell command with the project workspace as its working directory. Returns the exit code with bounded stdout and stderr; a non-zero exit is reported as a failure."

const BashArgs = z.object({
  command: z.string().trim().min(1),
  cwd: z.string().trim().min(1).optional(),
  timeoutMs: z.number().int().min(1).max(MAX_TIMEOUT_MS).optional(),
})

type StreamCapture = { readonly text: string; readonly truncated: boolean; readonly bytes: number }

const capture = (): { push: (chunk: Buffer) => void; result: () => StreamCapture } => {
  const chunks: Buffer[] = []
  let bytes = 0
  let truncated = false
  return {
    push: (chunk) => {
      bytes += chunk.length
      if (bytes <= OUTPUT_LIMIT_BYTES) chunks.push(chunk)
      else truncated = true
    },
    result: () => ({
      text: Buffer.concat(chunks).toString("utf8"),
      truncated,
      bytes,
    }),
  }
}

const killTree = async (pid: number | undefined, platform: NodeJS.Platform): Promise<void> => {
  if (pid === undefined) return
  if (platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
      const done = setTimeout(() => resolve(), 5000)
      killer.on("close", () => {
        clearTimeout(done)
        resolve()
      })
      killer.on("error", () => {
        clearTimeout(done)
        resolve()
      })
    })
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      return
    }
  }
}

export function createWorkspaceBashTool(options: { readonly directory: string }): OmoToolDefinition {
  return {
    description: BASH_DESCRIPTION,
    args: {
      properties: {
        command: { type: "string", description: "Command line to run through the platform shell." },
        cwd: { type: "string", description: "Working directory inside the workspace; defaults to the project root." },
        timeoutMs: { type: "number", description: `Deadline in milliseconds, 1-${MAX_TIMEOUT_MS}.` },
      },
    },
    execute: async (toolArgs: OmoJsonObject, context?: OmoToolContext) => {
      if (context?.authenticated !== true) workspaceUnauthenticated(BASH_TOOL_NAME)
      const parsed = BashArgs.safeParse(toolArgs)
      if (!parsed.success) {
        const named = z.object({ command: z.string() }).safeParse(toolArgs)
        workspaceInputRefused(named.success ? named.data.command : "", parsed.error.issues[0]?.message ?? "invalid arguments")
      }
      const cwd = resolveInsideWorkspace(options.directory, parsed.data.cwd ?? ".")
      const timeoutMs = parsed.data.timeoutMs ?? DEFAULT_TIMEOUT_MS
      // The host owns the veto: when it offers an approval surface, the command does
      // not start until that surface allows it. No surface means no approval, and the
      // result says so instead of implying one was granted.
      let approval = "not offered by this runtime"
      if (context?.ask !== undefined) {
        try {
          await context.ask({ permission: BASH_TOOL_NAME, patterns: [parsed.data.command], metadata: { cwd, sessionID: context.sessionID } })
          approval = "granted by host"
        } catch (error) {
          workspaceApprovalDenied(BASH_TOOL_NAME, error instanceof Error ? error.message : String(error))
        }
      }
      const platform = process.platform
      const argv = platform === "win32" ? ["cmd.exe", "/d", "/s", "/c", parsed.data.command] : ["/bin/bash", "-lc", parsed.data.command]

      const stdout = capture()
      const stderr = capture()
      const child = spawn(argv[0], argv.slice(1), {
        cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        detached: platform !== "win32",
      })

      child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk))
      child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk))

      const outcome = await new Promise<{ kind: "exit" | "timeout" | "error"; code: number | null; signal: string | null; message?: string }>((resolve) => {
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          void killTree(child.pid, platform).then(() => resolve({ kind: "timeout", code: null, signal: null }))
        }, timeoutMs)
        child.on("error", (error: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({ kind: "error", code: null, signal: null, message: error.message })
        })
        child.on("close", (code: number | null, signal: string | null) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({ kind: "exit", code, signal })
        })
      })

      const out = stdout.result()
      const err = stderr.result()
      const header =
        outcome.kind === "timeout"
          ? `timed out after ${timeoutMs}ms`
          : outcome.kind === "error"
            ? `could not start: ${outcome.message ?? "unknown error"}`
            : `exit ${outcome.code ?? "none"}${outcome.signal === null ? "" : ` (signal ${outcome.signal})`}`
      const parts = [header, `approval: ${approval}`]
      parts.push(`stdout${out.truncated ? ` (truncated at ${OUTPUT_LIMIT_BYTES}B of ${out.bytes}B)` : ""}:`)
      parts.push(out.text.length > 0 ? out.text.replace(/\s+$/, "") : "(empty)")
      if (err.text.length > 0 || err.truncated) {
        parts.push(`stderr${err.truncated ? ` (truncated at ${OUTPUT_LIMIT_BYTES}B of ${err.bytes}B)` : ""}:`)
        parts.push(err.text.replace(/\s+$/, ""))
      }
      return parts.join("\n")
    },
  }
}
