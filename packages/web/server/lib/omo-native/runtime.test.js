import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createOmoNativeRuntime } from './runtime.js';

describe('createOmoNativeRuntime', () => {
  it('materializes a loadable plugin directory and returns it', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omo-native-'));
    const runtime = createOmoNativeRuntime({ fsPromises: fs.promises, path, dataDir });

    const directory = await runtime.materializePlugin();

    expect(directory).toBe(path.join(dataDir, 'omo-native', 'omo-native'));
    expect(fs.statSync(directory).isDirectory()).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    expect(manifest.exports).toEqual({ '.': './index.js' });
    const plugin = await import(path.join(directory, 'index.js'));
    expect(plugin.default.id).toBe('omo-native');
    expect(typeof plugin.default.setup).toBe('function');
    // The materialized entry carries the real engine chain, not the old
    // empty setup: the native ULW operations are in the payload. setup()
    // itself is the host's job (it needs a real V2 ctx), so the test pins
    // the payload instead of invoking it without one.
    const payload = fs.readFileSync(path.join(directory, 'index.js'), 'utf8');
    expect(payload).toContain('ulw_goal_create');
    expect(payload).toContain('ulw_checkpoint');
    expect(payload).not.toContain('setup: async () => {}');
    const before = fs.readFileSync(path.join(directory, 'index.js'), 'utf8');
    await expect(runtime.materializePlugin()).resolves.toBe(directory);
    expect(fs.readFileSync(path.join(directory, 'index.js'), 'utf8')).toBe(before);
  });
});
