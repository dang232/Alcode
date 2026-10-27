import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { registerCodeGraphRoutes } from './routes.js';

/**
 * Route contract tests over real HTTP with a stub runtime.
 *
 * The engine stays out of this file on purpose: real indexing is proven by
 * `code-graph.c20.test.js`. These tests pin what the route owns — directory
 * scoping, query-shape validation, and failure mapping — so a regression in
 * the route cannot hide behind engine output.
 */

const createApp = (overrides = {}) => {
  const received = {};
  const runtime = {
    normalizeDirectory: async (directory) => {
      received.directory = directory;
      if (!directory) {
        return { error: 'directory is required' };
      }
      return { directory: `/projects/${directory}` };
    },
    readIndex: async (directory, options) => {
      received.indexOptions = options;
      return {
        projectId: 'demo-12345678',
        worktreeId: 'worktree',
        revision: 'a'.repeat(40),
        fingerprint: 'b'.repeat(64),
        freshness: 'fresh',
        observedAtMs: 1,
        staleAfterMs: 2,
        binding: 'git-head',
        nodeCount: 3,
        edgeCount: 2,
        entryCount: 2,
      };
    },
    query: async (directory, input) => {
      received.queryInput = input;
      return { freshness: 'fresh', coverage: 'indexed', items: [] };
    },
    ...overrides.runtime,
  };

  const app = express();
  registerCodeGraphRoutes(app, { codeGraphRuntime: runtime });
  return { app, received };
};

describe('directory scope', () => {
  it('refuses a request with no directory rather than indexing the server cwd', async () => {
    const { app } = createApp();

    const response = await request(app).get('/api/code-graph/index');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('directory is required');
  });

  it('refuses a query with no directory before the engine runs', async () => {
    const { app, received } = createApp();

    const response = await request(app).get('/api/code-graph/query?kind=search&q=add');

    expect(response.status).toBe(400);
    expect(received.queryInput).toBeUndefined();
  });

  it('resolves the directory before reading the index', async () => {
    const { app, received } = createApp();

    await request(app).get('/api/code-graph/index?directory=acme');

    expect(received.directory).toBe('acme');
  });

  it('forwards the refresh ask to the runtime', async () => {
    const { app, received } = createApp();

    await request(app).get('/api/code-graph/index?directory=acme&refresh=1');

    expect(received.indexOptions).toEqual({ refresh: true });
  });
});

describe('query shape', () => {
  it('maps a runtime shape error to 400 with the reason', async () => {
    const { app } = createApp({
      runtime: {
        query: async () => ({ error: 'symbol is required for kind=context', status: 400 }),
      },
    });

    const response = await request(app).get('/api/code-graph/query?directory=acme&kind=context');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('symbol is required');
  });

  it('passes kind, subject, and limit through to the runtime', async () => {
    const { app, received } = createApp();

    await request(app).get('/api/code-graph/query?directory=acme&kind=impact&symbol=fn%3Aadd%40math.ts&limit=5');

    expect(received.queryInput).toMatchObject({ kind: 'impact', symbol: 'fn:add@math.ts', limit: 5 });
  });

  it('defaults the neighbourhood depth to 1 when the UI sends none', async () => {
    const { app, received } = createApp();

    await request(app).get('/api/code-graph/query?directory=acme&kind=impact&symbol=fn%3Aadd%40math.ts');

    expect(received.queryInput).toMatchObject({ kind: 'impact', depth: 1 });
  });

  it('forwards the depth ask to the runtime for context/impact/trace', async () => {
    const { app, received } = createApp();

    await request(app).get('/api/code-graph/query?directory=acme&kind=impact&symbol=fn%3Aadd%40math.ts&depth=3');

    expect(received.queryInput).toMatchObject({ kind: 'impact', depth: 3 });
  });

  it('clamps depth to the 1..3 neighbourhood range', async () => {
    const { app, received } = createApp();

    await request(app).get('/api/code-graph/query?directory=acme&kind=trace&from=a&to=b&depth=99');
    expect(received.queryInput).toMatchObject({ depth: 3 });

    await request(app).get('/api/code-graph/query?directory=acme&kind=trace&from=a&to=b&depth=0');
    expect(received.queryInput).toMatchObject({ depth: 1 });
  });

  it('passes the explore kind through to the runtime', async () => {
    const { app, received } = createApp();

    await request(app).get('/api/code-graph/query?directory=acme&kind=explore&limit=5');

    expect(received.queryInput).toMatchObject({ kind: 'explore', limit: 5 });
  });

  it('forwards from and to for kind=trace', async () => {
    const { app, received } = createApp();

    await request(app).get(
      '/api/code-graph/query?directory=acme&kind=trace&from=fn%3Arun%40main.ts&to=fn%3Aadd%40math.ts',
    );

    expect(received.queryInput).toMatchObject({ kind: 'trace', from: 'fn:run@main.ts', to: 'fn:add@math.ts' });
  });

  it('maps a trace shape error to 400 with the reason', async () => {
    const { app } = createApp({
      runtime: {
        query: async () => ({ error: 'from and to are required for kind=trace', status: 400 }),
      },
    });

    const response = await request(app).get('/api/code-graph/query?directory=acme&kind=trace');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('from and to are required');
  });
});

describe('backend failure', () => {
  it('answers 500 with the error instead of a fake empty index', async () => {
    const { app } = createApp({
      runtime: {
        readIndex: async () => {
          throw new Error('code-graph: no TypeScript server binary');
        },
      },
    });

    const response = await request(app).get('/api/code-graph/index?directory=acme');

    expect(response.status).toBe(500);
    expect(response.body.error).toContain('no TypeScript server binary');
    expect(response.body.items).toBeUndefined();
  });

  it('answers 500 when a query throws rather than resolving empty', async () => {
    const { app } = createApp({
      runtime: {
        query: async () => {
          throw new Error('engine exploded');
        },
      },
    });

    const response = await request(app).get('/api/code-graph/query?directory=acme&kind=search&q=add');

    expect(response.status).toBe(500);
    expect(response.body.error).toContain('engine exploded');
    expect(response.body.coverage).toBeUndefined();
  });
});
