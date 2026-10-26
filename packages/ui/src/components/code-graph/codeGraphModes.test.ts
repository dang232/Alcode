import { describe, expect, test } from 'bun:test';

import {
  deriveExploreView,
  deriveImpactView,
  deriveTraceView,
  deriveTrailView,
  isConfirmedRow,
  hasAmbiguousNames,
  modeForPickedId,
  resultsMatchQuery,
} from './codeGraphModes';
import type { CodeGraphItem, CodeGraphQueryResult } from '@/lib/codeGraphApi';

const item = (overrides: Partial<CodeGraphItem> = {}): CodeGraphItem => ({
  id: 'fn:run@main.ts',
  file: 'main.ts',
  line: 4,
  evidence: [{ edge: 'CALLS_STATIC', ref: 'main.ts:5', confidence: 1 }],
  confidence: 1,
  knowledgeIds: [],
  ...overrides,
});

const result = (overrides: Partial<CodeGraphQueryResult> = {}): CodeGraphQueryResult => ({
  projectId: 'project',
  worktreeId: 'worktree',
  revision: 'a'.repeat(40),
  fingerprint: 'b'.repeat(64),
  freshness: 'fresh',
  observedAtMs: 1,
  staleAfterMs: 2,
  coverage: 'indexed',
  knowledgeIds: [],
  unresolved: [],
  unsupported: [],
  items: [],
  ...overrides,
});

