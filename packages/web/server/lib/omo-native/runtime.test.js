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
    await expect(plugin.default.setup()).resolves.toBeUndefined();
    await expect(runtime.materializePlugin()).resolves.toBe(directory);
  });
});
