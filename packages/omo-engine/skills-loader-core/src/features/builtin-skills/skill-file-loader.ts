import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { sharedSkillsRootPath } from "../../../../shared-skills/index.mjs"
import { parseFrontmatter } from "../../../../utils/src/index.ts"

type SkillFileReader = (path: string, encoding: "utf8") => string

const currentDir = dirname(fileURLToPath(import.meta.url))
// Skills that live only under the omo-codex plugin keep that folder as their
// single source of truth: the loader reads their bodies in place instead of
// carrying a second copy here.
const omoCodexSkillsRootPath = join(currentDir, "..", "..", "..", "..", "omo-codex", "plugin", "skills")

export function createSharedSkillTemplateLoader(
	readFile: SkillFileReader = readFileSync,
	skillsRootPath: string = sharedSkillsRootPath(),
	fallbackSkillsRootPath: string = omoCodexSkillsRootPath,
): (skillName: string) => string {
	const cache = new Map<string, string>()
	return (skillName) => {
		const cached = cache.get(skillName)
		if (cached !== undefined) return cached
		try {
			const { body } = parseFrontmatter(readFile(join(skillsRootPath, skillName, "SKILL.md"), "utf8"))
			cache.set(skillName, body)
			return body
		} catch (error) {
			if (!(error instanceof Error && Reflect.get(error, "code") === "ENOENT")) {
				throw error
			}
			// Not shipped in shared-skills: resolve from the omo-codex plugin
			// folder, which stays the single source of truth for skills kept
			// there (for example the ULW family) so no body is duplicated.
			const { body } = parseFrontmatter(readFile(join(fallbackSkillsRootPath, skillName, "SKILL.md"), "utf8"))
			cache.set(skillName, body)
			return body
		}
	}
}
const loadSharedSkillTemplateFromDisk = createSharedSkillTemplateLoader()
export function loadSharedSkillTemplate(skillName: string): string {
	return loadSharedSkillTemplateFromDisk(skillName)
}
