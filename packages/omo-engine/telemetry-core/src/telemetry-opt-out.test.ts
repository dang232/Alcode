import { describe, expect, test } from "bun:test"

import { isTelemetryOptedOut } from "./index"

describe("shared telemetry opt-out gate", () => {
  describe("#given nothing opts out", () => {
    test("#when evaluated #then emission is allowed", () => {
      // when
      const result = isTelemetryOptedOut({ env: {}, productEnvPrefix: "OMO" })

      // then
      expect(result).toBe(false)
    })

    test("#when the client reports usage and no env flag is set #then emission is allowed", () => {
      // when
      const result = isTelemetryOptedOut({
        env: {},
        productEnvPrefix: "OMO",
        reportUsage: true,
        enterpriseMode: false,
        configEnabled: true,
      })

      // then
      expect(result).toBe(false)
    })
  })

  describe("#given the shared env matrix opts out", () => {
    test.each([
      ["DO_NOT_TRACK", { DO_NOT_TRACK: "1" }],
      ["global disable", { OMO_DISABLE_POSTHOG: "1" }],
      ["global send opt-out", { OMO_SEND_ANONYMOUS_TELEMETRY: "0" }],
      ["global send yes convergence", { OMO_SEND_ANONYMOUS_TELEMETRY: "yes" }],
      ["product disable", { OMO_CODEX_DISABLE_POSTHOG: "true" }],
    ] as const)("#when %s is set #then emission is blocked", (_name, env) => {
      // when
      const result = isTelemetryOptedOut({ env, productEnvPrefix: "OMO_CODEX" })

      // then
      expect(result).toBe(true)
    })
  })

  describe("#given a caller-level signal opts out", () => {
    test.each([
      ["reportUsage false", { reportUsage: false as const }],
      ["enterprise mode", { enterpriseMode: true as const }],
      ["config disabled", { configEnabled: false as const }],
    ])("#when %s #then emission is blocked", (_name, signal) => {
      // when
      const result = isTelemetryOptedOut({ env: {}, productEnvPrefix: "OMO", ...signal })

      // then
      expect(result).toBe(true)
    })
  })
})
