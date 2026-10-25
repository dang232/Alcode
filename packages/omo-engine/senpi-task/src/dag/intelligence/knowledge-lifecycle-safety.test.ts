// Safety gates for the native knowledge lifecycle (slice 9.7): cross-project isolation through one
// shared store, real cross-process persistence races, source freshness at revision boundaries, and
// linked-worktree identity carried end to end. Every case drives real git repositories, the real
// mapper/promotion/store path, and the real understanding projection - no mocked persistence.
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { parseRecordFile } from "../../../../memory-core/src/project-knowledge/record.ts"
import { resolveProjectIdentity } from "../../../../memory-core/src/project-knowledge/identity.ts"
import { resolveProjectKnowledgeRoot } from "../../../../memory-core/src/project-knowledge/store-home.ts"
import type { DagVerificationRecord } from "../verification"
import { buildTaskUnderstanding } from "./understanding"
import { renderPlanEvidence } from "./plan-evidence"
import {
  recordAcceptedRunKnowledge,
  type AcceptedRunKnowledgeInput,
  type KnowledgeLifecycleResult,
} from "./knowledge-lifecycle"
import type { KnowledgeRecordInput, TaskUnderstanding } from "./types"

setDefaultTimeout(process.platform === "win32" ? 120_000 : 30_000)

const AT = "2026-10-24T00:00:00.000Z"
const CHECK_ID = "dag-node-check"

type Repo = {
  readonly directory: string
  readonly revision: string
  readonly cleanup: () => void
}

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim()
}

