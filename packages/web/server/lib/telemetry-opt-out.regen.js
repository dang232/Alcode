/**
 * Regen the committed telemetry gate bundle (`telemetry-opt-out.bundle.js`).
 *
 * Run `bun ./telemetry-opt-out.regen.js` (from any cwd: the script pins
 * itself to this directory so Bun's per-module `// path` comments stay
 * stable and a rebuild diffs clean). Fixture-only, zero keyed spend: no
 * network, no keys.
 *
 * Same family as the omo-config engine bundle (`opencode/omo-config.regen.js`):
 * `Bun.build` with `target: 'node'`, `format: 'esm'`, and only `node:*`
 * builtins external. The engine TypeScript (`telemetry-opt-out.ts` plus its
 * `env`/`constants` deps, zero runtime dependencies) is inlined, so the
 * packaged app — plain Node, no transpile step — never resolves a `.ts`
 * specifier at runtime (the proven `Cannot find module` defect a relative
 * `.ts` import repeats). Runtime entries import the committed
 * `telemetry-opt-out.bundle.js` instead (regen with this script when the
 * engine gate changes); the engine itself keeps importing source.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
process.chdir(dir);

const SOURCE = '../../../omo-engine/telemetry-core/src/telemetry-opt-out.ts';
const OUTFILE = 'telemetry-opt-out.bundle.js';

const HEADER = `/**
 * Generated from the engine telemetry gate — DO NOT EDIT BY HAND.
 *
 * Regen with \`bun ./telemetry-opt-out.regen.js\` in this directory. Bundled
 * with Bun.build (target node, format esm, external node:* builtins only) so
 * the engine TypeScript ships inline: the packaged web server runs under
 * plain Node with no transpile step, where a static \`.ts\` import fails.
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
  throw new Error(`[telemetry-opt-out] bundle failed for ${SOURCE}`);
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
const leaked = [...specifiers].filter((spec) => !spec.startsWith('node:'));
if (leaked.length > 0) {
  throw new Error(`[telemetry-opt-out] bundle leaks non-node imports: ${leaked.join(', ')}`);
}

await Bun.write(path.join(dir, OUTFILE), `${HEADER}${text}`);
console.log(`[telemetry-opt-out] ${SOURCE} -> ${OUTFILE} (${text.length} bytes)`);
