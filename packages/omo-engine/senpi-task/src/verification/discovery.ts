// Package-manifest discovery: it proposes, it never authorizes and never runs.
//
// Every candidate leaves here with `source: "manifest"` and a fingerprint that no approval record
// matches yet, so the classification step sees "discovered, unapproved" - which is the whole point.
// Nothing in this module spawns a process: reading a manifest and running it are different acts and
// only the host approval path may join them.
//
// Only the four script names this module understands are decoded, so a manifest is parsed into a
// fixed shape rather than an open dictionary, and an unexpected script key is simply not a candidate.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { Type, type Static } from "typebox"
import { Value } from "typebox/value"
import { approvalFingerprint, type OrdinaryCheckCandidate } from "./approval"
import { VERIFICATION_CONFIG_VERSION } from "./config"

const ScriptsSchema = Type.Object(
  {
    test: Type.Optional(Type.String()),
    typecheck: Type.Optional(Type.String()),
    lint: Type.Optional(Type.String()),
    build: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

const WorkspacesSchema = Type.Union([
  Type.Array(Type.String()),
  Type.Object({ packages: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: true }),
])

const ManifestSchema = Type.Object(
  {
    name: Type.Optional(Type.String()),
    scripts: Type.Optional(ScriptsSchema),
    workspaces: Type.Optional(WorkspacesSchema),
  },
  { additionalProperties: true },
)

type RawManifest = Static<typeof ManifestSchema>

type DeclaredScripts = Static<typeof ScriptsSchema>

const CANDIDATE_TIMEOUT_MS = 300_000

export type DiscoveryResult =
  | { readonly status: "candidates"; readonly candidates: readonly OrdinaryCheckCandidate[] }
  | { readonly status: "none"; readonly reason: string }
  | { readonly status: "unsupported"; readonly reason: string }

type Manifest = {
  readonly dir: string
  readonly scope: string
  readonly scripts: DeclaredScripts
  readonly workspaces: readonly string[]
}

function decodeManifest(projectRoot: string, dir: string): Manifest | null {
  const manifestPath = join(projectRoot, dir, "package.json")
  if (!existsSync(manifestPath)) return null
  let candidate: RawManifest
  try {
    // SAFETY: the assertion is the input to Value.Check below, which establishes the shape before
    // any field is read. An unparseable or mis-typed manifest yields no candidates, never a guess.
    candidate = JSON.parse(readFileSync(manifestPath, "utf8")) as RawManifest
  } catch {
    return null
  }
  if (!Value.Check(ManifestSchema, candidate)) return null
  const name = candidate.name ?? ""
  const scope = name !== "" ? name : dir === "." ? "workspace-root" : ""
  const declared = candidate.workspaces
  const workspaces = Array.isArray(declared) ? declared : (declared?.packages ?? [])
  return { dir, scope, scripts: candidate.scripts ?? {}, workspaces }
}

// Workspace globs are read from the root manifest and applied with one directory level of `*`,
// which is what the Bun/npm workspaces in this repository actually use. Deeper globs are ignored
// rather than guessed at: an unsupported layout must surface as "no candidates", not as a silent
// scan of unrelated directories.
function workspaceDirs(projectRoot: string, rootManifest: Manifest): string[] {
  const dirs: string[] = []
  for (const glob of rootManifest.workspaces) {
    if (!glob.endsWith("/*")) continue
    const parent = glob.slice(0, -2)
    const parentPath = join(projectRoot, parent)
    if (!existsSync(parentPath) || !statSync(parentPath).isDirectory()) continue
    for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidateDir = `${parent}/${entry.name}`
      if (existsSync(join(projectRoot, candidateDir, "package.json"))) dirs.push(candidateDir)
    }
  }
  return dirs
}

function relevant(dir: string, changedFiles: readonly string[] | null): boolean {
  if (changedFiles === null) return true
  if (dir === ".") return true
  return changedFiles.some((file) => file === dir || file.startsWith(`${dir}/`))
}

function declaredScripts(manifest: Manifest): ReadonlyArray<readonly [script: string, category: string, value: string | undefined]> {
  return [
    ["test", "unit", manifest.scripts.test],
    ["typecheck", "typecheck", manifest.scripts.typecheck],
    ["lint", "lint", manifest.scripts.lint],
    ["build", "build", manifest.scripts.build],
  ]
}

export function discoverCandidates(input: {
  readonly projectRoot: string
  readonly workspaceId: string
  readonly changedFiles: readonly string[] | null
}): DiscoveryResult {
  const projectRoot = resolve(input.projectRoot)
  if (!existsSync(join(projectRoot, "package.json"))) {
    return { status: "unsupported", reason: "no package manifest at the project root" }
  }
  const rootManifest = decodeManifest(projectRoot, ".")
  if (rootManifest === null) return { status: "unsupported", reason: "the root package manifest is unreadable" }

  const manifests = [rootManifest, ...workspaceDirs(projectRoot, rootManifest).map((dir) => decodeManifest(projectRoot, dir))]
  const candidates: OrdinaryCheckCandidate[] = []

  for (const manifest of manifests) {
    if (manifest === null) continue
    if (!relevant(manifest.dir, input.changedFiles)) continue
    for (const [script, category, declared] of declaredScripts(manifest)) {
      if (declared === undefined || declared.trim() === "") continue
      const command = ["bun", "run", script]
      const cwd = manifest.dir
      const checkId = `${category}:${manifest.dir === "." ? "root" : manifest.dir.replace(/^packages\//, "")}`
      const timeoutMs = CANDIDATE_TIMEOUT_MS
      candidates.push({
        checkId,
        category,
        command,
        cwd,
        packageScope: manifest.scope,
        timeoutMs,
        reason: `${manifest.dir === "." ? "root manifest" : manifest.dir} declares a "${script}" script`,
        source: "manifest",
        location: `${manifest.dir === "." ? "" : `${manifest.dir}/`}package.json#scripts.${script}`,
        fingerprint: approvalFingerprint({
          workspaceId: input.workspaceId,
          checkId,
          command,
          cwd,
          packageScope: manifest.scope,
          timeoutMs,
          configVersion: VERIFICATION_CONFIG_VERSION,
        }),
      })
    }
  }

  if (candidates.length === 0) {
    return { status: "none", reason: "no test, typecheck, lint or build script applies to the changed files" }
  }
  return { status: "candidates", candidates }
}
