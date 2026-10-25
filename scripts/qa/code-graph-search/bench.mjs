/**
 * Code-graph search benchmark: the acceptance harness for search quality.
 *
 * One command runs the whole case set through the real runtime surface and
 * prints top-1 success, recall@5, first-result relevance, per-kind p50/p95
 * latency, indexed coverage and freshness. It exits non-zero when any case
 * fails, so a regression cannot pass silently.
 *
 * Usage: bun scripts/qa/code-graph-search/bench.mjs [--directory <dir>] [--json <out>] [--reps 3]
 *
 * Coverage instrument: the runtime takes its fsPromises from the caller, so
 * this harness hands it a counting proxy. A query that still walks the tree
 * shows a non-zero read counter; a query answered from the in-memory index
 * shows zero, which is the evidence criterion 3 asks for.
 */

import { promises as realFsPromises } from 'node:fs';
import path from 'node:path';

const argOf = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const directory = path.resolve(argOf('--directory', 'I:/AlRepo'));
const jsonOut = argOf('--json', '');
const reps = Number(argOf('--reps', '3'));

const counters = { readdir: 0, stat: 0, readFile: 0, other: 0 };
// .git metadata is read on every query to bind the revision; that is three cheap
// stat/read calls, not a tree walk, so it is excluded from the walk counter.
const isGitMeta = (target) => String(target ?? '').replace(/\\/g, '/').split('/').includes('.git');
const countingFs = {
  ...realFsPromises,
  readdir: (target, ...rest) => { if (!isGitMeta(target)) counters.readdir += 1; return realFsPromises.readdir(target, ...rest); },
  stat: (target, ...rest) => { if (!isGitMeta(target)) counters.stat += 1; return realFsPromises.stat(target, ...rest); },
  readFile: (target, ...rest) => { if (!isGitMeta(target)) counters.readFile += 1; return realFsPromises.readFile(target, ...rest); },
};
const fsTotal = () => counters.readdir + counters.stat + counters.readFile;
const resetFs = () => { counters.readdir = 0; counters.stat = 0; counters.readFile = 0; counters.other = 0; };

const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)].toFixed(2));
};

const itemId = (item) => String(item?.id ?? '');
const fileOf = (item) => String(item?.file ?? '').replace(/\\/g, '/');

const runOnce = async (runtime, input) => {
  const start = process.hrtime.bigint();
  const value = await runtime.query(directory, input);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { value, ms: Number(ms.toFixed(2)) };
};

