// OmO adapter-A runtime bridge (project-ide todo 6).
//
// Spawns the run worker (`bun omo-invoker-worker.ts`, same directory as
// this module) with one stdin job per run and funnels the run-graph events
// it relays into a local JSON snapshot the DAG pane (todo 13) renders.
// Nothing here bundles, fetches, or auto-installs engine code: when no
// wrapper entry AND no native/vendored engine resolve, the single run path
// answers the documented degraded message and never hangs.
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
//   run path (one, converged): every invoke spawns `bun
//             omo-invoker-worker.ts` (same directory as this module;
//             bun-only, never imported by plain-Node consumers) with one
//             stdin job and reads the wrapper line protocol back
//             (`omo.dag.updated` + `omo.task.updated` event lines, one
//             `--json` result line). The worker serves both job kinds: a
//             wrapper-kind job makes the worker spawn `<entry>` with the
//             wrapper argv and relay its stdio byte-verbatim; a native-kind
//             job makes the worker import the engine run barrel in-process,
//             containing run()'s stdio/env/telemetry globals there. Same
//             handle shape (wait/cancel/writer) for both kinds.
//   kind gate -> `checkNativeParity` is PINNED as the job-kind selector
//             (omo-full-integration T9 default kept, never retired):
//             bun/worker/engine/wrapper resolvability still varies by
//             machine, so per-call `native`, `OMO_NATIVE_RUN`, and the
//             parity-gated default still select the kind — `false`/`0` the
//             wrapper kind (ship-gate IS-4: the wrapper fallback stays, the
//             rollback stays live), `true`/`1` the native kind or the exact
//             `OMO_NATIVE_UNAVAILABLE` throw, a failing default gate the
//             exact degraded message, never a silent downgrade. Cost of the
//             single spawn: both kinds need the bun runtime, so a bun-less
//             machine answers the exact degraded message with zero spawns.
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
import { probeToolkit, OMO_TOOLKIT_PROBE_TIMEOUT_MS } from './omo-toolkit-probe.js';

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
//
// The dag-pane service bundle inlines this module, so the bridge-relative
// base below points at `.../built-in-extensions/dag-pane/service/` there
// instead of `.../server/lib/opencode/` and always misses. The first
// candidate keeps the source layout (and every fixture override); the
// later ones cover the bundled service without baked absolutes: the
// packaged Electron resources dir (`resources/omo-engine`, same marker as
// the skill-catalog row-7 fix) and an upward search from the service's own
// package root (the host spawns services with cwd = package dir, so this
// is `packages/omo-engine` in dev and `resources/omo-engine` packaged).
// First candidate whose run barrel exists wins; all probes go through the
// injected existsSync, so hermetic no-engine fixtures keep failing closed.
export const OMO_VENDORED_SEARCH_DEPTH = 8;
export const resolveVendoredRootCandidates = ({ bridgeDir, packageCwd, resourcesPath } = {}) => {
  const candidates = [];
  const dir = bridgeDir ?? nodeDirname(nodeFileURLToPath(import.meta.url));
  candidates.push(nodeJoinPath(dir, '..', '..', '..', '..', OMO_VENDORED_ENGINE_DIR));
  const packaged = resourcesPath ?? process?.resourcesPath ?? null;
  if (packaged) candidates.push(nodeJoinPath(packaged, OMO_VENDORED_ENGINE_DIR));
  let level = packageCwd ?? process.cwd();
  for (let depth = 0; depth <= OMO_VENDORED_SEARCH_DEPTH; depth += 1) {
    candidates.push(nodeJoinPath(level, OMO_VENDORED_ENGINE_DIR));
    const parent = nodeDirname(level);
    if (parent === level) break;
    level = parent;
  }
  return candidates;
};
export const resolveVendoredRoot = ({
  existsSync = nodeExistsSync, bridgeDir, packageCwd, resourcesPath,
} = {}) => {
  for (const root of resolveVendoredRootCandidates({ bridgeDir, packageCwd, resourcesPath })) {
    if (existsSync(nodeJoinPath(root, OMO_VENDORED_RUN_BARREL))) return root;
  }
  return null;
};
// Engine checkout root for native runs: explicit env wins, else the
// wrapper entry's grandparent (bin/oh-my-opencode.js lives at
// <root>/bin/), else the vendored in-tree engine (install means use — no
// wrapper, no download, no env). Throws OMO_NATIVE_UNAVAILABLE naming
// the reason. Returns { root, vendored } so callers know the layout.
export const resolveEngineRoot = (wrapperEntry, {
  env = process.env, existsSync = nodeExistsSync, bridgeDir, packageCwd, resourcesPath,
} = {}) => {
  const explicit = env?.[OMO_ENGINE_ROOT_ENV]?.trim?.() ?? '';
  if (explicit !== '') return { root: explicit, vendored: false };
  if (isNonEmptyString(wrapperEntry)) {
    const root = nodeDirname(nodeDirname(wrapperEntry));
    if (existsSync(nodeJoinPath(root, OMO_ENGINE_RUN_BARREL))) return { root, vendored: false };
  }
  const vendored = resolveVendoredRoot({
    existsSync, bridgeDir, packageCwd, resourcesPath,
  });
  if (vendored !== null) return { root: vendored, vendored: true };
  throw new OmoBridgeError('OMO_NATIVE_UNAVAILABLE', `Native runs need ${OMO_ENGINE_ROOT_ENV}, a wrapper entry with a run barrel, or the vendored in-tree engine.`);
};

