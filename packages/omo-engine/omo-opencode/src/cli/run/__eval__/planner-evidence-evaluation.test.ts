import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createRecord } from "../../../../../memory-core/src/project-knowledge/record.ts"
import { buildPlannerEvidence, type PlannerEvidence } from "../plan-evidence.ts"

const FIXTURE_DIR = join(import.meta.dir, "..", "..", "..", "..", "..", "code-graph", "src", "__fixtures__", "graph-basic")
const REVISION = "e".repeat(40)

type MatchedTask = {
  readonly id: string
  readonly message: string
  readonly expectedFiles: readonly string[]
  readonly expectedTests: readonly string[]
  readonly mustNotLeak: readonly string[]
  readonly constraint?: string
  readonly stale?: boolean
}

const TASKS: readonly MatchedTask[] = [
  {
    id: "caller-bug",
    message: "fix add() in math.ts because run in main.ts returns the wrong sum",
    expectedFiles: ["math.ts", "main.ts"],
    expectedTests: ["main.test.ts"],
    mustNotLeak: ["module-noise.ts"],
  },
  {
    id: "test-selection",
    message: "change reexport add re-export and update the tests that cover checkMain",
    expectedFiles: ["reexport.ts", "main.test.ts"],
    expectedTests: ["main.test.ts"],
    mustNotLeak: ["module-noise.ts"],
  },
  {
    id: "documented-constraint",
    message: "change add in math.ts keeping the documented contract",
    expectedFiles: ["math.ts"],
    expectedTests: ["main.test.ts"],
    mustNotLeak: ["module-noise.ts"],
    constraint: "add keeps its commutativity contract",
  },
  {
    id: "independent-vs-shared",
    message: "change add in math.ts and run in main.ts",
    expectedFiles: ["math.ts", "main.ts"],
    expectedTests: ["main.test.ts"],
    mustNotLeak: ["module-noise.ts"],
  },
  {
    id: "stale-knowledge",
    message: "change add in math.ts under the old contract",
    expectedFiles: ["math.ts"],
    expectedTests: ["main.test.ts"],
    mustNotLeak: ["module-noise.ts"],
    constraint: "add was verified on an older revision",
    stale: true,
  },
]

type Arm = {
  readonly files: readonly string[]
  readonly tests: readonly string[]
  readonly hasConstraint: boolean
  readonly leaks: readonly string[]
  readonly status: string
  readonly bytes: number
  readonly promptBytes: number
  readonly durationMs: number
}

type Metrics = {
  readonly id: string
  readonly fileRecall: number
  readonly filePrecision: number
  readonly testHit: number
  readonly constraintRespected: boolean
  readonly leakage: number
  readonly bytes: number
}

const roots: string[] = []

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "planner-eval-"))
  roots.push(dir)
  for (const file of readdirSync(FIXTURE_DIR)) copyFileSync(join(FIXTURE_DIR, file), join(dir, file))
  writeFileSync(join(dir, "module-noise.ts"), "export function unrelated(a: number) { return a }\n")
  mkdirSync(join(dir, ".git", "refs", "heads"), { recursive: true })
  writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n")
  writeFileSync(join(dir, ".git", "refs", "heads", "main"), `${REVISION}\n`)
  return dir
}

function knownRecord(claim: string, category: string, revision: string) {
  const created = createRecord({
    projectId: "alcode-1234abcd",
    claim,
    sourceFile: "math.ts",
    sourceSymbol: "fn:add",
    sourceRevision: revision,
    sourceBlobSha256: createHash("sha256").update(claim, "utf8").digest("hex"),
    observedAt: "2026-10-23T00:00:00.000Z",
    validationMethod: "test-pass",
    confidence: 1,
    scope: { writeScopes: ["math.ts"] },
    invalidationConditions: ["SRC-EDIT"],
  })
  if (created.kind !== "created") throw new Error(`record refused: ${created.reason}`)
  // SAFETY: createRecord validates the category grammar; the evaluation names one of its members.
  return { ...created.record, category: category as typeof created.record.category }
}

type ArmPair = { readonly baseline: Arm; readonly informed: Arm }

