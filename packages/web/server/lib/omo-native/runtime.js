// Native OmO platform plugin runtime.
//
// Materializes the always-on OmO-native OpenCode plugin: same shape as the
// agent-tool plugin (a directory carrying a package.json that resolves an
// entrypoint), written before the managed config file names it. The setup
// hook registers nothing yet; the native tool surface lands here when the
// platform lane defines it, and the entry stays valid so managed children
// always boot in the meantime.

const PLUGIN_ID = 'omo-native';

const PLUGIN_PACKAGE_JSON = `${JSON.stringify({
  name: 'alcode-omo-native',
  version: '0.0.0',
  private: true,
  type: 'module',
  exports: { '.': './index.js' },
}, null, 2)}\n`;

const PLUGIN_SOURCE = `export default {
  id: ${JSON.stringify(PLUGIN_ID)},
  setup: async () => {},
}
`;

export const createOmoNativeRuntime = ({ fsPromises, path, dataDir } = {}) => {
  const pluginDirectory = path.join(dataDir, 'omo-native', PLUGIN_ID);

  // Write the plugin and return its directory. Called before a managed
  // child starts so the source on disk always matches what the config
  // file names; the running OpenCode reloads the directory it has.
  const materializePlugin = async () => {
    await fsPromises.mkdir(pluginDirectory, { recursive: true });
    await fsPromises.writeFile(path.join(pluginDirectory, 'package.json'), PLUGIN_PACKAGE_JSON, { mode: 0o600 });
    await fsPromises.writeFile(path.join(pluginDirectory, 'index.js'), PLUGIN_SOURCE, { mode: 0o600 });
    return pluginDirectory;
  };

  return { materializePlugin };
};
