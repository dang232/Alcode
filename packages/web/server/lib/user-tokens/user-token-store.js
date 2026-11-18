// User-token credential store (project-ide task 39; credential-tier rework).
//
// What this owns: the Alcore user-token pair captured at desktop login
// completion — the short-lived access JWT (10-min, claims sub+scope) plus
// the opaque rotating refresh token — held so the TokenPanel quota proxy
// can present the CALLER's own Bearer without the renderer ever seeing a
// token. Only storage and presentation live here: issuance and validation
// stay with the auth-service and the session owner (ui-auth).
//
// Persistence tiers, chosen ONCE at creation in this order and never
// changed afterwards (`tier`, with `isDurable() === tier !== 'memory'`):
// - 'keychain': OS-held secrets. Electron safeStorage when it is genuinely
//   available (the in-process Electron main runtime), else the
//   @napi-rs/keyring OS credential store — the tier that persists outside
//   Electron. safeStorage secrets rest as ciphertext in
//   `<dataDir>/user-tokens.json`; keyring secrets rest in the OS store
//   (service `alcode-user-tokens`, accounts `<sub>:access`/`:refresh`)
//   with only a marker index in the JSON file. Plaintext exists only in
//   process memory while an entry is protected, revealed, or held as the
//   working set.
// - 'encrypted-file': AES-256-GCM ciphertext in
//   `<dataDir>/user-tokens.json`, keyed by a random 32-byte key in
//   `<dataDir>/user-tokens.key` (both mode 0o600). Honest limit: this is
//   at-rest protection only — the key sits beside the ciphertext, so it
//   stops casual disk reads, not an attacker who can read the data
//   directory. Prefer the keychain tier wherever one exists.
// - 'memory': process memory only, lost on restart — fail-safe toward
//   re-login. Never localStorage, never disk plaintext, never URLs, never
//   logs: downgrade warnings name the tier and the fixed reason, never a
//   secret, a fragment of one, or a length.
//
// Seams (all optional, production resolves its own defaults):
// `keychain` mirrors safeStorage's shape exactly
// (`{ isEncryptionAvailable, encryptString, decryptString }`), so the mock
// boundary in tests IS the safeStorage boundary; pass `keychain: null` to
// force "no keychain" deterministically (auto-selection never touches the
// real OS store then). `tier` forces one tier for tests — production omits
// it and takes the selection order. `dataDir` pins the directory holding
// both files (`dataFilePath` is the legacy single-file pin; tests use a
// temp dir, mirroring the ui-auth test precedent).
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import { readAlcoreIssuer } from '../ui-auth/ui-auth.js';

// OS credential store outside Electron. Loaded once, dynamically, inside a
// try/catch so a machine without a prebuilt binary still imports this
// module: any load failure reads as "no keyring" and tier selection
// downgrades, never crashes. (Kept out of the static imports for exactly
// that reason — the package is an OPTIONAL dependency.)
let keyringModule = null;
try {
  keyringModule = await import('@napi-rs/keyring');
} catch {
  keyringModule = null;
}

const USER_TOKEN_FILE_NAME = 'user-tokens.json';
const USER_TOKEN_KEY_FILE_NAME = 'user-tokens.key';
const USER_TOKEN_FILE_MODE = 0o600;
const USER_TOKEN_REFRESH_PATH = '/auth/token/refresh';
const USER_TOKEN_SERVICE_TIMEOUT_MS = 15_000;
const USER_TOKEN_KEYRING_SERVICE = 'alcode-user-tokens';
// Refresh is serialized across every process that shares this store (a dev
// build and a packaged build, or two windows): the auth service mints
// single-use refresh tokens and treats a rotated-out one as theft, so two
// holders presenting at once would end the family for both. The lock is a file
// beside the token index; a lock older than the TTL is abandoned by definition,
// because one refresh never legitimately outlives the service timeout.
const USER_TOKEN_LOCK_FILE_NAME = 'user-tokens.refresh.lock';
const USER_TOKEN_LOCK_TTL_MS = 60_000;
const USER_TOKEN_LOCK_WAIT_MS = 15_000;
const USER_TOKEN_LOCK_POLL_MS = 50;
// Index marker in the JSON file for secrets that rest in the OS keyring:
// the file carries subjects and timestamps, never secret material.
const USER_TOKEN_KEYRING_MARKER = 'keyring';

