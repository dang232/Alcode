import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Metadata, Session } from '@/lib/opencode/model';
import { opencodeClient } from '@/lib/opencode/client';
import { ChildStoreManager } from '@/sync/child-store';
import { setActionRefs, setOptimisticRefs } from '@/sync/session-actions';
import { useConfigStore } from '@/stores/useConfigStore';
import {
  ULW_COMMAND_NAME,
  ULW_RESUME_EMPTY_BRIEF,
  ULW_RUN_METADATA_KEY,
  buildUlwRunProcedure,
  splitUlwResumeTarget,
  startUlwNativeRun,
} from './ulwNativeRun';

/**
 * Unit tests for the native ULW run path (startUlwNativeRun + procedure).
 *
 * Mocking follows src/sync/session-ui-store.test.js: direct assignment on the
 * shared `opencodeClient` singleton (save/restore around each test) plus a
 * real ChildStoreManager with noop optimistic refs and a connected config
 * store, so the real `optimisticSend` runs without a mounted sync layer.
 */

type CreateCall = {
  params: Parameters<typeof opencodeClient.createSession>[0];
  directory: Parameters<typeof opencodeClient.createSession>[1];
};
type SendCall = Parameters<typeof opencodeClient.sendMessage>[0];
type ShellCall = Parameters<typeof opencodeClient.shellSession>[0];

const createCalls: CreateCall[] = [];
const sendCalls: SendCall[] = [];
const shellCalls: ShellCall[] = [];

const originalCreateSession = opencodeClient.createSession;
const originalSendMessage = opencodeClient.sendMessage;
const originalShellSession = opencodeClient.shellSession;
const originalIsConnected = useConfigStore.getState().isConnected;

let childStores: ChildStoreManager | null = null;

const makeSession = (id: string, directory: string, metadata?: Metadata): Session => ({
  id,
  projectID: 'project-test',
  directory,
  title: 'ulw: test',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  metadata,
});

const contextTexts = (call: SendCall): string =>
  ((call.context ?? []) as Array<{ text?: string }>).map((part) => part.text ?? '').join('\n');

beforeEach(() => {
  createCalls.length = 0;
  sendCalls.length = 0;
  shellCalls.length = 0;

  childStores = new ChildStoreManager();
  setActionRefs(childStores, () => '/ulw/project');
  setOptimisticRefs(
    () => {},
    () => {},
  );
  useConfigStore.setState({ isConnected: true });

  opencodeClient.createSession = async (params, directory) => {
    createCalls.push({ params, directory });
    return makeSession(
      'session-run-1',
      typeof directory === 'string' ? directory : '/ulw/project',
      params?.metadata,
    );
  };
  opencodeClient.sendMessage = async (params) => {
    sendCalls.push(params);
    return 'msg-sent';
  };
  opencodeClient.shellSession = async (params) => {
    shellCalls.push(params);
    return 'msg-shell';
  };
});

afterEach(() => {
  opencodeClient.createSession = originalCreateSession;
  opencodeClient.sendMessage = originalSendMessage;
  opencodeClient.shellSession = originalShellSession;
  useConfigStore.setState({ isConnected: originalIsConnected });
  childStores?.disposeAll();
  childStores = null;
});

const baseInput = (overrides: Partial<Parameters<typeof startUlwNativeRun>[0]> = {}) => ({
  directory: '/ulw/project' as const,
  content: 'ulw analyze this repo',
  args: 'analyze this repo',
  providerID: 'provider-a',
  modelID: 'model-a',
  ...overrides,
});