describe('code graph modes', () => {
  test('explore keeps the server module buckets and says when they were cut', () => {
    const view = deriveExploreView(result({
      modules: [
        { name: 'packages', fileCount: 3, testFileCount: 1, symbolCount: 9, edgeCount: 12, sampleSymbols: [] },
      ],
      truncated: true,
      unresolved: ['truncated to 6 of 9 modules'],
    }));
    expect(view.modules.length).toBe(1);
    expect(view.modules[0].fileCount).toBe(3);
    expect(view.truncated).toBe(true);
    expect(view.notes).toContain('truncated to 6 of 9 modules');
  });

  test('explore of an unanswered payload reports no modules instead of inventing one', () => {
    expect(deriveExploreView(null).modules).toEqual([]);
    expect(deriveExploreView(result({ coverage: 'unindexed', unsupported: ['not indexed'] })).modules).toEqual([]);
    expect(deriveExploreView(result({ coverage: 'unindexed', unsupported: ['not indexed'] })).notes).toContain('not indexed');
  });

  test('trace reads both directions and the linked tests from real answers', () => {
    const caller = item({ id: 'fn:caller@main.ts' });
    const callee = item({ id: 'fn:callee@math.ts' });
    const testItem = item({ id: 'file:main.test.ts', file: 'main.test.ts', evidence: [{ edge: 'TESTS', ref: 'main.test.ts:2', confidence: 1 }] });
    const view = deriveTraceView({
      detail: result({ callers: [caller, caller], callees: [callee], definition: item() }),
      tests: result({ items: [testItem] }),
    });
    expect(view.subjectId).toBe('fn:run@main.ts');
    expect(view.incoming.map((entry) => entry.id)).toEqual(['fn:caller@main.ts']);
    expect(view.outgoing.map((entry) => entry.id)).toEqual(['fn:callee@math.ts']);
    expect(view.tests.map((entry) => entry.id)).toEqual(['file:main.test.ts']);
  });

  test('trace without a context answer claims nothing', () => {
    const view = deriveTraceView({ detail: null, tests: null });
    expect(view.incoming).toEqual([]);
    expect(view.outgoing).toEqual([]);
    expect(view.subjectId).toBeNull();
    expect(view.coverage).toBeNull();
  });

  test('impact separates graph-confirmed reverse dependencies from inferred ones', () => {
    const confirmed = item({ id: 'fn:confirmed@a.ts' });
    const unresolved = item({
      id: 'fn:inferred@b.ts',
      confidence: 0.4,
      evidence: [{ edge: 'CALLS_UNRESOLVED', ref: 'b.ts:9', confidence: 0.4 }],
    });
    const noEvidence = item({ id: 'fn:bare@c.ts', confidence: 1, evidence: [] });
    const view = deriveImpactView({ impact: result({ impacted: [confirmed, unresolved, noEvidence] }), tests: null });
    expect(view.confirmed.map((entry) => entry.id)).toEqual(['fn:confirmed@a.ts']);
    expect(view.inferred.map((entry) => entry.id)).toEqual(['fn:inferred@b.ts', 'fn:bare@c.ts']);
  });

  test('a row is confirmed only by a resolved edge at full confidence', () => {
    expect(isConfirmedRow(item())).toBe(true);
    expect(isConfirmedRow(item({ evidence: [{ edge: 'CALLS_UNRESOLVED', ref: 'x.ts:1', confidence: 1 }] }))).toBe(false);
    expect(isConfirmedRow(item({ confidence: 0.5 }))).toBe(false);
    expect(isConfirmedRow(item({ evidence: [] }))).toBe(false);
  });

  test('a truncated answer with no rows does not claim rows were cut', () => {
    const trace = deriveTraceView({ detail: result({ truncated: true }), tests: null });
    expect(trace.notes.some((note) => note.includes('cut at the result limit'))).toBe(false);
    const impact = deriveImpactView({ impact: result({ truncated: true }), tests: null });
    expect(impact.notes.some((note) => note.includes('cut at the result limit'))).toBe(false);
  });

  test('a truncated answer with rows says so', () => {
    const trace = deriveTraceView({ detail: result({ truncated: true, callers: [item()] }), tests: null });
    expect(trace.notes.some((note) => note.includes('cut at the result limit'))).toBe(true);
    const impact = deriveImpactView({ impact: result({ truncated: true, impacted: [item()] }), tests: null });
    expect(impact.notes.some((note) => note.includes('cut at the result limit'))).toBe(true);
  });

  test('impact keeps the coverage it was answered at so the caller can state a refusal', () => {
    const view = deriveImpactView({ impact: result({ coverage: 'unindexed', unresolved: ['no definition'] }), tests: null });
    expect(view.coverage).toBe('unindexed');
    expect(view.notes).toContain('no definition');
    expect(view.confirmed).toEqual([]);
  });

  test('a traced path is the ordered server steps and nothing else', () => {
    const view = deriveTrailView(result({
      path: [{ from: 'fn:a@a.ts', to: 'fn:b@b.ts', ref: 'a.ts:3', confidence: 1 }],
    }));
    expect(view.steps.length).toBe(1);
    expect(view.steps[0].from).toBe('fn:a@a.ts');
    expect(deriveTrailView(null).steps).toEqual([]);
  });

  test('a picked file opens Explore and a picked symbol opens Trace', () => {
    expect(modeForPickedId('file:main.ts')).toBe('explore');
    expect(modeForPickedId('fn:run@main.ts')).toBe('trace');
    expect(modeForPickedId(null)).toBe('trace');
  });

  test('results only count while the search box still shows their query', () => {
    expect(resultsMatchQuery('queue', 'queue')).toBe(true);
    expect(resultsMatchQuery(' queue ', 'queue')).toBe(true);
    expect(resultsMatchQuery('queue', '')).toBe(false);
    expect(resultsMatchQuery(null, 'queue')).toBe(false);
  });

  test('two ids sharing one display name are reported as ambiguous', () => {
    const first = item({ id: 'const:d@admin/a.ts', name: 'd' });
    const second = item({ id: 'const:d@admin/b.ts', name: 'd' });
    const distinct = item({ id: 'fn:run@main.ts', name: 'run' });
    expect(hasAmbiguousNames([first, second])).toBe(true);
    expect(hasAmbiguousNames([first, distinct])).toBe(false);
    expect(hasAmbiguousNames([first, { ...first }])).toBe(false);
    expect(hasAmbiguousNames([])).toBe(false);
  });
});
