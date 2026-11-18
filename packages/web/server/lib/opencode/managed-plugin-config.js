import { parse as parseJsonc } from 'jsonc-parser';

const isJsonObject = (value) => value !== null && value !== undefined && Object.getPrototypeOf(value) === Object.prototype;

const matchesEntry = (value, pluginDirectory) => (
  value === pluginDirectory || (Array.isArray(value) && value[0] === pluginDirectory)
);

/**
 * Merge a managed MCP server into the `mcp.servers` map of an
 * `OPENCODE_CONFIG_CONTENT` value.
 *
 * Sibling of `appendManagedPlugin` for the same FALLBACK path: when the user's
 * own environment owns `OPENCODE_CONFIG`, the watched managed file is not
 * used, so the default servers ride along in the environment content instead.
 * Every other server entry is preserved. An entry the user already wrote under
 * the same name wins, so an explicit choice never loses to the default.
 *
 * @param {string | undefined} rawConfig the current `OPENCODE_CONFIG_CONTENT`, JSONC or unset
 * @param {string} serverName managed MCP server name, e.g. "ulw"
 * @param {object} serverEntry native v2 MCP server entry (`{ type, command, ... }`)
 * @param {string} purpose short noun phrase for the error message, e.g. "managed MCP server"
 * @returns {string} the merged config as JSON
 */
export const appendManagedMcpServer = (rawConfig, serverName, serverEntry, purpose) => {
  const errors = [];
  const text = (rawConfig ?? '').trim();
  const parsed = text ? parseJsonc(text, errors, { allowTrailingComma: true }) : {};
  if (errors.length > 0 || !isJsonObject(parsed)) {
    throw new Error(`OPENCODE_CONFIG_CONTENT must contain a valid JSON object before Alcode can inject its ${purpose}`);
  }
  if (parsed.mcp !== undefined && !isJsonObject(parsed.mcp)) {
    throw new Error(`OPENCODE_CONFIG_CONTENT mcp must be an object before Alcode can inject its ${purpose}`);
  }
  const servers = parsed.mcp?.servers;
  if (servers !== undefined && !isJsonObject(servers)) {
    throw new Error(`OPENCODE_CONFIG_CONTENT mcp.servers must be an object before Alcode can inject its ${purpose}`);
  }
  const next = { ...(servers ?? {}) };
  if (next[serverName] === undefined) next[serverName] = serverEntry;
  parsed.mcp = { ...(parsed.mcp ?? {}), servers: next };
  return JSON.stringify(parsed);
};

/**
 * Merge the static OmO-native agent map into the `agent` map of an
 * `OPENCODE_CONFIG_CONTENT` value.
 *
 * Sibling of `appendManagedMcpServer` for the same FALLBACK path: when the
 * user's own environment owns `OPENCODE_CONFIG`, the watched managed file is
 * not used, so the native agents ride along in the environment content
 * instead. Every other agent entry is preserved. An entry the user already
 * wrote under the same key wins, so an explicit choice never loses to the
 * default (same rule as the managed MCP server).
 *
 * @param {string | undefined} rawConfig the current `OPENCODE_CONFIG_CONTENT`, JSONC or unset
 * @param {object} agentMap static `{ configKey: entry }` map (`OMO_NATIVE_AGENT_CONFIG`)
 * @param {string} purpose short noun phrase for the error message, e.g. "managed agents"
 * @returns {string} the merged config as JSON
 */
export const mergeManagedAgents = (rawConfig, agentMap, purpose) => {
  const errors = [];
  const text = (rawConfig ?? '').trim();
  const parsed = text ? parseJsonc(text, errors, { allowTrailingComma: true }) : {};
  if (errors.length > 0 || !isJsonObject(parsed)) {
    throw new Error(`OPENCODE_CONFIG_CONTENT must contain a valid JSON object before Alcode can inject its ${purpose}`);
  }
  if (parsed.agent !== undefined && !isJsonObject(parsed.agent)) {
    throw new Error(`OPENCODE_CONFIG_CONTENT agent must be an object before Alcode can inject its ${purpose}`);
  }
  const next = { ...agentMap };
  for (const [name, entry] of Object.entries(parsed.agent ?? {})) {
    next[name] = entry;
  }
  parsed.agent = next;
  return JSON.stringify(parsed);
};

