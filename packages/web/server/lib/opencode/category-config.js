import { OMO_NATIVE_CATALOG_ITEMS } from '../agents/omo-native-catalog.bundle.js';
import { isRecord } from './config-v2.js';
import { loadOmoConfig, updateOmoConfig } from './omo-config.bundle.js';

const CATEGORY_NAMES = new Set(
  OMO_NATIVE_CATALOG_ITEMS.filter((item) => item.kind === 'category').map((item) => item.id),
);

const MODEL_REFERENCE = /^[^/\s]+\/[^/\s]+(#\S+)?$/;

const assertCategory = (name) => {
  if (!CATEGORY_NAMES.has(name)) {
    throw new Error(`Unknown category "${name}"`);
  }
};

const assertModel = (model) => {
  if (!MODEL_REFERENCE.test(model)) {
    throw new Error(`Invalid model reference "${model}": expected "provider/model"`);
  }
};

const catalogDefaults = (name) => {
  const item = OMO_NATIVE_CATALOG_ITEMS.find((entry) => entry.kind === 'category' && entry.id === name);
  const entryModel = item && item.model ? item.model : null;
  return {
    requiresModels: [...(item?.requiresModels ?? [])],
    model: entryModel,
  };
};

const readOverride = (name, projectDir) => {
  const loaded = loadOmoConfig(projectDir ? { cwd: projectDir } : {});
  const categories = loaded?.config?.categories ?? {};
  const entry = categories[name];
  if (!isRecord(entry)) return null;
  return entry;
};

export function getCategoryConfig(name, { projectDir } = {}) {
  assertCategory(name);
  const defaults = catalogDefaults(name);
  const override = readOverride(name, projectDir);
  const overrideModel = override && override.model ? override.model : null;
  return {
    name,
    defaults,
    override,
    effectiveModel: overrideModel ?? defaults.model,
  };
}

export function setCategoryModel(name, model, { scope = 'user', projectDir } = {}) {
  assertCategory(name);
  assertModel(model);
  if (scope !== 'user' && scope !== 'project') {
    throw new Error(`Invalid scope "${scope}": expected "user" or "project"`);
  }
  if (scope === 'project' && !projectDir) {
    throw new Error('Project scope needs a project directory');
  }
  const options = {
    edits: [{ path: ['categories', name, 'model'], value: model }],
    scope,
  };
  if (projectDir) options.projectDir = projectDir;
  return updateOmoConfig(options);
}

export function clearCategoryModel(name, { scope = 'user', projectDir } = {}) {
  assertCategory(name);
  if (scope !== 'user' && scope !== 'project') {
    throw new Error(`Invalid scope "${scope}": expected "user" or "project"`);
  }
  if (scope === 'project' && !projectDir) {
    throw new Error('Project scope needs a project directory');
  }
  const options = {
    edits: [{ path: ['categories', name, 'model'], value: undefined }],
    scope,
  };
  if (projectDir) options.projectDir = projectDir;
  return updateOmoConfig(options);
}
