// OmO adapter-A runtime bridge (project-ide todo 6).
//
// Spawns the USER-INSTALLED engine wrapper (`bin/oh-my-opencode.js`) and
// funnels its run-graph events into a local JSON snapshot the DAG pane
// (todo 13) renders. Nothing here bundles, fetches, or auto-installs engine
// code: when the wrapper entry is absent every path answers the documented
// degraded message and never hangs.
//
// Wrapper contract (pinned, see .omo/evidence/task-7-project-ide.md):
//   probe  -> `<entry> --version` + `<entry> run --help` (bounded)
//   invoke -> `run <message> [--port N | --attach URL] [--session-id ID] [--model P/M] --json`
//   gate   -> Slice E (task 52, Gap 5): the effective model (explicit >
//             catalog role > catalog current) maps to a provider; a wired
//             readiness predicate fail-closed here throws
//             OMO_PROVIDER_NOT_SIGNED_IN naming model + provider before
//             any spawn, and alcore-bound runs pin `--model alcore/<id>`.
//   stream -> `omo.dag.updated` + `omo.task.updated` filtered by
//             `parent_session_id`, written to a local snapshot file
//            (the omo-herdr-dag pattern: subscribe, filter session, snapshot
//            to local JSON, watcher renders the file).
//   cancel -> PROVISIONAL kill-with-reason (see cancelRun below).
//
// Transport note: the `senpi:extension-rpc-event` bus string from the proto
// doc has zero hits in the checked-out engine sources (only
// `pi.rpc.emit(name, data)` with the channel names above is confirmed), so
// the stream stage takes events through `handleEvent(name, data)` and does
// not assume any particular bus. Whatever transport delivers the channels
// calls into the writer; the pane reads the file.
import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from 'node:child_process';
import { existsSync as nodeExistsSync } from 'node:fs';
import { join as nodeJoinPath } from 'node:path';

export const OMO_BRIDGE_EVENT_DAG_UPDATED = 'omo.dag.updated';
export const OMO_BRIDGE_EVENT_TASK_UPDATED = 'omo.task.updated';
export const OMO_BRIDGE_KNOWN_EVENTS = [OMO_BRIDGE_EVENT_DAG_UPDATED, OMO_BRIDGE_EVENT_TASK_UPDATED];
export const OMO_BRIDGE_SNAPSHOT_SCHEMA_VERSION = 1;
// Wrapper `run` flags the handshake requires (cli-program.ts: `run <message>`
// with `--port` / `--attach` / `--session-id` / `--json`).
export const OMO_BRIDGE_REQUIRED_RUN_FLAGS = ['--port', '--attach', '--session-id', '--json'];
export const OMO_BRIDGE_PROBE_TIMEOUT_MS = 10_000;
export const OMO_BRIDGE_CANCEL_GRACE_MS = 2_000;
// A snapshot file holds the last dag + task payloads only; past this the
// writer drops the update and counts it instead of growing the file.
export const OMO_BRIDGE_MAX_SNAPSHOT_BYTES = 1_000_000;
// Model→provider binding (task 52, Slice E / Gap 5): harness runs pick
// models from the engine catalog, which pins non-alcore IDs
// (model-catalog.json: gpt-6-astra everywhere) — an Alcore login only
// covers the `alcore` provider. The default list names the proven-live
// alcore model IDs; every binding input is injectable per runtime/call.
export const OMO_BRIDGE_DEFAULT_ALCORE_MODELS = ['al-1-2', 'al-1-2-flash', 'al-1-3-max'];
export const OMO_BRIDGE_DEFAULT_MODEL_ROLE = 'default';

export class OmoBridgeError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'OmoBridgeError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export const engineAbsentMessage = (entry) => (
  `OmO engine not found${entry ? ` at "${entry}"` : ''}. `
  + 'The IDE slot stays empty: install the free OmO plugin yourself with your '
  + 'own download (nothing is fetched automatically), then point OMO_WRAPPER_PATH '
  + 'at its bin/oh-my-opencode.js wrapper and retry.'
);

// JSON-decoded payloads only: primitives, arrays, and class instances never
// pass, so everything downstream can read fields directly.
const isRecord = (value) => value instanceof Object && !Array.isArray(value);

const isNonEmptyString = (value) => (value?.trim?.() ?? '').length > 0;

