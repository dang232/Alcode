/**
 * Delegate-task guard for the small-model bridge dispatch.
 *
 * BUILD SOURCE ONLY — never import this file at runtime. It imports engine
 * `.ts` directly, which plain Node cannot resolve in the packaged app (the
 * web server ships as source and Electron main imports it in-process with no
 * transpile step). Runtime entries import the committed
 * `delegate-dispatch.bundle.js` instead (regen with
 * `bun ./delegate-dispatch.regen.js` in this directory); only that bundle
 * may appear in a runtime import chain.
 *
 * Two harness-neutral primitives from `@oh-my-opencode/delegate-core` wired
 * onto the bridge: (1) delegated work resolves through
 * `resolveModelForDelegateTask` with its fallback chains, and a model that
 * fails at dispatch yields to the next chain entry instead of failing the
 * call; (2) a malformed `task()` call is classified with
 * `detectDelegateTaskError` and answered with `buildRetryGuidance` — a fix
 * hint plus a corrected example call the model can retry at once.
 *
 * Reference: `packages/omo-engine/delegate-core/src` (`model-selection`,
 * `retry-patterns`, `retry-guidance`). The core is imported by relative path
 * because the web package does not take a package dependency on it; the core
 * plus its `model-core` dependency are dependency-free, so this adds no new
 * runtime requirements.
 */
import {
  buildRetryGuidance,
  DELEGATE_TASK_ERROR_PATTERNS,
  detectDelegateTaskError,
  resolveModelForDelegateTask,
} from '../../../../omo-engine/delegate-core/src/index.ts';

export { DELEGATE_TASK_ERROR_PATTERNS };

const isNonEmptyString = (value) => (value?.trim?.()?.length ?? 0) > 0;

// A synthesized engine-style error line for a locally detected shape
// violation. Each line carries the exact substring the matching
// `DELEGATE_TASK_ERROR_PATTERNS` entry keys on, so `detectDelegateTaskError`
// classifies it into the engine-known error and `buildRetryGuidance` answers
// the fix hint plus the corrected example call.
const malformed = (errorType, originalOutput) => {
  const detected = detectDelegateTaskError(originalOutput);
  const error = detected ?? { errorType, originalOutput };
  return { ok: false, errorType: error.errorType, guidance: buildRetryGuidance(error) };
};

/**
 * Validate a `task()` delegate call before it dispatches.
 *
 * Required shape: a non-empty `description` and `prompt`, exactly one of
 * `category` / `subagent_type`, a boolean `run_in_background`, and a
 * `load_skills` array. Answers `{ ok: true, task }` with the normalized call,
 * or `{ ok: false, errorType, guidance }` where `guidance` is the engine
 * `buildRetryGuidance` output — the fix hint plus a corrected example call
 * for every engine-known malformation, the generic retry line otherwise.
 */
export function validateDelegateTaskCall(input) {
  if (!input || Object(input) !== input || Array.isArray(input)) {
    return malformed(
      'missing_category_or_agent',
      '[ERROR] Invalid arguments: Must provide either category or subagent_type (task call must be an object).',
    );
  }
  if (!isNonEmptyString(input.description)) {
    return malformed(
      'malformed_task_call',
      `[ERROR] Invalid task call: description is required, got ${JSON.stringify(input.description)}.`,
    );
  }
  if (!isNonEmptyString(input.prompt)) {
    return malformed(
      'malformed_task_call',
      '[ERROR] Invalid task call: prompt is required and must be a non-empty string.',
    );
  }
  const hasCategory = isNonEmptyString(input.category);
  const hasAgent = input.subagent_type !== undefined && input.subagent_type !== null;
  if (!hasCategory && !hasAgent) {
    return malformed(
      'missing_category_or_agent',
      '[ERROR] Invalid arguments: Must provide either category or subagent_type.',
    );
  }
  if (hasCategory && hasAgent) {
    return malformed(
      'mutual_exclusion',
      '[ERROR] Invalid arguments: provide category OR subagent_type, not both.',
    );
  }
  if (hasAgent && !isNonEmptyString(input.subagent_type)) {
    return malformed(
      'empty_agent',
      '[ERROR] Invalid arguments: Agent name cannot be empty.',
    );
  }
  if (input.run_in_background !== true && input.run_in_background !== false) {
    return malformed(
      'missing_run_in_background',
      '[ERROR] Invalid arguments: missing run_in_background flag (want run_in_background=true or false).',
    );
  }
  if (!Array.isArray(input.load_skills)) {
    return malformed(
      'missing_load_skills',
      '[ERROR] Invalid arguments: missing load_skills parameter (want load_skills=[], empty when no skills are needed).',
    );
  }
  const task = {
      description: input.description.trim(),
      prompt: input.prompt.trim(),
    };
    if (hasCategory) task.category = input.category.trim();
    if (hasAgent) task.subagent_type = input.subagent_type.trim();
    task.run_in_background = input.run_in_background;
    task.load_skills = [...input.load_skills];
    return { ok: true, task };
}

