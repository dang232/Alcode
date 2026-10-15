// biome-ignore-all format: smoke test pulls verbatim JSON for structural assertion.
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ULW_LOOP_SUBCOMMANDS } from "../src/cli-commands.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readText(relative: string): Promise<string> {
	return readFile(join(repoRoot, relative), "utf8");
}

async function readJson(relative: string): Promise<unknown> {
	return JSON.parse(await readText(relative));
}

type ShellResult = {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
};

function bootstrapScriptFrom(text: string): string {
	const blockStart = text.indexOf("```sh\n");
	expect(blockStart).toBeGreaterThanOrEqual(0);
	const codeStart = blockStart + "```sh\n".length;
	const blockEnd = text.indexOf("\n```", codeStart);
	expect(blockEnd).toBeGreaterThan(codeStart);
	return text.slice(codeStart, blockEnd);
}

async function runShell(script: string, env: NodeJS.ProcessEnv): Promise<ShellResult> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn("/bin/sh", ["-c", script], { env });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.on("error", reject);
		child.on("close", (code) => {
			resolvePromise({
				code,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			});
		});
	});
}

describe("package.json", () => {
	it("declares ESM + npm + Node >=20", async () => {
		const pkg = await readJson("package.json") as Record<string, unknown>;
		expect(pkg["type"]).toBe("module");
		expect(pkg["packageManager"]).toBe("npm@11.12.1");
		expect((pkg["engines"] as Record<string, unknown>)["node"]).toBe(">=20.0.0");
	});

	it("#given package metadata #when bin is inspected #then exposes the ULW loop binaries pointing at dist/cli.js", async () => {
		const pkg = await readJson("package.json") as Record<string, unknown>;
		const bin = pkg["bin"] as Record<string, string>;
		expect(bin["omo-ulw-loop"]).toBe("./dist/cli.js");
		expect(bin["ulw"]).toBe("./dist/cli.js");
		expect(bin["ulw-loop"]).toBe("./dist/cli.js");
	});

	it("ships the expected files for npm publish", async () => {
		const pkg = await readJson("package.json") as Record<string, unknown>;
		const files = pkg["files"] as readonly string[];
		expect(files).toContain("dist");
		expect(files).toContain("directive.md");
		expect(files).toContain("hooks");
		expect(files).toContain("skills");
		expect(files).not.toContain(".codex-plugin");
	});
});

describe("component plugin identity", () => {
	it("is owned by the aggregate OMO plugin root", async () => {
		await expect(readText(".codex-plugin/plugin.json")).rejects.toMatchObject({ code: "ENOENT" });
	});
});

describe("hooks/hooks.json", () => {
	it("registers UserPromptSubmit with PLUGIN_ROOT interpolation", async () => {
		const hooks = await readJson("hooks/hooks.json") as Record<string, unknown>;
		const events = (hooks["hooks"] as Record<string, unknown>)["UserPromptSubmit"] as readonly Record<string, unknown>[];
		expect(events.length).toBeGreaterThan(0);
		const command = (events[0]?.["hooks"] as readonly Record<string, unknown>[] | undefined)?.[0]?.["command"];
		expect(command).toEqual(expect.any(String));
		expect(command).toContain(`$${"{PLUGIN_ROOT}"}`);
		expect(command).toContain("dist/cli.js");
		expect(command).toContain("hook user-prompt-submit");
		expect(command).toContain("--with-ultrawork");
	});

	it("#given ulw-loop component is enabled #when hooks are inspected #then create_goal PreToolUse guard is registered", async () => {
		const text = await readText("hooks/hooks.json");

		expect(text).toContain('"PreToolUse"');
		expect(text).toContain('"matcher": "^create_goal$"');
		expect(text).toContain("hook pre-tool-use");
	});
});

describe("src/cli.ts", () => {
	it("starts with #!/usr/bin/env node shebang", async () => {
		const text = await readText("src/cli.ts");
		expect(text.split("\n")[0]).toBe("#!/usr/bin/env node");
	});
});

