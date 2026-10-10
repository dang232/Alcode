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
//   native -> opt-in `OMO_NATIVE_RUN=1`: spawns `bun omo-invoker-worker.ts`
//             (same directory as this module; bun-only, never imported by
//             plain-Node consumers) which imports the engine run barrel
//             in-process. Contains run()'s stdio/env/telemetry globals in
//             the worker. Same handle shape (wait/cancel/writer); explicit
//             opt-in never silently downgrades — unresolvable native setup
//             throws OMO_NATIVE_UNAVAILABLE.
//
// Transport note: the `senpi:extension-rpc-event` bus string from the proto
// doc has zero hits in the checked-out engine sources (only
// `pi.rpc.emit(name, data)` with the channel names above is confirmed), so
// the stream stage takes events through `handleEvent(name, data)` and does
// not assume any particular bus. Whatever transport delivers the channels
// calls into the writer; the pane reads the file.
import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from 'node:child_process';
import { existsSync as nodeExistsSync, readFileSync as nodeReadFileSync } from 'node:fs';
import { dirname as nodeDirname, join as nodeJoinPath } from 'node:path';
import { fileURLToPath as nodeFileURLToPath } from 'node:url';

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
export const OMO_NATIVE_RUN_ENV = 'OMO_NATIVE_RUN';
export const OMO_BUN_PATH_ENV = 'OMO_BUN_PATH';
export const OMO_ENGINE_ROOT_ENV = 'OMO_ENGINE_ROOT';
// Subpath from an engine checkout root to the run barrel (see
// cli-program.ts run contract + run/index.ts barrel).
export const OMO_ENGINE_RUN_BARREL = 'packages/omo-opencode/src/cli/run/index.ts';
// In-tree engine (direct vendor): no wrapper, no download, no env.
export const OMO_VENDORED_ENGINE_DIR = 'omo-engine';
export const OMO_VENDORED_RUN_BARREL = 'omo-opencode/src/cli/run/index.ts';

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

// Live predicate sources (omo-full-integration T4, closes GAP-5).
//
// `modelCatalog` feeds from the engine codex catalog file
//   `packages/omo-engine/omo-codex/plugin/model-catalog.json`
// (`{ current: { model }, roles: { [role]: { model } }, ... }`, the same file
// `readCodexModelCatalog(codexPackageRoot)` reads from `<root>/plugin/`); a
// run caller may instead pass its own role choice in the same bridge shape.
// `isProviderReady` feeds from the provider-card snapshot: OpenCode
// `GET /api/integration` read once by the async caller (ui:
// `loadIntegrationCatalog()` in
// `packages/ui/src/lib/opencode/integration-catalog.ts`; server:
// `readOpenCodeCredentials()` in `auth.js`), interpreted per provider by
// the card rule (`getProviderCardStatus` in
// `packages/ui/src/components/sections/providers/providerAuth.ts`).
// Both adapters below are SYNC and fail-closed: the bridge never phones
// OpenCode, so the live fetch happens outside and the snapshot crosses in
// as data. Reads are never cached — every call re-reads, so a credential
// write cannot leave a stale ready behind (resolve at call time; a failed
// read throws upstream and never arrives as an empty list).

