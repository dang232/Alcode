// OmO skill catalog: route-wiring seam for the OmO skill source.
//
// Same seam as the engine catalog (`{ source, listItems, install}`) so the
// skill routes can adopt it without reshaping: `source` describes the
// entry, `listItems` resolves `{ ok, items }`, `install` resolves
// `{ ok, installed, skipped }` or `{ ok: false, error }`. There is no
// loader-backed OmO registry yet, so the catalog lists nothing and refuses
// installs explicitly instead of failing open; the lane that defines the
// registry fills these two operations in.
import { SKILL_DIR, writeMdFile } from '../opencode/shared.js';

export const OMO_CATALOG_SOURCE_ID = 'omo';
export const OMO_CATALOG_SOURCE_TYPE = 'omo';

export function createOmoSkillCatalog({ userSkillDir = SKILL_DIR, writeSkillFile = writeMdFile } = {}) {
  void userSkillDir;
  void writeSkillFile;
  return {
    source: {
      id: OMO_CATALOG_SOURCE_ID,
      label: 'OmO skills',
      description: 'Built-in skills from the OmO platform',
      source: OMO_CATALOG_SOURCE_ID,
      sourceType: OMO_CATALOG_SOURCE_TYPE,
    },
    listItems: async () => ({ ok: true, items: [] }),
    install: async () => ({
      ok: false,
      error: { kind: 'omo_unavailable', message: 'The OmO skill catalog has no installable registry yet.' },
    }),
  };
}
