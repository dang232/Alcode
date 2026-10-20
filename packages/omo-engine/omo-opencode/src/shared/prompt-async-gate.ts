import { configureSharedSubunitLogger } from "../../../utils/src/index.ts"
import {
  LIVE_ROUTE_DISPATCH_LOG,
  LIVE_ROUTE_UNAVAILABLE_LOG,
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

export {
  LIVE_ROUTE_DISPATCH_LOG,
  LIVE_ROUTE_UNAVAILABLE_LOG,
}
export * from "../../../utils/src/prompt-async-gate.ts"
