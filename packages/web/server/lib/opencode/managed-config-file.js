import { fileURLToPath } from 'node:url';

import { OMO_NATIVE_AGENT_CONFIG } from '../agents/omo-native-catalog.bundle.js';
import { isRecord, toMcpEntity } from './config-v2.js';
import { appendManagedMcpServer, appendManagedPlugin, mergeManagedAgents } from './managed-plugin-config.js';

export const MANAGED_CONFIG_FILE_NAME = 'opencode.managed.json';

/** Name of the bundled ULW MCP server in every managed OpenCode child. */
export const ULW_MCP_SERVER_NAME = 'ulw';

/**
 * Built-in OpenCode plugins Alcode switches off for its managed child.
 *
 * `opencode.browser` only works when OpenCode's own desktop app attaches a
 * browser to the session; Alcode does not implement that protocol, so its
 * tools always fail with `browser.disconnected` and agents conclude browsing is
 * unavailable instead of using `alcode_web`. A project config that lists
 * `opencode.browser` still re-enables it, because that layer sits above ours.
 */
const DISABLED_BUILTIN_PLUGINS = ['-opencode.browser'];

/**
 * The managed OpenCode config layer.
 *
 * OpenCode 2 watches every config source it reads, including the file named by
 * the `OPENCODE_CONFIG` environment variable, and reloads its plugin list when
 * that file changes. Writing Alcode's own plugin entries into a file we
 * own therefore makes toggling a managed tool take effect in the running
 * process — where `OPENCODE_CONFIG_CONTENT` (an environment variable) could
 * only ever change across a restart.
 *
 * The file is Alcode-owned and holds `plugins`, the default `mcp.servers`
 * entries, and the static OmO-native `agent` map: the built-in plugins
 * Alcode disables, then its own plugin directories, then the bundled ULW
 * MCP server, then the 12 ungated native agents. It sits above
 * the user's global `opencode.json` and below their project config, so it never
 * shadows a project-level choice.
 *
 * The `agent` map also carries the user's own global `.md` agents (user
 * wins on collision): a config-level `agent` map replaces the user's
 * global agent files in the running child, so without the merge a custom
 * agent would vanish from the runtime while Settings still shows it.
 *
 * When the user's own environment already sets `OPENCODE_CONFIG`, that file is
 * theirs: Alcode does not hijack it and falls back to merging its plugins
 * and default MCP servers into `OPENCODE_CONFIG_CONTENT`, which keeps the old
 * restart requirement for managed-tool toggles.
 *
 * @param {object} dependencies
 * @param {typeof import('node:fs/promises')} dependencies.fsPromises
 * @param {typeof import('node:path')} dependencies.path
 * @param {string} dependencies.dataDir Alcode data directory
 * @param {NodeJS.ProcessEnv} [dependencies.env] environment the managed child inherits
 * @param {object} [dependencies.versions] host version map (`process.versions`); Electron hosts set `versions.electron`
 * @param {object|null} [dependencies.agentToolRuntime]
 * @param {object|null} [dependencies.omoNativeRuntime] native OmO platform
 *   plugin runtime (`server/lib/omo-native/runtime.js`); always materialized
 *   when present, never gated on tool toggles
 * @param {() => Promise<object|null>} dependencies.readSettings
 * @param {() => boolean} dependencies.isAgentMemoryAvailable
 * @param {() => Array<{name: string, entry: object}>} [dependencies.listUserCustomAgents]
 *   user-global `.md` agents merged over the static map (user wins); defaults
 *   to none so unit tests without a home directory stay hermetic.
 */
