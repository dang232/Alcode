// The explicit, repository-owned verification configuration.
//
// Why this file and not `opencode.json`: that file belongs to OpenCode, and an Alcode capability
// reading it would make Alcode's trust decisions depend on a configuration it does not own. The
// format here is small, versioned, and rejected loudly - a configuration that fails validation is
// NEVER silently replaced by inferred package scripts.
//
// Structure is decoded by typebox at the boundary, then the semantic rules (path containment, argv
// shape, duplicate ids) run on the decoded value. Decoding first is what keeps this file free of
// runtime `typeof` narrowing: after `Value.Check` the shape is established, not guessed.
import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { Type, type Static } from "typebox"
import { Value } from "typebox/value"

export const VERIFICATION_CONFIG_PATH = ".alcode/verification.json"

export const VERIFICATION_CONFIG_VERSION = 1

const CATEGORIES = [
  "unit",
  "integration",
  "lint",
  "typecheck",
  "build",
  "native",
  "session",
  "schema",
  "security",
  "regression",
] as const

export type VerificationConfigCategory = (typeof CATEGORIES)[number]

const CHECK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const CATEGORY_SET = new Set<string>(CATEGORIES)
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 30 * 60_000

const CheckSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    category: Type.String(),
    command: Type.Array(Type.String()),
    cwd: Type.Optional(Type.String()),
    packageScope: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    required: Type.Optional(Type.Boolean()),
    appliesTo: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
)

const ConfigSchema = Type.Object(
  {
    version: Type.Number(),
    checks: Type.Array(CheckSchema),
  },
  { additionalProperties: false },
)

type RawCheck = Static<typeof CheckSchema>

type RawConfig = Static<typeof ConfigSchema>

export type ConfiguredCheck = {
  readonly checkId: string
  readonly name: string
  readonly category: VerificationConfigCategory
  readonly command: readonly string[]
  readonly cwd: string
  readonly packageScope: string
  readonly timeoutMs: number
  readonly required: boolean
  readonly appliesTo: readonly string[]
  readonly configVersion: number
}

export type ConfigLoad =
  | { readonly status: "configured"; readonly checks: readonly ConfiguredCheck[] }
  | { readonly status: "absent" }
  | { readonly status: "invalid"; readonly diagnostics: readonly string[] }

// TypeBox reports an unexpected property generically; the contract this module publishes is that a
// misnamed security-relevant field is reported as an unknown field, whatever its name was.
function describeError(path: string, keyword: string, message: string): string {
  const where = path === "" ? "config" : path.replace(/^\//, "").split("/").join(".")
  if (keyword.includes("additional") || message.includes("Unexpected property")) return `${where}: unknown field`
  // A string where argv belongs is the shell-string mistake, and naming it as a plain type error
  // would lose the only guidance that tells the author how to fix it.
  if (keyword === "type" && where.endsWith("command")) {
    return `${where}: must be a non-empty argv array, not a shell string`
  }
  return `${where}: ${message}`
}

function structuralDiagnostics(candidate: RawConfig): string[] {
  const diagnostics: string[] = []
  for (const error of Value.Errors(ConfigSchema, candidate)) {
    diagnostics.push(describeError(error.instancePath, error.keyword, error.message))
  }
  return diagnostics
}

// A working directory is only accepted when it stays inside the project after resolution. `..`,
// absolute paths and Windows drive letters are rejected on the string BEFORE resolution, so a
// crafted value cannot escape through the filesystem's own normalisation.
function cwdDiagnostics(value: string, where: string): string[] {
  if (value.trim() === "") return [`${where}: must be a non-empty relative path`]
  if (/^[A-Za-z]:/.test(value)) return [`${where}: must not name a drive`]
  if (isAbsolute(value)) return [`${where}: must be relative to the project root, got an absolute path`]
  if (value.split(/[\\/]/).includes("..")) return [`${where}: must not traverse outside the project root`]
  return []
}

function commandDiagnostics(command: readonly string[], where: string): string[] {
  if (command.length === 0) return [`${where}: must be a non-empty argv array, not a shell string`]
  const diagnostics: string[] = []
  for (const [position, arg] of command.entries()) {
    if (arg === "") {
      diagnostics.push(`${where}[${position}]: must be a non-empty string`)
      continue
    }
    // A whitespace-carrying executable means the author wrote a shell string expecting it to be
    // split. Accepting it would hide shell expansion from the approval UI it is meant to show.
    if (position === 0 && /\s/.test(arg)) {
      diagnostics.push(`${where}[${position}]: the executable must be one argv element, not a command line`)
    }
  }
  return diagnostics
}

function checkDiagnostics(check: RawCheck, index: number): string[] {
  const where = `checks[${index}]`
  const diagnostics: string[] = []

  if (!CHECK_ID.test(check.id)) diagnostics.push(`${where}.id: must match ${CHECK_ID.source}`)
  if (check.name.trim() === "") diagnostics.push(`${where}.name: must be a non-empty string`)
  if (!CATEGORY_SET.has(check.category)) {
    diagnostics.push(`${where}.category: must be one of ${CATEGORIES.join(", ")}`)
  }
  diagnostics.push(...commandDiagnostics(check.command, `${where}.command`))
  diagnostics.push(...cwdDiagnostics(check.cwd ?? ".", `${where}.cwd`))

  const timeoutMs = check.timeoutMs ?? 120_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    diagnostics.push(`${where}.timeoutMs: must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`)
  }
  return diagnostics
}

