import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { compileDag } from "../../../../senpi-task/src/dag/graph.ts"
import { applyPlanHints } from "../../../../senpi-task/src/dag/intelligence/plan-evidence.ts"
import type { DagDefinition } from "../../../../senpi-task/src/dag/graph.ts"
import {
  createRecord,
  renderRecordFile,
} from "../../../../memory-core/src/project-knowledge/record.ts"
import {
  PLAN_EVIDENCE_MAX_BYTES,
  buildPlannerEvidence,
  buildPromptInput,
  collectSourceFiles,
  composeRunPrompt,
  extractTaskKeywords,
  isPlanEvidenceEnabled,
  loadKnowledgeRecords,
  preparePlannerTurn,
  readWorktreeRevision,
  resolveKnowledgeRoot,
} from "./plan-evidence"

const FIXTURE_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "code-graph",
  "src",
  "__fixtures__",
  "graph-basic",
)
const REVISION = "b".repeat(40)
const TASK_MESSAGE = "fix add() in math.ts so the reexport path returns the sum"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeRepo(options: { readonly revision?: boolean; readonly files?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "planner-evidence-"))
  roots.push(dir)
  if (options.files !== false) {
    for (const file of readdirSync(FIXTURE_DIR)) {
      copyFileSync(join(FIXTURE_DIR, file), join(dir, file))
    }
  }
  if (options.revision !== false) {
    mkdirSync(join(dir, ".git", "refs", "heads"), { recursive: true })
    writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n")
    writeFileSync(join(dir, ".git", "refs", "heads", "main"), `${REVISION}\n`)
  }
  return dir
}

function knowledgeRecord(
  claim: string,
  category: string,
  projectId: string,
  sourceRevision = REVISION,
) {
  const blob = createHash("sha256").update(claim, "utf8").digest("hex")
  const created = createRecord({
    projectId,
    claim,
    sourceFile: "math.ts",
    sourceSymbol: "fn:add",
    sourceRevision,
    sourceBlobSha256: blob,
    observedAt: "2026-10-23T00:00:00.000Z",
    validationMethod: "test-pass",
    confidence: 1,
    scope: { writeScopes: ["math.ts"] },
    invalidationConditions: ["SRC-EDIT"],
  })
  if (created.kind !== "created") throw new Error(`record refused: ${created.reason}`)
  // SAFETY: createRecord validates the category grammar; the fixture names one of its members.
  return { ...created.record, category: category as typeof created.record.category }
}

function definition(): DagDefinition {
  return {
    key: "run-9-1",
    name: "slice-9-1",
    nodes: [
      { id: "math", prompt: "change add()", category: "quick", writeScopes: ["math.ts"] },
      { id: "tests", prompt: "update tests", category: "quick", writeScopes: ["main.test.ts"], dependsOn: ["math"] },
    ],
  }
}

