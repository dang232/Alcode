/**
 * Phase-0 baseline for code-graph search: what the real runtime indexes for a
 * repository, and how fast its query surface answers.
 *
 * Usage: bun scripts/qa/code-graph-search/baseline.mjs [--directory <dir>] [--json <out>]
 *
 * The walk below mirrors runtime.js exactly (sorted depth-first, same skipped
 * directories, same extension filter) so the capped entry list this script
 * measures is the one the runtime builds, and the uncapped count is the true
 * eligible population.
 */

import { promises as fsPromises } from 'node:fs';
import path from 'node:path';

const SKIPPED_DIRS = new Set([
  'node_modules', '.git', '.omo', 'web-dist', 'dist', 'dist-bundle', 'build', 'out', 'coverage',
  '.next', '.nuxt', 'vendor', 'ios', 'android', 'Pods', '.turbo', '.parcel-cache',
]);
const ENTRY_FILE = /\.[cm]?[tj]sx?$/;
const MAX_ENTRY_FILES = 500;

const argOf = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const directory = path.resolve(argOf('--directory', 'I:/AlRepo'));
const jsonOut = argOf('--json', '');

const walk = async ({ cap }) => {
  const entries = [];
  let truncated = false;
  const visit = async (dir) => {
    if (truncated && cap) return;
    let names = [];
    try {
      names = await fsPromises.readdir(dir);
    } catch {
      return;
    }
    names.sort();
    for (const name of names) {
      if (truncated && cap) return;
      const full = path.join(dir, name);
      let stat = null;
      try {
        stat = await fsPromises.stat(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (SKIPPED_DIRS.has(name)) continue;
        await visit(full);
      } else if (stat.isFile() && ENTRY_FILE.test(name)) {
        if (entries.length >= cap) {
          truncated = true;
          return;
        }
        entries.push(full);
      }
    }
  };
  await visit(directory);
  entries.sort();
  return { entries, truncated };
};

const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(2));
};

const time = async (fn) => {
  const start = process.hrtime.bigint();
  const value = await fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { value, ms: Number(ms.toFixed(2)) };
};

const languageOf = (file) => {
  const match = /\.([cm]?[tj]sx?)$/.exec(file);
  return match ? match[1] : 'unknown';
};

