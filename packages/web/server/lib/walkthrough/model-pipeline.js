/**
 * Walkthrough model resolution through the engine model-core pipeline.
 *
 * BUILD SOURCE ONLY — never import this file at runtime. It imports engine
 * `.ts` directly, which plain Node cannot resolve in the packaged app (the
 * web server ships as source and Electron main imports it in-process with no
 * transpile step). Runtime entries import the committed
 * `model-pipeline.bundle.js` instead; only that bundle may appear in a
 * runtime import chain.
 *
 * The walkthrough used to pick its model with a bridge-local chain (explicit
 * choice, settings override, composer provider/model, OpenCode default). That
 * chain now lives in `@oh-my-opencode/model-core`: this module maps the
 * walkthrough's inputs onto the pipeline's five slots — override, category,
 * fallback, chain, default — and serves the small-model bridge dispatch with
 * the result, including a forced-downgrade path down the engine chain when
 * the resolved model cannot serve the request.
 *
 * Reference: `packages/omo-engine/model-core/src` (`resolveModelPipeline`,
 * `CATEGORY_MODEL_REQUIREMENTS`). The core is imported by relative path
 * because the web package does not take a package dependency on it; the core
 * itself is dependency-free, so this adds no new runtime requirements.
 */
import {
  CATEGORY_MODEL_REQUIREMENTS,
  resolveModelPipeline,
} from '../../../../omo-engine/model-core/src/index.ts';
import { describeSmallModel } from '../small-model/index.js';
import {
  getDefaultModelInfo,
  getSmallModelClient,
  listModelInfos,
  listProviderInfos,
} from '../small-model/client.js';
import { readWalkthroughModelOverride } from './model-settings.js';

/**
 * The engine lane the walkthrough resolves from. Walkthrough generation is a
 * quick small-model task — a guided reading path, not a frontier reasoning
 * job — so it rides the `quick` lane's fast-model chain as its downgrade
 * order rather than pinning its own forked list here.
 */
export const WALKTHROUGH_MODEL_CHAIN =
  CATEGORY_MODEL_REQUIREMENTS?.quick?.fallbackChain ?? [];

export const parseModelRef = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  return {
    providerID: trimmed.slice(0, slash),
    modelID: trimmed.slice(slash + 1),
  };
};

export const modelRefString = (model) =>
  model && model.providerID && model.modelID
    ? `${model.providerID}/${model.modelID}`
    : null;

const normalizeRef = (value) => {
  const parsed = parseModelRef(value);
  return parsed ? `${parsed.providerID}/${parsed.modelID}` : undefined;
};

/**
 * Map the walkthrough's inputs onto the pipeline's five slots:
 *
 * - override: the explicit per-review model, then the saved walkthrough
 *   setting. Either one is the user's stated intent and outranks everything.
 * - category: the composer the review was opened from (`provider/model`).
 *   Staying on it keeps the diff where the user already sent their work.
 * - fallback: caller-supplied user fallback models, tried before the
 *   hardcoded chain.
 * - chain: the engine `quick` lane. The deliberate cross-provider downgrade
 *   lane — reached only when the composer's model cannot serve the request.
 * - default: OpenCode's default model, honoured only when it lives on the
 *   composer's provider (or none was named). Without that guard a review
 *   opened on one provider could silently bill another.
 *
 * `forceDowngrade` skips the override and category slots so a retry caller
 * can resolve strictly from fallback, chain, and default.
 */
export function buildWalkthroughPipelineRequest({
  explicitModel,
  settingsOverride,
  providerID,
  modelID,
  userFallbackModels,
  availableModels,
  systemDefaultModel,
  forceDowngrade = false,
}) {
  const composerDefault =
    typeof providerID === 'string' && providerID
    && typeof modelID === 'string' && modelID
      ? normalizeRef(`${providerID}/${modelID}`)
      : undefined;
  const fallbacks = Array.isArray(userFallbackModels)
    ? userFallbackModels.map(normalizeRef).filter(Boolean)
    : [];
  return {
    intent: {
      ...(!forceDowngrade && normalizeRef(explicitModel)
        ? { uiSelectedModel: normalizeRef(explicitModel) } : {}),
      ...(!forceDowngrade && normalizeRef(settingsOverride)
        ? { userModel: normalizeRef(settingsOverride) } : {}),
      ...(!forceDowngrade && composerDefault
        ? { categoryDefaultModel: composerDefault } : {}),
      ...(fallbacks.length > 0 ? { userFallbackModels: fallbacks } : {}),
    },
    constraints: {
      availableModels: availableModels ?? new Set(),
    },
    policy: {
      fallbackChain: WALKTHROUGH_MODEL_CHAIN,
      ...(systemDefaultModel ? { systemDefaultModel } : {}),
    },
  };
}

