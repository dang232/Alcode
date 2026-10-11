import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  ENGINE_CATALOG_SOURCE_ID,
  ENGINE_SKILL_REGISTRY,
  installEngineSkill,
  listEngineSkills,
  resolveEngineRoot,
  resolveEngineSkillForInstall,
} from './engine-skills.js';
import { parseMdFile } from '../opencode/shared.js';

const MATCHER_URL = pathToFileURL(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..', '..', 'omo-engine', 'skills-loader-core', 'src', 'tools', 'skill', 'skill-matcher.ts',
  ),
).href;
const realMatcher = await import(MATCHER_URL);

const makeRecord = (overrides = {}) => ({
  name: 'git-master',
  description: 'Git skill',
  template: '# Git\n\nDo git things.\n',
  ...overrides,
});

const byVariant = (records) => async (specifier) => {
  const url = String(specifier);
  for (const [variant, record] of Object.entries(records)) {
    if (url.endsWith(`/skills/${variant}.ts`)) {
      if (record instanceof Error) throw record;
      return { [`${variant}Skill`]: record };
    }
  }
  throw new Error(`unexpected module ${url}`);
};

const allUsable = () => Object.fromEntries(
  ENGINE_SKILL_REGISTRY.map((entry) => [entry.variant, makeRecord({ name: entry.skillName, description: `${entry.skillName} desc` })]),
);

const withTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'oc-engine-skills-'));

describe('engine skill catalog list', () => {
  it('lists every registered engine skill with loader-default invoke status', async () => {
    const listed = await listEngineSkills({ engineRoot: '/fake/root', importSkillModule: byVariant(allUsable()) });
    expect(listed.ok).toBe(true);
    expect(listed.items).toHaveLength(ENGINE_SKILL_REGISTRY.length);
    const byName = new Map(listed.items.map((item) => [item.variant, item]));

    expect(byName.get('git-master').installable).toBe(true);
    expect(byName.get('git-master').invokeAtRuntime).toBe('in');
    // team-mode renders only when team_mode.enabled (loader default false).
    expect(byName.get('team-mode').invokeAtRuntime).toBe('out');
    // Default browser provider is playwright: only that variant is in.
    expect(byName.get('playwright').invokeAtRuntime).toBe('in');
    expect(byName.get('playwright-cli').invokeAtRuntime).toBe('out');
    expect(byName.get('dev-browser').invokeAtRuntime).toBe('out');
    for (const item of listed.items) {
      expect(item.sourceId).toBe(ENGINE_CATALOG_SOURCE_ID);
      expect(item.invokeReason?.trim?.().length ?? 0).toBeGreaterThan(0);
    }
  });

  it('marks team-mode in when enabled and honors disabled skills', async () => {
    const listed = await listEngineSkills({
      engineRoot: '/fake/root',
      importSkillModule: byVariant(allUsable()),
      teamModeEnabled: true,
      disabledSkills: ['GIT-master'],
    });
    expect(listed.ok).toBe(true);
    const byName = new Map(listed.items.map((item) => [item.variant, item]));
    expect(byName.get('team-mode').invokeAtRuntime).toBe('in');
    expect(byName.get('git-master').invokeAtRuntime).toBe('out');
    expect(byName.get('git-master').invokeReason).toBe('disabled-by-config');
  });

  it('selects the configured browser variant', async () => {
    const listed = await listEngineSkills({
      engineRoot: '/fake/root',
      importSkillModule: byVariant(allUsable()),
      browserProvider: 'playwright-cli',
    });
    const byName = new Map(listed.items.map((item) => [item.variant, item]));
    expect(byName.get('playwright-cli').invokeAtRuntime).toBe('in');
    expect(byName.get('playwright').invokeAtRuntime).toBe('out');
  });

  it('lists unloadable skills as unavailable instead of dropping them', async () => {
    const records = allUsable();
    records.frontend = new Error('Cannot find module shared-skills');
    const listed = await listEngineSkills({ engineRoot: '/fake/root', importSkillModule: byVariant(records) });
    expect(listed.ok).toBe(true);
    const frontend = listed.items.find((item) => item.variant === 'frontend');
    expect(frontend.installable).toBe(false);
    expect(frontend.invokeAtRuntime).toBe('out');
    expect(frontend.warnings.join(' ')).toContain('shared-skills');
  });

  it('answers engine_unavailable without an engine root', async () => {
    const listed = await listEngineSkills({ engineRoot: null });
    expect(listed.ok).toBe(false);
    expect(listed.error.kind).toBe('engine_unavailable');
  });
});

