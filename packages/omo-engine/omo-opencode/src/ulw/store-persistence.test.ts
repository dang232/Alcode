/**
 * store-persistence.test.ts — the store's durable lifecycle: every mutation
 * saves, every boot loads, and recovery derives interruptions instead of
 * inventing them.
 */

import { describe, expect, test } from "bun:test"

import { FileUlwPersistence } from "./persistence.ts"
import type { PersistedUlwState, UlwPersistence } from "./persistence.ts"
import { UlwStore } from "./store.ts"

const FROZEN_NOW = 1700000000000

/** In-memory stand-in for file persistence: every save is observable in order. */
type MemoryPersistence = {
  readonly persistence: UlwPersistence
  readonly saves: readonly PersistedUlwState[]
}

function memoryPersistence(): MemoryPersistence {
  const saves: PersistedUlwState[] = []
  let state: PersistedUlwState | null = null
  return {
    saves,
    persistence: {
      load: () => (state === null ? { ok: false as const, reason: "no-store" } : { ok: true as const, state }),
      save: (next: PersistedUlwState) => {
        saves.push(next)
        state = next
      },
      transact: <T>(next: (current: PersistedUlwState | null) => { state: PersistedUlwState; result: T }): T => {
        const out = next(state)
        saves.push(out.state)
        state = out.state
        return out.result
      },
    },
  }
}

function activeRun(store: UlwStore, id = "run-1"): void {
  store.createRun({ id, brief: "Ship the loop", sessionScope: "ses_main" })
}