// Default worker entry: the sibling file of this module. Plain-Node
// consumers never import it (they spawn it); bun executes it.
export const defaultWorkerEntry = () => nodeFileURLToPath(new URL('./omo-invoker-worker.ts', import.meta.url));

// Worker file for native runs. An explicit entry is honored exactly (and
// reported exactly when missing); otherwise the module sibling wins (the
// source layout), then the service-relative copy (`../../lib/opencode/`
// from the spawned package root — the same relative shape in dev and in
// the unpacked packaged tree), then the unpacked packaged copy under the
// Electron resources dir. First existing file wins; when none exists the
// reported path stays the module sibling so the degraded message is
// unchanged. In the packaged Electron service `process.resourcesPath` is
// unset (plain-Node spawn), so the service-relative candidate is the one
// that answers there — it needs the asarUnpack entry for this file.
export const resolveWorkerEntry = ({
  workerEntry,
  existsSync = nodeExistsSync,
  packageCwd,
  resourcesPath,
} = {}) => {
  if (workerEntry) return { path: workerEntry, found: existsSync(workerEntry) };
  const candidates = [defaultWorkerEntry()];
  const cwd = packageCwd ?? process.cwd();
  candidates.push(nodeJoinPath(cwd, '..', '..', 'lib', 'opencode', 'omo-invoker-worker.ts'));
  const packaged = resourcesPath ?? process?.resourcesPath ?? null;
  if (packaged) {
    candidates.push(nodeJoinPath(
      packaged, 'app.asar.unpacked', 'node_modules', '@alcode', 'web',
      'server', 'lib', 'opencode', 'omo-invoker-worker.ts',
    ));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { path: candidate, found: true };
  }
  return { path: candidates[0], found: false };
};

// Resolve one native-runner config or throw OMO_NATIVE_UNAVAILABLE.
// Never returns a half-configured runner: bun path, worker file, and
// engine barrel must all resolve first.
export const resolveNativeRunner = ({
  wrapperEntry,
  env = process.env,
  existsSync = nodeExistsSync,
  workerEntry,
  bunPath,
  bridgeDir,
  packageCwd,
  resourcesPath,
} = {}) => {
  const worker = resolveWorkerEntry({
    workerEntry, existsSync, packageCwd, resourcesPath,
  });
  if (!worker.found) {
    throw new OmoBridgeError('OMO_NATIVE_UNAVAILABLE', `Native worker missing at "${worker.path}".`);
  }
  const bun = bunPath ?? env?.[OMO_BUN_PATH_ENV]?.trim?.() ?? '';
  const resolvedBun = bun !== '' ? bun : 'bun';
  const { root: engineRoot, vendored } = resolveEngineRoot(wrapperEntry, {
    env, existsSync, bridgeDir, packageCwd, resourcesPath,
  });
  return {
    workerEntry: worker.path,
    bunPath: resolvedBun,
    engineRoot,
    barrelPath: vendored ? nodeJoinPath(engineRoot, OMO_VENDORED_RUN_BARREL) : undefined,
  };
};