describe('resolveEngineRoot', () => {
  it('prefers an explicit override root with the loader marker', () => {
    const root = withTempRoot();
    try {
      fs.mkdirSync(path.join(root, 'skills-loader-core'), { recursive: true });
      fs.writeFileSync(path.join(root, 'skills-loader-core', 'package.json'), '{}');
      expect(resolveEngineRoot({ env: { OMO_ENGINE_ROOT: root }, moduleDir: '/nonexistent' })).toBe(path.resolve(root));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns null when no candidate carries the loader marker', () => {
    expect(resolveEngineRoot({ env: {}, moduleDir: withTempRoot() })).toBe(null);
  });

  it('resolves the packaged resources engine copy without an override', () => {
    const resources = withTempRoot();
    const previous = process.resourcesPath;
    try {
      fs.mkdirSync(path.join(resources, 'omo-engine', 'skills-loader-core'), { recursive: true });
      fs.writeFileSync(path.join(resources, 'omo-engine', 'skills-loader-core', 'package.json'), '{}');
      process.resourcesPath = resources;
      expect(resolveEngineRoot({ env: {}, moduleDir: '/nonexistent' }))
        .toBe(path.join(resources, 'omo-engine'));
    } finally {
      if (previous === undefined) delete process.resourcesPath;
      else process.resourcesPath = previous;
      fs.rmSync(resources, { recursive: true, force: true });
    }
  });
});

describe('resolveEngineSkillForInstall through the real loader matcher', () => {
  const items = [
    { skillName: 'git-master', variant: 'git-master', description: 'Git', installable: true, warnings: [] },
    { skillName: 'org/review', variant: 'review-a', description: 'A', installable: true, warnings: [] },
    { skillName: 'team/review', variant: 'review-b', description: 'B', installable: true, warnings: [] },
  ];
  const viaRealMatcher = (name, extra = {}) => resolveEngineSkillForInstall(items, name, {
    engineRoot: '/fake/root',
    importSkillModule: async () => { throw new Error('must not import when matcher injected'); },
    matchSkillByName: realMatcher.matchSkillByName,
    findPartialMatches: realMatcher.findPartialMatches,
    ...extra,
  });

  it('resolves the exact name', async () => {
    const resolved = await viaRealMatcher('git-master');
    expect(resolved.ok).toBe(true);
    expect(resolved.item.variant).toBe('git-master');
  });

  it('resolves a unique short name', async () => {
    const single = [{ skillName: 'org/review', variant: 'review-a', description: 'A', installable: true, warnings: [] }];
    const resolved = await resolveEngineSkillForInstall(single, 'review', {
      engineRoot: '/fake/root',
      matchSkillByName: realMatcher.matchSkillByName,
      findPartialMatches: realMatcher.findPartialMatches,
    });
    expect(resolved.ok).toBe(true);
    expect(resolved.item.variant).toBe('review-a');
  });

  it('refuses an ambiguous short name with candidates', async () => {
    const resolved = await viaRealMatcher('review');
    expect(resolved.ok).toBe(false);
    expect(resolved.error.kind).toBe('ambiguous_skill');
    expect(resolved.error.candidates.map((c) => c.variant).sort()).toEqual(['review-a', 'review-b']);
  });

  it('reports missing skills with substring suggestions', async () => {
    const resolved = await viaRealMatcher('git-maste');
    expect(resolved.ok).toBe(false);
    expect(resolved.error.kind).toBe('missing_skill');
    expect(resolved.error.suggestions).toContain('git-master');
  });

  it('refuses path-traversal names before any filesystem touch', async () => {
    for (const name of ['../evil', '..', 'a/b', '', 'Has-Upper']) {
      const resolved = await viaRealMatcher(name);
      expect(resolved.ok).toBe(false);
      expect(resolved.error.kind).toBe('invalid_skill_name');
    }
  });

  it('refuses the shared playwright name until a variant is named', async () => {
    const twins = [
      { skillName: 'playwright', variant: 'playwright', description: 'MCP', installable: true, warnings: [] },
      { skillName: 'playwright', variant: 'playwright-cli', description: 'CLI', installable: true, warnings: [] },
    ];
    const refused = await resolveEngineSkillForInstall(twins, 'playwright', {
      engineRoot: '/fake/root',
      matchSkillByName: realMatcher.matchSkillByName,
      findPartialMatches: realMatcher.findPartialMatches,
    });
    expect(refused.ok).toBe(false);
    expect(refused.error.kind).toBe('ambiguous_skill');
    expect(refused.error.candidates.map((c) => c.variant).sort()).toEqual(['playwright', 'playwright-cli']);

    const picked = await resolveEngineSkillForInstall(twins, 'playwright', {
      engineRoot: '/fake/root',
      matchSkillByName: realMatcher.matchSkillByName,
      findPartialMatches: realMatcher.findPartialMatches,
      variant: 'playwright-cli',
    });
    expect(picked.ok).toBe(true);
    expect(picked.item.variant).toBe('playwright-cli');
  });

  it('refuses unloadable skills as unavailable', async () => {
    const unavailable = [{ skillName: 'frontend', variant: 'frontend', description: 'x', installable: false, warnings: ['engine source unavailable: nope'] }];
    const resolved = await resolveEngineSkillForInstall(unavailable, 'frontend', {
      engineRoot: '/fake/root',
      matchSkillByName: realMatcher.matchSkillByName,
      findPartialMatches: realMatcher.findPartialMatches,
    });
    expect(resolved.ok).toBe(false);
    expect(resolved.error.kind).toBe('engine_skill_unavailable');
  });
});

describe('installEngineSkill', () => {
  it('writes SKILL.md under the user managed root', async () => {
    const root = withTempRoot();
    try {
      const userSkillDir = path.join(root, 'skills');
      const installed = await installEngineSkill({
        skillName: 'git-master',
        scope: 'user',
        userSkillDir,
        engineRoot: '/fake/root',
        importSkillModule: byVariant({ 'git-master': makeRecord() }),
        matchSkillByName: realMatcher.matchSkillByName,
        findPartialMatches: realMatcher.findPartialMatches,
      });
      expect(installed.ok).toBe(true);
      const target = path.join(userSkillDir, 'git-master', 'SKILL.md');
      expect(installed.installed[0].path).toBe(target);
      const parsed = parseMdFile(target);
      expect(parsed.frontmatter.name).toBe('git-master');
      expect(parsed.frontmatter.description).toBe('Git skill');
      expect(parsed.body).toBe('# Git\n\nDo git things.');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes SKILL.md under the project managed root', async () => {
    const projectRoot = withTempRoot();
    try {
      const installed = await installEngineSkill({
        skillName: 'git-master',
        scope: 'project',
        workingDirectory: projectRoot,
        userSkillDir: path.join(projectRoot, 'unused-user-dir'),
        engineRoot: '/fake/root',
        importSkillModule: byVariant({ 'git-master': makeRecord() }),
        matchSkillByName: realMatcher.matchSkillByName,
        findPartialMatches: realMatcher.findPartialMatches,
      });
      expect(installed.ok).toBe(true);
      expect(fs.existsSync(path.join(projectRoot, '.opencode', 'skills', 'git-master', 'SKILL.md'))).toBe(true);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('carries license and metadata frontmatter and refuses to overwrite', async () => {
    const root = withTempRoot();
    try {
      const userSkillDir = path.join(root, 'skills');
      const importer = byVariant({
        'git-master': makeRecord({ license: 'Apache-2.0', metadata: { 'opencode/autoinvoke': 'false' } }),
      });
      const base = {
        skillName: 'git-master',
        scope: 'user',
        userSkillDir,
        engineRoot: '/fake/root',
        importSkillModule: importer,
        matchSkillByName: realMatcher.matchSkillByName,
        findPartialMatches: realMatcher.findPartialMatches,
      };
      expect((await installEngineSkill(base)).ok).toBe(true);
      const parsed = parseMdFile(path.join(userSkillDir, 'git-master', 'SKILL.md'));
      expect(parsed.frontmatter.license).toBe('Apache-2.0');
      expect(parsed.frontmatter.metadata).toEqual({ 'opencode/autoinvoke': 'false' });

      const again = await installEngineSkill(base);
      expect(again.ok).toBe(false);
      expect(again.error.kind).toBe('already_installed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // Prompt-injection probe: a template carrying shell/command shapes is
  // stored byte-identical and never executed (canary file must not appear).
  it('stores hostile template content inert and byte-identical', async () => {
    const root = withTempRoot();
    const canary = path.join(root, 'canary-touched');
    try {
      const hostile = '# Evil\n\n$(touch ' + canary + ')\n\n`${process.exit(1)}`\n---\nnot-frontmatter: [unclosed\n';
      const installed = await installEngineSkill({
        skillName: 'git-master',
        scope: 'user',
        userSkillDir: path.join(root, 'skills'),
        engineRoot: '/fake/root',
        importSkillModule: byVariant({ 'git-master': makeRecord({ template: hostile }) }),
        matchSkillByName: realMatcher.matchSkillByName,
        findPartialMatches: realMatcher.findPartialMatches,
      });
      expect(installed.ok).toBe(true);
      const raw = fs.readFileSync(path.join(root, 'skills', 'git-master', 'SKILL.md'), 'utf8');
      expect(raw).toContain(hostile);
      expect(fs.existsSync(canary)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes nothing for unknown, ambiguous, or traversal names', async () => {
    const root = withTempRoot();
    try {
      const userSkillDir = path.join(root, 'skills');
      const base = {
        scope: 'user',
        userSkillDir,
        engineRoot: '/fake/root',
        importSkillModule: byVariant({
          ...allUsable(),
          playwright: makeRecord({ name: 'playwright', description: 'MCP' }),
          'playwright-cli': makeRecord({ name: 'playwright', description: 'CLI' }),
        }),
        matchSkillByName: realMatcher.matchSkillByName,
        findPartialMatches: realMatcher.findPartialMatches,
      };
      const unknown = await installEngineSkill({ ...base, skillName: 'no-such-skill' });
      expect(unknown.ok).toBe(false);
      expect(unknown.error.kind).toBe('missing_skill');

      // Both playwright variants are installable under one loader name:
      // refusing to guess is the documented catalog extension.
      const ambiguous = await installEngineSkill({ ...base, skillName: 'playwright' });
      expect(ambiguous.ok).toBe(false);
      expect(ambiguous.error.kind).toBe('ambiguous_skill');

      const traversal = await installEngineSkill({ ...base, skillName: '../evil' });
      expect(traversal.ok).toBe(false);
      expect(traversal.error.kind).toBe('invalid_skill_name');

      expect(fs.existsSync(userSkillDir)).toBe(false);
      expect(fs.existsSync(path.join(root, 'evil'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires a directory for project scope', async () => {
    const result = await installEngineSkill({ skillName: 'git-master', scope: 'project', engineRoot: '/fake/root' });
    expect(result.ok).toBe(false);
    expect(result.error.kind).toBe('invalid_scope');
  });
});
