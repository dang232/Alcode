

/**
 * Reads OpenCode's auth.json to detect the auth type used by a provider.
 *
 * OpenCode stores auth credentials at `<dataDir>/opencode/auth.json` in the
 * shape `{ [providerID]: { type: "oauth" | "api" | "wellknown", ... } }`.
 *
 * The file is read with mtime-based caching so we do not stat/parse it on
 * every chat.params invocation.
 */

