import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { SKILL_DIR, writeMdFile } from '../opencode/shared.js';

// Engine skill catalog: wires the vendored OmO skills-loader builtin skills
// (packages/omo-engine/skills-loader-core) into the app skill catalog.
//
// What this module does and does not do:
// - Lists the loader's registered builtin skills with per-item invoke status.
// - Installs a named engine skill by materializing its SKILL.md under a
//   managed root (user or project scope), so the existing OpenCode-config
//   discovery picks it up with no re-resolution anywhere else.
// - Never replaces app OpenCode-config skills, never touches bridge/pane
//   skill resolution, and never executes SKILL.md content: templates are
//   data, copied byte-identical.
//
// Loader reality: the loader barrel (`builtin-skills`, `loader.ts`) is not
// importable as a whole in this checkout — several builtin modules and the
// discovery loader depend on `packages/omo-engine/shared-skills`, which was
// never vendored, and two modules use a bun-only text import. Every engine
// import below is therefore isolated and fallible: one unloadable skill is
// listed as unavailable with its reason, never a silent omission and never
// a failed catalog.

export const ENGINE_CATALOG_SOURCE_ID = 'engine';
const ENGINE_CATALOG_SOURCE_TYPE = 'engine';

const ENGINE_SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const ENGINE_SKILL_NAME_MAX_LENGTH = 64;

// Registry of the builtin skills `createBuiltinSkills()` registers
// (skills-loader-core/src/features/builtin-skills/skills.ts, verified
// against its source). `variant` is the catalog key; `skillName` is the
// loader name. Two variants share the loader name "playwright" (the factory
// picks one by `browserProvider`); the catalog lists both and refuses to
// guess between them at install time.
const BUILTIN_SKILLS_RELDIR = 'skills-loader-core/src/features/builtin-skills/skills';

export const ENGINE_SKILL_REGISTRY = [
  { variant: 'dev-browser', skillName: 'dev-browser', module: `${BUILTIN_SKILLS_RELDIR}/dev-browser.ts`, kind: 'browser', provider: 'dev-browser' },
  { variant: 'playwright', skillName: 'playwright', module: `${BUILTIN_SKILLS_RELDIR}/playwright.ts`, kind: 'browser', provider: 'playwright' },
  { variant: 'playwright-cli', skillName: 'playwright', module: `${BUILTIN_SKILLS_RELDIR}/playwright-cli.ts`, kind: 'browser', provider: 'playwright-cli' },
  { variant: 'frontend', skillName: 'frontend', module: `${BUILTIN_SKILLS_RELDIR}/frontend.ts`, kind: 'standard' },
  { variant: 'git-master', skillName: 'git-master', module: `${BUILTIN_SKILLS_RELDIR}/git-master.ts`, kind: 'standard' },
  { variant: 'review-work', skillName: 'review-work', module: `${BUILTIN_SKILLS_RELDIR}/review-work.ts`, kind: 'standard' },
  { variant: 'remove-ai-slops', skillName: 'remove-ai-slops', module: `${BUILTIN_SKILLS_RELDIR}/remove-ai-slops.ts`, kind: 'standard' },
  { variant: 'init-deep', skillName: 'init-deep', module: `${BUILTIN_SKILLS_RELDIR}/init-deep.ts`, kind: 'standard' },
  { variant: 'debugging', skillName: 'debugging', module: `${BUILTIN_SKILLS_RELDIR}/debugging.ts`, kind: 'standard' },
  { variant: 'security-research', skillName: 'security-research', module: `${BUILTIN_SKILLS_RELDIR}/security-research.ts`, kind: 'standard' },
  { variant: 'security-review', skillName: 'security-review', module: `${BUILTIN_SKILLS_RELDIR}/security-review.ts`, kind: 'standard' },
  { variant: 'visual-qa', skillName: 'visual-qa', module: `${BUILTIN_SKILLS_RELDIR}/visual-qa.ts`, kind: 'standard' },
  { variant: 'team-mode', skillName: 'team-mode', module: `${BUILTIN_SKILLS_RELDIR}/team-mode.ts`, kind: 'conditional' },
];

const SKILL_MATCHER_RELFILE = 'skills-loader-core/src/tools/skill/skill-matcher.ts';

const firstLine = (value) => String(value?.message ?? value ?? 'unknown error').split('\n')[0].slice(0, 300);

