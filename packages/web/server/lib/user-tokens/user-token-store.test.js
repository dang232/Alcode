import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createUserTokenStore,
  UserTokenStoreError,
} from './user-token-store.js';

// The store holds the login-captured pair (access JWT + opaque refresh
// token) behind a seam shaped EXACTLY like Electron safeStorage, so these
// fakes stand where the OS keychain stands in production. The fake cipher
// is a tagged prefix, not encryption: assertions check that the persisted
// form passed through the keychain (never the raw token assignment) and
// that a foreign key cannot decrypt — real secrecy comes from safeStorage
// on the desktop runtime, which plain-Node tests cannot reach.
const fakeKeychain = (secret = 'k1') => {
  const calls = { encrypt: 0, decrypt: 0 };
  return {
    calls,
    isEncryptionAvailable: () => true,
    encryptString: (plain) => {
      calls.encrypt += 1;
      return Buffer.from(`enc:${secret}:${plain}`, 'utf8');
    },
    decryptString: (buffer) => {
      calls.decrypt += 1;
      const text = Buffer.from(buffer).toString('utf8');
      const prefix = `enc:${secret}:`;
      if (!text.startsWith(prefix)) throw new Error('decrypt failed');
      return text.slice(prefix.length);
    },
  };
};

const lockedKeychain = () => ({
  isEncryptionAvailable: () => false,
  encryptString: () => { throw new Error('must not be called'); },
  decryptString: () => { throw new Error('must not be called'); },
});

const jsonResponse = (status, data) => ({ status, json: async () => data });

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alcode-user-tokens-'));

// Distinctive fixture secrets: the downgrade-warning test asserts the
// warning carries none of this material (not the token, not a fragment,
// not its length), so these must stay unique strings.
const FIXTURE_ACCESS = 'fixture-access-token-9f8e7d6c5b4a';
const FIXTURE_REFRESH = 'fixture-refresh-token-1a2b3c4d5e6f';

const captureWarns = () => {
  const messages = [];
  const original = console.warn;
  console.warn = (...args) => {
    messages.push(args.map((part) => String(part)).join(' '));
  };
  return { messages, restore: () => { console.warn = original; } };
};

