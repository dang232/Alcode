/**
 * Regen the committed delegate-dispatch engine bundle
 * (`delegate-dispatch.bundle.js`).
 *
 * Run `bun ./delegate-dispatch.regen.js` (from any cwd: the script pins
 * itself to this directory so Bun's per-module `// path` comments stay stable
 * and a rebuild diffs clean). Fixture-only, zero keyed spend: no network, no
 * keys.
 *
 * Same family as the omo-config bundle: `Bun.build` with `target: 'node'`,
 * `format: 'esm'`, and only `node:*` builtins external. The engine
 * TypeScript (`delegate-core` plus its `model-core` dependency) is inlined,
 * so the packaged app — plain Node, no transpile step — never resolves a
 * `.ts` specifier at runtime (the proven `Cannot find module` defect this
 * replaces).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
process.chdir(dir);

const SOURCE = 'delegate-dispatch.js';
const OUTFILE = 'delegate-dispatch.bundle.js';

const HEADER = `/**
 * Generated from delegate-dispatch.js — DO NOT EDIT BY HAND.
 *
 * Regen with \`bun ./delegate-dispatch.regen.js\` in this directory. Bundled with
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
  throw new Error(`[delegate-dispatch] bundle failed for ${SOURCE}`);
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
  throw new Error(`[delegate-dispatch] bundle leaks non-node imports: ${leaked.join(', ')}`);
}

await Bun.write(path.join(dir, OUTFILE), `${HEADER}${text}`);
console.log(`[delegate-dispatch] ${SOURCE} -> ${OUTFILE} (${text.length} bytes)`);
