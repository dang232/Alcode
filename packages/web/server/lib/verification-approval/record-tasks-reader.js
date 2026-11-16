import { loadOmoConfig } from "../../../../omo-engine/omo-config-core/src/index.ts"
import { resolveStateDir } from "../../../../omo-engine/senpi-task/src/store/state-dir"
import { createRecordTaskReader } from "../run-graph/record-tasks.js"

/**
 * The record reader with the engine's own store resolution bound in.
 *
 * `record-tasks.js` stays free of engine TypeScript so the Node server can import its merge helper;
 * this wrapper is bundled (bun resolves the .ts imports) and is the only place the two meet. The
 * store always comes from the project being read, never from the caller: a request cannot name
 * another project's task directory.
 */
export const createRecordTaskReaderForProject = (options = {}) => {
  const settings = {
    stateDirOf: (directory) => {
      const configured = loadOmoConfig({ cwd: directory }).config.task?.state_dir
      return resolveStateDir(
        configured === undefined ? { project_dir: directory } : { project_dir: directory, task: { state_dir: configured } },
      )
    },
  }
  if (options.limit !== undefined) settings.limit = options.limit
  if (options.cacheStore !== undefined) settings.cacheStore = options.cacheStore
  return createRecordTaskReader(settings)
}