describe("ulw store durability", () => {
  test("#given persistence #when the store mutates #then every mutation saves", () => {
    const { persistence, saves } = memoryPersistence()
    const store = new UlwStore({ now: () => FROZEN_NOW, persistence })
    activeRun(store)
    store.dispatchGoal("run-1", "G001", "ses_worker_a")
    store.recordChildResult("run-1", "G001", { childSessionId: "ses_worker_a" })
    store.setRunStatus("run-1", "complete")
    // create + dispatch + receipt + status: one save per mutation.
    expect(saves).toHaveLength(4)
  })

  test("#given a saved store #when a new store boots from it #then runs, rosters, and receipts recover", () => {
    const { persistence } = memoryPersistence()
    const before = new UlwStore({ now: () => FROZEN_NOW, persistence })
    activeRun(before)
    before.dispatchGoal("run-1", "G001", "ses_worker_a")
    before.dispatchGoal("run-1", "G002", "ses_worker_b")
    before.recordChildResult("run-1", "G001", { childSessionId: "ses_worker_a" })

    const after = new UlwStore({ now: () => FROZEN_NOW, persistence })
    expect(after.getLoadReport()).toMatchObject({ durable: true, reason: "recovered", recoveredRuns: 1 })
    expect(after.getRun("run-1")).toMatchObject({ status: "active" })
    expect(after.rosterFor("run-1")).toEqual({ G001: ["ses_worker_a"], G002: ["ses_worker_b"] })
    expect(after.receiptFor("run-1", "G001")).toMatchObject({ status: "completed" })
    // A completed worker is never dispatched again: the pair is already recorded once.
    expect(after.dispatchGoal("run-1", "G001", "ses_worker_a")).toEqual(["ses_worker_a"])
  })

  test("#given duplicate registration after recovery #when repeated #then the original run wins", () => {
    const { persistence } = memoryPersistence()
    const before = new UlwStore({ now: () => FROZEN_NOW, persistence })
    activeRun(before)
    before.dispatchGoal("run-1", "G001", "ses_worker_a")

    const after = new UlwStore({ now: () => FROZEN_NOW, persistence })
    expect(() => after.createRun({ id: "run-1", brief: "Other", sessionScope: "ses_main" })).toThrow("already exists")
    expect(after.getRun("run-1")).toMatchObject({ brief: "Ship the loop" })
    expect(after.dispatchedGoalIds("run-1")).toEqual(["G001"])
  })

  test("#given an unfinished dispatch #when recovered #then it reads interrupted until reconciled", () => {
    const { persistence } = memoryPersistence()
    const before = new UlwStore({ now: () => FROZEN_NOW, persistence })
    activeRun(before)
    before.dispatchGoal("run-1", "G001", "ses_worker_a")
    before.dispatchGoal("run-1", "G002", "ses_worker_b")
    before.recordChildResult("run-1", "G001", { childSessionId: "ses_worker_a" })

    const after = new UlwStore({ now: () => FROZEN_NOW, persistence })
    expect(after.interruptedFor("run-1")).toEqual([{ goalId: "G002", workerSessionId: "ses_worker_b", state: "awaiting" }])
    // The host confirms one session alive and one gone.
    expect(after.reconcileRun("run-1", (session) => session === "ses_worker_b")).toEqual({ alive: ["ses_worker_b"], dead: [] })
  })

  test("#given several dead workers on one goal #when reconciled #then every one stays dead", () => {
    const store = new UlwStore({ now: () => FROZEN_NOW })
    activeRun(store)
    store.dispatchGoal("run-1", "G001", "ses_worker_a")
    store.dispatchGoal("run-1", "G001", "ses_worker_b")
    store.dispatchGoal("run-1", "G001", "ses_worker_c")
    expect(store.reconcileRun("run-1", () => false)).toEqual({
      alive: [],
      dead: ["ses_worker_a", "ses_worker_b", "ses_worker_c"],
    })
    expect(store.interruptedFor("run-1")).toEqual([
      { goalId: "G001", workerSessionId: "ses_worker_a", state: "dead" },
      { goalId: "G001", workerSessionId: "ses_worker_b", state: "dead" },
      { goalId: "G001", workerSessionId: "ses_worker_c", state: "dead" },
    ])
  })

  test("#given a dead worker #when reconciled #then it stays dead across the next recovery", () => {
    const { persistence } = memoryPersistence()
    const before = new UlwStore({ now: () => FROZEN_NOW, persistence })
    activeRun(before)
    before.dispatchGoal("run-1", "G001", "ses_worker_a")
    expect(before.reconcileRun("run-1", () => false)).toEqual({ alive: [], dead: ["ses_worker_a"] })
    expect(before.interruptedFor("run-1")).toEqual([{ goalId: "G001", workerSessionId: "ses_worker_a", state: "dead" }])

    const after = new UlwStore({ now: () => FROZEN_NOW, persistence })
    expect(after.interruptedFor("run-1")).toEqual([{ goalId: "G001", workerSessionId: "ses_worker_a", state: "dead" }])
    // A late receipt from the dead worker still settles its goal truthfully.
    after.recordChildResult("run-1", "G001", { childSessionId: "ses_worker_a" })
    expect(after.interruptedFor("run-1")).toEqual([])
  })

  test("#given no persistence #when constructed #then the store stays ephemeral", () => {
    const store = new UlwStore({ now: () => FROZEN_NOW })
    expect(store.getLoadReport()).toEqual({ durable: false, reason: "ephemeral" })
    activeRun(store)
    expect(store.getLastSaveError()).toBeNull()
  })

  test("#given a corrupt snapshot #when booting #then recovery is refused and the store starts empty", () => {
    const persistence: UlwPersistence = {
      load: () => ({ ok: false, reason: "corrupt-store" }),
      save: () => {},
      transact: () => {
        throw new Error("corrupt-store")
      },
    }
    const store = new UlwStore({ now: () => FROZEN_NOW, persistence })
    expect(store.getLoadReport()).toMatchObject({ durable: true, reason: "corrupt-store", recoveredRuns: 0 })
    expect(store.listRuns()).toEqual([])
  })

  test("#given a failing disk #when mutating #then the mutation still applies and the error is reported", () => {
    const persistence: UlwPersistence = {
      load: () => ({ ok: false, reason: "no-store" }),
      save: () => {
        throw new Error("disk full")
      },
      transact: () => {
        throw new Error("disk full")
      },
    }
    const store = new UlwStore({ now: () => FROZEN_NOW, persistence })
    activeRun(store)
    expect(store.getRun("run-1")).toMatchObject({ status: "active" })
    expect(store.getLastSaveError()).toBe("disk full")
  })

  test("#given interleaved saves from two live stores #when each saves #then neither run is lost", () => {
    const { persistence } = memoryPersistence()
    const first = new UlwStore({ now: () => FROZEN_NOW, persistence })
    activeRun(first, "run-a")
    // A second store boots while the first is mid-life, then both keep working.
    const second = new UlwStore({ now: () => FROZEN_NOW, persistence })
    activeRun(second, "run-b")
    first.dispatchGoal("run-a", "G001", "ses_worker_a")
    second.dispatchGoal("run-b", "G002", "ses_worker_b")
    first.recordChildResult("run-a", "G001", { childSessionId: "ses_worker_a" })

    const third = new UlwStore({ now: () => FROZEN_NOW, persistence })
    expect(third.getLoadReport()).toMatchObject({ durable: true, reason: "recovered", recoveredRuns: 2 })
    expect(third.rosterFor("run-a")).toEqual({ G001: ["ses_worker_a"] })
    expect(third.rosterFor("run-b")).toEqual({ G002: ["ses_worker_b"] })
    expect(third.receiptFor("run-a", "G001")).toMatchObject({ status: "completed" })
    expect(third.missingReceipts("run-a")).toEqual([])
    expect(third.missingReceipts("run-b")).toEqual(["G002"])
  })

  test("#given a lock held by another writer #when opening #then it fails fast instead of forking a duplicate", () => {
    const eexist = () => Object.assign(new Error("EEXIST"), { code: "EEXIST" })
    const enoent = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    // A live holder's lock file makes the stale check read fresh, so the lock holds.
    const liveFs = {
      readFileSync: (path: string): string => {
        if (path.endsWith("holder.json")) return JSON.stringify({ token: "live", at: Date.now() })
        throw enoent()
      },
      writeFileSync: (_path: string, _data: string): void => {},
      renameSync: (_tmp: string, _target: string): void => {},
      rmSync: (_path: string): void => {},
      mkdirSync: (path: string): void => {
        if (path.endsWith(".lockdir")) throw eexist()
      },
      statSync: (_path: string) => ({ mtimeMs: Date.now() }),
    }
    const store = new UlwStore({ now: () => FROZEN_NOW, persistence: new FileUlwPersistence({ fs: liveFs, filePath: "/ulw/store.json" }) })
    expect(() => store.openRun({ brief: "Ship the loop", sessionScope: "ses_main", submissionId: "sub-held" })).toThrow(
      "locked by another writer",
    )
    expect(store.listRuns()).toHaveLength(0)
    expect(store.runIdForSubmission("sub-held")).toBeUndefined()
  })

  test("#given a contended open with an accepted claim on disk #when opening #then it resolves instead of failing", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const nodeFs = await import("node:fs")
    const dir = mkdtempSync(join(tmpdir(), "ulw-contended-"))
    try {
      const filePath = join(dir, "ulw", "store.json")
      const first = new UlwStore({ now: () => FROZEN_NOW, persistence: new FileUlwPersistence({ fs: nodeFs, filePath }) })
      const opened = first.openRun({ brief: "Ship the loop", sessionScope: "ses_main", submissionId: "sub-shared" })
      expect(opened.deduped).toBe(false)
      // A second store boots stale, then contends the lock while the claim is already published.
      const second = new UlwStore({ now: () => FROZEN_NOW, persistence: new FileUlwPersistence({ fs: nodeFs, filePath }) })
      nodeFs.mkdirSync(`${filePath}.lockdir`)
      nodeFs.writeFileSync(`${filePath}.lockdir/holder.json`, JSON.stringify({ token: "live-other", at: Date.now() }))
      const retried = second.openRun({ brief: "Ship the loop", sessionScope: "ses_main", submissionId: "sub-shared" })
      expect(retried.deduped).toBe(true)
      expect(retried.record.id).toBe(opened.record.id)
      // SAFETY: the assertion only reads the run count of a file this test just wrote through the store.
      const stored = JSON.parse(nodeFs.readFileSync(filePath, "utf8")) as { runs: unknown[] }
      expect(stored.runs).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  test("#given a real file #when two stores share it #then the second recovers the first", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const nodeFs = await import("node:fs")
    const dir = mkdtempSync(join(tmpdir(), "ulw-persist-"))
    try {
      const filePath = join(dir, "ulw", "store.json")
      const first = new UlwStore({
        now: () => FROZEN_NOW,
        persistence: new FileUlwPersistence({ fs: nodeFs, filePath }),
      })
      activeRun(first)
      first.dispatchGoal("run-1", "G001", "ses_worker_a")

      const second = new UlwStore({
        now: () => FROZEN_NOW,
        persistence: new FileUlwPersistence({ fs: nodeFs, filePath }),
      })
      expect(second.getLoadReport()).toMatchObject({ durable: true, reason: "recovered" })
      expect(second.rosterFor("run-1")).toEqual({ G001: ["ses_worker_a"] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("#given two separate OS processes sharing one file #when each writes #then both runs survive", async () => {
    const { spawnSync } = await import("node:child_process")
    const { fileURLToPath } = await import("node:url")
    const nodeFs = await import("node:fs")
    const { mkdtempSync, rmSync } = nodeFs
    const { tmpdir } = await import("node:os")
    const { dirname, join } = await import("node:path")
    const fsPromises = await import("node:fs/promises")
    const dir = mkdtempSync(join(tmpdir(), "ulw-xproc-"))
    try {
      const filePath = join(dir, "ulw", "store.json")
      const here = dirname(fileURLToPath(import.meta.url))
      const driver = join(dir, "xproc-driver.tmp.ts")
      await fsPromises.writeFile(
        driver,
        [
          `import nodeFs from "node:fs"`,
          `import { UlwStore } from ${JSON.stringify(join(here, "store.ts"))}`,
          `import { FileUlwPersistence } from ${JSON.stringify(join(here, "persistence.ts"))}`,
          `const [filePath, mode] = process.argv.slice(2)`,
          `const store = new UlwStore({ persistence: new FileUlwPersistence({ fs: nodeFs, filePath }) })`,
          `if (mode === "seed") {`,
          `  store.createRun({ id: "run-a", brief: "A", sessionScope: "ses" })`,
          `  store.dispatchGoal("run-a", "G001", "ses_worker_a")`,
          `  console.log("A-OK roster=" + JSON.stringify(store.rosterFor("run-a")))`,
          `} else if (mode === "extend") {`,
          `  const roster = store.rosterFor("run-a")`,
          `  if (JSON.stringify(roster) !== JSON.stringify({ G001: ["ses_worker_a"] })) {`,
          `    console.error("B-MISSING-A " + JSON.stringify(roster))`,
          `    process.exit(3)`,
          `  }`,
          `  store.createRun({ id: "run-b", brief: "B", sessionScope: "ses" })`,
          `  store.dispatchGoal("run-b", "G002", "ses_worker_b")`,
          `  console.log("B-OK")`,
          `} else if (mode === "contend") {`,
          `  store.createRun({ id: "run-c", brief: "C", sessionScope: "ses" })`,
          `  console.log("C-SAVE-ERROR=" + store.getLastSaveError())`,
          `  console.log("C-HAS-RUN=" + (store.getRun("run-c") !== undefined))`,
          `}`,
        ].join("\n"),
        "utf8",
      )
      const run = (mode: string) =>
        spawnSync(process.execPath, [driver, filePath, mode], { encoding: "utf8", timeout: 60_000 })
      const seed = run("seed")
      expect(seed.status).toBe(0)
      expect(seed.stdout).toContain("A-OK")
      const extend = run("extend")
      expect(extend.status).toBe(0)
      expect(extend.stdout).toContain("B-OK")
      // A live holder's lock blocks a third process without losing its in-memory mutation.
      nodeFs.mkdirSync(`${filePath}.lockdir`)
      nodeFs.writeFileSync(`${filePath}.lockdir/holder.json`, JSON.stringify({ token: "live", at: Date.now() }))
      const contended = run("contend")
      expect(contended.status).toBe(0)
      expect(contended.stdout).toContain("locked by another writer")
      expect(contended.stdout).toContain("C-HAS-RUN=true")
      nodeFs.rmSync(`${filePath}.lockdir`, { force: true, recursive: true })

      const final = new UlwStore({
        now: () => FROZEN_NOW,
        persistence: new FileUlwPersistence({ fs: nodeFs, filePath }),
      })
      expect(final.getLoadReport()).toMatchObject({ durable: true, reason: "recovered", recoveredRuns: 2 })
      expect(final.rosterFor("run-a")).toEqual({ G001: ["ses_worker_a"] })
      expect(final.rosterFor("run-b")).toEqual({ G002: ["ses_worker_b"] })
      expect(final.getRun("run-c")).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
  120_000
  )
})
