/**
 * OmO native runtime plugin materialization.
 *
 * Managed OpenCode children run the native OmO platform plugin from a
 * directory Alcode owns under its data directory (`<dataDir>/omo-native`).
 * `materializePlugin()` rewrites that directory on every child start and on
 * every managed-config refresh, so the config file OpenCode watches always
 * names bytes already on disk and a running child picks the new plugin list
 * up without a restart.
 *
 * Materialized layout (OpenCode loads a plugin from a DIRECTORY whose
 * package.json resolves an entrypoint; a bare `.js` path is rejected):
 *
 *   omo-native/
 *     package.json   resolves `.` to `./index.js`
 *     index.js       the built native entry (default export: plugin module)
 *     agents/        the seven bundled agent definitions (`*.md`)
 *
 * Build decision: the entry ships as ONE bundled `index.js` (Bun.build,
 * `target: 'node'`, `format: 'esm'`, only `node:*` builtins external), not
 * as a copied source tree. The native entry is TypeScript with
 * cross-package imports, and OpenCode loads a plugin entry with a bare
 * dynamic import that resolves nothing from the generated directory, so a
 * copied tree would still need a transpiler inside the child while a bundle
 * has no relative imports left. A trial bundle of
 * `omo-engine/omo-opencode/src/index.ts` completes in milliseconds as one
 * ~540KB file with only `node:*`-family imports external.
 *
 * Bundling is injected as `buildEntry()` so this module stays plain server
 * JS with no toolchain dependency: hosts without a Bun toolchain hand it
 * entry text directly, while production hands it the Bun.build output. The
 * verified production recipe is:
 *
 *   Bun.build({
 *     entrypoints: ['omo-engine/omo-opencode/src/index.ts'],
 *     target: 'node', format: 'esm', external: [/^node:/],
 *     plugins: [agentsDirRedirect],
 *   })
 *
 * where `agentsDirRedirect` is a Bun plugin whose `onResolve` maps the
 * `resolve-agent-definition-paths` module to a shim that re-exports the
 * module and pins `resolveBundledAgentsDir` to the `agents/` sibling of the
 * emitted `index.js` (guarding `args.importer` so the shim's own
 * re-export still resolves to the real module). That function stays the
 * single source of truth — every reader keeps calling it, only its binding
 * is redirected at build time — and this module mirrors the materialized
 * layout by writing `agents/` next to `index.js`, so the entry resolves at
 * runtime exactly what is on disk here. Copying the source tree instead
 * would preserve the `../../agents` math untouched, but keeps the
 * TypeScript-plus-closure problem above; the bundle is the smaller runtime.
 *
 * Files land with `0600` modes, matching the agent-tool plugin precedent:
 * the plugin directory lives beside per-child tokens under the data dir.
 */

import { fileURLToPath } from 'node:url';

/** On-disk directory name under the data dir; also the package name. */
export const OMO_NATIVE_PLUGIN_ID = 'omo-native';

/** Subdirectory of the plugin directory holding agent definitions. */
export const OMO_NATIVE_AGENTS_DIR_NAME = 'agents';

/**
 * The bundled agent definitions, by file name. Read from the engine source
 * tree and mirrored verbatim; a missing entry fails materialization loudly
 * rather than booting a child with a silent partial roster.
 */
export const BUNDLED_AGENT_FILE_NAMES = [
  'explore.md',
  'librarian.md',
  'omo-native-code-reviewer.md',
  'omo-native-gate-reviewer.md',
  'omo-native-qa-executor.md',
  'plan-consultant.md',
  'plan-reviewer.md',
];

// A configured plugin has to be a directory carrying a package.json that
// resolves an entrypoint; OpenCode skips a plain .js path.
const PLUGIN_PACKAGE_JSON = `${JSON.stringify({
  name: OMO_NATIVE_PLUGIN_ID,
  version: '0.0.0',
  private: true,
  type: 'module',
  exports: { '.': './index.js' },
}, null, 2)}\n`;

/** Engine source tree location inside the monorepo, for the default lookup. */
const resolveDefaultAgentsSourceDir = (path) => path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'omo-engine',
  'omo-opencode',
  'agents',
);

/**
 * Default entry source: the committed staged bundle beside this module
 * (written by regen.js). Reading a staged file keeps materialization working
 * on plain-Node hosts where the Bun toolchain is unavailable; tests and dev
 * refreshes keep injecting buildEntry explicitly.
 */
const defaultStagedBuildEntry = ({ fsPromises, path }) => async () => {
  const staged = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.bundle.js');
  try {
    return await fsPromises.readFile(staged, 'utf8');
  } catch (error) {
    throw new Error(`OmO native staged bundle is missing (run regen.js): ${staged}`, { cause: error });
  }
};

/**
 * @param {object} dependencies
 * @param {typeof import('node:fs/promises')} dependencies.fsPromises
 * @param {typeof import('node:path')} dependencies.path
 * @param {string} dependencies.dataDir Alcode data directory
 * @param {() => Promise<string>|string} [dependencies.buildEntry] returns the
 *   built single-file entry source; defaults to the committed staged bundle
 *   (regen.js output), which keeps materialization working on plain-Node
 *   hosts without the Bun toolchain
 * @param {string} [dependencies.agentsSourceDir] directory holding the
 *   bundled `*.md` definitions; defaults to the engine source tree
 */
export const createOmoNativeRuntime = ({
  fsPromises,
  path,
  dataDir,
  buildEntry = defaultStagedBuildEntry({ fsPromises, path }),
  agentsSourceDir = resolveDefaultAgentsSourceDir(path),
}) => {
  const pluginDirectory = path.join(dataDir, OMO_NATIVE_PLUGIN_ID);
  const pluginPath = path.join(pluginDirectory, 'index.js');
  const pluginManifestPath = path.join(pluginDirectory, 'package.json');
  const agentsDirectory = path.join(pluginDirectory, OMO_NATIVE_AGENTS_DIR_NAME);

  /**
   * Write the native plugin directory and return its path.
   *
   * Called before a managed child starts and on every managed-config
   * refresh, so the entry and definitions on disk always match the build —
   * the running OpenCode reloads the directory it already has configured.
   * The native runtime is the platform, not a toggle: there are no flags.
   */
  const materializePlugin = async () => {
    const entrySource = await buildEntry();
    if (typeof entrySource !== 'string' || entrySource.trim().length === 0) {
      throw new Error('OmO native entry build returned no source');
    }
    const agentFiles = await Promise.all(BUNDLED_AGENT_FILE_NAMES.map(async (fileName) => {
      const source = path.join(agentsSourceDir, fileName);
      try {
        return { fileName, content: await fsPromises.readFile(source, 'utf8') };
      } catch (error) {
        throw new Error(`OmO native agent definition is missing: ${source}`, { cause: error });
      }
    }));

    await fsPromises.mkdir(pluginDirectory, { recursive: true });
    // Drop stale definitions first: a renamed upstream agent must not linger
    // beside the current roster and load twice under the old name.
    await fsPromises.rm(agentsDirectory, { recursive: true, force: true });
    await fsPromises.mkdir(agentsDirectory, { recursive: true });
    await fsPromises.writeFile(pluginManifestPath, PLUGIN_PACKAGE_JSON, { mode: 0o600 });
    await fsPromises.writeFile(pluginPath, entrySource, { mode: 0o600 });
    await Promise.all(agentFiles.map(({ fileName, content }) => (
      fsPromises.writeFile(path.join(agentsDirectory, fileName), content, { mode: 0o600 })
    )));
    return pluginDirectory;
  };

  return {
    pluginDirectory,
    materializePlugin,
  };
};