const firstVersionToken = (text) => {
  const match = /v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(String(text ?? ''));
  return match ? match[1] : null;
};

const createDefaultTimers = () => ({
  set: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    handle.unref?.();
    return handle;
  },
  clear: (handle) => clearTimeout(handle),
});

const safeSessionIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

export const defaultSnapshotPath = (snapshotDir, sessionId, joinPath = nodeJoinPath) => {
  if (!isNonEmptyString(snapshotDir)) {
    throw new OmoBridgeError('OMO_SNAPSHOT_DIR_INVALID', 'A snapshot directory is required to derive the snapshot path.');
  }
  if (!safeSessionIdPattern.test(sessionId ?? '')) {
    throw new OmoBridgeError('OMO_SESSION_ID_INVALID', `Refusing to derive a snapshot filename from session id ${JSON.stringify(sessionId)}.`);
  }
  return joinPath(snapshotDir, `${sessionId}.snapshot.json`);
};

// Split a `provider/model` ref into its parts; a bare id reads as
// `{ provider: null, name }`. Null on blank input (no model = no gate).
export const splitModelRef = (model) => {
  const text = model?.trim?.() ?? '';
  if (text === '') return null;
  const slash = text.indexOf('/');
  if (slash === -1) return { provider: null, name: text };
  return { provider: text.slice(0, slash).trim() || null, name: text.slice(slash + 1).trim() };
};

// Effective model for a run: an explicit model wins, else the catalog role
// (default `default`), else the catalog current. Null when nothing
// resolves — the run proceeds exactly as before (no gate, no --model).
export const resolveRunModel = ({ model, role = OMO_BRIDGE_DEFAULT_MODEL_ROLE, catalog } = {}) => {
  if (isNonEmptyString(model)) return model.trim();
  if (!isRecord(catalog)) return null;
  const wanted = isNonEmptyString(role) ? role.trim() : OMO_BRIDGE_DEFAULT_MODEL_ROLE;
  const roles = isRecord(catalog.roles) ? catalog.roles : null;
  if (roles && isRecord(roles[wanted]) && isNonEmptyString(roles[wanted].model)) {
    return roles[wanted].model.trim();
  }
  if (isRecord(catalog.current) && isNonEmptyString(catalog.current.model)) {
    return catalog.current.model.trim();
  }
  return null;
};

// Which provider serves a model: `alcore` for its model IDs (bare or
// `alcore/`-prefixed), an explicit `modelProviders` table hit otherwise,
// null when unknown — unknown proceeds ungated (nothing to name).
export const providerForModel = (model, { alcoreModels = OMO_BRIDGE_DEFAULT_ALCORE_MODELS, modelProviders = {} } = {}) => {
  const ref = splitModelRef(model);
  if (!ref || ref.name === '') return null;
  if ((ref.provider ?? '').toLowerCase() === 'alcore') return 'alcore';
  if (Array.isArray(alcoreModels)) {
    const wanted = ref.name.toLowerCase();
    for (const id of alcoreModels) {
      if ((id?.trim?.() ?? '').toLowerCase() === wanted) return 'alcore';
    }
  }
  const table = isRecord(modelProviders) ? modelProviders : {};
  const hit = table[ref.provider ? `${ref.provider}/${ref.name}` : ref.name] ?? table[ref.name] ?? null;
  const named = hit?.trim?.() ?? '';
  return named === '' ? null : named;
};

