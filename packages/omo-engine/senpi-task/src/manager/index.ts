export { createTaskManager } from "./manager"
export { TaskConcurrency } from "./concurrency"
export type { TaskConcurrencyConfig } from "./concurrency"
export { decideDepthPolicy } from "./depth-policy"
export type { DepthDecision, DepthPolicyInput } from "./depth-policy"
export { NameRegistry } from "./names"
export type { NameRegistration } from "./names"
export { createExecutionModeGate, resolveAutoExecutionMode, resolveExecutionMode } from "./execution-mode"
export type {
  ConfiguredExecutionMode,
  ExecutionMode,
  ExecutionModeGate,
  ExecutionModeSources,
} from "./execution-mode"
export { adaptInProcessHandle, adaptRpcHandle } from "./child-handle"
export { HOST_TURN_RESUMED_EVENT } from "./host-turn-resumed"
export type { ManagedChildEvent, ManagedChildHandle, ManagedChildListener } from "./child-handle"

export { createInProcessManagedRunner, createRpcManagedRunner } from "./runner"
export type {
  InProcessRunnerLike,
  InProcessSessionContext,
  InProcessSessionContextProvider,
  RpcRunnerLike,
} from "./runner"
export { createParentRegistrySessionContext, findModelReference } from "./parent-registry-context"
export type { ChildModelRegistry, ParentModelRegistryResolver } from "./parent-registry-context"
export type {
  AdmitResident,
  ChildPlanner,
  ContinueDelivery,
  ContinueResult,
  ListedTask,
  ListScope,
  ManagedRunner,
  ManagedStartSpec,
  ManagerStartSpec,
  PlanResolution,
  PlanResolutionError,
  ResolvedChildPlan,
  TrustedRespawnLaunch,
  TrustedRespawnLaunchResolver,
  SpawnAdmission,
  StartResult,
  TaskManager,
  TaskManagerOptions,
} from "./types"
