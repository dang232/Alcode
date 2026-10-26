// Production-composition proof for the native knowledge lifecycle (slice 9.7): the scheduler built
// by its real factory registers the default hook, an accepted run persists a promoted record into
// the injected store, and a SEPARATE PROCESS retrieves it through the real planner evidence path.
// Only child execution is faked; admission, verification, the gate, the hook, the mapper, promotion,
// persistence and retrieval are production code.
import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseRecordFile } from "../../../memory-core/src/project-knowledge/record.ts"
import { resolveProjectIdentity } from "../../../memory-core/src/project-knowledge/identity.ts"
import { resolveProjectKnowledgeRoot } from "../../../memory-core/src/project-knowledge/store-home.ts"
import { buildPlannerEvidence } from "../../../omo-opencode/src/cli/run/plan-evidence.ts"
import { buildTaskUnderstanding } from "./intelligence/understanding"
import { productionKnowledgeHook } from "./intelligence/knowledge-lifecycle"
import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord } from "../state"
import { compileDag, createDagFileStore } from "./index"
import { createDagScheduler } from "./scheduler"
import { retryDagNodes } from "./node-retry"
import type {
  DagDefinition,
  DagNodeInput,
  DagRunId,
  DagRunRecordV1,
  DagTaskOwner,
  DagVerifyCheck,
  DagVerifyCommandResult,
  DagVerifyRunner,
  OwnedStartResult,
} from "./types"
import type { TaskManager } from "../manager/types"
const runId = "run-production-knowledge" as DagRunId
const parentSessionId = "ses-knowledge-parent"
const rootSessionId = "ses-knowledge-root"
const AT = "2026-10-24T00:00:00.000Z"
const CHECK_ID = "dag-node-check"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempRoot(prefix: string): string {
  const directory = fs.mkdtempSync(join(tmpdir(), prefix))
  cleanupRoots.push(directory)
  return directory
}

