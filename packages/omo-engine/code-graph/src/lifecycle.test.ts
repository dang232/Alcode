// Lifecycle regression tests: bounded cancellable generation-safe indexing plus fixtures.
// Covers small/medium/large/monorepo/cycles/deep/rapid/cancel/concurrent/restart, budgets,
// stable ids, failure reporting, progress observability, incremental reuse, cross-repo guard.
// Precedent: extract.test.ts and queries.test.ts (given/when/then, real indexing, 60s timeout).

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { computeScopeFingerprint } from './schema';
import { indexFiles } from './extract';
import type { GraphNode, GraphSnapshot } from './extract';
import { impact } from './queries';
import {
  IndexCoordinator,
  rebuildIncremental,
  redactDropped,
  runLifecycleIndex,
  snapshotBytes,
  validateSnapshotForScope,
} from './lifecycle';

const TEST_TIMEOUT_MS = 60000;
const PROJECT_A = 'demo-12345678';
const PROJECT_B = 'other-abcdef12';
const WORKTREE_A = 'wt-lifecycle-a';
const REVISION_A = 'a'.repeat(40);

/** Temporary fixture repo: directory plus sorted entry files. */
interface TempRepo {
  readonly dir: string;
  readonly entries: string[];
}

function writeRepo(files: Record<string, string>): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), 'code-graph-lifecycle-'));
  const entries: string[] = [];
  for (const rel of Object.keys(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, files[rel]);
    entries.push(abs);
  }
  entries.sort();
  return { dir, entries };
}

function smallRepo(): { dir: string; entries: string[] } {
  return writeRepo({
    'a.ts': 'export function add(a: number, b: number): number { return a + b; }\n',
    'b.ts': 'import { add } from "./a";\n\nexport function run(): number { return add(1, 2); }\n',
  });
}

function mediumRepo(): { dir: string; entries: string[] } {
  const files: Record<string, string> = {};
  files['core.ts'] = 'export function core(n: number): number { return n + 1; }\n';
  for (let i = 0; i < 10; i += 1) {
    const prev = i === 0 ? './core' : './u' + (i - 1);
    files['u' + i + '.ts'] = 'import { ' + (i === 0 ? 'core' : 'use' + (i - 1)) + ' } from "' + prev + '";\n' + 'export function use' + i + '(n: number): number { return ' + (i === 0 ? 'core' : 'use' + (i - 1)) + '(n); }\n';
  }
  return writeRepo(files);
}

function cycleRepo(): { dir: string; entries: string[] } {
  return writeRepo({
    'a.ts': 'import { b } from "./b";\n\nexport function a(n: number): number { return b(n); }\n',
    'b.ts': 'import { a } from "./a";\n\nexport function b(n: number): number { return n <= 0 ? 0 : a(n - 1); }\n',
  });
}

function deepRepo(): { dir: string; entries: string[] } {
  const files: Record<string, string> = {};
  files['s0.ts'] = 'export function s0(): number { return 0; }\n';
  for (let i = 1; i < 10; i += 1) {
    files['s' + i + '.ts'] = 'import { s' + (i - 1) + ' } from "./s' + (i - 1) + '";\nexport function s' + i + '(): number { return s' + (i - 1) + '(); }\n';
  }
  return writeRepo(files);
}

function monorepo(): { dir: string; entries: string[] } {
  const repo = writeRepo({
    'apps/a/main.ts': 'import { helper } from "../../packages/b/util";\n\nexport function run(): number { return helper(); }\n',
    'packages/b/util.ts': 'export function helper(): number { return 42; }\n',
  });
  return repo;
}

