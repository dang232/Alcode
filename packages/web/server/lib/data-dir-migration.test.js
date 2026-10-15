import { describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import fsPromises from 'fs/promises';

import { ensureChatsDir, migrateLegacyUserDirs } from './data-dir-migration.js';

const setup = async () => {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-data-dir-'));
  const legacyRoot = path.join(root, 'legacy');
  const dataDir = path.join(root, 'custom');
  await fsPromises.mkdir(path.join(legacyRoot, 'projects'), { recursive: true });
  await fsPromises.writeFile(path.join(legacyRoot, 'projects', 'p.json'), '{"a":1}');
  await fsPromises.mkdir(path.join(legacyRoot, 'themes'), { recursive: true });
  return { root, legacyRoot, dataDir, cleanup: () => fsPromises.rm(root, { recursive: true, force: true }) };
};

describe('migrateLegacyUserDirs', () => {
  it('copies the user folders once into a custom data dir and leaves the originals', async () => {
    const { legacyRoot, dataDir, cleanup } = await setup();
    try {
      const warnings = [];
      const moved = await migrateLegacyUserDirs({ fsPromises, path, dataDir, legacyRoot, warn: (message) => warnings.push(message) });
      expect(moved).toEqual(['projects', 'themes']);
      expect(warnings).toEqual([]);
      expect(await fsPromises.readFile(path.join(dataDir, 'projects', 'p.json'), 'utf8')).toBe('{"a":1}');
      // The default instance keeps its own copy: a second instance must not strip it.
      expect(await fsPromises.readFile(path.join(legacyRoot, 'projects', 'p.json'), 'utf8')).toBe('{"a":1}');
      // A second start copies nothing more.
      expect(await migrateLegacyUserDirs({ fsPromises, path, dataDir, legacyRoot })).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('never merges into a folder that already exists in the data dir', async () => {
    const { legacyRoot, dataDir, cleanup } = await setup();
    try {
      await fsPromises.mkdir(path.join(dataDir, 'projects'), { recursive: true });
      await fsPromises.writeFile(path.join(dataDir, 'projects', 'q.json'), '{}');
      const moved = await migrateLegacyUserDirs({ fsPromises, path, dataDir, legacyRoot });
      expect(moved).toEqual(['themes']);
      expect(await fsPromises.readdir(path.join(dataDir, 'projects'))).toEqual(['q.json']);
      expect(await fsPromises.readdir(path.join(legacyRoot, 'projects'))).toEqual(['p.json']);
    } finally {
      await cleanup();
    }
  });

  it('is a no-op when the data dir is the default root', async () => {
    const { legacyRoot, cleanup } = await setup();
    try {
      expect(await migrateLegacyUserDirs({ fsPromises, path, dataDir: legacyRoot, legacyRoot })).toEqual([]);
      expect(await fsPromises.readdir(path.join(legacyRoot, 'projects'))).toEqual(['p.json']);
    } finally {
      await cleanup();
    }
  });
});

describe('ensureChatsDir', () => {
  it('creates a missing chats folder, parents included, and leaves an existing one as it is', async () => {
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-chats-dir-'));
    try {
      const chatsDir = path.join(root, 'alcode', 'chats');
      expect(await ensureChatsDir({ fsPromises, chatsDir })).toBe(true);
      expect((await fsPromises.stat(chatsDir)).isDirectory()).toBe(true);

      await fsPromises.writeFile(path.join(chatsDir, 'keep.txt'), 'kept');
      expect(await ensureChatsDir({ fsPromises, chatsDir })).toBe(true);
      expect(await fsPromises.readFile(path.join(chatsDir, 'keep.txt'), 'utf8')).toBe('kept');
    } finally {
      await fsPromises.rm(root, { recursive: true, force: true });
    }
  });

  it('reports a folder it cannot create and does not throw', async () => {
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-chats-dir-'));
    try {
      // A file where a parent folder should be makes the folder impossible to create.
      await fsPromises.writeFile(path.join(root, 'alcode'), '');
      const warnings = [];
      const chatsDir = path.join(root, 'alcode', 'chats');
      expect(await ensureChatsDir({ fsPromises, chatsDir, warn: (message) => warnings.push(message) })).toBe(false);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(chatsDir);
    } finally {
      await fsPromises.rm(root, { recursive: true, force: true });
    }
  });
});

describe('migrateLegacyUserDirs from the pre-rename root', () => {
  const setupLegacyRoots = async () => {
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-data-dir-legacy-'));
    const defaultRoot = path.join(root, 'alcode');
    const legacyRoot = path.join(root, 'openchamber');
    const dataDir = path.join(root, 'custom');
    return { root, defaultRoot, legacyRoot, dataDir, cleanup: () => fsPromises.rm(root, { recursive: true, force: true }) };
  };

  it('copies missing entries from the legacy openchamber root and never deletes it', async () => {
    const { defaultRoot, legacyRoot, dataDir, cleanup } = await setupLegacyRoots();
    try {
      await fsPromises.mkdir(path.join(legacyRoot, 'chats'), { recursive: true });
      await fsPromises.writeFile(path.join(legacyRoot, 'chats', 'c.json'), '{"c":1}');
      await fsPromises.mkdir(path.join(legacyRoot, 'projects'), { recursive: true });
      await fsPromises.writeFile(path.join(legacyRoot, 'projects', 'p.json'), '{"a":1}');
      const warnings = [];
      const moved = await migrateLegacyUserDirs({
        fsPromises, path, dataDir, legacyRoots: [defaultRoot, legacyRoot], warn: (message) => warnings.push(message),
      });
      expect(moved).toEqual(['chats', 'projects']);
      expect(warnings).toEqual([]);
      expect(await fsPromises.readFile(path.join(dataDir, 'chats', 'c.json'), 'utf8')).toBe('{"c":1}');
      expect(await fsPromises.readFile(path.join(dataDir, 'projects', 'p.json'), 'utf8')).toBe('{"a":1}');
      // The legacy install keeps its own copy; a second start copies nothing more.
      expect(await fsPromises.readFile(path.join(legacyRoot, 'chats', 'c.json'), 'utf8')).toBe('{"c":1}');
      expect(await migrateLegacyUserDirs({ fsPromises, path, dataDir, legacyRoots: [defaultRoot, legacyRoot] })).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('prefers the newer root when both roots hold the same entry', async () => {
    const { defaultRoot, legacyRoot, dataDir, cleanup } = await setupLegacyRoots();
    try {
      await fsPromises.mkdir(path.join(defaultRoot, 'projects'), { recursive: true });
      await fsPromises.writeFile(path.join(defaultRoot, 'projects', 'new.json'), '{}');
      await fsPromises.mkdir(path.join(legacyRoot, 'projects'), { recursive: true });
      await fsPromises.writeFile(path.join(legacyRoot, 'projects', 'old.json'), '{}');
      const moved = await migrateLegacyUserDirs({ fsPromises, path, dataDir, legacyRoots: [defaultRoot, legacyRoot] });
      expect(moved).toEqual(['projects']);
      expect(await fsPromises.readdir(path.join(dataDir, 'projects'))).toEqual(['new.json']);
    } finally {
      await cleanup();
    }
  });

  it('skips roots equal to the data dir but still reads the legacy root', async () => {
    const { defaultRoot, legacyRoot, cleanup } = await setupLegacyRoots();
    try {
      await fsPromises.mkdir(path.join(legacyRoot, 'themes'), { recursive: true });
      await fsPromises.writeFile(path.join(legacyRoot, 'themes', 't.json'), '{}');
      const moved = await migrateLegacyUserDirs({
        fsPromises, path, dataDir: defaultRoot, legacyRoots: [defaultRoot, legacyRoot],
      });
      expect(moved).toEqual(['themes']);
      expect(await fsPromises.readFile(path.join(defaultRoot, 'themes', 't.json'), 'utf8')).toBe('{}');
      expect(await fsPromises.readFile(path.join(legacyRoot, 'themes', 't.json'), 'utf8')).toBe('{}');
    } finally {
      await cleanup();
    }
  });
});
