// Code view + rationale helper tests for the dag-pane panel (ulw-slice72-c).
// bun:test, no DOM: the pure helpers in code-view.ts / rationale-view.ts
// plus the new strings keys across all 13 locales.
import { describe, expect, test } from 'bun:test';

import {
  buildFileQuery,
  buildSearchQuery,
  buildSymbolQueries,
  classifyCodeItemId,
  extractCodeToken,
  formatFreshnessChip,
  resolveCodeIndexStatus,
  resolveCodeQueryStatus,
  taskToCodeSource,
} from './code-view.ts';
import {
  buildRationaleProjectsQuery,
  buildRationaleQuery,
  formatRationaleProvenance,
  rationaleBadgesFor,
  resolveRationaleStatus,
  shouldRenderRationale,
} from './rationale-view.ts';
import { DAG_PANE_LOCALES, stringsFor } from './strings.ts';

const rows = [
  { id: 'node_plan', label: 'plan the `add` helper' },
  { id: 'node_build', label: 'Build the fixture bridge' },
];

describe('extractCodeToken', () => {
  test('a backtick span wins over surrounding prose', () => {
    expect(extractCodeToken('plan the `add` helper')).toBe('add');
  });
  test('reads a namespaced symbol id', () => {
    expect(extractCodeToken('wire fn:add@math.ts into main')).toBe('fn:add@math.ts');
  });
  test('reads a file id and a dotted path', () => {
    expect(extractCodeToken('open file:math.ts next')).toBe('file:math.ts');
    expect(extractCodeToken('edit packages/web/routes.ts now')).toBe('packages/web/routes.ts');
  });
  test('answers one token, never a list', () => {
    expect(extractCodeToken('`add` then `run`')).toBe('add');
  });
  test('prose with no code shape answers null', () => {
    expect(extractCodeToken('Do the thing well')).toBeNull();
    expect(extractCodeToken('')).toBeNull();
  });
});

describe('taskToCodeSource', () => {
  test('a recorded row selection is navigable with its token', () => {
    const source = taskToCodeSource(rows, 'node_plan');
    expect(source.available).toBe(true);
    if (source.available) {
      expect(source.row.id).toBe('node_plan');
      expect(source.token).toBe('add');
    }
  });
  test('a recorded prose label is navigable with a null token', () => {
    const source = taskToCodeSource(rows, 'node_build');
    expect(source.available).toBe(true);
    if (source.available) {
      // Plain prose carries no code shape: no jump fires, exploration stays.
      expect(source.token).toBeNull();
    }
  });
  test('no selection, an unknown id, or empty rows are unavailable', () => {
    expect(taskToCodeSource(rows, null)).toEqual({ available: false });
    expect(taskToCodeSource(rows, 'node_gone')).toEqual({ available: false });
    expect(taskToCodeSource([], 'node_plan')).toEqual({ available: false });
  });
});

describe('code query builders', () => {
  test('search carries the single token as q', () => {
    expect(buildSearchQuery('/repo', 'add')).toEqual({
      path: '/codegraph/query',
      query: { directory: '/repo', kind: 'search', q: 'add' },
    });
  });
  test('a symbol select fires context, impact, and tests with the symbol subject', () => {
    const queries = buildSymbolQueries('/repo', 'fn:add@math.ts');
    expect(queries).toHaveLength(3);
    expect(queries[0].query).toMatchObject({ kind: 'context', symbol: 'fn:add@math.ts' });
    expect(queries[1].query).toMatchObject({ kind: 'impact', symbol: 'fn:add@math.ts' });
    expect(queries[2].query).toMatchObject({ kind: 'tests', target: 'fn:add@math.ts' });
    for (const built of queries) {
      expect(built.path).toBe('/codegraph/query');
      expect(built.query.directory).toBe('/repo');
    }
  });
  test('a file select fires the single file query', () => {
    expect(buildFileQuery('/repo', 'math.ts')).toEqual({
      path: '/codegraph/query',
      query: { directory: '/repo', kind: 'file', file: 'math.ts' },
    });
  });
});

describe('classifyCodeItemId', () => {
  test('engine symbol ids select the triple query', () => {
    expect(classifyCodeItemId('fn:add@math.ts')).toBe('symbol');
    expect(classifyCodeItemId('class:Store@record.ts')).toBe('symbol');
    expect(classifyCodeItemId('const:limit@config.ts')).toBe('symbol');
  });
  test('file ids select the file query, anything else renders as-is', () => {
    expect(classifyCodeItemId('file:math.ts')).toBe('file');
    expect(classifyCodeItemId('tests:file:a:file:b:3')).toBe('other');
    expect(classifyCodeItemId('knowledge:pk-abcdef123456')).toBe('other');
  });
});

