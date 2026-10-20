import { shouldDisableTelemetry } from "./env"
import type { TelemetryEnv } from "./types"

export type TelemetryOptOutInput = {
  readonly env?: TelemetryEnv
  readonly productEnvPrefix?: string
  readonly reportUsage?: boolean
  readonly enterpriseMode?: boolean
  readonly configEnabled?: boolean
}

// One shared opt-out gate for every telemetry emission path.
//
// Engine PostHog (`omo-opencode/src/shared/posthog.ts`) and the app
// update-check usage ping (`packages/web/server/lib/package-manager.js`)
// each had their own opt-out check with divergent semantics: the engine
// wrapper ignored `DO_NOT_TRACK`, and the update check ignored the env
// matrix entirely. Both now delegate here. An emission is blocked when ANY
// signal opts out:
// - `configEnabled === false`: the product config disabled telemetry.
// - `reportUsage === false`: the caller declined usage reporting.
// - `enterpriseMode === true`: enterprise keeps the update check but never
//   reports usage.
// - the `shouldDisableTelemetry` env matrix (`DO_NOT_TRACK`,
//   `${PREFIX}_DISABLE_POSTHOG`, `${PREFIX}_SEND_ANONYMOUS_TELEMETRY`,
//   global `OMO_` prefix plus `productEnvPrefix`).
// Undefined inputs mean "no signal" and never block on their own.
export function isTelemetryOptedOut(input: TelemetryOptOutInput = {}): boolean {
  if (input.configEnabled === false) {
    return true
  }
  if (input.reportUsage === false) {
    return true
  }
  if (input.enterpriseMode === true) {
    return true
  }
  if (
    shouldDisableTelemetry({
      env: input.env ?? process.env,
      productEnvPrefix: input.productEnvPrefix ?? "OMO",
    })
  ) {
    return true
  }
  return false
}
