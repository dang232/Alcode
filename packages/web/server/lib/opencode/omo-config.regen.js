/**
 * Regen the committed omo-config engine bundle (`omo-config.bundle.js`).
 *
 * Run `bun ./omo-config.regen.js` (from any cwd: the script pins itself to
 * this directory so Bun's per-module `// path` comments stay stable and a
 * rebuild diffs clean). Fixture-only, zero keyed spend: no network, no keys.
 *
 * Same family as the dag-pane node service bundle: `Bun.build` with
 * `target: 'node'`, `format: 'esm'`, and only `node:*` builtins external. The
 * engine TypeScript plus `zod` and `jsonc-parser` are inlined, so the packaged
 * app — plain Node, no transpile step — never resolves a `.ts` specifier at
 * runtime (the proven `Cannot find module` defect this replaces).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
process.chdir(dir);

const SOURCE = 'omo-config.js';
const OUTFILE = 'omo-config.bundle.js';

const HEADER = `/**
 * Generated from omo-config.js — DO NOT EDIT BY HAND.
 *
 * Regen with \`bun ./omo-config.regen.js\` in this directory. Bundled with
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
  throw new Error(`[omo-config] bundle failed for ${SOURCE}`);
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
  throw new Error(`[omo-config] bundle leaks non-node imports: ${leaked.join(', ')}`);
}

await Bun.write(path.join(dir, OUTFILE), `${HEADER}${text}`);
console.log(`[omo-config] ${SOURCE} -> ${OUTFILE} (${text.length} bytes)`);
