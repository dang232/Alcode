/**
 * gate-facts.ts — session-scoped plan-gate facts for the dispatch layer.
 *
 * The plugin entry watches each session and remembers three booleans the
 * plan gate decides on: whether the user explicitly asked for planning,
 * whether a plan artifact was touched, and whether execution started.
 * Anything unknown stays false so the gate fails closed.
 *
 * Origin discipline matters: only user-originated hooks (chat.message,
 * command.execute.before) may mark a plan request. Model-side observations
 * (message/system transforms, tool reads, definition fetches) never do —
 * a model reading a skill file is not a user asking for a plan.
 */

export interface GateFacts {
  readonly userRequestedPlan: boolean;
  readonly planArtifactTouched: boolean;
  readonly executeStarted: boolean;
}

const EMPTY_GATE_FACTS: GateFacts = {
  userRequestedPlan: false,
  planArtifactTouched: false,
  executeStarted: false,
};

type MutableGateFacts = {
  userRequestedPlan: boolean;
  planArtifactTouched: boolean;
  executeStarted: boolean;
};

const factsBySession = new Map<string, MutableGateFacts>();

function entryFor(sessionID: string): MutableGateFacts {
  const existing = factsBySession.get(sessionID);
  if (existing) return existing;
  const fresh: MutableGateFacts = { ...EMPTY_GATE_FACTS };
  factsBySession.set(sessionID, fresh);
  return fresh;
}

/**
 * Snapshot the facts for one session. Unknown sessions report all false —
 * the dispatch layer treats that as "no proof yet" and denies.
 */
export function readGateFacts(sessionID: string): GateFacts {
  const entry = factsBySession.get(sessionID);
  if (!entry) return { ...EMPTY_GATE_FACTS };
  return { ...entry };
}

/**
 * Heuristic for an explicit user plan request in free text. Matches a
 * leading /plan command, a planning verb aimed at a plan, or a trailing
 * "plan first / before / please" qualifier. Skill-doc reads and model
 * echoes rarely match, but this stays a heuristic — the dispatch layer
 * owns the final verdict.
 */
const PLAN_REQUEST_PATTERN =
  /(^|\s)\/plan\b|\b(make|create|write|draft|draw\s+up|update|review|show|propose)\b[^.\n]{0,80}\bplans?\b|\bplans?\b[^.\n]{0,40}\b(first|before|ahead|please)\b/i;

export function isExplicitPlanRequest(text: string): boolean {
  return PLAN_REQUEST_PATTERN.test(text);
}

/**
 * Mark a user plan request. Call only from user-originated hooks. When
 * `text` is given it must look like an explicit request or nothing is
 * recorded; when omitted the caller has already classified the signal
 * (for example a plan-named slash command) and the flag is set directly.
 */
export function noteUserPlanRequest(sessionID: string, text?: string): void {
  if (sessionID.length === 0) return;
  if (text !== undefined && !isExplicitPlanRequest(text)) return;
  entryFor(sessionID).userRequestedPlan = true;
}

/** Mark that a plan artifact (.omo/plans/*.md) was produced or touched. */
export function notePlanArtifact(sessionID: string): void {
  if (sessionID.length === 0) return;
  entryFor(sessionID).planArtifactTouched = true;
}

/** Mark that execution started — the plan-review window is now closed. */
export function noteExecutionStart(sessionID: string): void {
  if (sessionID.length === 0) return;
  entryFor(sessionID).executeStarted = true;
}

/** Forget one session, or every session when no ID is given (teardown/tests). */
export function resetGateFacts(sessionID?: string): void {
  if (sessionID === undefined) {
    factsBySession.clear();
    return;
  }
  factsBySession.delete(sessionID);
}