describe('formatFreshnessChip', () => {
  test('renders revision, fingerprint, freshness, and binding with short forms', () => {
    const chip = formatFreshnessChip({
      revision: 'a'.repeat(40),
      fingerprint: 'b'.repeat(64),
      freshness: 'fresh',
      binding: 'git-head',
    });
    expect(chip.shortRevision).toBe('a'.repeat(8));
    expect(chip.shortFingerprint).toBe('b'.repeat(8));
    expect(chip.text).toContain('fresh');
    expect(chip.text).toContain('git-head');
    expect(chip.text).toContain('a'.repeat(8));
  });
  test('missing fields read as em-dashes, never invented', () => {
    const chip = formatFreshnessChip({});
    expect(chip.text).toContain('—');
    expect(chip.revision).toBe('—');
    expect(chip.binding).toBe('—');
  });
});

describe('resolveCodeIndexStatus', () => {
  const index = { freshness: 'fresh', nodeCount: 4 };
  test('disconnected wins over every cache', () => {
    expect(resolveCodeIndexStatus({ connected: false, error: null, index })).toBe('disconnected');
  });
  test('error beats loading and ready alike', () => {
    expect(resolveCodeIndexStatus({ connected: true, error: 'boom', index })).toBe('error');
    expect(resolveCodeIndexStatus({ connected: true, error: 'boom', index: null })).toBe('error');
  });
  test('null index loads, zero nodes is empty, stale stays visible', () => {
    expect(resolveCodeIndexStatus({ connected: true, error: null, index: null })).toBe('loading');
    expect(resolveCodeIndexStatus({ connected: true, error: null, index: { freshness: 'fresh', nodeCount: 0 } })).toBe('empty');
    expect(resolveCodeIndexStatus({ connected: true, error: null, index: { freshness: 'stale', nodeCount: 4 } })).toBe('stale');
    expect(resolveCodeIndexStatus({ connected: true, error: null, index })).toBe('ready');
  });
});

describe('resolveCodeQueryStatus', () => {
  test('error and loading come before any body reading', () => {
    expect(resolveCodeQueryStatus({ error: 'boom', result: null })).toBe('error');
    expect(resolveCodeQueryStatus({ error: null, result: null })).toBe('loading');
  });
  test('unindexed coverage and zero items are honest empties', () => {
    expect(resolveCodeQueryStatus({ error: null, result: { coverage: 'unindexed', items: [] } })).toBe('empty');
    expect(resolveCodeQueryStatus({ error: null, result: { coverage: 'indexed', items: [] } })).toBe('empty');
    expect(resolveCodeQueryStatus({ error: null, result: { coverage: 'indexed', items: [{ id: 'fn:add@math.ts' }] } })).toBe('ready');
  });
});

describe('rationale query builders', () => {
  test('discovery reads /rationale/projects for the directory', () => {
    expect(buildRationaleProjectsQuery('/repo')).toEqual({
      path: '/rationale/projects',
      query: { directory: '/repo' },
    });
  });
  test('each rank query carries the project id with the task label as q', () => {
    expect(buildRationaleQuery('/repo', 'fixture-abcdef12', 'Build the bridge')).toEqual({
      path: '/rationale',
      query: { directory: '/repo', projectId: 'fixture-abcdef12', q: 'Build the bridge' },
    });
  });
});

describe('shouldRenderRationale', () => {
  test('renders nothing when ranked is empty, null, or undefined', () => {
    expect(shouldRenderRationale([])).toBe(false);
    expect(shouldRenderRationale(null)).toBe(false);
    expect(shouldRenderRationale(undefined)).toBe(false);
    expect(shouldRenderRationale([{ id: 'pk-abcdef123456' }])).toBe(true);
  });
});

