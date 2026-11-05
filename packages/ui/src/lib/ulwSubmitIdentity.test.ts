import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { opencodeClient } from '@/lib/opencode/client';
import { ChildStoreManager } from '@/sync/child-store';
import { setActionRefs, setOptimisticRefs } from '@/sync/session-actions';
import { useConfigStore } from '@/stores/useConfigStore';
import { buildUlwRunProcedure, mintUlwSubmitIdentity, startUlwNativeRun } from './ulwNativeRun';
import { resolveSubmissionIdentity, routeMessage } from '@/sync/session-ui-store';

/**
 * Pending-submission idempotency for ULW run starts.
 *
 * One stable submission identity is minted at the user-gesture boundary
 * before draft-session creation and threaded through draft creation into
 * routeMessage params, which forwards it to startUlwNativeRun as
 * `idempotencyKey`. Concurrent deliveries of the same submission share one
 * root run (and one session creation) even when a race minted two draft
 * sessions with different ids.
 *
 * Mocking follows ulwNativeRun.test.ts and the routeMessage blocks of
 * sync/session-ui-store.test.js: direct assignment on the shared
 * `opencodeClient` singleton (save/restore around each test) plus stub child
 * stores with noop optimistic refs and a connected config store, so the
 * real optimisticSend runs without a mounted sync layer. The prose
 * `<task> ... mass ulw` trigger is used so every send takes the native run
 * path without command-template lookups.
 */

type CreateCall = {
  params: Parameters<typeof opencodeClient.createSession>[0];
  directory: Parameters<typeof opencodeClient.createSession>[1];
};
type SendCall = Parameters<typeof opencodeClient.sendMessage>[0];

const createCalls: CreateCall[] = [];
const sendCalls: SendCall[] = [];

const originalCreateSession = opencodeClient.createSession;
const originalSendMessage = opencodeClient.sendMessage;
const originalIsConnected = useConfigStore.getState().isConnected;

let failNextSend = false;

const ULW_PROSE_CONTENT = 'audit the repo mass ulw';

const sendUlw = (sessionId: string, idempotencyKey?: string) => {
  const base = {
    sessionId,
    directory: '/ulw/project',
    content: ULW_PROSE_CONTENT,
    providerID: 'provider-a',
    modelID: 'model-a',
  };
  if (idempotencyKey === undefined) return routeMessage(base);
  return routeMessage({ ...base, idempotencyKey });
};

const startSubmission = (idempotencyKey: string) => startUlwNativeRun({
  directory: '/ulw/project',
  content: 'ulw brief text',
  args: 'brief text',
  providerID: 'provider-a',
  modelID: 'model-a',
  idempotencyKey,
});

beforeEach(() => {
  createCalls.length = 0;
  sendCalls.length = 0;
  failNextSend = false;

  const childStores = new ChildStoreManager();
  setActionRefs(childStores, () => '/ulw/project');
  childStoresForCleanup = childStores;
  setOptimisticRefs(
    () => {},
    () => {},
  );
  useConfigStore.setState({ isConnected: true });

  opencodeClient.createSession = async (params, directory) => {
    createCalls.push({ params, directory });
    return {
      id: `session-created-${createCalls.length}`,
      projectID: 'project-test',
      directory: directory ?? '/ulw/project',
      title: 'ulw: brief text',
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
      metadata: params?.metadata,
    };
  };
  opencodeClient.sendMessage = async (params) => {
    sendCalls.push(params);
    if (failNextSend) {
      failNextSend = false;
      throw new Error('send offline');
    }
    return 'msg-sent';
  };
});

let childStoresForCleanup: ChildStoreManager | null = null;

afterEach(() => {
  opencodeClient.createSession = originalCreateSession;
  opencodeClient.sendMessage = originalSendMessage;
  useConfigStore.setState({ isConnected: originalIsConnected });
  childStoresForCleanup?.disposeAll();
  childStoresForCleanup = null;
});

