/**
 * Native ULW run create/resume for Alcode sends.
 *
 * Replaces the old bare-`ulw` fallback instruction (the bundled CLI appendix
 * that taught the model to shell out to `ulw-loop` argv by hand). When the
 * send names `ulw` but the session directory defines neither a `/ulw`
 * command template nor a `ulw` skill, the run starts deterministically here:
 * a run session is created through `opencodeClient.createSession` with the
 * run id in session metadata, then the brief goes in as the opening prompt
 * through the same `optimisticSend` + `sendMessage` path a normal prompt
 * uses. Resuming names an existing run session explicitly (`--resume
 * <session-id>` and aliases) and skips creation.
 *
 * Intent resolution mirrors the fallback exactly: a leading word-bound `ulw`
 * or `/ulw` with arguments starts a run; mid-sentence mentions stay plain
 * chat; shell input stays shell (`routeMessage` diverts shell before this
 * module is reached, and the resolver below excludes it too for direct
 * callers). Commands and skills keep precedence — `routeMessage` only calls
 * into this module when neither resolved.
 *
 * Failure is loud: a failed run creation throws instead of degrading into a
 * silent plain prompt carrying the old instruction.
 */

import type { ContextPartMetadata } from "@/lib/messages/contextParts"
import { opencodeClient, type SkillMentions } from "@/lib/opencode/client"
import { optimisticSend } from "@/sync/session-actions"

/** Command name the native path stands in for when no template exists. */
export const ULW_COMMAND_NAME = 'ulw'

/** Metadata key carrying the run id in the run session's `alcode` bag. */
export const ULW_RUN_METADATA_KEY = 'ulwRunId'

/** Fallback brief when a resume names its target and carries no goal text. */
export const ULW_RESUME_EMPTY_BRIEF = 'Continue the run.'

export type UlwRunIntent = {
  /** Raw arguments after the trigger, exactly as the slash route parsed them. */
  args: string
}

/**
 * The order written as prose: a leading `mass ulw <task>` or a closing
 * `<task> ... mass ulw`. Both are matched word-bound and only in directive
 * position, so the phrase inside a sentence stays plain chat.
 */
const MASS_ULW_LEADING = /^\s*mass\s+ulw\b([\s\S]*)$/i
const MASS_ULW_CLOSING = /(?:^|\s)mass\s+ulw\s*[.!?]*$/i

/**
 * Resolve run intent the way the old fallback did: rewrite a leading
 * word-bound `ulw` to the `/ulw` slash form, then accept only when the head
 * names `ulw` (trailing command punctuation stripped, so `ulw: ...`
 * counts). Anything else — mid-sentence mentions, lookalikes (`ulwazi`,
 * `soulwork`, `ulw-blah`), other slash commands, plain chat — is not a run.
 *
 * `mass ulw` is the same order in prose and starts a run too, because that
 * is how the request is actually typed on the composer. The brief is the
 * text around the directive, so the model receives the task itself.
 */
export const resolveUlwRunIntent = (
  content: string,
  inputMode?: 'normal' | 'shell',
): UlwRunIntent | null => {
  if (inputMode === 'shell') return null
  const text = content ?? ''
  const leadingDirective = MASS_ULW_LEADING.exec(text)
  if (leadingDirective !== null) {
    return { args: leadingDirective[1].replace(/^[\s:;,.!?]+/, '').trim() }
  }
  const closingDirective = MASS_ULW_CLOSING.exec(text)
  if (closingDirective !== null) {
    return { args: text.slice(0, closingDirective.index).trim() }
  }
  const bareUlwArguments = text.match(/^\s*ulw\b([\s\S]*)$/i)?.[1]
  const slashContent = bareUlwArguments === undefined ? text : `/ulw${bareUlwArguments}`
  if (!slashContent.startsWith("/")) return null
  const [head, ...tail] = slashContent.split(" ")
  const cmdName = head.slice(1).replace(/[:;,.!?]+$/, '')
  if (cmdName !== ULW_COMMAND_NAME) return null
  return { args: tail.join(" ") }
}

const RESUME_FLAG_PATTERN = /(?:^|\s)--(?:run|resume|run-id|session-id)(?:=|\s+)([^\s]+)/i
const RESUME_LEADING_PATTERN = /^\s*resume(?:\s+|:\s*)([^\s]+)/i

/**
 * Split an explicit resume target off the arguments. Accepts
 * `--resume <id>` (plus `--run`, `--run-id`, `--session-id`, `=` forms) or a
 * leading `resume <id>`, and returns the named session with the flag token
 * removed so the run session receives a clean brief. Returns null when the
 * arguments name no existing run — the caller then creates one.
 */
export const splitUlwResumeTarget = (args: string): { sessionId: string; rest: string } | null => {
  const text = args ?? ''
  const flagMatch = text.match(RESUME_FLAG_PATTERN)
  if (flagMatch?.[1]) {
    return { sessionId: flagMatch[1], rest: text.replace(flagMatch[0], ' ').trim() }
  }
  const leadingMatch = text.match(RESUME_LEADING_PATTERN)
  if (leadingMatch?.[1]) {
    return { sessionId: leadingMatch[1], rest: text.replace(leadingMatch[0], ' ').trim() }
  }
  return null
}

const mintUlwRunId = (): string => `ulw-${crypto.randomUUID()}`

const buildUlwRunTitle = (brief: string): string => {
  const trimmed = brief.trim()
  if (trimmed.length <= 80) return `ulw: ${trimmed}`
  return `ulw: ${trimmed.slice(0, 80)}...`
}

