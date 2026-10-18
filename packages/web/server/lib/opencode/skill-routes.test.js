import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { registerSkillRoutes } from './skill-routes.js';
import {
  createSkill,
  deleteSkill,
  discoverSkills,
  getSkillSources,
  isManagedSkillPath,
  mergeDiscoveredSkills,
  renameSkill,
  updateSkill,
} from './skills.js';
import {
  SKILL_DIR,
  SKILL_SCOPE,
  deleteSkillSupportingFile,
  readSkillSupportingFile,
  writeSkillSupportingFile,
} from './shared.js';

const createTempProject = () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-skill-routes-'));
  fs.mkdirSync(path.join(projectRoot, '.git'));
  return projectRoot;
};

const startSkillsApp = ({ projectRoot, overrides = {} }) => {
  const app = express();
  app.use(express.json());

  registerSkillRoutes(app, {
    fs,
    path,
    os,
    resolveProjectDirectory: async () => ({ directory: projectRoot, error: null }),
    resolveOptionalProjectDirectory: async (req) => {
      const queryDirectory = Array.isArray(req.query?.directory)
        ? req.query.directory[0]
        : req.query?.directory;
      if (!queryDirectory) {
        return { directory: null, error: null };
      }
      return { directory: String(queryDirectory), error: null };
    },
    readSettingsFromDisk: async () => ({}),
    sanitizeSkillCatalogs: (value) => value,
    isUnsafeSkillRelativePath: () => false,
    refreshOpenCodeAfterConfigChange: async () => {},
    clientReloadDelayMs: 0,
    buildOpenCodeUrl: () => 'http://127.0.0.1:9/',
    getOpenCodeAuthHeaders: () => ({}),
    getOpenCodePort: () => 0,
    getSkillSources,
    discoverSkills,
    mergeDiscoveredSkills,
    createSkill,
    updateSkill,
    deleteSkill,
    renameSkill,
    isManagedSkillPath,
    readSkillSupportingFile,
    writeSkillSupportingFile,
    deleteSkillSupportingFile,
    SKILL_SCOPE,
    SKILL_DIR,
    getCuratedSkillsSources: () => [],
    getCacheKey: () => 'k',
    scanWithCache: async (_key, loader) => loader(),
    parseSkillRepoSource: () => ({ ok: false }),
    scanSkillsRepository: async () => ({ ok: false }),
    installSkillsFromRepository: async () => ({ ok: false }),
    fetchGitHubRepoMetas: async () => ({}),
    getProfiles: () => [],
    getProfile: () => null,
    ...overrides,
  });

  const server = app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
};

