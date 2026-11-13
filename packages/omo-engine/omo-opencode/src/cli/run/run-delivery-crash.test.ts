// The nine-boundary crash matrix. Each case seeds the exact on-disk state a
// crash leaves behind, then a FRESH process runs the reconciler and reports
// what it wrote. Nothing here asserts from the design; every row is observed.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "bun:test"

const roots = []
const SESSION = "ses_crash_matrix_0001"
const RUN_DIR = "I:/migration/Alwork/packages/omo-engine/omo-opencode/src/cli/run"

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "omo-crash-matrix-"))
  roots.push(root)
  return root
}

function reconcilerScript(root) {
  const path = join(root, "reconcile-child.ts")
  writeFileSync(path, [
    `const { reconcileRunSnapshots } = await import("file:///${RUN_DIR}/run-delivery-reconcile.ts")`,
    "const [directory, stateDir] = process.argv.slice(2)",
    "const report = reconcileRunSnapshots({ directory, stateDir, updatedAt: new Date().toISOString() })",
    "console.log(JSON.stringify(report))",
  ].join("\n"), "utf8")
  return path
}

async function runReconciler(script, directory, stateDir) {
  const proc = Bun.spawn([process.execPath, script, directory, stateDir], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  const [o, e] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  const line = (o + e).trim().split(/\r?\n/).filter((l) => l.trim().startsWith("{")).pop()
  return { code, report: line ? JSON.parse(line) : null, out: (o + e).trim() }
}

function seedState(root, records) {
  const stateDir = join(root, "state")
  mkdirSync(join(stateDir, "tasks"), { recursive: true })
  for (const record of records) {
    writeFileSync(join(stateDir, "tasks", `${record.task_id}.json`), JSON.stringify(record), "utf8")
  }
  return stateDir
}

function record(taskId, extra = {}) {
  return { task_id: taskId, status: "completed", child_session_id: SESSION, verification_status: "verified", ...extra }
}

function runsOf(project) {
  const file = join(project, ".omo", "dag-runs", `${SESSION}.snapshot.json`)
  if (!existsSync(file)) return []
  return JSON.parse(readFileSync(file, "utf8")).dag.runs
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe("projection crash boundaries", () => {
  it("1. no terminal record: nothing is projected and nothing is invented", async () => {
    const root = makeRoot()
    const project = join(root, "project")
    mkdirSync(project, { recursive: true })
    const stateDir = seedState(root, [])
    const { code, report } = await runReconciler(reconcilerScript(root), project, stateDir)
    expect(code).toBe(0)
    expect(report.written).toBe(0)
    expect(report.scanned).toBe(0)
    expect(runsOf(project)).toEqual([])
  }, 60000)

  it("2. terminal record, no pending marker: a durable scan still finds it", async () => {
    const root = makeRoot()
    const project = join(root, "project")
    mkdirSync(project, { recursive: true })
    const stateDir = seedState(root, [record("st_crash_0002")])
    const { report } = await runReconciler(reconcilerScript(root), project, stateDir)
    expect(report.written).toBe(1)
    expect(runsOf(project).map((run) => run.run_id)).toEqual(["st_crash_0002"])
  }, 60000)

  it("3. pending marker written, no snapshot: recovery projects exactly one row", async () => {
    const root = makeRoot()
    const project = join(root, "project")
    mkdirSync(join(project, ".omo", "dag-runs"), { recursive: true })
    const stateDir = seedState(root, [record("st_crash_0003")])
    const { report } = await runReconciler(reconcilerScript(root), project, stateDir)
    expect(report.written).toBe(1)
    expect(runsOf(project)).toHaveLength(1)
  }, 60000)

  it("4. stale lock left by a dead holder: the writer reaps it and publishes", async () => {
    const root = makeRoot()
    const project = join(root, "project")
    const runsDir = join(project, ".omo", "dag-runs")
    mkdirSync(runsDir, { recursive: true })
    const stateDir = seedState(root, [record("st_crash_0004")])
    const snapshot = join(runsDir, `${SESSION}.snapshot.json`)
    const staleLock = `999999\n${Date.now()}\nstale-token\n0\n${hostname()}\n`
    writeFileSync(`${snapshot}.lock`, staleLock, "utf8")
    const { report } = await runReconciler(reconcilerScript(root), project, stateDir)
    expect(report.written).toBe(1)
    expect(runsOf(project)).toHaveLength(1)
  }, 60000)

  it("5. orphan temp file from a crashed merge: the published document stays authoritative", async () => {
    const root = makeRoot()
    const project = join(root, "project")
    const runsDir = join(project, ".omo", "dag-runs")
    mkdirSync(runsDir, { recursive: true })
    const stateDir = seedState(root, [record("st_crash_0005")])
    const snapshot = join(runsDir, `${SESSION}.snapshot.json`)
    writeFileSync(`${snapshot}.${Date.now().toString(36)}abc.tmp`, "{ half written", "utf8")
    const { report } = await runReconciler(reconcilerScript(root), project, stateDir)
    expect(report.written).toBe(1)
    expect(runsOf(project).map((run) => run.run_id)).toEqual(["st_crash_0005"])
  }, 60000)

  it("7. published but unacknowledged: replay is an idempotent no-op", async () => {
    const root = makeRoot()
    const project = join(root, "project")
    mkdirSync(project, { recursive: true })
    const stateDir = seedState(root, [record("st_crash_0007")])
    const script = reconcilerScript(root)
    const first = await runReconciler(script, project, stateDir)
    expect(first.report.written).toBe(1)
    const replay = await runReconciler(script, project, stateDir)
    expect(replay.report.written).toBe(0)
    expect(replay.report.skipped).toBe(1)
    expect(runsOf(project)).toHaveLength(1)
  }, 60000)

  it("9. two reconciles racing at startup: one publishes, the other skips, never two rows", async () => {
    const root = makeRoot()
    const project = join(root, "project")
    mkdirSync(project, { recursive: true })
    const stateDir = seedState(root, [record("st_crash_0009")])
    const script = reconcilerScript(root)
    const [a, b] = await Promise.all([
      runReconciler(script, project, stateDir),
      runReconciler(script, project, stateDir),
    ])
    const written = a.report.written + b.report.written
    expect(written).toBe(1)
    expect(a.report.written + a.report.skipped + b.report.written + b.report.skipped).toBe(2)
    expect(runsOf(project)).toHaveLength(1)
  }, 60000)
})