// Fixed downgrade reasons. Literals only — a warning must never carry a
// token, a token fragment, or anything shaped like one, so no caller data
// (and no interpolated values at all) ever reaches the message.
const KEYCHAIN_REASON_EXPLICIT_OFF = 'the caller disabled the keychain seam';
const KEYCHAIN_REASON_SEAM_LOCKED = 'the provided keychain reports encryption unavailable';
const KEYCHAIN_REASON_NO_OS = 'Electron safeStorage is not available and the keyring module is not present';
const ENCRYPTED_FILE_REASON = 'the encrypted-file data directory is not writable';

const subSchema = z.string().trim().min(1).max(128);
const accessTokenSchema = z.string().trim().min(1).max(8192);
const refreshTokenSchema = z.string().trim().min(1).max(4096);
const base64Schema = z.string().min(1);
const storedEntriesSchema = z.record(
  z.string(),
  z.object({
    access: base64Schema,
    refresh: base64Schema.nullable().optional(),
    updatedAt: z.number(),
  }),
);
// The auth-service refresh answer: a fresh access JWT plus the rotated
// refresh token (kept optional — when the service omits it the previous
// refresh value stays, best-effort, rather than stranding the session).
const refreshAnswerSchema = z.object({
  access_token: accessTokenSchema,
  refresh_token: refreshTokenSchema.optional(),
});

export class UserTokenStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UserTokenStoreError';
    this.code = code;
  }
}

const defaultDataDir = () => {
  return process.env.ALCODE_DATA_DIR
    ? path.resolve(process.env.ALCODE_DATA_DIR)
    : path.join(os.homedir(), '.config', 'alcode');
};

const resolvePaths = ({ dataDir, dataFilePath } = {}) => {
  if (typeof dataFilePath === 'string' && dataFilePath.trim() !== '') {
    const cipherPath = path.resolve(dataFilePath);
    return { cipherPath, keyPath: path.join(path.dirname(cipherPath), USER_TOKEN_KEY_FILE_NAME) };
  }
  const dir = typeof dataDir === 'string' && dataDir.trim() !== ''
    ? path.resolve(dataDir)
    : defaultDataDir();
  return {
    cipherPath: path.join(dir, USER_TOKEN_FILE_NAME),
    keyPath: path.join(dir, USER_TOKEN_KEY_FILE_NAME),
  };
};