function arms(task: MatchedTask, directory: string, evidence: PlannerEvidence): ArmPair {
  const baseline: Arm = {
    files: [],
    tests: [],
    hasConstraint: false,
    leaks: [],
    status: "message-only",
    bytes: 0,
    promptBytes: Buffer.byteLength(task.message),
    durationMs: 0,
  }
  const text = evidence.text ?? ""
  const understanding = evidence.understanding
  const files = [...new Set([...(understanding?.symbols ?? []), ...(understanding?.impacted ?? [])].map((item) => item.file))]
  const tests = (understanding?.tests ?? []).map((item) => item.file)
  const informed: Arm = {
    files,
    tests,
    hasConstraint: task.constraint !== undefined && text.includes(task.constraint),
    leaks: files.filter((file) => task.mustNotLeak.includes(file)),
    status: evidence.status,
    bytes: evidence.bytes,
    promptBytes: Buffer.byteLength(task.message) + evidence.bytes,
    durationMs: evidence.diagnostics.durationMs,
  }
  return { baseline, informed }
}

function score(task: MatchedTask, arm: Arm): Metrics {
  const files = new Set(arm.files)
  const hit = task.expectedFiles.filter((file) => files.has(file))
  const recall = task.expectedFiles.length === 0 ? 1 : hit.length / task.expectedFiles.length
  const precision = files.size === 0 ? 0 : hit.length / files.size
  const testHit = task.expectedTests.some((file) => arm.tests.includes(file)) ? 1 : 0
  return {
    id: task.id,
    fileRecall: Number(recall.toFixed(2)),
    filePrecision: Number(precision.toFixed(2)),
    testHit,
    constraintRespected: arm.hasConstraint,
    leakage: arm.leaks.length,
    bytes: arm.bytes,
  }
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
}

describe("planner evidence evaluation", () => {
  test("#given matched repository tasks #when baseline and informed planners are compared #then the metrics are printed", async () => {
    const directory = makeRepo()
    const verified = knownRecord("add keeps its commutativity contract", "source-verified", REVISION)
    const stale = knownRecord("add was verified on an older revision", "source-verified", "f".repeat(40))

    const rows: { task: string; baseline: Metrics; informed: Metrics; status: string; bytes: number; ms: number }[] = []
    for (const task of TASKS) {
      const knowledge = task.stale === true ? [stale] : task.constraint === undefined ? [] : [verified]
      const evidence = await buildPlannerEvidence({ message: task.message, directory, knowledge })
      const { baseline, informed } = arms(task, directory, evidence)
      rows.push({
        task: task.id,
        baseline: score(task, baseline),
        informed: score(task, informed),
        status: informed.status,
        bytes: informed.bytes,
        ms: informed.durationMs,
      })
    }

    const summary = {
      tasks: rows.length,
      baseline: {
        fileRecall: mean(rows.map((row) => row.baseline.fileRecall)),
        filePrecision: mean(rows.map((row) => row.baseline.filePrecision)),
        testHit: mean(rows.map((row) => row.baseline.testHit)),
        constraintRespected: mean(rows.map((row) => (row.baseline.constraintRespected ? 1 : 0))),
        leakage: mean(rows.map((row) => row.baseline.leakage)),
      },
      informed: {
        fileRecall: mean(rows.map((row) => row.informed.fileRecall)),
        filePrecision: mean(rows.map((row) => row.informed.filePrecision)),
        testHit: mean(rows.map((row) => row.informed.testHit)),
        constraintRespected: mean(rows.map((row) => (row.informed.constraintRespected ? 1 : 0))),
        leakage: mean(rows.map((row) => row.informed.leakage)),
      },
      overhead: {
        meanEvidenceBytes: mean(rows.map((row) => row.bytes)),
        maxEvidenceBytes: Math.max(...rows.map((row) => row.bytes)),
        meanBuildMs: mean(rows.map((row) => row.ms)),
      },
      perTask: rows,
    }
    console.log(JSON.stringify(summary, null, 2))

    for (const row of rows) {
      expect(row.informed.fileRecall).toBeGreaterThanOrEqual(row.baseline.fileRecall)
      expect(row.informed.testHit).toBeGreaterThanOrEqual(row.baseline.testHit)
    }
    expect(summary.informed.leakage).toBe(0)
    expect(summary.informed.testHit).toBeGreaterThan(0)
    expect(summary.informed.constraintRespected).toBeGreaterThan(summary.baseline.constraintRespected)
    expect(summary.overhead.maxEvidenceBytes).toBeLessThanOrEqual(4096)
    const staleRow = rows.find((row) => row.task === "stale-knowledge")
    expect(staleRow?.informed.constraintRespected).toBe(false)

    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  }, 120_000)
})
