/**
 * Generated from the engine telemetry gate — DO NOT EDIT BY HAND.
 *
 * Regen with `bun ./telemetry-opt-out.regen.js` in this directory. Bundled
 * with Bun.build (target node, format esm, external node:* builtins only) so
 * the engine TypeScript ships inline: the packaged web server runs under
 * plain Node with no transpile step, where a static `.ts` import fails.
 */
// ../../../omo-engine/telemetry-core/src/env.ts
var TRUTHY_DISABLE_VALUES = ["1", "true", "yes"];
var SEND_OPT_OUT_VALUES = ["0", "false", "no", "yes"];
function normalizeEnvValue(value) {
  return value?.trim().toLowerCase();
}
function includesValue(values, value) {
  const normalized = normalizeEnvValue(value);
  return normalized !== undefined && values.includes(normalized);
}
function isDisableFlag(value) {
  return includesValue(TRUTHY_DISABLE_VALUES, value);
}
function isSendOptOutFlag(value) {
  return includesValue(SEND_OPT_OUT_VALUES, value);
}
function shouldDisableTelemetry(input) {
  const env = input.env ?? process.env;
  const globalPrefix = input.globalEnvPrefix ?? "OMO";
  const prefixes = Array.from(new Set([globalPrefix, input.productEnvPrefix]));
  if (isDisableFlag(env["DO_NOT_TRACK"])) {
    return true;
  }
  for (const prefix of prefixes) {
    if (isDisableFlag(env[`${prefix}_DISABLE_POSTHOG`])) {
      return true;
    }
    if (isSendOptOutFlag(env[`${prefix}_SEND_ANONYMOUS_TELEMETRY`])) {
      return true;
    }
  }
  return false;
}

// ../../../omo-engine/telemetry-core/src/telemetry-opt-out.ts
function isTelemetryOptedOut(input = {}) {
  if (input.configEnabled === false) {
    return true;
  }
  if (input.reportUsage === false) {
    return true;
  }
  if (input.enterpriseMode === true) {
    return true;
  }
  if (shouldDisableTelemetry({
    env: input.env ?? process.env,
    productEnvPrefix: input.productEnvPrefix ?? "OMO"
  })) {
    return true;
  }
  return false;
}
export {
  isTelemetryOptedOut
};
