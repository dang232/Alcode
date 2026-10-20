// Unit tests for the walkthrough model pipeline: resolution through the
// engine model-core pipeline, downgrade ordering, dispatch retryability, and
// the candidate-advance loop. Everything OpenCode-shaped is injected through
// `deps`, so these run with no server and no mocks.
import { describe, expect, it } from 'bun:test';
import {
  advanceThroughWalkthroughCandidates,
  buildWalkthroughPipelineRequest,
  isExplicitlyChosenModel,
  isWalkthroughDispatchRetryable,
  resolveWalkthroughModel,
  WALKTHROUGH_MODEL_CHAIN,
  walkthroughDowngradeRefs,
} from './model-pipeline.js';

const chainRef = (entry, providerIndex = 0) => {
  const provider = entry.providers[providerIndex];
  const prefix = `${provider}/`;
  const bare = entry.model.startsWith(prefix) ? entry.model.slice(prefix.length) : entry.model;
  return `${provider}/${bare}`;
};

// An injected bridge: the catalog the pipeline sees and the describe the
// pipeline's pick is resolved through are both scripted per test.
const scriptedDeps = ({ catalog = [], connected = [], defaultModel = null, described = {} } = {}) => {
  const describeCalls = [];
  return {
    describeCalls,
    deps: {
      readOverride: () => null,
      listCatalogModels: async () => catalog,
      listConnectedProviders: async () => connected,
      readDefaultModel: async () => defaultModel,
      describe: async (options) => {
        describeCalls.push(options);
        if (described === null) return null;
        const ref = options.overrideModel ?? 'fallback/def-model';
        const slash = ref.indexOf('/');
        return {
          providerID: ref.slice(0, slash),
          modelID: ref.slice(slash + 1),
          source: 'request',
          inputCharBudget: 1_000_000,
          outputTokens: 24_000,
          hasLogin: true,
          structuredOutput: null,
          ...(described instanceof Function ? described(options) : described),
        };
      },
    },
  };
};

describe('buildWalkthroughPipelineRequest', () => {
  it('maps the five slots: override, category, fallback, chain, default', () => {
    const request = buildWalkthroughPipelineRequest({
      explicitModel: 'custom/big-model',
      settingsOverride: 'saved/walk-model',
      providerID: 'anthropic',
      modelID: 'claude-opus-5',
      userFallbackModels: ['user/fallback-1'],
      availableModels: new Set(['anthropic/claude-opus-5']),
      systemDefaultModel: 'anthropic/claude-opus-5',
    });

    expect(request.intent.uiSelectedModel).toBe('custom/big-model');
    expect(request.intent.userModel).toBe('saved/walk-model');
    expect(request.intent.categoryDefaultModel).toBe('anthropic/claude-opus-5');
    expect(request.intent.userFallbackModels).toEqual(['user/fallback-1']);
    expect(request.policy.fallbackChain).toBe(WALKTHROUGH_MODEL_CHAIN);
    expect(request.policy.fallbackChain.length).toBeGreaterThan(0);
    expect(request.policy.systemDefaultModel).toBe('anthropic/claude-opus-5');
  });

  it('forceDowngrade skips the override and category slots', () => {
    const request = buildWalkthroughPipelineRequest({
      explicitModel: 'custom/big-model',
      settingsOverride: 'saved/walk-model',
      providerID: 'anthropic',
      modelID: 'claude-opus-5',
      availableModels: new Set(),
      forceDowngrade: true,
    });

    expect(request.intent.uiSelectedModel).toBeUndefined();
    expect(request.intent.userModel).toBeUndefined();
    expect(request.intent.categoryDefaultModel).toBeUndefined();
    expect(request.policy.fallbackChain).toBe(WALKTHROUGH_MODEL_CHAIN);
  });
});

