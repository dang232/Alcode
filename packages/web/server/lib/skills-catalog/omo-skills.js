import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { parseMdFile, SKILL_DIR, writeMdFile } from '../opencode/shared.js';

// OmO skill bundle: independently authored, Alcode-compatible instructions
// for the OmO workflow skills, shipped as read-only packaged resources.
//
// What this module does and does not do:
// - Lists the 8 bundled skills by reading their SKILL.md from disk per item,
//   so a damaged file is listed as unavailable with its reason, never a
//   silent omission and never a failed catalog.
// - Installs a named skill by copying its SKILL.md bytes into a managed root
//   (user or project scope) with no-overwrite, so existing discovery picks
//   it up with no re-resolution anywhere else.
// - Never writes a default into the user's workspace automatically, never
//   injects the catalog into a model request: content loads on demand through
//   the existing skill resolution paths once installed.
// - `init-deep` is deliberately absent: the engine registry already ships it
//   as a read-only builtin, and a second same-named builtin would collide in
//   the loader's name matcher.

export const OMO_SKILLS_VERSION = 1;
export const OMO_SKILLS_SOURCE_ID = 'omo';
const OMO_SKILLS_SOURCE_TYPE = 'omo';

const OMO_SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

const OMO_SKILL_NAMES = [
  'ultrawork',
  'ulw-loop',
  'ulw-plan',
  'ulw-research',
  'mass-ulw',
  'hyperplan',
  'onboarding',
  'dag-library',
];

const bundleDir = path.dirname(fileURLToPath(import.meta.url));

const skillFileFor = (name) => path.join(bundleDir, 'omo-skills', name, 'SKILL.md');

const isValidSkillName = (name) => (
  typeof name === 'string'
  && name.length <= 64
  && OMO_SKILL_NAME_PATTERN.test(name)
);

const normalizeName = (name) => String(name || '').trim().toLowerCase();

const firstLine = (error) => String(error?.message || error || 'unknown error').split('\n')[0];

const readBundleSkill = (name) => {
  const file = skillFileFor(name);
  try {
    const parsed = parseMdFile(file);
    const frontmatter = parsed.frontmatter || {};
    const skillName = String(frontmatter.name || name);
    if (!isValidSkillName(skillName)) {
      return { ok: false, error: `bundle skill "${name}" declares an invalid skill name` };
    }
    return {
      ok: true,
      item: {
        skillName,
        description: String(frontmatter.description || ''),
        compatibility: frontmatter.compatibility ?? null,
        requires: frontmatter.metadata?.requires ?? null,
        template: parsed.body || '',
      },
    };
  } catch (error) {
    return { ok: false, error: `bundle skill "${name}" unreadable: ${firstLine(error)}` };
  }
};

export function listOmoSkills() {
  const items = [];
  for (const name of OMO_SKILL_NAMES) {
    const read = readBundleSkill(name);
    if (!read.ok) {
      items.push({
        sourceId: OMO_SKILLS_SOURCE_ID,
        repoSource: OMO_SKILLS_SOURCE_ID,
        skillDir: name,
        skillName: name,
        description: `OmO skill "${name}" (currently unloadable: ${read.error})`,
        installable: false,
        warnings: [`bundle source unavailable: ${read.error}`],
        invokeAtRuntime: 'out',
        invokeReason: `bundle-source-missing: ${read.error}`,
        variant: name,
      });
      continue;
    }
    items.push({
      sourceId: OMO_SKILLS_SOURCE_ID,
      repoSource: OMO_SKILLS_SOURCE_ID,
      skillDir: name,
      skillName: read.item.skillName,
      description: read.item.description,
      installable: true,
      warnings: [],
      invokeAtRuntime: 'in',
      invokeReason: 'active-in-loader',
      variant: name,
      compatibility: read.item.compatibility,
      requires: read.item.requires,
    });
  }
  return { ok: true, items };
}

