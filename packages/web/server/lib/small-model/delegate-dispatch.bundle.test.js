// Bundle coverage for the delegate-task guard: the committed
// `delegate-dispatch.bundle.js` preserves the source's validation, chain
// resolution, and forced-downgrade path, and the runtime chain stays
// bundle-only so the packaged app (plain Node, no transpile step) never
// resolves engine `.ts`.
// Imports `bun:test` so the file runs under both `bun test` and the repo's
// vitest runner. Nothing here imports engine `.ts` directly.
import { describe, expect, it } from 'bun:test';
import {
  advanceThroughDelegateCandidates,
  delegateDowngradeRefs,
  isDelegateDispatchRetryable,
  resolveDelegateModel,
  validateDelegateTaskCall,
} from './delegate-dispatch.bundle.js';

describe('delegate-dispatch bundle preserves call-shape self-correction', () => {
  it('accepts a well-formed task() call', () => {
    const result = validateDelegateTaskCall({
      description: 'Summarize the diff',
      prompt: 'Summarize these changes in one line.',
      category: 'quick',
      run_in_background: true,
      load_skills: [],
    });

    expect(result.ok).toBe(true);
  });

  it('returns the engine fix hint plus a corrected example for a malformed call', () => {
    const result = validateDelegateTaskCall({
      description: 'Summarize the diff',
      prompt: 'Summarize these changes in one line.',
      category: 'quick',
    });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('missing_run_in_background');
    expect(result.guidance).toContain('run_in_background=true');
    expect(result.guidance).toContain('Example of CORRECT call');
    expect(result.guidance).toContain('task(');
  });
});

describe('delegate-dispatch bundle preserves chain resolution and downgrade', () => {
  it('resolves delegated work through the fallback chain', () => {
    const chain = [
      { providers: ['anthropic'], model: 'claude-opus-5' },
      { providers: ['openai'], model: 'gpt-5.4', variant: 'medium' },
    ];
    const result = resolveDelegateModel(
      { availableModels: new Set(['openai/gpt-5.4']), fallbackChain: chain },
      { connectedProviders: null, hasProviderModelsCache: false, hasConnectedProvidersCache: false },
    );

    expect(result).toEqual({
      model: 'openai/gpt-5.4',
      variant: 'medium',
      fallbackEntry: chain[1],
      matchedFallback: true,
    });
  });

  it('orders downgrade refs down the chain past the failed model', () => {
    const refs = delegateDowngradeRefs({
      resolvedRef: 'bad/ghost-1',
      fallbackChain: [
        { providers: ['anthropic'], model: 'claude-haiku-4-5' },
        { providers: ['openai'], model: 'gpt-5.6-luna' },
      ],
    });

    expect(refs).toEqual(['anthropic/claude-haiku-4-5', 'openai/gpt-5.6-luna']);
  });

  it('advances past a retryable dispatch failure', async () => {
    const outcome = await advanceThroughDelegateCandidates({
      refs: ['bad/ghost-1', 'anthropic/claude-haiku-4-5'],
      attempt: async (ref) => {
        if (ref.startsWith('bad/')) {
          throw Object.assign(new Error('Model unavailable: bad/ghost-1'), { statusCode: 503 });
        }
        return { text: 'ok' };
      },
      shouldRetry: isDelegateDispatchRetryable,
    });

    expect(outcome.ref).toBe('anthropic/claude-haiku-4-5');
    expect(outcome.attempted).toEqual(['bad/ghost-1']);
  });
});
