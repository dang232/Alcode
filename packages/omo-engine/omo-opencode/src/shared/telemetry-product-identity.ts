import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  type TelemetryProductConfig,
} from "../../../telemetry-core/src/index.ts"
// Vendor relocation: upstream resolves the monorepo-root manifest with four
// levels; the vendored closure root (packages/omo-engine/package.json) is
// three levels up. Re-apply on re-vendor.
import packageJson from "../../../package.json" with { type: "json" }
import { CACHE_DIR_NAME, PLUGIN_NAME, PUBLISHED_PACKAGE_NAME } from "./plugin-identity"

export function createOpencodeTelemetryProductConfig(): TelemetryProductConfig {
  return {
    cacheDirName: CACHE_DIR_NAME,
    defaultApiKey: DEFAULT_POSTHOG_API_KEY,
    defaultHost: DEFAULT_POSTHOG_HOST,
    eventName: "omo_daily_active",
    machineIdPrefix: "oh-my-openagent:",
    packageName: PUBLISHED_PACKAGE_NAME,
    packageVersion: packageJson.version,
    platform: "oh-my-opencode",
    productEnvPrefix: "OMO",
    productName: PUBLISHED_PACKAGE_NAME,
    additionalProperties: {
      plugin_name: PLUGIN_NAME,
    },
  }
}
