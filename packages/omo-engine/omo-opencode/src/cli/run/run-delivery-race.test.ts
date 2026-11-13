import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "bun:test"

import type { SnapshotRun } from "./run-snapshot-store"

const roots: string[] = []
const SB = "I:/migration/Alwork/packages/omo-engine/omo-opencode/src/cli/run"
const SESSION = "ses_race_0001"

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-snapshot-race-"))
  roots.push(root)
  return root
}

function writerScript(root: string): string {
  const path = join(root, "writer.ts")
  writeFileSync(path, [
    `const { writeDeliverySnapshot } = await import("file:///${SB}/run-delivery-snapshot.ts")`,
    "const [directory, sessionId, taskId, status] = process.argv.slice(2)",
    "const write = () => writeDeliverySnapshot({",
    "  directory, sessionId,",
    "  record: { task_id: taskId, status: status ?? \"completed\", child_session_id: sessionId },",
    "  updatedAt: new Date().toISOString(),",
    "})",
    "let result = write()",
    "for (let attempt = 0; attempt < 8 && !result.written; attempt += 1) {",
    "  const sleeper = new Int32Array(new SharedArrayBuffer(4))",
    "  Atomics.wait(sleeper, 0, 0, 200)",
    "  result = write()",
    "}",
    "console.log(JSON.stringify(result))",
  ].join("\n"), "utf8")
  return path
}

async function runWriter(script: string, directory: string, sessionId: string, taskId: string, status = "completed") {
  const proc = Bun.spawn([process.execPath, script, directory, sessionId, taskId, status], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  const [o, e] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code: await proc.exited, out: (o + e).trim() }
}

function runsOf(directory: string, sessionId = SESSION): SnapshotRun[] {
  const file = join(directory, ".omo", "dag-runs", `${sessionId}.snapshot.json`)
  if (!existsSync(file)) return []
  const doc = JSON.parse(readFileSync(file, "utf8"))
  return doc.dag?.runs ?? []
}

function lockHolderScript(root: string): string {
  const path = join(root, "holder.ts")
  writeFileSync(path, [
    `const { withTaskRecordLock } = await import("file:///I:/migration/Alwork/packages/omo-engine/senpi-task/src/store/record-lock.ts")`,
    "const target = process.env.LOCK_TARGET!",
    "withTaskRecordLock(target, () => {",
    "  console.log(\"HELD\")",
    "  const sleeper = new Int32Array(new SharedArrayBuffer(4))",
    "  Atomics.wait(sleeper, 0, 0, 120000)",
    "})",
  ].join("\n"), "utf8")
  return path
}

function holdForScript(root: string, holdMs: number): string {
  const path = join(root, "holder-for.ts")
  writeFileSync(path, [
    `const { withTaskRecordLock } = await import("file:///I:/migration/Alwork/packages/omo-engine/senpi-task/src/store/record-lock.ts")`,
    "const target = process.env.LOCK_TARGET!",
    `withTaskRecordLock(target, () => {`,
    "  console.log(\"HELD\")",
    "  const sleeper = new Int32Array(new SharedArrayBuffer(4))",
    `  Atomics.wait(sleeper, 0, 0, ${holdMs})`,
    "})",
  ].join("\n"), "utf8")
  return path
}

async function waitForHeld(stdout: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stdout.getReader()
  const decoder = new TextDecoder()
  let seen = ""
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const chunk = await reader.read()
    if (chunk.done) return
    seen += decoder.decode(chunk.value)
    if (seen.includes("HELD")) { reader.releaseLock(); return }
  }
  throw new Error("lock holder never reported HELD")
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe("cross-process snapshot writers", () => {
  it("keeps every row when independent processes write different task ids to one session", async () => {
    const root = makeRoot()
    const script = writerScript(root)
    const directory = join(root, "project")
    mkdirSync(directory, { recursive: true })

    const taskIds = ["st_race_0001", "st_race_0002", "st_race_0003", "st_race_0004", "st_race_0005", "st_race_0006"]
    const results = await Promise.all(taskIds.map((taskId) => runWriter(script, directory, SESSION, taskId)))

    expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0])
    for (const child of results) expect(JSON.parse(child.out).written).toBe(true)
    const runs = runsOf(directory)
    expect(runs.map((run) => run.run_id).sort()).toEqual([...taskIds].sort())
    expect(runs).toHaveLength(taskIds.length)
  }, 60000)

  it("keeps one row when independent processes write the same task id", async () => {
    const root = makeRoot()
    const script = writerScript(root)
    const directory = join(root, "project-same")
    mkdirSync(directory, { recursive: true })

    const results = await Promise.all([
      runWriter(script, directory, SESSION, "st_race_0010", "running"),
      runWriter(script, directory, SESSION, "st_race_0010", "completed"),
      runWriter(script, directory, SESSION, "st_race_0010", "completed"),
    ])

    expect(results.map((r) => r.code)).toEqual([0, 0, 0])
    const runs = runsOf(directory)
    expect(runs).toHaveLength(1)
    const nodes = runs[0]?.nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.state).toBe("completed")
  }, 60000)

  it("does not publish while another process holds the lock", async () => {
    const root = makeRoot()
    const writer = writerScript(root)
    const holder = holdForScript(root, 750)
    const directory = join(root, "project-lock-wait")
    mkdirSync(directory, { recursive: true })
    const snapshot = join(directory, ".omo", "dag-runs", `${SESSION}.snapshot.json`)

    const child = Bun.spawn([process.execPath, holder], { stdout: "pipe", stderr: "pipe", env: { ...process.env, LOCK_TARGET: snapshot } })
    await waitForHeld(child.stdout)

    const pending = runWriter(writer, directory, SESSION, "st_race_0040")
    const observationDeadline = Date.now() + 400
    let publishedWhileHeld = false
    while (Date.now() < observationDeadline) {
      if (existsSync(snapshot)) { publishedWhileHeld = true; break }
      await Bun.sleep(20)
    }
    expect(publishedWhileHeld).toBe(false)

    await child.exited
    const result = await pending
    expect(result.code).toBe(0)
    expect(runsOf(directory)).toHaveLength(1)
    expect(runsOf(directory)[0]?.run_id).toBe("st_race_0040")
  }, 60000)

  it("recovers a lock left behind by a killed process", async () => {
    const root = makeRoot()
    const writer = writerScript(root)
    const holder = lockHolderScript(root)
    const directory = join(root, "project-crash")
    mkdirSync(directory, { recursive: true })
    const snapshot = join(directory, ".omo", "dag-runs", `${SESSION}.snapshot.json`)

    const child = Bun.spawn([process.execPath, holder], { stdout: "pipe", stderr: "pipe", env: { ...process.env, LOCK_TARGET: snapshot } })
    await waitForHeld(child.stdout)
    child.kill("SIGKILL")
    await child.exited

    const result = await runWriter(writer, directory, SESSION, "st_race_0030")
    expect(result.code).toBe(0)
    expect(runsOf(directory)).toHaveLength(1)
    expect(runsOf(directory)[0]?.run_id).toBe("st_race_0030")
  }, 60000)

  it("keeps separate session documents independent", async () => {
    const root = makeRoot()
    const script = writerScript(root)
    const directory = join(root, "project-two")
    mkdirSync(directory, { recursive: true })

    await Promise.all([
      runWriter(script, directory, "ses_a_0001", "st_race_0020"),
      runWriter(script, directory, "ses_b_0001", "st_race_0021"),
    ])

    expect(runsOf(directory, "ses_a_0001")).toHaveLength(1)
    expect(runsOf(directory, "ses_b_0001")).toHaveLength(1)
  }, 60000)
})