describe('skill-routes directory soft fallback', () => {
  /** @type {string | null} */
  let projectRoot = null;
  /** @type {{ close: () => Promise<void> } | null} */
  let appHandle = null;

  afterEach(async () => {
    if (appHandle) {
      await appHandle.close();
      appHandle = null;
    }
    if (projectRoot) {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('lists repository-local .agents skills after create even when list omits directory', async () => {
    projectRoot = createTempProject();
    appHandle = startSkillsApp({ projectRoot });

    const createResponse = await fetch(`${appHandle.baseUrl}/api/config/skills/repo-local-skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'Created without list directory',
        instructions: 'Do the thing.',
        scope: 'project',
        source: 'agents',
      }),
    });
    expect(createResponse.status).toBe(200);
    expect(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'repo-local-skill', 'SKILL.md'))).toBe(true);

    const listResponse = await fetch(`${appHandle.baseUrl}/api/config/skills`);
    expect(listResponse.status).toBe(200);
    const payload = await listResponse.json();
    expect(payload.skills.map((skill) => skill.name)).toContain('repo-local-skill');
    const skill = payload.skills.find((entry) => entry.name === 'repo-local-skill');
    expect(skill.scope).toBe('project');
    expect(skill.source).toBe('agents');
  });

  it('lists manually created repository-local .agents skills via active-project fallback', async () => {
    projectRoot = createTempProject();
    const skillDir = path.join(projectRoot, '.agents', 'skills', 'manual-repo-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: manual-repo-skill',
        'description: Manual repository skill',
        '---',
        '',
        'Instructions',
        '',
      ].join('\n'),
      'utf8',
    );

    appHandle = startSkillsApp({ projectRoot });
    const listResponse = await fetch(`${appHandle.baseUrl}/api/config/skills`);
    expect(listResponse.status).toBe(200);
    const payload = await listResponse.json();
    expect(payload.skills.map((skill) => skill.name)).toContain('manual-repo-skill');
  });

  it('marks managed-root skills renamable and cache skills not renamable', async () => {
    projectRoot = createTempProject();
    const managedDir = path.join(projectRoot, '.opencode', 'skills', 'managed-list-skill');
    fs.mkdirSync(managedDir, { recursive: true });
    fs.writeFileSync(
      path.join(managedDir, 'SKILL.md'),
      [
        '---',
        'name: managed-list-skill',
        'description: Managed list skill',
        '---',
        '',
        'Managed body',
        '',
      ].join('\n'),
      'utf8',
    );

    const cacheStamp = `oc-skill-routes-${Date.now()}`;
    const cacheDir = path.join(os.homedir(), '.cache', 'opencode', 'skills', cacheStamp, 'cache-list-skill');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, 'SKILL.md'),
      [
        '---',
        'name: cache-list-skill',
        'description: Cache list skill',
        '---',
        '',
        'Cache body',
        '',
      ].join('\n'),
      'utf8',
    );

    try {
      appHandle = startSkillsApp({ projectRoot });
      const listResponse = await fetch(
        `${appHandle.baseUrl}/api/config/skills?directory=${encodeURIComponent(projectRoot)}`,
      );
      expect(listResponse.status).toBe(200);
      const payload = await listResponse.json();

      const managed = payload.skills.find((entry) => entry.name === 'managed-list-skill');
      const cached = payload.skills.find((entry) => entry.name === 'cache-list-skill');

      expect(managed).toBeTruthy();
      expect(managed.renamable).toBe(true);
      expect(cached).toBeTruthy();
      expect(cached.renamable).toBe(false);
    } finally {
      fs.rmSync(path.join(os.homedir(), '.cache', 'opencode', 'skills', cacheStamp), {
        recursive: true,
        force: true,
      });
    }
  });

  it('lists OpenCode skills reported with the v2 `path` field and keeps the v1 `location` fallback', async () => {
    projectRoot = createTempProject();

    // OpenCode v2's skill payload renamed `location` to `path`. The route maps
    // the fetch result to { name, path, ... }; with the old field only, the
    // whole authoritative list was dropped and the panel fell back to the
    // smaller local disk scan. Serve a v2-style payload from a stub.
    const stub = express();
    stub.get('/api/skill', (_req, res) => {
      res.json({
        location: { directory: projectRoot },
        data: [
          {
            id: 'v2-path-skill',
            name: 'v2-path-skill',
            path: path.join(projectRoot, '.agents', 'skills', 'v2-path-skill'),
            description: 'Delivered with the v2 path field',
          },
          {
            id: 'v1-location-skill',
            name: 'v1-location-skill',
            location: path.join(projectRoot, '.agents', 'skills', 'v1-location-skill'),
            description: 'Delivered with the legacy location field',
          },
          {
            id: 'opencode',
            name: 'OpenCode',
            path: '/builtin/opencode.md',
            description: 'v2 built-in skill with a synthetic path',
          },
          {
            id: 'unlocated-skill',
            name: 'unlocated-skill',
            description: 'Has neither field; must be dropped',
          },
        ],
      });
    });
    const stubServer = await new Promise((resolve) => {
      const server = stub.listen(0, () => resolve(server));
    });
    const stubPort = stubServer.address().port;

    try {
      appHandle = startSkillsApp({
        projectRoot,
        overrides: {
          buildOpenCodeUrl: () => `http://127.0.0.1:${stubPort}/`,
          getOpenCodePort: () => stubPort,
          getOpenCodeAuthHeaders: () => ({}),
        },
      });

      const listResponse = await fetch(
        `${appHandle.baseUrl}/api/config/skills?directory=${encodeURIComponent(projectRoot)}`,
      );
      expect(listResponse.status).toBe(200);
      const payload = await listResponse.json();
      const byName = new Map(payload.skills.map((skill) => [skill.name, skill]));

      expect(byName.has('v2-path-skill')).toBe(true);
      expect(byName.get('v2-path-skill').path).toContain('v2-path-skill');

      expect(byName.has('v1-location-skill')).toBe(true);
      expect(byName.get('v1-location-skill').path).toContain('v1-location-skill');

      expect(byName.get('OpenCode')?.path).toBe('<built-in>');
      expect(byName.get('OpenCode')?.renamable).toBe(false);

      expect(byName.has('unlocated-skill')).toBe(false);
    } finally {
      stubServer.close();
    }
  });
  it('hides a curated source\'s excluded skills from its catalog listing', async () => {
    projectRoot = createTempProject();
    const scanItem = (skillName) => ({ repoSource: 'acme/skills', skillDir: `skills/${skillName}`, skillName, installable: true });
    appHandle = startSkillsApp({
      projectRoot,
      overrides: {
        getCuratedSkillsSources: () => [
          { id: 'acme', label: 'Acme', source: 'acme/skills', defaultSubpath: 'skills', excludedSkills: ['docx'] },
        ],
        parseSkillRepoSource: () => ({ ok: true, host: 'github.com', normalizedRepo: 'acme/skills' }),
        scanSkillsRepository: async () => ({ ok: true, items: [scanItem('docx'), scanItem('frontend-design')] }),
      },
    });

    const sourceResponse = await fetch(
      `${appHandle.baseUrl}/api/config/skills/catalog/source?sourceId=acme&directory=${encodeURIComponent(projectRoot)}`,
    );
    expect(sourceResponse.status).toBe(200);
    const sourcePayload = await sourceResponse.json();
    expect(sourcePayload.items.map((item) => item.skillName)).toEqual(['frontend-design']);

    const catalogResponse = await fetch(`${appHandle.baseUrl}/api/config/skills/catalog`);
    const catalogPayload = await catalogResponse.json();
    expect(catalogPayload.sources[0]).not.toHaveProperty('excludedSkills');
  });

  it('flags the list as partial when OpenCode skill list fails, and not when it succeeds', async () => {
    projectRoot = createTempProject();
    fs.mkdirSync(path.join(projectRoot, '.agents', 'skills', 'disk-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, '.agents', 'skills', 'disk-skill', 'SKILL.md'),
      '---\nname: disk-skill\ndescription: On disk\n---\nBody\n',
    );

    let failing = true;
    const stub = express();
    stub.get('/api/skill', (_req, res) => {
      if (failing) {
        res.status(500).json({ error: 'boom' });
        return;
      }
      res.json({ data: [] });
    });
    const stubServer = await new Promise((resolve) => {
      const server = stub.listen(0, () => resolve(server));
    });
    const stubPort = stubServer.address().port;

    try {
      appHandle = startSkillsApp({
        projectRoot,
        overrides: {
          buildOpenCodeUrl: () => `http://127.0.0.1:${stubPort}/`,
          getOpenCodePort: () => stubPort,
        },
      });
      const url = `${appHandle.baseUrl}/api/config/skills?directory=${encodeURIComponent(projectRoot)}`;

      const failed = await (await fetch(url)).json();
      expect(failed.openCodeSkillsUnavailable).toBe(true);
      expect(failed.skills.map((skill) => skill.name)).toContain('disk-skill');

      failing = false;
      const complete = await (await fetch(url)).json();
      expect(complete.openCodeSkillsUnavailable).toBeUndefined();
      expect(complete.skills.map((skill) => skill.name)).toContain('disk-skill');
    } finally {
      stubServer.close();
    }
  });
});

describe('skill-routes engine catalog', () => {
  /** @type {string | null} */
  let projectRoot = null;
  /** @type {{ close: () => Promise<void> } | null} */
  let appHandle = null;

  afterEach(async () => {
    if (appHandle) {
      await appHandle.close();
      appHandle = null;
    }
    if (projectRoot) {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  const engineItem = (overrides = {}) => ({
    sourceId: 'engine',
    repoSource: 'engine',
    skillDir: 'git-master',
    skillName: 'git-master',
    frontmatterName: 'git-master',
    description: 'Git engine skill',
    installable: true,
    warnings: [],
    invokeAtRuntime: 'in',
    invokeReason: 'active-in-loader',
    variant: 'git-master',
    ...overrides,
  });

  const stubEngineCatalog = ({ listResult, installResult } = {}) => ({
    source: {
      id: 'engine',
      label: 'Engine skills',
      description: 'Stub engine source',
      source: 'engine',
      sourceType: 'engine',
    },
    listItems: async () => listResult ?? { ok: true, items: [engineItem()] },
    install: async () => installResult ?? {
      ok: true,
      installed: [{ skillName: 'git-master', scope: 'project', source: 'engine', path: 'stub' }],
      skipped: [],
    },
  });

  it('lists the engine source with inline items in the catalog', async () => {
    projectRoot = createTempProject();
    appHandle = startSkillsApp({
      projectRoot,
      overrides: { engineSkillCatalog: stubEngineCatalog() },
    });

    const response = await fetch(`${appHandle.baseUrl}/api/config/skills/catalog`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.sources.map((source) => source.id)).toContain('engine');
    expect(payload.engineSkillsUnavailable).toBeUndefined();
    const items = payload.itemsBySource.engine;
    expect(items.map((item) => item.skillName)).toContain('git-master');
    expect(items.find((item) => item.skillName === 'git-master').installed).toEqual({ isInstalled: false });
  });

  it('flags the catalog when the engine list fails instead of an empty engine section', async () => {
    projectRoot = createTempProject();
    appHandle = startSkillsApp({
      projectRoot,
      overrides: {
        engineSkillCatalog: stubEngineCatalog({
          listResult: { ok: false, error: { kind: 'engine_unavailable', message: 'no engine' } },
        }),
      },
    });

    const payload = await (await fetch(`${appHandle.baseUrl}/api/config/skills/catalog`)).json();
    expect(payload.ok).toBe(true);
    expect(payload.engineSkillsUnavailable).toBe(true);
    expect(payload.itemsBySource.engine).toBeUndefined();
  });

  it('serves engine items with installed flags from the catalog source endpoint', async () => {
    projectRoot = createTempProject();
    const skillDir = path.join(projectRoot, '.opencode', 'skills', 'git-master');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: git-master\ndescription: Installed on disk\n---\nBody\n',
    );
    appHandle = startSkillsApp({
      projectRoot,
      overrides: { engineSkillCatalog: stubEngineCatalog() },
    });

    const response = await fetch(
      `${appHandle.baseUrl}/api/config/skills/catalog/source?sourceId=engine&directory=${encodeURIComponent(projectRoot)}`,
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    const item = payload.items.find((entry) => entry.skillName === 'git-master');
    expect(item.installed).toEqual({ isInstalled: true, scope: 'project', source: 'opencode' });
  });

  it('keeps unknown catalog sources a 404 with the engine wired', async () => {
    projectRoot = createTempProject();
    appHandle = startSkillsApp({
      projectRoot,
      overrides: { engineSkillCatalog: stubEngineCatalog() },
    });

    const response = await fetch(
      `${appHandle.baseUrl}/api/config/skills/catalog/source?sourceId=nope&directory=${encodeURIComponent(projectRoot)}`,
    );
    expect(response.status).toBe(404);
  });

  it('installs an engine skill into the project managed root with the real catalog', async () => {
    projectRoot = createTempProject();
    const { createEngineSkillCatalog } = await import('../skills-catalog/engine-skills.js');
    appHandle = startSkillsApp({
      projectRoot,
      overrides: {
        engineSkillCatalog: createEngineSkillCatalog({ userSkillDir: path.join(projectRoot, 'user-skills') }),
      },
    });

    const response = await fetch(`${appHandle.baseUrl}/api/config/skills/install-engine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillName: 'git-master', scope: 'project' }),
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.installed[0].skillName).toBe('git-master');
    const target = path.join(projectRoot, '.opencode', 'skills', 'git-master', 'SKILL.md');
    expect(payload.installed[0].path).toBe(target);
    expect(fs.existsSync(target)).toBe(true);

    const listPayload = await (
      await fetch(`${appHandle.baseUrl}/api/config/skills?directory=${encodeURIComponent(projectRoot)}`)
    ).json();
    expect(listPayload.skills.map((skill) => skill.name)).toContain('git-master');
  });

  it('maps engine install refusals to status codes without crashing', async () => {
    projectRoot = createTempProject();
    const cases = [
      [{ kind: 'ambiguous_skill', message: 'ambiguous' }, 400],
      [{ kind: 'missing_skill', message: 'missing' }, 400],
      [{ kind: 'invalid_skill_name', message: 'invalid' }, 400],
      [{ kind: 'already_installed', message: 'exists' }, 409],
      [{ kind: 'engine_unavailable', message: 'no engine' }, 500],
    ];
    for (const [error, status] of cases) {
      if (appHandle) {
        await appHandle.close();
        appHandle = null;
      }
      appHandle = startSkillsApp({
        projectRoot,
        overrides: { engineSkillCatalog: stubEngineCatalog({ installResult: { ok: false, error } }) },
      });
      const response = await fetch(`${appHandle.baseUrl}/api/config/skills/install-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillName: 'git-master', scope: 'user' }),
      });
      expect(response.status).toBe(status);
      const payload = await response.json();
      expect(payload.ok).toBe(false);
      expect(payload.error.kind).toBe(error.kind);
    }
  });

  it('answers engine_unavailable when the catalog is not wired', async () => {
    projectRoot = createTempProject();
    appHandle = startSkillsApp({ projectRoot });

    const installResponse = await fetch(`${appHandle.baseUrl}/api/config/skills/install-engine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillName: 'git-master', scope: 'user' }),
    });
    expect(installResponse.status).toBe(500);
    expect((await installResponse.json()).error.kind).toBe('engine_unavailable');

    const catalogPayload = await (await fetch(`${appHandle.baseUrl}/api/config/skills/catalog`)).json();
    expect(catalogPayload.sources.map((source) => source.id)).not.toContain('engine');
  });
});

describe('skill-routes omo catalog', () => {
  /** @type {string | null} */
  let projectRoot = null;
  /** @type {{ close: () => Promise<void> } | null} */
  let appHandle = null;

  afterEach(async () => {
    if (appHandle) {
      await appHandle.close();
      appHandle = null;
    }
    if (projectRoot) {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('lists the omo source with inline items in the catalog', async () => {
    projectRoot = createTempProject();
    const { createOmoSkillCatalog } = await import('../skills-catalog/omo-skills.js');
    appHandle = startSkillsApp({
      projectRoot,
      overrides: { omoSkillCatalog: createOmoSkillCatalog() },
    });

    const response = await fetch(`${appHandle.baseUrl}/api/config/skills/catalog`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.sources.map((source) => source.id)).toContain('omo');
    expect(payload.omoSkillsUnavailable).toBeUndefined();
    expect(payload.itemsBySource.omo.map((item) => item.skillName)).toEqual([
      'ultrawork',
      'ulw-loop',
      'ulw-plan',
      'ulw-research',
      'mass-ulw',
      'hyperplan',
      'onboarding',
      'dag-library',
    ]);
  });

  it('installs an omo skill into the project managed root with the real catalog', async () => {
    projectRoot = createTempProject();
    const { createOmoSkillCatalog } = await import('../skills-catalog/omo-skills.js');
    appHandle = startSkillsApp({
      projectRoot,
      overrides: { omoSkillCatalog: createOmoSkillCatalog() },
    });

    const response = await fetch(`${appHandle.baseUrl}/api/config/skills/install-omo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillName: 'ulw-plan', scope: 'project' }),
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    const target = path.join(projectRoot, '.opencode', 'skills', 'ulw-plan', 'SKILL.md');
    expect(payload.installed[0].path).toBe(target);
    expect(fs.existsSync(target)).toBe(true);

    const listPayload = await (
      await fetch(`${appHandle.baseUrl}/api/config/skills?directory=${encodeURIComponent(projectRoot)}`)
    ).json();
    expect(listPayload.skills.map((skill) => skill.name)).toContain('ulw-plan');

    const again = await fetch(`${appHandle.baseUrl}/api/config/skills/install-omo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillName: 'ulw-plan', scope: 'project' }),
    });
    expect(again.status).toBe(409);
  });

  it('answers omo_unavailable when the catalog is not wired', async () => {
    projectRoot = createTempProject();
    appHandle = startSkillsApp({ projectRoot });

    const installResponse = await fetch(`${appHandle.baseUrl}/api/config/skills/install-omo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillName: 'ulw-plan', scope: 'user' }),
    });
    expect(installResponse.status).toBe(500);
    expect((await installResponse.json()).error.kind).toBe('omo_unavailable');

    const catalogPayload = await (await fetch(`${appHandle.baseUrl}/api/config/skills/catalog`)).json();
    expect(catalogPayload.sources.map((source) => source.id)).not.toContain('omo');
  });
});