export const buildRunArgv = ({
  message, port, attachUrl, sessionId, model, agent,
}) => {
  if (!isNonEmptyString(message)) {
    throw new OmoBridgeError('OMO_INVOKE_ARGS_INVALID', 'run needs a non-empty message.');
  }
  // Gap 2 (task-7 evidence): --port and --attach are mutually exclusive.
  if (port !== undefined && attachUrl !== undefined) {
    throw new OmoBridgeError(
      'OMO_INVOKE_ARGS_INVALID',
      'Error: --port and --attach are mutually exclusive.',
    );
  }
  // Gap 4 (task-7 evidence): the wrapper rejects ports outside 1..65535.
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new OmoBridgeError('OMO_INVOKE_ARGS_INVALID', `Port must be between 1 and 65535, got ${JSON.stringify(port)}.`);
  }
  if (sessionId !== undefined && !isNonEmptyString(sessionId)) {
    throw new OmoBridgeError('OMO_INVOKE_ARGS_INVALID', 'session-id must be a non-empty string when given.');
  }
  if (model !== undefined && (!isNonEmptyString(model) || /\s/.test(model))) {
    throw new OmoBridgeError('OMO_INVOKE_ARGS_INVALID', 'model must be a non-empty provider/model ref without whitespace when given.');
  }
  if (agent !== undefined && (!isNonEmptyString(agent) || /\s/.test(agent))) {
    throw new OmoBridgeError('OMO_INVOKE_ARGS_INVALID', 'agent must be a non-empty name without whitespace when given.');
  }
  const argv = ['run', message];
  if (port !== undefined) {
    argv.push('--port', String(port));
  }
  if (attachUrl !== undefined) {
    argv.push('--attach', attachUrl);
  }
  if (sessionId !== undefined) {
    argv.push('--session-id', sessionId);
  }
  if (agent !== undefined) {
    argv.push('--agent', agent.trim());
  }
  if (model !== undefined) {
    argv.push('--model', model.trim());
  }
  argv.push('--json');
  return argv;
};

export const parseEventLine = (line) => {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { error: 'malformed_json' };
  }
  if (!isRecord(parsed)) {
    return { error: 'malformed_json' };
  }
  // The wrapper's `--json` result line is a bare RunResult
  // ({ sessionId, success, ... }) with no `type`; event lines carry one.
  if (parsed.type === undefined || parsed.type === null) {
    return { result: parsed };
  }
  return { event: { name: parsed.type, data: parsed.data } };
};

export const createSnapshotWriter = (options) => {
  const {
    sessionId,
    snapshotPath,
    fs,
    now = Date.now,
    maxSnapshotBytes = OMO_BRIDGE_MAX_SNAPSHOT_BYTES,
  } = options ?? {};
  if (!isNonEmptyString(sessionId)) {
    throw new OmoBridgeError('OMO_SESSION_ID_INVALID', 'The snapshot writer needs the session id to filter on.');
  }
  if (!isNonEmptyString(snapshotPath)) {
    throw new OmoBridgeError('OMO_SNAPSHOT_DIR_INVALID', 'The snapshot writer needs a snapshot file path.');
  }
  if (!fs?.writeFileSync || !fs?.renameSync) {
    throw new OmoBridgeError('OMO_SNAPSHOT_DIR_INVALID', 'The snapshot writer needs an fs with writeFileSync + renameSync.');
  }

  const stats = {
    received: 0,
    acceptedDag: 0,
    acceptedTask: 0,
    droppedMalformed: 0,
    droppedWrongSession: 0,
    droppedUnknownType: 0,
    droppedOversize: 0,
    writes: 0,
  };
  let dag = null;
  let tasks = null;

  const writeSnapshot = () => {
    const document = {
      schemaVersion: OMO_BRIDGE_SNAPSHOT_SCHEMA_VERSION,
      sessionId,
      updatedAt: new Date(now()).toISOString(),
      dag,
      tasks,
    };
    const serialized = JSON.stringify(document);
    if (Buffer.byteLength(serialized, 'utf8') > maxSnapshotBytes) {
      stats.droppedOversize += 1;
      return { accepted: true, written: false, reason: 'snapshot_too_large' };
    }
    const temporaryPath = `${snapshotPath}.tmp`;
    fs.writeFileSync(temporaryPath, serialized, 'utf8');
    fs.renameSync(temporaryPath, snapshotPath);
    stats.writes += 1;
    return { accepted: true, written: true };
  };

  const handleEvent = (name, data) => {
    stats.received += 1;
    if (name !== OMO_BRIDGE_EVENT_DAG_UPDATED && name !== OMO_BRIDGE_EVENT_TASK_UPDATED) {
      stats.droppedUnknownType += 1;
      return { accepted: false, written: false, reason: 'unknown_event' };
    }
    if (!isRecord(data)) {
      stats.droppedMalformed += 1;
      return { accepted: false, written: false, reason: 'malformed_event' };
    }
    if (data.parent_session_id !== sessionId) {
      stats.droppedWrongSession += 1;
      return { accepted: false, written: false, reason: 'wrong_session' };
    }
    if (name === OMO_BRIDGE_EVENT_DAG_UPDATED) {
      dag = data;
      stats.acceptedDag += 1;
    } else {
      tasks = data;
      stats.acceptedTask += 1;
    }
    return writeSnapshot();
  };

  // Never throws on input problems: malformed lines degrade to counters so
  // one bad engine line can never crash the host. Filesystem failures
  // propagate — the caller (e.g. the child pump) records and continues.
  const handleLine = (line) => {
    if (!isNonEmptyString(line)) {
      return { accepted: false, written: false, reason: 'empty_line' };
    }
    const parsed = parseEventLine(line);
    if (parsed.error) {
      stats.received += 1;
      stats.droppedMalformed += 1;
      return { accepted: false, written: false, reason: 'malformed_json' };
    }
    if (parsed.result) {
      return { accepted: false, written: false, reason: 'run_result_line' };
    }
    return handleEvent(parsed.event.name, parsed.event.data);
  };

  return {
    sessionId,
    snapshotPath,
    stats,
    handleEvent,
    handleLine,
  };
};