export const createManagedConfigRuntime = ({
  fsPromises,
  path,
  dataDir,
  env = process.env,
  versions = process.versions,
  agentToolRuntime = null,
  omoNativeRuntime = null,
  readSettings,
  isAgentMemoryAvailable,
  listUserCustomAgents = () => [],
}) => {
  const filePath = path.join(dataDir, MANAGED_CONFIG_FILE_NAME);

  /** The user owns `OPENCODE_CONFIG` when their environment already set it. */
  const ownsConfigFile = () => (env.OPENCODE_CONFIG ?? '').trim().length === 0;

  /**
   * The bundled ULW MCP server entry in native v2 shape. The command runs the
   * install's own `ulw-mcp/server.js` under the runtime already executing
   * Alcode. The path is absolute and rooted at this module's install
   * location, never at the working directory, and no `cwd` is set, so the
   * server inherits the session's directory from the managed child. Under the
   * Electron host the entry also sets `ELECTRON_RUN_AS_NODE`, because the app
   * binary would otherwise start another copy of the app instead of Node
   * (same rule as `git/helper-launch.js`).
   */
  const resolveUlwMcpEntry = () => {
    const entry = {
      type: 'local',
      command: [
        process.execPath,
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'ulw-mcp', 'server.js'),
      ],
    };
    if (versions?.electron) entry.environment = { ELECTRON_RUN_AS_NODE: '1' };
    return toMcpEntity(entry);
  };

  /**
   * User-global `.md` agents as a config-map overlay (user wins). Shared by
   * the watched-file path and the OPENCODE_CONFIG_CONTENT fallback: both
   * carry a config-level `agent` map, and both would otherwise hide customs
   * from the child. Never throws: a broken lister must not break child boot.
   */
  const readUserAgentMap = async () => {
    try {
      const customs = await Promise.resolve(listUserCustomAgents()) ?? [];
      const map = {};
      for (const custom of customs) {
        if (!isRecord(custom) || !isRecord(custom.entry) || !custom.name) continue;
        map[custom.name] = custom.entry;
      }
      return map;
    } catch {
      return {};
    }
  };

  const writeConfigFile = async (pluginDirectories) => {
    await fsPromises.mkdir(dataDir, { recursive: true });
    // User-global `.md` agents ride along (user wins on collision): the
    // config-level map replaces those files in the child, so shipping only
    // the statics would hide every custom agent from the runtime.
    const userAgents = await readUserAgentMap();
    const text = `${JSON.stringify({
      plugins: [...DISABLED_BUILTIN_PLUGINS, ...pluginDirectories],
      mcp: { servers: { [ULW_MCP_SERVER_NAME]: resolveUlwMcpEntry() } },
      // The V2 agent editor has no add(), so custom agents cannot register
      // via transform: they ship here as static entries keyed by lowercase
      // config-key ids (never display names).
      agent: { ...OMO_NATIVE_AGENT_CONFIG, ...userAgents },
    }, null, 2)}\n`;
    // Temp + rename: OpenCode reacts to the write immediately, and a partial
    // read would make it drop every managed plugin until the next change.
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fsPromises.writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 });
      await fsPromises.rename(tmp, filePath);
    } catch (error) {
      await fsPromises.rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
  };

  /**
   * Materialize the plugins the current settings ask for and return their
   * directories in load order. Directories exist on disk before the config
   * file names them.
   */
  const materializeEnabledPlugins = async () => {
    const settings = await Promise.resolve(readSettings()).catch(() => null);
    const includeControl = settings?.agentControlToolEnabled !== false;
    const includeWeb = settings?.agentWebToolEnabled !== false;
    const includeMemory = isAgentMemoryAvailable() && settings?.agentMemoryToolEnabled === true;
    const includeNotify = settings?.agentNotifyToolEnabled === true;
    const codeMode = settings?.agentToolsCodeMode === true;

    const directories = [];
    // The native OmO plugin is the platform, not an optional tool: every
    // managed child loads it, so it materializes unconditionally and leads
    // the list. Only the tool plugin below answers to settings toggles.
    if (omoNativeRuntime) {
      directories.push(await omoNativeRuntime.materializePlugin());
    }
    if (agentToolRuntime && (includeControl || includeWeb || includeMemory || includeNotify)) {
      directories.push(await agentToolRuntime.materializePlugin({ includeControl, includeWeb, includeMemory, includeNotify, codeMode }));
    }
    return directories;
  };

  /**
   * Environment for a managed OpenCode child: the callback URL and per-child
   * token are always present, so a tool enabled later in the session can still
   * call back without a restart.
   */
  const buildManagedChildEnv = async () => {
    const directories = await materializeEnabledPlugins();
    const childEnv = agentToolRuntime ? agentToolRuntime.createChildEnv() : {};
    if (ownsConfigFile()) {
      await writeConfigFile(directories);
      return { ...childEnv, OPENCODE_CONFIG: filePath };
    }
    let content = env.OPENCODE_CONFIG_CONTENT;
    for (const directory of [...DISABLED_BUILTIN_PLUGINS, ...directories]) {
      content = appendManagedPlugin(content, directory, 'managed plugin');
    }
    content = appendManagedMcpServer(content, ULW_MCP_SERVER_NAME, resolveUlwMcpEntry(), 'managed MCP server');
    content = mergeManagedAgents(content, { ...OMO_NATIVE_AGENT_CONFIG, ...(await readUserAgentMap()) }, 'managed agents');
    return { ...childEnv, OPENCODE_CONFIG_CONTENT: content };
  };

  /**
   * Rewrite the managed config file after a managed-plugin setting changed, so
   * the running OpenCode picks the new plugin list up. A no-op when the user
   * owns `OPENCODE_CONFIG`; those installs still need a restart.
   *
   * @returns {Promise<{updated: boolean, reason?: string}>}
   */
  const refreshManagedConfigFile = async () => {
    if (!ownsConfigFile()) return { updated: false, reason: 'external-config' };
    await writeConfigFile(await materializeEnabledPlugins());
    return { updated: true };
  };

  return {
    filePath,
    ownsConfigFile,
    buildManagedChildEnv,
    refreshManagedConfigFile,
  };
};
