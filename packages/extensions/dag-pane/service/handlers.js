// DAG pane local service handlers (project-ide todo 13).
//
// The panel iframe stays sandboxed: every privileged step runs here, in the
// host-spawned service process, behind the host's loopback proxy. These
// handlers wrap the adapter-A bridge from todo 6
// (`packages/web/server/lib/opencode/omo-bridge-runtime.js`): probe for
// engine presence, steer by invoking a run attached to the live session,
// cancel through the bridge's provisional kill-with-reason, and read the
// snapshot files the bridge writer produces.
//
// `service/main.js` maps HTTP onto `handleRequest`; the unit tests call it
// directly with a stub bridge, so no server or engine is needed to prove
// the steer/cancel wiring.
import { tmpdir as osTmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import nodeFs from 'node:fs';

import {
  createOmoBridgeRuntime,
  defaultSnapshotPath,
} from '../../../web/server/lib/opencode/omo-bridge-runtime.js';

export const DAG_SERVICE_NAME = 'openchamber-builtin-dag-pane';
export const DAG_SERVICE_DEFAULT_SNAPSHOT_PREFIX = 'omo-dag-snapshots';
export const DAG_SERVICE_MAX_BODY_BYTES = 1_000_000;

// Flow-trace debugger (dag-diagnostics): the composer route decision the UI
// last reported plus per-stage engine-side evidence, all machine values.
export const DAG_DEBUG_ROUTE_DECISIONS = ['captured-to-/ulw', 'plain-prompt', 'shell', 'slash-command'];
export const DAG_DEBUG_SAMPLE_MAX = 60;
export const DAG_DEBUG_MESSAGE_MAX = 140;
export const DAG_DEBUG_MAX_LEDGER_BYTES = 1_048_576;
// Mirrors ULTRAWORK_CURRENT_PROMPT_PATTERN in
// packages/omo-engine/omo-codex/plugin/components/ulw-loop/src/ultrawork-directive.ts.
// The service ships plain JS, so the literal is duplicated, not imported.
export const DAG_DEBUG_HOOK_PATTERN = '(?:ultrawork|ulw)';

export const defaultServiceSnapshotDir = (tmpdir = osTmpdir, join = joinPath) => (
  join(tmpdir(), DAG_SERVICE_DEFAULT_SNAPSHOT_PREFIX)
);

const isNonEmptyString = (value) => (value?.trim?.() ?? '').length > 0;

const existsFile = (fs, path) => {
  try {
    return fs.statSync(path).isFile();
  } catch {
    return false;
  }
};

// Engine-side loop evidence for GET /debug: which state files exist under
// .omo/ulw-loop/<session> plus the ledger event count. Never throws: every
// read degrades to a false/zero value the pane renders as-is.
const readLoopState = (fs, directory, sessionId) => {
  if (!isNonEmptyString(directory)) {
    return { dir: null, plan: false, goals: false, ledger: false, events: 0 };
  }
  const root = directory.trim().replace(/[/\\]+$/, '');
  const dir = `${root}/.omo/ulw-loop/${sessionId}`;
  const plan = existsFile(fs, `${dir}/plan.json`);
  const goals = existsFile(fs, `${dir}/goals.json`);
  const ledgerPath = `${dir}/ledger.jsonl`;
  const ledger = existsFile(fs, ledgerPath);
  let events = 0;
  if (ledger) {
    try {
      const text = fs.readFileSync(ledgerPath, 'utf8').slice(0, DAG_DEBUG_MAX_LEDGER_BYTES);
      events = text.split('\n').filter((line) => line.trim().length > 0).length;
    } catch {
      events = 0;
    }
  }
  return { dir, plan, goals, ledger, events };
};

// Bridge-snapshot evidence for GET /debug: file presence, mtime, and
// whether the stored session matches the requested one. Never throws.
const readSnapshotState = (fs, snapshotPathFor, sessionId) => {
  let snapshotPath;
  try {
    snapshotPath = snapshotPathFor(sessionId);
  } catch {
    return { path: null, exists: false, updatedAt: null, sessionMatch: false };
  }
  let mtime = null;
  try {
    mtime = fs.statSync(snapshotPath).mtime;
  } catch {
    return { path: snapshotPath, exists: false, updatedAt: null, sessionMatch: false };
  }
  let sessionMatch = false;
  try {
    sessionMatch = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))?.sessionId === sessionId;
  } catch {
    sessionMatch = false;
  }
  let updatedAt = null;
  try {
    updatedAt = mtime instanceof Date ? mtime.toISOString() : new Date(mtime).toISOString();
  } catch {
    updatedAt = null;
  }
  return { path: snapshotPath, exists: true, updatedAt, sessionMatch };};

