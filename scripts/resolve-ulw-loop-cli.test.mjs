// Regression tests for the authoritative ULW CLI resolver.
//
// Every case spawns scripts/resolve-ulw-loop-cli.mjs as a child process with
// a fully controlled environment (PATH, HOME, OMO_*), so no test can touch
// the developer's real global toolkit. Fixture checkouts live under the
// OS temp dir, including one path containing spaces.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resolver = path.join(repoRoot, "scripts", "resolve-ulw-loop-cli.mjs");
const COMPONENT_REL = path.join(
  "packages", "omo-engine", "omo-codex", "plugin", "components", "ulw-loop",
);

const FAKE_HELP_JS = `#!/usr/bin/env node
if (process.argv.includes("help")) {
  console.log("mock ulw-loop: create-goals status checkpoint");
  process.exit(0);
}
process.exit(1);
`;

const cleanEnv = (overrides = {}) => {
  const env = { ...process.env };
  delete env.OMO_ULW_LOOP_CLI;
  delete env.OMO_ULW_LOOP_ALLOW_GLOBAL;
  delete env.CODEX_HOME;
  return { ...env, ...overrides };
};

const makeCheckout = (root, { stale = false } = {}) => {
  fs.mkdirSync(path.join(root, "packages"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "alcode-monorepo" }));
  const srcDir = path.join(root, COMPONENT_REL, "src");
  const distDir = path.join(root, COMPONENT_REL, "dist");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "cli.ts"), "// fixture source\n");
  const distCli = path.join(distDir, "cli.js");
  fs.writeFileSync(distCli, FAKE_HELP_JS);
  if (stale) {
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(srcDir, "cli.ts"), future, future);
  }
  return { root, distCli };
};

const makeGlobalToolkit = (binDir) => {
  fs.mkdirSync(binDir, { recursive: true });
  const name = process.platform === "win32" ? "omo-agent-toolkit.cmd" : "omo-agent-toolkit";
  const full = path.join(binDir, name);
  const body = process.platform === "win32"
    ? "@echo off\r\necho mock global toolkit: create-goals status checkpoint\r\n"
    : "#!/bin/sh\necho 'mock global toolkit: create-goals status checkpoint'\n";
  fs.writeFileSync(full, body);
  if (process.platform !== "win32") fs.chmodSync(full, 0o755);
  return full;
};

const systemPath = () => {
  const parts = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  if (process.platform === "win32" && !parts.some((p) => /^c:\\windows\\system32$/i.test(p))) {
    parts.push("C:\\Windows\\System32");
  }
  return parts.join(path.delimiter);
};

const runResolver = (args, env) => spawnSync(process.execPath, [resolver, ...args], {
  encoding: "utf8",
  timeout: 60_000,
  windowsHide: true,
  env,
});

const withTemp = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ulw-resolve-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const makeForeignProject = (dir) => {
  const foreign = path.join(dir, "tokenpanel");
  fs.mkdirSync(foreign, { recursive: true });
  fs.writeFileSync(path.join(foreign, "package.json"), JSON.stringify({ name: "tokenpanel" }));
  return foreign;
};

const makeInstall = (dir) => {
  const install = path.join(dir, "install", "ulw-loop-cli");
  fs.mkdirSync(path.join(install, "dist"), { recursive: true });
  fs.copyFileSync(resolver, path.join(install, "resolve-ulw-loop-cli.mjs"));
  fs.writeFileSync(path.join(install, "directive.md"), "# fixture bundle marker\n");
  return install;
};

const runInstalled = (install, foreign, env, args) => spawnSync(process.execPath, [path.join(install, "resolve-ulw-loop-cli.mjs"), ...args], {
  encoding: "utf8",
  timeout: 60_000,
  windowsHide: true,
  cwd: foreign,
  env,
});

