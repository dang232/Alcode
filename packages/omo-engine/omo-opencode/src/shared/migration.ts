import { configureMigrationCategoryDefaults } from "../../../utils/src/migration/agent-category.ts"

import { DEFAULT_CATEGORIES } from "../tools/delegate-task/constants"

configureMigrationCategoryDefaults(DEFAULT_CATEGORIES)

export { AGENT_NAME_MAP, BUILTIN_AGENT_NAMES, migrateAgentNames } from "../../../utils/src/migration/agent-names.ts"
export { migrateAgentConfigToCategory, MODEL_TO_CATEGORY_MAP, shouldDeleteAgentConfig } from "../../../utils/src/migration/agent-category.ts"
export { HOOK_NAME_MAP, migrateHookNames } from "../../../utils/src/migration/hook-names.ts"
export { getSidecarPath, readAppliedMigrations, writeAppliedMigrations } from "../../../utils/src/migration/migrations-sidecar.ts"
export { migrateModelVersions, MODEL_VERSION_MAP } from "../../../utils/src/migration/model-versions.ts"