export function parseVerificationConfig(text: string): ConfigLoad {
  let candidate: RawConfig
  try {
    // SAFETY: the assertion is the input to Value.Check below, which establishes the shape before
    // any field is read. Nothing here treats the decoded text as trusted.
    candidate = JSON.parse(text) as RawConfig
  } catch {
    return { status: "invalid", diagnostics: ["config: not valid JSON"] }
  }

  const structural = structuralDiagnostics(candidate)
  if (structural.length > 0) return { status: "invalid", diagnostics: structural }

  const diagnostics: string[] = []
  if (candidate.version !== VERIFICATION_CONFIG_VERSION) {
    diagnostics.push(`version: must be ${VERIFICATION_CONFIG_VERSION}`)
  }
  const seen = new Map<string, number>()
  for (const [index, check] of candidate.checks.entries()) {
    diagnostics.push(...checkDiagnostics(check, index))
    const previous = seen.get(check.id)
    if (previous !== undefined) diagnostics.push(`checks[${index}].id: duplicate of checks[${previous}]`)
    else seen.set(check.id, index)
  }
  if (diagnostics.length > 0) return { status: "invalid", diagnostics }
  if (candidate.checks.length === 0) return { status: "invalid", diagnostics: ["checks: declares no checks"] }

  return {
    status: "configured",
    checks: candidate.checks.map((check) => ({
      checkId: check.id,
      name: check.name,
      // SAFETY: membership in CATEGORIES is established by checkDiagnostics before this runs.
      category: check.category as VerificationConfigCategory,
      command: check.command,
      cwd: check.cwd ?? ".",
      packageScope: check.packageScope ?? "",
      timeoutMs: check.timeoutMs ?? 120_000,
      required: check.required ?? true,
      appliesTo: check.appliesTo ?? [],
      configVersion: VERIFICATION_CONFIG_VERSION,
    })),
  }
}

// Resolution always starts from the caller-supplied project root, never from process.cwd(): an
// assumed cwd would validate one tree and execute against another.
export function loadVerificationConfig(projectRoot: string): ConfigLoad {
  const absoluteRoot = resolve(projectRoot)
  const configPath = join(absoluteRoot, ...VERIFICATION_CONFIG_PATH.split("/"))
  if (!existsSync(configPath)) return { status: "absent" }
  let text: string
  try {
    text = readFileSync(configPath, "utf8")
  } catch {
    return { status: "invalid", diagnostics: ["config: unreadable"] }
  }
  const parsed = parseVerificationConfig(text)
  if (parsed.status !== "configured") return parsed

  const diagnostics: string[] = []
  for (const check of parsed.checks) {
    const target = resolve(absoluteRoot, check.cwd)
    const rel = relative(absoluteRoot, target)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      diagnostics.push(`checks.${check.checkId}.cwd: resolves outside the project root`)
    }
  }
  if (diagnostics.length > 0) return { status: "invalid", diagnostics }
  return parsed
}
