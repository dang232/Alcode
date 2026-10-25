import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseRecordFile } from "../../../../memory-core/src/project-knowledge/record.ts"
import { resolveProjectIdentity } from "../../../../memory-core/src/project-knowledge/identity.ts"
import type { DagVerificationRecord } from "../verification"
import {
  deriveAcceptedKnowledgeCandidate,
  recordAcceptedRunKnowledge,
  type AcceptedRunKnowledgeInput,
} from "./knowledge-lifecycle"

const AT = "2026-10-24T00:00:00.000Z"

function makeRepo(): { directory: string; revision: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "pk-lifecycle-repo-"))
  mkdirSync(join(directory, "src"), { recursive: true })
  writeFileSync(join(directory, "src", "math.ts"), "export function add(a: number, b: number) { return a + b }\n")
  execFileSync("git", ["init", "-q", directory])
  execFileSync("git", ["-C", directory, "add", "-A"])
  execFileSync("git", ["-C", directory, "-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "-m", "init"])
  const revision = execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  return { directory, revision, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}

const repo = makeRepo()
const REV = repo.revision

function record(overrides: Partial<DagVerificationRecord> = {}): DagVerificationRecord {
  return {
    schemaVersion: 1,
    runId: "dag_run-1",
    parentSessionId: "ses-parent",
    rootSessionId: "ses-root",
    nodeId: "node-a",
    workerAttempt: 2,
    checkId: "dag-node-check",
    category: "test",
    criteria: ["suite passes"],
    command: ["bun", "test"],
    cwd: ".",
    projectDir: ".",
    timeoutMs: 1000,
    sourceRevision: REV,
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

function input(overrides: Partial<AcceptedRunKnowledgeInput> = {}): AcceptedRunKnowledgeInput {
  return {
    runId: "dag_run-1",
    generation: 1,
    revision: REV,
    accepted: true,
    at: AT,
    checks: [{ nodeId: "node-a", checkId: "dag-node-check" }],
    records: [record()],
    nodeAttempts: new Map([["node-a", 2]]),
    nodeScopes: new Map([["node-a", ["src/math.ts"]]]),
    nodeFingerprints: new Map([["node-a", "fp-1"]]),
    directory: repo.directory,
    env: {},
    ...overrides,
  }
}

describe("deriveAcceptedKnowledgeCandidate", () => {
  test("#given an accepted run whose check passed after a retry #when derived #then a source-linked candidate results", () => {
    const derived = deriveAcceptedKnowledgeCandidate(input())

    expect(derived).toBeDefined()
    expect(derived?.sourceFile).toBe("src/math.ts")
    expect(derived?.candidate.sourceRevision).toBe(REV)
    expect(derived?.candidate.claim).toContain("failed on an earlier attempt")
    expect(derived?.candidate.claim).toContain("src/math.ts")
  })

  test("#given a first-attempt pass #when derived #then nothing is produced", () => {
    const derived = deriveAcceptedKnowledgeCandidate(
      input({ nodeAttempts: new Map([["node-a", 1]]), records: [record({ workerAttempt: 1, repairAttempt: 0 })] }),
    )

    expect(derived).toBeUndefined()
  })

  test("#given a rejected run #when derived #then nothing is produced", () => {
    expect(deriveAcceptedKnowledgeCandidate(input({ accepted: false }))).toBeUndefined()
  })

  test("#given a failed check on a retried node #when derived #then nothing is produced", () => {
    const derived = deriveAcceptedKnowledgeCandidate(input({ records: [record({ status: "failed", exitCode: 1 })] }))

    expect(derived).toBeUndefined()
  })

  test("#given a check recorded at an older revision #when derived #then the run-identity gate still admits it only for this run and generation", () => {
    const derived = deriveAcceptedKnowledgeCandidate(input({ records: [record({ sourceRevision: "c".repeat(40) })] }))

    expect(derived).toBeDefined()
  })

  test("#given a passing check from another run #when derived #then nothing is produced", () => {
    const derived = deriveAcceptedKnowledgeCandidate(input({ records: [record({ runId: "dag_run-other" })] }))

    expect(derived).toBeUndefined()
  })

  test("#given a passing check from another generation #when derived #then nothing is produced", () => {
    const derived = deriveAcceptedKnowledgeCandidate(input({ records: [record({ generation: 7 })] }))

    expect(derived).toBeUndefined()
  })

  test("#given a check whose node fingerprint moved #when derived #then nothing is produced", () => {
    const derived = deriveAcceptedKnowledgeCandidate(input({ records: [record({ nodeFingerprint: "fp-moved" })] }))

    expect(derived).toBeUndefined()
  })

  test("#given a node that declares no write scope but a check that covers a file #when derived #then the covered file is the claim source", () => {
    const derived = deriveAcceptedKnowledgeCandidate(
      input({
        nodeScopes: new Map([["node-a", []]]),
        records: [record({ coveredPaths: ["src/math.ts"] })],
      }),
    )

    expect(derived?.sourceFile).toBe("src/math.ts")
  })
})

describe("recordAcceptedRunKnowledge", () => {
  test("#given a verified finding and an isolated store #when recorded #then one promotable record lands on disk", () => {
    const home = mkdtempSync(join(tmpdir(), "pk-lifecycle-"))
    try {
      const result = recordAcceptedRunKnowledge(input({ env: { OMO_PROJECT_KNOWLEDGE_HOME: home } }))

      expect(result.status).toBe("persisted")
      const files = readdirSync(home).filter((name) => name.endsWith(".md"))
      expect(files).toHaveLength(1)
      const parsed = parseRecordFile(`project-knowledge/${files[0]}`, readFileSync(join(home, files[0] as string), "utf8"))
      expect(parsed.kind).toBe("record")
      if (parsed.kind !== "record") return
      expect(parsed.record.category).toBe("source-verified")
      expect(parsed.record.sourceRevision).toBe(REV)
      expect(parsed.record.projectId).toBe(resolveProjectIdentity(repo.directory, {}).projectId)
      expect(parsed.record.sourceFile).toBe("src/math.ts")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("#given the same accepted run twice #when recorded #then the second call is a duplicate and writes nothing new", () => {
    const home = mkdtempSync(join(tmpdir(), "pk-lifecycle-dup-"))
    try {
      const env = { OMO_PROJECT_KNOWLEDGE_HOME: home }
      const first = recordAcceptedRunKnowledge(input({ env }))
      const second = recordAcceptedRunKnowledge(input({ env }))

      expect(first.status).toBe("persisted")
      expect(second.status).toBe("duplicate")
      expect(readdirSync(home).filter((name) => name.endsWith(".md"))).toHaveLength(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("#given an unverifiable finding #when recorded #then it is rejected and nothing is written", () => {
    const home = mkdtempSync(join(tmpdir(), "pk-lifecycle-reject-"))
    try {
      const result = recordAcceptedRunKnowledge(
        input({ env: { OMO_PROJECT_KNOWLEDGE_HOME: home }, nodeAttempts: new Map([["node-a", 1]]) }),
      )

      expect(result.status).toBe("rejected")
      expect(result.status === "rejected" && result.reason).toBe("no-verified-finding")
      expect(existsSync(home) ? readdirSync(home).length : 0).toBe(0)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("#given an unusable store #when recorded #then the result is unavailable and no success is claimed", () => {
    const base = mkdtempSync(join(tmpdir(), "pk-lifecycle-bad-"))
    try {
      const blocked = join(base, "file")
      require("node:fs").writeFileSync(blocked, "x")
      const result = recordAcceptedRunKnowledge(input({ env: { OMO_PROJECT_KNOWLEDGE_HOME: join(blocked, "store") } }))

      expect(result.status).toBe("unavailable")
      expect(result.status === "unavailable" && result.reason.startsWith("store-unwritable")).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
