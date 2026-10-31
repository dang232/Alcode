import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

describe('dag-pane service bundle regen is idempotent', () => {
  it('regen to a temp file reproduces the committed artifact byte-identically', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dag-pane-service-regen-'));
    const outfile = path.join(tmp, 'main.bundle.check.js');
    try {
      execFileSync('bun', [path.join(thisDir, 'main.regen.mjs')], {
        env: { ...process.env, DAG_PANE_SERVICE_OUTFILE: outfile },
        stdio: 'pipe',
      });
      const committed = fs.readFileSync(path.join(thisDir, 'main.js'));
      const fresh = fs.readFileSync(outfile);
      expect(fresh.length).toBe(committed.length);
      expect(fresh.equals(committed)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 180000);
});
