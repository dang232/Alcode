/**
 * omo.json bridge for the web server.
 *
 * Single web/server entry onto the engine config core
 * (`@oh-my-opencode/omo-config-core`: schema + loader + atomic writer).
 * Everything omo.json-shaped that the server reads or writes flows through
 * this module, so there is exactly one schema for omo.json keys and no
 * parallel Zod fork beside the core. `config-v2.js` (OpenCode opencode.json
 * entity shapes) re-exports this surface so both config kinds stay one
 * import apart without sharing validation logic.
 *
 * BUILD SOURCE ONLY — never import this file at runtime. It imports engine
 * `.ts` directly, which plain Node cannot resolve in the packaged app (the
 * web server ships as source and Electron main imports it in-process with no
 * transpile step). Runtime entries import the committed `omo-config.bundle.js`
 * instead (regen with `bun ./omo-config.regen.js`); only that bundle and
 * `config-v2.js` may appear in a runtime import chain.
 *
 * Reference: `packages/omo-engine/omo-config-core/src`
 * (`OmoConfigSchema` / `OmoConfigLayerSchema`, `loadOmoConfig`,
 * `updateOmoConfig`). The core is imported by relative path because the web
 * package does not take a package dependency on it; `jsonc-parser` and `zod`
 * resolve from the workspace root.
 */
import {
  OmoConfigLayerSchema,
  OmoConfigSchema,
  OmoConfigWriteError,
  loadOmoConfig,
  resolveOmoConfigPaths,
  updateOmoConfig,
} from '../../../../omo-engine/omo-config-core/src/index.ts';

/**
 * Validate a merged omo.json document against the engine schema. Answers
 * `{ ok: true, config }` with core defaults applied, or
 * `{ ok: false, issues }` with the Zod issues the core reported.
 */
function validateOmoConfig(value) {
  const parsed = OmoConfigSchema.safeParse(value);
  if (parsed.success) return { ok: true, config: parsed.data };
  return { ok: false, issues: parsed.error.issues };
}

/**
 * Validate one omo.json layer (user or project file shape) against the
 * engine layer schema: partial values allowed, unknown keys rejected.
 */
function validateOmoConfigLayer(value) {
  const parsed = OmoConfigLayerSchema.safeParse(value);
  if (parsed.success) return { ok: true, config: parsed.data };
  return { ok: false, issues: parsed.error.issues };
}

/**
 * Read omo.json through the engine loader: user layer plus walked project
 * layers, merged nearest-wins with diagnostics. Accepts the core
 * `LoadOmoConfigOptions` (`cwd`, `env`, `fileSystem`, `harness`, `profile`,
 * `platform`); pass an in-memory `fileSystem` port for fixture-only reads.
 */
function readOmoConfig(options) {
  return loadOmoConfig(options ?? {});
}

/**
 * Write omo.json through the engine atomic writer (comment-preserving
 * edits, timestamped backup, temp-then-rename). Accepts the core
 * `UpdateOmoConfigOptions` (`edits`, `scope`, `targetPath`, `projectDir`,
 * `env`, `fileSystem`).
 */
function writeOmoConfig(options) {
  return updateOmoConfig(options);
}

export {
  OmoConfigLayerSchema,
  OmoConfigSchema,
  OmoConfigWriteError,
  loadOmoConfig,
  readOmoConfig,
  resolveOmoConfigPaths,
  updateOmoConfig,
  validateOmoConfig,
  validateOmoConfigLayer,
  writeOmoConfig,
};
