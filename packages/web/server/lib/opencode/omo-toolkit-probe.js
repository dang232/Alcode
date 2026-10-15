// Bounded outer-toolkit probe (spawn-site NO-SITE fix).
//
// The stuck run hunted the outer `omo-agent-toolkit` binary with a
// drive-wide recurse. This helper replaces that hunt with a short bounded
// candidate list answered fast: `OMO_TOOLKIT_PATH` override first, else the
// first `omo-agent-toolkit` found by scanning PATH — then a single
// `--version` handshake under a short `spawnSync` timeout. It never walks a
// drive, never recurses, never throws: a missing toolkit answers the exact
// degraded object (fails closed).
import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { existsSync as nodeExistsSync } from 'node:fs';
import { join as nodeJoinPath } from 'node:path';

export const OMO_TOOLKIT_PATH_ENV = 'OMO_TOOLKIT_PATH';
export const OMO_TOOLKIT_BINARY = 'omo-agent-toolkit';
// Short timeout: the missing-toolkit path must answer fast, never hang.
export const OMO_TOOLKIT_PROBE_TIMEOUT_MS = 2000;
// Hard bound on the candidate list: override + first PATH hit at most.
export const OMO_TOOLKIT_MAX_CANDIDATES = 2;

export const toolkitAbsentMessage = (entry) => (
  `OmO toolkit not found${entry ? ` at "${entry}"` : ''}. `
  + 'The loop status stays degraded: install the OmO toolkit yourself with your '
  + 'own download (nothing is fetched automatically), then point OMO_TOOLKIT_PATH '
  + 'at its omo-agent-toolkit binary and retry.'
);

const isNonEmptyString = (value) => (value?.trim?.() ?? '').length > 0;

const firstVersionToken = (text) => {
  const match = /v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(String(text ?? ''));
  return match ? match[1] : null;
};

// Short bounded candidate list: at most one explicit override plus the
// first PATH hit. Only `existsSync` joins of PATH entries — no readdir, no
// recursion, no drive-wide walk. Returns `{ candidates, attempted }` where
// `attempted` names the override even when it does not resolve (so the
// degraded message can name it) and `candidates` holds at most
// OMO_TOOLKIT_MAX_CANDIDATES existing paths.
export const resolveToolkitCandidates = ({
  env = process.env,
  existsSync = nodeExistsSync,
  pathValue,
  platform = process.platform,
  joinPath = nodeJoinPath,
} = {}) => {
  const candidates = [];
  let attempted = null;
  const override = env?.[OMO_TOOLKIT_PATH_ENV]?.trim?.() ?? '';
  if (override !== '') {
    attempted = override;
    try {
      if (existsSync(override)) candidates.push(override);
    } catch {
      // A broken existsSync fails closed: no candidate from the override.
    }
  }
  if (candidates.length >= OMO_TOOLKIT_MAX_CANDIDATES) {
    return { candidates, attempted };
  }
  const rawPath = pathValue !== undefined ? pathValue : (env?.PATH ?? env?.Path ?? '');
  const delimiter = platform === 'win32' ? ';' : ':';
  const extensions = platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const dir of String(rawPath ?? '').split(delimiter)) {
    if (candidates.length >= OMO_TOOLKIT_MAX_CANDIDATES) break;
    const trimmed = dir.trim().replace(/^"|"$/g, '');
    if (trimmed === '') continue;
    for (const ext of extensions) {
      const candidate = joinPath(trimmed, `${OMO_TOOLKIT_BINARY}${ext}`);
      let found = false;
      try {
        found = existsSync(candidate);
      } catch {
        found = false;
      }
      if (found) {
        candidates.push(candidate);
        break;
      }
    }
    if (candidates.length > 0) break;
  }
  return { candidates: candidates.slice(0, OMO_TOOLKIT_MAX_CANDIDATES), attempted };
};

// Bounded probe: checks the short candidate list with a short timeout and
// fails closed. Never throws, never walks a drive. Shapes:
//   ok      `{ available: true, compatible: true, code: 'OMO_TOOLKIT_OK', entry, version }`
//   absent  `{ available: false, compatible: false, code: 'OMO_TOOLKIT_ABSENT', entry, message }`
//   timeout `{ available: false, compatible: false, code: 'OMO_TOOLKIT_TIMEOUT', entry, message }`
//   broken  `{ available: false, compatible: false, code: 'OMO_TOOLKIT_SPAWN_FAILED', entry, message }`
export const probeToolkit = ({
  timeoutMs = OMO_TOOLKIT_PROBE_TIMEOUT_MS,
  existsSync = nodeExistsSync,
  spawnSync = nodeSpawnSync,
  env = process.env,
  pathValue,
  platform = process.platform,
  joinPath = nodeJoinPath,
} = {}) => {
  try {
    const { candidates, attempted } = resolveToolkitCandidates({
      env, existsSync, pathValue, platform, joinPath,
    });
    if (candidates.length === 0) {
      return {
        available: false,
        compatible: false,
        code: 'OMO_TOOLKIT_ABSENT',
        entry: attempted,
        message: toolkitAbsentMessage(attempted),
      };
    }
    const entry = candidates[0];
    let completed;
    try {
      completed = spawnSync(entry, ['--version'], {
        timeout: timeoutMs,
        encoding: 'utf8',
        windowsHide: true,
      });
    } catch (error) {
      return {
        available: false,
        compatible: false,
        code: 'OMO_TOOLKIT_SPAWN_FAILED',
        entry,
        message: `OmO toolkit at "${entry}" could not be started: ${error?.message ?? error}.`,
      };
    }
    if (completed?.error?.code === 'ETIMEDOUT') {
      return {
        available: false,
        compatible: false,
        code: 'OMO_TOOLKIT_TIMEOUT',
        entry,
        message: `OmO toolkit at "${entry}" did not answer --version within ${timeoutMs}ms.`,
      };
    }
    const stdout = String(completed?.stdout ?? '');
    if (completed?.status !== 0) {
      return {
        available: false,
        compatible: false,
        code: 'OMO_TOOLKIT_SPAWN_FAILED',
        entry,
        message: `OmO toolkit at "${entry}" exited with code ${completed?.status ?? 'unknown'} on --version.`,
      };
    }
    return {
      available: true,
      compatible: true,
      code: 'OMO_TOOLKIT_OK',
      entry,
      version: firstVersionToken(stdout),
    };
  } catch (error) {
    return {
      available: false,
      compatible: false,
      code: 'OMO_TOOLKIT_ABSENT',
      entry: null,
      message: toolkitAbsentMessage(null),
    };
  }
};
