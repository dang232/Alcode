import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadVerificationConfig, parseVerificationConfig, VERIFICATION_CONFIG_PATH } from "./config"

const baseCheck = {
  id: "unit-core",
  name: "Core unit tests",
  category: "unit",
  command: ["bun", "test"],
  cwd: "packages/web",
  packageScope: "@alcode/web",
  timeoutMs: 120_000,
  required: true,
  appliesTo: ["packages/web/**"],
}

const check = (overrides: Partial<typeof baseCheck> = {}) => ({ ...baseCheck, ...overrides })

const config = (checks: readonly object[], version = 1) => JSON.stringify({ version, checks })

function diagnosticsOf(text: string): readonly string[] {
  const result = parseVerificationConfig(text)
  return result.status === "invalid" ? result.diagnostics : []
}

describe("explicit verification configuration", () => {
  test("#given a valid configuration #when parsed #then every field survives", () => {
    const result = parseVerificationConfig(config([check()]))
    expect(result.status).toBe("configured")
    if (result.status !== "configured") return
    expect(result.checks[0]?.checkId).toBe("unit-core")
    expect(result.checks[0]?.command).toEqual(["bun", "test"])
    expect(result.checks[0]?.cwd).toBe("packages/web")
    expect(result.checks[0]?.configVersion).toBe(1)
  })

  test("#given an absolute working directory #when parsed #then it is rejected", () => {
    expect(diagnosticsOf(config([check({ cwd: "/etc" })])).join()).toContain("absolute path")
  })

  test("#given a traversal working directory #when parsed #then it is rejected", () => {
    expect(diagnosticsOf(config([check({ cwd: "../outside" })])).join()).toContain("traverse")
  })

  test("#given a nested traversal #when parsed #then it is rejected", () => {
    expect(diagnosticsOf(config([check({ cwd: "packages/../../etc" })])).join()).toContain("traverse")
  })

  test("#given a drive-qualified working directory #when parsed #then it is rejected", () => {
    expect(diagnosticsOf(config([check({ cwd: "C:/windows" })])).join()).toContain("drive")
  })

  test("#given an empty command #when parsed #then it is rejected", () => {
    expect(diagnosticsOf(config([check({ command: [] })])).join()).toContain("non-empty argv")
  })

  test("#given a shell command string #when parsed #then it is rejected", () => {
    expect(diagnosticsOf(config([check({ command: ["bun test --bail"] })])).join()).toContain("one argv element")
  })

  test("#given a non-array command #when parsed #then the shell-string mistake is named", () => {
    const malformed = { ...baseCheck, command: "bun test" }
    expect(diagnosticsOf(config([malformed])).join()).toContain("not a shell string")
  })

  test("#given duplicate check ids #when parsed #then both the duplicate and its origin are named", () => {
    expect(diagnosticsOf(config([check(), check()])).join()).toContain("duplicate")
  })

  test("#given a malformed check id #when parsed #then it is rejected", () => {
    expect(diagnosticsOf(config([check({ id: "../escape" })])).join()).toContain("id: must match")
  })

  test("#given an unknown category #when parsed #then it is rejected", () => {
    expect(diagnosticsOf(config([check({ category: "vibes" })])).join()).toContain("category: must be one of")
  })

  test("#given an unknown security-sensitive field #when parsed #then it is rejected", () => {
    const withEnv = { ...baseCheck, env: { TOKEN: "x" } }
    expect(diagnosticsOf(config([withEnv])).join()).toContain("unknown field")
  })

  test("#given an unknown root field #when parsed #then it is rejected", () => {
    expect(diagnosticsOf(JSON.stringify({ version: 1, checks: [check()], trusted: true })).join()).toContain("unknown field")
  })

  test("#given an unsupported version #when parsed #then it is rejected", () => {
    expect(diagnosticsOf(config([check()], 2)).join()).toContain("version: must be 1")
  })

  test("#given a sub-second timeout #when parsed #then it is rejected", () => {
    expect(diagnosticsOf(config([check({ timeoutMs: 5 })])).join()).toContain("timeoutMs")
  })

  test("#given a non-integer timeout #when parsed #then it is rejected", () => {
    expect(diagnosticsOf(config([check({ timeoutMs: 1200.5 })])).join()).toContain("timeoutMs")
  })

  test("#given malformed JSON #when parsed #then it is invalid, never absent", () => {
    expect(parseVerificationConfig("{ not json").status).toBe("invalid")
  })

  test("#given a configuration declaring no checks #when parsed #then it is invalid rather than silently empty", () => {
    expect(diagnosticsOf(config([])).join()).toContain("declares no checks")
  })
})

describe("configuration loading against a real tree", () => {
  test("#given no configuration file #when loaded #then the state is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "alcode-cfg-absent-"))
    expect(loadVerificationConfig(root).status).toBe("absent")
  })

  test("#given an invalid configuration file #when loaded #then it stays invalid and never falls back", () => {
    const root = mkdtempSync(join(tmpdir(), "alcode-cfg-invalid-"))
    mkdirSync(join(root, ".alcode"), { recursive: true })
    writeFileSync(join(root, ...VERIFICATION_CONFIG_PATH.split("/")), config([check({ cwd: "../escape" })]), "utf8")
    const result = loadVerificationConfig(root)
    expect(result.status).toBe("invalid")
    expect(result.status === "invalid" ? result.diagnostics.join() : "").toContain("traverse")
  })

  test("#given a valid configuration file #when loaded #then it resolves against the given root", () => {
    const root = mkdtempSync(join(tmpdir(), "alcode-cfg-valid-"))
    mkdirSync(join(root, ".alcode"), { recursive: true })
    mkdirSync(join(root, "packages", "web"), { recursive: true })
    writeFileSync(join(root, ...VERIFICATION_CONFIG_PATH.split("/")), config([check()]), "utf8")
    expect(loadVerificationConfig(root).status).toBe("configured")
  })
})