describe("dist/cli.js", () => {
	it("#given a working directory outside the engine checkout #when the loop entry is launched #then it starts without resolving anything relative to cwd", async () => {
		// given: a foreign cwd (e.g. a user home dir), no OMO_ULW_LOOP_CLI
		const root = await mkdtemp(join(tmpdir(), "omo-ulw-loop-foreign-cwd-"));
		try {
			// when: the absolute dist entry is launched from that cwd
			const child = spawn(process.execPath, [join(repoRoot, "dist", "cli.js"), "ulw-loop", "help"], { cwd: root });
			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];
			child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
			child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
			const code: number | null = await new Promise((resolvePromise) => child.on("close", resolvePromise));
			// then: clean start, help text, no stderr
			expect(code).toBe(0);
			expect(Buffer.concat(stdout).toString("utf8")).toContain("ulw-loop");
			expect(Buffer.concat(stderr).toString("utf8")).toBe("");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("skills/ulw-loop/SKILL.md", () => {
	it("exists", async () => {
		const info = await stat(join(repoRoot, "skills/ulw-loop/SKILL.md"));
		expect(info.isFile()).toBe(true);
	});

	it("#given Codex skill hinting #when ulw-loop skill metadata is inspected #then ulw-loop is the primary mention name", async () => {
		const text = await readText("skills/ulw-loop/SKILL.md");

		expect(text).toMatch(/^---\nname: ulw-loop\n/m);
	});

	it("#given Codex dollar hinting #when querying ulw-loop #then ulw-loop surfaces the ulw-loop alias", async () => {
		const text = await readText("skills/ulw-loop/agents/openai.yaml");

		expect(text).toContain('display_name: "(OmO) ulw-loop"');
		expect(text).toContain('short_description: "Goal-like ultrawork loop for systematic decomposition"');
	});

	it("#given Codex dollar hinting #when querying ulw-loop #then ulw-loop remains discoverable as an alias", async () => {
		const text = await readText("skills/ulw-loop/agents/openai.yaml");

		expect(text).toContain("search_terms:");
		expect(text).toContain('- "ulw-loop"');
	});

	it.skipIf(process.platform === "win32")(
		"#given PATH omo-agent-toolkit lacks ulw-loop #when bootstrap runs #then falls back to fixed local bin",
		async () => {
		const text = await readText("skills/ulw-loop/references/full-workflow.md");
		const bootstrap = bootstrapScriptFrom(text);
		const root = await mkdtemp(join(tmpdir(), "omo-ulw-loop-bootstrap-"));
		try {
			const badBin = join(root, "bad-bin");
			const home = join(root, "home");
			const codexHome = join(home, ".codex");
			const fixedBin = join(codexHome, "bin", "omo-agent-toolkit");
			await mkdir(badBin, { recursive: true });
			await mkdir(dirname(fixedBin), { recursive: true });
			await writeFile(join(badBin, "omo-agent-toolkit"), ["#!/bin/sh", "exit 1", ""].join("\n"));
			await chmod(join(badBin, "omo-agent-toolkit"), 0o755);
			await writeFile(fixedBin, ["#!/bin/sh", "if [ \"$1\" = 'ulw-loop' ] && [ \"$2\" = 'help' ]; then exit 0; fi", "if [ \"$1\" = 'ulw-loop' ] && [ \"$2\" = 'status' ]; then echo marker-fixed-local-bin; exit 0; fi", "exit 1", ""].join("\n"));
			await chmod(fixedBin, 0o755);
			const result = await runShell(`${bootstrap}\n"$ULW_LOOP_NODE" "$ULW_LOOP_CLI" ulw-loop status --json`, {
				...process.env,
				CODEX_HOME: codexHome,
				HOME: home,
				PATH: `${badBin}:${process.env["PATH"] ?? ""}`,
			});

			expect(result.code).toBe(0);
			expect(result.stdout).toContain('marker-fixed-local-bin');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === "win32")(
		"#given explicit env CLI plus fixed fallback #when bootstrap runs #then env CLI wins and is not overwritten",
		async () => {
		const text = await readText("skills/ulw-loop/references/full-workflow.md");
		const bootstrap = bootstrapScriptFrom(text);
		const root = await mkdtemp(join(tmpdir(), "omo-ulw-loop-bootstrap-env-"));
		try {
			const badBin = join(root, "bad-bin");
			const home = join(root, "home");
			const codexHome = join(home, ".codex");
			const fixedBin = join(codexHome, "bin", "omo-agent-toolkit");
			const envCli = join(root, "env-cli.js");
			await mkdir(badBin, { recursive: true });
			await mkdir(dirname(fixedBin), { recursive: true });
			await writeFile(join(badBin, "omo-agent-toolkit"), ["#!/bin/sh", "exit 1", ""].join("\n"));
			await chmod(join(badBin, "omo-agent-toolkit"), 0o755);
			await writeFile(fixedBin, ["#!/bin/sh", "if [ \"$1\" = 'ulw-loop' ] && [ \"$2\" = 'help' ]; then exit 0; fi", "if [ \"$1\" = 'ulw-loop' ] && [ \"$2\" = 'status' ]; then echo marker-fixed-local-bin; exit 0; fi", "exit 1", ""].join("\n"));
			await chmod(fixedBin, 0o755);
			await writeFile(envCli, ["#!/usr/bin/env node", "if (process.argv[2] === 'ulw-loop' && process.argv[3] === 'help') process.exit(0);", "if (process.argv[2] === 'ulw-loop' && process.argv[3] === 'status') { console.log('marker-env-cli'); process.exit(0); }", "process.exit(1);", ""].join("\n"));
			const result = await runShell(`${bootstrap}\n"$ULW_LOOP_NODE" "$ULW_LOOP_CLI" ulw-loop status --json`, {
				...process.env,
				OMO_ULW_LOOP_CLI: envCli,
				CODEX_HOME: codexHome,
				HOME: home,
				PATH: `${badBin}:${process.env["PATH"] ?? ""}`,
			});
			expect(result.code).toBe(0);
			expect(result.stdout).toContain('marker-env-cli');
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

});

	describe("README implementation contract", () => {
	it("#given the README #when subcommands are inspected #then every implemented CLI subcommand is documented", async () => {
		const readme = await readText("README.md");

		for (const subcommand of ULW_LOOP_SUBCOMMANDS) {
			expect(readme, `README documents \`omo-agent-toolkit ulw-loop ${subcommand}\``).toContain(`omo-agent-toolkit ulw-loop ${subcommand}`);
		}
	});

	it("#given the README #when hooks are described #then both hook channels are documented", async () => {
		const readme = await readText("README.md");

		expect(readme).toContain("UserPromptSubmit");
		expect(readme).toContain("user-prompt-submit");
		expect(readme).toContain("PreToolUse");
		expect(readme).toContain("pre-tool-use");
	});

	it("#given the README #when the quality gate is described #then criteriaCoverage is named", async () => {
		const readme = await readText("README.md");

		expect(readme).toContain("criteriaCoverage");
	});
});