// Shared degraded text for an unresolvable bun runtime. Byte-identical to
// the parity gate's answers by construction: both call sites use this, so
// the "exact degraded message" contract cannot drift between the gate and
// the pre-spawn check.
export const bunUnavailableMessage = (bun) => (bun.source === 'env'
  ? `Native runner unavailable: ${OMO_BUN_PATH_ENV} points at "${bun.path}" which does not resolve. The wrapper path is kept; fix ${OMO_BUN_PATH_ENV} or install bun on PATH to run natively.`
  : `Native runner unavailable: bun was not found on PATH and ${OMO_BUN_PATH_ENV} is unset. The wrapper path is kept; install bun or set ${OMO_BUN_PATH_ENV} to run natively.`);

// Resolve the worker-spawn half of a run: bun path plus worker file. The
// engine barrel is NOT resolved here — wrapper-kind jobs carry their own
// wrapper entry and never touch the engine tree, so a wrapper-only machine
// (no engine checkout) still resolves. Throws OMO_NATIVE_UNAVAILABLE with
// the exact gate message before any spawn.
export const resolveWorkerRunner = ({
  env = process.env,
  existsSync = nodeExistsSync,
  workerEntry,
  packageCwd,
  resourcesPath,
} = {}) => {
  const worker = resolveWorkerEntry({
    workerEntry, existsSync, packageCwd, resourcesPath,
  });
  if (!worker.found) {
    throw new OmoBridgeError('OMO_NATIVE_UNAVAILABLE', `Native runner unavailable: native worker missing at "${worker.path}". The wrapper path is kept.`);
  }
  const bun = resolveBunCommand({ env, existsSync });
  if (!bun.found) {
    throw new OmoBridgeError('OMO_NATIVE_UNAVAILABLE', bunUnavailableMessage(bun));
  }
  return { workerEntry: worker.path, bunPath: bun.path };
};

// Native parity gate (omo-full-integration T1, GAP-1 data half).
//
// `checkNativeParity` answers whether this machine can take the native path
// RIGHT NOW as DATA — it never spawns, never throws for a missing setup,
// and never flips the default. A failing gate reports `path: 'wrapper'`
// with the exact `OMO_NATIVE_UNAVAILABLE` degraded message, and the T9
// default keeps its never-downgrade contract by throwing that message
// instead of silently taking the wrapper (pinned by the native-invoker
// test; the five messages below are byte-exact and asserted with `toBe`).
// Checks run in a fixed order — bun, worker, engine root, barrel — and
// every check is evaluated, so the result names the first failure while
// `details` carries each check's machine outcome. Presence is resolvability
// only: the gate does not execute bun and performs no version check.
export const OMO_NATIVE_OK = 'OMO_NATIVE_OK';

