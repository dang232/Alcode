// Bundle coverage for the OmO-native setup chain: the committed
// `setup.bundle.js` inlines `plugin-setup.ts` plus its engine imports into
// one dependency-free file, so the packaged app (plain Node, no transpile
// step) never resolves engine `.ts`. Nothing here imports engine `.ts`
// directly.
import { describe, expect, it } from 'vitest';
import { builtinModules } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

const collectSpecifiers = (text) =>
  new Set(
    [
      ...text.matchAll(/from\s*["']([^"']+)["']/g),
      ...text.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
    ]
      .map((match) => match[1])
      // Engine sources embed regex literals whose text repeats the `from` + quote shape, so the scan
      // can capture punctuation-and-newline fragments. Only a specifier-shaped token can leak.
      .filter((spec) => /^[^\s"'`(){}[\]]+$/.test(spec)),
  );

// Bare core imports (`fs`, `os`, `path`, …) resolve in plain Node exactly
// like their `node:`-prefixed twins; only non-core specifiers leak.
const isNodeBuiltin = (spec) =>
  spec.startsWith('node:') ||
  builtinModules.includes(spec) ||
  builtinModules.includes(`node:${spec}`);

describe('omo-native setup bundle stays dependency-free', () => {
  it('has zero non-node imports', () => {
    const text = fs.readFileSync(path.join(thisDir, 'setup.bundle.js'), 'utf8');
    expect(text.length).toBeGreaterThan(0);
    const leaked = [...collectSpecifiers(text)].filter((spec) => !isNodeBuiltin(spec));
    expect(leaked).toEqual([]);
  });
});

describe('omo-native setup bundle loads', () => {
  it('loads via bare dynamic import and exposes the plugin entry', async () => {
    const bundle = await import('./setup.bundle.js');
    expect(bundle.default.id).toBe('omo-native');
    expect(typeof bundle.default.setup).toBe('function');
  });
});

describe('omo-native setup bundle regen is idempotent', () => {
  it('regen to a temp file reproduces the committed artifact byte-identically', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omo-native-setup-regen-'));
    const outfile = path.join(tmp, 'setup.bundle.check.js');
    try {
      execFileSync('bun', [path.join(thisDir, 'setup.regen.js')], {
        env: { ...process.env, OMO_NATIVE_SETUP_OUTFILE: outfile },
        stdio: 'pipe',
      });
      const committed = fs.readFileSync(path.join(thisDir, 'setup.bundle.js'));
      const fresh = fs.readFileSync(outfile);
      expect(fresh.length).toBe(committed.length);
      expect(fresh.equals(committed)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 180000);
});
