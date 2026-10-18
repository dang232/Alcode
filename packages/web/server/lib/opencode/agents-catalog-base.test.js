import { afterAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The path constants are frozen when the modules load, so point
// XDG_CONFIG_HOME at an empty scratch directory BEFORE importing them.
// Nothing in this file may touch the real ~/.config/opencode: the user
// layer must be empty so every static entry resolves from the catalog.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alcode-catalog-base-'));
process.env.XDG_CONFIG_HOME = path.join(root, 'xdg');
delete process.env.OPENCODE_CONFIG;

const { getAgentConfig } = await import('./agents.js');
const { OMO_NATIVE_AGENT_CONFIG } = await import('../agents/omo-native-catalog.bundle.js');

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
});

describe('native agent editor base', () => {
  it('seeds every static entry from the catalog so the v2 form loads real values', () => {
    for (const name of Object.keys(OMO_NATIVE_AGENT_CONFIG)) {
      const found = getAgentConfig(name, root);
      expect(found.source).toBe('catalog');
      expect(typeof found.config.description).toBe('string');
      expect(typeof found.config.model).toBe('string');
      // plan ships description-only by design (no prompt); the rest seed a body.
      if (name === 'plan') expect(found.config.system).toBeUndefined();
      else expect(typeof found.config.system).toBe('string');
    }
  });

  it('keeps restriction denies in the seeded base', () => {
    const oracle = getAgentConfig('oracle', root);
    expect(oracle.source).toBe('catalog');
    const effects = (oracle.config.permissions ?? []).map((rule) => `${rule.action}:${rule.effect}`);
    expect(effects).toContain('call_omo_agent:deny');
    expect(effects).toContain('edit:deny');
    expect(effects).toContain('subagent:deny');
  });

  it('leaves unknown and category names unseeded', () => {
    expect(getAgentConfig('no-such-agent', root).source).toBe('none');
    expect(getAgentConfig('ultrabrain', root).source).toBe('none');
  });
});