const catalogRefStrings = (models) => {
  const refs = [];
  for (const model of models ?? []) {
    if (typeof model?.providerID !== 'string' || !model.providerID) continue;
    // Both the catalog key (`id`) and the provider API name (`modelID`):
    // derived entries share one API name, so an exact `id` match wins while
    // the API name still matches when only it is listed.
    for (const id of [model.id, model.modelID]) {
      if (typeof id === 'string' && id) refs.push(`${model.providerID}/${id}`);
    }
  }
  return refs;
};

const readCatalogModelRefs = async (directory) => {
  const client = getSmallModelClient(directory);
  if (!client) return [];
  const models = await listModelInfos(client, directory).catch(() => []);
  return catalogRefStrings(models);
};

const readConnectedProviderIDs = async (directory) => {
  const client = getSmallModelClient(directory);
  if (!client) return [];
  try {
    const [providers, models] = await Promise.all([
      listProviderInfos(client).catch(() => []),
      listModelInfos(client, directory).catch(() => []),
    ]);
    const enabled = new Set();
    for (const model of models) {
      if (model?.enabled === false) continue;
      if (typeof model?.providerID === 'string' && model.providerID) enabled.add(model.providerID);
    }
    // The provider list alone is not authoritative — it comes back empty on
    // setups where models are perfectly usable — so it only contributes names
    // for providers the model list already proves usable.
    const ids = new Set();
    for (const provider of providers) {
      if (typeof provider?.id === 'string' && enabled.has(provider.id)) ids.add(provider.id);
    }
    for (const id of enabled) ids.add(id);
    return [...ids];
  } catch {
    return [];
  }
};

const readDefaultModelRef = async (directory) => {
  const client = getSmallModelClient(directory);
  if (!client) return null;
  const info = await getDefaultModelInfo(client).catch(() => null);
  if (!info || typeof info.providerID !== 'string' || typeof info.id !== 'string') return null;
  return `${info.providerID}/${info.id}`;
};

/**
 * Whether the resolved model was the user's explicit choice: either the
 * per-review model or the saved walkthrough setting, which the pipeline
 * reports as `override` provenance.
 *
 * Explicitly chosen models fail fast on missing login — downgrading an
 * unauthenticated explicit choice onto another provider would spend someone
 * else's subscription without asking. Anything else may downgrade.
 */
export const isExplicitlyChosenModel = (described) => {
  if (described?.pipeline) return described.pipeline.provenance === 'override';
  return described?.source === 'request' || described?.source === 'settings';
};

/**
 * Resolve the walkthrough model through the engine pipeline, then describe
 * it through the small-model bridge for budgets and login state.
 *
 * Returns the described model with a `pipeline` property (`provenance`,
 * `variant`, `attempted`), or the bridge's own answer when the catalog is
 * invisible (OpenCode unreachable, mocked in tests) and the pipeline
 * abstains — exactly the old behaviour — or `null` when nothing resolves.
 */