const main = async () => {
  const runtimeModule = await import('../../../packages/web/server/lib/code-graph/runtime.js');
  const engine = await import('../../../packages/web/server/lib/code-graph/code-graph.bundle.js');
  const runtime = runtimeModule.createCodeGraphRuntime({ fsPromises, path });

  const uncapped = await walk({ cap: Number.POSITIVE_INFINITY });
  const capped = await walk({ cap: MAX_ENTRY_FILES });

  const indexBuild = await time(() => engine.indexFiles(capped.entries));
  const snapshot = indexBuild.value;
  const nodes = snapshot.nodes ?? [];
  const edges = snapshot.edges ?? [];

  const fileNodes = nodes.filter((node) => String(node.id).startsWith('file:'));
  const indexedRelative = new Set(
    fileNodes.map((node) => String(node.id).slice('file:'.length)),
  );
  const eligibleRelative = uncapped.entries.map((entry) => path.relative(directory, entry).split(path.sep).join('/'));
  const missing = eligibleRelative.filter((rel) => ![...indexedRelative].some((id) => id === rel || id.endsWith(`/${rel}`) || rel.endsWith(`/${id}`)));
  const missingByTop = new Map();
  for (const rel of missing) {
    const top = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '(root)';
    missingByTop.set(top, (missingByTop.get(top) ?? 0) + 1);
  }

  const edgeKinds = new Map();
  for (const edge of edges) edgeKinds.set(edge.kind, (edgeKinds.get(edge.kind) ?? 0) + 1);
  const nodeKinds = new Map();
  for (const node of nodes) {
    const kind = String(node.id).split(':')[0];
    nodeKinds.set(kind, (nodeKinds.get(kind) ?? 0) + 1);
  }
  const languages = new Map();
  for (const rel of indexedRelative) {
    const language = languageOf(rel);
    languages.set(language, (languages.get(language) ?? 0) + 1);
  }

  const readIndex = await time(() => runtime.readIndex(directory, { refresh: true }));

  const cases = [
    { kind: 'search', label: 'exact symbol', input: { kind: 'search', query: 'createProject' } },
    { kind: 'search', label: 'prefix', input: { kind: 'search', query: 'createProj' } },
    { kind: 'search', label: 'typo', input: { kind: 'search', query: 'slugfy' } },
    { kind: 'search', label: 'camel token', input: { kind: 'search', query: 'projectSlug' } },
    { kind: 'search', label: 'ambiguous short', input: { kind: 'search', query: 'd' } },
    { kind: 'search', label: 'basename', input: { kind: 'search', query: 'operations.ts' } },
    { kind: 'search', label: 'source literal', input: { kind: 'search', query: 'ACCOUNT_TOKEN_PREFIX' } },
    { kind: 'file', label: 'file view', input: { kind: 'file', file: 'apps/api/src/domains/projects/operations.ts' } },
    { kind: 'context', label: 'context', input: { kind: 'context', symbol: 'const:createProject@api/src/domains/projects/operations.ts' } },
    { kind: 'impact', label: 'impact', input: { kind: 'impact', symbol: 'fn:slugify@api/src/domains/projects/operations.ts' } },
    { kind: 'tests', label: 'tests', input: { kind: 'tests', target: 'const:createProject@api/src/domains/projects/operations.ts' } },
    { kind: 'explore', label: 'explore', input: { kind: 'explore' } },
    { kind: 'trace', label: 'trace', input: { kind: 'trace', from: 'const:createProject@api/src/domains/projects/operations.ts', to: 'fn:slugify@api/src/domains/projects/operations.ts' } },
  ];

  const results = [];
  for (const testCase of cases) {
    const samples = [];
    let last = null;
    let error = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const sample = await time(() => runtime.query(directory, testCase.input));
        samples.push(sample.ms);
        last = sample.value;
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
        break;
      }
    }
    results.push({
      label: testCase.label,
      kind: testCase.kind,
      error,
      p50: percentile(samples, 50),
      p95: percentile(samples, 95),
      itemCount: Array.isArray(last?.items) ? last.items.length : null,
      coverage: last?.coverage ?? null,
      truncated: last?.truncated ?? null,
      firstItems: Array.isArray(last?.items)
        ? last.items.slice(0, 5).map((item) => ({ id: item.id, name: item.name ?? null, file: item.file ?? null, line: item.line ?? null, reason: item.reason ?? item.evidence?.[0]?.edge ?? null }))
        : [],
      unresolved: Array.isArray(last?.unresolved) ? last.unresolved.slice(0, 3) : [],
    });
  }

  const report = {
    directory,
    generatedAt: new Date().toISOString(),
    eligibleFiles: uncapped.entries.length,
    capApplied: capped.truncated,
    maxEntryFiles: MAX_ENTRY_FILES,
    cappedEntryFiles: capped.entries.length,
    runtimeIndex: {
      entryCount: readIndex.value.entryCount,
      truncated: readIndex.value.truncated ?? false,
      nodeCount: readIndex.value.nodeCount,
      edgeCount: readIndex.value.edgeCount,
      snapshotRoot: readIndex.value.snapshotRoot,
      revision: readIndex.value.revision,
      binding: readIndex.value.binding,
      freshness: readIndex.value.freshness,
      buildMs: readIndex.ms,
    },
    directIndex: {
      nodes: nodes.length,
      edges: edges.length,
      indexedFiles: indexedRelative.size,
      buildMs: indexBuild.ms,
      nodeKinds: Object.fromEntries([...nodeKinds].sort()),
      edgeKinds: Object.fromEntries([...edgeKinds].sort()),
      languages: Object.fromEntries([...languages].sort()),
    },
    coverageGap: {
      missingCount: missing.length,
      missingByTopDir: Object.fromEntries([...missingByTop].sort((a, b) => b[1] - a[1])),
      sample: missing.slice(0, 20),
    },
    queries: results,
  };

  const text = JSON.stringify(report, null, 2);
  if (jsonOut) {
    await fsPromises.mkdir(path.dirname(path.resolve(jsonOut)), { recursive: true });
    await fsPromises.writeFile(path.resolve(jsonOut), `${text}\n`, 'utf8');
  }
  console.log(text);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
