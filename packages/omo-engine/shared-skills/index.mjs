import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = dirname(fileURLToPath(import.meta.url))

// Points at the folder that holds one subfolder per shared skill, each with
// its own SKILL.md. Candidates run nearest-first: the folder inside this
// package wins, then the ones a level or two above it, so a checkout that
// lays skills out beside the package still resolves.
export function sharedSkillsRootPath() {
	const candidates = [
		join(packageDir, "skills"),
		join(packageDir, "..", "skills"),
		join(packageDir, "..", "..", "skills"),
	]
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate
	}
	// Nothing on disk: aim at the package-local folder so downstream ENOENT
	// errors name the canonical place to put the skills.
	return candidates[0]
}
