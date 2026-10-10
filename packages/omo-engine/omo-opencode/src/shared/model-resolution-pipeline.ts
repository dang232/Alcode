import {
  _setModelResolutionLogImplementationForTesting,
  resolveModelPipeline as resolveModelPipelineFromCore,
} from "../../../model-core/src/index.ts"
import type {
  PipelineModelResolutionRequest,
  PipelineModelResolutionResult,
} from "../../../model-core/src/index.ts"
import * as connectedProvidersCache from "./connected-providers-cache"

export { _setModelResolutionLogImplementationForTesting }

export function resolveModelPipeline(
  request: PipelineModelResolutionRequest,
): PipelineModelResolutionResult | undefined {
  return resolveModelPipelineFromCore(request, connectedProvidersCache)
}
export type {
  PipelineModelResolutionRequest as ModelResolutionRequest,
  PipelineModelResolutionProvenance as ModelResolutionProvenance,
  PipelineModelResolutionResult as ModelResolutionResult,
} from "../../../model-core/src/index.ts"
