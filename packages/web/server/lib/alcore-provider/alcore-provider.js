// Alcore model provider sync (project-ide tasks 42, 48).
//
// What this owns: the `alcore` OpenCode provider entry that appears in
// Settings > Providers after an Alcore login, plus the OpenCode
// credential that flips its card from "Not signed in" to "Connected".
// On login it reads the CALLER's own keychained pair (see
// `packages/web/server/lib/user-tokens/user-token-store.js`), fetches the
// live model catalog from the platform with that Bearer, writes the
// provider block into the OpenCode user config through the same
// `upsertProviderConfig` registry the Settings form uses — no parallel
// provider system — then mints ONE personal API key for the caller's own
// link (`POST /admin/ide/personal-key`, see `./personal-key.js`) and stores
// that key as the integration credential
// (`POST /api/integration/alcore/connect/key`, the exact path
// the Settings custom-provider form uses after its config write). The
// credential is a real customer API key, never the rotating login token:
// login-token rotation/expiry cannot touch it, and a restart keeps it
// working (the secret lives in the OpenCode credential store, the row
// reference in `alcore-personal-keys.json`). When the mint fails the block
// is still written but no credential is stored, so the card reads
// "Not signed in" while the proven login stands. On global sign-out it
// revokes the minted key id, removes the OpenCode credential(s), the config
// entry, clears the pair, and drops the ambient credential, so nothing is
// orphaned.
//
// Badge contract (OpenCode-chat state, read — never guessed):
// `packages/ui/src/components/sections/providers/providerAuth.ts`
// `getProviderCardStatus` returns `signInNeeded` ("Not signed in") when
// the `alcore` integration exists with zero credential/env connections,
// and `connected` once exactly one `type: 'credential'` connection exists
// (or an inline `options.apiKey`). The integration list (`GET
// /api/integration`) and the credential store (`GET /api/credential`,
// owned by OpenCode since 2.0.20) are the only authority — there is no
// `auth.json` anymore. A custom provider registers its key method only
// once its block is in config, so the key follows the config write with
// the same not-found retry the Settings form uses.
//
// Base URL contract: derived from the TokenPanel base of record
// (`TOKENPANEL_DEFAULT_BASE`, honoring `TOKENPANEL_API_URL` exactly like
// the quota proxy) plus `/v1`. No second hardcoded Alcore URL lives here:
// the platform's OpenAI-compatible surface (`GET {base}/v1/models`,
// chat at `{base}/...`) is addressed through that one derived base.
// Model discovery reuses `discoverProviderModels` (OpenAI `{data:[...]}`
// shape, bounded body, no redirects), so catalog parsing never drifts
// from the Settings discovery flow.
//
// Caller auth: the catalog fetch presents the caller's own access Bearer
// (`Authorization: Bearer`, never a service/management key, never in a
// URL). A 401 refreshes ONCE through the store's auth-service rotation
// and retries; anything still failing skips the registration and leaves
// the login standing — a catalog outage must never break a proven login
// nor masquerade as an empty model list. The config block itself carries
// NO secret: inference auth travels via the stored OpenCode integration
// credential (the MINTED personal key, provisioned below). The block
// still names `env: [ALCORE_USER_TOKEN]` as a user-settable fallback
// (Settings variables reach the managed process at spawn), but the
// server never writes that variable itself — a post-login write would
// never reach the running managed process, while every future child
// would inherit the live key (task 52, Slice B). Sign-out and mint
// failure still drop the variable so no stale value can linger.
// Nothing here logs tokens, subs, or responses.
//
// Enterprise boundary (provider-entry class): registration is refused
// while enterprise mode is on — providers come from the administrator's
// OpenCode config there. Removal always runs: it only narrows access.
// Surfaces (ui-api-decoupling): web and Electron desktop share these
// server paths (desktop-login sync, reset cleanup); VS Code runs no such
// server (no Alcore card there); hosted/Capacitor mobile inherit the
// shared-UI behavior wherever this server runs.
//
// Readiness gate (task 55 — the post-login race, see
// `.omo/evidence/task-54-provider-unavailable.md`): after the block +
// credential writes, the sync polls the managed OpenCode model surface
// for the alcore entries (bounded ~30 s) before reporting complete, and
// publishes the gate at `getReadiness()` for the `GET
// /api/alcore/readiness` route the composer hold reads. An external
// OpenCode never sees this process's write, so the gate reports
// `needs_restart` there ("restart your OpenCode") instead of polling a
// surface that cannot change.
import { z } from 'zod';

