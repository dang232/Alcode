/**
 * Regen the committed dag-pane service bundle (`main.js`).
 *
 * Run `bun ./main.regen.mjs` (from any cwd: the script pins itself to
 * this directory so a rebuild diffs clean). Regenerate whenever the service
 * sources change (`server.js`, `handlers.js`, or the upstream bridge/engine
 * modules the bundle inlines): an edit without a regen ships stale code
 * into every packaged build, and the idempotence test fails.
 *
 * Same family as the omo-native setup bundle: `Bun.build` with
 * `target: 'node'`, `format: 'esm'`, and only `node:*` builtins external, so
 * the packaged service runs under plain Node with no transpile step.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
process.chdir(dir);

const SOURCE = './server.js';
// OUTFILE override so tests can regen to a temp file and byte-compare
// against the committed artifact. Accepts an absolute path or a path
// relative to this directory; defaults to the committed artifact.
const OUTFILE = process.env.DAG_PANE_SERVICE_OUTFILE || 'main.js';

const HEADER = `/**
 * Generated from the dag-pane service sources — DO NOT EDIT BY HAND.
 *
 * Regen with \`bun ./main.regen.mjs\` in this directory. Bundled with
 * Bun.build (target node, format esm, external node:* builtins only) so the
 * packaged service runs under plain Node with no transpile step.
 */
`;

const result = await Bun.build({
  entrypoints: [path.resolve(dir, SOURCE)],
  target: 'node',
  format: 'esm',
  minify: false,
  sourcemap: 'none',
  env: 'disable',
  write: false,
});

if (!result.success || result.outputs.length !== 1) {
  for (const log of result.logs) console.error(log);
  throw new Error(`[dag-pane-service] bundle failed for ${SOURCE}`);
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
const leaked = [...specifiers].filter((spec) => /^[^\s"'`(){}[\]]+$/.test(spec)).filter((spec) => {
  if (spec === '.' || spec === '..') return false;
  if (spec.startsWith('node:')) return false;
  return true;
});
if (leaked.length > 0) {
  throw new Error(`[dag-pane-service] bundle leaks non-node imports: ${leaked.join(', ')}`);
}

await Bun.write(path.resolve(dir, OUTFILE), `${HEADER}${text}`);
console.log(`[dag-pane-service] ${SOURCE} -> ${OUTFILE} (${text.length} bytes)`);