// Resolve the bun command for native runs: an explicit non-blank
// `OMO_BUN_PATH` wins (verified resolvable, never trusted blind), else the
// first `bun` found by scanning PATH with the platform's executable
// extensions. Always `{ source: 'env' | 'path', path, found }` — never
// throws, so a scrubbed PATH degrades to `found: false`, not a crash.
export const resolveBunCommand = ({
  env = process.env,
  existsSync = nodeExistsSync,
  pathValue,
  executableExtensions,
  platform = process.platform,
  joinPath = nodeJoinPath,
} = {}) => {
  const override = env?.[OMO_BUN_PATH_ENV]?.trim?.() ?? '';
  if (override !== '') {
    return { source: 'env', path: override, found: existsSync(override) };
  }
  const rawPath = pathValue !== undefined ? pathValue : (env?.PATH ?? env?.Path ?? '');
  const delimiter = platform === 'win32' ? ';' : ':';
  const extensions = executableExtensions ?? (platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']);
  for (const dir of String(rawPath ?? '').split(delimiter)) {
    const trimmed = dir.trim().replace(/^"|"$/g, '');
    if (trimmed === '') continue;
    for (const ext of extensions) {
      const candidate = joinPath(trimmed, `bun${ext}`);
      if (existsSync(candidate)) {
        return { source: 'path', path: candidate, found: true };
      }
    }
  }
  return { source: 'path', path: 'bun', found: false };
};

// Structured parity result. Pass reads
// `{ ok: true, code: 'OMO_NATIVE_OK', path: 'native', message: null,
// details }`; any failure reads `{ ok: false,
// code: 'OMO_NATIVE_UNAVAILABLE', path: 'wrapper', message, details }`
// where `message` is the exact degraded text and `details` names every
// check (`bunFound`/`workerFound`/`engineFound`/`barrelFound` plus the
// resolved paths, `vendored` naming the engine layout). `wrapperEntry`
// feeds the derived-root layout; `bridgeDir` overrides the vendored
// lookup base (fixtures); `packageCwd` overrides the service-root base for
// the vendored search and the service-relative worker (fixtures, engine-less
// simulations); `resourcesPath` overrides the packaged resources base
// (default `process.resourcesPath`); `pathValue`/`platform` override PATH
// scanning.
export const checkNativeParity = ({
  wrapperEntry,
  env = process.env,
  existsSync = nodeExistsSync,
  workerEntry,
  bridgeDir,
  packageCwd,
  resourcesPath,
  pathValue,
  platform,
  joinPath = nodeJoinPath,
} = {}) => {
  const bun = resolveBunCommand({ env, existsSync, pathValue, platform, joinPath });
  const worker = resolveWorkerEntry({
    workerEntry, existsSync, packageCwd, resourcesPath,
  });
  const workerFound = worker.found;
  let engineRoot = null;
  let vendored = false;
  let engineFound = false;
  let engineReason = null;
  try {
    const resolved = resolveEngineRoot(wrapperEntry, {
      env, existsSync, bridgeDir, packageCwd, resourcesPath,
    });
    engineRoot = resolved.root;
    vendored = resolved.vendored;
    engineFound = true;
  } catch (error) {
    engineReason = error?.message ?? String(error);
  }
  const barrelPath = engineFound
    ? joinPath(engineRoot, vendored ? OMO_VENDORED_RUN_BARREL : OMO_ENGINE_RUN_BARREL)
    : null;
  // An explicit OMO_ENGINE_ROOT is trusted by resolveEngineRoot without an
  // existence check, so the barrel probe is what fails a nonexistent root
  // closed: no crash, just found: false.
  const barrelFound = barrelPath !== null && existsSync(barrelPath);
  const details = {
    bunPath: bun.path,
    bunSource: bun.source,
    bunFound: bun.found,
    workerEntry: worker.path,
    workerFound,
    engineRoot,
    vendored,
    engineFound,
    barrelPath,
    barrelFound,
  };
  if (!bun.found) {
    return {
      ok: false, code: 'OMO_NATIVE_UNAVAILABLE', path: 'wrapper', message: bunUnavailableMessage(bun), details,
    };
  }
  if (!workerFound) {
    return {
      ok: false,
      code: 'OMO_NATIVE_UNAVAILABLE',
      path: 'wrapper',
      message: `Native runner unavailable: native worker missing at "${worker.path}". The wrapper path is kept.`,
      details,
    };
  }
  if (!engineFound) {
    return {
      ok: false,
      code: 'OMO_NATIVE_UNAVAILABLE',
      path: 'wrapper',
      message: `${engineReason} The wrapper path is kept.`,
      details,
    };
  }
  if (!barrelFound) {
    return {
      ok: false,
      code: 'OMO_NATIVE_UNAVAILABLE',
      path: 'wrapper',
      message: `Native runner unavailable: engine run barrel missing at "${barrelPath}". The wrapper path is kept.`,
      details,
    };
  }
  return { ok: true, code: OMO_NATIVE_OK, path: 'native', message: null, details };
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
    // Worker-runner seam: explicit `{ workerEntry, bunPath,
    // engineRoot }` wins; otherwise the job kind is per-call `native`,
    // then env/default. `native: false` (or `OMO_NATIVE_RUN=0`) selects
    // the wrapper-kind job (the worker spawns the wrapper entry and
    // relays it); `native: true` (or `OMO_NATIVE_RUN=1`) selects the
    // native-kind job via resolveNativeRunner (throws
    // OMO_NATIVE_UNAVAILABLE instead of silently downgrading).
    // Unset/blank reads the parity gate: native kind on a capable
    // machine, the exact degraded message on a failing gate.
    // Unrecognized non-blank values fail closed. `nativeFromEnv: false`
    // keeps the legacy wrapper-kind default (per-call `native` still
    // applies). Every kind spawns through the one worker path below.
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
  // degraded object, never a hang. A missing entry resolves the
  // native/vendored engine first (install means use — no wrapper, no
  // download, no env): only when both fail does probe degrade.
  const probe = async ({ timeoutMs = probeTimeoutMs, includeToolkit = false, ...gateOverrides } = {}) => {
    // Bounded outer-toolkit probe (spawn-site NO-SITE wiring point): runs
    // only when loop-status callers opt in, never on the hot wrapper path.
    // Short timeout, short candidate list, fails closed, never walks a drive.
    const toolkit = includeToolkit
      ? probeToolkit({
        timeoutMs: Math.min(timeoutMs, OMO_TOOLKIT_PROBE_TIMEOUT_MS),
        existsSync,
        spawnSync,
        env,
      })
      : null;
    const entry = resolveEntry();
    if (!entry || !existsSync(entry)) {
      const gate = checkGate(gateOverrides);
      if (gate.ok) {
        const okResult = {
          available: true,
          compatible: true,
          code: 'OMO_PROBE_OK',
          entry,
          native: true,
          message: null,
        };
        if (includeToolkit) okResult.toolkit = toolkit;
        return okResult;
      }
      const absentResult = {
        available: false,
        compatible: false,
        code: 'OMO_ENGINE_ABSENT',
        entry,
        message: engineAbsentMessage(entry),
      };
      if (includeToolkit) absentResult.toolkit = toolkit;
      return absentResult;
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
      const spawnFailedResult = {
        available: false,
        compatible: false,
        code: 'OMO_SPAWN_FAILED',
        entry,
        message: `OmO engine at "${entry}" could not be started: ${version.spawnError.message ?? version.spawnError}.`,
      };
      if (includeToolkit) spawnFailedResult.toolkit = toolkit;
      return spawnFailedResult;
    }
    if (version.timedOut) {
      const timeoutResult = {
        available: false,
        compatible: false,
        code: 'OMO_PROBE_TIMEOUT',
        entry,
        message: `OmO engine at "${entry}" did not answer --version within ${timeoutMs}ms.`,
      };
      if (includeToolkit) timeoutResult.toolkit = toolkit;
      return timeoutResult;
    }
    const help = runBounded(['run', '--help']);
    if (help.spawnError || help.timedOut) {
      const helpFailedResult = {
        available: false,
        compatible: false,
        code: help.timedOut ? 'OMO_PROBE_TIMEOUT' : 'OMO_SPAWN_FAILED',
        entry,
        version: firstVersionToken(version.stdout),
        message: `OmO engine at "${entry}" answered --version but not run --help within ${timeoutMs}ms.`,
      };
      if (includeToolkit) helpFailedResult.toolkit = toolkit;
      return helpFailedResult;
    }
    const runFlags = OMO_BRIDGE_REQUIRED_RUN_FLAGS.filter((flag) => help.stdout.includes(flag));
    const missingRunFlags = OMO_BRIDGE_REQUIRED_RUN_FLAGS.filter((flag) => !help.stdout.includes(flag));
    const finalResult = {
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
    if (includeToolkit) finalResult.toolkit = toolkit;
    return finalResult;
  };

  // Run `run <message> --port/--attach/--session-id/--model/--json`
  // through the one worker path. A missing entry resolves the
  // native/vendored engine BEFORE any OMO_ENGINE_ABSENT throw, so
  // zero-config runs take the native kind; the absent error throws only
  // when both the entry and native resolution fail, and never after a
  // spawn. Slice E gate: when the effective model maps to a known
  // provider and a readiness predicate is wired, an unsigned provider
  // throws OMO_PROVIDER_NOT_SIGNED_IN naming model + provider BEFORE any
  // spawn — nothing is spent. Alcore-bound runs pin `--model
  // alcore/<id>` so the spend cannot land on the engine catalog default.
  // Kind selection (T9 native default, breaking; gate PINNED, not
  // retired): per-call `native` wins (`true` forces the native kind or
  // throws, `false` forces the wrapper kind); otherwise `OMO_NATIVE_RUN=0`
  // selects the wrapper kind and `OMO_NATIVE_RUN=1` forces the native
  // kind or throws; unset/blank runs the parity gate — native kind on a
  // capable machine, the exact OMO_NATIVE_UNAVAILABLE message on a
  // failing gate, never a silent downgrade. Any other non-blank value
  // fails closed before any spawn.
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
    // Kind selection: true forces the native kind or throws, false forces
    // the wrapper kind, undefined defers to env/default (see the seam
    // note above).
    native,
  } = {}) => {
    const entry = resolveEntry();
    // No usable wrapper entry yet: native/vendored resolution below may
    // still take the run (zero-config). The absent error throws only when
    // the wrapper path is actually selected, or when native fails too.
    const entryMissing = !entry || !existsSync(entry);
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
    // One run path: the kind below selects the WORKER JOB, never the spawn
    // mechanism. Both kinds spawn `bun <worker>` with one stdin job; the
    // worker executes the wrapper entry (wrapper kind) or the engine run
    // barrel (native kind) and the shared launch tail reads both back
    // through the same line protocol.
    let kind;
    if (native === false) {
      kind = 'wrapper'; // Per-call opt-out wins over everything.
    } else if (native === true) {
      kind = 'native';
    } else if (nativeRunner !== null) {
      kind = 'native'; // Explicit runner wins: native kind.
    } else if (nativeFromEnv) {
      const flag = env?.[OMO_NATIVE_RUN_ENV]?.trim?.() ?? '';
      if (flag === '0') {
        kind = 'wrapper'; // Env rollback: wrapper kind, kept live.
      } else if (flag === '1') {
        kind = 'native';
      } else if (flag !== '') {
        throw new OmoBridgeError(
          'OMO_NATIVE_UNAVAILABLE',
          `Native runner unavailable: ${OMO_NATIVE_RUN_ENV} has an unrecognized value ${JSON.stringify(flag)} `
          + '(want "0" for the wrapper path, "1" for native, or unset for the parity-gated default). Nothing was started.',
          { entry },
        );
      } else {
        const gate = checkGate();
        if (!gate.ok) {
          if (entryMissing) {
            throw new OmoBridgeError('OMO_ENGINE_ABSENT', engineAbsentMessage(entry), { entry });
          }
          throw new OmoBridgeError('OMO_NATIVE_UNAVAILABLE', gate.message, { entry });
        }
        kind = 'native';
      }
    } else {
      kind = 'wrapper'; // Legacy default without env steering.
    }
    if (kind === 'wrapper' && entryMissing) {
      throw new OmoBridgeError('OMO_ENGINE_ABSENT', engineAbsentMessage(entry), { entry });
    }
    return invokeViaWorker({
      kind,
      runner: resolveKindRunner({ kind, entry }),
      entry,
      argv,
      message,
      port,
      attachUrl,
      sessionId,
      agent: isNonEmptyString(agent) ? agent.trim() : undefined,
      model: argvModel,
      onEvent,
      explicitSnapshotPath,
    });
  };

  // Resolve the spawn config for one job kind, or throw the exact
  // degraded message before any spawn. The native kind needs the full
  // runner (bun, worker, engine root, barrel); the wrapper kind needs bun
  // plus the worker only — the wrapper entry travels inside the job, so
  // no engine checkout is required. An explicit `nativeRunner` is trusted
  // as given for either kind (its bun/worker carry both).
  const resolveKindRunner = ({ kind, entry }) => {
    if (nativeRunner !== null) {
      return {
        workerEntry: nativeRunner.workerEntry,
        bunPath: nativeRunner.bunPath,
        engineRoot: nativeRunner.engineRoot,
        barrelPath: nativeRunner.barrelPath,
      };
    }
    if (kind === 'wrapper') {
      return resolveWorkerRunner({ env, existsSync });
    }
    const full = resolveNativeRunner({ wrapperEntry: entry, env, existsSync });
    // resolveNativeRunner trusts the bun default blindly; fail closed here
    // with the exact gate message when no bun runtime resolves.
    const bun = resolveBunCommand({ env, existsSync });
    if (!bun.found) {
      throw new OmoBridgeError('OMO_NATIVE_UNAVAILABLE', bunUnavailableMessage(bun), { entry });
    }
    return {
      workerEntry: full.workerEntry,
      bunPath: full.bunPath,
      engineRoot: full.engineRoot,
      barrelPath: full.barrelPath,
    };
  };

  // Shared launch tail: snapshot writer + stdout pump + wait + cancel.
  // The single worker spawn funnels through here for both job kinds, so
  // the handle shape and event semantics stay identical.
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

  // The one run path: spawn the bun worker (engine work isolated in its
  // own process), hand it one stdin job, and funnel stdio through the
  // shared launch tail. A wrapper-kind job carries the wrapper entry plus
  // argv for the worker to spawn and relay; a native-kind job carries the
  // engine root so the worker imports the run barrel in-process. Cancel
  // kills the worker, which forwards the signal to the wrapper child it
  // owns, so no engine process outlives the handle on either kind.
  const invokeViaWorker = ({
    kind, runner, entry, argv, message, port, attachUrl, sessionId, agent, model, onEvent, explicitSnapshotPath,
  }) => {
    const workerArgv = [runner.workerEntry];
    if (kind === 'native') {
      workerArgv.push('--engine-root', runner.engineRoot);
      if (runner.barrelPath !== undefined) workerArgv.push('--barrel-path', runner.barrelPath);
    }
    let child;
    try {
      child = spawn(runner.bunPath, workerArgv, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      throw new OmoBridgeError('OMO_NATIVE_UNAVAILABLE', `Omo run worker could not start via "${runner.bunPath}": ${error.message ?? error}. Install bun or set ${OMO_BUN_PATH_ENV}.`, { entry });
    }
    const job = { kind, message };
    if (agent !== undefined) job.agent = agent;
    if (model !== undefined) job.model = model;
    if (port !== undefined) job.port = port;
    if (attachUrl !== undefined) job.attach = attachUrl;
    if (sessionId !== undefined) job.sessionId = sessionId;
    if (kind === 'wrapper') {
      job.wrapperEntry = entry;
      job.wrapperArgv = argv;
    }
    try {
      child.stdin?.write(`${JSON.stringify(job)}\n`);
      child.stdin?.end();
    } catch (error) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already dead; the error below still reports the cause.
      }
      throw new OmoBridgeError('OMO_NATIVE_UNAVAILABLE', `Omo run worker rejected the job: ${error.message ?? error}.`, { entry });
    }
    return launchHandle({
      child, entry, argv, sessionId, onEvent, explicitSnapshotPath, native: kind === 'native',
    });
  };

  // Parity gate bound to this runtime's deps (wrapper entry, env,
  // existsSync). Data only — calling it never spawns; per-call overrides
  // win for fixtures. PINNED, not retired: `invoke` consults it on the
  // default path (no per-call `native`, no recognized `OMO_NATIVE_RUN`
  // value) to select the job kind — native on a capable machine, the
  // exact degraded message on a failing gate, never a silent downgrade.
  const checkGate = (overrides = {}) => checkNativeParity({
    wrapperEntry: resolveEntry(),
    env,
    existsSync,
    ...overrides,
  });

  return {
    probe,
    invoke,
    checkNativeParity: checkGate,
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
// the worker child it owns directly: SIGTERM with the caller's reason
// recorded, SIGKILL after a bounded grace, and a receipt describing what
// happened. The worker forwards the signal to the wrapper child it owns;
// on Windows signals never reach traps (TerminateProcess), so the worker
// tree is felled best-effort (taskkill /T /F, like lifecycle.js) and no
// wrapper grandchild orphans. Revisit when the engine confirms
// process-kill semantics.
export const cancelRun = (handle, reason, dependencies = {}) => {
  const {
    timers = createDefaultTimers(),
    cancelGraceMs = OMO_BRIDGE_CANCEL_GRACE_MS,
    spawnSync = nodeSpawnSync,
    platform = process.platform,
  } = dependencies;
  const child = handle?.child;
  if (!child || !child.kill) {
    throw new OmoBridgeError('OMO_CANCEL_NO_CHILD', 'Nothing to cancel: the run handle carries no live child.');
  }
  // A signal-terminated child keeps exitCode null with signalCode set, so
  // both mark a dead child; otherwise a second cancel would wait forever.
  const isDead = () => (child.exitCode !== null && child.exitCode !== undefined)
    || (child.signalCode !== null && child.signalCode !== undefined);
  const cause = isNonEmptyString(reason) ? reason : 'cancel requested';
  // Windows delivers SIGTERM as TerminateProcess: worker traps never run,
  // so the signal-forwarding worker cannot reap its wrapper child there.
  // Fell the whole worker tree best-effort; the SIGTERM close below still
  // settles the receipt, and a dead pid answers an ignored error here.
  const killWorkerTree = () => {
    if (platform !== 'win32' || !Number.isInteger(child.pid)) return;
    try {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 5000,
      });
    } catch {
      // Best-effort only: already dead, or taskkill itself missing.
    }
  };
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
      killWorkerTree();
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
