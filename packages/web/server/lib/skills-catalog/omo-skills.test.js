import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  createOmoSkillCatalog,
  installOmoSkill,
  listOmoSkills,
  OMO_SKILLS_VERSION,
  resolveOmoSkillForInstall,
} from './omo-skills.js';

const EXPECTED_NAMES = [
  'ultrawork',
  'ulw-loop',
  'ulw-plan',
  'ulw-research',
  'mass-ulw',
  'hyperplan',
  'onboarding',
  'dag-library',
];

describe('omo skill bundle', () => {
  it('lists the 8 bundled skills as installable with descriptions', () => {
    const listed = listOmoSkills();
    expect(listed.ok).toBe(true);
    expect(listed.items.map((item) => item.skillName)).toEqual(EXPECTED_NAMES);
    for (const item of listed.items) {
      expect(item.installable).toBe(true);
      expect(item.description.length).toBeGreaterThan(0);
      // The catalog row trims repoSource unconditionally: it must be a string.
      expect(typeof item.repoSource).toBe('string');
      expect(typeof item.skillDir).toBe('string');
    }
    expect(OMO_SKILLS_VERSION).toBe(1);
  });

  it('declares runtime requirements per skill', () => {
    const listed = listOmoSkills();
    const research = listed.items.find((item) => item.skillName === 'ulw-research');
    expect(String(research?.requires || '')).toContain('team-tools');
  });

  it('refuses unknown names with suggestions instead of failing silently', () => {
    const listed = listOmoSkills();
    const resolved = resolveOmoSkillForInstall(listed.items, 'ulw-loopp');
    expect(resolved.ok).toBe(false);
    expect(resolved.error.kind).toBe('missing_skill');
    expect(resolved.error.suggestions).toContain('ulw-loop');
  });

  it('refuses traversal names without touching the filesystem', () => {
    const listed = listOmoSkills();
    const resolved = resolveOmoSkillForInstall(listed.items, '../evil');
    expect(resolved.ok).toBe(false);
    expect(resolved.error.kind).toBe('invalid_skill_name');
  });

  it('installs bytes into a managed root and refuses to overwrite', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omo-skills-'));
    const first = installOmoSkill({ skillName: 'ulw-plan', scope: 'user', userSkillDir: root });
    expect(first.ok).toBe(true);
    expect(first.installed).toHaveLength(1);
    const installed = fs.readFileSync(first.installed[0].path, 'utf8');
    expect(installed).toContain('name: ulw-plan');
    const second = installOmoSkill({ skillName: 'ulw-plan', scope: 'user', userSkillDir: root });
    expect(second.ok).toBe(false);
    expect(second.error.kind).toBe('already_installed');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('keeps an installed override intact across a bundle refresh and restores on delete', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omo-skills-upgrade-'));
    const first = installOmoSkill({ skillName: 'ulw-loop', scope: 'user', userSkillDir: root });
    expect(first.ok).toBe(true);
    const target = first.installed[0].path;
    const before = fs.readFileSync(target, 'utf8');
    // Upgrade path: the bundle is re-read (regen) while the override lives
    // on disk. Re-listing must not touch the installed copy.
    expect(listOmoSkills().ok).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe(before);
    // Reset path: deleting the override restores the packaged default on
    // the next install, byte-identical to the bundle.
    fs.rmSync(path.dirname(target), { recursive: true, force: true });
    const again = installOmoSkill({ skillName: 'ulw-loop', scope: 'user', userSkillDir: root });
    expect(again.ok).toBe(true);
    expect(fs.readFileSync(again.installed[0].path, 'utf8')).toBe(before);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('exposes the route wiring seam', () => {
    const catalog = createOmoSkillCatalog();
    expect(catalog.source.id).toBe('omo');
    expect(catalog.listItems().items).toHaveLength(8);
  });
});