describe('resolveWalkthroughModel', () => {
  it('resolves the explicit per-review model as an override without consulting the catalog', () => {
    const { deps, describeCalls } = scriptedDeps();
    return resolveWalkthroughModel({
      directory: '/repo',
      explicitModel: 'custom/big-model',
      providerID: 'anthropic',
      modelID: 'claude-opus-5',
      deps,
    }).then((model) => {
      expect(model.providerID).toBe('custom');
      expect(model.modelID).toBe('big-model');
      expect(model.pipeline.provenance).toBe('override');
      expect(isExplicitlyChosenModel(model)).toBe(true);
      // The pipeline short-circuits on the override; the bridge only
      // describes the pick.
      expect(describeCalls).toHaveLength(1);
      expect(describeCalls[0].overrideModel).toBe('custom/big-model');
      expect(describeCalls[0].preferredProviderID).toBe('anthropic');
      expect(describeCalls[0].preferredModelID).toBe('claude-opus-5');
    });
  });

  it('prefers the saved walkthrough setting over the composer model', () => {
    const { deps } = scriptedDeps();
    const withSettings = {
      ...deps,
      readOverride: () => 'saved/walk-model',
    };
    return resolveWalkthroughModel({
      directory: '/repo',
      providerID: 'anthropic',
      modelID: 'claude-opus-5',
      deps: withSettings,
    }).then((model) => {
      expect(`${model.providerID}/${model.modelID}`).toBe('saved/walk-model');
      expect(model.pipeline.provenance).toBe('override');
    });
  });

  it('falls back per chain when the composer model is not available', () => {
    // A bad composer model: listed nowhere, so the category slot misses and
    // the engine chain decides.
    const expected = chainRef(WALKTHROUGH_MODEL_CHAIN[1]);
    const { deps } = scriptedDeps({ catalog: [expected], connected: ['anthropic'] });
    return resolveWalkthroughModel({
      directory: '/repo',
      providerID: 'ghost',
      modelID: 'missing-1',
      deps,
    }).then((model) => {
      expect(`${model.providerID}/${model.modelID}`).toBe(expected);
      expect(model.pipeline.provenance).toBe('provider-fallback');
      expect(isExplicitlyChosenModel(model)).toBe(false);
    });
  });

  it('walks past chain entries nothing serves, in chain order', () => {
    const second = chainRef(WALKTHROUGH_MODEL_CHAIN[1]);
    // Only the second entry's provider/model is listed: the first entry must
    // be skipped, not error.
    const { deps } = scriptedDeps({ catalog: [second], connected: ['anthropic'] });
    return resolveWalkthroughModel({
      directory: '/repo',
      deps,
    }).then((model) => {
      expect(`${model.providerID}/${model.modelID}`).toBe(second);
      expect(model.pipeline.provenance).toBe('provider-fallback');
    });
  });

  it('forceDowngrade resolves from the chain even with an explicit model set', () => {
    const expected = chainRef(WALKTHROUGH_MODEL_CHAIN[0]);
    const { deps } = scriptedDeps({ catalog: [expected], connected: ['openai'] });
    return resolveWalkthroughModel({
      directory: '/repo',
      explicitModel: 'custom/big-model',
      forceDowngrade: true,
      deps,
    }).then((model) => {
      expect(`${model.providerID}/${model.modelID}`).toBe(expected);
      expect(model.pipeline.provenance).toBe('provider-fallback');
    });
  });

  it('honours the OpenCode default only on the composer provider', () => {
    const sameProvider = scriptedDeps({ defaultModel: 'anthropic/claude-haiku-4-5' });
    return resolveWalkthroughModel({
      directory: '/repo',
      providerID: 'anthropic',
      deps: sameProvider.deps,
    }).then((model) => {
      expect(`${model.providerID}/${model.modelID}`).toBe('anthropic/claude-haiku-4-5');
      expect(model.pipeline.provenance).toBe('system-default');
    }).then(() => {
      // Same default, different composer provider: guarded away, and with
      // nothing else visible the pipeline abstains and the bridge tail (here
      // scripted to null) answers null rather than billing another provider.
      const otherProvider = scriptedDeps({ defaultModel: 'anthropic/claude-haiku-4-5', described: null });
      return resolveWalkthroughModel({
        directory: '/repo',
        providerID: 'openai',
        deps: otherProvider.deps,
      });
    }).then((model) => {
      expect(model).toBeNull();
    });
  });

  it('keeps the bridge tail when the catalog is invisible', () => {
    const legacy = {
      providerID: 'anthropic',
      modelID: 'claude-haiku-4-5',
      source: 'config',
      inputCharBudget: 1_000_000,
    };
    const { deps, describeCalls } = scriptedDeps({ described: legacy });
    return resolveWalkthroughModel({
      directory: '/repo',
      providerID: 'anthropic',
      modelID: 'claude-opus-5',
      deps,
    }).then((model) => {
      // No catalog, no connected providers, no default: the pipeline
      // abstains and the bridge's own answer stands, unadorned.
      expect(model).toMatchObject(legacy);
      expect(model.pipeline).toBeUndefined();
      expect(describeCalls[0].overrideModel).toBeUndefined();
      expect(describeCalls[0].preferredProviderID).toBe('anthropic');
    });
  });
});

