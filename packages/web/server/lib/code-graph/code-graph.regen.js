/**
 * Regen the committed code-graph engine bundle (`code-graph.bundle.js`).
 *
 * Run `bun ./code-graph.regen.js` (from any cwd: the script pins itself to
 * this directory so a rebuild diffs clean). Fixture-only, zero keyed spend:
 * no network, no keys.
 *
 * Same family as the agents `omo-native-catalog` bundle: `Bun.build` with
 * `target: 'node'`, `format: 'esm'`, and only `node:*` builtins external. The
 * engine TypeScript — including the compiler API it drives — is inlined, so
 * the packaged app (plain Node, no transpile step) never resolves a `.ts`
 * specifier at runtime. The `tsserver` binary itself is not bundled: it is
 * located relative to the vendored `typescript@7.0.2` install at runtime,
 * and a checkout without it fails explicitly instead of serving an empty
 * graph. The runtime loads this bundle lazily (dynamic `import()` inside
 * `runtime.js`), so that failure stays a per-request backend error instead
 * of crashing the server at startup.
 */
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
process.chdir(dir);

const SOURCE = 'engine.js';
const OUTFILE = 'code-graph.bundle.js';

const HEADER = `/**
 * Generated from engine.js — DO NOT EDIT BY HAND.
 *
 * Regen with \`bun ./code-graph.regen.js\` in this directory. Bundled with
 * Bun.build (target node, format esm; node:* builtins and the vendored
 * TypeScript compiler API external) so the engine ships inline: the
 * packaged web server runs under plain Node with no transpile step, where a
 * static \`.ts\` import fails.
 */
`;

const result = await Bun.build({
  entrypoints: [path.join(dir, SOURCE)],
  target: 'node',
  format: 'esm',
  external: [/^node:/],
  minify: false,
  sourcemap: 'none',
  env: 'disable',
  write: false,
});

if (!result.success || result.outputs.length !== 1) {
  for (const log of result.logs) console.error(log);
  throw new Error(`[code-graph] bundle failed for ${SOURCE}`);
}

const text = await result.outputs[0].text();

// Packaging guard: the only runtime specifiers a plain-Node consumer may see
// are node:* builtins (plus their bare twins). Anything else (`.ts`, `bun:`,
// bare, relative) means the bundle leaked an unresolvable import into the
// packaged app.
const specifiers = new Set(
  [...text.matchAll(/from\s*["']([^"']+)["']/g), ...text.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)].map(
    (match) => match[1],
  ),
);
const leaked = [...specifiers].filter((spec) => {
  if (spec.startsWith('node:')) return false;
  if (builtinModules.includes(spec) || builtinModules.includes(`node:${spec}`)) return false;
  return true;
});
if (leaked.length > 0) {
  throw new Error(`[code-graph] bundle leaks non-node imports: ${leaked.join(', ')}`);
}

await Bun.write(path.join(dir, OUTFILE), `${HEADER}${text}`);
console.log(`[code-graph] ${SOURCE} -> ${OUTFILE} (${text.length} bytes)`);
