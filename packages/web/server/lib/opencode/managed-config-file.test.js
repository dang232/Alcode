import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createManagedConfigRuntime, MANAGED_CONFIG_FILE_NAME, ULW_MCP_SERVER_NAME } from './managed-config-file.js';
import { OMO_NATIVE_AGENT_CONFIG } from '../agents/omo-native-catalog.bundle.js';
import { readLayeredMcpEntries } from './config-v2.js';

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

const createHarness = async ({ settings = {}, env = {}, memoryAvailable = true, versions, listUserCustomAgents } = {}) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alcode-managed-config-'));
  temporaryDirectories.push(dataDir);
  const agentToolRuntime = {
    pluginDirectory: path.join(dataDir, 'agent-tool', 'alcode-agent-tool'),
    materializePlugin: vi.fn(async (flags) => {
      await fs.mkdir(agentToolRuntime.pluginDirectory, { recursive: true });
      await fs.writeFile(path.join(agentToolRuntime.pluginDirectory, 'flags.json'), JSON.stringify(flags));
      return agentToolRuntime.pluginDirectory;
    }),
    createChildEnv: vi.fn(() => ({
      ALCODE_AGENT_TOOL_URL: 'http://127.0.0.1:3901/api/alcode/agent-tool',
      ALCODE_AGENT_TOOL_TOKEN: 'token',
    })),
  };
  const current = { settings };
  const dependencies = {
    fsPromises: fs,
    path,
    dataDir,
    env,
    versions,
    agentToolRuntime,
    readSettings: () => current.settings,
    isAgentMemoryAvailable: () => memoryAvailable,
  };
  // Test-only seam, attached only when a test opts in: the default keeps
  // unit tests without a home directory hermetic.
  if (listUserCustomAgents !== undefined) dependencies.listUserCustomAgents = listUserCustomAgents;
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
    expect(childEnv.ALCODE_AGENT_TOOL_TOKEN).toBe('token');
    const config = await readConfigFile();
    expect(config.plugins).toEqual(['-opencode.browser', path.join(dataDir, 'agent-tool', 'alcode-agent-tool')]);
    expect(Object.keys(config.mcp.servers)).toEqual([ULW_MCP_SERVER_NAME]);
  });

  it('registers the bundled ulw MCP server by default', async () => {
    const { runtime, readConfigFile } = await createHarness({ settings: {} });

    await runtime.buildManagedChildEnv();

    const entry = (await readConfigFile()).mcp.servers[ULW_MCP_SERVER_NAME];
    expect(entry.type).toBe('local');
    expect(entry.command[0]).toBe(process.execPath);
    expect(path.isAbsolute(entry.command[1])).toBe(true);
    expect(path.basename(entry.command[1])).toBe('server.js');
    expect(path.basename(path.dirname(entry.command[1]))).toBe('ulw-mcp');
    // The repo's own config reader lists it: this is the default-config dump.
    const dumped = readLayeredMcpEntries([await readConfigFile()]);
    expect(dumped.get(ULW_MCP_SERVER_NAME)?.key).toBe('mcp.servers');
  });

  it('tells the Electron host binary to behave as Node', async () => {
    const { runtime, readConfigFile } = await createHarness({
      settings: {},
      versions: { electron: '37.0.0' },
    });

    await runtime.buildManagedChildEnv();

    const entry = (await readConfigFile()).mcp.servers[ULW_MCP_SERVER_NAME];
    expect(entry.command[0]).toBe(process.execPath);
    expect(entry.environment).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
  });

  it('leaves the entry without extra environment on plain hosts', async () => {
    const { runtime, readConfigFile } = await createHarness({ settings: {}, versions: {} });

    await runtime.buildManagedChildEnv();

    expect((await readConfigFile()).mcp.servers[ULW_MCP_SERVER_NAME].environment).toBeUndefined();
  });

  it('boots the resolved entry over stdio through initialize and tools/list', async () => {
    const { runtime, readConfigFile } = await createHarness({ settings: {} });

    await runtime.buildManagedChildEnv();
    const entry = (await readConfigFile()).mcp.servers[ULW_MCP_SERVER_NAME];
    expect(entry.type).toBe('local');

    const child = spawn(entry.command[0], entry.command.slice(1), {
      env: { ...process.env, ...(entry.environment ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
    const responses = new Map();
    let pending = '';
    const handshake = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`MCP handshake timed out; stderr: ${stderr.join('').slice(0, 2000)}`)),
        15000,
      );
      child.on('error', reject);
      child.stdout.on('data', (chunk) => {
        pending += String(chunk);
        let index;
        while ((index = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, index).trim();
          pending = pending.slice(index + 1);
          if (!line) continue;
          const message = JSON.parse(line);
          responses.set(message.id, message);
          if (responses.has(1) && responses.has(2)) {
            clearTimeout(timer);
            resolve();
          }
        }
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
    try {
      await handshake;
    } finally {
      child.kill();
      await new Promise((resolve) => {
        child.on('close', resolve);
        setTimeout(resolve, 5000);
      });
    }

    expect(responses.get(1).result.protocolVersion).toBe('2024-11-05');
    expect(responses.get(1).result.serverInfo.name).toBe('ulw-mcp');
    expect(responses.get(2).result.tools.map((tool) => tool.name).sort()).toEqual(
      [
        'checkpoint',
        'complete',
        'create-goals',
        'dispatch',
        'inspect',
        'record-child-failure',
        'record-child-result',
        'revise-goals',
        'status',
      ].sort(),
    );
  }, 25000);

  it('materializes every listed plugin directory before naming it', async () => {
    const { runtime, readConfigFile } = await createHarness({ settings: {} });

    await runtime.buildManagedChildEnv();

    for (const directory of (await readConfigFile()).plugins.filter((entry) => !entry.startsWith('-'))) {
      expect((await fs.stat(directory)).isDirectory()).toBe(true);
    }
  });

  it('keeps the callback token in the child env while every tool is off', async () => {
    const { runtime, agentToolRuntime, readConfigFile } = await createHarness({
      settings: { agentControlToolEnabled: false, agentWebToolEnabled: false, agentMemoryToolEnabled: false },
    });

    const childEnv = await runtime.buildManagedChildEnv();

    expect(agentToolRuntime.materializePlugin).not.toHaveBeenCalled();
    const config = await readConfigFile();
    expect(config.plugins).toEqual(['-opencode.browser']);
    expect(Object.keys(config.mcp.servers)).toEqual([ULW_MCP_SERVER_NAME]);
    // A tool switched on later reaches a process that can already call back.
    expect(childEnv.ALCODE_AGENT_TOOL_TOKEN).toBe('token');
  });

  it('rewrites the file when a tool is turned off, without a new token', async () => {
    const { dataDir, runtime, current, agentToolRuntime, readConfigFile } = await createHarness({
      settings: {},
    });
    await runtime.buildManagedChildEnv();

    current.settings = { agentControlToolEnabled: false, agentWebToolEnabled: false };
    expect(await runtime.refreshManagedConfigFile()).toEqual({ updated: true });

    const { plugins } = await readConfigFile();
    expect(plugins).toEqual(['-opencode.browser']);
    expect(agentToolRuntime.createChildEnv).toHaveBeenCalledTimes(1);
  });

  it('turns a tool back on without a restart', async () => {
    const { runtime, current, agentToolRuntime, readConfigFile } = await createHarness({
      settings: { agentControlToolEnabled: false, agentWebToolEnabled: false },
    });
    await runtime.buildManagedChildEnv();

    current.settings = { agentControlToolEnabled: false, agentWebToolEnabled: true };
    await runtime.refreshManagedConfigFile();

    expect((await readConfigFile()).plugins).toHaveLength(2);
    expect(agentToolRuntime.materializePlugin).toHaveBeenCalledWith({
      includeControl: false,
      includeWeb: true,
      includeMemory: false,
      includeNotify: false,
      codeMode: false,
    });
  });

  it('injects the notify tool only when it is switched on', async () => {
    const { runtime, agentToolRuntime } = await createHarness({
      settings: { agentControlToolEnabled: false, agentWebToolEnabled: false, agentNotifyToolEnabled: true },
    });

    await runtime.buildManagedChildEnv();

    expect(agentToolRuntime.materializePlugin).toHaveBeenCalledWith({
      includeControl: false,
      includeWeb: false,
      includeMemory: false,
      includeNotify: true,
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
      includeWeb: true,
      includeMemory: false,
      includeNotify: false,
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
    const content = JSON.parse(childEnv.OPENCODE_CONFIG_CONTENT);
    expect(content.model).toBe('test/model');
    expect(content.plugins).toEqual(['-opencode.browser', path.join(dataDir, 'agent-tool', 'alcode-agent-tool')]);
    expect(content.mcp.servers[ULW_MCP_SERVER_NAME].type).toBe('local');
    expect(content.mcp.servers[ULW_MCP_SERVER_NAME].command[0]).toBe(process.execPath);
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
      expect(typeof agent[key].model).toBe('string');
    }
    expect(agent.oracle.model).toBe(OMO_NATIVE_AGENT_CONFIG.oracle.model);
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
    expect(agent.explore.model).toBe(OMO_NATIVE_AGENT_CONFIG.explore.model);
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
    expect(content.agent.metis.model).toBe(OMO_NATIVE_AGENT_CONFIG.metis.model);
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
    expect(content.agent.metis.model).toBe(OMO_NATIVE_AGENT_CONFIG.metis.model);
  });

  it('ignores the memory tool while the feature is unavailable', async () => {
    const { runtime, agentToolRuntime, readConfigFile } = await createHarness({
      settings: { agentControlToolEnabled: false, agentWebToolEnabled: false, agentMemoryToolEnabled: true },
      memoryAvailable: false,
    });

    await runtime.buildManagedChildEnv();

    expect(agentToolRuntime.materializePlugin).not.toHaveBeenCalled();
    const config = await readConfigFile();
    expect(config.plugins).toEqual(['-opencode.browser']);
    expect(Object.keys(config.mcp.servers)).toEqual([ULW_MCP_SERVER_NAME]);
  });
});