const isHttpUrl = (value) => {
  if (typeof value !== 'string') return false;
  if (!value.startsWith('http://') && !value.startsWith('https://')) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

/**
 * The plugin options a host capability descriptor becomes, or null when there
 * is no descriptor to publish. The descriptor arrives from the caller as an
 * object or its JSON text; anything that would write a broken tuple (wrong
 * shape, a version other than the literal 1, a non-http(s) url, an empty
 * token, a malformed `allowedAgents`) answers null so the entry stays the bare
 * directory path.
 */
const parseHostCapabilityDescriptor = (descriptor) => {
  if (descriptor === undefined || descriptor === null) return null;
  let options = descriptor;
  if (typeof options === 'string') {
    try {
      options = JSON.parse(options);
    } catch {
      return null;
    }
  }
  if (!isJsonObject(options)) return null;
  const capabilities = options.hostCapabilities;
  if (!isJsonObject(capabilities)) return null;
  if (capabilities.version !== 1) return null;
  if (!isHttpUrl(capabilities.url)) return null;
  if (typeof capabilities.token !== 'string' || capabilities.token.length === 0) return null;
  if (capabilities.allowedAgents !== undefined
    && (!Array.isArray(capabilities.allowedAgents)
      || capabilities.allowedAgents.some((agent) => typeof agent !== 'string' || agent.length === 0))) {
    return null;
  }
  const hostCapabilities = { version: 1, url: capabilities.url, token: capabilities.token };
  if (capabilities.allowedAgents !== undefined) hostCapabilities.allowedAgents = capabilities.allowedAgents;
  return { hostCapabilities };
};

/**
 * Append a managed Alcode plugin to the `plugins` list of an
 * `OPENCODE_CONFIG_CONTENT` value.
 *
 * OpenCode 2 loads a configured plugin from a DIRECTORY that carries a
 * `package.json` resolving an entrypoint; a path to a single `.js` file is
 * rejected with "configured plugin path must be a directory". So the value
 * merged here names an absolute directory, not a `file://` URL. With a host
 * capability descriptor the entry is the tuple `[directory, { hostCapabilities }]`
 * that OpenCode 2 hands the plugin as its options; without one the entry is the
 * bare directory path.
 *
 * Existing entries are preserved and an earlier entry for the same directory is
 * dropped, so a restart never registers the same plugin twice. A legacy
 * `plugin` key is folded into `plugins` and removed: OpenCode still decodes it,
 * but keeping two keys would mean two places to dedupe against.
 *
 * This is the FALLBACK path only, taken when the user's own environment owns
 * `OPENCODE_CONFIG`. Otherwise managed plugins are published through the
 * watched config file in `managed-config-file.js`, which is what makes a
 * managed-tool toggle apply without a restart.
 *
 * @param {string | undefined} rawConfig the current `OPENCODE_CONFIG_CONTENT`, JSONC or unset
 * @param {string} pluginDirectory absolute path of the materialized plugin directory
 * @param {string} purpose short noun phrase for the error message, e.g. "managed tool"
 * @param {string | object | undefined} descriptor host capability descriptor as
 *   `{ hostCapabilities: { version: 1, url, token, allowedAgents? } }`, either an
 *   object or its JSON text; an invalid descriptor falls back to the bare path
 * @returns {string} the merged config as JSON
 */
export const appendManagedPlugin = (rawConfig, pluginDirectory, purpose, descriptor) => {
  const errors = [];
  const text = (rawConfig ?? '').trim();
  const parsed = text ? parseJsonc(text, errors, { allowTrailingComma: true }) : {};
  if (errors.length > 0 || !isJsonObject(parsed)) {
    throw new Error(`OPENCODE_CONFIG_CONTENT must contain a valid JSON object before Alcode can inject its ${purpose}`);
  }
  for (const key of ['plugin', 'plugins']) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
      throw new Error(`OPENCODE_CONFIG_CONTENT ${key} must be an array before Alcode can inject its ${purpose}`);
    }
  }
  const configured = [
    ...(Array.isArray(parsed.plugin) ? parsed.plugin : []),
    ...(Array.isArray(parsed.plugins) ? parsed.plugins : []),
  ];
  delete parsed.plugin;
  const options = parseHostCapabilityDescriptor(descriptor);
  parsed.plugins = [
    ...configured.filter((value) => !matchesEntry(value, pluginDirectory)),
    options === null ? pluginDirectory : [pluginDirectory, options],
  ];
  return JSON.stringify(parsed);
};