import { TOKENPANEL_DEFAULT_BASE } from '../tokenpanel/tokenpanel-quota.js';
import { discoverProviderModels } from '../opencode/model-discovery.js';
import { isEnterpriseMode } from '../enterprise-mode.js';

export const ALCORE_PROVIDER_ID = 'alcore';
export const ALCORE_PROVIDER_NAME = 'Alcore';
// Same spelling the Settings custom-provider form writes for OpenAI-chat
// endpoints; the server normalizes it to the `aisdk:` provider package.
export const ALCORE_PROVIDER_PACKAGE = 'aisdk:@ai-sdk/openai-compatible';
// Ambient credential name the provider block references as a
// user-settable fallback. The server never writes a value here itself
// (task 52, Slice B) — it only deletes stale ones on sync/sign-out.
export const ALCORE_ENV_CREDENTIAL = 'ALCORE_USER_TOKEN';
const ALCORE_CATALOG_TIMEOUT_MS = 15_000;
// Same retry the Settings custom-provider form uses after its config write
// (`storeKeyAfterConfigWrite`): OpenCode picks the block up from its file
// watcher, and until then it rejects the key with "Integration not found".
// Only that rejection is retried, briefly — anything else fails fast so a
// credential outage never holds a proven login hostage.
const ALCORE_CREDENTIAL_RETRY_DELAYS_MS = [250, 500, 1000, 2000];
// Post-write readiness poll (task 55): the task-54 race lost ~26 s after
// the writes, so the ceiling clears that with margin while the short
// interval answers a fast watcher in about a second. Both bounds are
// injectable on the runtime so tests never sleep.
const ALCORE_READINESS_TIMEOUT_MS = 30_000;
const ALCORE_READINESS_INTERVAL_MS = 500;
// Mirrors the model-capability vocabulary the provider registry validates.
const ALCORE_KNOWN_CAPABILITIES = new Set(['text', 'image', 'audio', 'video', 'pdf']);

export class AlcoreProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AlcoreProviderError';
    this.code = code;
  }
}

const subSchema = z.string().trim().min(1).max(128);

// Same override semantics as the quota proxy: an explicit base wins, else
// `TOKENPANEL_API_URL`, else the base of record. The OpenAI-compatible
// surface hangs under `/v1`.
const readConfiguredApiBase = (explicit, env) => {
  const direct = z.string().min(1).optional().safeParse(explicit).data?.trim().replace(/\/+$/, '');
  if (direct) return direct;
  const fromEnv = z.string().optional().safeParse(env?.TOKENPANEL_API_URL).data?.trim().replace(/\/+$/, '');
  return fromEnv && fromEnv !== '' ? fromEnv : TOKENPANEL_DEFAULT_BASE;
};

export const resolveAlcoreBase = (explicit, env = process.env) => {
  const raw = readConfiguredApiBase(explicit, env);
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('bad protocol');
    return `${parsed.origin}/v1`;
  } catch {
    throw new AlcoreProviderError('ALCORE_MISCONFIGURED', 'Alcore base URL is misconfigured.');
  }
};

const isAuthRefusal = (error) => error?.statusCode === 401 || error?.code === 'provider_auth';

