import { describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Packaged-runtime resolution guard (row 7).
 *
 * The packaged Electron server imports the loader's skill matcher and the
 * git-master skill module with plain-node ESM (type-stripped, no
 * bundler-style extension probing). A relative import without an explicit
 * extension loads under bun/vite but throws ERR_MODULE_NOT_FOUND in the
 * packaged app, so every value import on this path must name its file.
 *
 * `import type` lines are erased before resolution and are exempt.
 */
const PACKAGED_CONSUMED_FILES = [
	"./skill-matcher.ts",
	"./index.ts",
	"./scope-priority.ts",
	"../../features/builtin-skills/skills/git-master.ts",
	"../../features/builtin-skills/skills/git-master-skill-metadata.ts",
	"../../features/builtin-skills/skills/git-master-sections/commit-workflow.ts",
	"../../features/builtin-skills/skills/git-master-sections/commit-atomic-planning.ts",
	"../../features/builtin-skills/skills/git-master-sections/commit-context-analysis.ts",
	"../../features/builtin-skills/skills/git-master-sections/commit-execution-verification.ts",
	"../../features/builtin-skills/skills/git-master-sections/history-search-workflow.ts",
	"../../features/builtin-skills/skills/git-master-sections/overview.ts",
	"../../features/builtin-skills/skills/git-master-sections/quick-reference.ts",
	"../../features/builtin-skills/skills/git-master-sections/rebase-workflow.ts",
] as const

const RELATIVE_SPECIFIER = /^\.{1,2}\//

function valueImportSpecifiers(source: string): string[] {
	const found: string[] = []
	for (const line of source.split("\n")) {
		const trimmed = line.trim()
		if (trimmed.startsWith("import type ") || trimmed.startsWith("export type ")) continue
		const match = /\bfrom\s+["']([^"']+)["']/.exec(trimmed)
		if (match?.[1] && RELATIVE_SPECIFIER.test(match[1])) found.push(match[1])
	}
	return found
}

describe("packaged node ESM resolution", () => {
	it("names explicit file extensions on every value import in the packaged-consumed files", async () => {
		for (const relative of PACKAGED_CONSUMED_FILES) {
			const source = await Bun.file(new URL(relative, import.meta.url)).text()
			for (const specifier of valueImportSpecifiers(source)) {
				expect(`${relative} :: ${specifier}`).toMatch(/\.(ts|js|mjs|cjs|json)$/)
			}
		}
	})

	it("imports the matcher and the git-master skill under plain node", async () => {
		const nodeBin = Bun.which("node")
		if (!nodeBin) return
		// Probe file (not `-e`): keeps quoting identical on every host shell.
		const probePath = join(tmpdir(), "omo-row7-node-probe.mjs")
		await Bun.write(
			probePath,
			`import { pathToFileURL } from "node:url";\n` +
				`const ns = await import(pathToFileURL(process.argv[2]).href);\n` +
				`console.log(process.argv[3] + "=" + Object.keys(ns).join(","));\n`,
		)
		const dir = fileURLToPath(new URL("./", import.meta.url))
		const targets = [
			`${dir}skill-matcher.ts?matcher`,
			`${dir}../../features/builtin-skills/skills/git-master.ts?skill`,
		]
		for (const target of targets) {
			const parts = target.split("?")
			const file = parts[0] ?? target
			const marker = parts[1] ?? target
			const absolute = resolve(file)
			const result = spawnSync(nodeBin, [probePath, absolute, marker], { encoding: "utf8" })
			expect(`plain-node import of ${file} (status=${result.status} ${result.stderr.trim()}): ` + result.status).toBe(`plain-node import of ${file} (status=0 ): 0`)
			expect(result.stdout).toContain(marker)
		}
	})
})
