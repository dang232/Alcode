import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createManagedConfigRuntime, MANAGED_CONFIG_FILE_NAME, ULW_MCP_SERVER_NAME } from './managed-config-file.js';

const EXPECTED_NATIVE_AGENT_KEYS = [
  'sisyphus',
  'hephaestus',
  'prometheus',
  'atlas',
  'sisyphus-junior',
  'explore',
  'librarian',
  'oracle',
  'metis',
  'momus',
  'multimodal-looker',
  'plan',
  'plan-consultant',
  'plan-reviewer',
  'omo-native-code-reviewer',
  'omo-native-qa-executor',
  'omo-native-gate-reviewer',
];

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const createHarness = async ({ settings = {}, env = {}, memoryAvailable = true, versions, listUserCustomAgents, listConnectedProviders, readUserAgentModels } = {}) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alcode-managed-config-'));
  temporaryDirectories.push(dataDir);
  const agentToolRuntime = {
    pluginDirectory: path.join(dataDir, 'agent-tool', 'openchamber-agent-tool'),
    materializePlugin: vi.fn(async (flags) => {
      await fs.mkdir(agentToolRuntime.pluginDirectory, { recursive: true });
      await fs.writeFile(path.join(agentToolRuntime.pluginDirectory, 'flags.json'), JSON.stringify(flags));
      return agentToolRuntime.pluginDirectory;
    }),
    createChildEnv: vi.fn(() => ({
      OPENCHAMBER_AGENT_TOOL_URL: 'http://127.0.0.1:3901/api/openchamber/agent-tool',
      OPENCHAMBER_AGENT_TOOL_TOKEN: 'token',
    })),
  };
  const current = { settings };
  const dependencies = {
    fsPromises: fs,
    path,
    instanceDir: dataDir,
    env,
    agentToolRuntime,
    readSettings: () => current.settings,
    isAgentMemoryAvailable: () => memoryAvailable,
  };
  // Test-only seam, attached only when a test opts in: the default keeps
  // unit tests without a home directory hermetic.
  if (listUserCustomAgents !== undefined) dependencies.listUserCustomAgents = listUserCustomAgents;
  if (listConnectedProviders !== undefined) dependencies.listConnectedProviders = listConnectedProviders;
  if (readUserAgentModels !== undefined) dependencies.readUserAgentModels = readUserAgentModels;
  if (versions !== undefined) dependencies.versions = versions;
  const runtime = createManagedConfigRuntime(dependencies);
  const readConfigFile = async () => JSON.parse(await fs.readFile(path.join(dataDir, MANAGED_CONFIG_FILE_NAME), 'utf8'));
  return { dataDir, runtime, agentToolRuntime, current, readConfigFile };
};