describe('user-token credential store tiers', () => {
  test('tier selection: keychain via the fake seam, encrypted-file via temp dir, memory', async () => {
    const { messages, restore } = captureWarns();
    try {
      const dir = tempDir();
      try {
        const keychainStore = createUserTokenStore({ keychain: fakeKeychain(), dataDir: dir });
        expect(keychainStore.tier).toBe('keychain');
        expect(keychainStore.isDurable()).toBe(true);

        const fileStore = createUserTokenStore({ tier: 'encrypted-file', dataDir: dir });
        expect(fileStore.tier).toBe('encrypted-file');
        expect(fileStore.isDurable()).toBe(true);

        const memoryStore = createUserTokenStore({ tier: 'memory' });
        expect(memoryStore.tier).toBe('memory');
        expect(memoryStore.isDurable()).toBe(false);

        for (const store of [keychainStore, fileStore, memoryStore]) {
          expect(typeof store.get).toBe('function');
          expect(typeof store.set).toBe('function');
          expect(typeof store.clear).toBe('function');
          expect(typeof store.refreshAccessToken).toBe('function');
          expect(typeof store.isDurable).toBe('function');
        }
        // Explicit selection is not a downgrade: no warnings.
        expect(messages).toHaveLength(0);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      restore();
    }
  });

  test('downgrade from keychain warns exactly once with no token material', async () => {
    const { messages, restore } = captureWarns();
    try {
      const dir = tempDir();
      try {
        const store = createUserTokenStore({ keychain: null, dataDir: dir });
        expect(store.tier).toBe('encrypted-file');
        expect(store.isDurable()).toBe(true);

        // The downgraded store still serves get/set/clear after warning.
        await store.set('user-1', { accessToken: FIXTURE_ACCESS, refreshToken: FIXTURE_REFRESH });
        expect(await store.get('user-1')).toEqual({
          accessToken: FIXTURE_ACCESS,
          refreshToken: FIXTURE_REFRESH,
          updatedAt: expect.any(Number),
        });
        await store.clear('user-1');
        expect(await store.get('user-1')).toBeNull();

        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain('encrypted-file');
        expect(messages[0]).not.toContain(FIXTURE_ACCESS);
        expect(messages[0]).not.toContain(FIXTURE_REFRESH);
        expect(messages[0]).not.toContain(FIXTURE_ACCESS.slice(0, 8));
        expect(messages[0]).not.toContain(String(FIXTURE_ACCESS.length));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      restore();
    }
  });

  test('double downgrade to memory warns exactly once and names memory', async () => {
    const { messages, restore } = captureWarns();
    try {
      const dir = tempDir();
      try {
        // A dataDir that is an existing file: neither the key file nor the
        // ciphertext file can be created beneath it.
        const fileAsDir = path.join(dir, 'not-a-dir');
        fs.writeFileSync(fileAsDir, 'x');
        const store = createUserTokenStore({ keychain: null, dataDir: fileAsDir });
        expect(store.tier).toBe('memory');
        expect(store.isDurable()).toBe(false);
        await store.set('user-1', { accessToken: FIXTURE_ACCESS, refreshToken: FIXTURE_REFRESH });
        expect(await store.get('user-1')).toEqual({
          accessToken: FIXTURE_ACCESS,
          refreshToken: FIXTURE_REFRESH,
          updatedAt: expect.any(Number),
        });
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain('memory');
        expect(messages[0]).not.toContain(FIXTURE_ACCESS);
        expect(messages[0]).not.toContain(FIXTURE_REFRESH);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      restore();
    }
  });

  test('keychain tier round-trips get/set/clear and never persists plaintext', async () => {
    const keychain = fakeKeychain();
    const dir = tempDir();
    try {
      const filePath = path.join(dir, 'user-tokens.json');
      const store = createUserTokenStore({ keychain, dataFilePath: filePath });
      expect(store.tier).toBe('keychain');
      await store.set('user-1', { accessToken: 'access-abc', refreshToken: 'refresh-xyz' });
      expect(keychain.calls.encrypt).toBe(2);
      expect(await store.get('user-1')).toEqual({
        accessToken: 'access-abc',
        refreshToken: 'refresh-xyz',
        updatedAt: expect.any(Number),
      });
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(Object.keys(raw.entries)).toEqual(['user-1']);
      expect(fs.readFileSync(filePath, 'utf8')).not.toContain('access-abc');
      // POSIX-only: Windows does not honor the 0o600 mode bits.
      if (process.platform !== 'win32') {
        expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
      }
      await store.clear('user-1');
      expect(await store.get('user-1')).toBeNull();
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).entries['user-1']).toBeUndefined();
      expect(store.tier).toBe('keychain');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('encrypted-file tier survives a restart through a real temp dir', async () => {
    const dir = tempDir();
    try {
      const first = createUserTokenStore({ tier: 'encrypted-file', dataDir: dir });
      await first.set('user-9', { accessToken: 'restart-access', refreshToken: 'restart-refresh' });
      const cipherPath = path.join(dir, 'user-tokens.json');
      const keyPath = path.join(dir, 'user-tokens.key');
      expect(fs.existsSync(cipherPath)).toBe(true);
      expect(fs.existsSync(keyPath)).toBe(true);
      expect(fs.readFileSync(keyPath).length).toBe(32);
      const onDisk = fs.readFileSync(cipherPath, 'utf8');
      expect(onDisk).not.toContain('restart-access');
      expect(onDisk).not.toContain('restart-refresh');
      // Persisted entries stay keyed by subject.
      expect(Object.keys(JSON.parse(onDisk).entries)).toEqual(['user-9']);
      // POSIX-only: Windows does not honor the 0o600 mode bits.
      if (process.platform !== 'win32') {
        expect(fs.statSync(cipherPath).mode & 0o777).toBe(0o600);
        expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
      }
      // Fresh instance, empty memory: the pair comes back from ciphertext.
      const second = createUserTokenStore({ tier: 'encrypted-file', dataDir: dir });
      expect(second.tier).toBe('encrypted-file');
      expect(await second.get('user-9')).toEqual({
        accessToken: 'restart-access',
        refreshToken: 'restart-refresh',
        updatedAt: expect.any(Number),
      });
      await second.clear('user-9');
      expect(await second.get('user-9')).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('memory tier serves the process and touches no disk', async () => {
    const dir = tempDir();
    try {
      const store = createUserTokenStore({ tier: 'memory', dataDir: dir });
      await store.set('user-1', { accessToken: 'mem-only', refreshToken: 'mem-refresh' });
      expect(await store.get('user-1')).toEqual({
        accessToken: 'mem-only',
        refreshToken: 'mem-refresh',
        updatedAt: expect.any(Number),
      });
      await store.clear('user-1');
      expect(await store.get('user-1')).toBeNull();
      expect(fs.readdirSync(dir)).toEqual([]);
      // A fresh instance starts empty: memory does not survive a restart.
      expect(await createUserTokenStore({ tier: 'memory' }).get('user-1')).toBeNull();
      expect(store.tier).toBe('memory');
      expect(store.isDurable()).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a locked keychain seam downgrades to encrypted-file with one warning', async () => {
    const dir = tempDir();
    try {
      const filePath = path.join(dir, 'user-tokens.json');
      const { messages, restore } = captureWarns();
      try {
        const store = createUserTokenStore({ keychain: lockedKeychain(), dataFilePath: filePath });
        expect(store.tier).toBe('encrypted-file');
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain('encrypted-file');
      } finally {
        restore();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a foreign key cannot decrypt: entry drops to signed-out', async () => {
    const dir = tempDir();
    try {
      const filePath = path.join(dir, 'user-tokens.json');
      await createUserTokenStore({ keychain: fakeKeychain('k1'), dataFilePath: filePath })
        .set('user-1', { accessToken: 'a1', refreshToken: 'r1' });
      const foreign = createUserTokenStore({ keychain: fakeKeychain('k2'), dataFilePath: filePath });
      expect(await foreign.get('user-1')).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('set preserves a valid updatedAt and stamps one otherwise', async () => {
    const store = createUserTokenStore({ tier: 'memory' });
    await store.set('user-1', { accessToken: 'a', refreshToken: 'r', updatedAt: 1234567890 });
    expect(await store.get('user-1')).toEqual({ accessToken: 'a', refreshToken: 'r', updatedAt: 1234567890 });
    await store.set('user-2', { accessToken: 'a', refreshToken: 'r' });
    const read = await store.get('user-2');
    expect(typeof read.updatedAt).toBe('number');
  });

  test('an unknown subject reads as signed-out, invalid pairs throw without storing', async () => {
    const store = createUserTokenStore({ tier: 'memory' });
    expect(await store.get('nobody')).toBeNull();
    expect(await store.get('')).toBeNull();
    expect(await store.get(null)).toBeNull();
    await store.clear('');
    await store.clear('nobody');
    for (const [sub, pair] of [
      ['', { accessToken: 'a', refreshToken: 'r' }],
      ['user-1', { accessToken: '', refreshToken: 'r' }],
      ['user-1', { refreshToken: 'r' }],
      ['user-1', { accessToken: 'a', refreshToken: 42 }],
    ]) {
      const settled = await store.set(sub, pair).then(() => 'stored', (error) => error);
      expect(settled).toBeInstanceOf(UserTokenStoreError);
      expect(settled.code).toBe('USER_TOKEN_INVALID');
    }
    expect(await store.get('user-1')).toBeNull();
  });

  test('an access-only pair stores with an empty refresh slot', async () => {
    const store = createUserTokenStore({ tier: 'memory' });
    await store.set('user-1', { accessToken: 'access-only' });
    expect(await store.get('user-1')).toEqual({
      accessToken: 'access-only',
      refreshToken: '',
      updatedAt: expect.any(Number),
    });
  });

  test('refresh rotates the pair through the auth-service endpoint', async () => {
    const seen = [];
    const store = createUserTokenStore({
      tier: 'memory',
      serviceBase: 'https://auth.test',
      serviceFetch: async (url, init) => {
        seen.push({ url, init });
        expect(url).toBe('https://auth.test/auth/token/refresh');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ refresh_token: 'refresh-old' });
        expect(url).not.toContain('refresh-old');
        return jsonResponse(200, { access_token: 'access-new', refresh_token: 'refresh-new' });
      },
    });
    await store.set('user-1', { accessToken: 'access-old', refreshToken: 'refresh-old' });
    const rotated = await store.refreshAccessToken('user-1');
    expect(rotated).toBe('access-new');
    expect(seen).toHaveLength(1);
    expect(await store.get('user-1')).toEqual({
      accessToken: 'access-new',
      refreshToken: 'refresh-new',
      updatedAt: expect.any(Number),
    });
  });

  test('refresh keeps the old refresh value when the service omits rotation', async () => {
    const store = createUserTokenStore({
      tier: 'memory',
      serviceBase: 'https://auth.test/',
      serviceFetch: async () => jsonResponse(200, { access_token: 'access-new' }),
    });
    await store.set('user-1', { accessToken: 'access-old', refreshToken: 'refresh-old' });
    expect(await store.refreshAccessToken('user-1')).toBe('access-new');
    expect(await store.get('user-1')).toEqual({
      accessToken: 'access-new',
      refreshToken: 'refresh-old',
      updatedAt: expect.any(Number),
    });
  });

  test('refresh failures are named: refused, transient, or nothing to rotate', async () => {
    const storeFor = (serviceFetch) => createUserTokenStore({
      tier: 'memory',
      serviceBase: 'https://auth.test',
      serviceFetch,
    });

    const refused = storeFor(async () => jsonResponse(401, { error: 'invalid_grant' }));
    await refused.set('user-1', { accessToken: 'a', refreshToken: 'r' });
    await expect(refused.refreshAccessToken('user-1')).rejects.toMatchObject({ code: 'USER_TOKEN_REFRESH_REJECTED' });

    const malformed = storeFor(async () => jsonResponse(200, { access_token: '' }));
    await malformed.set('user-1', { accessToken: 'a', refreshToken: 'r' });
    await expect(malformed.refreshAccessToken('user-1')).rejects.toMatchObject({ code: 'USER_TOKEN_REFRESH_REJECTED' });

    for (const transient of [
      storeFor(async () => jsonResponse(503, { error: 'busy' })),
      storeFor(async () => jsonResponse(429, { error: 'slow' })),
      storeFor(async () => { throw new Error('down'); }),
    ]) {
      await transient.set('user-1', { accessToken: 'a', refreshToken: 'r' });
      await expect(transient.refreshAccessToken('user-1')).rejects.toMatchObject({ code: 'USER_TOKEN_REFRESH_TRANSIENT' });
    }

    const bare = storeFor(async () => { throw new Error('must not be called'); });
    await bare.set('user-1', { accessToken: 'access-only' });
    await expect(bare.refreshAccessToken('user-1')).rejects.toMatchObject({ code: 'USER_TOKEN_NO_REFRESH' });
    await expect(bare.refreshAccessToken('ghost')).rejects.toMatchObject({ code: 'USER_TOKEN_NO_REFRESH' });
    await expect(bare.refreshAccessToken('')).rejects.toMatchObject({ code: 'USER_TOKEN_NO_REFRESH' });
  });

  test('concurrent refreshes for one subject share a single upstream POST', async () => {
    let postCount = 0;
    let releaseGate = () => {};
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    const store = createUserTokenStore({
      tier: 'memory',
      serviceBase: 'https://auth.test',
      serviceFetch: async () => {
        postCount += 1;
        await gate;
        return jsonResponse(200, { access_token: 'access-rotated', refresh_token: 'refresh-rotated' });
      },
    });
    await store.set('user-1', { accessToken: 'access-old', refreshToken: 'refresh-old' });
    const first = store.refreshAccessToken('user-1');
    const second = store.refreshAccessToken('user-1');
    releaseGate();
    const [rotatedA, rotatedB] = await Promise.all([first, second]);
    expect(rotatedA).toBe('access-rotated');
    expect(rotatedB).toBe('access-rotated');
    expect(postCount).toBe(1);
    expect(await store.get('user-1')).toEqual({
      accessToken: 'access-rotated',
      refreshToken: 'refresh-rotated',
      updatedAt: expect.any(Number),
    });
  });

  test('a concurrent failing pair rejects together on one upstream POST', async () => {
    let postCount = 0;
    let releaseGate = () => {};
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    const store = createUserTokenStore({
      tier: 'memory',
      serviceBase: 'https://auth.test',
      serviceFetch: async () => {
        postCount += 1;
        await gate;
        return jsonResponse(401, { error: 'invalid_grant' });
      },
    });
    await store.set('user-1', { accessToken: 'access-old', refreshToken: 'refresh-old' });
    const first = store.refreshAccessToken('user-1');
    const second = store.refreshAccessToken('user-1');
    releaseGate();
    const settled = await Promise.allSettled([first, second]);
    expect(settled[0].status).toBe('rejected');
    expect(settled[1].status).toBe('rejected');
    expect(settled[0].reason).toMatchObject({ code: 'USER_TOKEN_REFRESH_REJECTED' });
    expect(settled[1].reason).toMatchObject({ code: 'USER_TOKEN_REFRESH_REJECTED' });
    expect(settled[1].reason.message).toBe(settled[0].reason.message);
    expect(postCount).toBe(1);
    expect(await store.get('user-1')).toBeNull();
  });

  test('a retry after a settled refresh uses the rotated refresh token', async () => {
    const bodies = [];
    const store = createUserTokenStore({
      tier: 'memory',
      serviceBase: 'https://auth.test',
      serviceFetch: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        if (bodies.length === 1) {
          return jsonResponse(200, { access_token: 'access-two', refresh_token: 'refresh-two' });
        }
        return jsonResponse(200, { access_token: 'access-three', refresh_token: 'refresh-three' });
      },
    });
    await store.set('user-1', { accessToken: 'access-one', refreshToken: 'refresh-one' });
    expect(await store.refreshAccessToken('user-1')).toBe('access-two');
    expect(await store.refreshAccessToken('user-1')).toBe('access-three');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual({ refresh_token: 'refresh-one' });
    expect(bodies[1]).toEqual({ refresh_token: 'refresh-two' });
    expect(bodies[1].refresh_token).not.toBe('refresh-one');
    expect(await store.get('user-1')).toEqual({
      accessToken: 'access-three',
      refreshToken: 'refresh-three',
      updatedAt: expect.any(Number),
    });
  });

  test('the rotated pair survives a restart through the durable tier', async () => {
    const dir = tempDir();
    try {
      let postCount = 0;
      const first = createUserTokenStore({
        tier: 'encrypted-file',
        dataDir: dir,
        serviceBase: 'https://auth.test',
        serviceFetch: async () => {
          postCount += 1;
          return jsonResponse(200, { access_token: 'access-rotated', refresh_token: 'refresh-rotated' });
        },
      });
      await first.set('user-1', { accessToken: 'access-old', refreshToken: 'refresh-old' });
      expect(await first.refreshAccessToken('user-1')).toBe('access-rotated');
      expect(postCount).toBe(1);
      const second = createUserTokenStore({ tier: 'encrypted-file', dataDir: dir });
      expect(await second.get('user-1')).toEqual({
        accessToken: 'access-rotated',
        refreshToken: 'refresh-rotated',
        updatedAt: expect.any(Number),
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