function makeRepo(): { directory: string; revision: string } {
  const directory = tempRoot("pk-production-repo-")
  fs.mkdirSync(join(directory, "src"), { recursive: true })
  fs.writeFileSync(join(directory, "src", "scheduler-gate.ts"), "export const gate = (ok: boolean) => ok\n")
  fs.writeFileSync(
    join(directory, "src", "dag-node-check.ts"),
    "import { gate } from './scheduler-gate'\nexport const nodeCheck = (ok: boolean) => gate(ok)\n",
  )
  fs.writeFileSync(join(directory, "src", "repair.ts"), "export const repair = (ok: boolean) => !ok\n")
  fs.writeFileSync(
    join(directory, "src", "dag-node-check.test.ts"),
    "import { nodeCheck } from './dag-node-check'\nexport const probe = () => nodeCheck(true)\n",
  )
  execFileSync("git", ["init", "-q", directory])
  execFileSync("git", ["-C", directory, "add", "-A"])
  execFileSync("git", ["-C", directory, "-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "-m", "init"])
  const revision = execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  return { directory, revision }
}

class AutoTaskManager implements TaskManager {
  readonly starts: string[] = []
  #counter = 0

  residencyChanged(): Promise<void> {
    return new Promise<void>(() => undefined)
  }

  async startOwned(_spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
    this.#counter += 1
    const nodeId = String(owner.nodeId)
    const taskId = `task-${this.#counter}`
    this.starts.push(nodeId)
    return { kind: "started", reused: false, task_id: taskId, status: "running", name: nodeId }
  }

  findOwnedTask(owner: Pick<DagTaskOwner, "kind" | "runId" | "nodeId">): TaskRecord | undefined {
    if (!this.starts.includes(String(owner.nodeId))) return undefined
    return this.#record(String(owner.nodeId))
  }

  waitFor(taskId: string): Promise<TaskRecord> {
    const nodeId = taskId.replace("task-", "")
    return Promise.resolve(this.#record(nodeId))
  }

  #record(nodeId: string): TaskRecord {
    return {
      task_id: `task-${nodeId}`,
      name: nodeId,
      parent_session_id: parentSessionId,
      root_session_id: rootSessionId,
      depth: 1,
      category: "quick",
      execution_mode: "in-process",
      model: "fake-model",
      notify_on_terminal: true,
      owner: { kind: "dag-node", runId, nodeId } as DagTaskOwner,
      status: "completed",
      residency_state: "resident",
      created_at: AT,
      updated_at: AT,
      final_response: `done ${nodeId}`,
      notification: { run_epoch: 1, notified_epoch: 1 },
    } as TaskRecord
  }

  start(): Promise<never> {
    throw new Error("not implemented")
  }
  continueTask(): Promise<never> {
    throw new Error("not implemented")
  }
  sendToTask(): Promise<never> {
    throw new Error("not implemented")
  }
  interruptTask(): Promise<never> {
    throw new Error("not implemented")
  }
  cancelTask(): Promise<never> {
    throw new Error("not implemented")
  }
  list(): readonly [] {
    return []
  }
  get(): undefined {
    return undefined
  }
  forget(): void {}
  getResidentHandle(): undefined {
    return undefined
  }
  subscribeChild(): () => void {
    return () => undefined
  }
  residentTaskIds(): readonly string[] {
    return []
  }
  promoteToBackground(): boolean {
    return false
  }
}

function verifyCheck(): DagVerifyCheck {
  return { checkId: CHECK_ID, category: "unit", command: ["bun", "test"], timeoutMs: 30_000, criteria: ["AC-1"] }
}

function definition(): DagDefinition {
  const entry: DagNodeInput = { id: "a", prompt: "do a", category: "quick", writeScopes: ["src/dag-node-check.ts"], verify: [verifyCheck()] }
  return { key: "knowledge-production", name: "knowledge production", nodes: [entry] }
}

function recordFor(input: DagDefinition): DagRunRecordV1 {
  const compiled = compileDag(input, { at: AT })
  if (!compiled.ok) throw new Error("test DAG did not compile")
  return {
    schemaVersion: 1,
    checkpointSeq: 0,
    runId,
    runKey: input.key,
    name: input.name,
    parentSessionId,
    rootSessionId,
    definitionFingerprint: "definition-fingerprint",
    definition: { key: input.key, name: input.name, nodes: input.nodes.map((node) => ({ ...node, effectivePrompt: node.prompt })) },
    status: "pending",
    generation: 1,
    createdAt: AT,
    updatedAt: AT,
    nodes: compiled.nodes,
    edges: compiled.edges,
    waves: compiled.waves,
    criticalPath: compiled.criticalPath,
    bottlenecks: compiled.bottlenecks,
    diagnostics: compiled.diagnostics,
  }
}

function passing(): DagVerifyCommandResult {
  return { started: true, timedOut: false, cancelled: false, output: "ok", outputBytes: 2, durationMs: 1, exitCode: 0, uncertainEffect: false }
}

function failing(): DagVerifyCommandResult {
  return { started: true, timedOut: false, cancelled: false, output: "boom", outputBytes: 4, durationMs: 1, exitCode: 1, uncertainEffect: false }
}

function runner(result: () => DagVerifyCommandResult): DagVerifyRunner {
  return (() => Promise.resolve(result())) as unknown as DagVerifyRunner
}

function recordsIn(root: string): string[] {
  return fs.readdirSync(root).filter((name) => name.endsWith(".md"))
}

function understandingFor(directory: string, revision: string) {
  const projectId = resolveProjectIdentity(directory, {}).projectId
  return buildTaskUnderstanding({ scope: { projectId, worktreeId: "wt-production", revision, fingerprint: "fp-production" } })
}

describe("production knowledge activation", () => {
  test("#given the real scheduler factory and an accepted retried run #when the run settles #then a promoted record persists in the injected store and a fresh process retrieves it", async () => {
    const repo = makeRepo()
    const storeRoot = tempRoot("pk-production-store-")
    const projectDir = tempRoot("pk-production-dag-")
    const store = createDagFileStore({ project_dir: projectDir })
    const base = recordFor(definition())
    store.writeCheckpoint(runId, base)
    const manager = new AutoTaskManager()

    const failingRun = createDagScheduler({
      store,
      taskManager: manager,
      initialRecord: base,
      now: () => Date.parse(AT),
      verifyRunner: runner(failing),
      verifyProjectDir: repo.directory,
      knowledgeStoreEnv: { OMO_PROJECT_KNOWLEDGE_HOME: storeRoot },
      intelligence: { understanding: understandingFor(repo.directory, repo.revision) },
    })
    const failed = await failingRun.run()
    expect(failed.status).toBe("failed")
    expect(recordsIn(storeRoot)).toEqual([])

    const retried = retryDagNodes(
      {
        store,
        taskManager: manager,
        initialRecord: store.readCheckpoint(runId) as DagRunRecordV1,
        now: () => Date.parse(AT),
        verifyRunner: runner(passing),
        verifyProjectDir: repo.directory,
        knowledgeStoreEnv: { OMO_PROJECT_KNOWLEDGE_HOME: storeRoot },
        intelligence: { understanding: understandingFor(repo.directory, repo.revision) },
      },
      runId,
    )
    const accepted = await retried.run
    expect(accepted.status).toBe("completed")

    const files = recordsIn(storeRoot)
    expect(files).toHaveLength(1)
    const parsed = parseRecordFile(`project-knowledge/${files[0]}`, fs.readFileSync(join(storeRoot, files[0] as string), "utf8"))
    expect(parsed.kind).toBe("record")
    if (parsed.kind !== "record") return
    const projectId = resolveProjectIdentity(repo.directory, {}).projectId
    expect(parsed.record.projectId).toBe(projectId)
    expect(parsed.record.sourceRevision).toBe(repo.revision)
    expect(parsed.record.sourceFile).toBe("src/dag-node-check.ts")
    expect(parsed.record.category).toBe("source-verified")
    expect(parsed.record.validationMethod).toBe("test-pass")
    expect(parsed.record.claim).toContain("passes after the repair")

    const duplicate = await productionKnowledgeHook({ OMO_PROJECT_KNOWLEDGE_HOME: storeRoot })({
      snapshot: accepted,
      store,
      revision: repo.revision,
      at: AT,
      directory: repo.directory,
    })
    expect(duplicate.status).toBe("duplicate")
    expect(recordsIn(storeRoot)).toEqual(files)

    const script = join(tempRoot("pk-production-script-"), "retrieve.ts")
    fs.writeFileSync(
      script,
      [
        `const { buildPlannerEvidence } = await import(${JSON.stringify(new URL("file:///" + join(process.cwd(), "packages/omo-engine/omo-opencode/src/cli/run/plan-evidence.ts").replace(/\\\\/g, "/")).href)})`,
        `const directory = ${JSON.stringify(repo.directory)}`,
        `const knowledgeRoot = ${JSON.stringify(storeRoot)}`,
        `const projectId = ${JSON.stringify(projectId)}`,
        `const message = "the dag node check failed on an earlier attempt and passes after the repair; confirm the math contract"`,
        `const informed = await buildPlannerEvidence({ message, directory, knowledgeRoot, projectId })`,
        `const baseline = await buildPlannerEvidence({ message, directory, projectId })`,
        `const foreign = await buildPlannerEvidence({ message, directory, knowledgeRoot, projectId: "other-00000000" })`,
        `const shows = (text) => (text ?? "").includes("passes after the repair")`,
        `console.log(JSON.stringify({ informed: { status: informed.status, reason: informed.diagnostics.reason ?? "none", knowledge: informed.diagnostics.knowledgeRecords, shows: shows(informed.text) }, baseline: { knowledge: baseline.diagnostics.knowledgeRecords, shows: shows(baseline.text) }, foreign: { shows: shows(foreign.text) } }))`,
      ].join("\n"),
    )
    const child = Bun.spawn(["bun", "run", script], { stdout: "pipe", stderr: "pipe" })
    expect(await child.exited).toBe(0)
    const output = JSON.parse((await new Response(child.stdout).text()).trim()) as {
      informed: { status: string; reason: string; knowledge: number; shows: boolean }
      baseline: { knowledge: number; shows: boolean }
      foreign: { shows: boolean }
    }
    expect(output.informed.status, output.informed.reason).toBe("available")
    expect(output.informed.knowledge).toBe(1)
    expect(output.informed.shows).toBe(true)
    expect(output.baseline.knowledge).toBe(0)
    expect(output.baseline.shows).toBe(false)
    expect(output.foreign.shows).toBe(false)
  }, 120_000)

  test("#given a test runtime with no store override #when an accepted retried run settles #then the default hook refuses and neither the user store nor any fallback path is written", async () => {
    const repo = makeRepo()
    const projectDir = tempRoot("pk-production-dag-")
    const store = createDagFileStore({ project_dir: projectDir })
    const base = recordFor(definition())
    store.writeCheckpoint(runId, base)
    const manager = new AutoTaskManager()
    const home = resolveProjectKnowledgeRoot({}, process.cwd())

    const scheduler = createDagScheduler({
      store,
      taskManager: manager,
      initialRecord: base,
      now: () => Date.parse(AT),
      verifyRunner: runner(passing),
      verifyProjectDir: repo.directory,
      knowledgeStoreEnv: {},
      intelligence: { understanding: understandingFor(repo.directory, repo.revision) },
    })
    const settled = await scheduler.run()

    expect(settled.status).toBe("completed")
    expect(process.env.NODE_ENV).toBe("test")
    expect(fs.existsSync(home)).toBe(false)
    expect(fs.existsSync(join(repo.directory, "project-knowledge"))).toBe(false)
    const refusal = await productionKnowledgeHook({ NODE_ENV: "test" })({
      snapshot: settled,
      store,
      revision: repo.revision,
      at: AT,
      directory: repo.directory,
    })
    expect(refusal.status).toBe("unavailable")
    if (refusal.status === "unavailable") expect(refusal.reason).toBe("test-runtime-requires-explicit-store")
    expect(fs.existsSync(home)).toBe(false)
  }, 120_000)

  test("#given a scheduler constructed but never run #when the store override names a fresh root #then no store is created by construction or import", () => {
    const storeRoot = tempRoot("pk-production-unused-")
    const empty = join(storeRoot, "never-created")
    const projectDir = tempRoot("pk-production-dag-")
    const store = createDagFileStore({ project_dir: projectDir })
    const base = recordFor(definition())
    store.writeCheckpoint(runId, base)
    createDagScheduler({
      store,
      taskManager: new AutoTaskManager(),
      initialRecord: base,
      knowledgeStoreEnv: { OMO_PROJECT_KNOWLEDGE_HOME: empty },
    })
    expect(fs.existsSync(empty)).toBe(false)
  })
})