describe('adopt-preferred: a send session means zero createSession calls', () => {
  test('sessionId given adopts the session with runId equal to sessionId', async () => {
    const result = await startUlwNativeRun(baseInput({ sessionId: 'session-adopted' }));

    expect(createCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(1);
    expect(shellCalls).toHaveLength(0);
    expect(result).toEqual({ sessionId: 'session-adopted', runId: 'session-adopted', resumed: false });
    expect(sendCalls[0].id).toBe('session-adopted');
    expect(sendCalls[0].text).toBe('analyze this repo');
    expect(sendCalls[0].directory).toBe('/ulw/project');
  });

  test('adopted send still carries the native procedure, not a CLI appendix', async () => {
    const result = await startUlwNativeRun(baseInput({ sessionId: 'session-adopted' }));

    expect(createCalls).toHaveLength(0);
    const text = contextTexts(sendCalls[0]);
    expect(text).toContain('ulw_goal_create');
    expect(text).toContain('ulw_checkpoint');
    expect(text).toContain(result.runId);
  });
});

describe('create-fallback: no sessionId means exactly one create with metadata ulwRunId', () => {
  test('creates one run session keyed by minted ulwRunId metadata', async () => {
    const result = await startUlwNativeRun(baseInput());

    expect(createCalls).toHaveLength(1);
    expect(sendCalls).toHaveLength(1);
    expect(shellCalls).toHaveLength(0);
    const metadata = createCalls[0].params?.metadata?.alcode as Record<string, string> | undefined;
    const runId = metadata?.[ULW_RUN_METADATA_KEY];
    expect(ULW_RUN_METADATA_KEY).toBe('ulwRunId');
    expect(runId).toMatch(/^ulw-/);
    expect(result.runId).toBe(runId);
    expect(result.sessionId).toBe('session-run-1');
    expect(result.resumed).toBe(false);
    expect(sendCalls[0].id).toBe('session-run-1');
    expect(sendCalls[0].text).toBe('analyze this repo');
    expect(String(createCalls[0].params?.title)).toMatch(/^ulw: /);
  });

  test('a creation failure throws loudly and sends nothing', async () => {
    opencodeClient.createSession = async (params, directory) => {
      createCalls.push({ params, directory });
      throw new Error('offline');
    };

    await expect(startUlwNativeRun(baseInput())).rejects.toThrow('Failed to create ulw run');
    expect(sendCalls).toHaveLength(0);
    expect(shellCalls).toHaveLength(0);
  });

  test('a creation with no session id throws loudly and sends nothing', async () => {
    opencodeClient.createSession = async (params, directory) => {
      createCalls.push({ params, directory });
      return makeSession('', '/ulw/project', params?.metadata);
    };

    await expect(startUlwNativeRun(baseInput())).rejects.toThrow('server returned no session');
    expect(sendCalls).toHaveLength(0);
  });
});

describe('resume-flag paths name the existing session and skip creation', () => {
  test('splitUlwResumeTarget accepts every flag alias and the leading form', () => {
    expect(splitUlwResumeTarget('--resume session-old do more')).toEqual({
      sessionId: 'session-old',
      rest: 'do more',
    });
    expect(splitUlwResumeTarget('--run session-old do more')).toEqual({
      sessionId: 'session-old',
      rest: 'do more',
    });
    expect(splitUlwResumeTarget('--run-id session-old do more')).toEqual({
      sessionId: 'session-old',
      rest: 'do more',
    });
    expect(splitUlwResumeTarget('--session-id session-old do more')).toEqual({
      sessionId: 'session-old',
      rest: 'do more',
    });
    expect(splitUlwResumeTarget('--resume=session-old do more')).toEqual({
      sessionId: 'session-old',
      rest: 'do more',
    });
    expect(splitUlwResumeTarget('--session-id=session-old do more')).toEqual({
      sessionId: 'session-old',
      rest: 'do more',
    });
    expect(splitUlwResumeTarget('resume session-old do more')).toEqual({
      sessionId: 'session-old',
      rest: 'do more',
    });
    expect(splitUlwResumeTarget('analyze this repo')).toBeNull();
  });

  test('--resume sends into the named session without creating', async () => {
    const result = await startUlwNativeRun(
      baseInput({ args: '--resume session-old do more', content: 'ulw --resume session-old do more' }),
    );

    expect(createCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(1);
    expect(shellCalls).toHaveLength(0);
    expect(result).toEqual({ sessionId: 'session-old', runId: 'session-old', resumed: true });
    expect(sendCalls[0].id).toBe('session-old');
    expect(sendCalls[0].text).toBe('do more');
  });

  test('--session-id= form resumes with a clean brief', async () => {
    const result = await startUlwNativeRun(baseInput({ args: '--session-id=session-old do more' }));

    expect(createCalls).toHaveLength(0);
    expect(result).toEqual({ sessionId: 'session-old', runId: 'session-old', resumed: true });
    expect(sendCalls[0].id).toBe('session-old');
    expect(sendCalls[0].text).toBe('do more');
  });

  test('leading resume form resumes the named session', async () => {
    const result = await startUlwNativeRun(baseInput({ args: 'resume session-old do more' }));

    expect(createCalls).toHaveLength(0);
    expect(result).toEqual({ sessionId: 'session-old', runId: 'session-old', resumed: true });
    expect(sendCalls[0].text).toBe('do more');
  });

  test('resume wins over an adopted send session and still creates nothing', async () => {
    const result = await startUlwNativeRun(
      baseInput({ sessionId: 'session-adopted', args: '--resume session-old do more' }),
    );

    expect(createCalls).toHaveLength(0);
    expect(result).toEqual({ sessionId: 'session-old', runId: 'session-old', resumed: true });
    expect(sendCalls[0].id).toBe('session-old');
  });

  test('resume with no goal text falls back to the empty-resume brief and ignores content', async () => {
    const result = await startUlwNativeRun(
      baseInput({ args: '--resume session-old', content: 'body that must be ignored' }),
    );

    expect(createCalls).toHaveLength(0);
    expect(result.resumed).toBe(true);
    expect(sendCalls[0].id).toBe('session-old');
    expect(sendCalls[0].text).toBe(ULW_RESUME_EMPTY_BRIEF);
    expect(ULW_RESUME_EMPTY_BRIEF).toBe('Continue the run.');
  });
});

describe('procedure text names native tools and forbids CLI shell-outs', () => {
  test('names ulw_goal_create/ulw_dispatch/ulw_evidence/ulw_checkpoint/ulw_complete and embeds the run id', () => {
    const procedure = buildUlwRunProcedure('session-run-1');

    expect(procedure).toContain('session-run-1');
    expect(procedure).toContain('ulw_goal_create');
    expect(procedure).toContain('ulw_dispatch');
    expect(procedure).toContain('ulw_evidence');
    expect(procedure).toContain('ulw_checkpoint');
    expect(procedure).toContain('ulw_complete');
  });

  test('forbids shelling out to the ulw-loop CLI instead of teaching argv', () => {
    const procedure = buildUlwRunProcedure('session-run-1');

    expect(procedure).toMatch(/never shell out/i);
    expect(procedure).toContain('ulw-loop');
    expect(procedure).not.toContain('argv');
    expect(procedure).not.toContain('child_process');
    expect(procedure).not.toContain('exec(');
  });

  test('the opening prompt carries the procedure and never shells out', async () => {
    const result = await startUlwNativeRun(baseInput({ sessionId: 'session-adopted' }));

    expect(shellCalls).toHaveLength(0);
    const text = contextTexts(sendCalls[0]);
    expect(text).toContain(buildUlwRunProcedure(result.runId));
    expect(text).toContain('ulw_goal_create');
    expect(text).toContain('ulw_dispatch');
    expect(text).toContain('ulw_evidence');
    expect(text).toContain('ulw_checkpoint');
    expect(text).toContain('ulw_complete');
  });

  test('ulw command name constant keeps the native path standing in for /ulw', () => {
    expect(ULW_COMMAND_NAME).toBe('ulw');
  });
});

describe('brief selection: args vs content vs empty', () => {
  test('non-empty args win over content', async () => {
    await startUlwNativeRun(
      baseInput({ sessionId: 'session-adopted', args: 'goal from args', content: 'fallback body' }),
    );

    expect(createCalls).toHaveLength(0);
    expect(sendCalls[0].text).toBe('goal from args');
  });

  test('empty args fall back to content', async () => {
    await startUlwNativeRun(baseInput({ sessionId: 'session-adopted', args: '', content: 'fallback body' }));

    expect(sendCalls[0].text).toBe('fallback body');
  });

  test('whitespace-only args fall back to content', async () => {
    await startUlwNativeRun(
      baseInput({ sessionId: 'session-adopted', args: '   ', content: 'fallback body' }),
    );

    expect(sendCalls[0].text).toBe('fallback body');
  });

  test('empty args and empty content use the empty-resume brief', async () => {
    await startUlwNativeRun(baseInput({ sessionId: 'session-adopted', args: '', content: '' }));

    expect(sendCalls[0].text).toBe(ULW_RESUME_EMPTY_BRIEF);
  });

  test('empty args and whitespace content use the empty-resume brief', async () => {
    await startUlwNativeRun(baseInput({ sessionId: 'session-adopted', args: '', content: '   ' }));

    expect(sendCalls[0].text).toBe(ULW_RESUME_EMPTY_BRIEF);
  });

  test('create-fallback path sends the content fallback as the brief', async () => {
    await startUlwNativeRun(baseInput({ args: '', content: 'fallback body' }));

    expect(createCalls).toHaveLength(1);
    expect(sendCalls[0].text).toBe('fallback body');
  });
});