// Transient is narrow: raw transport failures and upstream 5xx
// (`provider_error`). A malformed/oversized/redirected answer is
// hard-invalid (REJECTED) — it must never read as a retryable outage.
const isTransientFailure = (error) => {
  if (error?.code === 'provider_error') return true;
  // Raw transport failures (DNS, reset, timeout) carry no status at all.
  if (error instanceof TypeError) return true;
  return error?.name === 'AbortError' || error?.name === 'TimeoutError';
};

// Catalog entries are parsed at this boundary: anything discovery hands
// over that is not a usable model is skipped, never carried as unknown
// shapes into the provider config.
const discoveredCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  display_name: z.string().optional(),
  description: z.string().optional(),
  context_window: z.number().optional(),
  max_output_tokens: z.number().optional(),
  modalities: z.object({
    input: z.array(z.string()).optional(),
    output: z.array(z.string()).optional(),
  }).optional(),
  limit: z.object({ context: z.number().optional(), output: z.number().optional() }).optional(),
  capabilities: z.object({
    input: z.array(z.string()).optional(),
    output: z.array(z.string()).optional(),
    tools: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    json_mode: z.boolean().optional(),
    structured_output: z.boolean().optional(),
    attachment: z.boolean().optional(),
  }).optional(),
}).passthrough();

const sanitizeCatalogModels = (models) => {
  const kept = [];
  const seen = new Set();
  for (const raw of models ?? []) {
    const parsed = discoveredCatalogEntrySchema.safeParse(raw);
    if (!parsed.success) continue;
    // Discovery hands back its normalized fields under `metadata`; read through so
    // the platform's catalog metadata reaches the provider entry instead of being
    // dropped as an unknown shape.
    const model = { ...parsed.data, ...((parsed.data).metadata ?? {}) };
    const id = model.id.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    const entry = { modelID: id, name: model.display_name?.trim() ? model.display_name.trim() : model.name?.trim() ? model.name.trim() : id };
    if (model.description?.trim()) entry.description = model.description.trim();
    const limit = {};
    // The platform publishes context_window / max_output_tokens; older entries
    // used limit.context / limit.output. Accept both so a field rename does not
    // silently drop a model's limits.
    const contextWindow = model.limit?.context ?? model.context_window;
    const maxOutput = model.limit?.output ?? model.max_output_tokens;
    if (Number.isSafeInteger(contextWindow) && contextWindow > 0) {
      limit.context = contextWindow;
    }
    if (Number.isSafeInteger(maxOutput) && maxOutput > 0) {
      limit.output = maxOutput;
    }
    if (Object.keys(limit).length > 0) entry.limit = limit;
    const modalities = model.modalities ?? model.capabilities;
    const input = modalities?.input?.filter((value) => ALCORE_KNOWN_CAPABILITIES.has(value));
    const outCap = modalities?.output?.filter((value) => ALCORE_KNOWN_CAPABILITIES.has(value));
    const tools = model.capabilities?.tools;
    const reasoning = model.capabilities?.reasoning;
    const attachment = model.capabilities?.attachment;
    const jsonMode = model.capabilities?.json_mode;
    const structured = model.capabilities?.structured_output;
    if (input !== undefined || outCap !== undefined || tools !== undefined || reasoning !== undefined
      || attachment !== undefined || jsonMode !== undefined || structured !== undefined) {
      entry.capabilities = {
        tools: tools ?? true,
        input: input ?? ['text'],
        output: outCap ?? ['text'],
        ...(reasoning === undefined ? {} : { reasoning }),
        ...(attachment === undefined ? {} : { attachment }),
        ...(jsonMode === undefined ? {} : { json_mode: jsonMode }),
        ...(structured === undefined ? {} : { structured_output: structured }),
      };
    }
    kept.push(entry);
  }
  return kept;
};

export const buildAlcoreProviderConfig = (base, models) => ({
  package: ALCORE_PROVIDER_PACKAGE,
  name: ALCORE_PROVIDER_NAME,
  env: [ALCORE_ENV_CREDENTIAL],
  settings: { baseURL: base },
  models: Object.fromEntries(models.map((model) => [model.modelID, model])),
});