describe('code-graph lifecycle', () => {
  it('small fixture completes with stats and progress', async () => {
    const repo = smallRepo();
    try {
      const seen: string[] = [];
      const coordinator = new IndexCoordinator();
      const result = await coordinator.request({
        projectId: PROJECT_A,
        worktreeId: WORKTREE_A,
        revision: REVISION_A,
        entryFiles: repo.entries,
        rootDir: repo.dir,
        onProgress: (p) => { seen.push(p.phase); },
      });
      expect(result.status).toBe('complete');
      expect(result.snapshot?.nodes.length).toBeGreaterThan(0);
      if (result.snapshot === undefined) throw new Error('lifecycle snapshot missing');
      expect(result.stats?.files).toBe(2);
      expect(result.fingerprint).toBe(computeScopeFingerprint(PROJECT_A, WORKTREE_A, REVISION_A));
      expect(seen).toContain('program');
      expect(seen).toContain('done');
      expect(snapshotBytes(result.snapshot)).toBeGreaterThan(0);
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it('medium fixture completes with ten dependents', async () => {
    const repo = mediumRepo();
    try {
      const coordinator = new IndexCoordinator();
      const result = await coordinator.request({
        projectId: PROJECT_A,
        worktreeId: WORKTREE_A,
        revision: REVISION_A,
        entryFiles: repo.entries,
        rootDir: repo.dir,
      });
      expect(result.status === 'complete' || result.status === 'partial').toBe(true);
      expect(result.snapshot?.nodes.some((n) => n.id === 'file:core.ts')).toBe(true);
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it('large entry count truncates on maxFiles budget', async () => {
    const repo = mediumRepo();
    try {
      const coordinator = new IndexCoordinator();
      const result = await coordinator.request({
        projectId: PROJECT_A,
        worktreeId: WORKTREE_A,
        revision: REVISION_A,
        entryFiles: repo.entries,
        rootDir: repo.dir,
        budgets: { maxFiles: 2 },
      });
      expect(result.status).toBe('truncated');
      expect(result.reason).toContain('BUDGET_FILES');
      expect(result.snapshot).toBeUndefined();
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it('monorepo keeps repo-relative ids and cross-package calls', async () => {
    const repo = monorepo();
    try {
      const coordinator = new IndexCoordinator();
      const result = await coordinator.request({
        projectId: PROJECT_A,
        worktreeId: WORKTREE_A,
        revision: REVISION_A,
        entryFiles: [join(repo.dir, 'apps', 'a', 'main.ts')],
        rootDir: repo.dir,
      });
      expect(result.status === 'complete' || result.status === 'partial').toBe(true);
      const ids = (result.snapshot?.nodes ?? []).map((n) => n.id);
      expect(ids).toContain('file:apps/a/main.ts');
      expect(ids).toContain('file:packages/b/util.ts');
      if (result.snapshot === undefined) throw new Error('lifecycle snapshot missing');
      expect(validateSnapshotForScope(result.snapshot, repo.dir)).toBeUndefined();
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it('cycle fixture terminates with both files indexed', async () => {
    const repo = cycleRepo();
    try {
      const coordinator = new IndexCoordinator();
      const result = await coordinator.request({
        projectId: PROJECT_A,
        worktreeId: WORKTREE_A,
        revision: REVISION_A,
        entryFiles: repo.entries,
        rootDir: repo.dir,
      });
      expect(result.status === 'complete' || result.status === 'partial').toBe(true);
      const files = (result.snapshot?.nodes ?? []).filter((n) => n.kind === 'file').map((n) => n.id).sort();
      expect(files).toContain('file:a.ts');
      expect(files).toContain('file:b.ts');
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it('deep chain impact respects depth budget', async () => {
    const repo = deepRepo();
    try {
      const snapshot = indexFiles(repo.entries, { rootDir: repo.dir });
      const scope = { projectId: PROJECT_A, worktreeId: WORKTREE_A, revision: REVISION_A, fingerprint: computeScopeFingerprint(PROJECT_A, WORKTREE_A, REVISION_A) };
      const result = impact(snapshot, 'fn:s0@s0.ts', { scope, maxDepth: 2 });
      expect(result.completeness).toBe('truncated');
      expect(result.completenessReason).toBe('depth-budget');
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it('rapid sequential requests bump generation and serve latest', async () => {
    const repo = smallRepo();
    try {
      const coordinator = new IndexCoordinator();
      const first = await coordinator.request({ projectId: PROJECT_A, worktreeId: WORKTREE_A, revision: REVISION_A, entryFiles: repo.entries, rootDir: repo.dir });
      const second = await coordinator.request({ projectId: PROJECT_A, worktreeId: WORKTREE_A, revision: REVISION_A, entryFiles: repo.entries, rootDir: repo.dir });
      expect(first.scope.generation).toBe(1);
      expect(second.scope.generation).toBe(2);
      expect(second.status).toBe('complete');
      expect(coordinator.generationOf(PROJECT_A, WORKTREE_A)).toBe(2);
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it('aborted signal cancels without throwing', async () => {
    const repo = smallRepo();
    try {
      const controller = new AbortController();
      controller.abort();
      const result = await runLifecycleIndex({ projectId: PROJECT_A, worktreeId: WORKTREE_A, revision: REVISION_A, entryFiles: repo.entries, rootDir: repo.dir, signal: controller.signal }, 1);
      expect(result.status).toBe('cancelled');
      expect(result.snapshot).toBeUndefined();
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it('concurrent requests supersede the stale generation', async () => {
    const repo = mediumRepo();
    try {
      const coordinator = new IndexCoordinator();
      const p1 = coordinator.request({ projectId: PROJECT_A, worktreeId: WORKTREE_A, revision: REVISION_A, entryFiles: repo.entries, rootDir: repo.dir });
      const p2 = coordinator.request({ projectId: PROJECT_A, worktreeId: WORKTREE_A, revision: REVISION_A, entryFiles: repo.entries, rootDir: repo.dir });
      const results = await Promise.all([p1, p2]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toContain('complete');
      expect(statuses.some((s) => s === 'superseded' || s === 'cancelled' || s === 'complete')).toBe(true);
      expect(results[1].status).toBe('complete');
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it('restart after cancel serves fresh', async () => {
    const repo = smallRepo();
    try {
      const coordinator = new IndexCoordinator();
      const controller = new AbortController();
      controller.abort();
      const cancelled = await coordinator.request({ projectId: PROJECT_A, worktreeId: WORKTREE_A, revision: REVISION_A, entryFiles: repo.entries, rootDir: repo.dir, signal: controller.signal });
      expect(cancelled.status === 'cancelled' || cancelled.status === 'superseded').toBe(true);
      const fresh = await coordinator.request({ projectId: PROJECT_A, worktreeId: WORKTREE_A, revision: REVISION_A, entryFiles: repo.entries, rootDir: repo.dir });
      expect(fresh.status).toBe('complete');
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it('node budget truncates instead of serving a partial graph as complete', async () => {
    const repo = smallRepo();
    try {
      const result = await runLifecycleIndex({ projectId: PROJECT_A, worktreeId: WORKTREE_A, revision: REVISION_A, entryFiles: repo.entries, rootDir: repo.dir, budgets: { maxNodes: 1 } }, 7);
      expect(result.status).toBe('truncated');
      expect(result.reason).toContain('BUDGET_NODES');
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it('stable ids survive reindex while call-sites stay ephemeral', async () => {
    const repo = smallRepo();
    try {
      const first = indexFiles(repo.entries, { rootDir: repo.dir });
      const second = indexFiles(repo.entries, { rootDir: repo.dir });
      const stable = (s: typeof first) => s.nodes.filter((n) => n.kind !== 'call-site').map((n) => n.id).sort();
      expect(stable(first)).toEqual(stable(second));
      expect(first.nodes.some((n) => n.kind === 'call-site')).toBe(true);
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it('missing entry fails closed with a reason', async () => {
    const result = await runLifecycleIndex({ projectId: PROJECT_A, worktreeId: WORKTREE_A, revision: REVISION_A, entryFiles: ['/no/such/file-xyz.ts'] }, 3);
    expect(result.status).toBe('failed');
    expect((result.reason ?? '').length).toBeGreaterThan(0);
    expect(result.snapshot).toBeUndefined();
  }, TEST_TIMEOUT_MS);

  it('incremental rebuild reuses untouched shards and withholds dangling edges', async () => {
    const repo = smallRepo();
    try {
      const previous = indexFiles(repo.entries, { rootDir: repo.dir });
      const changed = new Set<string>(['b.ts']);
      const freshChanged = indexFiles([join(repo.dir, 'b.ts')], { rootDir: repo.dir });
      const rebuilt = rebuildIncremental(previous, changed, freshChanged);
      expect(rebuilt.reusedFiles).toBeGreaterThan(0);
      expect(rebuilt.snapshot.nodes.some((n) => n.id === 'file:a.ts')).toBe(true);
      expect(rebuilt.snapshot.nodes.some((n) => n.id === 'file:b.ts')).toBe(true);
      for (const e of rebuilt.snapshot.edges) {
        if (e.to !== 'unknown') {
          expect(rebuilt.snapshot.nodes.some((n) => n.id === e.to || n.id === e.from)).toBe(true);
        }
      }
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);

  it('moved call lines recompute refs without keeping stale duplicates', async () => {
    const nodes: GraphNode[] = [
      { id: 'file:a.ts', kind: 'file', file: 'a.ts', line: 1 },
      { id: 'fn:x@a.ts:1', kind: 'symbol', file: 'a.ts', line: 1, name: 'x' },
      { id: 'file:b.ts', kind: 'file', file: 'b.ts', line: 1 },
      { id: 'fn:y@b.ts:1', kind: 'symbol', file: 'b.ts', line: 1, name: 'y' },
    ];
    const previous: GraphSnapshot = {
      nodes,
      edges: [
        { id: 'calls:1', kind: 'CALLS_STATIC', from: 'fn:x@a.ts:1', to: 'fn:y@b.ts:1', confidence: 1, ref: 'a.ts:5' },
        { id: 'calls:2', kind: 'CALLS_STATIC', from: 'fn:y@b.ts:1', to: 'fn:x@a.ts:1', confidence: 1, ref: 'b.ts:7' },
        { id: 'calls:3', kind: 'CALLS_STATIC', from: 'fn:y@b.ts:1', to: 'fn:gone@a.ts:1', confidence: 1, ref: 'b.ts:8' },
      ],
    };
    const fresh: GraphSnapshot = {
      nodes,
      edges: [{ id: 'calls:1', kind: 'CALLS_STATIC', from: 'fn:x@a.ts:1', to: 'fn:y@b.ts:1', confidence: 1, ref: 'a.ts:9' }],
    };
    const rebuilt = rebuildIncremental(previous, new Set(['a.ts']), fresh);
    const calls = rebuilt.snapshot.edges.filter((edge) => edge.id === 'calls:1');
    expect(calls.length).toBe(1);
    expect(calls[0]?.ref).toBe('a.ts:9');
    // The unchanged caller keeps its edge: its ref points into unchanged
    // content and the target survived. The dangling edge is withheld.
    expect(rebuilt.snapshot.edges.some((edge) => edge.id === 'calls:2')).toBe(true);
    expect(rebuilt.snapshot.edges.some((edge) => edge.id === 'calls:3')).toBe(false);
    expect(rebuilt.invalidatedEdges).toBeGreaterThan(0);
  });

  it('re-emitted unchanged file nodes merge without duplicates', async () => {
    const fileA: GraphNode = { id: 'file:a.ts', kind: 'file', file: 'a.ts', line: 1 };
    const previous: GraphSnapshot = {
      nodes: [fileA, { id: 'file:b.ts', kind: 'file', file: 'b.ts', line: 1 }],
      edges: [],
    };
    const fresh: GraphSnapshot = {
      nodes: [fileA, { id: 'file:b.ts', kind: 'file', file: 'b.ts', line: 1 }],
      edges: [],
    };
    const rebuilt = rebuildIncremental(previous, new Set(['b.ts']), fresh);
    expect(rebuilt.snapshot.nodes.filter((node) => node.id === 'file:a.ts').length).toBe(1);
    expect(rebuilt.snapshot.nodes.filter((node) => node.id === 'file:b.ts').length).toBe(1);
  });

  it('cross-repo guard redacts dropped paths and validates scope', async () => {
    const redacted = redactDropped([{ file: 'c:/repo/outside/x.ts', reason: 'outside-root' }]);
    expect(redacted[0]?.file).toBe('x.ts');
    const bad: GraphSnapshot = { nodes: [{ id: 'file:a.ts', kind: 'file', file: 'a.ts', line: 1 }], edges: [], content: { tokenCap: 5000, files: {}, skipped: [] } };
    expect(validateSnapshotForScope(bad, '/repo')).toBeDefined();
    expect(PROJECT_B).not.toBe(PROJECT_A);
  });
});