describe('rationaleBadgesFor', () => {
  test('superseded kind or standing raises SUPERSEDED', () => {
    expect(rationaleBadgesFor({ kind: 'superseded', standing: 'superseded' })).toContain('SUPERSEDED');
    expect(rationaleBadgesFor({ kind: 'source-verified', standing: 'superseded' })).toContain('SUPERSEDED');
  });
  test('an unverified hypothesis raises UNVERIFIED', () => {
    expect(rationaleBadgesFor({ kind: 'unverified-hypothesis', standing: 'unverified-hypothesis' })).toEqual(['UNVERIFIED']);
  });
  test('a demoted standing or EVID-STALE raises STALE-EVIDENCE', () => {
    expect(rationaleBadgesFor({ kind: 'source-verified', standing: 'previously-verified' })).toContain('STALE-EVIDENCE');
    expect(rationaleBadgesFor({ kind: 'source-verified', standing: 'source-verified', freshness: { demoted: false, appliedCase: 'EVID-STALE' } })).toContain('STALE-EVIDENCE');
    expect(rationaleBadgesFor({ kind: 'source-verified', standing: 'source-verified', freshness: { demoted: true, appliedCase: 'HEAD-MOVE' } })).toContain('STALE-EVIDENCE');
  });
  test('environment-specific kind or standing raises ENV-SPECIFIC', () => {
    expect(rationaleBadgesFor({ kind: 'environment-specific', standing: 'environment-specific' })).toContain('ENV-SPECIFIC');
  });
  test('a current verified record raises no badge, order is fixed', () => {
    expect(rationaleBadgesFor({ kind: 'source-verified', standing: 'source-verified', freshness: { demoted: false, appliedCase: null } })).toEqual([]);
    expect(rationaleBadgesFor({ kind: 'superseded', standing: 'unverified-hypothesis', freshness: { demoted: true, appliedCase: 'EVID-STALE' } })).toEqual([
      'SUPERSEDED',
      'UNVERIFIED',
      'STALE-EVIDENCE',
    ]);
  });
});

describe('formatRationaleProvenance', () => {
  test('renders the full provenance triple plus freshness', () => {
    const rows = formatRationaleProvenance({
      id: 'pk-abcdef123456',
      sourceFile: 'math.ts',
      sourceSymbol: 'fn:add',
      observedAt: '2026-10-20T00:00:00.000Z',
      validationMethod: 'rg-resolve',
      confidence: 0.7,
      invalidationConditions: ['SRC-EDIT'],
      freshness: { demoted: false, appliedCase: null },
    });
    expect(rows).toEqual([
      ['record', 'pk-abcdef123456'],
      ['source', 'math.ts · fn:add'],
      ['observedAt', '2026-10-20T00:00:00.000Z'],
      ['validationMethod', 'rg-resolve'],
      ['confidence', '0.7'],
      ['invalidation', 'SRC-EDIT'],
      ['freshness', 'current'],
    ]);
  });
  test('demotions and gaps read honestly, never invented', () => {
    const rows = formatRationaleProvenance({
      id: 'pk-abcdef123456',
      freshness: { demoted: true, appliedCase: 'HEAD-MOVE' },
    });
    expect(rows.find((row) => row[0] === 'freshness')).toEqual(['freshness', 'demoted HEAD-MOVE']);
    expect(rows.find((row) => row[0] === 'source')).toEqual(['source', '— · —']);
    expect(rows.find((row) => row[0] === 'confidence')).toEqual(['confidence', '—']);
  });
});

describe('resolveRationaleStatus', () => {
  test('disconnected and error come before loading', () => {
    expect(resolveRationaleStatus({ connected: false, error: null, loaded: false, ranked: null })).toBe('disconnected');
    expect(resolveRationaleStatus({ connected: true, error: 'boom', loaded: false, ranked: null })).toBe('error');
    expect(resolveRationaleStatus({ connected: true, error: null, loaded: false, ranked: null })).toBe('loading');
  });
  test('a loaded rank is ready only when non-empty, else the caller renders nothing', () => {
    expect(resolveRationaleStatus({ connected: true, error: null, loaded: true, ranked: [{ id: 'x' }] })).toBe('ready');
    expect(resolveRationaleStatus({ connected: true, error: null, loaded: true, ranked: [] })).toBe('empty');
  });
});

describe('code view strings', () => {
  const keys = [
    'viewRun',
    'viewCode',
    'codeTitle',
    'codeLoading',
    'codeEmptyTitle',
    'codeEmptyBody',
    'codeStale',
    'codeErrorTitle',
    'codeSearchPlaceholder',
    'codeSearchButton',
    'codeTaskUnavailableTitle',
    'codeTaskUnavailableBody',
    'codeNoMatches',
    'rationaleTitle',
    'rationaleLoading',
    'rationaleErrorTitle',
    'rationaleRecorded',
  ] as const;
  test('every locale carries every new key with real text', () => {
    expect(DAG_PANE_LOCALES).toHaveLength(13);
    for (const locale of DAG_PANE_LOCALES) {
      const strings = stringsFor(locale);
      for (const key of keys) {
        expect(strings[key].length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });
  test('no non-English locale leans on English stand-ins', () => {
    const english = stringsFor('en');
    for (const locale of DAG_PANE_LOCALES) {
      if (locale === 'en') {
        continue;
      }
      const strings = stringsFor(locale);
      const identical = keys.filter((key) => strings[key] === english[key]);
      // Badge-adjacent chrome may share a word or two across languages;
      // a wholesale English copy would match nearly every key.
      expect(identical.length, `${locale}: ${identical.join(',')}`).toBeLessThan(keys.length / 2);
    }
  });
});
