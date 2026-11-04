import {
} from "./context-limit-resolver"
import type {
} from "./dynamic-truncator-types"

// Hard ceiling on how long `session.messages()` is allowed to block inside
// `fetchContextWindowUsage`. Without it, a stuck OpenCode RPC (observed when
// `session.processor` enters an "Aborted process" loop) would leave the cached
// promise pending forever and every hook that calls `truncator.truncate(...)`
// would hang on it (issue #4086).

// Test-only override for the fetch timeout used by `fetchContextWindowUsage`.
// `undefined` means "use the production default".
let contextWindowUsageFetchTimeoutMsForTesting: number | undefined = undefined

export function _setContextWindowUsageFetchTimeoutMsForTesting(
	ms: number | undefined,
): void {
	contextWindowUsageFetchTimeoutMsForTesting = ms
}

