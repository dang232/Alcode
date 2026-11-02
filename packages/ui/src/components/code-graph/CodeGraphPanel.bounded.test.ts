import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('code graph impact bounding contract', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(__dirname, 'CodeGraphPanel.tsx'), 'utf-8');
  test('caps files/symbols, bounds concurrency, renders truncation notice', () => {
    expect(source).toContain('MAX_IMPACT_FILES');
    expect(source).toContain('MAX_IMPACT_SYMBOLS');
    expect(source).toContain('IMPACT_QUERY_CONCURRENCY');
    expect(source).toContain('code-graph-impact-bounded');
    expect(source).toContain('files not queried');
    expect(source).toContain('symbols not queried');
    // No unbounded per-symbol fan-out remains.
    expect(source).not.toContain('Promise.all(symbols.map');
  });
  test('canvas render caps exist', () => {
    const canvas = readFileSync(join(__dirname, 'CodeGraphCanvas.tsx'), 'utf-8');
    expect(canvas).toContain('MAX_RENDER_NODES');
    expect(canvas).toContain('MAX_RENDER_EDGES');
    expect(canvas).toContain('code-graph-canvas-bounded');
    expect(canvas).toContain('role');
  });
});
