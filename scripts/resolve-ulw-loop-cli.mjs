#!/usr/bin/env node
// resolve-ulw-loop-cli: one authoritative answer to "which ULW CLI do I run?"
//
// Policy (highest precedence first):
//   1. OMO_ULW_LOOP_CLI when set: must exist and answer `ulw-loop help`;
//      an explicit override that is missing or broken is a hard error, never
//      a silent fallthrough.
//   2. Inside a checkout: <root>/packages/omo-engine/omo-codex/plugin/
//      components/ulw-loop/dist/cli.js, which must exist, be runnable, and be
//      no older than the component sources; a missing or stale build fails
//      with the exact rebuild command instead of running an unrelated CLI.
//   3. Outside a checkout (or with explicit opt-in): a global toolkit, only
//      with --allow-global or OMO_ULW_LOOP_ALLOW_GLOBAL=1; otherwise fail.
//   4. The resolved path prints to stdout (safe to capture); diagnostics and
//      errors go to stderr. No secrets are ever printed: only paths and the
//      names of the environment variables consulted.
//
// The repo root defaults to this script's checkout (scripts/ -> root); pass
// --root <dir> to resolve against another tree (tests use fixtures).
// Spawns never use a shell except for Windows .cmd/.bat shims.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMPONENT_REL = path.join(
  "packages",
  "omo-engine",
  "omo-codex",
  "plugin",
  "components",
  "ulw-loop",
);
const DIST_REL = path.join(COMPONENT_REL, "dist", "cli.js");
const HELP_MARKER = "create-goals";
const RUN_TIMEOUT_MS = 30000;

const usage = () => `usage: node scripts/resolve-ulw-loop-cli.mjs [--root <dir>] [--allow-global] [--json] [--diagnose] [--help]`;

const parseArgs = (argv) => {
  const out = { root: null, allowGlobal: false, json: false, diagnose: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { error: "--root needs a directory" };
      out.root = value;
      i += 1;
    } else if (arg === "--allow-global") out.allowGlobal = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--diagnose") out.diagnose = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else return { error: `unknown argument: ${arg}` };
  }
  return out;
};

const scriptRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const isCheckoutRoot = (dir) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return manifest && manifest.name === "alcode-monorepo";
  } catch {
    return false;
  }
};

const runHelp = (runner, cli) => {
  // runner is process.execPath for .js, or the candidate itself for native/global bins.
  const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(runner);
  const result = needsShell
    ? spawnSync(`"${runner}"`, [cli, "ulw-loop", "help"], { encoding: "utf8", timeout: RUN_TIMEOUT_MS, shell: true, windowsHide: true })
    : spawnSync(runner, cli ? [cli, "ulw-loop", "help"] : ["ulw-loop", "help"], { encoding: "utf8", timeout: RUN_TIMEOUT_MS, windowsHide: true });
  const stdout = result.stdout ?? "";
  return result.status === 0 && stdout.includes(HELP_MARKER);
};

const isRunnableCli = (cli) => {
  try {
    if (!fs.statSync(cli).isFile()) return false;
  } catch {
    return false;
  }
  return runHelp(process.execPath, cli);
};

const newestSourceMtime = (componentDir) => {
  let newest = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(ts|js|mjs|json)$/.test(entry.name)) {
        const mtime = fs.statSync(full).mtimeMs;
        if (mtime > newest) newest = mtime;
      }
    }
  };
  walk(path.join(componentDir, "src"));
  return newest;
};

const pathCandidates = (name) => {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  const found = [];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, name + extension);
      try {
        if (fs.statSync(candidate).isFile()) found.push(candidate);
      } catch {
        /* not here */
      }
    }
  }
  return found;
};

const runGlobalCandidate = (candidate) => {
  if (/\.ps1$/i.test(candidate)) {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", candidate, "ulw-loop", "help"], { encoding: "utf8", timeout: RUN_TIMEOUT_MS, windowsHide: true });
    const psOut = result.stdout ?? "";
    return result.status === 0 && psOut.includes(HELP_MARKER);
  }
  if (/\.(cmd|bat)$/i.test(candidate)) {
    // Windows batch shims only run through a shell; a single quoted pair
    // around the executable survives cmd's quote handling (with or without
    // spaces in the path).
    const result = spawnSync(`"${candidate}" ulw-loop help`, { encoding: "utf8", timeout: RUN_TIMEOUT_MS, windowsHide: true, shell: true });
    const stdout = result.stdout ?? "";
    return result.status === 0 && stdout.includes(HELP_MARKER);
  }
  return runHelp(candidate, null);
};

