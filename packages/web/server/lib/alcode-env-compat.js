// Backward compatibility for the OpenChamber -> Alcode rename.
//
// Older installs, scripts, and service files set `OPENCHAMBER_*` environment
// variables. The server and CLI now read `ALCODE_*`. On import, every legacy
// variable below is forwarded to its new name when the new name is unset, so
// a legacy-only environment keeps working without editing anything.
//
// Rules:
// - The new name always wins. Nothing is overwritten and nothing is deleted.
// - A blank value counts as unset on both sides.
// - Each forwarded key warns exactly once, on stderr, naming the key but
//   never its value (values may be secrets).
// - This module has no dependencies and performs no I/O besides the warning,
//   so entrypoints can import it before anything else reads the environment.

const LEGACY_PREFIX = 'OPENCHAMBER_';
const CURRENT_PREFIX = 'ALCODE_';

// Suffixes of the single-source `ALCODE_*` variables the server and CLI read.
// Kept as suffixes so the pairing is mechanical: OPENCHAMBER_X -> ALCODE_X.
const COMPAT_SUFFIXES = Object.freeze([
  // Core server surface.
  'DATA_DIR',
  'CHATS_DIR',
  'HOST',
  'PORT',
  'RUNTIME',
  'API_ONLY',
  'API_PREFIX',
  'UI_PASSWORD',
  'UI_SESSION_TTL_HOURS',
  'UI_TRUSTED_SESSION_TTL_DAYS',
  'PUBLIC_ORIGIN',
  'COMPRESS_API',
  'SKIP_API_COMPRESSION',
  'SKIP_DESKTOP_CALLBACK',
  'SKIP_OPENCODE_START',
  'VERBOSE_REQUEST_LOGS',
  'DEV_SHUTDOWN',
  'STARTUP_PERF',
  'DIST_DIR',
  // Private relay.
  'RELAY_URL',
  'RELAY_HOST',
  'RELAY_BATCH_WINDOW_MS',
  // Tunnels.
  'TUNNEL_PROVIDER',
  'TUNNEL_MODE',
  'TUNNEL_CONFIG',
  'TUNNEL_TOKEN',
  'TUNNEL_HOSTNAME',
  'TRY_CF_TUNNEL',
  // Jev classification endpoint.
  'JEV_URL',
  'JEV_MODEL',
  'JEV_API_KEY',
  // Access and origin gates.
  'ALLOW_DEV_ORIGINS',
  'ALLOW_NETWORK_ACCESS',
  'ALLOW_UNAUTHENTICATED_LAN',
  'ALLOW_REMOTE_OPENAI_COMPAT_URLS',
  'ALLOWED_EXTENSIONS',
  'ALLOW_LOCAL_EXTENSIONS',
  // Enterprise mode.
  'ENTERPRISE_MODE',
  // Service control plane.
  'SERVICE_PORT',
  'SERVICE_TOKEN',
  'SERVICE_SOCKETS',
  // Filesystem tunables.
  'FS_EXEC_TIMEOUT_MS',
  'FS_UPLOAD_MAX_BYTES',
  'GUEST_UPLOAD_MAX_BYTES',
  // Git tunables.
  'GIT_BINARY',
  'GIT_CHECK_IGNORE_TIMEOUT_MS',
  'GIT_READ_CACHE_TTL_MS',
  'GIT_SSH_KEY',
  'GIT_CREDENTIAL_NONCE',
  // Login rate limits.
  'RATE_LIMIT_MAX_ATTEMPTS',
  'RATE_LIMIT_NO_IP_MAX_ATTEMPTS',
  // OAuth client registrations.
  'GITHUB_CLIENT_ID',
  'GITHUB_SCOPES',
  'GITLAB_CLIENT_ID',
  'LINEAR_CLIENT_ID',
  'LINEAR_CLIENT_SECRET',
  'LINEAR_REDIRECT_URI',
  'LINEAR_SCOPES',
  'LINEAR_BROKER_URL',
  // Push notifications (APNs direct send).
  'APNS_KEY_ID',
  'APNS_TEAM_ID',
  'APNS_BUNDLE_ID',
  'APNS_P8',
  'APNS_P8_PATH',
  'APNS_ENVIRONMENT',
  'VAPID_SUBJECT',
  'PUSH_RELAY_URL',
  'PUSH_RELAY_DISABLED',
  // Managed/external OpenCode lifecycle.
  'OPENCODE_PORT',
  'OPENCODE_HOSTNAME',
  'OPENCODE_PATH',
  'OPENCODE_BIN',
  'OPENCODE_CWD',
  'OPENCODE_HEALTH_CACHE_MS',
  'OPENCODE_HEALTH_CONSECUTIVE_FAILURES',
  'OPENCODE_HEALTH_INTERVAL_MS',
  'OPENCODE_HEALTH_TIMEOUT_MS',
  'INTERNAL_PORT',
  'BUN_BINARY',
  'NODE_BINARY',
  'WSL_BINARY',
  'BUNDLED_OPENCODE_CLI_DIR',
  'PACKAGE_MANAGER',
  'TERMINAL_SHELL',
  // Service managers.
  'SYSTEMD_UNIT',
  // Desktop and dev shells.
  'DESKTOP_NOTIFY',
  'DESKTOP_LAN_ACCESS_ACTIVE',
  'DESKTOP_LAN_ACCESS_BLOCKED_REASON',
  'ELECTRON_DEV',
  'LAN_URL',
  // Runtime features.
  'MEMORY_ENABLE',
  'AGENT_TOOL_TOKEN',
  'AGENT_TOOL_URL',
  'MANAGED_PROCESS_REGISTRY',
  'SPACE_IDLE_STOP_FILE',
  'EVENT_DELTA_COALESCE_MS',
  'FRAME_ANCESTORS',
  'UPDATE_API_URL',
]);

/** `[legacyName, currentName]` pairs, in forwarding order. */
export const LEGACY_ENV_ALIASES = Object.freeze(
  COMPAT_SUFFIXES.map((suffix) => Object.freeze([`${LEGACY_PREFIX}${suffix}`, `${CURRENT_PREFIX}${suffix}`])),
);

const warnedKeys = new Set();

const isUnset = (value) => typeof value !== 'string' || value.trim().length === 0;

/**
 * Forward legacy `OPENCHAMBER_*` values onto their `ALCODE_*` names.
 * Returns the current names that were populated. Safe to call more than
 * once; each key warns at most once per process.
 */
export const applyLegacyEnvCompat = (env = process.env) => {
  const applied = [];
  for (const [legacyName, currentName] of LEGACY_ENV_ALIASES) {
    if (!isUnset(env[currentName]) || isUnset(env[legacyName])) continue;
    env[currentName] = env[legacyName];
    applied.push(currentName);
    if (!warnedKeys.has(currentName)) {
      warnedKeys.add(currentName);
      console.warn(
        `[alcode-env-compat] Using legacy ${legacyName}; set ${currentName} instead.`,
      );
    }
  }
  return applied;
};

applyLegacyEnvCompat();
