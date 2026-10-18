import { describe, expect, it } from 'vitest';

import { createOmoSkillCatalog, OMO_CATALOG_SOURCE_ID } from './omo-skills.js';

describe('createOmoSkillCatalog', () => {
  it('exposes the route-wiring seam with an empty registry', async () => {
    const catalog = createOmoSkillCatalog({ userSkillDir: '/skills', writeSkillFile: async () => {} });

    expect(catalog.source.id).toBe(OMO_CATALOG_SOURCE_ID);
    await expect(catalog.listItems()).resolves.toEqual({ ok: true, items: [] });
    const refused = await catalog.install({ skillName: 'anything' });
    expect(refused.ok).toBe(false);
    expect(refused.error?.kind).toBe('omo_unavailable');
  });
});
