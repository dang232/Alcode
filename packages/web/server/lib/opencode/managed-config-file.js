import { fileURLToPath } from 'node:url';

import { buildNativeAgentConfigMap, getNativeAgentModelGaps, NATIVE_AGENT_MODEL_CHAINS } from '../agents/omo-native-catalog.bundle.js';
import { isRecord, toMcpEntity } from './config-v2.js';
import { appendManagedMcpServer, appendManagedPlugin, mergeManagedAgents } from './managed-plugin-config.js';

export const MANAGED_CONFIG_FILE_NAME = 'opencode.managed.json';

/** Name of the bundled ULW MCP server in every managed OpenCode child. */
export const ULW_MCP_SERVER_NAME = 'ulw';

/**
 * Built-in OpenCode plugins OpenChamber switches off for its managed child.
 *
 * `opencode.browser` only works when OpenCode's own desktop app attaches a
 * browser to the session; OpenChamber does not implement that protocol, so its
 * tools always fail with `browser.disconnected` and agents conclude browsing is
 * unavailable instead of using `openchamber_web`. A project config that lists
 * `opencode.browser` still re-enables it, because that layer sits above ours.
 */
const DISABLED_BUILTIN_PLUGINS = ['-opencode.browser'];

/**
 * The managed OpenCode config layer.
 *
 * OpenCode 2 watches every config source it reads, including the file named by
 * the `OPENCODE_CONFIG` environment variable, and reloads its plugin list when
 * that file changes. Writing OpenChamber's own plugin entries into a file we
 * own therefore makes toggling a managed tool take effect in the running
 * process — where `OPENCODE_CONFIG_CONTENT` (an environment variable) could
 * only ever change across a restart.
 *
 * The file is OpenChamber-owned and holds `plugins` (the built-in plugins
 * OpenChamber disables, then its own plugin directories), the default
 * `mcp.servers` entries, and the `agent` map (static OmO-native entries
 * overlaid with the user's own global `.md` agents, user wins). It sits above
 * the user's global `opencode.json` and below their project config, so it never
 * shadows a project-level choice.
 *
 * When the user's own environment already sets `OPENCODE_CONFIG`, that file is
 * theirs: OpenChamber does not hijack it and falls back to merging its plugins
 * into `OPENCODE_CONFIG_CONTENT`, which keeps the old restart requirement for
 * managed-tool toggles.
 *
 * @param {object} dependencies
 * @param {typeof import('node:fs/promises')} dependencies.fsPromises
 * @param {typeof import('node:path')} dependencies.path
 * @param {string} dependencies.instanceDir this server's own directory (`instance-dir.js`)
 * @param {NodeJS.ProcessEnv} [dependencies.env] environment the managed child inherits
 * @param {object} [dependencies.versions] host version map (`process.versions`); Electron hosts set `versions.electron`
 * @param {object|null} [dependencies.agentToolRuntime]
 * @param {() => Promise<object|null>} dependencies.readSettings
 * @param {() => boolean} dependencies.isAgentMemoryAvailable
 * @param {() => Array<{name: string, entry: object}>} [dependencies.listUserCustomAgents]
 *   user-global `.md` agents merged over the static map (user wins); defaults
 *   to none so unit tests without a home directory stay hermetic.
 * @param {() => Promise<Array<string>|null>} [dependencies.listConnectedProviders]
 *   provider ids the running OpenCode proves usable; null when unknown.
 *   Defaults to null so unit tests without a runtime stay hermetic.
 * @param {() => Promise<object>} [dependencies.readUserAgentModels]
 *   explicit per-agent models from the user config layers, keyed by lowercase
 *   config-key id; these outrank chain resolution. Defaults to none.
 */
export const createManagedConfigRuntime = ({
  fsPromises,
  path,
  instanceDir,
  env = process.env,
  versions = process.versions,
  agentToolRuntime = null,
  readSettings,
  isAgentMemoryAvailable,
  listUserCustomAgents = () => [],
  listConnectedProviders = async () => null,
  readUserAgentModels = async () => ({}),
}) => {
  const filePath = path.join(instanceDir, MANAGED_CONFIG_FILE_NAME);

  const resolveNativeAgentMap = async () => {
    const connectedProviders = await Promise.resolve()
      .then(() => listConnectedProviders()).catch(() => null);
    const modelOverrides = await Promise.resolve()
      .then(() => readUserAgentModels()).catch(() => ({}));
    const map = buildNativeAgentConfigMap({ connectedProviders, modelOverrides });
    // Known gaps are loud and exact: the agent is already dropped from the
    // map, so this names the missing capability instead of shipping doom.
    for (const gap of getNativeAgentModelGaps({ connectedProviders, modelOverrides })) {
      console.error(`[managed-config] agent ${gap.configKey} has no eligible model (${gap.reason}${gap.override ? ` override ${gap.override}` : ''}${gap.chain ? ` chain ${gap.chain.join(', ')}` : ''}); dropped from the child until a provider or override covers it`);
    }
    for (const [key, entry] of Object.entries(map)) {
      const model = entry?.model;
      if (model?.constructor === String) {
        console.log(`[managed-config] agent ${key} model ${model}`);
      } else if (connectedProviders != null) {
        // Unreachable by construction (known gaps are dropped above): a
        // model-less entry here means the catalog and the map disagree.
        throw new Error(`[managed-config] invariant: agent ${key} shipped without a model although providers are known`);
      } else {
        const chain = NATIVE_AGENT_MODEL_CHAINS[key] ?? [];
        const wanted = chain
          .map((item) => `${(item.providers ?? []).join('|')}/${item.model}`)
          .join(', ');
        console.warn(`[managed-config] agent ${key} has no eligible model yet (chain: ${wanted || 'none'}); providers unknown, shipping unresolved`);
      }
    }
    return map;
  };

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
    await fsPromises.mkdir(instanceDir, { recursive: true });
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
      agent: { ...(await resolveNativeAgentMap()), ...userAgents },
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
    const includeSchedule = settings?.agentScheduleToolEnabled !== false;
    const includeWeb = settings?.agentWebToolEnabled !== false;
    const includeMemory = isAgentMemoryAvailable() && settings?.agentMemoryToolEnabled === true;
    const includeKnowledge = settings?.agentKnowledgeToolEnabled !== false;
    const includeNotify = settings?.agentNotifyToolEnabled === true;
    const includeRender = settings?.agentRenderToolEnabled !== false;
    const codeMode = settings?.agentToolsCodeMode === true;

    const directories = [];
    if (agentToolRuntime && (includeControl || includeSchedule || includeWeb || includeMemory || includeKnowledge || includeNotify || includeRender)) {
      directories.push(await agentToolRuntime.materializePlugin({ includeControl, includeSchedule, includeWeb, includeMemory, includeKnowledge, includeNotify, includeRender, codeMode }));
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
    content = mergeManagedAgents(content, { ...(await resolveNativeAgentMap()), ...(await readUserAgentMap()) }, 'managed agents');
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
