import type { BuiltinSkill } from "../types"

import {
  GIT_MASTER_SKILL_DESCRIPTION,
  GIT_MASTER_SKILL_NAME,
} from "./git-master-skill-metadata.ts"
import { GIT_MASTER_COMMIT_WORKFLOW_SECTION } from "./git-master-sections/commit-workflow.ts"
import { GIT_MASTER_HISTORY_SEARCH_WORKFLOW_SECTION } from "./git-master-sections/history-search-workflow.ts"
import { GIT_MASTER_OVERVIEW_SECTION } from "./git-master-sections/overview.ts"
import { GIT_MASTER_QUICK_REFERENCE_SECTION } from "./git-master-sections/quick-reference.ts"
import { GIT_MASTER_REBASE_WORKFLOW_SECTION } from "./git-master-sections/rebase-workflow.ts"

const GIT_MASTER_TEMPLATE = [
  GIT_MASTER_OVERVIEW_SECTION,
  GIT_MASTER_COMMIT_WORKFLOW_SECTION,
  "---\n---",
  GIT_MASTER_REBASE_WORKFLOW_SECTION,
  "---\n---",
  GIT_MASTER_HISTORY_SEARCH_WORKFLOW_SECTION,
  "---",
  GIT_MASTER_QUICK_REFERENCE_SECTION,
].join("\n\n")

export const gitMasterSkill: BuiltinSkill = {
  name: GIT_MASTER_SKILL_NAME,
  description: GIT_MASTER_SKILL_DESCRIPTION,
  template: GIT_MASTER_TEMPLATE,
}