describe("planner evidence producer", () => {
  test("#given a real worktree and task #when built #then the block carries graph evidence and stays bounded", async () => {
    const dir = makeRepo()
    const evidence = await buildPlannerEvidence({ message: TASK_MESSAGE, directory: dir })

    expect(evidence.status).toBe("available")
    expect(evidence.text).toBeDefined()
    expect(evidence.text).toContain("<plan-evidence")
    expect(evidence.text).toContain("math.ts")
    expect(evidence.text).toContain("main.test.ts")
    expect(evidence.bytes).toBeLessThanOrEqual(PLAN_EVIDENCE_MAX_BYTES)
    expect(evidence.diagnostics.subjects.length).toBeGreaterThan(0)
    expect(evidence.diagnostics.files).toBe(4)
    expect(evidence.understanding?.scope?.revision).toBe(REVISION)
  })

  test("#given the same task in two worktrees #when built #then each block is bound to its own scope and revision", async () => {
    const first = makeRepo()
    const second = makeRepo()
    writeFileSync(join(second, ".git", "refs", "heads", "main"), `${"c".repeat(40)}\n`)

    const left = await buildPlannerEvidence({ message: TASK_MESSAGE, directory: first })
    const right = await buildPlannerEvidence({ message: TASK_MESSAGE, directory: second })

    expect(left.diagnostics.scope?.worktreeId).toBe(first)
    expect(right.diagnostics.scope?.worktreeId).toBe(second)
    expect(left.diagnostics.scope?.revision).toBe(REVISION)
    expect(right.diagnostics.scope?.revision).toBe("c".repeat(40))
    expect(left.diagnostics.scope?.fingerprint).not.toBe(right.diagnostics.scope?.fingerprint)
  })

  test("#given source-verified, hypothesis, superseded and foreign records #when built #then only the verified one is authoritative", async () => {
    const dir = makeRepo()
    const verified = knowledgeRecord("add is associative in math.ts", "source-verified", "alpha-1234abcd")
    const hypothesis = knowledgeRecord("add may be associative elsewhere", "unverified-hypothesis", "alpha-1234abcd")
    const superseded = { ...knowledgeRecord("old add contract", "previously-verified", "alpha-1234abcd"), supersedes: verified.id }
    const foreign = knowledgeRecord("foreign project add rule", "source-verified", "beta-5678ef90")

    const evidence = await buildPlannerEvidence({
      message: TASK_MESSAGE,
      directory: dir,
      projectId: "alpha-1234abcd",
      knowledge: [verified, hypothesis, superseded, foreign],
    })

    expect(evidence.status).toBe("available")
    expect(evidence.text).toContain("add is associative in math.ts")
    expect(evidence.text).not.toContain("add may be associative elsewhere")
    expect(evidence.text).not.toContain("old add contract")
    expect(evidence.text).not.toContain("foreign project add rule")
    const authoritative = evidence.understanding?.constraints.filter((constraint) => constraint.authoritative) ?? []
    expect(authoritative.map((constraint) => constraint.id)).toEqual([verified.id])
    const kinds = (evidence.understanding?.uncertainties ?? []).map((uncertainty) => uncertainty.kind)
    expect(kinds).toContain("cross-project")
  })

  test("#given knowledge at an older revision #when built #then it is not authoritative and the block says so", async () => {
    const dir = makeRepo()
    const staleRecord = knowledgeRecord("add was verified on an older revision", "source-verified", "alpha-1234abcd", "d".repeat(40))

    const evidence = await buildPlannerEvidence({
      message: TASK_MESSAGE,
      directory: dir,
      projectId: "alpha-1234abcd",
      knowledge: [staleRecord],
    })
    const authoritative = evidence.understanding?.constraints.filter((constraint) => constraint.authoritative) ?? []

    expect(evidence.status).toBe("available")
    expect(authoritative).toHaveLength(0)
    expect(evidence.text).not.toContain("add was verified on an older revision")
    const staleConstraint = evidence.understanding?.constraints.find((constraint) => constraint.id === staleRecord.id)
    expect(staleConstraint?.trust).toBe("source-verified")
    expect(staleConstraint?.authoritative).toBe(false)
  })

  test("#given no revision, no files, or no matching symbols #when built #then it reports unavailable with a reason", async () => {
    const noRevision = await buildPlannerEvidence({ message: TASK_MESSAGE, directory: makeRepo({ revision: false }) })
    const noFiles = await buildPlannerEvidence({ message: TASK_MESSAGE, directory: makeRepo({ files: false }) })
    const noMatch = await buildPlannerEvidence({ message: "zebra xylophone quantum", directory: makeRepo() })
    const noKeywords = await buildPlannerEvidence({ message: "the and for", directory: makeRepo() })

    expect(noRevision.status).toBe("unavailable")
    expect(noRevision.diagnostics.reason).toBe("revision-unresolved")
    expect(noFiles.diagnostics.reason).toBe("no-source-files")
    expect(noMatch.status).toBe("unavailable")
    expect(noMatch.text).toBeUndefined()
    expect(noKeywords.diagnostics.reason).toBe("no-task-keywords")
  })

  test("#given a task naming a re-export #when evidence builds #then the re-export file is a subject and the definition's tests are still named", async () => {
    const dir = makeRepo()
    const evidence = await buildPlannerEvidence({
      message: "trace how add is re-exported through reexport.ts and name the tests that must run",
      directory: dir,
    })

    expect(evidence.status).toBe("available")
    expect(evidence.diagnostics.subjects).toContain("file:reexport.ts")
    expect(evidence.text).toContain("reexport.ts")
    expect(evidence.text).toContain("main.test.ts")
  })

  test("#given the composed prompt #when evidence is absent #then it is byte-identical to the original message", async () => {
    const dir = makeRepo()
    const turn = await preparePlannerTurn({ message: TASK_MESSAGE, directory: dir, strategy: "direct" })
    const disabled = await preparePlannerTurn({ message: TASK_MESSAGE, directory: dir, strategy: "plan-then-execute", enabled: false })
    const envOff = await preparePlannerTurn({
      message: TASK_MESSAGE,
      directory: dir,
      strategy: "plan-then-execute",
      env: { OMO_PLAN_EVIDENCE: "0" },
    })
    const plain = buildPromptInput({ sessionID: "ses-1", directory: dir, message: TASK_MESSAGE, agent: "plan" })
    const informed = buildPromptInput({
      sessionID: "ses-1",
      directory: dir,
      message: TASK_MESSAGE,
      agent: "plan",
      evidence: await buildPlannerEvidence({ message: TASK_MESSAGE, directory: dir }),
    })

    expect(turn.skipped).toBe("strategy-direct")
    expect(turn.promptText).toBe(TASK_MESSAGE)
    expect(disabled.skipped).toBe("disabled")
    expect(envOff.skipped).toBe("disabled-env")
    expect(composeRunPrompt(TASK_MESSAGE, undefined)).toBe(TASK_MESSAGE)
    expect(plain.body.parts).toEqual([{ type: "text", text: TASK_MESSAGE }])
    expect(informed.body.parts[0]?.text.startsWith(`${TASK_MESSAGE}\n\n<plan-evidence`)).toBe(true)
    expect(informed.body.agent).toBe("plan")
    expect(informed.body.tools).toEqual({ question: false })
  })

  test("#given a planning strategy and a real repo #when prepared #then the planner text contains the evidence block", async () => {
    const dir = makeRepo()
    const turn = await preparePlannerTurn({ message: TASK_MESSAGE, directory: dir, strategy: "plan-then-execute" })

    expect(turn.skipped).toBeUndefined()
    expect(turn.evidence?.status).toBe("available")
    expect(turn.promptText).toContain("<plan-evidence")
    expect(turn.promptText.startsWith(TASK_MESSAGE)).toBe(true)
    expect(Buffer.byteLength(turn.promptText)).toBeGreaterThan(Buffer.byteLength(TASK_MESSAGE))
  })

  test("#given a graph-informed definition #when hints and validation run #then scopes fill only where empty and dependencies never change", async () => {
    const dir = makeRepo()
    const evidence = await buildPlannerEvidence({ message: TASK_MESSAGE, directory: dir })
    const hints = evidence.hints
    expect(hints).toBeDefined()
    if (hints === undefined) return

    const start: DagDefinition = {
      ...definition(),
      nodes: definition().nodes.map((node) => ({ ...node, writeScopes: undefined })),
    }
    const informed = applyPlanHints(start, {
      writeScopes: new Map([["math", ["math.ts"]], ["tests", ["main.test.ts"]]]),
      risks: [...hints.risks],
    })
    const compiled = compileDag(informed)

    expect(informed.nodes[0]?.writeScopes).toEqual(["math.ts"])
    expect(informed.nodes.map((node) => node.id)).toEqual(["math", "tests"])
    expect(informed.nodes[1]?.dependsOn).toEqual(["math"])
    expect(compiled.errors).toEqual([])
    const broken = compileDag({
      ...informed,
      nodes: informed.nodes.map((node) => (node.id === "math" ? { ...node, dependsOn: ["missing"] } : node)),
    })
    expect(broken.errors.length).toBeGreaterThan(0)
  })

  test("#given many symbols #when rendered #then the evidence block never exceeds the byte cap", async () => {
    const dir = makeRepo()
    for (let index = 0; index < 40; index += 1) {
      writeFileSync(
        join(dir, `module-${index}.ts`),
        `export function add${index}(a: number, b: number) { return a + b }\n`,
      )
    }
    const evidence = await buildPlannerEvidence({
      message: `${TASK_MESSAGE} add0 add1 add2 add3 add4 add5`,
      directory: dir,
      maxBytes: 400,
    })

    expect(evidence.status).toBe("available")
    expect(evidence.bytes).toBeLessThanOrEqual(400)
    expect(evidence.text).toContain("truncated")
  })

  test("#given on-disk project knowledge #when loaded #then records are parsed and dropped files are counted", async () => {
    const dir = makeRepo()
    const record = knowledgeRecord("add keeps its contract in math.ts", "source-verified", "alpha-1234abcd")
    mkdirSync(join(dir, "project-knowledge"), { recursive: true })
    writeFileSync(join(dir, "project-knowledge", `${record.id}.md`), renderRecordFile({ ...record, category: "source-verified" }))
    writeFileSync(join(dir, "project-knowledge", "pk-000000000000.md"), "not a record")

    const loaded = await loadKnowledgeRecords(dir)
    const evidence = await buildPlannerEvidence({ message: TASK_MESSAGE, directory: dir, projectId: "alpha-1234abcd" })

    expect(loaded.records).toHaveLength(1)
    expect(loaded.records[0]?.id).toBe(record.id)
    expect(loaded.dropped).toBe(1)
    expect(evidence.diagnostics.knowledgeRecords).toBe(1)
    expect(evidence.text).toContain("add keeps its contract in math.ts")
  })

  test("#given a knowledge root holding only a foreign record #when built #then it can never re-anchor the project and render itself", async () => {
    const dir = makeRepo()
    const external = mkdtempSync(join(tmpdir(), "planner-foreign-"))
    roots.push(external)
    const claim = "a lone foreign claim must never become authoritative"
    const record = knowledgeRecord(claim, "source-verified", "beta-5678ef90")
    writeFileSync(join(external, `${record.id}.md`), renderRecordFile({ ...record, category: "source-verified" }))

    const explicit = await buildPlannerEvidence({
      message: TASK_MESSAGE,
      directory: dir,
      knowledgeRoot: external,
      projectId: "alpha-1234abcd",
    })
    const trustedDefault = await buildPlannerEvidence({ message: TASK_MESSAGE, directory: dir, knowledgeRoot: external })

    expect(explicit.text ?? "").not.toContain(claim)
    expect(trustedDefault.text ?? "").not.toContain(claim)
    const authoritative = (explicit.understanding?.constraints ?? []).filter((constraint) => constraint.authoritative)
    expect(authoritative).toEqual([])
  })

  test("#given an external knowledge root #when evidence builds #then the out-of-worktree record reaches the block", async () => {
    const dir = makeRepo()
    const external = mkdtempSync(join(tmpdir(), "planner-knowledge-"))
    roots.push(external)
    const claim = "the retry budget is counted per run, never per attempt"
    const record = knowledgeRecord(claim, "source-verified", "alpha-1234abcd")
    writeFileSync(join(external, `${record.id}.md`), renderRecordFile({ ...record, category: "source-verified" }))

    const loaded = await loadKnowledgeRecords(dir, external)
    const informed = await buildPlannerEvidence({ message: TASK_MESSAGE, directory: dir, knowledgeRoot: external, projectId: "alpha-1234abcd" })
    const baseline = await buildPlannerEvidence({ message: TASK_MESSAGE, directory: dir })

    expect(loaded.records).toHaveLength(1)
    expect(loaded.records[0]?.id).toBe(record.id)
    expect(informed.diagnostics.knowledgeRecords).toBe(1)
    expect(informed.text).toContain(claim)
    expect(baseline.diagnostics.knowledgeRecords).toBe(0)
    expect(baseline.text ?? "").not.toContain(claim)
  })

  test("#given the knowledge env #when a planner turn is prepared #then the external root is wired into the request", async () => {
    const dir = makeRepo()
    const external = mkdtempSync(join(tmpdir(), "planner-knowledge-"))
    roots.push(external)
    const claim = "the retry budget is counted per run, never per attempt"
    const record = knowledgeRecord(claim, "source-verified", "alpha-1234abcd")
    writeFileSync(join(external, `${record.id}.md`), renderRecordFile({ ...record, category: "source-verified" }))

    const turn = await preparePlannerTurn({
      message: TASK_MESSAGE,
      directory: dir,
      strategy: "plan-then-execute",
      projectId: "alpha-1234abcd",
      env: { OMO_PLAN_EVIDENCE: "1", OMO_PLAN_EVIDENCE_KNOWLEDGE: external },
    })

    expect(turn.evidence?.diagnostics.knowledgeRecords).toBe(1)
    expect(turn.promptText).toContain(claim)
  })
})