describe('managed OpenCode config file', () => {
  it('points the child at a config file listing the enabled plugins', async () => {
    const { dataDir, runtime, readConfigFile } = await createHarness({
      settings: {},
    });

    const childEnv = await runtime.buildManagedChildEnv();

    expect(childEnv.OPENCODE_CONFIG).toBe(path.join(dataDir, MANAGED_CONFIG_FILE_NAME));
    expect(childEnv.OPENCODE_CONFIG_CONTENT).toBeUndefined();
    expect(childEnv.OPENCHAMBER_AGENT_TOOL_TOKEN).toBe('token');
    const pluginConfig = await readConfigFile();
    expect(pluginConfig.plugins).toEqual(['-opencode.browser', path.join(dataDir, 'agent-tool', 'openchamber-agent-tool')]);
    // The managed file also ships the native agent map and the ULW MCP server.
    expect(Object.keys(pluginConfig.agent).sort()).toEqual([...EXPECTED_NATIVE_AGENT_KEYS].sort());
    expect(pluginConfig.mcp.servers[ULW_MCP_SERVER_NAME].type).toBe('local');
  });

  it('materializes every listed plugin directory before naming it', async () => {
    const { runtime, readConfigFile } = await createHarness({ settings: {} });

    await runtime.buildManagedChildEnv();

    for (const directory of (await readConfigFile()).plugins.filter((entry) => !entry.startsWith('-'))) {
      expect((await fs.stat(directory)).isDirectory()).toBe(true);
    }
  });

  it('keeps the callback token in the child env while every tool is off', async () => {
    const { runtime, agentToolRuntime, readConfigFile } = await createHarness({
      settings: { agentControlToolEnabled: false, agentScheduleToolEnabled: false, agentWebToolEnabled: false, agentMemoryToolEnabled: false, agentKnowledgeToolEnabled: false, agentRenderToolEnabled: false },
    });

    const childEnv = await runtime.buildManagedChildEnv();

    expect(agentToolRuntime.materializePlugin).not.toHaveBeenCalled();
    const managedConfig = await readConfigFile();
    expect(managedConfig.plugins).toEqual(['-opencode.browser']);
    // The managed file also ships the native agent map and the ULW MCP server.
    expect(Object.keys(managedConfig.agent).sort()).toEqual([...EXPECTED_NATIVE_AGENT_KEYS].sort());
    expect(managedConfig.mcp.servers[ULW_MCP_SERVER_NAME].type).toBe('local');
    expect(childEnv.OPENCHAMBER_AGENT_TOOL_TOKEN).toBe('token');
  });

  it('rewrites the file when a tool is turned off, without a new token', async () => {
    const { dataDir, runtime, current, agentToolRuntime, readConfigFile } = await createHarness({
      settings: {},
    });
    await runtime.buildManagedChildEnv();

    current.settings = { agentControlToolEnabled: false, agentScheduleToolEnabled: false, agentWebToolEnabled: false, agentKnowledgeToolEnabled: false, agentRenderToolEnabled: false };
    expect(await runtime.refreshManagedConfigFile()).toEqual({ updated: true });

    const { plugins } = await readConfigFile();
    expect(plugins).toEqual(['-opencode.browser']);
    expect(agentToolRuntime.createChildEnv).toHaveBeenCalledTimes(1);
  });

  it('turns a tool back on without a restart', async () => {
    const { runtime, current, agentToolRuntime, readConfigFile } = await createHarness({
      settings: { agentControlToolEnabled: false, agentScheduleToolEnabled: false, agentWebToolEnabled: false, agentKnowledgeToolEnabled: false, agentRenderToolEnabled: false },
    });
    await runtime.buildManagedChildEnv();

    current.settings = { agentControlToolEnabled: false, agentScheduleToolEnabled: false, agentWebToolEnabled: true, agentKnowledgeToolEnabled: false, agentRenderToolEnabled: false };
    await runtime.refreshManagedConfigFile();

    expect((await readConfigFile()).plugins).toHaveLength(2);
    expect(agentToolRuntime.materializePlugin).toHaveBeenCalledWith({
      includeControl: false,
      includeSchedule: false,
      includeWeb: true,
      includeMemory: false,
      includeKnowledge: false,
      includeNotify: false,
      includeRender: false,
      codeMode: false,
    });
  });

  it('injects the knowledge tool by default and leaves it out once switched off', async () => {
    const { runtime, current, agentToolRuntime } = await createHarness({ settings: {} });

    await runtime.buildManagedChildEnv();
    expect(agentToolRuntime.materializePlugin).toHaveBeenLastCalledWith(expect.objectContaining({ includeKnowledge: true }));

    current.settings = { agentKnowledgeToolEnabled: false };
    await runtime.refreshManagedConfigFile();
    expect(agentToolRuntime.materializePlugin).toHaveBeenLastCalledWith(expect.objectContaining({ includeKnowledge: false }));
  });

  it('injects the schedule tool by default and leaves it out once switched off', async () => {
    const { runtime, current, agentToolRuntime } = await createHarness({ settings: {} });

    await runtime.buildManagedChildEnv();
    expect(agentToolRuntime.materializePlugin).toHaveBeenLastCalledWith(expect.objectContaining({ includeSchedule: true }));

    current.settings = { agentScheduleToolEnabled: false };
    await runtime.refreshManagedConfigFile();
    expect(agentToolRuntime.materializePlugin).toHaveBeenLastCalledWith(expect.objectContaining({ includeControl: true, includeSchedule: false }));
  });

  it('injects the render tool by default and leaves it out once switched off', async () => {
    const { runtime, current, agentToolRuntime } = await createHarness({ settings: {} });

    await runtime.buildManagedChildEnv();
    expect(agentToolRuntime.materializePlugin).toHaveBeenLastCalledWith(expect.objectContaining({ includeRender: true }));

    current.settings = { agentRenderToolEnabled: false };
    await runtime.refreshManagedConfigFile();
    expect(agentToolRuntime.materializePlugin).toHaveBeenLastCalledWith(expect.objectContaining({ includeRender: false }));
  });

  it('injects the notify tool only when it is switched on', async () => {
    const { runtime, agentToolRuntime } = await createHarness({
      settings: { agentControlToolEnabled: false, agentScheduleToolEnabled: false, agentWebToolEnabled: false, agentKnowledgeToolEnabled: false, agentRenderToolEnabled: false, agentNotifyToolEnabled: true },
    });

    await runtime.buildManagedChildEnv();

    expect(agentToolRuntime.materializePlugin).toHaveBeenCalledWith({
      includeControl: false,
      includeSchedule: false,
      includeWeb: false,
      includeMemory: false,
      includeKnowledge: false,
      includeNotify: true,
      includeRender: false,
      codeMode: false,
    });
  });

  it('puts the tools behind Code Mode only when the user asks for it', async () => {
    const { runtime, agentToolRuntime } = await createHarness({
      settings: { agentToolsCodeMode: true },
    });

    await runtime.buildManagedChildEnv();

    expect(agentToolRuntime.materializePlugin).toHaveBeenCalledWith({
      includeControl: true,
      includeSchedule: true,
      includeWeb: true,
      includeMemory: false,
      includeKnowledge: true,
      includeNotify: false,
      includeRender: true,
      codeMode: true,
    });
  });

  it('leaves a config file the user owns alone and keeps the restart requirement', async () => {
    const { dataDir, runtime } = await createHarness({
      settings: {},
      env: { OPENCODE_CONFIG: '/home/user/opencode.json', OPENCODE_CONFIG_CONTENT: '{"model":"test/model"}' },
    });

    const childEnv = await runtime.buildManagedChildEnv();

    expect(childEnv.OPENCODE_CONFIG).toBeUndefined();
    const fallbackContent = JSON.parse(childEnv.OPENCODE_CONFIG_CONTENT);
    expect(fallbackContent.model).toBe('test/model');
    expect(fallbackContent.plugins).toEqual(['-opencode.browser', path.join(dataDir, 'agent-tool', 'openchamber-agent-tool')]);
    // The fallback carries the native agent map and the ULW MCP server too.
    expect(Object.keys(fallbackContent.agent).sort()).toEqual([...EXPECTED_NATIVE_AGENT_KEYS].sort());
    expect(fallbackContent.mcp.servers[ULW_MCP_SERVER_NAME].type).toBe('local');
    await expect(fs.stat(path.join(dataDir, MANAGED_CONFIG_FILE_NAME))).rejects.toThrow();
    expect(await runtime.refreshManagedConfigFile()).toEqual({ updated: false, reason: 'external-config' });
  });

  it('leaves no temp file behind and never publishes a partial list', async () => {
    const { dataDir, runtime } = await createHarness({ settings: {} });

    await runtime.buildManagedChildEnv();
    await runtime.refreshManagedConfigFile();

    const entries = await fs.readdir(dataDir);
    expect(entries.filter((entry) => entry.includes('.tmp-'))).toEqual([]);
    expect(entries).toContain(MANAGED_CONFIG_FILE_NAME);
  });

  it('keeps the other servers and an explicit ulw entry on the fallback path', async () => {
    const other = { type: 'remote', url: 'https://mcp.example.com' };
    const { runtime } = await createHarness({
      settings: {},
      env: {
        OPENCODE_CONFIG: '/home/user/opencode.json',
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { servers: { other } } }),
      },
    });

    const content = JSON.parse((await runtime.buildManagedChildEnv()).OPENCODE_CONFIG_CONTENT);

    expect(content.mcp.servers.other).toEqual(other);
    expect(content.mcp.servers[ULW_MCP_SERVER_NAME].type).toBe('local');
  });

  it('leaves an explicit ulw entry alone on the fallback path', async () => {
    const explicit = { type: 'remote', url: 'https://ulw.example.com' };
    const { runtime } = await createHarness({
      settings: {},
      env: {
        OPENCODE_CONFIG: '/home/user/opencode.json',
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { servers: { [ULW_MCP_SERVER_NAME]: explicit } } }),
      },
    });

    const content = JSON.parse((await runtime.buildManagedChildEnv()).OPENCODE_CONFIG_CONTENT);

    expect(content.mcp.servers[ULW_MCP_SERVER_NAME]).toEqual(explicit);
  });

  it('ships the native agents as static config-keyed entries in the managed file', async () => {
    const { runtime, readConfigFile } = await createHarness({ settings: {} });

    await runtime.buildManagedChildEnv();

    const { agent } = await readConfigFile();
    expect(Object.keys(agent).sort()).toEqual([...EXPECTED_NATIVE_AGENT_KEYS].sort());
    // Lowercase config-key ids, never display names.
    expect(Object.keys(agent).every((key) => key === key.toLowerCase())).toBe(true);
    expect(agent['Sisyphus - ultraworker']).toBeUndefined();
    for (const key of EXPECTED_NATIVE_AGENT_KEYS) {
      expect(agent[key].mode).toBe('subagent');
      expect(typeof agent[key].description).toBe('string');
      // Hermetic build: no provider view, so no model is frozen in.
      expect(agent[key].model).toBeUndefined();
    }
    // The plan-gated advisers and final-gate trio ship as static entries so
    // every identity is dispatchable under its own name. Their ordering
    // guarantees stay enforced at dispatch: the plugin task-tool hook denies
    // plan-consultant/plan-reviewer without the planning triple, and trio
    // staging is enforced in the team/MCP dispatch paths.
    for (const gated of ['plan-consultant', 'plan-reviewer', 'omo-native-code-reviewer', 'omo-native-qa-executor', 'omo-native-gate-reviewer']) {
      expect(agent[gated].mode).toBe('subagent');
      expect(typeof agent[gated].description).toBe('string');
    }
  });

  it('merges user-global agents over the statics so customs survive the child', async () => {
    const custom = {
      name: 'sisyphus',
      entry: { description: 'Mine', mode: 'primary', model: 'x/y', system: 'Do it.' },
    };
    const { runtime, readConfigFile } = await createHarness({
      settings: {},
      listUserCustomAgents: () => [custom],
    });

    await runtime.buildManagedChildEnv();

    const { agent } = await readConfigFile();
    // The user's file wins on collision; untouched statics stay intact.
    expect(agent.sisyphus).toMatchObject({ description: 'Mine', mode: 'primary', system: 'Do it.' });
    expect(agent.explore.model).toBeUndefined();
    expect(Object.keys(agent).sort()).toEqual([...EXPECTED_NATIVE_AGENT_KEYS].sort());
  });

  it('merges user-global agents into the fallback content below explicit entries', async () => {
    const { runtime } = await createHarness({
      settings: {},
      env: {
        OPENCODE_CONFIG: '/home/user/opencode.json',
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ agent: { oracle: { mode: 'subagent', description: 'mine' } } }),
      },
      listUserCustomAgents: () => [
        { name: 'oracle', entry: { description: 'md file', mode: 'primary', model: 'x/y' } },
        { name: 'mine-only', entry: { description: 'md only', mode: 'all', model: 'x/y' } },
      ],
    });

    const content = JSON.parse((await runtime.buildManagedChildEnv()).OPENCODE_CONFIG_CONTENT);

    // Explicit content wins, then the .md file, then the static.
    expect(content.agent.oracle).toEqual({ mode: 'subagent', description: 'mine' });
    expect(content.agent['mine-only']).toMatchObject({ description: 'md only', mode: 'all' });
    expect(content.agent.metis.model).toBeUndefined();
  });

  it('sets ELECTRON_RUN_AS_NODE on the ulw entry under Electron', async () => {
    const { runtime, readConfigFile } = await createHarness({ settings: {}, versions: { electron: '1' } });

    await runtime.buildManagedChildEnv();

    const { mcp } = await readConfigFile();
    expect(mcp.servers[ULW_MCP_SERVER_NAME].environment).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
  });

  it('leaves the ulw entry without extra environment outside Electron', async () => {
    const { runtime, readConfigFile } = await createHarness({ settings: {}, versions: {} });

    await runtime.buildManagedChildEnv();

    const { mcp } = await readConfigFile();
    expect(mcp.servers[ULW_MCP_SERVER_NAME].environment).toBeUndefined();
  });

  it('merges the native agents into the fallback content without clobbering explicit entries', async () => {
    const { runtime } = await createHarness({
      settings: {},
      env: {
        OPENCODE_CONFIG: '/home/user/opencode.json',
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ agent: { oracle: { mode: 'subagent', description: 'mine' } } }),
      },
    });

    const content = JSON.parse((await runtime.buildManagedChildEnv()).OPENCODE_CONFIG_CONTENT);

    expect(Object.keys(content.agent).sort()).toEqual([...EXPECTED_NATIVE_AGENT_KEYS].sort());
    // An explicit user entry under the same key wins over the managed default.
    expect(content.agent.oracle).toEqual({ mode: 'subagent', description: 'mine' });
  });

  it('ignores the memory tool while the feature is unavailable', async () => {
    const { runtime, agentToolRuntime, readConfigFile } = await createHarness({
      settings: { agentControlToolEnabled: false, agentScheduleToolEnabled: false, agentWebToolEnabled: false, agentKnowledgeToolEnabled: false, agentRenderToolEnabled: false, agentMemoryToolEnabled: true },
      memoryAvailable: false,
    });

    await runtime.buildManagedChildEnv();

    expect(agentToolRuntime.materializePlugin).not.toHaveBeenCalled();
    const memoryOffConfig = await readConfigFile();
    expect(memoryOffConfig.plugins).toEqual(['-opencode.browser']);
    expect(Object.keys(memoryOffConfig.agent).sort()).toEqual([...EXPECTED_NATIVE_AGENT_KEYS].sort());
    expect(memoryOffConfig.mcp.servers[ULW_MCP_SERVER_NAME].type).toBe('local');
  });

  it('resolves static agent models from the connected providers at build time', async () => {
    const { runtime, readConfigFile } = await createHarness({
      settings: {},
      listConnectedProviders: async () => ['kimi-for-coding'],
    });

    await runtime.buildManagedChildEnv();

    const { agent } = await readConfigFile();
    expect(agent.explore.model).toBe('kimi-for-coding/kimi-for-coding-highspeed#off');
  });

  it('drops the agent when no chain provider is eligible', async () => {
    const { runtime, readConfigFile } = await createHarness({
      settings: {},
      listConnectedProviders: async () => [],
    });

    await runtime.buildManagedChildEnv();

    const { agent } = await readConfigFile();
    expect(agent.explore).toBeUndefined();
  });

  it('lets a custom .md model win over the resolved static', async () => {
    const { runtime, readConfigFile } = await createHarness({
      settings: {},
      listConnectedProviders: async () => ['kimi-for-coding'],
      listUserCustomAgents: () => [
        { name: 'explore', entry: { description: 'Mine', mode: 'primary', model: 'custom-lab/x' } },
      ],
    });

    await runtime.buildManagedChildEnv();

    const { agent } = await readConfigFile();
    expect(agent.explore.model).toBe('custom-lab/x');
    expect(agent.explore.mode).toBe('primary');
  });

  it('honours user-layer model overrides when the provider is connected', async () => {
    const { runtime, readConfigFile } = await createHarness({
      settings: {},
      listConnectedProviders: async () => ['user-lab'],
      readUserAgentModels: async () => ({ explore: 'user-lab/u' }),
    });

    await runtime.buildManagedChildEnv();

    const { agent } = await readConfigFile();
    expect(agent.explore.model).toBe('user-lab/u');
  });

  it('drops the agent when the override names an unconnected provider', async () => {
    const { runtime, readConfigFile } = await createHarness({
      settings: {},
      listConnectedProviders: async () => ['kimi-for-coding'],
      readUserAgentModels: async () => ({ explore: 'user-lab/u' }),
    });

    await runtime.buildManagedChildEnv();

    const { agent } = await readConfigFile();
    expect(agent.explore).toBeUndefined();
  });
});