// Read one catalog file into the bridge catalog shape
// (`{ current: { model }?, roles: { [role]: { model } }? }`), accepting both
// the codex file shape and the bare bridge shape. Throws
// OMO_MODEL_CATALOG_UNREADABLE (missing/unreadable path) or
// OMO_MODEL_CATALOG_MALFORMED (bad JSON, wrong top-level shape, or no
// usable model) — never a silent empty catalog: a failed read must not
// clear the gate to "no model". Fail-closed: the caller cannot invoke
// with a catalog it cannot read, so nothing spawns.
export const readModelCatalogFileSync = (catalogPath, { readFileSync = nodeReadFileSync } = {}) => {
  if (!isNonEmptyString(catalogPath)) {
    throw new OmoBridgeError('OMO_MODEL_CATALOG_UNREADABLE', 'A catalog file path is required to feed modelCatalog.');
  }
  let text;
  try {
    text = readFileSync(catalogPath, 'utf8');
  } catch (error) {
    throw new OmoBridgeError(
      'OMO_MODEL_CATALOG_UNREADABLE',
      `Model catalog at "${catalogPath}" could not be read: ${error?.message ?? error}.`,
      { catalogPath },
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(String(text));
  } catch (error) {
    throw new OmoBridgeError(
      'OMO_MODEL_CATALOG_MALFORMED',
      `Model catalog at "${catalogPath}" is not JSON: ${error?.message ?? error}.`,
      { catalogPath },
    );
  }
  if (!isRecord(parsed)) {
    throw new OmoBridgeError(
      'OMO_MODEL_CATALOG_MALFORMED',
      `Model catalog at "${catalogPath}" must be a JSON object.`,
      { catalogPath },
    );
  }
  const catalog = {};
  if (parsed.current !== undefined) {
    if (!isRecord(parsed.current) || !isNonEmptyString(parsed.current.model)) {
      throw new OmoBridgeError(
        'OMO_MODEL_CATALOG_MALFORMED',
        `Model catalog at "${catalogPath}" has a current without a model string.`,
        { catalogPath },
      );
    }
    catalog.current = { model: parsed.current.model.trim() };
  }
  if (parsed.roles !== undefined) {
    if (!isRecord(parsed.roles)) {
      throw new OmoBridgeError(
        'OMO_MODEL_CATALOG_MALFORMED',
        `Model catalog at "${catalogPath}" has roles that are not an object.`,
        { catalogPath },
      );
    }
    const roles = {};
    for (const [role, entry] of Object.entries(parsed.roles)) {
      if (isRecord(entry) && isNonEmptyString(entry.model)) {
        roles[role] = { model: entry.model.trim() };
      }
    }
    if (Object.keys(roles).length > 0) catalog.roles = roles;
  }
  if (catalog.current === undefined && catalog.roles === undefined) {
    throw new OmoBridgeError(
      'OMO_MODEL_CATALOG_MALFORMED',
      `Model catalog at "${catalogPath}" names no model (need current.model or a roles entry).`,
      { catalogPath },
    );
  }
  return catalog;
};

// Build the sync readiness predicate from a provider-card snapshot. The
// snapshot is `{ integrations: [{ id, connections: [{ type, status? }] }],
// optionsApiKeys?: { [providerId]: key } }` — the `GET /api/integration`
// list shape behind `IntegrationCatalog`, passed in as data (never fetched
// here). Ready mirrors the card: `connected` / `accounts` (a credential
// connection) and `environment` (an env connection the server can see, or
// an inline options key) read true; `signInNeeded` (no usable connection)
// and `reauthNeeded` (any connection whose `status.status === 'needs_auth'`,
// i.e. revoked — reauth wins, as on the card) read false. An unknown
// provider (no integration — e.g. a custom opencode.json provider keyed
// inline, which the card shows with no status rather than a false "not
// signed in") proceeds, preserving the bridge's unknown-proceeds
// contract. A null/undefined snapshot returns null (gate unwired — the
// legacy skip); a malformed snapshot throws OMO_PROVIDER_SNAPSHOT_MALFORMED
// before any invoke can run, so nothing spawns.
export const isProviderReadyFromCardSnapshot = (snapshot, { signInIntegrations = { 'opencode-go': 'opencode' } } = {}) => {
  if (snapshot === null || snapshot === undefined) return null;
  if (!isRecord(snapshot) || !Array.isArray(snapshot.integrations)) {
    throw new OmoBridgeError(
      'OMO_PROVIDER_SNAPSHOT_MALFORMED',
      'The provider snapshot must be { integrations: [...] } from GET /api/integration.',
    );
  }
  const optionsApiKeys = isRecord(snapshot.optionsApiKeys) ? snapshot.optionsApiKeys : {};
  const signIns = isRecord(signInIntegrations) ? signInIntegrations : {};
  const byId = new Map();
  for (const integration of snapshot.integrations) {
    if (isRecord(integration) && isNonEmptyString(integration.id)) {
      byId.set(integration.id.trim(), Array.isArray(integration.connections) ? integration.connections : []);
    }
  }
  const connectionsFor = (providerId) => {
    const own = byId.get(providerId);
    const signInId = isNonEmptyString(signIns[providerId]) ? signIns[providerId].trim() : providerId;
    const extra = signInId === providerId ? [] : (byId.get(signInId) ?? []);
    if (own === undefined && extra.length === 0) return undefined;
    return [...(own ?? []), ...extra];
  };
  return (provider) => {
    if (!isNonEmptyString(provider)) return false;
    const id = provider.trim();
    const connections = connectionsFor(id);
    if (connections === undefined) return true;
    if (connections.some((connection) => isRecord(connection) && isRecord(connection.status) && connection.status.status === 'needs_auth')) {
      return false;
    }
    if (connections.some((connection) => isRecord(connection) && connection.type === 'credential')) return true;
    if (isNonEmptyString(optionsApiKeys[id])) return true;
    if (connections.some((connection) => isRecord(connection) && connection.type === 'env')) return true;
    return false;
  };
};

// Vendored in-tree engine root: the sibling packages/omo-engine dir when
// its run barrel exists. Null when absent (engine predates the vendor).
export const resolveVendoredRoot = ({ existsSync = nodeExistsSync, bridgeDir } = {}) => {
  const dir = bridgeDir ?? nodeDirname(nodeFileURLToPath(import.meta.url));
  const root = nodeJoinPath(dir, '..', '..', '..', '..', OMO_VENDORED_ENGINE_DIR);
  if (!existsSync(nodeJoinPath(root, OMO_VENDORED_RUN_BARREL))) return null;
  return root;
};
// Engine checkout root for native runs: explicit env wins, else the
// wrapper entry's grandparent (bin/oh-my-opencode.js lives at
// <root>/bin/), else the vendored in-tree engine (install means use — no
// wrapper, no download, no env). Throws OMO_NATIVE_UNAVAILABLE naming
// the reason. Returns { root, vendored } so callers know the layout.
export const resolveEngineRoot = (wrapperEntry, { env = process.env, existsSync = nodeExistsSync } = {}) => {
  const explicit = env?.[OMO_ENGINE_ROOT_ENV]?.trim?.() ?? '';
  if (explicit !== '') return { root: explicit, vendored: false };
  if (isNonEmptyString(wrapperEntry)) {
    const root = nodeDirname(nodeDirname(wrapperEntry));
    if (existsSync(nodeJoinPath(root, OMO_ENGINE_RUN_BARREL))) return { root, vendored: false };
  }
  const vendored = resolveVendoredRoot({ existsSync });
  if (vendored !== null) return { root: vendored, vendored: true };
  throw new OmoBridgeError('OMO_NATIVE_UNAVAILABLE', `Native runs need ${OMO_ENGINE_ROOT_ENV}, a wrapper entry with a run barrel, or the vendored in-tree engine.`);
};

// Default worker entry: the sibling file of this module. Plain-Node
// consumers never import it (they spawn it); bun executes it.
export const defaultWorkerEntry = () => nodeFileURLToPath(new URL('./omo-invoker-worker.ts', import.meta.url));

// Resolve one native-runner config or throw OMO_NATIVE_UNAVAILABLE.
// Never returns a half-configured runner: bun path, worker file, and
// engine barrel must all resolve first.
export const resolveNativeRunner = ({
  wrapperEntry,
  env = process.env,
  existsSync = nodeExistsSync,
  workerEntry,
  bunPath,
} = {}) => {
  const worker = workerEntry ?? defaultWorkerEntry();
  if (!existsSync(worker)) {
    throw new OmoBridgeError('OMO_NATIVE_UNAVAILABLE', `Native worker missing at "${worker}".`);
  }
  const bun = bunPath ?? env?.[OMO_BUN_PATH_ENV]?.trim?.() ?? '';
  const resolvedBun = bun !== '' ? bun : 'bun';
  const { root: engineRoot, vendored } = resolveEngineRoot(wrapperEntry, { env, existsSync });
  return {
    workerEntry: worker,
    bunPath: resolvedBun,
    engineRoot,
    barrelPath: vendored ? nodeJoinPath(engineRoot, OMO_VENDORED_RUN_BARREL) : undefined,
  };
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
    // with `modelRole` selecting the role. Production backs modelCatalog
    // with readModelCatalogFileSync over the engine codex catalog file
    // (packages/omo-engine/omo-codex/plugin/model-catalog.json) and
    // isProviderReady with isProviderReadyFromCardSnapshot over the
    // GET /api/integration provider-card snapshot; the bridge itself
    // never phones OpenCode here, so invoke stays synchronous.
    modelProviders = {},
    alcoreModels = OMO_BRIDGE_DEFAULT_ALCORE_MODELS,
    isProviderReady = null,
    modelCatalog = null,
    modelRole = OMO_BRIDGE_DEFAULT_MODEL_ROLE,
    // Native-runner seam (Phase 4+): explicit `{ workerEntry, bunPath,
    // engineRoot }` wins; when null and `nativeFromEnv` holds, an
    // `OMO_NATIVE_RUN=1` env opts in via resolveNativeRunner (throws
    // OMO_NATIVE_UNAVAILABLE instead of silently downgrading).
    nativeRunner = null,
    nativeFromEnv = true,
    env = process.env,
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
    let runner = nativeRunner ?? null;
    if (runner === null && nativeFromEnv && env?.[OMO_NATIVE_RUN_ENV] === '1') {
      runner = resolveNativeRunner({ wrapperEntry: entry, env, existsSync });
    }
    if (runner !== null) {
      return invokeNative({
        runner, entry, argv, message, port, attachUrl, sessionId,
        agent: isNonEmptyString(agent) ? agent.trim() : undefined,
        model: argvModel,
        onEvent, explicitSnapshotPath,
      });
    }
    let child;
    try {
      child = spawn(entry, argv, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      throw new OmoBridgeError('OMO_SPAWN_FAILED', `OmO engine at "${entry}" could not be started: ${error.message ?? error}.`, { entry });
    }
    return launchHandle({
      child, entry, argv, sessionId, onEvent, explicitSnapshotPath, native: false,
    });
  };

  // Shared launch tail: snapshot writer + stdout pump + wait + cancel.
  // Both spawn paths (wrapper CLI, native bun worker) funnel through here
  // so the handle shape and event semantics stay identical.
  const launchHandle = ({
    child, entry, argv, sessionId, onEvent, explicitSnapshotPath, native,
  }) => {
    const writer = sessionId !== undefined && fs
      ? createSnapshotWriter({
        sessionId,
        snapshotPath: explicitSnapshotPath ?? (snapshotDir ? defaultSnapshotPath(snapshotDir, sessionId) : null),
        fs,
        now,
      })
      : null;
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
      native,
    };
  };

  // Native path: spawn the bun worker (engine run() isolated in its own
  // process), hand it the job on stdin, and funnel stdio through the
  // shared launch tail. Same handle shape as the wrapper path.
  const invokeNative = ({
    runner, entry, argv, message, port, attachUrl, sessionId, agent, model, onEvent, explicitSnapshotPath,
  }) => {
    const workerArgv = [runner.workerEntry, '--engine-root', runner.engineRoot];
    if (runner.barrelPath !== undefined) workerArgv.push('--barrel-path', runner.barrelPath);
    let child;
    try {
      child = spawn(runner.bunPath, workerArgv, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      throw new OmoBridgeError('OMO_NATIVE_UNAVAILABLE', `Native bun worker could not start via "${runner.bunPath}": ${error.message ?? error}. Install bun or set ${OMO_BUN_PATH_ENV}.`, { entry });
    }
    const job = { message };
    if (agent !== undefined) job.agent = agent;
    if (model !== undefined) job.model = model;
    if (port !== undefined) job.port = port;
    if (attachUrl !== undefined) job.attach = attachUrl;
    if (sessionId !== undefined) job.sessionId = sessionId;
    try {
      child.stdin?.write(`${JSON.stringify(job)}\n`);
      child.stdin?.end();
    } catch (error) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already dead; the error below still reports the cause.
      }
      throw new OmoBridgeError('OMO_NATIVE_UNAVAILABLE', `Native bun worker rejected the job: ${error.message ?? error}.`, { entry });
    }
    return launchHandle({
      child, entry, argv, sessionId, onEvent, explicitSnapshotPath, native: true,
    });
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
