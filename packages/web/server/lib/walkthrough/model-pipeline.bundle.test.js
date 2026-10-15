// Bundle coverage for the walkthrough model pipeline: the committed
// `model-pipeline.bundle.js` preserves the source's five-slot mapping and
// forced-downgrade path, and the runtime chain stays bundle-only so the
// packaged app (plain Node, no transpile step) never resolves engine `.ts`.
// Imports `bun:test` so the file runs under both `bun test` and the repo's
// vitest runner. Nothing here imports engine `.ts` directly.
import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  advanceThroughWalkthroughCandidates,
  buildWalkthroughPipelineRequest,
  isWalkthroughDispatchRetryable,
  resolveWalkthroughModel,
  WALKTHROUGH_MODEL_CHAIN,
  walkthroughDowngradeRefs,
} from './model-pipeline.bundle.js';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

const chainRef = (entry, providerIndex = 0) => {
  const provider = entry.providers[providerIndex];
  const prefix = `${provider}/`;
  const bare = entry.model.startsWith(prefix) ? entry.model.slice(prefix.length) : entry.model;
  return `${provider}/${bare}`;
};

const scriptedDeps = ({ catalog = [], connected = [], defaultModel = null, described = {} } = {}) => ({
  deps: {
    readOverride: () => null,
    listCatalogModels: async () => catalog,
    listConnectedProviders: async () => connected,
    readDefaultModel: async () => defaultModel,
    describe: async (options) => {
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
        ...(typeof described === 'function' ? described(options) : described),
      };
    },
  },
});

describe('walkthrough bundle preserves the five-slot mapping', () => {
  it('maps override, category, fallback, chain, default', () => {
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

describe('walkthrough bundle forced-downgrade path', () => {
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

  it('forceDowngrade returns null when the chain resolves nothing', () => {
    const { deps } = scriptedDeps({ described: null });
    return resolveWalkthroughModel({
      directory: '/repo',
      explicitModel: 'custom/big-model',
      forceDowngrade: true,
      deps,
    }).then((model) => {
      // Must not resurrect the skipped override through the legacy tail.
      expect(model).toBeNull();
    });
  });

  it('downgrade refs skip the resolved and attempted refs', () => {
    const refs = walkthroughDowngradeRefs({
      resolvedRef: chainRef(WALKTHROUGH_MODEL_CHAIN[0]),
      attempted: [],
    });
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.includes(chainRef(WALKTHROUGH_MODEL_CHAIN[0]))).toBe(false);
  });

  it('advances past retryable dispatch failures and reports the attempted refs', async () => {
    const bad = Object.assign(new Error('Model unavailable: a/m-one'), {
      statusCode: 503,
      code: 'small-model-unavailable',
    });
    expect(isWalkthroughDispatchRetryable(bad)).toBe(true);
    const outcome = await advanceThroughWalkthroughCandidates({
      refs: ['a/m-one', 'b/m-two'],
      attempt: async (ref) => {
        if (ref !== 'b/m-two') throw bad;
        return 'recovered';
      },
    });
    expect(outcome).toEqual({ ref: 'b/m-two', result: 'recovered', attempted: ['a/m-one'] });
  });
});

describe('walkthrough runtime chain stays on the bundle', () => {
  it('index.js imports the bundle, never the source or engine `.ts`', () => {
    const entry = fs.readFileSync(path.join(thisDir, 'index.js'), 'utf8');
    expect(entry.includes("from './model-pipeline.bundle.js'")).toBe(true);
    expect(entry.includes("from './model-pipeline.js'")).toBe(false);
    for (const file of ['index.js', 'model-pipeline.bundle.js', 'model-pipeline.bundle.test.js']) {
      const text = fs.readFileSync(path.join(thisDir, file), 'utf8');
      const tsImports = [...text.matchAll(/from\s*["']([^"']+\.ts)["']/g)].map((match) => match[1]);
      expect(tsImports).toEqual([]);
    }
  });

  it('the bundle inlines engine TypeScript and keeps only shared plain-JS bridge imports', () => {
    const bundleText = fs.readFileSync(path.join(thisDir, 'model-pipeline.bundle.js'), 'utf8');
    const specifiers = [
      ...bundleText.matchAll(/from\s*["']([^"']+)["']/g),
      ...bundleText.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      const safe = spec.startsWith('node:')
        || spec === '../small-model/index.js'
        || spec === '../small-model/client.js'
        || spec === './model-settings.js';
      expect(safe).toBe(true);
    }
  });
});
