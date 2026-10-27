import { mkdtempSync, promises as fsPromises, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { createCodeGraphRuntime } from './runtime.js';
import { registerCodeGraphRoutes } from './routes.js';

/**
 * C20: a site request returns real engine refs and renders freshness.
 *
 * No fabricated fixtures for the integration assertion: the route indexes a
 * real temp checkout through the real engine bundle (`indexFiles` over the
 * TypeScript compiler), and every ref below comes from compiler-resolved
 * facts — the definition line, the caller ref, the import edge. The
 * freshness half asserts the exact fields the panel binds
 * (`freshness`, `observedAtMs`, `staleAfterMs`, `revision`, `fingerprint`):
 * what the panel renders is what this response carries.
 */

const MATH_TS = `export function add(left: number, right: number): number {
  return left + right;
}
`;

const MAIN_TS = `import { add } from "./math";

export function run(): number {
  return add(1, 2);
}
`;

const dir = mkdtempSync(join(tmpdir(), 'code-graph-c20-'));
writeFileSync(join(dir, 'math.ts'), MATH_TS);
writeFileSync(join(dir, 'main.ts'), MAIN_TS);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const buildApp = () => {
  const app = express();
  registerCodeGraphRoutes(app, {
    codeGraphRuntime: createCodeGraphRuntime({ fsPromises, path }, { blockOnRead: true }),
  });
  return app;
};

describe('C20 site request over the real engine', () => {
  it(
    'serves a real index with freshness for the directory',
    async () => {
      const app = buildApp();

      const response = await request(app).get(`/api/code-graph/index?directory=${encodeURIComponent(dir)}`);

      expect(response.status).toBe(200);
      // Real index: two files plus their symbols and compiler-resolved edges.
      expect(response.body.nodeCount).toBeGreaterThan(2);
      expect(response.body.edgeCount).toBeGreaterThan(0);
      expect(response.body.entryCount).toBe(2);
      // Freshness the panel renders: status, observation time, and the gate.
      expect(response.body.freshness).toBe('fresh');
      expect(typeof response.body.observedAtMs).toBe('number');
      expect(response.body.staleAfterMs).toBe(7 * 24 * 60 * 60 * 1000);
      expect(response.body.projectId).toMatch(/^[^\s/]+-[0-9a-f]{8}$/);
      expect(response.body.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(response.body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    },
    120_000,
  );

  it(
    'returns the real definition plus its caller for a symbol',
    async () => {
      const app = buildApp();

      const response = await request(app).get(
        `/api/code-graph/query?directory=${encodeURIComponent(dir)}&kind=context&symbol=${encodeURIComponent('fn:add@math.ts')}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.coverage).toBe('indexed');
      expect(response.body.freshness).toBe('fresh');
      // Real refs: the actual definition with its source line…
      expect(response.body.definition?.file).toBe('math.ts');
      expect(response.body.definition?.line).toBe(1);
      expect(response.body.definition?.confidence).toBe(1);
      // …and the known caller with the file:line site that produced the edge.
      const callerIds = (response.body.callers ?? []).map((caller) => caller.id);
      expect(callerIds).toContain('fn:run@main.ts');
      const run = response.body.callers.find((caller) => caller.id === 'fn:run@main.ts');
      expect(run?.evidence.some((entry) => entry.edge === 'CALLS_STATIC' && entry.ref === 'main.ts:4')).toBe(true);
      // Dynamics are never proven: nothing item-shaped points at unknown.
      for (const item of response.body.items ?? []) {
        expect(item.confidence).toBe(1);
        expect(item.id).not.toBe('unknown');
      }
    },
    120_000,
  );

  it(
    'previews change impact from the same real edges',
    async () => {
      const app = buildApp();

      const response = await request(app).get(
        `/api/code-graph/query?directory=${encodeURIComponent(dir)}&kind=impact&symbol=${encodeURIComponent('fn:add@math.ts')}`,
      );

      expect(response.status).toBe(200);
      const impactedIds = (response.body.impacted ?? []).map((item) => item.id);
      expect(impactedIds).toContain('fn:run@main.ts');
      expect(response.body.freshness).toBe('fresh');
    },
    120_000,
  );

  it(
    'reports an unknown symbol as unindexed, not as a backend failure',
    async () => {
      const app = buildApp();

      const response = await request(app).get(
        `/api/code-graph/query?directory=${encodeURIComponent(dir)}&kind=context&symbol=${encodeURIComponent('fn:missing@math.ts')}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.coverage).toBe('unindexed');
      expect(response.body.items).toEqual([]);
      expect(response.body.freshness).toBe('fresh');
    },
    120_000,
  );

  it(
    'groups the fixture files into a real module bucket',
    async () => {
      const app = buildApp();

      const response = await request(app).get(
        `/api/code-graph/query?directory=${encodeURIComponent(dir)}&kind=explore`,
      );

      expect(response.status).toBe(200);
      expect(response.body.coverage).toBe('indexed');
      expect(response.body.items).toEqual([]);
      expect(response.body.graph).toBeUndefined();
      expect(Array.isArray(response.body.modules)).toBe(true);
      const bucket = response.body.modules.find((module) =>
        (module.sampleSymbols ?? []).some((symbol) => symbol.file === 'math.ts' || symbol.file === 'main.ts'),
      );
      expect(bucket).toBeDefined();
      expect(bucket.fileCount).toBeGreaterThanOrEqual(1);
      expect(bucket.sampleSymbols.length).toBeGreaterThanOrEqual(1);
      expect(response.body.freshness).toBe('fresh');
    },
    120_000,
  );

  it(
    'traces a real call path between fixture symbols',
    async () => {
      const app = buildApp();
      const context = await request(app).get(
        `/api/code-graph/query?directory=${encodeURIComponent(dir)}&kind=context&symbol=${encodeURIComponent('fn:add@math.ts')}`,
      );
      expect(context.status).toBe(200);
      const callerId = (context.body.callers ?? [])[0]?.id;
      const calleeId = context.body.definition?.id;
      expect(typeof callerId).toBe('string');
      expect(typeof calleeId).toBe('string');

      const response = await request(app).get(
        `/api/code-graph/query?directory=${encodeURIComponent(dir)}&kind=trace&from=${encodeURIComponent(callerId)}&to=${encodeURIComponent(calleeId)}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.coverage).toBe('indexed');
      expect(response.body.graph).toBeUndefined();
      expect(response.body.path.length).toBeGreaterThan(0);
      expect(response.body.path[0].from).toBe(callerId);
      expect(response.body.freshness).toBe('fresh');
    },
    120_000,
  );

  it(
    'refuses kind=trace without from and to',
    async () => {
      const app = buildApp();

      const response = await request(app).get(
        `/api/code-graph/query?directory=${encodeURIComponent(dir)}&kind=trace`,
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('from and to are required');
    },
    120_000,
  );

  it(
    'reports an unknown trace endpoint as unindexed, not as a backend failure',
    async () => {
      const app = buildApp();

      const response = await request(app).get(
        `/api/code-graph/query?directory=${encodeURIComponent(dir)}&kind=trace&from=${encodeURIComponent('fn:missing@math.ts')}&to=${encodeURIComponent('fn:add@math.ts')}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.coverage).toBe('unindexed');
      expect((response.body.unresolved ?? []).length).toBeGreaterThan(0);
      expect(response.body.freshness).toBe('fresh');
    },
    120_000,
  );
});
