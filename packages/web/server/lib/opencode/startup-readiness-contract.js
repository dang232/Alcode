/**
 * Startup readiness contract — the single source of truth for the local-only
 * readiness probes and the UI indicator that consumes them.
 *
 * Contract order (probes run sequentially, first failure short-circuits):
 *   1. `session-creatable` — a session can be created with a TITLE ONLY.
 *      The probe session is deleted afterwards. The create payload must never
 *      carry `message`, `prompt`, or `model`: readiness spends zero model
 *      budget, so there is no text to send and no model to pick.
 *   2. `native-plugin-materialized` — the always-on OmO-native plugin is
 *      materialized on disk carrying the REAL engine setup payload
 *      (an entrypoint whose setup registers the native ULW operations),
 *      not an empty placeholder.
 *   3. `ulw-tools-discoverable` — the ULW tools answer a tools listing.
 *   4. `model-resolution-initialized` — model resolution answers a usable
 *      `{ providerID, modelID }` reference.
 *   5. `child-creatable` — a child of the probe session can be created and
 *      answers a REAL session id; it is deleted afterwards like its parent.
 *   6. `event-interfaces-connected` — the server-side event interfaces the
 *      UI indicator feeds on are connected (hub subscription live and the
 *      upstream OpenCode event stream reachable).
 *
 * Everything here is local-only: loopback OpenCode, local files, local MCP
 * stdio. No network, no model invocation, no prompt text anywhere.
 */

export const STARTUP_READINESS_ROUTE = '/api/startup-readiness';

export const STARTUP_READINESS_SNAPSHOT_CACHE_TTL_MS = 30_000;

export const STARTUP_READINESS_STEP_ORDER = [
  'session-creatable',
  'native-plugin-materialized',
  'ulw-tools-discoverable',
  'model-resolution-initialized',
  'child-creatable',
  'event-interfaces-connected',
];

/**
 * Title the probe session carries. Fixed (not caller-supplied) so a probe
 * session is always recognizable in a session list, and so no caller can
 * smuggle prompt text into the create call through the title.
 */
export const STARTUP_READINESS_PROBE_SESSION_TITLE = 'alcode-startup-readiness-probe';

/**
 * Keys a readiness session-create payload must never carry. `message` and
 * `prompt` would dispatch model work; `model` would pin model selection.
 * Readiness only proves a session row can be created, so `{ title }` is the
 * whole payload.
 */
export const FORBIDDEN_SESSION_CREATE_KEYS = ['message', 'prompt', 'model'];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * The only session-create payload a readiness probe may send: `{ title }`.
 * Throws when the title is unusable so the probe fails closed instead of
 * creating an untitled session nobody can recognize.
 */
export const buildTitleOnlySessionPayload = (title = STARTUP_READINESS_PROBE_SESSION_TITLE) => {
  const clean = typeof title === 'string' ? title.trim() : '';
  if (!clean) {
    throw new Error('readiness probe session requires a non-empty title');
  }
  return { title: clean };
};

/**
 * Guards the wire: throws when a session-create payload carries anything
 * beyond `{ title }`. The probes call this on the exact object they are
 * about to send, so a future caller that adds `prompt` breaks loudly here
 * instead of silently spending model budget during readiness.
 */
export const assertTitleOnlySessionPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('readiness probe session payload must be an object');
  }
  for (const key of FORBIDDEN_SESSION_CREATE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new Error(`readiness probe session must never pass "${key}"`);
    }
  }
  if (!isNonEmptyString(payload.title)) {
    throw new Error('readiness probe session payload requires a non-empty title');
  }
  return true;
};

export const STARTUP_READINESS_CODES = {
  OK: 'STARTUP_READINESS_OK',
  SESSION_OK: 'STARTUP_READINESS_SESSION_OK',
  SESSION_FAILED: 'STARTUP_READINESS_SESSION_FAILED',
  PLUGIN_OK: 'STARTUP_READINESS_PLUGIN_OK',
  PLUGIN_FAILED: 'STARTUP_READINESS_PLUGIN_FAILED',
  TOOLS_OK: 'STARTUP_READINESS_TOOLS_OK',
  TOOLS_FAILED: 'STARTUP_READINESS_TOOLS_FAILED',
  MODEL_OK: 'STARTUP_READINESS_MODEL_OK',
  MODEL_FAILED: 'STARTUP_READINESS_MODEL_FAILED',
  CHILD_OK: 'STARTUP_READINESS_CHILD_OK',
  CHILD_FAILED: 'STARTUP_READINESS_CHILD_FAILED',
  EVENTS_OK: 'STARTUP_READINESS_EVENTS_OK',
  EVENTS_FAILED: 'STARTUP_READINESS_EVENTS_FAILED',
  SKIPPED: 'STARTUP_READINESS_SKIPPED',
};

export const createStepResult = (step, ok, code, detail = null, durationMs = 0) => ({
  step,
  ok: ok === true,
  code,
  detail,
  durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0,
});

export const skippedStepResult = (step) => createStepResult(step, false, STARTUP_READINESS_CODES.SKIPPED, {
  reason: 'an earlier contract step failed; later steps were not attempted',
});

/**
 * The snapshot the UI indicator consumes. `status` is the repair state owned
 * by the runtime (`unknown` before the first run, `ready`, `repairing` while
 * the single repair attempt runs, `unavailable` once it is exhausted);
 * `steps` are ALWAYS in `STARTUP_READINESS_STEP_ORDER`, with `SKIPPED`
 * fillers after a short-circuit so the indicator can render the full
 * contract, not just the prefix that ran.
 */
export const createReadinessSnapshot = ({
  status = 'unknown',
  steps = [],
  checkedAt = 0,
  consecutiveFailures = 0,
} = {}) => {
  const byStep = new Map(steps.map((result) => [result?.step, result]));
  const ordered = STARTUP_READINESS_STEP_ORDER.map(
    (step) => byStep.get(step) ?? skippedStepResult(step),
  );
  const failed = ordered.find((result) => !result.ok && result.code !== STARTUP_READINESS_CODES.SKIPPED)
    ?? ordered.find((result) => !result.ok)
    ?? null;
  return {
    status,
    ok: failed === null,
    steps: ordered,
    failedStep: failed && failed.code !== STARTUP_READINESS_CODES.SKIPPED ? failed.step : failed?.step ?? null,
    checkedAt,
    consecutiveFailures,
  };
};
