

/**
 * OpenCode installs every npm plugin into a sandbox of its own at
 * `<opencode cache>/packages/<plugin spec>/node_modules/<package>`, and its
 * `Npm.add()` returns that copy as soon as `node_modules/<package>` exists —
 * it never re-resolves the tag. A moving tag (`@latest`, `@beta`, or a bare
 * name, which OpenCode expands to `<name>@latest`) therefore stays frozen at
 * whatever version was installed first until the sandbox is gone.
 *
 * These helpers own that path layout — where a spec's sandbox lives, and
 * whether a directory really is one of our sandboxes — so the update checker
 * and the installer invalidate the same directories under the same guard.
 */