/** Cases: predicate returns null on PASS or a string reason on FAIL. */
const buildCases = ({ createProjectId, slugifyId, traceFromId, traceToId }) => [
  {
    id: 'search-exact-name',
    criterion: 2,
    input: { kind: 'search', query: 'createProject', limit: 20 },
    expect: (items) => (items[0]?.reason === 'exact-name' ? null : `first reason ${items[0]?.reason ?? 'none'}, wanted exact-name`),
    contains: 'createProject',
  },
  {
    id: 'search-prefix',
    criterion: 2,
    input: { kind: 'search', query: 'createProj', limit: 20 },
    expect: (items) => (items[0]?.reason === 'prefix' ? null : `first reason ${items[0]?.reason ?? 'none'}, wanted prefix`),
    contains: 'createProject',
  },
  {
    id: 'search-typo-fuzzy',
    criterion: 2,
    input: { kind: 'search', query: 'slugfy', limit: 20 },
    expect: (items) => (items.slice(0, 5).some((item) => itemId(item).includes('slugify')) ? null : 'no slugify in top 5'),
    recall: 'slugify',
  },
  {
    id: 'search-camel-token',
    criterion: 2,
    input: { kind: 'search', query: 'slugifyModel', limit: 20 },
    expect: (items) => (items.slice(0, 5).some((item) => itemId(item).toLowerCase().includes('slugifymodel')) ? null : 'no slugifyModel in top 5'),
    recall: 'slugifymodel',
  },
  {
    id: 'search-ambiguous-short',
    criterion: 2,
    input: { kind: 'search', query: 'd', limit: 20 },
    expect: (items) => {
      if (items.length < 2) return `only ${items.length} candidates`;
      if (new Set(items.map(fileOf)).size < 2) return 'all candidates share one file';
      const incomplete = items.find((item) => !item.reason || !item.file || item.line === undefined);
      return incomplete ? `candidate without reason/file/line: ${itemId(incomplete)}` : null;
    },
  },
  {
    id: 'search-basename',
    criterion: 2,
    input: { kind: 'search', query: 'operations.ts', limit: 20 },
    expect: (items) => (itemId(items[0]).startsWith('file:') && fileOf(items[0]).endsWith('/operations.ts') ? null : `first item ${itemId(items[0])}`),
  },
  {
    id: 'search-relative-path',
    criterion: 2,
    input: { kind: 'search', query: 'api/src/domains/projects/operations.ts', limit: 20 },
    expect: (items) => (items.length > 0 && fileOf(items[0]).endsWith('domains/projects/operations.ts') ? null : `first item ${itemId(items[0])}`),
  },
  {
    id: 'search-empty-query',
    criterion: 2,
    input: { kind: 'search', query: '   ', limit: 20 },
    expect: (items, envelope) => (items.length === 0 && (envelope.unresolved ?? []).length > 0 ? null : `empty query returned ${items.length} items`),
  },
  {
    id: 'search-missing-symbol',
    criterion: 2,
    input: { kind: 'search', query: 'zzzNoSuchSymbolAnywhere', limit: 20 },
    expect: (items, envelope) => (items.length === 0 && envelope.coverage === 'indexed' ? null : `coverage ${envelope.coverage} items ${items.length}`),
  },
  {
    id: 'content-literal',
    criterion: 3,
    input: { kind: 'content', query: 'Amount must be a positive integer', limit: 20 },
    expect: (items) => {
      if (items.length === 0) return 'no content hit';
      const hit = items.find((item) => fileOf(item).endsWith('selfserve-billing.ts'));
      if (!hit) return 'literal found only outside the expected file';
      if (!['literal', 'phrase', 'token'].includes(String(hit.reason))) return `unexpected reason ${hit.reason}`;
      return null;
    },
    offline: true,
  },
  {
    id: 'content-multi-term',
    criterion: 3,
    input: { kind: 'content', query: 'positive integer', limit: 20 },
    expect: (items) => (items.length > 0 && items.every((item) => String(item.excerpt ?? '').toLowerCase().includes('integer')) ? null : 'multi-term hits missing a term'),
    offline: true,
  },
  {
    id: 'content-path-filter',
    criterion: 3,
    input: { kind: 'content', query: 'positive integer', limit: 20, pathPrefix: 'apps/api/src/domains/customers/' },
    expect: (items) => (items.length > 0 && items.every((item) => fileOf(item).includes('/customers/') || fileOf(item).startsWith('customers/')) ? null : 'path filter not honoured'),
    offline: true,
  },
  {
    id: 'content-kind-test-filter',
    criterion: 3,
    input: { kind: 'content', query: 'describe(', limit: 20, contentKind: 'test' },
    expect: (items) => (items.length > 0 && items.every((item) => /__tests__|\.test\.|\.spec\./.test(fileOf(item)) || /\.test\.|\.spec\./.test(fileOf(item))) ? null : 'test filter not honoured'),
    offline: true,
  },
  {
    id: 'file-view',
    criterion: 4,
    input: { kind: 'file', file: 'apps/api/src/domains/projects/operations.ts', limit: 50 },
    expect: (items, envelope) => (envelope.coverage === 'indexed' && items.length > 0 ? null : `coverage ${envelope.coverage}`),
  },
  {
    id: 'file-beyond-walk-cap',
    criterion: 1,
    input: { kind: 'file', file: 'apps/api/src/routes/__tests__/auth.test.ts', limit: 50 },
    expect: (items, envelope) => (envelope.coverage === 'indexed' && items.length > 0 ? null : `file is ${envelope.coverage}: the walk cap still hides it`),
  },
  {
    id: 'context-bounded',
    criterion: 4,
    input: { kind: 'context', symbol: createProjectId, limit: 20 },
    expect: (items, envelope) => {
      if (items.length === 0 || typeof envelope.truncated !== 'boolean') return 'context not bounded';
      if (!Array.isArray(envelope.callers) || !Array.isArray(envelope.callees)) return 'context omits callers/callees';
      if (envelope.callers.length === 0) return 'no caller recorded for a called symbol';
      return null;
    },
  },
  {
    id: 'impact-bounded',
    criterion: 4,
    input: { kind: 'impact', symbol: slugifyId, limit: 20 },
    expect: (items, envelope) => (items.length > 0 && typeof envelope.truncated === 'boolean' ? null : 'impact not bounded'),
  },
  {
    id: 'tests-bounded',
    criterion: 4,
    input: { kind: 'tests', target: createProjectId, limit: 20 },
    expect: (items, envelope) => (Array.isArray(items) && typeof envelope.truncated === 'boolean' ? null : 'tests not bounded'),
  },
  {
    id: 'trace-directed',
    criterion: 4,
    // Endpoints come from a real CALLS_STATIC edge discovered at run time: the
    // target repository is a live working tree, so a hard-coded pair silently
    // stops existing (measured: the tree moved 1074 -> 1193 files between runs).
    input: { kind: 'trace', from: traceFromId, to: traceToId, limit: 20 },
    expect: (items) => (items.length >= 2 ? null : `trace returned ${items.length} nodes for ${traceFromId} -> ${traceToId}`),
  },
  {
    id: 'explore-modules',
    criterion: 4,
    input: { kind: 'explore', limit: 50 },
    expect: (items, envelope) => ((envelope.modules ?? []).length > 0 ? null : 'no modules'),
  },
  {
    id: 'no-same-file-inference',
    criterion: 4,
    input: { kind: 'context', symbol: createProjectId, limit: 50 },
    expect: (items) => {
      const sibling = items.find((item) => itemId(item).includes('const:doc@') && String(item.evidence?.[0]?.edge ?? '') === 'CALLS_STATIC');
      return sibling ? 'sibling const reported as a caller' : null;
    },
  },
];