describe('one pending submission shares one root run', () => {
  test('(1) two rapid sends from the same pending composer submission share one root run', async () => {
    const [first, second] = await Promise.all([
      sendUlw('draft-1', 'sub-same-1'),
      sendUlw('draft-1', 'sub-same-1'),
    ]);

    expect(first).toBe('command');
    expect(second).toBe('command');
    expect(createCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].id).toBe('draft-1');
    expect(sendCalls[0].text).toBe('audit the repo');
  });

  test('(2) two draft sessions accidentally created for that same submission still share one root run', async () => {
    const [first, second] = await Promise.all([
      sendUlw('draft-A', 'sub-same-2'),
      sendUlw('draft-B', 'sub-same-2'),
    ]);

    expect(first).toBe('command');
    expect(second).toBe('command');
    expect(createCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].id).toBe('draft-A');
  });

  test('(3) a retry after a failed send reuses the same submission identity', async () => {
    failNextSend = true;
    await expect(sendUlw('draft-retry', 'sub-retry-1')).rejects.toThrow('send offline');

    const decision = await sendUlw('draft-retry', 'sub-retry-1');

    expect(decision).toBe('command');
    expect(createCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(2);
    expect(sendCalls[1].id).toBe('draft-retry');
    expect(sendCalls[1].text).toBe('audit the repo');
  });

  test('(4) two intentional sequential submissions with identical text create two runs', async () => {
    const first = await sendUlw('seq-1');
    const second = await sendUlw('seq-2');

    expect(first).toBe('command');
    expect(second).toBe('command');
    expect(createCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(2);
    expect(sendCalls[0].id).toBe('seq-1');
    expect(sendCalls[1].id).toBe('seq-2');
    expect(sendCalls[0].text).toBe('audit the repo');
    expect(sendCalls[1].text).toBe('audit the repo');
  });

  test('(5) two concurrent independent submissions create two runs', async () => {
    const [first, second] = await Promise.all([
      sendUlw('indep-1', 'sub-indep-1'),
      sendUlw('indep-2', 'sub-indep-2'),
    ]);

    expect(first).toBe('command');
    expect(second).toBe('command');
    expect(createCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(2);
  });
});

describe('one submission means one session creation', () => {
  test('concurrent deliveries sharing one key create exactly one session and one root run', async () => {
    const [first, second] = await Promise.all([
      startSubmission('sub-create-1'),
      startSubmission('sub-create-1'),
    ]);

    expect(first.sessionId).toBe(second.sessionId);
    expect(first.runId).toBe(second.runId);
    expect(createCalls).toHaveLength(1);
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].id).toBe(first.sessionId);
  });

  test('a completed submission never blocks a later intentional one on the same key', async () => {
    const first = await startSubmission('sub-reuse-1');
    const second = await startSubmission('sub-reuse-1');

    expect(first.sessionId).not.toBe(second.sessionId);
    expect(createCalls).toHaveLength(2);
    expect(sendCalls).toHaveLength(2);
  });
});

describe('submission identity stability', () => {
  test('an explicit key passes through so retries reuse the submission identity', () => {
    expect(resolveSubmissionIdentity('sub-explicit-1', 71001)).toBe('sub-explicit-1');
  });

  test('the same open draft resolves the same identity, never a fresh key per click', () => {
    const first = resolveSubmissionIdentity(undefined, 71002);
    const second = resolveSubmissionIdentity(undefined, 71002);

    expect(first).toBe(second);
    expect(first.startsWith('ulw-submit-')).toBe(true);
  });

  test('different drafts mint different identities even with identical text', () => {
    const first = resolveSubmissionIdentity(undefined, 71003);
    const second = resolveSubmissionIdentity(undefined, 71004);

    expect(first).not.toBe(second);
  });

  test('mintUlwSubmitIdentity mints a unique ulw-submit- key per call', () => {
    const first = mintUlwSubmitIdentity();
    const second = mintUlwSubmitIdentity();

    expect(first.startsWith('ulw-submit-')).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe('run procedure carries the submission identity', () => {
  test('a run started with an identity names it as the goal-create submissionId', () => {
    const withKey = buildUlwRunProcedure('run-1', 'ulw-submit-abc');

    expect(withKey).toContain('ulw-submit-abc');
    expect(withKey).toContain('submissionId');
  });

  test('a run started without an identity keeps the procedure unchanged', () => {
    const withoutKey = buildUlwRunProcedure('run-1');

    expect(withoutKey).not.toContain('submissionId');
    expect(withoutKey).toContain('ulw_goal_create');
  });
});