const readJsonEntries = (cipherPath) => {
  try {
    const raw = fs.readFileSync(cipherPath, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = storedEntriesSchema.safeParse(parsed?.entries).data;
    return entries ?? {};
  } catch {
    // Missing or corrupt ciphertext reads as empty: the next successful
    // save overwrites it, and callers fail toward re-login, never a crash.
    return {};
  }
};

const writeJsonEntries = (cipherPath, entries) => {
  fs.mkdirSync(path.dirname(cipherPath), { recursive: true });
  fs.writeFileSync(cipherPath, JSON.stringify({ version: 1, entries }), { mode: USER_TOKEN_FILE_MODE });
  try {
    // writeFileSync mode applies on creation only; enforce on every write.
    fs.chmodSync(cipherPath, USER_TOKEN_FILE_MODE);
  } catch {
    // Windows does not honor the POSIX mode bits.
  }
};

// Random 32-byte file key, created once and reused. A wrong-length file
// heals with a fresh key (previous ciphertext then reads as empty and
// callers fail toward re-login). Throws when the directory is not
// writable — the factory turns that into the memory tier.
const loadOrCreateFileKey = (keyPath) => {
  let existing = null;
  try {
    existing = fs.readFileSync(keyPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (existing !== null && existing.length === 32) {
    try {
      fs.chmodSync(keyPath, USER_TOKEN_FILE_MODE);
    } catch {
      // Windows does not honor the POSIX mode bits.
    }
    return existing;
  }
  const fresh = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, fresh, { mode: USER_TOKEN_FILE_MODE });
  try {
    fs.chmodSync(keyPath, USER_TOKEN_FILE_MODE);
  } catch {
    // Windows does not honor the POSIX mode bits.
  }
  return fresh;
};

// One token field under the file key: base64(iv | tag | ciphertext).
const encryptField = (key, plaintext) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
};

const decryptField = (key, stored) => {
  const raw = Buffer.from(stored, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
};

// Electron safeStorage, resolved per operation so a keychain that locks
// (or unlocks) mid-run takes effect without a restart. Plain Node has no
// Electron runtime: `require('electron')` there answers the binary path,
// which fails the shape check below and reads as unavailable.
const electronKeychainSchema = z.object({
  isEncryptionAvailable: z.function(),
  encryptString: z.function(),
  decryptString: z.function(),
});
const resolveOsKeychain = () => {
  try {
    const versions = z.object({ electron: z.string() }).safeParse(globalThis.process?.versions).data;
    if (!versions) return null;
    const candidate = electronKeychainSchema.safeParse(
      createRequire(import.meta.url)('electron')?.safeStorage,
    ).data;
    if (!candidate) return null;
    return candidate.isEncryptionAvailable() === true ? candidate : null;
  } catch {
    return null;
  }
};

// safeStorage-shaped protection: a pure transform, ciphertext persists to
// the JSON file (today's behaviour).
const safeStorageBackend = (keychain) => ({
  protect: (sub, field, plain) => keychain.encryptString(plain).toString('base64'),
  reveal: (sub, field, stored) => keychain.decryptString(Buffer.from(stored, 'base64')),
  drop: () => {},
});

// Keyring protection: the secret rests in the OS store under
// `<sub>:<field>`; the JSON file keeps only a marker index plus the
// timestamp. Reads of a missing entry throw inside keyring and are caught
// by the caller (drop to signed-out).
const keyringBackend = () => {
  const Entry = keyringModule?.Entry;
  if (typeof Entry !== 'function') return null;
  return {
    protect: (sub, field, plain) => {
      new Entry(USER_TOKEN_KEYRING_SERVICE, `${sub}:${field}`).setPassword(plain);
      return USER_TOKEN_KEYRING_MARKER;
    },
    reveal: (sub, field) => new Entry(USER_TOKEN_KEYRING_SERVICE, `${sub}:${field}`).getPassword(),
    drop: (sub) => {
      for (const field of ['access', 'refresh']) {
        try {
          new Entry(USER_TOKEN_KEYRING_SERVICE, `${sub}:${field}`).deletePassword();
        } catch {
          // Best-effort: the memory working set (the serving path) is clear.
        }
      }
    },
  };
};

const resolveKeychainBackend = (keychain) => {
  if (keychain !== undefined) {
    if (keychain === null) return { backend: null, reason: KEYCHAIN_REASON_EXPLICIT_OFF };
    try {
      if (keychain.isEncryptionAvailable() === true) {
        return { backend: safeStorageBackend(keychain), reason: null };
      }
    } catch {
      // A throwing seam reads as locked.
    }
    return { backend: null, reason: KEYCHAIN_REASON_SEAM_LOCKED };
  }
  const electron = resolveOsKeychain();
  if (electron !== null) return { backend: safeStorageBackend(electron), reason: null };
  const ring = keyringBackend();
  if (ring !== null) return { backend: ring, reason: null };
  return { backend: null, reason: KEYCHAIN_REASON_NO_OS };
};

const defaultAuthServiceBase = () => {
  try {
    return new URL(readAlcoreIssuer(undefined)).origin;
  } catch {
    return 'https://auth.alcore.io.vn';
  }
};

export const createUserTokenStore = ({
  keychain,
  tier: forcedTier,
  dataDir,
  dataFilePath,
  serviceBase,
  serviceFetch = (...args) => fetch(...args),
} = {}) => {
  // Plaintext working set: process memory only. Durable tiers additionally
  // persist through the JSON file (ciphertext or keyring-marker index).
  const live = new Map();
  const { cipherPath, keyPath } = resolvePaths({ dataDir, dataFilePath });

  // Tier selection: exactly once, keychain -> encrypted-file -> memory.
  // `tier` never changes afterwards; per-operation failures degrade to the
  // memory working set silently — the creation downgrade warning below is
  // the only log this module emits, exactly once per downgraded store.
  let tier;
  let backend = null;
  let fileKey = null;
  if (forcedTier !== undefined && forcedTier !== 'keychain' && forcedTier !== 'encrypted-file' && forcedTier !== 'memory') {
    throw new UserTokenStoreError('USER_TOKEN_INVALID', 'Unknown user-token tier.');
  }
  const preference = forcedTier ?? 'keychain';
  if (preference === 'keychain') {
    const resolved = resolveKeychainBackend(keychain);
    if (resolved.backend !== null) {
      tier = 'keychain';
      backend = resolved.backend;
    } else {
      const reasons = [`keychain unavailable (${resolved.reason})`];
      try {
        fileKey = loadOrCreateFileKey(keyPath);
        tier = 'encrypted-file';
      } catch {
        tier = 'memory';
        reasons.push(`encrypted-file unavailable (${ENCRYPTED_FILE_REASON})`);
      }
      console.warn(`user-tokens: ${reasons.join('; ')}; using ${tier}`);
    }
  } else if (preference === 'encrypted-file') {
    try {
      fileKey = loadOrCreateFileKey(keyPath);
      tier = 'encrypted-file';
    } catch {
      tier = 'memory';
      console.warn(`user-tokens: encrypted-file unavailable (${ENCRYPTED_FILE_REASON}); using memory`);
    }
  } else {
    tier = 'memory';
  }

  // Durability is the tier, nothing more: a probe-free answer for the
  // status route (never a secret, never a throw).
  const isDurable = () => tier !== 'memory';

  const toPair = (accessToken, refreshToken, updatedAt) => {
    const access = accessTokenSchema.safeParse(accessToken).data;
    if (access === undefined) return null;
    const refresh = refreshToken === '' ? '' : (refreshTokenSchema.safeParse(refreshToken).data ?? '');
    return {
      accessToken: access,
      refreshToken: refresh,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    };
  };

  const persistEntries = () => {
    if (tier === 'memory') return;
    try {
      const entries = {};
      for (const [sub, pair] of live) {
        entries[sub] = {
          access: tier === 'keychain'
            ? backend.protect(sub, 'access', pair.accessToken)
            : encryptField(fileKey, pair.accessToken),
          refresh: pair.refreshToken === ''
            ? null
            : (tier === 'keychain'
              ? backend.protect(sub, 'refresh', pair.refreshToken)
              : encryptField(fileKey, pair.refreshToken)),
          updatedAt: pair.updatedAt,
        };
      }
      writeJsonEntries(cipherPath, entries);
    } catch {
      // A locked keychain, a missing keyring entry, or a failing disk must
      // never break the login that just succeeded: the memory working set
      // keeps serving until restart.
    }
  };

  const decryptKeychainEntry = (sub, entry) => {
    try {
      return toPair(
        backend.reveal(sub, 'access', entry.access),
        entry.refresh === null || entry.refresh === undefined
          ? ''
          : backend.reveal(sub, 'refresh', entry.refresh),
        entry.updatedAt,
      );
    } catch {
      // Rekeyed OS keychain, foreign file, or corrupt entry: drop it and
      // read as signed-out rather than serving a half-decrypted secret.
      return null;
    }
  };

  const decryptFileEntry = (entry) => {
    try {
      return toPair(
        decryptField(fileKey, entry.access),
        entry.refresh === null || entry.refresh === undefined
          ? ''
          : decryptField(fileKey, entry.refresh),
        entry.updatedAt,
      );
    } catch {
      // Foreign key file or corrupt entry: signed-out, never half-decrypted.
      return null;
    }
  };

  // Stores the pair captured at login completion. Invalid input throws
  // `USER_TOKEN_INVALID` (callers treat it as "no tokens stored"); a
  // failing backend degrades to memory and still resolves.
  const set = async (sub, pair) => {
    const id = subSchema.safeParse(sub).data;
    const access = accessTokenSchema.safeParse(pair?.accessToken).data;
    if (id === undefined || access === undefined) {
      throw new UserTokenStoreError('USER_TOKEN_INVALID', 'Invalid user-token pair.');
    }
    const refreshRaw = pair?.refreshToken === undefined || pair?.refreshToken === null || pair?.refreshToken === ''
      ? ''
      : refreshTokenSchema.safeParse(pair.refreshToken).data;
    if (refreshRaw === undefined) {
      throw new UserTokenStoreError('USER_TOKEN_INVALID', 'Invalid user-token pair.');
    }
    live.set(id, {
      accessToken: access,
      refreshToken: refreshRaw,
      updatedAt: Number.isFinite(pair?.updatedAt) ? pair.updatedAt : Date.now(),
    });
    persistEntries();
  };

  // One refresh at a time across processes, and the pair is read only after the
  // lock is held. Two Alcode processes share this store, and the auth service
  // treats a rotated-out token as theft, so an unserialized pair would end the
  // session for both. A lock older than the TTL is abandoned by definition: one
  // refresh never legitimately outlives the service timeout.
  const lockPath = path.join(path.dirname(cipherPath), USER_TOKEN_LOCK_FILE_NAME);

  const lockIsStale = () => {
    try {
      const stamp = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      const at = Number(stamp?.at);
      return !Number.isFinite(at) || Date.now() - at > USER_TOKEN_LOCK_TTL_MS;
    } catch {
      // Half-written or unreadable: the holder is gone or never started.
      return true;
    }
  };

  const takeLock = (takeoversLeft) => {
    if (!fs.existsSync(lockPath)) {
      try {
        fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx', mode: 0o600 });
        return true;
      } catch {
        // Another process created it between the check and the write.
        return false;
      }
    }
    if (takeoversLeft <= 0 || !lockIsStale()) return false;
    try {
      fs.unlinkSync(lockPath);
    } catch {
      return false;
    }
    return takeLock(takeoversLeft - 1);
  };

  // Resolves the held path, or null when this process must go ahead unlocked:
  // the memory tier has no shared durable state, a read-only directory cannot
  // hold a lock, and a holder that never releases must not wedge every login.
  const acquireRefreshLock = async () => {
    if (tier === 'memory') return null;
    const deadline = Date.now() + USER_TOKEN_LOCK_WAIT_MS;
    while (!takeLock(1)) {
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => { setTimeout(resolve, USER_TOKEN_LOCK_POLL_MS); });
    }
    return lockPath;
  };

  const releaseRefreshLock = (held) => {
    if (held === null) return;
    try {
      fs.unlinkSync(held);
    } catch {
      // Already released, or taken over after the TTL: nothing to clean up.
    }
  };

  // The durable copy, read past the in-memory working set. Only the refresh
  // path needs it: two Alcode processes (a dev build and a packaged build, or
  // two windows) share this file and the keyring, and either of them can
  // rotate the pair while the other is still holding the old one.
  const readDurable = (id) => {
    if (tier === 'memory') return live.get(id) ?? null;
    const entry = readJsonEntries(cipherPath)[id];
    if (!entry) return null;
    const decrypted = tier === 'keychain' ? decryptKeychainEntry(id, entry) : decryptFileEntry(entry);
    if (!decrypted) return null;
    live.set(id, decrypted);
    return decrypted;
  };

  const get = async (sub) => {
    const id = subSchema.safeParse(sub).data;
    if (id === undefined) return null;
    const held = live.get(id) ?? readDurable(id);
    if (held === null) return null;
    return { accessToken: held.accessToken, refreshToken: held.refreshToken, updatedAt: held.updatedAt };
  };

  const clear = async (sub) => {
    const id = subSchema.safeParse(sub).data;
    if (id === undefined) return;
    live.delete(id);
    if (tier === 'memory') return;
    if (tier === 'keychain') {
      try {
        backend.drop(id);
      } catch {
        // Best-effort: the serving copy is clear and the index rewrite below still runs.
      }
    }
    try {
      const entries = readJsonEntries(cipherPath);
      if (entries[id] !== undefined) {
        delete entries[id];
        writeJsonEntries(cipherPath, entries);
      }
    } catch {
      // Best-effort: the memory working set (the serving path) is clear.
    }
  };

  const resolveRefreshBase = () => {
    const direct = z.string().min(1).optional().safeParse(serviceBase).data?.trim();
    const raw = direct && direct !== '' ? direct : defaultAuthServiceBase();
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('bad protocol');
      return parsed.origin;
    } catch {
      throw new UserTokenStoreError('USER_TOKEN_REFRESH_TRANSIENT', 'User-token refresh is misconfigured.');
    }
  };

  // In-flight refreshes, one shared promise per subject. Concurrent 401s
  // must not replay the rotating refresh token: the first caller performs
  // the upstream POST and every concurrent caller for the same subject
  // awaits that same promise. The entry is removed when the promise
  // settles, so a later call retries once with the freshly persisted pair.
  const inFlightRefreshes = new Map();

  // Rotates the access token through the auth-service refresh endpoint
  // (`POST {authBase}/auth/token/refresh`, opaque refresh token in,
  // fresh pair out). Resolves the new access token. Throws
  // `USER_TOKEN_NO_REFRESH` (nothing to rotate with),
  // `USER_TOKEN_REFRESH_TRANSIENT` (unreachable/throttled auth-service —
  // callers may serve stale cache; the stored pair is kept), or
  // `USER_TOKEN_REFRESH_REJECTED` (refresh refused — the session is dead;
  // the stored pair is cleared).
  // One presentation of a refresh token. `allowAdopt` distinguishes the call
  // the API makes from its single retry, so a refusing service can never turn
  // this into a loop.
  const presentRefresh = async (id, presentedToken, allowAdopt) => {
    const base = resolveRefreshBase();
    let response;
    try {
      response = await serviceFetch(`${base}${USER_TOKEN_REFRESH_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refresh_token: presentedToken }),
        signal: AbortSignal.timeout(USER_TOKEN_SERVICE_TIMEOUT_MS),
      });
    } catch {
      throw new UserTokenStoreError('USER_TOKEN_REFRESH_TRANSIENT', 'User-token refresh is unavailable.');
    }
    if (response.status === 429 || response.status >= 500) {
      throw new UserTokenStoreError('USER_TOKEN_REFRESH_TRANSIENT', 'User-token refresh is unavailable.');
    }
    const answer = response.status === 200
      ? refreshAnswerSchema.safeParse(await response.json().catch(() => null))
      : null;
    if (answer !== null && answer.success) {
      await set(id, {
        accessToken: answer.data.access_token,
        refreshToken: answer.data.refresh_token ?? presentedToken,
      });
      return answer.data.access_token;
    }
    // Refused or unreadable. That alone is not proof the session is dead: the
    // auth service mints SINGLE-USE refresh tokens and revokes the whole
    // family when a rotated-out token is presented, so another holder of this
    // store may simply have rotated the pair while this one was paying. Adopt
    // the durable pair and retry exactly once. Clearing here would delete the
    // only valid copy every holder has left.
    if (allowAdopt) {
      const fresher = readDurable(id);
      if (fresher !== null && fresher.refreshToken !== '' && fresher.refreshToken !== presentedToken) {
        return presentRefresh(id, fresher.refreshToken, false);
      }
    }
    await clear(id);
    throw new UserTokenStoreError('USER_TOKEN_REFRESH_REJECTED', 'User-token refresh was refused.');
  };

  const refreshAccessToken = (sub) => {
    const id = subSchema.safeParse(sub).data;
    if (id === undefined) {
      return Promise.reject(new UserTokenStoreError('USER_TOKEN_NO_REFRESH', 'No user-token pair to refresh.'));
    }
    const running = inFlightRefreshes.get(id);
    if (running) return running;
    const task = (async () => {
      const lock = await acquireRefreshLock();
      try {
        // Read through, then fall back to the working set only when the durable
        // write itself failed: presenting a superseded token reads as reuse.
        const held = readDurable(id) ?? live.get(id) ?? null;
        if (held === null || held.refreshToken === '') {
          throw new UserTokenStoreError('USER_TOKEN_NO_REFRESH', 'No user-token pair to refresh.');
        }
        return await presentRefresh(id, held.refreshToken, true);
      } finally {
        releaseRefreshLock(lock);
      }
    })();
    inFlightRefreshes.set(id, task);
    const settle = () => {
      if (inFlightRefreshes.get(id) === task) inFlightRefreshes.delete(id);
    };
    task.then(settle, settle);
    return task;
  };

  return {
    get,
    set,
    clear,
    refreshAccessToken,
    tier,
    isDurable,
  };
};

let sharedStore = null;

// The production instance shared by the desktop-login capture path and
// the TokenPanel quota proxy: one tier, one ciphertext file, so a pair
// stored at loopback completion is the pair the proxy presents.
export const sharedUserTokenStore = () => {
  sharedStore ??= createUserTokenStore();
  return sharedStore;
};
