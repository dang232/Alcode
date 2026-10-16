// One-time copy of the user-authored folders and flat files into a custom data
// directory.
//
// `ALCODE_DATA_DIR` is documented as "the Alcode data directory",
// but for a long time only the flat files (settings, auth, push tokens)
// followed it while `projects/`, `themes/`, and `speech-models/` stayed under
// `~/.config/alcode`. Now every folder hangs off the data directory, so an
// instance that already ran with a custom directory finds those folders in
// the old place. This copies each one over once: only when the new location
// does not exist yet and the old one does. It copies rather than moves
// because a second instance on the same machine (a custom directory next to
// the default one) must not strip the default instance of its projects.
//
// The same copy covers the pre-rename `~/.config/openchamber` root: entries
// missing from every newer root are copied from the legacy one, which is
// likewise never deleted.

const USER_DIR_ENTRIES = Object.freeze(['chats', 'projects', 'themes', 'speech-models', 'logs', 'run']);

/** Flat files that live directly under the data root (settings, auth, push
 * tokens, tunnel state, prompts). Copied with the same copy-if-missing rules
 * as folders. Lock/pid/log files are deliberately absent: they are recreated
 * every run and must never resurrect stale state. */
const USER_DIR_FLAT_FILES = Object.freeze([
  'settings.json',
  'push-subscriptions.json',
  'apns-tokens.json',
  'remote-clients.json',
  'client-pairing-sessions.json',
  'cloudflare-managed-remote-tunnels.json',
  'cloudflare-named-tunnels.json',
  'git-worktree-bootstrap.json',
  'tunnel-profiles.json',
  'tunnel-cli-state.json',
  'magic-prompts.json',
]);

const exists = async (fsPromises, target) => fsPromises.access(target).then(() => true, () => false);

/**
 * Copy the user folders from the legacy roots into `dataDir`. Returns the
 * entries copied. `legacyRoots` lists every older root, oldest migration
 * first: the default `~/.config/alcode` root, then the pre-rename
 * `~/.config/openchamber` root. `legacyRoot` stays as the single-root
 * shorthand. A root equal to `dataDir` is skipped, so this is a no-op when
 * every root is the data directory itself. Each entry is copied from the
 * first root that has it, only when the new location does not exist yet. A
 * folder whose copy fails is reported through `warn` and its partial copy
 * removed; the server keeps starting, reading the (empty) new location.
 */
export const migrateLegacyUserDirs = async ({ fsPromises, path, dataDir, legacyRoot, legacyRoots, warn = () => {}, entries = USER_DIR_ENTRIES, flatFiles = USER_DIR_FLAT_FILES }) => {
  const roots = (Array.isArray(legacyRoots) && legacyRoots.length > 0 ? legacyRoots : [legacyRoot])
    .filter((root) => typeof root === 'string' && root.length > 0)
    .filter((root) => path.resolve(root) !== path.resolve(dataDir));
  if (roots.length === 0) return [];
  const moved = [];
  const copyOnce = async (from, to) => {
    try {
      await fsPromises.mkdir(dataDir, { recursive: true });
      await fsPromises.cp(from, to, { recursive: true, errorOnExist: true, force: false });
      moved.push(path.basename(to));
    } catch (error) {
      await fsPromises.rm(to, { recursive: true, force: true }).catch(() => {});
      warn(`Failed to copy ${from} to ${to}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  for (const entry of entries) {
    const to = path.join(dataDir, entry);
    if (await exists(fsPromises, to)) continue;
    let from = null;
    for (const root of roots) {
      const candidate = path.join(root, entry);
      if (await exists(fsPromises, candidate)) {
        from = candidate;
        break;
      }
    }
    if (from === null) continue;
    await copyOnce(from, to);
  }
  for (const file of flatFiles) {
    const to = path.join(dataDir, file);
    if (await exists(fsPromises, to)) continue;
    let from = null;
    for (const root of roots) {
      const candidate = path.join(root, file);
      if (await exists(fsPromises, candidate)) {
        from = candidate;
        break;
      }
    }
    if (from === null) continue;
    await copyOnce(from, to);
  }
  return moved;
};

/**
 * Create the managed chats folder if it is missing. The UI reads it as soon as
 * a new chat opens, and OpenCode answers every read of a missing folder with
 * an error, which the sidebar showed as "Could not initialize workspace" on a
 * fresh install until the first chat happened to create it. A folder that
 * cannot be created (a relocated root this user cannot write) is reported
 * through `warn` and the server keeps starting. Returns whether it exists now.
 */
export const ensureChatsDir = async ({ fsPromises, chatsDir, warn = () => {} }) => {
  try {
    await fsPromises.mkdir(chatsDir, { recursive: true });
    return true;
  } catch (error) {
    warn(`Could not create the chats folder ${chatsDir}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
};