describe("planner evidence boundaries", () => {
  test("#given the environment switch #when read #then only an explicit off disables it", () => {
    expect(isPlanEvidenceEnabled({})).toBe(true)
    expect(isPlanEvidenceEnabled({ OMO_PLAN_EVIDENCE: "1" })).toBe(true)
    expect(isPlanEvidenceEnabled({ OMO_PLAN_EVIDENCE: "0" })).toBe(false)
    expect(isPlanEvidenceEnabled({ OMO_PLAN_EVIDENCE: "false" })).toBe(false)
    expect(isPlanEvidenceEnabled({ OMO_PLAN_EVIDENCE: " off " })).toBe(false)
  })

  test("#given the knowledge env #when resolved #then only an absolute path is accepted", () => {
    const absolute = join(tmpdir(), "external-knowledge")
    expect(resolveKnowledgeRoot({})).toBeUndefined()
    expect(resolveKnowledgeRoot({ OMO_PLAN_EVIDENCE_KNOWLEDGE: "   " })).toBeUndefined()
    expect(resolveKnowledgeRoot({ OMO_PLAN_EVIDENCE_KNOWLEDGE: "project-knowledge" })).toBeUndefined()
    expect(resolveKnowledgeRoot({ OMO_PLAN_EVIDENCE_KNOWLEDGE: ` ${absolute} ` })).toBe(absolute)
  })

  test("#given a message #when keywords are extracted #then stopwords and duplicates are removed", () => {
    expect(extractTaskKeywords("The cache invalidation for the cache in store.ts")).toEqual([
      "cache",
      "invalidation",
      "store.ts",
    ])
  })

  test("#given a worktree #when read #then the revision comes from git without running git", async () => {
    const dir = makeRepo()
    expect(await readWorktreeRevision(dir)).toBe(REVISION)
    expect(await readWorktreeRevision(makeRepo({ revision: false }))).toBeUndefined()
    expect(await collectSourceFiles(dir)).toHaveLength(4)
  })

  test("#given a linked worktree #when read #then the revision follows the gitdir file and the shared ref", async () => {
    const root = mkdtempSync(join(tmpdir(), "planner-worktree-"))
    roots.push(root)
    const store = join(root, "store")
    const gitDir = join(store, "worktrees", "wt")
    mkdirSync(join(store, "refs", "heads"), { recursive: true })
    mkdirSync(gitDir, { recursive: true })
    writeFileSync(join(store, "refs", "heads", "main"), `${REVISION}\n`)
    writeFileSync(join(gitDir, "commondir"), "../..\n")
    writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n")
    const linked = join(root, "linked")
    mkdirSync(linked, { recursive: true })
    writeFileSync(join(linked, ".git"), `gitdir: ${gitDir}\n`)
    expect(await readWorktreeRevision(linked)).toBe(REVISION)

    writeFileSync(join(gitDir, "HEAD"), `${REVISION}\n`)
    expect(await readWorktreeRevision(linked)).toBe(REVISION)
  })
})