export async function resolveWalkthroughModel({
  directory,
  explicitModel,
  providerID,
  modelID,
  userFallbackModels,
  outputReserveTokens,
  forceDowngrade = false,
  deps = {},
}) {
  const {
    readOverride = () => readWalkthroughModelOverride(),
    listCatalogModels = (dir) => readCatalogModelRefs(dir),
    listConnectedProviders = (dir) => readConnectedProviderIDs(dir),
    readDefaultModel = (dir) => readDefaultModelRef(dir),
    describe = (options) => describeSmallModel(options),
  } = deps;

  const settingsOverride = await Promise.resolve()
    .then(() => readOverride())
    .catch(() => null);
  const [catalogRefs, connectedProviders, defaultRef] = await Promise.all([
    Promise.resolve().then(() => listCatalogModels(directory)).catch(() => []),
    Promise.resolve().then(() => listConnectedProviders(directory)).catch(() => []),
    Promise.resolve().then(() => readDefaultModel(directory)).catch(() => null),
  ]);
  const availableModels = new Set(
    (Array.isArray(catalogRefs) ? catalogRefs : []).filter((ref) => typeof ref === 'string'),
  );

  // The OpenCode default is honoured only on the composer's provider: without
  // that guard a review opened on one provider would silently bill another.
  const defaultParsed = parseModelRef(defaultRef);
  const systemDefaultModel = defaultParsed
    && (!providerID || defaultParsed.providerID === providerID)
    ? `${defaultParsed.providerID}/${defaultParsed.modelID}`
    : undefined;

  const request = buildWalkthroughPipelineRequest({
    explicitModel,
    settingsOverride,
    providerID,
    modelID,
    userFallbackModels,
    availableModels,
    systemDefaultModel,
    forceDowngrade,
  });
  const picked = resolveModelPipeline(request, {
    readConnectedProvidersCache: () => connectedProviders ?? null,
    findProviderModelMetadata: () => undefined,
  });

  const describeOptions = (overrideModel) => ({
    directory,
    overrideModel,
    preferredProviderID: providerID || undefined,
    preferredModelID: modelID || undefined,
    outputReserveTokens,
  });

  if (picked?.model) {
    const described = await Promise.resolve()
      .then(() => describe(describeOptions(picked.model)))
      .catch(() => null);
    if (described) {
      return {
        ...described,
        pipeline: {
          provenance: picked.provenance,
          variant: picked.variant,
          attempted: picked.attempted ?? [],
        },
      };
    }
  }

  // The pipeline abstains when the catalog is invisible or nothing matched.
  // The bridge's own chain is the last resort — but never for a forced
  // downgrade, which must not resurrect the skipped override.
  if (forceDowngrade) return null;
  const legacy = await Promise.resolve()
    .then(() => describe(describeOptions(
      normalizeRef(explicitModel) || normalizeRef(settingsOverride) || undefined,
    )))
    .catch(() => null);
  return legacy ?? null;
}

const bareModelID = (providerID, model) => {
  const prefix = `${providerID}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
};

/**
 * The forced-downgrade order for bridge dispatch: every `provider/model` in
 * the engine chain, entry-major, skipping the resolved model and anything
 * already attempted. Dispatch tries these in order when the resolved model
 * fails with a retryable error.
 */
export function walkthroughDowngradeRefs({
  resolvedRef,
  attempted = [],
  chain = WALKTHROUGH_MODEL_CHAIN,
} = {}) {
  const skip = new Set(
    [resolvedRef, ...(Array.isArray(attempted) ? attempted : [])]
      .map((ref) => (typeof ref === 'string' ? ref.trim().toLowerCase() : null))
      .filter(Boolean),
  );
  const refs = [];
  const seen = new Set(skip);
  for (const entry of chain ?? []) {
    const model = typeof entry?.model === 'string' ? entry.model.trim() : '';
    if (!model) continue;
    for (const provider of entry?.providers ?? []) {
      const providerID = typeof provider === 'string' ? provider.trim() : '';
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

const RETRYABLE_DISPATCH_CODES = new Set([
  // The catalog moved under us: the model OpenCode listed is gone.
  'small-model-unavailable',
  // The model answered but not in JSON: a capability mismatch the next chain
  // entry may not share.
  'structured-output-unsupported',
  // No credential behind the resolved model: the next entry may have one.
  'no-provider-login',
]);

/**
 * Whether a dispatch failure may advance to the next downgrade candidate.
 * Abort and budget failures never retry: an abort is the user cancelling,
 * and a too-large input or exhausted output will not shrink on another
 * small model. An explicit `downgrade: false` on the error opts out — used
 * for an explicitly chosen model with no login, which fails fast instead of
 * spending another provider.
 */
export function isWalkthroughDispatchRetryable(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.name === 'AbortError') return false;
  if (error.downgrade === false) return false;
  if (typeof error.code === 'string' && RETRYABLE_DISPATCH_CODES.has(error.code)) return true;
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
export async function advanceThroughWalkthroughCandidates({
  refs,
  attempt,
  shouldRetry = isWalkthroughDispatchRetryable,
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
      if (attempted.length > 0 && error && typeof error === 'object') {
        throw Object.assign(error, { downgradeAttempted: [...attempted] });
      }
      throw error;
    }
  }
  if (lastError) {
    if (typeof lastError === 'object' && lastError !== null) {
      throw Object.assign(lastError, { downgradeAttempted: [...attempted] });
    }
    throw lastError;
  }
  throw new Error('No walkthrough model candidates to try');
}