const main = async () => {
  const mod = await import('../../../packages/web/server/lib/code-graph/runtime.js');
  const runtime = mod.createCodeGraphRuntime({ fsPromises: countingFs, path });

  resetFs();
  const indexStart = process.hrtime.bigint();
  const index = await runtime.readIndex(directory, { refresh: true });
  const indexMs = Number(process.hrtime.bigint() - indexStart) / 1e6;
  const indexFsCalls = fsTotal();

  const resolveId = async (query, prefix) => {
    const found = await runtime.query(directory, { kind: 'search', query, limit: 10 });
    const items = Array.isArray(found?.items) ? found.items : [];
    const hit = items.find((item) => String(item.id).startsWith(prefix)) ?? items[0];
    if (!hit) throw new Error(`could not resolve a subject id for "${query}" (prefix ${prefix})`);
    return String(hit.id);
  };
  const createProjectId = await resolveId('createProject', 'const:createProject@');
  const slugifyId = await resolveId('slugify', 'fn:slugify@');
  const contextProbe = await runtime.query(directory, { kind: 'context', symbol: createProjectId, limit: 20 });
  const callerId = contextProbe?.callers?.[0]?.id;
  const calleeId = contextProbe?.callees?.[0]?.id;
  const traceFromId = typeof callerId === 'string' ? callerId : createProjectId;
  const traceToId = typeof callerId === 'string' ? createProjectId : (typeof calleeId === 'string' ? calleeId : slugifyId);
  const cases = buildCases({ createProjectId, slugifyId, traceFromId, traceToId });

  const results = [];
  for (const testCase of cases) {
    const samples = [];
    let envelope = null;
    let failure = null;
    for (let attempt = 0; attempt < Math.max(1, reps); attempt += 1) {
      resetFs();
      try {
        const sample = await runOnce(runtime, testCase.input);
        samples.push(sample.ms);
        envelope = sample.value;
      } catch (caught) {
        failure = caught instanceof Error ? caught.message : String(caught);
        break;
      }
    }
    const items = Array.isArray(envelope?.items) ? envelope.items : [];
    const fsCalls = fsTotal();
    const reason = failure ?? (envelope ? testCase.expect(items, envelope) : 'no envelope');
    if (reason === null && testCase.offline === true && fsCalls > 0) {
      failure = `query touched the filesystem ${fsCalls} time(s): answered by walking, not by the index`;
    }
    const wanted = testCase.contains ?? testCase.recall ?? null;
    results.push({
      id: testCase.id,
      criterion: testCase.criterion,
      kind: testCase.input.kind,
      pass: failure === null && reason === null,
      reason: failure ?? reason,
      p50: percentile(samples, 50),
      p95: percentile(samples, 95),
      items: items.length,
      coverage: envelope?.coverage ?? null,
      truncated: envelope?.truncated ?? null,
      indexTruncated: envelope?.indexTruncated ?? null,
      fsCalls,
      top1: wanted === null ? null : items.length > 0 && JSON.stringify(items[0] ?? {}).toLowerCase().includes(wanted.toLowerCase()),
      recall5: wanted === null ? null : items.slice(0, 5).some((item) => JSON.stringify(item).toLowerCase().includes(wanted.toLowerCase())),
    });
  }

  const scored = results.filter((r) => r.top1 !== null);
  const top1Rate = scored.length === 0 ? null : scored.filter((r) => r.top1).length / scored.length;
  const recallRate = scored.length === 0 ? null : scored.filter((r) => r.recall5).length / scored.length;
  const failures = results.filter((r) => !r.pass);

  const report = {
    directory,
    generatedAt: new Date().toISOString(),
    reps,
    index: {
      eligibleNote: 'see scripts/qa/code-graph-search/baseline.mjs for the uncapped eligible count',
      entryCount: index.entryCount,
      fileCount: index.nodeCount,
      edgeCount: index.edgeCount,
      indexTruncated: index.indexTruncated ?? index.truncated ?? false,
      excludedCount: index.excludedCount ?? 0,
      revision: index.revision,
      freshness: index.freshness,
      snapshotRoot: index.snapshotRoot,
      buildMs: Number(indexMs.toFixed(2)),
      fsCallsDuringBuild: indexFsCalls,
    },
    metrics: { top1: top1Rate, recallAt5: recallRate, cases: results.length, passed: results.length - failures.length, failed: failures.length },
    cases: results,
  };

  const pad = (value, width) => String(value).padEnd(width);
  console.log(`code-graph search bench — ${directory} (revision ${String(report.index.revision).slice(0, 9)})`);
  console.log(`${pad('case', 28)}${pad('kind', 9)}${pad('p50', 9)}${pad('p95', 9)}${pad('items', 7)}${pad('fs', 5)}${pad('coverage', 11)}result`);
  for (const row of results) {
    console.log(`${pad(row.id, 28)}${pad(row.kind, 9)}${pad(row.p50 ?? '-', 9)}${pad(row.p95 ?? '-', 9)}${pad(row.items, 7)}${pad(row.fsCalls, 5)}${pad(row.coverage ?? '-', 11)}${row.pass ? 'PASS' : `FAIL ${row.reason}`}`);
  }
  console.log(`\ntop-1 ${top1Rate === null ? 'n/a' : `${(top1Rate * 100).toFixed(1)}%`}  recall@5 ${recallRate === null ? 'n/a' : `${(recallRate * 100).toFixed(1)}%`}  passed ${results.length - failures.length}/${results.length}`);
  console.log(`index: entries ${report.index.entryCount} files ${report.index.fileCount} edges ${report.index.edgeCount} indexTruncated ${report.index.indexTruncated} excluded ${report.index.excludedCount} freshness ${report.index.freshness} build ${report.index.buildMs}ms`);

  const text = JSON.stringify(report, null, 2);
  if (jsonOut) {
    await realFsPromises.mkdir(path.dirname(path.resolve(jsonOut)), { recursive: true });
    await realFsPromises.writeFile(path.resolve(jsonOut), `${text}\n`, 'utf8');
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} case(s) failed`);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