export const createOmoBridgeRuntime = (dependencies = {}) => {
  const {
    spawn = nodeSpawn,
    spawnSync = nodeSpawnSync,
    existsSync = nodeExistsSync,
    fs = null,
    timers = createDefaultTimers(),
    now = Date.now,
    resolveEngineEntry = () => process.env.OMO_WRAPPER_PATH ?? null,
    snapshotDir = null,
    probeTimeoutMs = OMO_BRIDGE_PROBE_TIMEOUT_MS,
    cancelGraceMs = OMO_BRIDGE_CANCEL_GRACE_MS,
    // Slice E binding inputs (all optional, per-call overrides win):
    // `modelProviders` maps model refs to provider ids, `alcoreModels`
    // lists the alcore-served IDs, `isProviderReady(provider)` is a SYNC
    // predicate (null skips the gate), `modelCatalog` carries the engine
    // catalog shape ({ current: { model }, roles: { [role]: { model } } })
    // with `modelRole` selecting the role. Production can back
    // isProviderReady with the provider card snapshot; the bridge itself
    // never phones OpenCode here, so invoke stays synchronous.
    modelProviders = {},
    alcoreModels = OMO_BRIDGE_DEFAULT_ALCORE_MODELS,
    isProviderReady = null,
    modelCatalog = null,
    modelRole = OMO_BRIDGE_DEFAULT_MODEL_ROLE,
  } = dependencies;

  const resolveEntry = () => {
    const entry = resolveEngineEntry();
    return entry?.length > 0 ? entry : null;
  };

  // Version/capability handshake against the user-installed wrapper entry.
  // Bounded by spawnSync timeout: engine-absent or wedged always answers a
  // degraded object, never a hang.
  const probe = async ({ timeoutMs = probeTimeoutMs } = {}) => {
    const entry = resolveEntry();
    if (!entry || !existsSync(entry)) {
      return {
        available: false,
        compatible: false,
        code: 'OMO_ENGINE_ABSENT',
        entry,
        message: engineAbsentMessage(entry),
      };
    }
    const runBounded = (args) => {
      try {
        const completed = spawnSync(entry, args, {
          timeout: timeoutMs,
          encoding: 'utf8',
          windowsHide: true,
        });
        return {
          timedOut: completed.error?.code === 'ETIMEDOUT',
          exitCode: completed.status,
          stdout: String(completed.stdout ?? ''),
        };
      } catch (error) {
        return { timedOut: false, exitCode: null, stdout: '', spawnError: error };
      }
    };
    const version = runBounded(['--version']);
    if (version.spawnError) {
      return {
        available: false,
        compatible: false,
        code: 'OMO_SPAWN_FAILED',
        entry,
        message: `OmO engine at "${entry}" could not be started: ${version.spawnError.message ?? version.spawnError}.`,
      };
    }
    if (version.timedOut) {
      return {
        available: false,
        compatible: false,
        code: 'OMO_PROBE_TIMEOUT',
        entry,
        message: `OmO engine at "${entry}" did not answer --version within ${timeoutMs}ms.`,
      };
    }
    const help = runBounded(['run', '--help']);
    if (help.spawnError || help.timedOut) {
      return {
        available: false,
        compatible: false,
        code: help.timedOut ? 'OMO_PROBE_TIMEOUT' : 'OMO_SPAWN_FAILED',
        entry,
        version: firstVersionToken(version.stdout),
        message: `OmO engine at "${entry}" answered --version but not run --help within ${timeoutMs}ms.`,
      };
    }
    const runFlags = OMO_BRIDGE_REQUIRED_RUN_FLAGS.filter((flag) => help.stdout.includes(flag));
    const missingRunFlags = OMO_BRIDGE_REQUIRED_RUN_FLAGS.filter((flag) => !help.stdout.includes(flag));
    return {
      available: true,
      compatible: missingRunFlags.length === 0,
      code: missingRunFlags.length === 0 ? 'OMO_PROBE_OK' : 'OMO_PROBE_INCOMPATIBLE',
      entry,
      version: firstVersionToken(version.stdout),
      runFlags,
      missingRunFlags,
      message: missingRunFlags.length === 0
        ? null
        : `OmO engine at "${entry}" lacks run flags: ${missingRunFlags.join(', ')}.`,
    };
  };

  // Spawn `run <message> --port/--attach/--session-id/--model/--json`
  // through the wrapper contract. Throws OMO_ENGINE_ABSENT before spawning
  // when the entry is missing, so engine-absent degrades instead of
  // hanging. Slice E gate: when the effective model maps to a known
  // provider and a readiness predicate is wired, an unsigned provider
  // throws OMO_PROVIDER_NOT_SIGNED_IN naming model + provider BEFORE any
  // spawn — nothing is spent. Alcore-bound runs pin `--model
  // alcore/<id>` so the spend cannot land on the engine catalog default.
  const invoke = ({
    message,
    port,
    attachUrl,
    sessionId,
    onEvent,
    snapshotPath: explicitSnapshotPath,
    model,
    role,
    catalog,
    modelProviders: callModelProviders,
    alcoreModels: callAlcoreModels,
    isProviderReady: callIsProviderReady,
    agent,
  } = {}) => {
    const entry = resolveEntry();
    if (!entry || !existsSync(entry)) {
      throw new OmoBridgeError('OMO_ENGINE_ABSENT', engineAbsentMessage(entry), { entry });
    }
    const effectiveModel = resolveRunModel({ model, role: role ?? modelRole, catalog: catalog ?? modelCatalog });
    let argvModel;
    if (effectiveModel !== null) {
      const provider = providerForModel(effectiveModel, {
        alcoreModels: callAlcoreModels ?? alcoreModels,
        modelProviders: callModelProviders ?? modelProviders,
      });
      const ready = callIsProviderReady ?? isProviderReady;
      if (provider !== null && ready !== null && ready !== undefined) {
        let ok = false;
        try {
          ok = ready(provider) === true;
        } catch {
          ok = true; // A broken checker must not wedge runs: skip the gate.
        }
        if (!ok) {
          throw new OmoBridgeError(
            'OMO_PROVIDER_NOT_SIGNED_IN',
            `Model "${effectiveModel}" needs provider "${provider}" — sign it in first. No run was started.`,
            { model: effectiveModel, provider },
          );
        }
      }
      if (provider === 'alcore') {
        argvModel = `alcore/${splitModelRef(effectiveModel)?.name ?? effectiveModel}`;
      } else if (isNonEmptyString(model)) {
        argvModel = effectiveModel;
      }
    }
    const argv = buildRunArgv({
      message,
      port,
      attachUrl,
      sessionId,
      model: argvModel,
      agent: isNonEmptyString(agent) ? agent.trim() : undefined,
    });
    const writer = sessionId !== undefined && fs
      ? createSnapshotWriter({
        sessionId,
        snapshotPath: explicitSnapshotPath ?? (snapshotDir ? defaultSnapshotPath(snapshotDir, sessionId) : null),
        fs,
        now,
      })
      : null;
    let child;
    try {
      child = spawn(entry, argv, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      throw new OmoBridgeError('OMO_SPAWN_FAILED', `OmO engine at "${entry}" could not be started: ${error.message ?? error}.`, { entry });
    }
    let stdoutRemainder = '';
    let finalResult = null;
    let streamError = null;
    const pumpLine = (line) => {
      const parsed = parseEventLine(line);
      if (parsed.error || parsed.result) {
        if (parsed.result) {
          finalResult = parsed.result;
        }
        return;
      }
      try {
        if (writer) {
          writer.handleLine(line);
        }
        onEvent?.(parsed.event.name, parsed.event.data);
      } catch (error) {
        streamError = error;
      }
    };
    child.stdout?.on('data', (chunk) => {
      stdoutRemainder += String(chunk);
      const lines = stdoutRemainder.split('\n');
      stdoutRemainder = lines.pop() ?? '';
      for (const line of lines) {
        pumpLine(line);
      }
    });
    const wait = () => new Promise((resolve, reject) => {
      child.on('error', (error) => {
        reject(new OmoBridgeError('OMO_SPAWN_FAILED', `OmO engine at "${entry}" could not be started: ${error.message ?? error}.`, { entry }));
      });
      child.on('close', (exitCode, signal) => {
        if (stdoutRemainder.trim().length > 0) {
          pumpLine(stdoutRemainder);
          stdoutRemainder = '';
        }
        const resultSessionId = isRecord(finalResult) && isNonEmptyString(finalResult.sessionId)
          ? finalResult.sessionId
          : null;
        resolve({
          exitCode,
          signal: signal ?? null,
          result: finalResult,
          sessionId: resultSessionId ?? sessionId ?? null,
          streamError,
        });
      });
    });
    return {
      entry,
      argv,
      child,
      writer,
      wait,
      cancel: (reason) => cancelRun({ child }, reason, { timers, cancelGraceMs }),
    };
  };

  return {
    probe,
    invoke,
    createSnapshotWriter: (options) => createSnapshotWriter({ ...options, fs: options.fs ?? fs, now }),
    buildRunArgv,
    parseEventLine,
    defaultSnapshotPath,
  };
};

// PROVISIONAL cancel semantics (project-ide todo 6 / task-7 Gap 1): the
// adapter-side path is CONFIRMED (runner cleanup delegates to the server
// connection's cleanup; SIGINT maps to exit 130), but whether closing the
// server handle terminates the spawned engine OS process or only releases
// the client is NOT decidable from the vendored SDK, so this bridge kills
// the wrapper child it owns directly: SIGTERM with the caller's reason
// recorded, SIGKILL after a bounded grace, and a receipt describing what
// happened. Revisit when the engine confirms process-kill semantics.
export const cancelRun = (handle, reason, dependencies = {}) => {
  const { timers = createDefaultTimers(), cancelGraceMs = OMO_BRIDGE_CANCEL_GRACE_MS } = dependencies;
  const child = handle?.child;
  if (!child || !child.kill) {
    throw new OmoBridgeError('OMO_CANCEL_NO_CHILD', 'Nothing to cancel: the run handle carries no live child.');
  }
  // A signal-terminated child keeps exitCode null with signalCode set, so
  // both mark a dead child; otherwise a second cancel would wait forever.
  const isDead = () => (child.exitCode !== null && child.exitCode !== undefined)
    || (child.signalCode !== null && child.signalCode !== undefined);
  const cause = isNonEmptyString(reason) ? reason : 'cancel requested';
  if (isDead()) {
    return Promise.resolve({
      provisional: true,
      alreadyExited: true,
      escalated: false,
      reason: cause,
      exitCode: child.exitCode,
      signal: child.signalCode ?? null,
    });
  }
  return new Promise((resolve) => {
    let escalated = false;
    const grace = timers.set(() => {
      if (!isDead()) {
        escalated = true;
        try {
          child.kill('SIGKILL');
        } catch {
          // The child may have exited between the check and the kill; the
          // exit listener below still settles the receipt.
        }
      }
    }, cancelGraceMs);
    grace?.unref?.();
    child.on('exit', (exitCode, signal) => {
      timers.clear(grace);
      resolve({
        provisional: true,
        alreadyExited: false,
        escalated,
        reason: cause,
        exitCode,
        signal: signal ?? null,
      });
    });
    try {
      child.kill('SIGTERM');
    } catch {
      timers.clear(grace);
      resolve({
        provisional: true,
        alreadyExited: false,
        escalated: false,
        reason: cause,
        exitCode: child.exitCode ?? null,
        signal: child.signalCode ?? null,
      });
    }
  });
};
