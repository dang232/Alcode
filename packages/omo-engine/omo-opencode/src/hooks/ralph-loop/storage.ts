import { existsSync, readFileSync} from "node:fs"
import {join} from "node:path"
import { parseFrontmatter } from "../../shared/frontmatter"
import type {RalphLoopState} from "./types"
import { DEFAULT_STATE_FILE, DEFAULT_COMPLETION_PROMISE, DEFAULT_MAX_ITERATIONS } from "./constants"

function getStateFilePath(directory: string, customPath?: string): string {
  return customPath
    ? join(directory, customPath)
    : join(directory, DEFAULT_STATE_FILE)
}

export function readState(directory: string, customPath?: string): RalphLoopState | null {
  const filePath = getStateFilePath(directory, customPath)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    const { data, body } = parseFrontmatter<Record<string, unknown>>(content)

    const active = data.active
    const iteration = data.iteration
    
    if (active === undefined || iteration === undefined) {
      return null
    }

    const isActive = active === true || active === "true"
    const iterationNum = typeof iteration === "number" ? iteration : Number(iteration)
    
    if (isNaN(iterationNum)) {
      return null
    }

    const stripQuotes = (val: unknown): string => {
      const str = String(val ?? "")
      return str.replace(/^["']|["']$/g, "")
    }

    const ultrawork = data.ultrawork === true || data.ultrawork === "true" ? true : undefined
    const verificationAttemptStartedAt = Number(data.verification_attempt_started_at)
    const maxIterations =
      data.max_iterations === undefined || data.max_iterations === ""
        ? ultrawork
          ? undefined
          : DEFAULT_MAX_ITERATIONS
        : Number(data.max_iterations) || DEFAULT_MAX_ITERATIONS

    return {
      active: isActive,
      iteration: iterationNum,
      max_iterations: maxIterations,
      message_count_at_start:
        typeof data.message_count_at_start === "number"
          ? data.message_count_at_start
          : typeof data.message_count_at_start === "string" && data.message_count_at_start.trim() !== ""
            ? Number(data.message_count_at_start)
            : undefined,
      completion_promise: stripQuotes(data.completion_promise) || DEFAULT_COMPLETION_PROMISE,
      initial_completion_promise: data.initial_completion_promise
        ? stripQuotes(data.initial_completion_promise)
        : undefined,
      verification_attempt_id: data.verification_attempt_id
        ? stripQuotes(data.verification_attempt_id)
        : undefined,
      verification_attempt_started_at:
        data.verification_attempt_started_at === undefined || data.verification_attempt_started_at === ""
          ? undefined
          : Number.isFinite(verificationAttemptStartedAt)
            ? verificationAttemptStartedAt
            : undefined,
      verification_session_id: data.verification_session_id
        ? stripQuotes(data.verification_session_id)
        : undefined,
      started_at: stripQuotes(data.started_at) || new Date().toISOString(),
      prompt: body.trim(),
      session_id: data.session_id ? stripQuotes(data.session_id) : undefined,
      ultrawork,
      verification_pending:
        data.verification_pending === true || data.verification_pending === "true"
          ? true
          : undefined,
      strategy: data.strategy === "reset" || data.strategy === "continue" ? data.strategy : undefined,
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return null
  }
}