function commitAll(directory: string, message: string): string {
  git(directory, "add", "-A")
  execFileSync("git", ["-C", directory, "-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "-m", message])
  return git(directory, "rev-parse", "HEAD")
}

function makeRepo(body = "export function add(a: number, b: number) { return a + b }\n"): Repo {
  const directory = mkdtempSync(join(tmpdir(), "pk-safety-repo-"))
  mkdirSync(join(directory, "src"), { recursive: true })
  writeFileSync(join(directory, "src", "math.ts"), body)
  execFileSync("git", ["init", "-q", directory])
  const revision = commitAll(directory, "init")
  return { directory, revision, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}

function verificationRecord(revision: string, overrides: Partial<DagVerificationRecord> = {}): DagVerificationRecord {
  return {
    schemaVersion: 1,
    runId: "dag_run-safety",
    parentSessionId: "ses-parent",
    rootSessionId: "ses-root",
    nodeId: "node-a",
    workerAttempt: 2,
    checkId: CHECK_ID,
    category: "test",
    criteria: ["suite passes"],
    command: ["bun", "test"],
    cwd: ".",
    projectDir: ".",
    timeoutMs: 1000,
    sourceRevision: revision,
    nodeFingerprint: "fp-1",
    generation: 1,
    repairAttempt: 1,
    startedAt: AT,
    completedAt: AT,
    durationMs: 1,
    started: true,
    exitCode: 0,
    status: "passed",
    ...overrides,
  } as DagVerificationRecord
}

function lifecycleInput(repo: Repo, overrides: Partial<AcceptedRunKnowledgeInput> = {}): AcceptedRunKnowledgeInput {
  return {
    runId: "dag_run-safety",
    generation: 1,
    revision: repo.revision,
    accepted: true,
    at: AT,
    checks: [{ nodeId: "node-a", checkId: CHECK_ID }],
    records: [verificationRecord(repo.revision)],
    nodeAttempts: new Map([["node-a", 2]]),
    nodeScopes: new Map([["node-a", ["src/math.ts"]]]),
    nodeFingerprints: new Map([["node-a", "fp-1"]]),
    directory: repo.directory,
    env: {},
    ...overrides,
  }
}

function storeRoot(): string {
  return mkdtempSync(join(tmpdir(), "pk-safety-store-"))
}

function recordFiles(root: string): string[] {
  return readdirSync(root).filter((name) => name.endsWith(".md"))
}

// The assertion this helper makes is the isolation guarantee itself: whatever root a test hands the
// lifecycle, it can never be the user's real home store, and it never falls back when absent.
function assertIsolatedRoot(root: string): void {
  const real = resolveProjectKnowledgeRoot({}, process.cwd())
  const resolved = resolveProjectKnowledgeRoot({ OMO_PROJECT_KNOWLEDGE_HOME: root }, process.cwd())
  expect(resolved).not.toBe(real)
  expect(resolved).toBe(root)
}

function loadKnowledge(root: string): KnowledgeRecordInput[] {
  return recordFiles(root).flatMap((name) => {
    const parsed = parseRecordFile(`project-knowledge/${name}`, readFileSync(join(root, name), "utf8"))
    if (parsed.kind !== "record") return []
    return [
      {
        id: parsed.record.id,
        claim: parsed.record.claim,
        category: parsed.record.category,
        sourceFile: parsed.record.sourceFile,
        sourceRevision: parsed.record.sourceRevision,
        validatedAt: parsed.record.validatedAt,
        projectId: parsed.record.projectId,
        fingerprint: parsed.record.fingerprint,
      },
    ]
  })
}

function understand(directory: string, revision: string, knowledge: readonly KnowledgeRecordInput[]): TaskUnderstanding {
  const projectId = resolveProjectIdentity(directory, {}).projectId
  return buildTaskUnderstanding({
    scope: { projectId, worktreeId: "wt-main", revision, fingerprint: "fp-scope" },
    knowledge,
  })
}

describe("knowledge lifecycle safety", () => {
  describe("cross-project isolation through one shared store", () => {
    test("#given two projects sharing one store root #when both record concurrently #then each keeps its own record and retrieves only its own claim", () => {
      const alpha = makeRepo("export function alpha() { return 'a' }\n")
      const beta = makeRepo("export function beta() { return 'b' }\n")
      const root = storeRoot()
      try {
        assertIsolatedRoot(root)
        const results = [alpha, beta].map((repo) =>
          recordAcceptedRunKnowledge(lifecycleInput(repo, { env: { OMO_PROJECT_KNOWLEDGE_HOME: root } })),
        )

        expect(results.map((result) => result.status)).toEqual(["persisted", "persisted"])
        const files = recordFiles(root)
        expect(files).toHaveLength(2)

        const knowledge = loadKnowledge(root)
        const alphaRecord = knowledge.find((record) => record.projectId === resolveProjectIdentity(alpha.directory, {}).projectId)
        const betaRecord = knowledge.find((record) => record.projectId === resolveProjectIdentity(beta.directory, {}).projectId)
        expect(alphaRecord).toBeDefined()
        expect(betaRecord).toBeDefined()
        expect(alphaRecord?.id).not.toBe(betaRecord?.id)

        const alphaView = understand(alpha.directory, alpha.revision, knowledge)
        const betaView = understand(beta.directory, beta.revision, knowledge)
        expect(alphaView.constraints.map((constraint) => constraint.id)).toEqual([alphaRecord?.id as string])
        expect(betaView.constraints.map((constraint) => constraint.id)).toEqual([betaRecord?.id as string])
        expect(alphaView.constraints[0]?.claim).not.toBe(betaView.constraints[0]?.claim)
        const constraintRows = (block: string) => block.match(/- \[pk-[0-9a-f]{12}\]/g) ?? []
        expect(constraintRows(renderPlanEvidence(alphaView))).toEqual([`- [${alphaRecord?.id as string}]`])
        expect(constraintRows(renderPlanEvidence(betaView))).toEqual([`- [${betaRecord?.id as string}]`])
      } finally {
        rmSync(root, { recursive: true, force: true })
        alpha.cleanup()
        beta.cleanup()
      }
    })

    test("#given a store already holding another project's record #when a foreign project records #then it adds its own file and never rewrites the foreign one", () => {
      const alpha = makeRepo()
      const beta = makeRepo("export function beta() { return 'b' }\n")
      const root = storeRoot()
      try {
        const first = recordAcceptedRunKnowledge(lifecycleInput(alpha, { env: { OMO_PROJECT_KNOWLEDGE_HOME: root } }))
        expect(first.status).toBe("persisted")
        const before = recordFiles(root).map((name) => ({ name, body: readFileSync(join(root, name), "utf8") }))

        const second = recordAcceptedRunKnowledge(lifecycleInput(beta, { env: { OMO_PROJECT_KNOWLEDGE_HOME: root } }))
        expect(second.status).toBe("persisted")

        const after = new Map(recordFiles(root).map((name) => [name, readFileSync(join(root, name), "utf8")]))
        expect(after.size).toBe(2)
        for (const entry of before) expect(after.get(entry.name)).toBe(entry.body)
      } finally {
        rmSync(root, { recursive: true, force: true })
        alpha.cleanup()
        beta.cleanup()
      }
    })
  })

  describe("same-task concurrent completion", () => {
    const childScript = `
const { recordAcceptedRunKnowledge } = await import(process.argv[2])
const raw = JSON.parse(process.argv[3])
const input = {
  ...raw,
  nodeAttempts: new Map(raw.nodeAttempts),
  nodeScopes: new Map(raw.nodeScopes),
  nodeFingerprints: new Map(raw.nodeFingerprints),
}
const result = recordAcceptedRunKnowledge(input)
console.log(JSON.stringify(result))
`

    test("#given four processes completing the same accepted task at once #when each persists #then exactly one well-formed record and no staging leftovers remain", async () => {
      const repo = makeRepo()
      const root = storeRoot()
      const work = mkdtempSync(join(tmpdir(), "pk-safety-race-"))
      try {
        assertIsolatedRoot(root)
        const script = join(work, "race.ts")
        writeFileSync(script, childScript)
        const payload = JSON.stringify({
          ...lifecycleInput(repo),
          env: undefined,
          nodeAttempts: [["node-a", 2]],
          nodeScopes: [["node-a", ["src/math.ts"]]],
          nodeFingerprints: [["node-a", "fp-1"]],
        })
        const moduleUrl = pathToFileURL(join(import.meta.dir, "knowledge-lifecycle.ts")).href

        const children = Array.from({ length: 4 }, () =>
          Bun.spawn(["bun", "run", script, moduleUrl, payload], {
            env: { ...process.env, OMO_PROJECT_KNOWLEDGE_HOME: root },
            stdout: "pipe",
            stderr: "pipe",
          }),
        )
        const exits = await Promise.all(children.map((child) => child.exited))
        expect(exits).toEqual([0, 0, 0, 0])
        const outputs = await Promise.all(
          children.map(async (child) => JSON.parse((await new Response(child.stdout).text()).trim()) as KnowledgeLifecycleResult),
        )
        for (const output of outputs) expect(["persisted", "duplicate"]).toContain(output.status)
        expect(outputs.filter((output) => output.status === "persisted").length).toBeGreaterThanOrEqual(1)

        const files = recordFiles(root)
        expect(files).toHaveLength(1)
        const leftovers = readdirSync(root).filter((name) => name.includes(".tmp-"))
        expect(leftovers).toEqual([])
        const parsed = parseRecordFile(`project-knowledge/${files[0]}`, readFileSync(join(root, files[0] as string), "utf8"))
        expect(parsed.kind).toBe("record")
        if (parsed.kind !== "record") return
        expect(parsed.record.category).toBe("source-verified")
        expect(parsed.record.scope.writeScopes).toEqual(["src/math.ts"])
      } finally {
        rmSync(work, { recursive: true, force: true })
        rmSync(root, { recursive: true, force: true })
        repo.cleanup()
      }
    })

    test("#given a record already persisted #when the same completion callback repeats #then nothing is rewritten and the file bytes are unchanged", () => {
      const repo = makeRepo()
      const root = storeRoot()
      try {
        const env = { OMO_PROJECT_KNOWLEDGE_HOME: root }
        const first = recordAcceptedRunKnowledge(lifecycleInput(repo, { env }))
        expect(first.status).toBe("persisted")
        const files = recordFiles(root)
        const before = readFileSync(join(root, files[0] as string), "utf8")

        const second = recordAcceptedRunKnowledge(lifecycleInput(repo, { env }))
        expect(second.status).toBe("duplicate")
        expect(recordFiles(root)).toEqual(files)
        expect(readFileSync(join(root, files[0] as string), "utf8")).toBe(before)
      } finally {
        rmSync(root, { recursive: true, force: true })
        repo.cleanup()
      }
    })
  })

  describe("source freshness at revision boundaries", () => {
    test("#given a record at revision R #when the source is edited and committed #then the record is no longer authoritative and never renders as a constraint", () => {
      const repo = makeRepo()
      const root = storeRoot()
      try {
        expect(recordAcceptedRunKnowledge(lifecycleInput(repo, { env: { OMO_PROJECT_KNOWLEDGE_HOME: root } })).status).toBe("persisted")
        const knowledge = loadKnowledge(root)
        const record = knowledge[0]
        expect(record?.sourceRevision).toBe(repo.revision)

        writeFileSync(join(repo.directory, "src", "math.ts"), "export function add(a: number, b: number) { return a + b + 0 }\n")
        const edited = commitAll(repo.directory, "edit source")

        const view = understand(repo.directory, edited, knowledge)
        expect(view.constraints).toHaveLength(1)
        expect(view.constraints[0]?.authoritative).toBe(false)
        const rendered = renderPlanEvidence(view)
        expect(rendered).not.toContain(record?.id as string)
        expect(rendered).not.toContain("authoritative constraints:")
      } finally {
        rmSync(root, { recursive: true, force: true })
        repo.cleanup()
      }
    })

    test("#given the source file is deleted and committed #when a new acceptance cites it #then persistence is rejected and no record is written", () => {
      const repo = makeRepo()
      const root = storeRoot()
      try {
        git(repo.directory, "rm", "-q", "src/math.ts")
        const deleted = commitAll(repo.directory, "delete source")
        const gone: Repo = { directory: repo.directory, revision: deleted, cleanup: () => undefined }

        const result = recordAcceptedRunKnowledge(lifecycleInput(gone, { env: { OMO_PROJECT_KNOWLEDGE_HOME: root } }))
        expect(result.status).toBe("rejected")
        if (result.status === "rejected") expect(result.reason).toBe("source-unreadable-at-revision")
        expect(recordFiles(root)).toEqual([])
      } finally {
        rmSync(root, { recursive: true, force: true })
        repo.cleanup()
      }
    })

    test("#given the source file is renamed and committed #when a new acceptance still cites the old path #then persistence is rejected", () => {
      const repo = makeRepo()
      const root = storeRoot()
      try {
        git(repo.directory, "mv", "src/math.ts", "src/arithmetic.ts")
        const renamed = commitAll(repo.directory, "rename source")
        const moved: Repo = { directory: repo.directory, revision: renamed, cleanup: () => undefined }

        const result = recordAcceptedRunKnowledge(lifecycleInput(moved, { env: { OMO_PROJECT_KNOWLEDGE_HOME: root } }))
        expect(result.status).toBe("rejected")
        if (result.status === "rejected") expect(result.reason).toBe("source-unreadable-at-revision")
        expect(recordFiles(root)).toEqual([])
      } finally {
        rmSync(root, { recursive: true, force: true })
        repo.cleanup()
      }
    })

    test("#given an earlier claim and a later verified replacement at a newer revision #when both are retrieved #then only the newer one is authoritative", () => {
      const repo = makeRepo()
      const root = storeRoot()
      try {
        const env = { OMO_PROJECT_KNOWLEDGE_HOME: root }
        expect(recordAcceptedRunKnowledge(lifecycleInput(repo, { env })).status).toBe("persisted")

        writeFileSync(join(repo.directory, "src", "math.ts"), "export function add(a: number, b: number) { return a + b }\nexport const done = true\n")
        const newer = commitAll(repo.directory, "second verified state")
        const replacement: Repo = { directory: repo.directory, revision: newer, cleanup: () => undefined }
        expect(recordAcceptedRunKnowledge(lifecycleInput(replacement, { env })).status).toBe("persisted")

        const knowledge = loadKnowledge(root)
        expect(knowledge).toHaveLength(2)
        const view = understand(repo.directory, newer, knowledge)
        const authoritative = view.constraints.filter((constraint) => constraint.authoritative)
        expect(authoritative).toHaveLength(1)
        expect(authoritative[0]?.sourceRevision).toBe(newer)
        const rendered = renderPlanEvidence(view)
        const stale = knowledge.find((record) => record.sourceRevision !== newer)
        expect(rendered).not.toContain(stale?.id as string)
        expect(rendered).toContain(authoritative[0]?.id as string)
      } finally {
        rmSync(root, { recursive: true, force: true })
        repo.cleanup()
      }
    })
  })

  describe("linked worktrees", () => {
    test("#given a linked worktree of the same repository #when it retrieves #then it shares the identity and the record stays authoritative at the same revision", () => {
      const repo = makeRepo()
      const root = storeRoot()
      const worktree = join(mkdtempSync(join(tmpdir(), "pk-safety-wt-")), "linked")
      try {
        expect(recordAcceptedRunKnowledge(lifecycleInput(repo, { env: { OMO_PROJECT_KNOWLEDGE_HOME: root } })).status).toBe("persisted")
        git(repo.directory, "worktree", "add", "-q", worktree, "HEAD")

        const mainId = resolveProjectIdentity(repo.directory, {}).projectId
        const linkedId = resolveProjectIdentity(worktree, {}).projectId
        expect(linkedId).toBe(mainId)

        const knowledge = loadKnowledge(root)
        const linkedRevision = git(worktree, "rev-parse", "HEAD")
        expect(linkedRevision).toBe(repo.revision)
        const linkedView = understand(worktree, linkedRevision, knowledge)
        expect(linkedView.scope?.projectId ?? mainId).toBe(mainId)
        expect(linkedView.constraints.filter((constraint) => constraint.authoritative)).toHaveLength(1)
      } finally {
        try {
          git(repo.directory, "worktree", "remove", "--force", worktree)
        } catch {
          // The temp parent is removed below; a failed removal must not mask the assertions.
        }
        rmSync(root, { recursive: true, force: true })
        rmSync(join(worktree, ".."), { recursive: true, force: true })
        repo.cleanup()
      }
    })

    test("#given an unrelated repository #when it resolves identity #then it differs from the shared worktree identity and sees no record", () => {
      const repo = makeRepo()
      const stranger = makeRepo("export function stranger() { return 1 }\n")
      const root = storeRoot()
      try {
        expect(recordAcceptedRunKnowledge(lifecycleInput(repo, { env: { OMO_PROJECT_KNOWLEDGE_HOME: root } })).status).toBe("persisted")
        const record = loadKnowledge(root)[0]

        const divergent = resolveProjectIdentity(stranger.directory, {}).projectId
        expect(divergent).not.toBe(resolveProjectIdentity(repo.directory, {}).projectId)
        const strangerView = understand(stranger.directory, stranger.revision, loadKnowledge(root))
        expect(strangerView.constraints).toEqual([])
        const strangerBlock = renderPlanEvidence(strangerView)
        expect(strangerBlock).not.toContain("authoritative constraints:")
        expect(strangerBlock).toContain("excluded: project scope mismatch")
        expect(strangerBlock).not.toContain(`- [${record?.id as string}]`)
      } finally {
        rmSync(root, { recursive: true, force: true })
        repo.cleanup()
        stranger.cleanup()
      }
    })
  })

  describe("store boundary", () => {
    test("#given no override #when a test-owned operation would resolve the store #then it resolves the documented home default, never the test tree", () => {
      const resolved = resolveProjectKnowledgeRoot({}, process.cwd())
      expect(resolved).toBe(join(homedir(), ".omo", "project-knowledge"))
      expect(resolved).not.toBe(process.cwd())
      expect(existsSync(resolved)).toBe(false)
    })

    test("#given a store root that cannot be created #when the lifecycle records #then it reports unavailable and writes nothing anywhere else", () => {
      const repo = makeRepo()
      const blockedParent = mkdtempSync(join(tmpdir(), "pk-safety-blocked-"))
      const blocker = join(blockedParent, "blocker")
      writeFileSync(blocker, "not a directory")
      try {
        const result = recordAcceptedRunKnowledge(
          lifecycleInput(repo, { env: { OMO_PROJECT_KNOWLEDGE_HOME: join(blocker, "nested") } }),
        )
        expect(result.status).toBe("unavailable")
        if (result.status === "unavailable") expect(result.reason).toContain("store-unwritable")
        expect(existsSync(join(blocker, "nested"))).toBe(false)
      } finally {
        rmSync(blockedParent, { recursive: true, force: true })
        repo.cleanup()
      }
    })

    test("#given an explicit override #when resolving #then the resolved root is exactly that directory", () => {
      const root = storeRoot()
      try {
        assertIsolatedRoot(root)
        expect(resolveProjectKnowledgeRoot({ OMO_PROJECT_KNOWLEDGE_HOME: root }, process.cwd())).toBe(root)
        expect(existsSync(root)).toBe(true)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  })
})
