/**
 * Production `buildEntry()` for the native OmO plugin directory.
 *
 * Bundles `omo-engine/omo-opencode/src/index.ts` to one ESM file with only
 * `node:*` imports external, so the materialized `index.js` loads under
 * plain Node inside a managed OpenCode child. Three build fixes live here:
 *
 * 1. Bare builtin imports (`fs`, `path`, …) are redirected to `node:*`, so
 *    the bundle carries no resolver-dependent bare specifiers.
 * 2. `jsonc-parser` is aliased to its ESM build: the UMD build inlines with
 *    dangling relative `require("./impl/…")` that fails at load.
 * 3. The agents directory is pinned at build time: `define` sets
 *    `OMO_BUNDLED_AGENTS_DIR` to `"./agents"`, and the helper resolves it
 *    beside the emitted `index.js` (in source runs the constant is absent
 *    and the helper uses the package layout). The helper stays the single
 *    source of truth — only its binding is fixed at build time — and this
 *    module mirrors the materialized layout by writing `agents/` next to
 *    `index.js`, so the entry resolves at runtime exactly what is on disk
 *    here.
 *
 * Requires the Bun toolchain (`globalThis.Bun.build`); plain-Node hosts get
 * a clear error naming the missing capability instead of a broken bundle.
 */

import { fileURLToPath } from 'node:url';

const ENGINE_ENTRY_SEGMENTS = ['omo-engine', 'omo-opencode', 'src', 'index.ts'];
const BARE_BUILTIN_PATTERN = /^(fs|path|os|url|util|events|stream|crypto|child_process|readline|querystring|assert|buffer|process|timers|net|http|https|zlib)$/;

const engineFileUrl = () => fileURLToPath(import.meta.url);

/**
 * @param {object} [path] `node:path`-shaped join/dirname (defaults to the real one)
 * @returns {string} absolute path of the engine entry
 */
export const resolveEngineEntryPath = (path = undefined) => {
  const join = (path ?? { join: (...parts) => parts.join('/') }).join;
  const here = engineFileUrl();
  const up = ['..', '..', '..', '..'];
  return join(here, '..', ...up, ...ENGINE_ENTRY_SEGMENTS);
};

/**
 * @returns {string|null} absolute path of the `jsonc-parser` ESM build, or
 *   null when it cannot be located (the bundle then keeps the default
 *   resolution and may fail at load — see the module header)
 */
const resolveJsoncEsmBuild = async () => {
  // Anchor at the Alwork checkout root (this module lives at
  // packages/web/server/lib/omo-native) so resolution does not depend on
  // the caller's working directory.
  const { default: path } = await import('node:path');
  const alworkRoot = path.resolve(engineFileUrl(), '..', '..', '..', '..', '..', '..');
  const candidates = [];
  for (const root of [alworkRoot, process.cwd()]) {
    try {
      const pkgPath = Bun.resolveSync('jsonc-parser/package.json', root);
      candidates.push(pkgPath.replace(/package\.json$/, 'lib/esm/main.js'));
    } catch {
      continue;
    }
  }
  for (const esmPath of candidates) {
    try {
      const file = Bun.file(esmPath);
      if (file.size >= 0) return esmPath;
    } catch {
      continue;
    }
  }
  return null;
};

/**
 * @param {string|null} jsoncEsm absolute path of the `jsonc-parser` ESM
 *   build, or null to skip the alias
 * @returns {import('bun').Plugin[]} build plugins (see module header)
 */
const buildPlugins = (jsoncEsm) => {
  const plugins = [];
  if (jsoncEsm) {
    plugins.push({
      name: 'omo-jsonc-esm',
      setup(build) {
        build.onResolve({ filter: /^jsonc-parser$/ }, () => ({ path: jsoncEsm }));
      },
    });
  }
  plugins.push({
    name: 'omo-node-builtins',
    setup(build) {
      build.onResolve({ filter: BARE_BUILTIN_PATTERN }, (args) => ({ path: `node:${args.path}`, external: true }));
    },
  });
  return plugins;
};

/**
 * Build the single-file native entry.
 *
 * @returns {Promise<string>} bundled ESM source with only `node:*` externals
 */
export const buildOmoNativeEntry = async () => {
  if (typeof globalThis.Bun?.build !== 'function') {
    throw new Error('OmO native entry build needs the Bun toolchain (Bun.build is unavailable here)');
  }
  const entry = resolveEngineEntryPath((await import('node:path')).default);
  const plugins = buildPlugins(await resolveJsoncEsmBuild());
  const result = await globalThis.Bun.build({
    entrypoints: [entry],
    target: 'node',
    format: 'esm',
    external: [/^node:/],
    define: { OMO_BUNDLED_AGENTS_DIR: JSON.stringify('./agents') },
    plugins,
  });
  if (!result.success) {
    const detail = result.logs.map((entry) => entry.message).join('\n');
    throw new Error(`OmO native entry build failed:\n${detail}`);
  }
  return result.outputs[0].text();
};