export const resolveUlwLoopCli = (options = {}) => {
  const root = options.root ? path.resolve(options.root) : scriptRoot();
  const allowGlobal = Boolean(options.allowGlobal || process.env.OMO_ULW_LOOP_ALLOW_GLOBAL === "1");
  const trace = [];
  const note = (line) => trace.push(line);

  const override = (process.env.OMO_ULW_LOOP_CLI || "").trim();
  if (override) {
    note(`OMO_ULW_LOOP_CLI is set: ${override}`);
    if (!isRunnableCli(override)) {
      return { ok: false, code: 2, message: `OMO_ULW_LOOP_CLI points at an unusable CLI: ${override}. Point it at a built ulw-loop dist/cli.js that answers \`ulw-loop help\`, or unset it to use checkout resolution.`, trace };
    }
    return { ok: true, cli: override, source: "override", trace };
  }
  note("OMO_ULW_LOOP_CLI is unset");

  if (isCheckoutRoot(root)) {
    note(`checkout root: ${root}`);
    const componentDir = path.join(root, COMPONENT_REL);
    const dist = path.join(root, DIST_REL);
    const buildHint = `Build it with: npm --prefix "${componentDir}" run build`;
    // Explicit opt-in may still choose the global toolkit (said in the trace);
    // without it a broken checkout build is a hard error, never a silent
    // global substitution.
    const unusable = (message) => {
      if (allowGlobal) {
        note(`checkout CLI unusable; --allow-global set, falling through to global candidates`);
        return false;
      }
      return { ok: false, code: 2, message, trace };
    };
    let usable = fs.existsSync(dist);
    if (!usable) {
      const failed = unusable(`Checkout ULW CLI is not built: ${dist} is missing. ${buildHint}.`);
      if (failed) return failed;
    } else {
      let newest = 0;
      try {
        newest = newestSourceMtime(componentDir);
      } catch (error) {
        const failed = unusable(`Cannot inspect ULW CLI sources under ${componentDir}: ${error instanceof Error ? error.message : String(error)}`);
        if (failed) return failed;
      }
      let distMtime = 0;
      try {
        distMtime = fs.statSync(dist).mtimeMs;
      } catch {
        const failed = unusable(`Checkout ULW CLI is not built: ${dist} is missing. ${buildHint}.`);
        if (failed) return failed;
      }
      if (distMtime > 0 && distMtime < newest) {
        const failed = unusable(`Checkout ULW CLI is stale (dist older than sources). Rebuild it with: npm --prefix "${componentDir}" run build`);
        if (failed) return failed;
        usable = false;
      }
      if (usable && !isRunnableCli(dist)) {
        const failed = unusable(`Checkout ULW CLI fails its help smoke run: ${dist}. Rebuild it with: npm --prefix "${componentDir}" run build`);
        if (failed) return failed;
        usable = false;
      }
      if (usable) return { ok: true, cli: dist, source: "checkout", trace };
    }
  }
  note(`no Alcode checkout at: ${root}`);

  if (!allowGlobal) {
    return { ok: false, code: 2, message: `No Alcode checkout found at ${root}, and global fallback is not opted in. Run inside a checkout, or re-run with --allow-global (or OMO_ULW_LOOP_ALLOW_GLOBAL=1) to intentionally use a global toolkit.`, trace };
  }
  const home = os.homedir();
  const codexHome = process.env.CODEX_HOME && process.env.CODEX_HOME.trim() ? process.env.CODEX_HOME.trim() : path.join(home, ".codex");
  const candidates = [...pathCandidates("omo-agent-toolkit"), path.join(home, ".local", "bin", "omo-agent-toolkit"), path.join(codexHome, "bin", "omo-agent-toolkit")];
  for (const candidate of candidates) {
    note(`probing global candidate: ${candidate}`);
    try {
      if (runGlobalCandidate(candidate)) return { ok: true, cli: candidate, source: "global", trace };
    } catch {
      /* try next */
    }
  }
  return { ok: false, code: 2, message: "Global fallback opted in, but no runnable omo-agent-toolkit was found on PATH or in the fixed bin locations.", trace };
};

const main = () => {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n${usage()}\n`);
    process.exit(2);
  }
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = resolveUlwLoopCli({ root: parsed.root, allowGlobal: parsed.allowGlobal });
  if (parsed.diagnose) {
    for (const line of result.trace || []) process.stderr.write(`[resolve-ulw-loop-cli] ${line}\n`);
  }
  if (!result.ok) {
    process.stderr.write(`${result.message}\n`);
    process.exit(result.code || 2);
  }
  if (parsed.json) process.stdout.write(`${JSON.stringify({ ok: true, cli: result.cli, source: result.source })}\n`);
  else process.stdout.write(`${result.cli}\n`);
};

const invokedDirectly = () => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};
if (invokedDirectly()) main();
