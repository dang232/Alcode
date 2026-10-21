/**
 * Native ULW run/roster/receipt store with checkpoint refusal.
 *
 * Written only by native tools (single-writer rule). The CLI-owned loop
 * files under `<repoRoot>/.omo/ulw-loop` stay CLI-written; this module
 * treats them as read-only and never writes them.
 */
export type {
  CreateUlwRunInput,
  RecordUlwChildResultInput,
  UlwChildReceipts,
  UlwChildResultReceipt,
  UlwChildResultStatus,
  UlwDispatchRoster,
  UlwMissingReceipts,
  UlwRunRecord,
  UlwRunStatus,
} from "./types.ts"
export {
  dispatchedChildrenPendingError,
  goalNotDispatchedError,
  invalidInputError,
  runNotActiveError,
  runNotFoundError,
  UlwUsageError,
  type UlwUsageErrorCode,
} from "./errors.ts"
export { UlwStore, type UlwStoreOptions } from "./store.ts"
export { gateCheckpoint, type UlwCheckpointResult, type UlwCheckpointScope } from "./checkpoint.ts"