describe('walkthroughDowngradeRefs', () => {
  it('expands the chain entry-major, skipping the resolved and attempted refs', () => {
    const chain = [
      { providers: ['a', 'b'], model: 'm-one' },
      { providers: ['a'], model: 'a/m-two' },
      { providers: ['c'], model: 'm-three' },
    ];
    const refs = walkthroughDowngradeRefs({
      resolvedRef: 'a/m-one',
      attempted: ['B/M-ONE', 'c/m-three'],
      chain,
    });

    // `B/M-ONE` skips `b/m-one` case-insensitively; `c/m-three` is skipped exactly.
    expect(refs).toEqual(['a/m-two']);
  });

  it('dedupes providers that repeat a model across entries', () => {
    const refs = walkthroughDowngradeRefs({
      resolvedRef: 'x/other',
      chain: [
        { providers: ['a'], model: 'm-one' },
        { providers: ['a', 'b'], model: 'm-one' },
      ],
    });

    expect(refs).toEqual(['a/m-one', 'b/m-one']);
  });
});

describe('isWalkthroughDispatchRetryable', () => {
  it('retries models that cannot serve the request', () => {
    expect(isWalkthroughDispatchRetryable(Object.assign(new Error('gone'), {
      statusCode: 503,
      code: 'small-model-unavailable',
    }))).toBe(true);
    expect(isWalkthroughDispatchRetryable(Object.assign(new Error('no json'), {
      statusCode: 422,
      code: 'structured-output-unsupported',
    }))).toBe(true);
    expect(isWalkthroughDispatchRetryable(Object.assign(new Error('no login'), {
      statusCode: 401,
      code: 'no-provider-login',
    }))).toBe(true);
    expect(isWalkthroughDispatchRetryable({ _tag: 'InvalidRequestError', message: 'cold' })).toBe(true);
  });

  it('never retries abort, budget failures, or explicit opt-outs', () => {
    expect(isWalkthroughDispatchRetryable(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(false);
    expect(isWalkthroughDispatchRetryable(Object.assign(new Error('too big'), {
      statusCode: 413,
      code: 'context-too-small',
    }))).toBe(false);
    expect(isWalkthroughDispatchRetryable(Object.assign(new Error('spent'), {
      statusCode: 409,
      code: 'output-exhausted',
    }))).toBe(false);
    expect(isWalkthroughDispatchRetryable(Object.assign(new Error('no login'), {
      code: 'no-provider-login',
      downgrade: false,
    }))).toBe(false);
    expect(isWalkthroughDispatchRetryable(new Error('plain'))).toBe(false);
    expect(isWalkthroughDispatchRetryable(null)).toBe(false);
  });
});

describe('advanceThroughWalkthroughCandidates', () => {
  it('returns the first success without trying further candidates', async () => {
    const attempts = [];
    const outcome = await advanceThroughWalkthroughCandidates({
      refs: ['a/m-one', 'b/m-two'],
      attempt: async (ref) => {
        attempts.push(ref);
        return `ok:${ref}`;
      },
    });

    expect(outcome).toEqual({ ref: 'a/m-one', result: 'ok:a/m-one', attempted: [] });
    expect(attempts).toEqual(['a/m-one']);
  });

  it('advances past retryable failures in order and reports the attempted refs', async () => {
    const bad = Object.assign(new Error('Model unavailable: a/m-one'), {
      statusCode: 503,
      code: 'small-model-unavailable',
    });
    const outcome = await advanceThroughWalkthroughCandidates({
      refs: ['a/m-one', 'b/m-two', 'c/m-three'],
      attempt: async (ref) => {
        if (ref !== 'c/m-three') throw bad;
        return 'recovered';
      },
    });

    expect(outcome).toEqual({ ref: 'c/m-three', result: 'recovered', attempted: ['a/m-one', 'b/m-two'] });
  });

  it('rethrows a fatal failure at once without trying further candidates', async () => {
    const fatal = Object.assign(new Error('too big'), { statusCode: 413, code: 'context-too-small' });
    const attempts = [];
    await expect(advanceThroughWalkthroughCandidates({
      refs: ['a/m-one', 'b/m-two'],
      attempt: async (ref) => {
        attempts.push(ref);
        throw fatal;
      },
    })).rejects.toBe(fatal);
    expect(attempts).toEqual(['a/m-one']);
  });

  it('never advances past an abort', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const attempts = [];
    await expect(advanceThroughWalkthroughCandidates({
      refs: ['a/m-one', 'b/m-two'],
      attempt: async (ref) => {
        attempts.push(ref);
        throw abort;
      },
    })).rejects.toBe(abort);
    expect(attempts).toEqual(['a/m-one']);
  });

  it('rethrows the last failure with the attempted refs when every candidate is bad', async () => {
    const bad = Object.assign(new Error('gone'), { statusCode: 503, code: 'small-model-unavailable' });
    const thrown = await advanceThroughWalkthroughCandidates({
      refs: ['a/m-one', 'b/m-two'],
      attempt: async () => {
        throw bad;
      },
    }).catch((error) => error);

    expect(thrown).toBe(bad);
    expect(thrown.downgradeAttempted).toEqual(['a/m-one']);
  });
});
