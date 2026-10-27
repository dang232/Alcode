import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { fetchCodeGraphIndex, queryCodeGraph } from './codeGraphApi';

let request: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | null = null;
let seen: Array<{ url: string; directory: string | null }> = [];

const stubFetch = <Body,>(handler: (url: string) => Body): void => {
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

const stubFetchByQuery = <Body,>(handler: (url: URL) => Body): void => {
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
  test('a build in flight parses as pending instead of a malformed answer', async () => {
    stubFetchByQuery(() => ({
      ready: false,
      freshness: 'unindexed',
      projectId: null,
      worktreeId: null,
      revision: null,
      fingerprint: null,
      nodeCount: 0,
      edgeCount: 0,
      entryCount: 0,
      indexState: { state: 'analyzing', phase: 'program', files: 8, projectsDone: 1, projectsTotal: 2 },
    }));

    const summary = await fetchCodeGraphIndex('/home/me/repo');

    // The panel renders progress from these fields; throwing here is what made
    // an indexing repository read as a broken response.
    expect(summary.ready).toBe(false);
    expect(summary.freshness).toBe('unindexed');
    expect(summary.indexState?.state).toBe('analyzing');
    expect(summary.indexState?.projectsTotal).toBe(2);
    expect(summary.revision).toBeUndefined();
  });

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

  test('a depth ask rides the query as a depth param', async () => {
    stubFetchByQuery(() => ({
      ...indexPayload(),
      coverage: 'indexed',
      knowledgeIds: [],
      unresolved: [],
      unsupported: [],
      items: [],
    }));

    await queryCodeGraph('/home/me/repo', { kind: 'context', symbol: 'fn:add@math.ts', depth: 2 });

    expect(seen[0]?.url).toContain('depth=2');
  });

  test('an omitted depth sends no depth param and invents no totals', async () => {
    stubFetchByQuery(() => ({
      ...indexPayload(),
      coverage: 'indexed',
      knowledgeIds: [],
      unresolved: [],
      unsupported: [],
      items: [],
    }));

    const answer = await queryCodeGraph('/home/me/repo', { kind: 'search', query: 'add' });

    expect(seen[0]?.url).not.toContain('depth');
    expect(answer.totals).toBeUndefined();
    expect(answer.summary).toBeUndefined();
    expect(answer.generation).toBeUndefined();
  });

  test('a payload carrying totals, summary, and generation parses with those fields present', async () => {
    stubFetchByQuery(() => ({
      ...indexPayload(),
      coverage: 'indexed',
      knowledgeIds: [],
      unresolved: [],
      unsupported: [],
      items: [],
      totals: {
        displayed: 4,
        known: 12,
        hidden: 8,
        byDepth: [{ depth: 1, count: 4 }, { depth: 2, count: 8 }],
        byKind: [{ kind: 'CALLS_STATIC', count: 3 }],
      },
      summary: { subjectId: 'fn:add@math.ts', nodeCount: 3, edgeCount: 2, truncated: false },
      completeness: 'complete',
      completenessReason: 'indexed',
      generation: 7,
    }));

    const answer = await queryCodeGraph('/home/me/repo', { kind: 'context', symbol: 'fn:add@math.ts' });

    expect(answer.totals).toEqual({
      displayed: 4,
      known: 12,
      hidden: 8,
      byDepth: [{ depth: 1, count: 4 }, { depth: 2, count: 8 }],
      byKind: [{ kind: 'CALLS_STATIC', count: 3 }],
    });
    expect(answer.summary).toEqual({
      subjectId: 'fn:add@math.ts',
      nodeCount: 3,
      edgeCount: 2,
      truncated: false,
    });
    expect(answer.completeness).toBe('complete');
    expect(answer.completenessReason).toBe('indexed');
    expect(answer.generation).toBe(7);
  });

  test('a payload carrying verdict, test flags, and display counts parses them through', async () => {
    stubFetchByQuery(() => ({
      ...indexPayload(),
      coverage: 'indexed',
      knowledgeIds: [],
      unresolved: [],
      unsupported: [],
      items: [
        {
          id: 'fn:add@math.ts',
          file: 'math.ts',
          line: 1,
          evidence: [{ edge: 'CALLS_STATIC', ref: 'main.ts:5', confidence: 1 }],
          confidence: 1,
          knowledgeIds: [],
          verdict: 'confirmed',
          isTest: false,
        },
        {
          id: 'fn:helper@math.test.ts',
          file: 'math.test.ts',
          line: 2,
          evidence: [{ edge: 'CALLS_UNRESOLVED', ref: 'math.test.ts:2', confidence: 0.5 }],
          confidence: 0.5,
          knowledgeIds: [],
          verdict: 'inferred',
          isTest: true,
        },
      ],
      duplicatesDropped: 2,
      suggestedMode: 'impact',
      ambiguousNames: true,
      shownOf: { callers: { shown: 1, total: 3 }, candidates: { shown: 2, total: 2 } },
      query: 'add',
      hiddenTestCount: 1,
    }));

    const answer = await queryCodeGraph('/home/me/repo', { kind: 'search', query: 'add' });

    expect(answer.items[0]?.verdict).toBe('confirmed');
    expect(answer.items[0]?.isTest).toBe(false);
    expect(answer.items[1]?.verdict).toBe('inferred');
    expect(answer.items[1]?.isTest).toBe(true);
    expect(answer.duplicatesDropped).toBe(2);
    expect(answer.suggestedMode).toBe('impact');
    expect(answer.ambiguousNames).toBe(true);
    expect(answer.shownOf).toEqual({
      callers: { shown: 1, total: 3 },
      candidates: { shown: 2, total: 2 },
    });
    expect(answer.query).toBe('add');
    expect(answer.hiddenTestCount).toBe(1);
  });

  test('an answer omitting the new display fields leaves them undefined', async () => {
    stubFetchByQuery(() => ({
      ...indexPayload(),
      coverage: 'indexed',
      knowledgeIds: [],
      unresolved: [],
      unsupported: [],
      items: [
        {
          id: 'fn:add@math.ts',
          file: 'math.ts',
          line: 1,
          evidence: [{ edge: 'DEFINES', ref: 'math.ts:1', confidence: 1 }],
          confidence: 1,
          knowledgeIds: [],
        },
      ],
      summary: { nodeCount: 1, modules: [{ name: 'packages' }] },
    }));

    const answer = await queryCodeGraph('/home/me/repo', { kind: 'search', query: 'add' });

    expect(answer.items[0]?.verdict).toBeUndefined();
    expect(answer.items[0]?.isTest).toBeUndefined();
    expect(answer.duplicatesDropped).toBeUndefined();
    expect(answer.suggestedMode).toBeUndefined();
    expect(answer.ambiguousNames).toBeUndefined();
    expect(answer.shownOf).toBeUndefined();
    expect(answer.query).toBeUndefined();
    expect(answer.hiddenTestCount).toBeUndefined();
    const module = answer.summary && 'modules' in answer.summary ? answer.summary.modules?.[0] : undefined;
    expect(module).toEqual({ name: 'packages' });
    expect(module?.analyzedFiles).toBeUndefined();
    expect(module?.unanalyzedFiles).toBeUndefined();
    expect(module?.unanalyzedByExtension).toBeUndefined();
    expect(module?.excludedFiles).toBeUndefined();
  });

  test('an explore summary keeps the walk-measured module coverage', async () => {
    stubFetchByQuery(() => ({
      ...indexPayload(),
      coverage: 'indexed',
      knowledgeIds: [],
      unresolved: [],
      unsupported: [],
      items: [],
      summary: {
        nodeCount: 3,
        edgeCount: 2,
        truncated: false,
        modules: [
          {
            name: 'packages',
            fileCount: 3,
            symbolCount: 7,
            edgeCount: 9,
            covered: true,
            analyzedFiles: 3,
            unanalyzedFiles: 2,
            unanalyzedByExtension: [{ ext: '.sh', count: 2 }],
            excludedFiles: 1,
          },
        ],
      },
    }));

    const answer = await queryCodeGraph('/home/me/repo', { kind: 'explore' });

    const module = answer.summary && 'modules' in answer.summary ? answer.summary.modules?.[0] : undefined;
    expect(module?.analyzedFiles).toBe(3);
    expect(module?.unanalyzedFiles).toBe(2);
    expect(module?.unanalyzedByExtension).toEqual([{ ext: '.sh', count: 2 }]);
    expect(module?.excludedFiles).toBe(1);
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
