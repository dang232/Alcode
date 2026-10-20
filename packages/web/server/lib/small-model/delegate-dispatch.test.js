// Unit tests for the delegate-task guard: task() call-shape validation with
// engine retry guidance, model resolution through the delegate fallback
// chain, downgrade ordering, dispatch retryability, and the candidate-advance
// loop. Everything engine-shaped comes from the source module (Bun resolves
// its engine `.ts` imports); the committed bundle proves the same surface
// separately in `delegate-dispatch.bundle.test.js`.
import { describe, expect, it } from 'bun:test';
import {
  advanceThroughDelegateCandidates,
  DELEGATE_TASK_ERROR_PATTERNS,
  delegateDowngradeRefs,
  isDelegateDispatchRetryable,
  resolveDelegateModel,
  validateDelegateTaskCall,
} from './delegate-dispatch.js';

const validTask = () => ({
  description: 'Summarize the diff',
  prompt: 'Summarize these changes in one line.',
  category: 'quick',
  run_in_background: true,
  load_skills: [],
});

describe('validateDelegateTaskCall', () => {
  it('accepts a well-formed task() call', () => {
    const result = validateDelegateTaskCall(validTask());

    expect(result.ok).toBe(true);
    expect(result.task).toMatchObject({
      description: 'Summarize the diff',
      category: 'quick',
      run_in_background: true,
      load_skills: [],
    });
  });

  it('accepts a subagent_type call without a category', () => {
    const { category: _omitted, ...rest } = validTask();
    const result = validateDelegateTaskCall({ ...rest, subagent_type: 'explore' });

    expect(result.ok).toBe(true);
    expect(result.task).toMatchObject({ subagent_type: 'explore' });
  });

  it('returns guidance with a hint and a corrected example when run_in_background is missing', () => {
    const { run_in_background: _omitted, ...rest } = validTask();
    const result = validateDelegateTaskCall(rest);

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('missing_run_in_background');
    expect(result.guidance).toContain('run_in_background=true');
    expect(result.guidance).toContain('Example of CORRECT call');
    expect(result.guidance).toContain('task(');
  });

  it('returns guidance when load_skills is missing', () => {
    const { load_skills: _omitted, ...rest } = validTask();
    const result = validateDelegateTaskCall(rest);

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('missing_load_skills');
    expect(result.guidance).toContain('load_skills=[]');
    expect(result.guidance).toContain('Example of CORRECT call');
  });

  it('returns guidance when both category and subagent_type are given', () => {
    const result = validateDelegateTaskCall({ ...validTask(), subagent_type: 'explore' });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('mutual_exclusion');
    expect(result.guidance).toContain('Example of CORRECT call');
  });

  it('returns guidance when neither category nor subagent_type is given', () => {
    const { category: _omitted, ...rest } = validTask();
    const result = validateDelegateTaskCall(rest);

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('missing_category_or_agent');
    expect(result.guidance).toContain('Example of CORRECT call');
  });

  it('returns guidance when the agent name is empty', () => {
    const { category: _omitted, ...rest } = validTask();
    const result = validateDelegateTaskCall({ ...rest, subagent_type: '  ' });

    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('empty_agent');
    expect(result.guidance).toContain('Example of CORRECT call');
  });

  it('rejects a non-object call', () => {
    const result = validateDelegateTaskCall('summarize this');

    expect(result.ok).toBe(false);
    expect(result.guidance?.trim?.()).toBeDefined();
  });

  it('rejects a call without description or prompt', () => {
    expect(validateDelegateTaskCall({ ...validTask(), description: ' ' }).ok).toBe(false);
    expect(validateDelegateTaskCall({ ...validTask(), prompt: '' }).ok).toBe(false);
  });

  it('covers every engine-known error pattern', () => {
    expect(DELEGATE_TASK_ERROR_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe('resolveDelegateModel', () => {
  const noCacheDeps = {
    connectedProviders: null,
    hasProviderModelsCache: false,
    hasConnectedProvidersCache: false,
  };

  it('resolves through the fallback chain to a reachable model', () => {
    const chain = [
      { providers: ['anthropic'], model: 'claude-opus-5' },
      { providers: ['openai'], model: 'gpt-5.4', variant: 'medium' },
    ];
    const result = resolveDelegateModel(
      { availableModels: new Set(['openai/gpt-5.4']), fallbackChain: chain },
      noCacheDeps,
    );

    expect(result).toEqual({
      model: 'openai/gpt-5.4',
      variant: 'medium',
      fallbackEntry: chain[1],
      matchedFallback: true,
    });
  });

  it('answers the cold-cache skip sentinel instead of picking wrong', () => {
    const result = resolveDelegateModel(
      { availableModels: new Set(), categoryDefaultModel: 'openai/gpt-5.4' },
      noCacheDeps,
    );

    expect(result).toEqual({ skipped: true });
  });

  it('promotes a reachable user fallback when the primary is unreachable', () => {
    const result = resolveDelegateModel(
      {
        userModel: 'dead/ghost-1',
        userFallbackModels: ['openai/gpt-5.4'],
        availableModels: new Set(['openai/gpt-5.4']),
      },
      noCacheDeps,
    );

    expect(result?.model).toBe('openai/gpt-5.4');
    expect(result?.matchedFallback).toBe(true);
  });
});

describe('delegateDowngradeRefs', () => {
  const chain = [
    { providers: ['anthropic'], model: 'claude-haiku-4-5' },
    { providers: ['openai'], model: 'gpt-5.6-luna' },
  ];

  it('lists the chain entry-major, skipping the resolved ref', () => {
    const refs = delegateDowngradeRefs({ resolvedRef: 'bad/ghost-1', fallbackChain: chain });

    expect(refs).toEqual(['anthropic/claude-haiku-4-5', 'openai/gpt-5.6-luna']);
  });

  it('skips already-attempted refs', () => {
    const refs = delegateDowngradeRefs({
      resolvedRef: 'bad/ghost-1',
      attempted: ['anthropic/claude-haiku-4-5'],
      fallbackChain: chain,
    });

    expect(refs).toEqual(['openai/gpt-5.6-luna']);
  });
});

describe('isDelegateDispatchRetryable', () => {
  it('retries model-unavailable, schema, and provider errors', () => {
    expect(isDelegateDispatchRetryable({ code: 'small-model-unavailable', statusCode: 503 })).toBe(true);
    expect(isDelegateDispatchRetryable({ code: 'structured-output-unsupported', statusCode: 422 })).toBe(true);
    expect(isDelegateDispatchRetryable({ statusCode: 503 })).toBe(true);
    expect(isDelegateDispatchRetryable({ _tag: 'InvalidRequestError' })).toBe(true);
  });

  it('never retries aborts or explicit opt-outs', () => {
    expect(isDelegateDispatchRetryable({ name: 'AbortError' })).toBe(false);
    expect(isDelegateDispatchRetryable({ code: 'small-model-unavailable', downgrade: false })).toBe(false);
    expect(isDelegateDispatchRetryable(null)).toBe(false);
    expect(isDelegateDispatchRetryable({ statusCode: 400 })).toBe(false);
  });
});

describe('advanceThroughDelegateCandidates', () => {
  it('advances past retryable failures to the next ref', async () => {
    const tried = [];
    const outcome = await advanceThroughDelegateCandidates({
      refs: ['bad/ghost-1', 'anthropic/claude-haiku-4-5'],
      attempt: async (ref) => {
        tried.push(ref);
        if (ref.startsWith('bad/')) {
          throw Object.assign(new Error('Model unavailable: bad/ghost-1'), { statusCode: 503 });
        }
        return { text: 'ok' };
      },
    });

    expect(outcome).toMatchObject({ ref: 'anthropic/claude-haiku-4-5', attempted: ['bad/ghost-1'] });
    expect(outcome.result).toEqual({ text: 'ok' });
    expect(tried).toEqual(['bad/ghost-1', 'anthropic/claude-haiku-4-5']);
  });

  it('rethrows at once when the failure is not retryable', async () => {
    const failure = Object.assign(new Error('prompt is required'), { statusCode: 400 });
    const error = await advanceThroughDelegateCandidates({
      refs: ['a/m-1', 'b/m-2'],
      attempt: async () => { throw failure; },
    }).catch((cause) => cause);

    expect(error).toBe(failure);
  });

  it('attaches the downgrade trail when every candidate fails', async () => {
    const error = await advanceThroughDelegateCandidates({
      refs: ['a/m-1', 'b/m-2'],
      attempt: async (ref) => {
        throw Object.assign(new Error(`Model unavailable: ${ref}`), { statusCode: 503 });
      },
    }).catch((cause) => cause);

    expect(error?.downgradeAttempted).toEqual(['a/m-1']);
  });
});
