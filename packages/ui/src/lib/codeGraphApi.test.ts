import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { fetchCodeGraphIndex, queryCodeGraph } from './codeGraphApi';

let request: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | null = null;
let seen: Array<{ url: string; directory: string | null }> = [];

const stubFetch = (handler: (url: string) => unknown): void => {
  request = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, 'http://app.test');
    seen.push({
      url: `${url.pathname}${url.search}`,
      directory: new Headers(init?.headers).get('x-opencode-directory'),
    });
    return Response.json(handler(url.pathname));
  });
};

const stubFetchByQuery = (handler: (url: URL) => unknown): void => {
  request = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, 'http://app.test');
    seen.push({
      url: `${url.pathname}${url.search}`,
      directory: new Headers(init?.headers).get('x-opencode-directory'),
    });
    return Response.json(handler(url));
  });
};

afterEach(() => {
  request?.mockRestore();
  request = null;
  seen = [];
});

const indexPayload = () => ({
  projectId: 'demo-12345678',
  worktreeId: 'wt',
  revision: 'a'.repeat(40),
  fingerprint: 'b'.repeat(64),
  freshness: 'fresh',
  observedAtMs: 7,
  staleAfterMs: 8,
  nodeCount: 3,
  edgeCount: 2,
  entryCount: 2,
});

describe('code graph client', () => {
  test('an explore answer keeps the module buckets the server derived', async () => {
    stubFetchByQuery(() => ({
      ...indexPayload(),
      coverage: 'indexed',
      knowledgeIds: [],
      unresolved: [],
      unsupported: [],
      items: [],
      modules: [
        {
          name: 'packages',
          fileCount: 3,
          testFileCount: 1,
          symbolCount: 7,
          edgeCount: 9,
          sampleSymbols: [{ id: 'fn:run@packages/main.ts', name: 'run', file: 'packages/main.ts', line: 4 }],
        },
      ],
    }));

    const answer = await queryCodeGraph('/home/me/repo', { kind: 'explore' });

    expect(seen[0]?.url).toContain('kind=explore');
    expect(answer.modules?.length).toBe(1);
    expect(answer.modules?.[0].fileCount).toBe(3);
    expect(answer.modules?.[0].sampleSymbols[0].file).toBe('packages/main.ts');
    expect(answer.graph).toBeUndefined();
  });

  test('a trace answer sends both endpoints and keeps the ordered path', async () => {
    stubFetchByQuery(() => ({
      ...indexPayload(),
      coverage: 'indexed',
      knowledgeIds: [],
      unresolved: [],
      unsupported: [],
      items: [],
      path: [{ from: 'fn:caller@main.ts', to: 'fn:callee@math.ts', ref: 'main.ts:5', confidence: 1 }],
    }));

    const answer = await queryCodeGraph('/home/me/repo', {
      kind: 'trace',
      from: 'fn:caller@main.ts',
      to: 'fn:callee@math.ts',
    });

    expect(seen[0]?.url).toContain('from=fn%3Acaller%40main.ts');
    expect(seen[0]?.url).toContain('to=fn%3Acallee%40math.ts');
    expect(answer.path?.length).toBe(1);
    expect(answer.path?.[0].ref).toBe('main.ts:5');
  });

  test('a missing modules array is absence, not an empty success', async () => {
    stubFetchByQuery(() => ({
      ...indexPayload(),
      coverage: 'indexed',
      knowledgeIds: [],
      unresolved: [],
      unsupported: [],
      items: [],
    }));

    const answer = await queryCodeGraph('/home/me/repo', { kind: 'explore' });

    expect(answer.modules).toBeUndefined();
  });

  test('the index request names its directory in the query and the space header', async () => {
    stubFetch(() => indexPayload());

    const summary = await fetchCodeGraphIndex('/home/me/repo');

    expect(summary.nodeCount).toBe(3);
    expect(summary.freshness).toBe('fresh');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toContain('/api/code-graph/index');
    expect(seen[0]?.url).toContain(`directory=${encodeURIComponent('/home/me/repo')}`);
    // A host directory adds no space header; the query alone says where it goes.
    expect(seen[0]?.directory).toBeNull();
  });

  test('a space directory rides the directory header to the space server', async () => {
    stubFetch(() => indexPayload());

    await fetchCodeGraphIndex('/spaces/a1b2c3d4e5f6/repo');

    expect(seen).toHaveLength(1);
    expect(seen[0]?.directory).toBe(encodeURIComponent('/spaces/a1b2c3d4e5f6/repo'));
  });

  test('a query passes its kind and subject through', async () => {
    stubFetch(() => ({
      ...indexPayload(),
      coverage: 'indexed',
      knowledgeIds: [],
      unresolved: [],
      unsupported: [],
      items: [],
      definition: {
        id: 'fn:add@math.ts',
        file: 'math.ts',
        line: 1,
        evidence: [{ edge: 'DEFINES', ref: 'math.ts:1', confidence: 1 }],
        confidence: 1,
        knowledgeIds: [],
      },
      callers: [],
    }));

    const result = await queryCodeGraph('/home/me/repo', { kind: 'context', symbol: 'fn:add@math.ts' });

    expect(result.definition?.file).toBe('math.ts');
    expect(result.coverage).toBe('indexed');
    expect(seen[0]?.url).toContain('kind=context');
    expect(seen[0]?.url).toContain(`symbol=${encodeURIComponent('fn:add@math.ts')}`);
  });

  test('a missing directory throws before any request leaves', async () => {
    stubFetch(() => indexPayload());

    await expect(fetchCodeGraphIndex(null)).rejects.toThrow('project directory');
    expect(seen).toHaveLength(0);
  });

  test('a backend failure throws instead of resolving an empty graph', async () => {
    request = spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ error: 'engine exploded' }, { status: 500 }),
    );

    await expect(queryCodeGraph('/home/me/repo', { kind: 'search', query: 'add' })).rejects.toThrow(
      'engine exploded',
    );
  });

  test('a malformed success still throws instead of rendering half a graph', async () => {
    stubFetch(() => ({ freshness: 'fresh' }));

    await expect(fetchCodeGraphIndex('/home/me/repo')).rejects.toThrow('Malformed');
  });
});
