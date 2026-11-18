// Client contract for the run-graph attribution index.
//
// Proves the parser keeps only the child-session slice, forwards the abort
// signal, and distinguishes "no task records yet" from a failed or malformed
// read. A failure must never read as an empty index.
import { afterEach, describe, expect, test } from 'bun:test';

import type { JsonValue } from '@alcode/sdk';

import { fetchDagAttributionIndex } from './runGraphApi';

const originalFetch = globalThis.fetch;
const requests: { url: string; init: RequestInit | undefined }[] = [];

const serve = (response: Response) => {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push({ url, init });
    return response;
  };
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  requests.length = 0;
});

const indexPayload = (byChildSessionId: { [childSessionId: string]: JsonValue }) => Response.json({
  absent: false,
  entries: [],
  byChildSessionId,
  byTaskId: {},
  collisions: [],
});

describe('fetchDagAttributionIndex', () => {
  test('reads the child-session slice for the requested project and forwards the signal', async () => {
    serve(indexPayload({
      ses_a: { taskId: 'st_a', nodeId: 'node_alpha', runId: 'run_alpha' },
    }));
    const controller = new AbortController();

    const outcome = await fetchDagAttributionIndex('/repo', { signal: controller.signal });

    expect(outcome).toEqual({
      kind: 'index',
      index: { ses_a: { taskId: 'st_a', nodeId: 'node_alpha' } },
    });
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]?.url ?? '', 'http://localhost');
    expect(url.pathname).toBe('/api/run-graph/attribution');
    expect(url.searchParams.get('directory')).toBe('/repo');
    expect(requests[0]?.init?.signal).toBe(controller.signal);
  });

  test('a record without a DAG owner carries taskId only, never a guessed nodeId', async () => {
    serve(indexPayload({ ses_b: { taskId: 'st_b' } }));

    const outcome = await fetchDagAttributionIndex('/repo');

    if (outcome.kind !== 'index') throw new Error(`expected an index, got ${outcome.kind}`);
    const claim = outcome.index.ses_b;
    if (!claim) throw new Error('fixture must index ses_b');
    expect(claim.taskId).toBe('st_b');
    expect(Object.hasOwn(claim, 'nodeId')).toBe(false);
  });

  test('a project with no task records answers absence, not an empty success', async () => {
    serve(Response.json(
      { absent: true, error: 'no attribution state for directory: /repo', code: 'ATTRIBUTION_STATE_ABSENT' },
      { status: 404 },
    ));

    expect(await fetchDagAttributionIndex('/repo')).toEqual({
      kind: 'absent',
      reason: 'No attribution state for directory /repo',
    });
  });

  test('a failed read keeps the server error instead of looking like no attribution', async () => {
    serve(Response.json(
      { error: 'attribution state: task record malformed for bad.json', code: 'ATTRIBUTION_STATE_UNAVAILABLE' },
      { status: 500 },
    ));

    const outcome = await fetchDagAttributionIndex('/repo');

    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') throw new Error('expected an error outcome');
    expect(outcome.reason).toContain('attribution state: task record malformed');
  });

  test('a network failure becomes an explicit error', async () => {
    globalThis.fetch = async () => {
      throw new Error('socket closed');
    };

    const outcome = await fetchDagAttributionIndex('/repo');

    expect(outcome).toEqual({ kind: 'error', reason: 'socket closed' });
  });

  test('a malformed payload is an error, never an empty index', async () => {
    serve(Response.json({ byChildSessionId: { ses_a: { nodeId: 'node_alpha' } } }));

    const outcome = await fetchDagAttributionIndex('/repo');

    expect(outcome).toEqual({ kind: 'error', reason: 'Attribution state is malformed' });
  });

  test('a missing project directory asks nothing and reports absence', async () => {
    serve(Response.json({}));

    expect(await fetchDagAttributionIndex(undefined)).toEqual({
      kind: 'absent',
      reason: 'Attribution state needs a project directory',
    });
    expect(requests).toHaveLength(0);
  });
});
