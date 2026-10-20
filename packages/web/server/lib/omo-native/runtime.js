// Native OmO platform plugin runtime.
//
// Materializes the always-on OmO-native OpenCode plugin: same shape as the
// agent-tool plugin (a directory carrying a package.json that resolves an
// entrypoint), written before the managed config file names it. The setup
// hook carries the REAL engine chain (bundled from omo-opencode by
// setup.regen.js into setup.bundle.js): managed children boot with native
// ULW operations, not a placeholder. Compare-then-write: OpenCode watches
// the plugin directory, so rewriting identical bytes on every spawn would
// force every child to reload its plugins for nothing.

import { fileURLToPath } from 'node:url';

const PLUGIN_ID = 'omo-native';

const PLUGIN_PACKAGE_JSON = `${JSON.stringify({
  name: 'alcode-omo-native',
  version: '0.0.0',
  private: true,
  type: 'module',
  exports: { '.': './index.js' },
}, null, 2)}\n`;

export const createOmoNativeRuntime = ({ fsPromises, path, dataDir } = {}) => {
  const pluginDirectory = path.join(dataDir, 'omo-native', PLUGIN_ID);

  // Write the plugin and return its directory. Called before a managed
  // child starts so the source on disk always matches what the config
  // file names; the running OpenCode reloads the directory it has.
  const materializePlugin = async () => {
    await fsPromises.mkdir(pluginDirectory, { recursive: true });
    await fsPromises.writeFile(path.join(pluginDirectory, 'package.json'), PLUGIN_PACKAGE_JSON, { mode: 0o600 });
    const source = await fsPromises.readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'setup.bundle.js'),
      'utf8',
    );
    const indexPath = path.join(pluginDirectory, 'index.js');
    let current = null;
    try {
      current = await fsPromises.readFile(indexPath, 'utf8');
    } catch {
      // First materialization: nothing on disk yet.
    }
    if (current !== source) {
      await fsPromises.writeFile(indexPath, source, { mode: 0o600 });
    }
    return pluginDirectory;
  };

  return { materializePlugin };
};
