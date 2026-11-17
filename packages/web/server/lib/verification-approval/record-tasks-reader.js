import { homedir } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"

import { loadOmoConfig } from "../../../../omo-engine/omo-config-core/src/index.ts"
import { resolveStateDir } from "../../../../omo-engine/senpi-task/src/store/state-dir"
import { createRecordTaskReader } from "../run-graph/record-tasks.js"

const AGENT_DIR_ENV_NAMES = ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"]

/** Same convention the engine uses, so a store it writes is a store this reader may read. */
const agentRoot = () => {
  for (const name of AGENT_DIR_ENV_NAMES) {
    const configured = process.env[name]?.trim()
    if (configured !== undefined && configured.length > 0) return resolve(configured)
  }
  return join(process.env.HOME ?? process.env.USERPROFILE ?? homedir(), ".omo", "agent")
}

const isInside = (child, parent) => {
  const relativePath = relative(parent, child)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

/**
 * The record reader with the engine's own store resolution bound in.
 *
 * `record-tasks.js` stays free of engine TypeScript so the Node server can import its merge helper;
 * this wrapper is bundled (bun resolves the .ts imports) and is the only place the two meet. The
 * store always comes from the project being read, never from the caller: a request cannot name
 * another project's task directory.
 *
 * A project's committed config can name one, though. `task.state_dir` is merged from
 * `<project>/.omo/omo.jsonc` with no scope restriction, so a cloned repository could point the read at
 * another project's store and have its task names, summaries and session ids painted here. A configured
 * value is therefore resolved against the project (never the server's working directory) and accepted
 * only inside the project or the agent dir; anything else fails closed with a named reason instead of
 * reading it.
 */
export const createRecordTaskReaderForProject = (options = {}) => {
  const settings = {
    stateDirOf: (directory) => {
      const fallback = resolveStateDir({ project_dir: directory })
      const configured = loadOmoConfig({ cwd: directory }).config.task?.state_dir
      if (configured === undefined || configured.trim().length === 0) return fallback
      const projectRoot = resolve(directory)
      const resolved = isAbsolute(configured) ? resolve(configured) : resolve(projectRoot, configured)
      if (isInside(resolved, projectRoot) || isInside(resolved, agentRoot())) return resolved
      throw new Error(`task.state_dir is outside the project and the agent dir: ${resolved}`)
    },
  }
  if (options.limit !== undefined) settings.limit = options.limit
  if (options.cacheStore !== undefined) settings.cacheStore = options.cacheStore
  return createRecordTaskReader(settings)
}