export type UlwNativeRunInput = {
  runtimeKey?: string
  directory?: string | null
  /**
   * Existing session to adopt as the run parent (the draft session the
   * send flow already created). Adopting keeps one conversation per
   * prompt: no second session is created and the brief lands where the
   * user sent it. The run id falls back to this session id (the DAG
   * anchors chat-path runs by parent session id). Omit only when no
   * session exists yet — then one run session is created.
   */
  sessionId?: string
  /** Original send text; the brief source when the arguments are empty. */
  content: string
  /** Raw trigger arguments, as the slash route parsed them. */
  args: string
  providerID: string
  modelID: string
  variant?: string
  agent?: string
  agentMentionName?: string
  files?: Array<{ type: "file"; mime: string; url: string; filename: string }>
  context?: Array<{ text: string; metadata?: ContextPartMetadata }>
  skills?: SkillMentions
  delivery?: 'steer'
  appendSubmissions?: () => void
  /**
   * Work the request waits for (the session's project knowledge being
   * written into it). Must not reject. The run's opening send waits on it
   * the way a normal prompt does.
   */
  ready?: Promise<void>
}

export type UlwNativeRunResult = {
  /** Session carrying the run: newly created, or the resumed one. */
  sessionId: string
  /** Run id: minted into the new session's metadata, or the resumed session id. */
  runId: string
  resumed: boolean
}

/**
 * Compact native loop procedure, attached as context on the run's opening
 * prompt. Names the native operations only — never shell argv, never
 * hand-written loop state. Without it the model treats the run as plain
 * chat (no goals registered, DAG stuck at 0/0); with it the run drives
 * the same lifecycle the DAG reads.
 */
export const buildUlwRunProcedure = (runId: string): string => (
  `ULW run ${runId}: drive the loop with native tools only — exact operations, no discovery calls. Register ALL goals in ONE ulw_goal_create call with complete per-goal briefs; it answers with each goal's goalId. Then spawn one real worker per goal with the host \`task\` tool and keep the child session id that result reports (metadata sessionID/sessionId) — never do the goal's work inline. Dispatch each goal with ulw_dispatch { runId, goalId, workerSessionId } carrying that worker's session id; a goal with no real worker session stays undispatched. Wait with a SINGLE bounded script (poll ulw_status inside one script with backoff and a deadline) instead of repeated status turns. Record each real result once with ulw_evidence { runId, goalId, childSessionId, status, resultRef, reason }, advance once with ulw_checkpoint (it refuses while receipts are missing), finish once with ulw_complete { runId, status }. Never shell out to ulw-loop CLI and never hand-write loop state. Synthesize only after checkpoint accepts; the run ends at ulw_complete. Narrate tersely: one line per phase, no per-call commentary.`
)

/**
 * Start the native run for already-resolved `ulw` arguments: adopt the
 * send flow's session when one exists (the normal case — exactly one
 * conversation per prompt), otherwise create a run session (or reuse the
 * resume target) and admit the brief as its opening prompt through the
 * same optimistic-send path a normal prompt uses.
 *
 * The run session is created on the desired model/agent up front, so the
 * opening prompt carries no model/agent switch. Throws loudly when creation
 * fails or the server returns no session — the caller must treat that as a
 * send failure, never as a plain prompt.
 */
export const startUlwNativeRun = async (input: UlwNativeRunInput): Promise<UlwNativeRunResult> => {
  const resume = splitUlwResumeTarget(input.args)
  const rest = resume ? resume.rest : input.args
  const trimmedRest = rest.trim()
  const brief = trimmedRest
    || (!resume ? input.content.trim() : '')
    || ULW_RESUME_EMPTY_BRIEF

  let sessionId: string
  let runId: string
  let resumed = false

  if (resume) {
    sessionId = resume.sessionId
    runId = resume.sessionId
    resumed = true
  } else if (input.sessionId) {
    sessionId = input.sessionId
    runId = input.sessionId
  } else {
    runId = mintUlwRunId()
    let created: { id: string } | null
    try {
      created = await opencodeClient.createSession(
        {
          title: buildUlwRunTitle(brief),
          metadata: { alcode: { [ULW_RUN_METADATA_KEY]: runId } },
          model: { providerID: input.providerID, id: input.modelID, variant: input.variant },
          agent: input.agent,
        },
        input.directory,
      )
    } catch (error) {
      throw new Error(
        `Failed to create ulw run: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    if (!created?.id) {
      throw new Error('Failed to create ulw run: the server returned no session')
    }
    sessionId = created.id
  }

  const procedureContext = { text: buildUlwRunProcedure(runId) }
  const briefContext = [...(input.context ?? []), procedureContext]
  await optimisticSend({
    runtimeKey: input.runtimeKey,
    sessionId,
    content: brief,
    directory: input.directory,
    files: input.files,
    context: briefContext,
    ready: input.ready,
    appendSubmissions: input.appendSubmissions,
    send: (messageID, context) => opencodeClient.sendMessage({
      runtimeKey: input.runtimeKey,
      id: sessionId,
      providerID: input.providerID,
      text: brief,
      agentMentions: input.agentMentionName ? [{ name: input.agentMentionName }] : undefined,
      files: input.files,
      context: context.length > 0 ? context : undefined,
      delivery: input.delivery,
      messageId: messageID,
      directory: input.directory,
      skills: input.skills,
    }).then(() => {}),
  })

  return { sessionId, runId, resumed }
}
