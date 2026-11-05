import { configureSharedSubunitLogger } from "../../../utils/src/index.ts"
import {
  configurePromptDispatchRouteResolver,
} from "../../../utils/src/prompt-async-gate/route-resolver.ts"

import {
  isPreSendConnectionFailure,
  markLiveRouteUnavailable,
  resolveDispatchClient,
  tryResolveDispatchClientSync,
} from "./live-server-route"
import { log } from "./logger"

configureSharedSubunitLogger(log)
configurePromptDispatchRouteResolver({
  tryResolveDispatchClientSync,
  resolveDispatchClient,
  isPreSendConnectionFailure,
  markLiveRouteUnavailable,
})

export * from "../../../utils/src/prompt-async-gate.ts"