/**
 * Resolve which model delegated work runs on, through the engine fallback
 * chain: user override, category default, user `fallback_models`, hardcoded
 * `fallbackChain`, system default. Answers the engine result as-is — a
 * `{ model, variant }` pick, a `{ skipped: true }` cold-cache sentinel, or
 * `undefined` when nothing resolves.
 */
export function resolveDelegateModel(input, deps) {
  return resolveModelForDelegateTask(input, deps);
}

const bareModelID = (providerID, model) => {
  const prefix = `${providerID}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
};

/**
 * The forced-downgrade order for bridge dispatch: every `provider/model` in
 * the delegate fallback chain, entry-major, skipping the resolved model and
 * anything already attempted. Dispatch tries these in order when the resolved
 * model fails with a retryable error.
 */
export function delegateDowngradeRefs({ resolvedRef, attempted = [], fallbackChain = [] } = {}) {
  const skip = new Set(
    [resolvedRef, ...(Array.isArray(attempted) ? attempted : [])]
      .map((ref) => (ref?.trim?.()?.toLowerCase?.() ?? null))
      .filter(Boolean),
  );
  const refs = [];
  const seen = new Set(skip);
  for (const entry of fallbackChain ?? []) {
    const model = (entry?.model?.trim?.() ?? '');
    if (!model) continue;
    for (const provider of entry?.providers ?? []) {
      const providerID = (provider?.trim?.() ?? '');
      if (!providerID) continue;
      const ref = `${providerID}/${bareModelID(providerID, model)}`;
      const key = ref.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }
  }
  return refs;
}

const RETRYABLE_DELEGATE_DISPATCH_CODES = new Set([
  // The catalog moved under us: the model OpenCode listed is gone.
  'small-model-unavailable',
  // The model answered but not in JSON: a capability mismatch the next chain
  // entry may not share.
  'structured-output-unsupported',
  // No credential behind the resolved model: the next entry may have one.
  // Callers mark an explicitly chosen model with `downgrade: false` to fail
  // fast instead of spending another provider.
  'no-provider-login',
]);

/**
 * Whether a dispatch failure may advance to the next downgrade candidate.
 * Aborts never retry, and an explicit `downgrade: false` on the error opts
 * out — used for an explicitly chosen model, which fails fast instead of
 * spending another provider.
 */
export function isDelegateDispatchRetryable(error) {
  if (!error || Object(error) !== error) return false;
  if (error.name === 'AbortError') return false;
  if (error.downgrade === false) return false;
  if (RETRYABLE_DELEGATE_DISPATCH_CODES.has(error.code)) return true;
  if (error.statusCode === 404 || error.statusCode === 503) return true;
  // Rejected before provider dispatch (a cold OpenCode catalog): costs
  // nothing to retry elsewhere.
  if (error._tag === 'InvalidRequestError') return true;
  return false;
}

/**
 * Run `attempt` against each candidate ref in order — the forced-downgrade
 * path. The first success resolves `{ ref, result, attempted }`; a retryable
 * failure advances to the next ref; anything else rethrows at once, and an
 * exhausted list rethrows the last retryable failure with the refs it went
 * through attached as `downgradeAttempted`.
 */
export async function advanceThroughDelegateCandidates({
  refs,
  attempt,
  shouldRetry = isDelegateDispatchRetryable,
}) {
  const attempted = [];
  let lastError = null;
  const list = Array.isArray(refs) ? refs : [];
  for (const ref of list) {
    try {
      const result = await attempt(ref);
      return { ref, result, attempted };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (shouldRetry(error) && ref !== list.at(-1)) {
        attempted.push(ref);
        lastError = error;
        continue;
      }
      if (attempted.length > 0 && error && Object(error) === error) {
        throw Object.assign(error, { downgradeAttempted: [...attempted] });
      }
      throw error;
    }
  }
  if (lastError) {
    if (lastError && Object(lastError) === lastError) {
      throw Object.assign(lastError, { downgradeAttempted: [...attempted] });
    }
    throw lastError;
  }
  throw new Error('No delegate model candidates to try');
}
