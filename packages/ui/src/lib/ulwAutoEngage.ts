/**
 * Content-based ULW engagement: choose the run workflow from the work itself.
 *
 * Explicit orders (a leading `ulw` or `/ulw`, a closing `mass ulw`) keep
 * working exactly as before and are resolved elsewhere. This module answers
 * the case a real brief showed: a long, structured, execution-demanding
 * prompt with no trigger at all, which used to degrade into a plain prompt
 * with no run session, no goals, and no DAG entry.
 *
 * The rule is deliberately conjunctive — length AND structure AND mandate —
 * so each common non-run shape fails at least one gate: short chats fail
 * length, pasted logs and stack traces fail structure, read-only questions
 * fail mandate. Shell input never engages.
 */

export const AUTO_ENGAGE_MIN_CHARS = 1500

type NamedSignal = {
  readonly name: string
  readonly pattern: RegExp
}

/** Work-order structure: the message reads as a job spec, not prose. */
const STRUCTURE_SIGNALS: readonly NamedSignal[] = [
  {
    name: 'section-header',
    pattern: /^#{1,4}\s+(phase|priority|definition|deliverables|acceptance|verification|findings|changes|remaining|operating|execution|requirements|success|scope|timeline|milestone)/im,
  },
  { name: 'priority-marker', pattern: /\bP[01]\b/ },
  { name: 'phase-step', pattern: /\b(phase\s+[A-Z]|step\s+\d+)\b/i },
  { name: 'done-definition', pattern: /definition of done|success criteria|acceptance criteria/i },
  { name: 'deliverables', pattern: /deliverables|evidence artifacts|final report/i },
]

/** Execution mandate: the message orders work done, not described. */
const MANDATE_SIGNALS: readonly NamedSignal[] = [
  {
    name: 'execution-verb',
    pattern: /\b(implement\w*|execut\w*|fix\w*|repair\w*|verif\w*|continue\b|end-to-end)\b/i,
  },
  { name: 'no-stop', pattern: /do not stop/i },
]

const fired = (signals: readonly NamedSignal[], text: string): string[] => {
  const names: string[] = []
  for (const signal of signals) {
    if (signal.pattern.test(text)) names.push(signal.name)
  }
  return names
}

export type UlwAutoRunIntent = {
  /** Full message text: the brief for the run. */
  args: string
  /** Which signals fired, for the route log and tests. */
  signals: string[]
}

/**
 * Resolve a run intent from the shape of the work, with no trigger words.
 * Returns null for shell input, short messages, unstructured pastes, and
 * read-only questions — only a long, structured, execution-demanding brief
 * starts a run on its own.
 */
export const resolveAutoRunIntent = (
  content: string,
  inputMode?: 'normal' | 'shell',
): UlwAutoRunIntent | null => {
  if (inputMode === 'shell') return null
  const text = content ?? ''
  if (text.length < AUTO_ENGAGE_MIN_CHARS) return null
  const structure = fired(STRUCTURE_SIGNALS, text)
  if (structure.length === 0) return null
  const mandate = fired(MANDATE_SIGNALS, text)
  if (mandate.length === 0) return null
  return { args: text.trim(), signals: [...structure, ...mandate] }
}