export function resolveOmoSkillForInstall(items, requestedName) {
  const rawName = String(requestedName ?? '');
  if (!isValidSkillName(rawName)) {
    return {
      ok: false,
      error: {
        kind: 'invalid_skill_name',
        message: `Invalid OmO skill name "${requestedName}". Use 1-64 lowercase alphanumerics with hyphens.`,
      },
    };
  }
  const normalized = normalizeName(rawName);
  const matches = (items || []).filter((item) => normalizeName(item.skillName) === normalized);
  if (matches.length === 0) {
    const suggestions = (items || [])
      .map((item) => item.skillName)
      .filter((name) => name.includes(normalized) || normalized.includes(name))
      .slice(0, 5);
    return {
      ok: false,
      error: { kind: 'missing_skill', message: `OmO skill "${rawName}" not found in the OmO catalog.`, suggestions },
    };
  }
  const item = matches[0];
  if (!item.installable) {
    return {
      ok: false,
      error: {
        kind: 'omo_skill_unavailable',
        message: `OmO skill "${item.skillName}" cannot be installed here: ${(item.warnings || []).join('; ') || 'source unavailable'}.`,
      },
    };
  }
  return { ok: true, item };
}

export function installOmoSkill({
  skillName,
  scope = 'user',
  workingDirectory = null,
  userSkillDir = SKILL_DIR,
  writeSkillFile = writeMdFile,
} = {}) {
  if (scope !== 'user' && scope !== 'project') {
    return {
      ok: false,
      error: { kind: 'invalid_scope', message: `Invalid scope "${scope}". Use "user" or "project".` },
    };
  }
  if (scope === 'project' && String(workingDirectory || '').length === 0) {
    return {
      ok: false,
      error: { kind: 'invalid_scope', message: 'Project installs require a working directory.' },
    };
  }
  const listed = listOmoSkills();
  const resolved = resolveOmoSkillForInstall(listed.items, skillName);
  if (!resolved.ok) {
    return resolved;
  }
  const read = readBundleSkill(resolved.item.variant);
  if (!read.ok) {
    return {
      ok: false,
      error: { kind: 'omo_skill_unavailable', message: `OmO skill "${resolved.item.skillName}" cannot be installed here: ${read.error}.` },
    };
  }
  const canonicalName = read.item.skillName;
  const scopeRoot = scope === 'project'
    ? path.join(path.resolve(workingDirectory), '.opencode', 'skills')
    : path.resolve(userSkillDir);
  const resolvedTarget = path.resolve(path.join(scopeRoot, canonicalName));
  if (resolvedTarget !== path.join(scopeRoot, canonicalName) || !resolvedTarget.startsWith(`${scopeRoot}${path.sep}`)) {
    return {
      ok: false,
      error: { kind: 'invalid_skill_name', message: `OmO skill "${canonicalName}" resolves outside the managed skill root; refusing install.` },
    };
  }
  const targetPath = path.join(resolvedTarget, 'SKILL.md');
  if (fs.existsSync(targetPath) || fs.existsSync(resolvedTarget)) {
    return {
      ok: false,
      error: {
        kind: 'already_installed',
        message: `OmO skill "${canonicalName}" is already installed at ${resolvedTarget}; refusing to overwrite.`,
        path: resolvedTarget,
      },
    };
  }
  const frontmatter = { name: canonicalName, description: read.item.description };
  if (read.item.compatibility) frontmatter.compatibility = read.item.compatibility;
  try {
    fs.mkdirSync(resolvedTarget, { recursive: true });
    writeSkillFile(targetPath, frontmatter, read.item.template);
  } catch (error) {
    return {
      ok: false,
      error: { kind: 'unknown', message: `Failed to install OmO skill "${canonicalName}": ${firstLine(error)}` },
    };
  }
  return {
    ok: true,
    installed: [{ skillName: canonicalName, scope, source: 'omo', path: targetPath }],
    skipped: [],
  };
}

// Route wiring seam: one explicit dependency object for skill-routes so the
// route file stays thin.
export function createOmoSkillCatalog({ userSkillDir = SKILL_DIR, writeSkillFile = writeMdFile } = {}) {
  return {
    source: {
      id: OMO_SKILLS_SOURCE_ID,
      label: 'OmO skills',
      description: 'Bundled OmO workflow skills (versioned read-only defaults)',
      source: OMO_SKILLS_SOURCE_ID,
      sourceType: OMO_SKILLS_SOURCE_TYPE,
      version: OMO_SKILLS_VERSION,
    },
    listItems: (options = {}) => listOmoSkills(options),
    install: (options = {}) => installOmoSkill({ userSkillDir, writeSkillFile, ...options }),
  };
}
