/**
 * Regen the committed OmO-native setup bundle (`setup.bundle.js`).
 *
 * Run `bun ./setup.regen.js` (from any cwd: the script pins itself to
 * this directory so a rebuild diffs clean). Fixture-only, zero keyed spend:
 * no network, no keys. Regenerate whenever engine plugin sources change:
 * the bundle inlines them, so an engine edit without a regen ships stale
 * code and the idempotence test fails.
 *
 * Same family as the omo-native catalog bundle: `Bun.build` with
 * `target: 'node'`, `format: 'esm'`, and only `node:*` builtins external. The
 * engine TypeScript (`plugin-setup.ts` plus its engine imports) is inlined,
 * so the packaged app — plain Node, no transpile step — never resolves a
 * `.ts` specifier at runtime.
 */
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
process.chdir(dir);

const SOURCE = '../../../../omo-engine/omo-opencode/src/omo-native-entry.ts';
// OUTFILE override so tests can regen to a temp file and byte-compare
// against the committed artifact. Accepts an absolute path or a path
// relative to this directory; defaults to the committed artifact.
const OUTFILE = process.env.OMO_NATIVE_SETUP_OUTFILE || 'setup.bundle.js';

// The setup chain reaches `jsonc-parser` through one bare specifier
// (`shared/migrate-legacy-plugin-entry.ts`); the package has no `exports`
// map, so Bun resolves the bare name to the UMD build (`lib/umd/main.js`)
// whose factory hides `require("./impl/…")` from static analysis and
// emits a bundle plain Node cannot load. Every other engine importer uses
// the explicit ESM path, so remap the bare specifier to that same build
// and the whole bundle stays statically analyzable (the packaged app
// never resolves engine `.ts`, and there is no `jsonc-parser` runtime dep).
const jsoncEsmPlugin = {
  name: 'omo-native-setup-jsonc-esm',
  setup(build) {
    build.onResolve({ filter: /^jsonc-parser$/ }, () => ({
      path: Bun.resolveSync('jsonc-parser/lib/esm/main.js', dir),
    }));
  },
};

const HEADER = `/**
 * Generated from the engine plugin setup — DO NOT EDIT BY HAND.
 *
 * Regen with \`bun ./setup.regen.js\` in this directory. Bundled with
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
  plugins: [jsoncEsmPlugin],
  minify: false,
  sourcemap: 'none',
  env: 'disable',
  write: false,
});

if (!result.success || result.outputs.length !== 1) {
  for (const log of result.logs) console.error(log);
  throw new Error(`[omo-native-setup] bundle failed for ${SOURCE}`);
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
// Engine sources now embed regex literals like /from\s*"..."/ whose own text contains the same
// `from` + quote shape, so the scan can capture a fragment spanning punctuation and newlines.
// Only specifier-shaped tokens can leak into a consumer: a capture carrying whitespace, brackets or
// quotes is scanner noise, never an import specifier.
const SPECIFIER_SHAPE = /^[^\s"'`(){}[\]]+$/;
const leaked = [...specifiers].filter((spec) => SPECIFIER_SHAPE.test(spec)).filter((spec) => {
  if (spec.startsWith('node:')) return false;
  // Bare core imports (`fs`, `os`, `path`, …) resolve in plain Node exactly
  // like their `node:`-prefixed twins; only non-core specifiers leak.
  return !builtinModules.includes(spec) && !builtinModules.includes(`node:${spec}`);
});
if (leaked.length > 0) {
  throw new Error(`[omo-native-setup] bundle leaks non-node imports: ${leaked.join(', ')}`);
}

await Bun.write(path.resolve(dir, OUTFILE), `${HEADER}${text}`);
console.log(`[omo-native-setup] ${SOURCE} -> ${OUTFILE} (${text.length} bytes)`);