export const createAlcoreProviderRuntime = ({
  userTokenStore = null,
  upsertProviderConfig = null,
  removeProviderConfig = null,
  serviceFetch = (...args) => fetch(...args),
  env = process.env,
  isEnterprise = () => isEnterpriseMode(),
  // OpenCode credential provisioning (task 48 — the badge flip, task 51 —
  // the personal key). Shape:
  // `{ listCredentialIDs: () => Promise<string[]>,
  //    connectKey: (key: string) => Promise<void>,
  //    removeCredential: (id: string) => Promise<void> }`.
  // Production wires the real `@opencode/client` calls (global client, no
  // directory — the same client the Settings API-key save uses); tests
  // inject recording fakes. Null (default) keeps the block-only behavior:
  // provider block, no OpenCode credential.
  // The key stored is ALWAYS the freshly minted personal API key for the
  // caller's own link (see `./personal-key.js`) — never the rotating login
  // Bearer, never a service or management key, never from config, never
  // logged.
  openCodeCredentials = null,
  // Personal-key provisioning (task 51): `{ mintPersonalKey,
  // revokePersonalKey, readKeyId }` from `./personal-key.js` (production:
  // `createPersonalKeyRuntime`; tests: a recording fake). Null (default)
  // keeps the block-only behavior: the provider block is still written,
  // but no key is minted and no credential is stored.
  personalKeys = null,
  // Model-surface probe (task 55 — the post-login race): `() =>
  // Promise<unknown[]>` resolving the alcore models the managed OpenCode
  // currently serves (production: `client.model.list()` filtered to the
  // alcore provider; tests: a recording fake). Null (default) keeps the
  // write-then-return behavior: no poll, readiness reports ready.
  listAlcoreModels = null,
  // Managed-vs-external OpenCode (task 55): an external server never sees
  // this process's config write, so the poll below would time out by
  // construction — report `needs_restart` instead. Production reads the
  // lifecycle's external flag; tests inject a boolean thunk.
  isExternalOpenCode = () => false,
  // Bounds for the post-write poll (task 55): ~30 s max so a login that
  // lands ~26 s after the writes (task-54) resolves ready, short interval
  // so a fast watcher answers in about a second. Both injectable so tests
  // never sleep.
  readinessTimeoutMs = ALCORE_READINESS_TIMEOUT_MS,
  readinessIntervalMs = ALCORE_READINESS_INTERVAL_MS,
  // Clock (injectable so timeout tests never sleep).
  now = () => Date.now(),
  // Wait between key-method retries and readiness polls (injectable so
  // tests never sleep).
  credentialWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  credentialRetryDelaysMs = ALCORE_CREDENTIAL_RETRY_DELAYS_MS,
} = {}) => {
  // Post-login readiness (task 55): the single gate the first prompt waits
  // on. `syncing` while the poll runs, `ready` once the alcore models
  // resolve on the managed model surface, `syncing_retry` when the bounded
  // poll times out (send retries on the named state — never the raw
  // upstream "Provider unavailable"), `needs_restart` on an external
  // server (this process's write is invisible there — restart OpenCode).
  // A generation rejects stale completions: concurrent logins and a
  // sign-out mid-sync bump it, and the poll loop aborts instead of
  // publishing for a sync that no longer owns the provider.
  let readinessGeneration = 0;
  let readiness = { state: 'idle', updatedAt: now(), needsRestart: false };
  const setReadiness = (state, needsRestart = false) => {
    readiness = { state, updatedAt: now(), needsRestart };
  };
  // Authoritative read for the readiness route and the composer hold.
  // Never throws, never touches the network: a snapshot, not a probe.
  const getReadiness = () => ({ ...readiness });
  const readStoredAccess = async (sub) => {
    if (userTokenStore === null || userTokenStore === undefined) return '';
    try {
      const pair = await userTokenStore.get(sub);
      const access = z.object({ accessToken: z.string() }).safeParse(pair).data?.accessToken ?? '';
      return access.trim();
    } catch {
      return '';
    }
  };

  const readLiveCatalog = async (base, accessToken) => discoverProviderModels(
    { baseURL: base, modelsPath: '/models', apiKey: accessToken, enrich: false },
    { fetch: serviceFetch, timeoutMs: ALCORE_CATALOG_TIMEOUT_MS },
  );

  // Live catalog with the caller's Bearer, refreshed once on a 401. Never
  // throws raw platform shapes: every failure is an AlcoreProviderError.
  // Never clears the pair here — at login time a catalog refusal must not
  // nuke credentials the quota path may still use.
  const fetchAlcoreCatalog = async (sub) => {
    const id = subSchema.safeParse(sub).data;
    if (id === undefined) {
      throw new AlcoreProviderError('ALCORE_INVALID_REQUEST', 'Invalid Alcore subject.');
    }
    const base = resolveAlcoreBase(undefined, env);
    let access = await readStoredAccess(id);
    if (access === '') {
      throw new AlcoreProviderError('ALCORE_NOT_CONFIGURED', 'No Alcore user token is stored for this session.');
    }
    try {
      try {
        return { base, access, models: sanitizeCatalogModels((await readLiveCatalog(base, access)).models) };
      } catch (refused) {
        if (!isAuthRefusal(refused)) throw refused;
        let fresh = '';
        try {
          fresh = await userTokenStore.refreshAccessToken(id);
        } catch (refreshError) {
          if (refreshError?.code === 'USER_TOKEN_REFRESH_TRANSIENT') {
            throw new AlcoreProviderError('ALCORE_TRANSIENT', 'Alcore catalog is unavailable.');
          }
          throw new AlcoreProviderError('ALCORE_REJECTED', 'Alcore refused the caller token.');
        }
        access = String(fresh ?? '').trim();
        if (access === '') {
          throw new AlcoreProviderError('ALCORE_REJECTED', 'Alcore refused the caller token.');
        }
        return { base, access, models: sanitizeCatalogModels((await readLiveCatalog(base, access)).models) };
      }
    } catch (error) {
      if (error instanceof AlcoreProviderError) throw error;
      if (isTransientFailure(error)) {
        throw new AlcoreProviderError('ALCORE_TRANSIENT', 'Alcore catalog is unavailable.');
      }
      throw new AlcoreProviderError('ALCORE_REJECTED', 'Alcore answered an unusable catalog.');
    }
  };

  // Resolve the provider credential, Codex-style: ONE key per device,
  // reused across logins — never a fresh mint per login (see
  // `./personal-key.js`). When a key-id ref is recorded for this subject
  // AND OpenCode still holds an `alcore` credential entry, the stored key
  // is reused as-is: no mint, no new server row, no revoke. Otherwise
  // mint fresh (the server revokes the old row via rotate-with-revoke-old).
  // Any doubt falls through to mint — a missing/unreadable ref, an
  // unwired or unreadable credential store, or an empty store all mint —
  // so reuse only ever skips provably redundant work, never auth.
  // Resolves `{ key, reused }` on success or `{ key: null, reason }` when
  // no key is available — the caller degrades to the block-only
  // "Not signed in" card, never a broken login.
  // Staleness note: a key revoked out-of-band (portal, operator) while
  // its ref + store entry survive reads as reusable until the next
  // sign-out clears both and the following login mints fresh. Inference
  // against a dead key fails provider-side, exactly as a mid-session
  // portal revoke does today.
  const resolveProviderCredential = async (sub) => {
    if (personalKeys === null || personalKeys === undefined) {
      return { key: null, reused: false, reason: 'not_wired' };
    }
    try {
      const recorded = subSchema.safeParse(await personalKeys.readKeyId(sub)).data;
      if (recorded !== undefined
        && openCodeCredentials !== null && openCodeCredentials !== undefined) {
        let held = [];
        try {
          held = (await openCodeCredentials.listCredentialIDs()) ?? [];
        } catch {
          held = [];
        }
        if (held.length > 0) return { key: null, reused: true, reason: null };
      }
    } catch {
      // Best-effort: any doubt falls through to a fresh mint below.
    }
    try {
      const minted = await personalKeys.mintPersonalKey(sub);
      const key = z.string().min(1).safeParse(minted?.key).data ?? '';
      if (key === '') return { key: null, reused: false, reason: 'personal_key_unavailable' };
      return { key, reused: false, reason: null };
    } catch (error) {
      return { key: null, reused: false, reason: error?.code ?? 'personal_key_unavailable' };
    }
  };
  // OpenCode still reports a custom provider as "Not signed in" until its
  // integration holds a credential connection: the config block alone lists
  // models but leaves `connections` empty. Stale credentials (an expired
  // rotating JWT from a previous login) are removed first so one login never
  // accumulates "Accounts" — a single fresh credential reads as Connected.
  // Best-effort only: any failure warns (never the key) and the provider
  // block already written above keeps serving models.
  const provisionOpenCodeCredential = async (access) => {
    if (openCodeCredentials === null || openCodeCredentials === undefined) return;
    const key = String(access ?? '').trim();
    if (key === '') return;
    try {
      let stale = [];
      try {
        stale = (await openCodeCredentials.listCredentialIDs()) ?? [];
      } catch {
        stale = [];
      }
      for (const credentialId of stale) {
        try {
          await openCodeCredentials.removeCredential(credentialId);
        } catch {
          // Best-effort: the fresh key below still flips the badge even
          // when a stale entry lingers (it reads as an extra account).
        }
      }
      const delays = Array.isArray(credentialRetryDelaysMs) ? credentialRetryDelaysMs : ALCORE_CREDENTIAL_RETRY_DELAYS_MS;
      for (let attempt = 0; ; attempt += 1) {
        try {
          await openCodeCredentials.connectKey(key);
          return;
        } catch (error) {
          const delay = delays[attempt];
          const notRegisteredYet = error instanceof Error && /not found/i.test(error.message);
          if (!notRegisteredYet || delay === undefined) throw error;
          await credentialWait(delay);
        }
      }
    } catch (error) {
      console.warn(`[alcore-provider] credential sync skipped (${error?.code ?? 'unavailable'})`);
    }
  };

  // Removes every `alcore` credential OpenCode holds. Best-effort: never
  // throws, never logs ids or keys. Runs even in enterprise mode and even
  // for an unknown subject — the credential is global, and removal only
  // narrows access, so an orphan must never survive a sign-out.
  const removeOpenCodeCredentials = async () => {
    if (openCodeCredentials === null || openCodeCredentials === undefined) return;
    try {
      let ids = [];
      try {
        ids = (await openCodeCredentials.listCredentialIDs()) ?? [];
      } catch {
        ids = [];
      }
      for (const credentialId of ids) {
        try {
          await openCodeCredentials.removeCredential(credentialId);
        } catch {
          // Best-effort: sign-out already rotated the session secret and
          // dropped the ambient credential; a lingering OpenCode entry is
          // narrowed on the next login's stale-sweep anyway.
        }
      }
    } catch {
      // Best-effort: never fail a sign-out that already succeeded.
    }
  };

  // Best-effort registration after a proven login. Resolves `{ ok: true,
  // models, ready }` (plus `reason`/`needsRestart` while not ready) or
  // `{ ok: false, reason }` and NEVER rejects: a catalog
  // outage, a refused token, enterprise mode, a config-write failure, a
  // refused/unreachable personal-key mint, or a credential-sync failure
  // must not break the login that just succeeded. After the block +
  // credential writes it polls the managed model surface for the alcore
  // entries (bounded ~30 s, task 55) before reporting complete, so the
  // first prompt finds the provider instead of racing the watcher. The
  // credential stored is
  // the caller's personal API key for its own link (see
  // `./personal-key.js`) — freshly minted on first login, then REUSED
  // while its key-id ref + store entry survive (one key per device,
  // Codex-style; no mint storm, no revoked-row pile-up) — never the
  // rotating login Bearer, never a service or management key, never in
  // config/disk/URL/logs, and never mirrored into this process's
  // environment (task 52, Slice B: the stored integration credential is
  // the only inference path). When the
  // mint is unavailable the provider block is still written but no secret
  // is stored, so the card reads "Not signed in" while the rest works.
  const syncOnLogin = async (sub) => {
    try {
      let enterprise = false;
      try {
        enterprise = (await isEnterprise()) === true;
      } catch {
        enterprise = false;
      }
      if (enterprise) return { ok: false, reason: 'enterprise_mode' };
      const id = subSchema.safeParse(sub).data;
      if (id === undefined) return { ok: false, reason: 'invalid_request' };
      if (upsertProviderConfig === null || upsertProviderConfig === undefined) {
        return { ok: false, reason: 'not_wired' };
      }
      const catalog = await fetchAlcoreCatalog(id);
      if (catalog.models.length === 0) {
        console.warn('[alcore-provider] catalog answered no usable models; provider not registered');
        return { ok: false, reason: 'empty_catalog' };
      }
      upsertProviderConfig(
        ALCORE_PROVIDER_ID,
        buildAlcoreProviderConfig(catalog.base, catalog.models),
        null,
        'user',
        {},
      );
      const credential = await resolveProviderCredential(id);
      if (credential.key === null && credential.reused !== true) {
        // Mint failure never breaks the login: the block above is written
        // (live models listed) but no secret is stored, so the card reads
        // "Not signed in". Any stale ambient value is dropped so an old
        // login Bearer can never linger past its rotation.
        try {
          delete env[ALCORE_ENV_CREDENTIAL];
        } catch {
          // Best-effort: the card state above is what matters.
        }
        return { ok: false, reason: credential.reason };
      }
      // Slice B (task 52, Gap 2): the minted key is stored ONLY as the
      // OpenCode integration credential (provisionOpenCodeCredential
      // below) — never mirrored into this process's environment. The
      // managed OpenCode process snapshots its env once at spawn, so a
      // post-login write here never reaches the running server, while
      // every future child would inherit the live key. Drop any stale
      // value instead, so a previous session's key can never linger.
      try {
        delete env[ALCORE_ENV_CREDENTIAL];
      } catch {
        // Best-effort: the stored credential below is what matters.
      }
      // Reuse stores nothing: the entry is already there, and the sweep
      // inside would delete the only copy of a key we no longer hold.
      if (credential.reused !== true) {
        await provisionOpenCodeCredential(credential.key);
      }
      // Readiness gate (task 55): the inference path builds its provider
      // client from the managed model surface, which lags the config +
      // credential writes by seconds (task-54: attempt 1 lost ~26 s after
      // the writes, the retry won). Poll that surface — bounded, never
      // rejecting — before reporting the sync complete, so the first
      // prompt after login finds the provider instead of racing it.
      try {
        let external = false;
        try {
          external = (await isExternalOpenCode()) === true;
        } catch {
          external = false;
        }
        if (external) {
          setReadiness('needs_restart', true);
          return {
            ok: true, models: catalog.models.length, ready: false, reason: 'external_restart_required', needsRestart: true,
          };
        }
        if (listAlcoreModels === null || listAlcoreModels === undefined) {
          setReadiness('ready');
          return { ok: true, models: catalog.models.length, ready: true };
        }
        const ownedGeneration = (readinessGeneration += 1);
        setReadiness('syncing');
        const timeoutMs = Number.isSafeInteger(readinessTimeoutMs) ? readinessTimeoutMs : ALCORE_READINESS_TIMEOUT_MS;
        const intervalMs = Number.isSafeInteger(readinessIntervalMs) && readinessIntervalMs > 0
          ? readinessIntervalMs
          : ALCORE_READINESS_INTERVAL_MS;
        const deadline = now() + Math.max(0, timeoutMs);
        for (;;) {
          if (ownedGeneration !== readinessGeneration) {
            return {
              ok: true, models: catalog.models.length, ready: false, reason: 'superseded',
            };
          }
          let visible = null;
          try {
            visible = await listAlcoreModels();
          } catch {
            visible = null;
          }
          if (Array.isArray(visible) && visible.length > 0) {
            if (ownedGeneration === readinessGeneration) setReadiness('ready');
            return { ok: true, models: catalog.models.length, ready: true };
          }
          if (now() >= deadline) {
            if (ownedGeneration === readinessGeneration) setReadiness('syncing_retry');
            return {
              ok: true, models: catalog.models.length, ready: false, reason: 'provider_syncing',
            };
          }
          await credentialWait(intervalMs);
        }
      } catch {
        // A probe failure never breaks the login that just succeeded: the
        // block and credential above stand, and the composer retries on the
        // named syncing state.
        setReadiness('syncing_retry');
        return {
          ok: true, models: catalog.models.length, ready: false, reason: 'provider_syncing',
        };
      }
    } catch (error) {
      console.warn(`[alcore-provider] login sync skipped (${error?.code ?? 'unavailable'})`);
      return { ok: false, reason: error?.code ?? 'unavailable' };
    }
  };

  // Best-effort teardown on global sign-out. Revokes the minted personal
  // key id FIRST (the caller's Bearer is still keychained here — clear
  // runs below — and the revoke is what turns a sign-out into a dead
  // provider key), then drops the ambient credential and every OpenCode
  // `alcore` credential; the pair and the config entry follow when present.
  // NEVER rejects. Removal runs even in enterprise mode and even for an
  // unknown subject: it only narrows access. A refused or unreachable
  // revoke still proceeds to the local removal, and the next login's
  // rotate-with-revoke-old cleans up any surviving row regardless.
  const clearOnSignOut = async (sub) => {
    // A sign-out mid-sync retires the running poll: bump the generation so
    // its loop aborts as superseded, and park the gate at idle so the next
    // login starts from a known state.
    readinessGeneration += 1;
    setReadiness('idle');
    const outcome = { cleared: false, removed: false };
    const id = subSchema.safeParse(sub).data;
    if (id !== undefined && personalKeys !== null && personalKeys !== undefined) {
      try {
        let storedId = null;
        try {
          storedId = await personalKeys.readKeyId(id);
        } catch {
          storedId = null;
        }
        // A recorded id revokes exactly that row; without one the server
        // revokes every active personal row for the caller — either way no
        // personal key survives the sign-out.
        await personalKeys.revokePersonalKey(id, storedId ?? undefined);
      } catch {
        // Best-effort: sign-out already rotated the session secret and the
        // local removal below still runs.
      }
    }
    try {
      delete env[ALCORE_ENV_CREDENTIAL];
    } catch {
      // Best-effort: the pair and config cleanup below still run.
    }
    await removeOpenCodeCredentials();
    if (id === undefined) return outcome;
    if (userTokenStore !== null && userTokenStore !== undefined) {
      try {
        await userTokenStore.clear(id);
        outcome.cleared = true;
      } catch {
        // Best-effort: the serving path is what matters, and sign-out
        // rotates the session secret regardless.
      }
    }
    if (removeProviderConfig !== null && removeProviderConfig !== undefined) {
      try {
        outcome.removed = (await removeProviderConfig(ALCORE_PROVIDER_ID, null, 'user')) === true;
      } catch {
        // Best-effort: a missing entry reads the same as a removed one.
        outcome.removed = false;
      }
    }
    return outcome;
  };

  return {
    resolveBase: (explicit) => resolveAlcoreBase(explicit, env),
    fetchAlcoreCatalog,
    syncOnLogin,
    clearOnSignOut,
    getReadiness,
  };
};
