/**
 * Production wiring for the startup readiness probes: binds each injected
 * probe dependency to the real local surface. Loopback OpenCode, local
 * files, local MCP stdio — no prompt text, no model invocation, no network.
 */

import { spawn } from 'node:child_process';

import { OpenCode } from '@opencode/client';

import { MANAGED_CONFIG_FILE_NAME } from './managed-config-file.js';
import { createStartupReadinessProbes } from './startup-readiness-probes.js';

const ULW_TOOLS_LIST_TIMEOUT_MS = 10_000;
const HUB_PROBE_TIMEOUT_MS = 5_000;

const readId = (data) => {
  if (data?.constructor === String) return data;
  const id = data?.id;
  return id?.constructor === String ? id : null;
};

const makeClient = (baseUrl, headers) => OpenCode.make({ baseUrl, headers });

const listUlwToolsOverStdio = ({ command, environment }) => new Promise((resolve) => {
  const child = spawn(command[0], command.slice(1), {
    env: { ...process.env, ...(environment ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let settled = false;
  const done = (value) => {
    if (settled) return;
    settled = true;
    try {
      child.kill();
    } catch {
      // Already exited; the tools/list answer (or its absence) stands.
    }
    resolve(value);
  };
  const timer = setTimeout(() => done({ ok: false, detail: 'ulw tools/list timed out' }), ULW_TOOLS_LIST_TIMEOUT_MS);
  timer.unref?.();
  let pending = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    pending += String(chunk);
    let index;
    while ((index = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, index).trim();
      pending = pending.slice(index + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        if (message?.id === 1 && message?.result?.tools) {
          clearTimeout(timer);
          done({ ok: true, detail: message.result.tools.map((tool) => tool?.name).filter(Boolean) });
          return;
        }
      } catch {
        // Non-JSON stdio noise; keep waiting for the tools/list answer.
      }
    }
  });
  child.on('error', (error) => {
    clearTimeout(timer);
    done({ ok: false, detail: `ulw entry would not spawn: ${error?.message ?? error}` });
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    done({ ok: false, detail: `ulw entry exited before tools/list answered (code ${code ?? 'unknown'})` });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`);
});

export const createStartupReadinessWiring = (dependencies = {}) => {
  const {
    getOpenCodeBaseUrl = null,
    getOpenCodeHeaders = null,
    defaultDirectory,
    omoNativeRuntime = null,
    managedDataDir = null,
    fsPromises = null,
    path = null,
    getSmallModelClient = null,
    listModelInfos = null,
    resetOpenCodeRuntimeProviders = null,
    getMessageStreamHub = null,
  } = dependencies;

  // Builders are called per probe run: the managed OpenCode port and
  // server password both move across a restart, so captured values would
  // go stale exactly when readiness matters most.
  const openCodeBaseUrl = () => need('getOpenCodeBaseUrl', getOpenCodeBaseUrl)();
  const openCodeHeaders = () => need('getOpenCodeHeaders', getOpenCodeHeaders)() ?? {};

  const need = (name, value) => {
    if (value === null || value === undefined) throw new Error(`startup readiness wiring is missing "${name}"`);
    return value;
  };

  const createProbeSession = async ({ title }) => {
    const client = makeClient(openCodeBaseUrl(), openCodeHeaders());
    const { data } = await client.session.create({
      title,
      location: { directory: need('defaultDirectory', defaultDirectory) },
    });
    return readId(data);
  };

  const deleteProbeSession = async (id) => {
    const client = makeClient(openCodeBaseUrl(), openCodeHeaders());
    await client.session.remove({ sessionID: id });
  };

  const materializeNativePlugin = async () => {
    const runtime = need('omoNativeRuntime', omoNativeRuntime);
    const directory = await runtime.materializePlugin();
    const indexPath = need('path', path).join(directory, 'index.js');
    const payload = await need('fsPromises', fsPromises).readFile(indexPath, 'utf8');
    return {
      directory,
      setupPayloadBytes: payload.length,
      hasSetup: payload.includes('ulw_') && !payload.includes('setup: async () => {}'),
    };
  };

  const listUlwTools = async () => {
    const dataDir = need('managedDataDir', managedDataDir);
    const raw = await need('fsPromises', fsPromises).readFile(
      need('path', path).join(dataDir, MANAGED_CONFIG_FILE_NAME),
      'utf8',
    );
    const entry = JSON.parse(raw)?.mcp?.servers?.ulw;
    if (!entry || !Array.isArray(entry.command) || entry.command.length === 0) {
      return { ok: false, detail: 'managed config names no ulw entry' };
    }
    return listUlwToolsOverStdio(entry);
  };

  const resolveInitialModel = async () => {
    const client = need('getSmallModelClient', getSmallModelClient)();
    const models = await need('listModelInfos', listModelInfos)(client);
    const isUsableModel = (entry) => entry?.enabled !== false
      && entry?.providerID?.constructor === String
      && entry?.modelID?.constructor === String;
    const usable = (Array.isArray(models) ? models : []).find(isUsableModel);
    return usable ? { providerID: usable.providerID, modelID: usable.modelID } : null;
  };

  const forkProbeChild = async (parentSessionId) => {
    const client = makeClient(openCodeBaseUrl(), openCodeHeaders());
    const { data } = await client.session.fork({ sessionID: parentSessionId });
    return readId(data);
  };

  const checkEventInterfaces = async () => {
    const hub = need('getMessageStreamHub', getMessageStreamHub)();
    const canFanOut = hub?.subscribeEvent?.constructor === Function
      && hub?.injectEvent?.constructor === Function;
    if (!hub || !canFanOut) {
      return { ok: false, detail: 'message-stream hub is not wired' };
    }
    const received = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), HUB_PROBE_TIMEOUT_MS);
      timer.unref?.();
      const unsubscribe = hub.subscribeEvent(() => {
        clearTimeout(timer);
        resolve(true);
        queueMicrotask(() => unsubscribe());
      });
      try {
        hub.injectEvent({ payload: { type: 'alcode.startup-readiness-probe' }, directory: 'global' });
      } catch {
        clearTimeout(timer);
        resolve(false);
        queueMicrotask(() => unsubscribe());
      }
    });
    const connected = hub.isConnected?.constructor === Function || hub.isConnected?.constructor === AsyncFunction
      ? hub.isConnected()
      : null;
    if (!received) return { ok: false, detail: 'hub fan-out did not deliver the probe event', connected };
    return { ok: true, detail: 'hub fan-out delivered the probe event', connected };
  };

  const { run: runProbes } = createStartupReadinessProbes({
    createProbeSession,
    deleteProbeSession,
    materializeNativePlugin,
    listUlwTools,
    resolveInitialModel,
    forkProbeChild,
    checkEventInterfaces,
  });

  // Narrow, named repair: re-prove the failed layer only, never restart.
  const repairStep = async (failedStep) => {
    if (failedStep === 'native-plugin-materialized' || failedStep === 'ulw-tools-discoverable') {
      await need('omoNativeRuntime', omoNativeRuntime).materializePlugin();
      return { repaired: failedStep };
    }
    if (failedStep === 'model-resolution-initialized') {
      await need('resetOpenCodeRuntimeProviders', resetOpenCodeRuntimeProviders)();
      return { repaired: failedStep };
    }
    return {};
  };

  return { runProbes, repairStep };
};