// Boundary text decoder (no `typeof`: mirrors the `value?.trim?.()` guard
// idiom used across the server runtime): non-text input decodes to ''.
const decodedText = (value) => value?.trim?.() ?? '';

const asTextOrNull = (value) => {
  const text = value?.trim?.();
  return text === undefined ? null : text;
};

const isValidSkillName = (name) => {
  const text = decodedText(name);
  return text.length > 0
    && text.length <= ENGINE_SKILL_NAME_MAX_LENGTH
    && ENGINE_SKILL_NAME_PATTERN.test(text);
};

// Engine root: explicit override first (tests, containers), else the
// vendored `packages/omo-engine` beside this checkout, else the engine copy
// the installer stages under the Electron resources dir (`resources/omo-engine`
// via the electron-builder extraResources entry). A root counts only
// when the loader package marker is on disk, so a checkout without the
// engine (or a bare install) degrades to `engine_unavailable` instead of a
// half-resolved catalog. Plain-node dev/test runs have no
// `process.resourcesPath`, so their resolution is unchanged.
export function resolveEngineRoot({ env = process.env, moduleDir = path.dirname(fileURLToPath(import.meta.url)) } = {}) {
  const override = decodedText(env?.OMO_ENGINE_ROOT);
  const candidates = [];
  if (override) candidates.push(path.resolve(override));
  candidates.push(path.resolve(moduleDir, '..', '..', '..', '..', 'omo-engine'));
  const packagedResources = typeof process?.resourcesPath === 'string' ? process.resourcesPath : '';
  if (packagedResources) candidates.push(path.join(packagedResources, 'omo-engine'));
  for (const candidate of candidates) {
    try {
      if (fs.statSync(path.join(candidate, 'skills-loader-core', 'package.json')).isFile()) {
        return candidate;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const defaultImportModule = (specifier) => import(specifier);

const toModuleUrl = (engineRoot, relPath) => pathToFileURL(path.join(engineRoot, relPath)).href;

// Loads the loader's own name matcher (`matchSkillByName`: exact wins,
// unique short name resolves, ambiguous short names refuse). Never
// reimplemented here: a runtime that cannot import the matcher answers
// `engine_unavailable` instead of a local approximation of its contract.
async function loadLoaderMatcher(engineRoot, importSkillModule) {
  const matcherModule = await importSkillModule(toModuleUrl(engineRoot, SKILL_MATCHER_RELFILE));
  if (!(matcherModule?.matchSkillByName instanceof Function)) {
    throw new Error('loader skill-matcher has no matchSkillByName export');
  }
  return matcherModule;
}

const normalizeName = (name) => String(name ?? '').trim().toLowerCase();

function findExportedSkill(moduleNamespace, skillName) {
  const wanted = normalizeName(skillName);
  for (const value of Object.values(moduleNamespace ?? {})) {
    if (isUsableSkillRecord(value) && normalizeName(value.name) === wanted) {
      return value;
    }
  }
  return null;
}

const isUsableSkillRecord = (record) => {
  if (record === null || record === undefined) return false;
  const name = decodedText(record.name);
  return name.length > 0
    && asTextOrNull(record.description) !== null
    && asTextOrNull(record.template) !== null;
};



// Invoke-at-run-time per the loader contract (`createBuiltinSkills` /
// `resolveActiveBuiltinSkills` in skills-loader-core
// `features/builtin-skills/skills.ts`):
//   in  — the loader includes the skill at run time under these options.
//   out — the loader would not: conditional gate closed, non-selected
//         browser variant, config-disabled, or unloadable in this checkout.
// The reason is recorded on every item; never inferred silently.
function invokeStatusFor(entry, { teamModeEnabled, browserProvider, disabledSkills }) {
  if (disabledSkills.has(normalizeName(entry.skillName))) {
    return { invokeAtRuntime: 'out', invokeReason: 'disabled-by-config' };
  }
  if (entry.kind === 'conditional') {
    if (!teamModeEnabled) {
      return { invokeAtRuntime: 'out', invokeReason: 'conditional: team_mode disabled' };
    }
    return { invokeAtRuntime: 'in', invokeReason: 'active-in-loader' };
  }
  if (entry.kind === 'browser') {
    if (browserProvider !== entry.provider) {
      return { invokeAtRuntime: 'out', invokeReason: `browser-variant-not-selected (active: ${browserProvider})` };
    }
    return { invokeAtRuntime: 'in', invokeReason: 'active-in-loader' };
  }
  return { invokeAtRuntime: 'in', invokeReason: 'active-in-loader' };
}

async function loadRegistryEntry(entry, { engineRoot, importSkillModule, statusOptions }) {
  const status = invokeStatusFor(entry, statusOptions);
  let record = null;
  let loadError = null;
  try {
    const namespace = await importSkillModule(toModuleUrl(engineRoot, entry.module));
    const found = findExportedSkill(namespace, entry.skillName);
    if (isUsableSkillRecord(found)) {
      record = found;
    } else {
      loadError = `module loaded but exports no usable "${entry.skillName}" skill record`;
    }
  } catch (error) {
    loadError = firstLine(error);
  }
  return { entry, record, loadError, ...status };
}

function toCatalogItem({ entry, record, loadError, invokeAtRuntime, invokeReason }) {
  const installable = record !== null;
  const warnings = loadError ? [`engine source unavailable: ${loadError}`] : [];
  return {
    sourceId: ENGINE_CATALOG_SOURCE_ID,
    repoSource: ENGINE_CATALOG_SOURCE_ID,
    skillDir: entry.variant,
    skillName: record?.name ?? entry.skillName,
    frontmatterName: record?.name ?? entry.skillName,
    description: installable
      ? record.description
      : `Engine skill "${entry.skillName}" (currently unloadable: ${loadError})`,
    installable,
    warnings,
    // Loader-run-time truth, recorded per the contract above.
    invokeAtRuntime: installable ? invokeAtRuntime : 'out',
    invokeReason: installable ? invokeReason : `engine-source-missing: ${loadError}`,
    variant: entry.variant,
  };
}

export async function listEngineSkills({
  engineRoot = resolveEngineRoot(),
  importSkillModule = defaultImportModule,
  teamModeEnabled = false,
  browserProvider = 'playwright',
  disabledSkills = [],
} = {}) {
  if (!engineRoot) {
    return {
      ok: false,
      error: {
        kind: 'engine_unavailable',
        message: 'Engine skills are unavailable: no vendored OmO engine (packages/omo-engine) found beside this checkout.',
      },
    };
  }
  const statusOptions = {
    teamModeEnabled,
    browserProvider,
    disabledSkills: new Set((disabledSkills || []).map(normalizeName)),
  };
  const loaded = [];
  for (const entry of ENGINE_SKILL_REGISTRY) {
    loaded.push(await loadRegistryEntry(entry, { engineRoot, importSkillModule, statusOptions }));
  }
  return { ok: true, engineRoot, items: loaded.map(toCatalogItem) };
}

// Resolves a requested install name through the loader's own matcher.
// Refusals are explicit and typed:
//   invalid_skill_name       — fails the catalog name rule (includes
//                              path-traversal shapes like `../evil`); no
//                              filesystem touch happens past this point.
//   missing_skill            — nothing matches; substring suggestions help.
//   ambiguous_skill          — the loader refuses (or the catalog lists two
//                              variants under one loader name and no variant
//                              was given); candidates name each option.
//   engine_skill_unavailable — the match exists but its module cannot load.
//   engine_unavailable       — the matcher itself cannot load here.
export async function resolveEngineSkillForInstall(items, requestedName, {
  engineRoot = resolveEngineRoot(),
  importSkillModule = defaultImportModule,
  matchSkillByName = null,
  findPartialMatches = null,
  variant = null,
} = {}) {
  const rawName = decodedText(requestedName);
  if (!isValidSkillName(rawName)) {
    return {
      ok: false,
      error: {
        kind: 'invalid_skill_name',
        message: `Invalid engine skill name "${requestedName}". Use 1-64 lowercase alphanumerics with hyphens.`,
      },
    };
  }
  let matcher = matchSkillByName && findPartialMatches
    ? { matchSkillByName, findPartialMatches }
    : null;
  if (!matcher) {
    if (!engineRoot) {
      return {
        ok: false,
        error: {
          kind: 'engine_unavailable',
          message: 'Engine skills are unavailable: no vendored OmO engine (packages/omo-engine) found beside this checkout.',
        },
      };
    }
    try {
      matcher = await loadLoaderMatcher(engineRoot, importSkillModule);
    } catch (error) {
      return {
        ok: false,
        error: { kind: 'engine_unavailable', message: `Engine skill matcher unavailable: ${firstLine(error)}` },
      };
    }
  }

  const normalized = normalizeName(rawName);
  const exactMatches = (items || []).filter((item) => normalizeName(item.skillName) === normalized);
  if (exactMatches.length > 1 && !variant) {
    return {
      ok: false,
      error: {
        kind: 'ambiguous_skill',
        message: `Engine skill "${rawName}" matches ${exactMatches.length} variants (${exactMatches.map((item) => item.variant).join(', ')}). Install one variant explicitly.`,
        candidates: exactMatches.map((item) => ({
          skillName: item.skillName,
          variant: item.variant,
          description: item.description,
        })),
      },
    };
  }
  if (variant) {
    const variantMatch = exactMatches.find((item) => item.variant === variant)
      ?? (items || []).find((item) => item.variant === variant && normalizeName(item.skillName) === normalized);
    if (!variantMatch) {
      return {
        ok: false,
        error: {
          kind: 'missing_skill',
          message: `Engine skill "${rawName}" has no variant "${variant}".`,
          suggestions: [],
        },
      };
    }
    return finishResolve(variantMatch);
  }
  if (exactMatches.length === 1) {
    return finishResolve(exactMatches[0]);
  }

  const matchCandidates = (items || []).map((item) => ({ name: item.skillName }));
  const matched = matcher.matchSkillByName(matchCandidates, rawName);
  if (matched) {
    const resolved = (items || []).find((item) => item.skillName === matched.name);
    if (resolved) {
      return finishResolve(resolved);
    }
  }
  const shortNameHits = (items || []).filter((item) => {
    const parts = String(item.skillName).split('/');
    return parts.length > 1 && normalizeName(parts[parts.length - 1]) === normalized;
  });
  if (shortNameHits.length > 1) {
    return {
      ok: false,
      error: {
        kind: 'ambiguous_skill',
        message: `Engine skill "${rawName}" is ambiguous: ${shortNameHits.map((item) => item.skillName).join(', ')}. Use the full skill name.`,
        candidates: shortNameHits.map((item) => ({
          skillName: item.skillName,
          variant: item.variant,
          description: item.description,
        })),
      },
    };
  }
  let suggestions = [];
  try {
    suggestions = (matcher.findPartialMatches(matchCandidates, [], rawName) || []).slice(0, 5);
  } catch {
    suggestions = [];
  }
  return {
    ok: false,
    error: {
      kind: 'missing_skill',
      message: `Engine skill "${rawName}" not found in the engine catalog.`,
      suggestions,
    },
  };
}

function finishResolve(item) {
  if (!item.installable) {
    return {
      ok: false,
      error: {
        kind: 'engine_skill_unavailable',
        message: `Engine skill "${item.skillName}" cannot be installed here: ${(item.warnings || []).join('; ') || 'source unavailable'}.`,
      },
    };
  }
  return { ok: true, item };
}

// Installs one engine skill by copying its SKILL.md content into a managed
// root: user scope → `<userSkillDir>/<name>/SKILL.md`, project scope →
// `<workingDirectory>/.opencode/skills/<name>/SKILL.md`. The installed file
// is then ordinary OpenCode-config skill data: existing discovery lists it
// with no re-resolution. SKILL.md bytes are the loader template verbatim
// (data, never executed); frontmatter carries name/description plus the
// loader's license/compatibility/metadata when present.
export async function installEngineSkill({
  skillName,
  variant = null,
  scope = 'user',
  workingDirectory = null,
  userSkillDir = SKILL_DIR,
  engineRoot = resolveEngineRoot(),
  importSkillModule = defaultImportModule,
  matchSkillByName = null,
  findPartialMatches = null,
  teamModeEnabled = false,
  browserProvider = 'playwright',
  disabledSkills = [],
  writeSkillFile = writeMdFile,
} = {}) {
  if (scope !== 'user' && scope !== 'project') {
    return {
      ok: false,
      error: { kind: 'invalid_scope', message: `Invalid scope "${scope}". Use "user" or "project".` },
    };
  }
  if (scope === 'project' && decodedText(workingDirectory).length === 0) {
    return {
      ok: false,
      error: { kind: 'invalid_scope', message: 'Project installs require a working directory.' },
    };
  }
  const listed = await listEngineSkills({
    engineRoot, importSkillModule, teamModeEnabled, browserProvider, disabledSkills,
  });
  if (!listed.ok) {
    return listed;
  }
  const resolved = await resolveEngineSkillForInstall(listed.items, skillName, {
    engineRoot, importSkillModule, matchSkillByName, findPartialMatches, variant,
  });
  if (!resolved.ok) {
    return resolved;
  }
  const record = await loadInstalledRecord(resolved.item, {
    engineRoot, importSkillModule,
  });
  if (!record.ok) {
    return record;
  }
  const canonicalName = String(record.item.name).trim();
  if (!isValidSkillName(canonicalName)) {
    return {
      ok: false,
      error: { kind: 'invalid_skill_name', message: `Engine skill "${canonicalName}" cannot be installed: invalid skill name.` },
    };
  }
  const scopeRoot = scope === 'project'
    ? path.join(path.resolve(workingDirectory), '.opencode', 'skills')
    : path.resolve(userSkillDir);
  const targetDir = path.join(scopeRoot, canonicalName);
  // Containment against the caller-provided managed root: the directory
  // segment comes from the validated canonical name, but the assert stays
  // so a future caller cannot slip a traversal past this point.
  const resolvedTarget = path.resolve(targetDir);
  if (resolvedTarget !== path.join(scopeRoot, canonicalName) || !resolvedTarget.startsWith(`${scopeRoot}${path.sep}`)) {
    return {
      ok: false,
      error: { kind: 'invalid_skill_name', message: `Engine skill "${canonicalName}" resolves outside the managed skill root; refusing install.` },
    };
  }
  const targetPath = path.join(resolvedTarget, 'SKILL.md');
  if (fs.existsSync(targetPath) || fs.existsSync(resolvedTarget)) {
    return {
      ok: false,
      error: {
        kind: 'already_installed',
        message: `Engine skill "${canonicalName}" is already installed at ${resolvedTarget}; refusing to overwrite.`,
        path: resolvedTarget,
      },
    };
  }
  const frontmatter = { name: canonicalName, description: record.item.description };
  for (const key of ['license', 'compatibility', 'metadata', 'agent', 'model', 'argumentHint']) {
    if (record.item[key] !== undefined && record.item[key] !== null) {
      frontmatter[key] = record.item[key];
    }
  }
  try {
    fs.mkdirSync(resolvedTarget, { recursive: true });
    writeSkillFile(targetPath, frontmatter, record.item.template);
  } catch (error) {
    return {
      ok: false,
      error: { kind: 'unknown', message: `Failed to install engine skill "${canonicalName}": ${firstLine(error)}` },
    };
  }
  return {
    ok: true,
    installed: [{ skillName: canonicalName, scope, source: 'engine', path: targetPath }],
    skipped: [],
  };
}

async function loadInstalledRecord(item, { engineRoot, importSkillModule }) {
  const entry = ENGINE_SKILL_REGISTRY.find((candidate) => candidate.variant === item.variant);
  if (!entry) {
    return {
      ok: false,
      error: { kind: 'missing_skill', message: `Engine skill variant "${item.variant}" is not a known engine skill.`, suggestions: [] },
    };
  }
  try {
    const namespace = await importSkillModule(toModuleUrl(engineRoot, entry.module));
    const found = findExportedSkill(namespace, entry.skillName);
    if (isUsableSkillRecord(found)) {
      return { ok: true, item: found };
    }
  } catch (error) {
    return {
      ok: false,
      error: { kind: 'engine_skill_unavailable', message: `Engine skill "${entry.skillName}" cannot be installed here: ${firstLine(error)}.` },
    };
  }
  return {
    ok: false,
    error: { kind: 'engine_skill_unavailable', message: `Engine skill "${entry.skillName}" cannot be installed here: source unavailable.` },
  };
}

// Route wiring seam: one explicit dependency object for skill-routes so the
// route file stays thin. `userSkillDir` defaults to the app managed user
// root; every other loader input stays overridable per call.
export function createEngineSkillCatalog({ userSkillDir = SKILL_DIR, writeSkillFile = writeMdFile } = {}) {
  return {
    source: {
      id: ENGINE_CATALOG_SOURCE_ID,
      label: 'Engine skills',
      description: 'Built-in skills from the vendored OmO skills-loader engine',
      source: ENGINE_CATALOG_SOURCE_ID,
      sourceType: ENGINE_CATALOG_SOURCE_TYPE,
    },
    listItems: (options = {}) => listEngineSkills(options),
    install: (options = {}) => installEngineSkill({ userSkillDir, writeSkillFile, ...options }),
  };
}
