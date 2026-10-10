// Vendor OmO engine subset into Alwork packages/omo-engine (repeatable).
// Usage: bun script/vendor-omo-engine.mjs [--apply]
//   default (no flag): dry run — prints what WOULD copy, changes nothing.
//   --apply: wipe target, copy, rewrite @oh-my-opencode/* imports to
//     relative paths, copy license/notice files, verify no unresolved refs.
// Source of truth: oh-my-openAlcore checkout beside the migration root.
import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const MIGRATION_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const ENGINE_PKGS = path.join(MIGRATION_ROOT, "oh-my-openAlcore", "packages");
const TARGET = path.join(MIGRATION_ROOT, "Alwork-wt", "wave1", "packages", "omo-engine");

// Full packages vendored whole.
const WHOLE = [
  "senpi-task",
  "model-core",
  "skills-loader-core",
  "utils",
  "omo-config-core",
  "team-core",
  "delegate-core",
  "telemetry-core",
  "memory-core",
  "claude-code-compat-core",
  "rules-engine",
  "hashline-core",
];
// Blind-copied subtrees (data + components, no import walking needed).
const PARTS = [
  ["omo-codex", "plugin/components/ultrawork"],
  ["omo-codex", "plugin/components/ulw-loop"],
  ["omo-codex", "plugin/components/ulw-execute-continuation"],
  ["omo-codex", "plugin/skills"],
  ["omo-codex", "plugin/model-catalog.json"],
  ["omo-codex", "src/install/codex-model-catalog.ts"],
];
// omo-opencode is vendored by import CLOSURE from these seeds (not blind
// subtrees): ESM has no directory-index resolution, so every pulled file is
// resolved to an explicit file here.
const CLOSURE_SEEDS = [
  "omo-opencode/src/cli/run/index.ts",
  "omo-opencode/src/plugin-config.ts",
  "omo-opencode/src/shared/agent-display-names.ts",
];
const resolveImport = (fromFile, spec) => {
  const isWorkspace = spec.startsWith("@oh-my-opencode/");
  const base = isWorkspace
    ? path.join(ENGINE_PKGS, spec.slice("@oh-my-opencode/".length))
    : path.resolve(path.dirname(fromFile), spec);
  const roots = [base];
  if (isWorkspace) {
    // Package roots and exports-map subpaths live under src/ in-source.
    const [pkg, ...tail] = spec.slice("@oh-my-opencode/".length).split("/");
    roots.push(path.join(ENGINE_PKGS, pkg, "src", ...tail));
  }
  const isFile = (c) => {
    try {
      return fs.statSync(c).isFile() ? c : null;
    } catch {
      return null;
    }
  };
  for (const root of roots) {
    const cands = [root, `${root}.ts`, `${root}.js`, `${root}.mjs`, `${root}.cjs`,
      path.join(root, "index.ts"), path.join(root, "index.js")];
    for (const c of cands) {
      const hit = isFile(c);
      if (hit) return hit;
    }
  }
  if (isWorkspace) {
    // Explicit exports-map subpaths (e.g. ./claude-code-plugin-loader ->
    // ./src/features/...): honor the package's own map.
    const [pkg, ...tail] = spec.slice("@oh-my-opencode/".length).split("/");
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(ENGINE_PKGS, pkg, "package.json"), "utf8"));
      const sub = `./${tail.join("/")}`;
      const entry = manifest.exports?.[tail.length ? sub : "."];
      // SAFETY: package.json exports-map values are author-controlled strings; used only as a path join, never executed.
      const mapped = (entry?.import ?? entry)?.toString();
      if (mapped && mapped.length > 0) {
        const hit = isFile(path.join(ENGINE_PKGS, pkg, mapped));
        if (hit) return hit;
      }
    } catch {}
  }
  return null;
};
const collectClosure = (collected, missing) => {
  const stack = CLOSURE_SEEDS.map((s) => path.join(ENGINE_PKGS, s));
  const seen = new Set();
  const staticRe = /(?:import|export)[^;]*?from\s+["']([^"']+)["']/g;
  while (stack.length) {
    const abs = stack.pop();
    if (seen.has(abs)) continue;
    seen.add(abs);
    let src;
    try {
      src = fs.readFileSync(abs, "utf8");
    } catch {
      missing.push(path.relative(ENGINE_PKGS, abs));
      continue;
    }
    collected.push(abs);
    if (!/\.(ts|js|mjs|cjs)$/.test(abs)) continue;
    for (const m of src.matchAll(staticRe)) {
      const spec = m[1];
      if (!spec.startsWith(".") && !spec.startsWith("@oh-my-opencode/")) continue;
      const hit = resolveImport(abs, spec);
      if (hit && !seen.has(hit)) stack.push(hit);
      else if (!hit) missing.push(`${path.relative(ENGINE_PKGS, abs)} -> ${spec}`);
    }
  }
};
// License passthrough (SUL duty): engine license + notices travel with the copy.
const LEGAL = ["LICENSE.md", "THIRD-PARTY-NOTICES.md", "packages/omo-codex/THIRD-PARTY-NOTICES.md"];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
let copied = 0;
const copiedFiles = [];
const collect = (src, dst) => {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) collect(path.join(src, e.name), path.join(dst, e.name));
    } else if (/\.(ts|js|mjs|cjs|json|toml|md)$/.test(e.name)) {
      copiedFiles.push([path.join(src, e.name), path.join(dst, e.name)]);
    }
  }
};
for (const pkg of WHOLE) collect(path.join(ENGINE_PKGS, pkg), path.join(TARGET, pkg));
for (const [pkg, ...subs] of PARTS) {
  for (const sub of subs) {
    const src = path.join(ENGINE_PKGS, pkg, sub);
    const st = fs.statSync(src);
    if (st.isDirectory()) collect(src, path.join(TARGET, pkg, sub));
    else copiedFiles.push([src, path.join(TARGET, pkg, sub)]);
  }
}
const closureMissing = [];
const closureAbs = [];
collectClosure(closureAbs, closureMissing);
for (const abs of closureAbs) {
  copiedFiles.push([abs, path.join(TARGET, path.relative(ENGINE_PKGS, abs))]);
}
for (const m of closureMissing) console.log(`closure miss: ${m}`);
const legalFiles = [];
for (const rel of LEGAL) {
  const src = path.join(MIGRATION_ROOT, "oh-my-openAlcore", rel);
  if (fs.existsSync(src)) legalFiles.push([src, path.join(TARGET, path.basename(path.dirname(rel)) === "omo-codex" ? "omo-codex" : ".", path.basename(rel))]);
}
console.log(`vendor plan: ${copiedFiles.length} source files + ${legalFiles.length} legal files -> ${TARGET}`);
if (!APPLY) {
  console.log("dry run: no changes made. Re-run with --apply to copy.");
  process.exit(0);
}
copied = 0;
fs.rmSync(TARGET, { recursive: true, force: true });
for (const [src, dst] of [...copiedFiles, ...legalFiles]) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied++;
}
// Rewrite @oh-my-opencode/<pkg>[/rest] to relative paths inside the vendored tree.
let rewritten = 0;
const rewriteFile = (dst) => {
  if (!/\.(ts|js|mjs|cjs)$/.test(dst)) return;
  const text = fs.readFileSync(dst, "utf8");
  const out = text.replace(/from\s+["'](@oh-my-opencode\/[^"']+)["']/g, (m, spec) => {
    // Resolve in the SOURCE tree (exports maps + index rules live there),
    // then mirror the resolved file into the target tree.
    const engineAbs = resolveImport(path.join(ENGINE_PKGS, "placeholder.ts"), spec);
    const target = engineAbs
      ? path.join(TARGET, path.relative(ENGINE_PKGS, engineAbs))
      : path.join(TARGET, spec.slice("@oh-my-opencode/".length));
    let rel = path.relative(path.dirname(dst), target).replace(/\\/g, "/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    rewritten++;
    return `from "${rel}"`;
  });
  if (out !== text) fs.writeFileSync(dst, out);
};
const walkTarget = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTarget(p);
    else rewriteFile(p);
  }
};
walkTarget(TARGET);
console.log(`applied: ${copied} files copied, ${rewritten} import refs rewritten`);