const snapshotSessions = (fs, snapshotDir) => {
  let entries;
  try {
    entries = fs.readdirSync(snapshotDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.snapshot.json'))
    .map((name) => name.slice(0, -'.snapshot.json'.length))
    .sort();
};

export const createDagServiceHandlers = (dependencies = {}) => {
  const {
    fs = nodeFs,
    snapshotDir = defaultServiceSnapshotDir(),
    now = Date.now,
    createBridge = (entry) => createOmoBridgeRuntime({
      fs,
      snapshotDir,
      resolveEngineEntry: () => entry ?? process.env.OMO_WRAPPER_PATH ?? null,
    }),
  } = dependencies;

  try {
    fs.mkdirSync(snapshotDir, { recursive: true });
  } catch {
    // Reads degrade to NOT_FOUND and steer reports the write failure; a
    // missing directory must never crash the service process.
  }

  // sessionId -> { cancel, startedAt }: runs this service started that have
  // not reported their child closing yet. Cancel targets the latest steer
  // per session; a closed child removes its own entry.
  const live = new Map();

  // Latest composer route decision reported via POST /debug/route, merged
  // per report: { decision, sample, command, arguments, sessionId, at }.
  // Bounded by construction (one record); a service restart clears it.
  let lastRoute = null;

  const bridgeError = (error, fallbackCode) => {
    const code = error?.code ?? fallbackCode;
    if (code === 'OMO_ENGINE_ABSENT') {
      return { status: 503, body: { ok: false, code, message: error.message } };
    }
    if (code === 'OMO_INVOKE_ARGS_INVALID' || code === 'OMO_SESSION_ID_INVALID' || code === 'OMO_SNAPSHOT_DIR_INVALID') {
      return { status: 400, body: { ok: false, code, message: error.message } };
    }
    if (code === 'OMO_PROVIDER_NOT_SIGNED_IN') {
      return { status: 409, body: { ok: false, code, message: error.message } };
    }
    return { status: 500, body: { ok: false, code, message: error?.message ?? 'The DAG service failed.' } };
  };

  const snapshotPathFor = (sessionId) => defaultSnapshotPath(snapshotDir, sessionId);

  const readSnapshot = (sessionId) => {
    let snapshotPath;
    try {
      snapshotPath = snapshotPathFor(sessionId);
    } catch (error) {
      return { status: 400, body: { ok: false, code: error.code ?? 'OMO_SESSION_ID_INVALID', message: error.message } };
    }
    let text;
    try {
      text = fs.readFileSync(snapshotPath, 'utf8');
    } catch {
      return { status: 404, body: { ok: false, code: 'OMO_DAG_SNAPSHOT_MISSING', sessionId } };
    }
    try {
      return { status: 200, body: JSON.parse(text) };
    } catch {
      return { status: 422, body: { ok: false, code: 'DAG_SNAPSHOT_MALFORMED', field: 'snapshot', sessionId } };
    }
  };

  const handleRequest = async ({ method, path, query = {}, body = {} } = {}) => {
    if (method === 'GET' && path === '/health') {
      return { status: 200, body: { ok: true, service: DAG_SERVICE_NAME } };
    }
    if (method === 'GET' && path === '/status') {
      const entry = isNonEmptyString(query?.entry) ? query.entry.trim() : undefined;
      const bridge = createBridge(entry);
      const probe = await bridge.probe();
      return {
        status: 200,
        body: {
          ok: true,
          probe,
          sessions: snapshotSessions(fs, snapshotDir),
          snapshotDir,
          now: new Date(now()).toISOString(),
        },
      };
    }
    if (method === 'POST' && path === '/debug/route') {
      const decision = body?.decision;
      if (!DAG_DEBUG_ROUTE_DECISIONS.includes(decision)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_ROUTE_INVALID', message: 'Route reports one decision: captured-to-/ulw, plain-prompt, shell, or slash-command.' } };
      }
      const sample = typeof body?.sample === 'string' ? body.sample.slice(0, DAG_DEBUG_SAMPLE_MAX) : '';
      const command = isNonEmptyString(body?.command) ? body.command.trim().slice(0, 128) : null;
      const args = typeof body?.arguments === 'string' ? body.arguments.slice(0, 512) : null;
      const routeSessionId = isNonEmptyString(body?.sessionId) ? body.sessionId.trim() : null;
      lastRoute = {
        decision,
        sample,
        command,
        arguments: args,
        sessionId: routeSessionId,
        at: new Date(now()).toISOString(),
      };
      return { status: 200, body: { ok: true, route: lastRoute } };
    }
    if (method === 'GET' && path === '/debug') {
      const sessionId = query?.sessionId;
      if (!isNonEmptyString(sessionId)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Pass ?sessionId=<run session>.' } };
      }
      const trimmedSession = sessionId.trim();
      if (trimmedSession.includes('/') || trimmedSession.includes('\\') || trimmedSession.includes('..')) {
        return { status: 400, body: { ok: false, code: 'OMO_SESSION_ID_INVALID', message: 'Session ids stay inside one directory.' } };
      }
      const hookSample = lastRoute?.sample
        ?? (typeof query?.sample === 'string' ? query.sample.slice(0, DAG_DEBUG_SAMPLE_MAX) : '');
      let hookHit = false;
      try {
        hookHit = new RegExp(DAG_DEBUG_HOOK_PATTERN, 'i').test(hookSample);
      } catch {
        hookHit = false;
      }
      const loop = readLoopState(fs, query?.directory, trimmedSession);
      const snapshot = readSnapshotState(fs, snapshotPathFor, trimmedSession);
      let probe;
      try {
        const entry = isNonEmptyString(query?.entry) ? query.entry.trim() : undefined;
        probe = await createBridge(entry).probe();
      } catch (error) {
        probe = { available: false, compatible: false, code: 'OMO_DEBUG_PROBE_THROW', message: String(error?.message ?? error).slice(0, DAG_DEBUG_MESSAGE_MAX) };
      }
      const probeRecord = probe !== null && typeof probe === 'object' ? probe : {};
      return {
        status: 200,
        body: {
          ok: true,
          route: lastRoute,
          hook: { pattern: DAG_DEBUG_HOOK_PATTERN, hit: hookHit, sample: hookSample },
          loop,
          snapshot,
          probe: {
            code: typeof probeRecord.code === 'string' ? probeRecord.code : null,
            available: probeRecord.available === true,
            compatible: probeRecord.compatible === true,
            entry: typeof probeRecord.entry === 'string' || probeRecord.entry === null ? probeRecord.entry ?? null : null,
            message: typeof probeRecord.message === 'string' ? probeRecord.message.slice(0, DAG_DEBUG_MESSAGE_MAX) : null,
          },
          sessions: snapshotSessions(fs, snapshotDir),
          snapshotDir,
          now: new Date(now()).toISOString(),
        },
      };
    }
    if (method === 'GET' && path === '/snapshot') {
      const sessionId = query?.sessionId;
      if (!isNonEmptyString(sessionId)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Pass ?sessionId=<run session>.' } };
      }
      return readSnapshot(sessionId.trim());
    }
    if (method === 'POST' && path === '/steer') {
      const message = body?.message;
      const sessionId = body?.sessionId;
      const entry = isNonEmptyString(body?.entry) ? body.entry.trim() : undefined;
      if (!isNonEmptyString(message)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_MESSAGE_REQUIRED', message: 'Steering needs a non-empty message.' } };
      }
      if (!isNonEmptyString(sessionId)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Steering attaches to a live session: pass sessionId.' } };
      }
      let snapshotPath;
      try {
        snapshotPath = snapshotPathFor(sessionId.trim());
      } catch (error) {
        return { status: 400, body: { ok: false, code: error.code ?? 'OMO_SESSION_ID_INVALID', message: error.message } };
      }
      const model = isNonEmptyString(body?.model) ? body.model.trim() : undefined;
      const agent = isNonEmptyString(body?.agent) ? body.agent.trim() : undefined;
      const bridge = createBridge(entry);
      let handle;
      try {
        handle = bridge.invoke({
          message: message.trim(),
          sessionId: sessionId.trim(),
          snapshotPath,
          model,
          agent,
        });
      } catch (error) {
        return bridgeError(error, 'OMO_SPAWN_FAILED');
      }
      const startedAt = new Date(now()).toISOString();
      live.set(sessionId.trim(), { cancel: handle.cancel, startedAt });
      handle.wait().then(
        () => {
          if (live.get(sessionId.trim())?.cancel === handle.cancel) {
            live.delete(sessionId.trim());
          }
        },
        () => {
          if (live.get(sessionId.trim())?.cancel === handle.cancel) {
            live.delete(sessionId.trim());
          }
        },
      );
      return {
        status: 200,
        body: {
          ok: true, sessionId: sessionId.trim(), entry: handle.entry, argv: handle.argv, startedAt,
          native: handle.native === true,
        },
      };
    }
    if (method === 'POST' && path === '/cancel') {
      const sessionId = body?.sessionId;
      if (!isNonEmptyString(sessionId)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Cancel targets a live session: pass sessionId.' } };
      }
      const running = live.get(sessionId.trim());
      if (!running) {
        return { status: 404, body: { ok: false, code: 'OMO_DAG_NO_RUN', sessionId: sessionId.trim() } };
      }
      let receipt;
      try {
        receipt = await running.cancel(isNonEmptyString(body?.reason) ? body.reason.trim() : 'pane cancel');
      } catch (error) {
        return bridgeError(error, 'OMO_CANCEL_FAILED');
      }
      live.delete(sessionId.trim());
      return { status: 200, body: { ok: true, sessionId: sessionId.trim(), receipt } };
    }
    return { status: 404, body: { ok: false, code: 'OMO_DAG_UNKNOWN_PATH', path } };
  };

  return { handleRequest, live };
};