describe("resolve-ulw-loop-cli", () => {
  it("honors an explicit valid OMO_ULW_LOOP_CLI override", () => {
    withTemp((dir) => {
      const checkout = makeCheckout(path.join(dir, "co"));
      const env = cleanEnv({ OMO_ULW_LOOP_CLI: checkout.distCli });
      const result = runResolver(["--root", checkout.root, "--json"], env);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { ok: true, cli: checkout.distCli, source: "override" });
    });
  });

  it("rejects an invalid explicit override instead of falling through", () => {
    withTemp((dir) => {
      const checkout = makeCheckout(path.join(dir, "co"));
      const missing = path.join(dir, "nope", "cli.js");
      const env = cleanEnv({ OMO_ULW_LOOP_CLI: missing });
      const result = runResolver(["--root", checkout.root], env);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /OMO_ULW_LOOP_CLI/);
      assert.match(result.stderr, new RegExp(missing.replace(/\\/g, "\\\\")));
      assert.equal(result.stdout, "");
    });
  });

  it("prefers a valid checkout CLI over a global toolkit on PATH", () => {
    withTemp((dir) => {
      const checkout = makeCheckout(path.join(dir, "co"));
      const binDir = path.join(dir, "bin");
      makeGlobalToolkit(binDir);
      const env = cleanEnv({ PATH: `${binDir}${path.delimiter}${systemPath()}`, HOME: path.join(dir, "home") });
      const result = runResolver(["--root", checkout.root, "--json"], env);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { ok: true, cli: checkout.distCli, source: "checkout" });
    });
  });

  it("fails loudly with the build command when the checkout build is missing", () => {
    withTemp((dir) => {
      const root = path.join(dir, "co");
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "alcode-monorepo" }));
      const env = cleanEnv({ HOME: path.join(dir, "home") });
      const result = runResolver(["--root", root], env);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /not built/);
      assert.match(result.stderr, /npm --prefix .* run build/);
      assert.equal(result.stdout, "");
    });
  });

  it("fails loudly with the build command when the checkout build is stale", () => {
    withTemp((dir) => {
      const checkout = makeCheckout(path.join(dir, "co"), { stale: true });
      const env = cleanEnv({ HOME: path.join(dir, "home") });
      const result = runResolver(["--root", checkout.root], env);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /stale/);
      assert.match(result.stderr, /npm --prefix .* run build/);
      assert.equal(result.stdout, "");
    });
  });

  it("uses the global toolkit outside a checkout only with explicit opt-in", () => {
    withTemp((dir) => {
      const plain = path.join(dir, "plain");
      fs.mkdirSync(plain, { recursive: true });
      const binDir = path.join(dir, "bin");
      const toolkit = makeGlobalToolkit(binDir);
      const home = path.join(dir, "home");
      const baseEnv = cleanEnv({ PATH: `${binDir}${path.delimiter}${systemPath()}`, HOME: home });
      const denied = runResolver(["--root", plain], baseEnv);
      assert.equal(denied.status, 2);
      assert.match(denied.stderr, /--allow-global/);
      const allowed = runResolver(["--root", plain, "--allow-global", "--json"], baseEnv);
      assert.equal(allowed.status, 0, allowed.stderr);
      const parsed = JSON.parse(allowed.stdout);
      assert.equal(parsed.source, "global");
      assert.equal(parsed.cli, process.platform === "win32" ? toolkit : toolkit);
    });
  });

  it("resolves paths containing spaces and Windows separators", () => {
    withTemp((dir) => {
      const checkout = makeCheckout(path.join(dir, "my co"));
      const env = cleanEnv({ HOME: path.join(dir, "home") });
      const result = runResolver(["--root", checkout.root, "--json"], env);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { ok: true, cli: checkout.distCli, source: "checkout" });
    });
  });

  it("pins one CLI for a whole workflow via the override", () => {
    withTemp((dir) => {
      const checkout = makeCheckout(path.join(dir, "co"));
      const first = runResolver(["--root", checkout.root, "--json"], cleanEnv({ HOME: path.join(dir, "home") }));
      assert.equal(first.status, 0, first.stderr);
      const cli = JSON.parse(first.stdout).cli;
      const pinned = runResolver(
        ["--root", checkout.root, "--json"],
        cleanEnv({ HOME: path.join(dir, "home"), OMO_ULW_LOOP_CLI: cli }),
      );
      assert.equal(pinned.status, 0, pinned.stderr);
      assert.equal(JSON.parse(pinned.stdout).cli, cli);
      const help = spawnSync(process.execPath, [cli, "ulw-loop", "help"], { encoding: "utf8", timeout: 30_000, windowsHide: true });
      assert.equal(help.status, 0);
      assert.match(help.stdout, /create-goals/);
    });
  });

  it("managed workflow docs route every runnable command through the resolver", () => {
    const roots = [
      path.join(repoRoot, "packages", "omo-engine", "omo-codex", "plugin", "skills", "ulw-loop", "SKILL.md"),
      path.join(repoRoot, "packages", "omo-engine", "omo-codex", "plugin", "skills", "ulw-loop", "references", "full-workflow.md"),
      path.join(repoRoot, "packages", "ui", "src", "lib", "ulwWorkflow.ts"),
    ];
    // Only shell fences carry runnable commands; json fences hold example
    // ledger payloads (data, not instructions) and prose keeps descriptive
    // mentions of the deployed surface. Every runnable line must go through
    // the resolved $ULW_LOOP_CLI (or name the resolver / opt-in explicitly).
    const runnable = /(^|[\s`("'])omo-agent-toolkit\s+ulw-loop\s+[a-z][\w-]*/;
    const offenders = [];
    for (const file of roots) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      let fence = "";
      for (const line of lines) {
        const marker = line.match(/^\s*```(\w*)/);
        if (marker) {
          fence = fence ? "" : marker[1] || "plain";
          continue;
        }
        if (!["sh", "bash", "powershell", "ps1", "plain"].includes(fence)) continue;
        if (runnable.test(line) && !/ULW_LOOP_CLI|resolve-ulw-loop-cli|installer|PATH absence/.test(line)) {
          offenders.push(`${path.basename(file)}: ${line.trim().slice(0, 120)}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("Electron keeps exporting the staged CLI path", () => {
    const main = fs.readFileSync(path.join(repoRoot, "packages", "electron", "main.mjs"), "utf8");
    assert.match(main, /process\.env\.OMO_ULW_LOOP_CLI\s*=\s*stagedUlwLoopCli/);
    assert.match(main, /process\.env\.OMO_ULW_LOOP_RESOLVER\s*=\s*stagedUlwLoopResolver/);
    const prepare = fs.readFileSync(path.join(repoRoot, "packages", "electron", "scripts", "prepare-ulw-loop-cli.mjs"), "utf8");
    assert.match(prepare, /ulw-loop-cli/);
    assert.match(prepare, /dist.*cli\.js/);
    assert.match(prepare, /resolve-ulw-loop-cli\.mjs/);
  });

  it("resolves an installed bundle next to the invoked script, not the cwd project", () => {
    withTemp((dir) => {
      const foreign = makeForeignProject(dir);
      const install = makeInstall(dir);
      const distCli = path.join(install, "dist", "cli.js");
      fs.writeFileSync(distCli, FAKE_HELP_JS);
      const binDir = path.join(dir, "bin");
      makeGlobalToolkit(binDir);
      const env = cleanEnv({
        PATH: `${binDir}${path.delimiter}${systemPath()}`,
        HOME: path.join(dir, "home"),
      });
      const resolved = runInstalled(install, foreign, env, ["--json"]);
      assert.equal(resolved.status, 0, resolved.stderr);
      assert.deepEqual(JSON.parse(resolved.stdout), { ok: true, cli: distCli, source: "staged" });
    });
  });

  it("a broken staged bundle fails with restage guidance, never the global", () => {
    withTemp((dir) => {
      const foreign = makeForeignProject(dir);
      const install = makeInstall(dir);
      const binDir = path.join(dir, "bin");
      makeGlobalToolkit(binDir);
      const env = cleanEnv({
        PATH: `${binDir}${path.delimiter}${systemPath()}`,
        HOME: path.join(dir, "home"),
      });
      // dist/ present but unrunnable.
      fs.writeFileSync(path.join(install, "dist", "cli.js"), "process.exit(3);\n");
      const broken = runInstalled(install, foreign, env, []);
      assert.equal(broken.status, 2);
      assert.match(broken.stderr, /prepare-ulw-loop-cli|rebuild/);
      assert.equal(broken.stdout, "");
      // dist/ absent entirely.
      fs.rmSync(path.join(install, "dist", "cli.js"));
      const missing = runInstalled(install, foreign, env, []);
      assert.equal(missing.status, 2);
      assert.match(missing.stderr, /prepare-ulw-loop-cli|rebuild/);
      assert.equal(missing.stdout, "");
    });
  });
});
