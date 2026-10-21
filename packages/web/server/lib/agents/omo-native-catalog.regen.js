/**
 * Regen the committed OmO-native agent catalog bundle (`omo-native-catalog.bundle.js`).
 *
 * Run `bun ./omo-native-catalog.regen.js` (from any cwd: the script pins itself to
 * this directory so a rebuild diffs clean). Fixture-only, zero keyed spend:
 * no network, no keys.
 *
 * Same family as the omo-catalog bundle: `Bun.build` with
 * `target: 'node'`, `format: 'esm'`, and only `node:*` builtins external. The
 * engine TypeScript (OpenCode-native agent registry) is inlined, so the packaged
 * app — plain Node, no transpile step — never resolves a `.ts` specifier at
 * runtime.
 */
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
process.chdir(dir);

const SOURCE = 'omo-native-catalog.js';
const OUTFILE = 'omo-native-catalog.bundle.js';

const HEADER = `/**
 * Generated from omo-native-catalog.js — DO NOT EDIT BY HAND.
 *
 * Regen with \`bun ./omo-native-catalog.regen.js\` in this directory. Bundled with
 * Bun.build (target node, format esm, external node:* builtins only) so the
 * engine TypeScript ships inline: the packaged web server runs under plain
 * Node with no transpile step, where a static \`.ts\` import fails.
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
  throw new Error(`[omo-native-catalog] bundle failed for ${SOURCE}`);
}

const text = await result.outputs[0].text();

// Packaging guard: the only runtime specifiers a plain-Node consumer may see
// are node:* builtins. Anything else (`.ts`, `bun:`, bare, relative) means the
// bundle leaked an unresolvable import into the packaged app.
const specifiers = new Set(
  [...text.matchAll(/from\s*["']([^"']+)["']/g), ...text.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)].map(
    (match) => match[1],
  ),
);
const leaked = [...specifiers].filter((spec) => {
  if (spec.startsWith('node:')) return false;
  // Bare core imports (`fs`, `os`, `path`, …) resolve in plain Node exactly
  // like their `node:`-prefixed twins; only non-core specifiers leak.
  return !builtinModules.includes(spec) && !builtinModules.includes(`node:${spec}`);
});
if (leaked.length > 0) {
  throw new Error(`[omo-native-catalog] bundle leaks non-node imports: ${leaked.join(', ')}`);
}

await Bun.write(path.join(dir, OUTFILE), `${HEADER}${text}`);
console.log(`[omo-native-catalog] ${SOURCE} -> ${OUTFILE} (${text.length} bytes)`);
