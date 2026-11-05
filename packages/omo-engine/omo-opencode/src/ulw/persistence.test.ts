/**
 * persistence.test.ts — durability contract for the native ULW store file.
 *
 * Every case pins one half of the crash-safety promise: atomic publish
 * (readers see the previous complete snapshot or the new one, never a
 * torn write), and fail-closed loading (missing, corrupt, or versioned
 * snapshots report a reason and recover nothing, instead of inventing
 * runs, receipts, or dispatches).
 */

import { describe, expect, test } from "bun:test"

import { FileUlwPersistence, mergePersistedStates, parsePersistedUlwState, ULW_STORE_SCHEMA_VERSION } from "./persistence.ts"
import type { PersistedUlwRun, PersistedUlwState } from "./persistence.ts"
import type { UlwDispatchRoster, UlwChildReceipts, UlwRunStatus } from "./types.ts"

function stateWithRuns(): PersistedUlwState {
  return {
    version: ULW_STORE_SCHEMA_VERSION,
    savedAt: new Date(1700000000000).toISOString(),
    generation: 3,
    runs: [
      {
        record: {
          id: "run-1",
          brief: "Ship the loop",
          sessionScope: "ses_main",
          status: "active",
          createdAt: new Date(1700000000000).toISOString(),
          updatedAt: new Date(1700000000000).toISOString(),
        },
        roster: { G001: ["ses_worker_a"], G002: ["ses_worker_b"] },
        receipts: {
          G001: { goalId: "G001", childSessionId: "ses_worker_a", status: "completed", recordedAt: new Date(1700000000000).toISOString() },
        },
        deadWorkers: {},
      },
    ],
  }
}

function enoent(path: string): Error {
  // SAFETY: the fake only needs the errno code the loader reads; no other ErrnoException field is touched.
  const error = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException
  error.code = "ENOENT"
  return error
}

function eexist(path: string): Error {
  // SAFETY: the lock protocol only reads the errno code to tell a held lock from a missing directory.
  const error = new Error(`EEXIST: file already exists, mkdir '${path}'`) as NodeJS.ErrnoException
  error.code = "EEXIST"
  return error
}

function fakeFs(files: Map<string, string> = new Map(), failures: { write?: boolean; rename?: boolean } = {}) {
  const calls: string[] = []
  const dirs = new Set<string>()
  const dirTimes = new Map<string, number>()
  return {
    calls,
    dirs,
    readFileSync(path: string): string {
      calls.push(`read:${path}`)
      const text = files.get(path)
      if (text === undefined) throw enoent(path)
      return text
    },
    writeFileSync(path: string, data: string): void {
      calls.push(`write:${path}`)
      if (failures.write === true) throw new Error("disk full")
      files.set(path, data)
    },
    renameSync(tmpPath: string, targetPath: string): void {
      calls.push(`rename:${tmpPath}->${targetPath}`)
      if (failures.rename === true) throw new Error("rename failed")
      const text = files.get(tmpPath)
      if (text === undefined) throw new Error("missing temp file")
      files.delete(tmpPath)
      files.set(targetPath, text)
    },
    rmSync(path: string): void {
      calls.push(`rm:${path}`)
      files.delete(path)
      dirs.delete(path)
      dirTimes.delete(path)
    },
    mkdirSync(path: string, options?: { recursive?: boolean }): void {
      calls.push(`mkdir:${path}`)
      if (dirs.has(path) && options?.recursive !== true) throw eexist(path)
      dirs.add(path)
      dirTimes.set(path, Date.now())
    },
    statSync: (path: string) => {
      calls.push(`stat:${path}`)
      const mtimeMs = dirTimes.get(path)
      if (mtimeMs === undefined) throw enoent(path)
      return { mtimeMs }
    },
  }
}

describe("ulw file persistence", () => {
  test("#given a state #when saved and loaded #then every run, roster entry, and receipt survives", () => {
    const files = new Map<string, string>()
    const fs = fakeFs(files)
    const persistence = new FileUlwPersistence({ fs, filePath: "/ulw/store.json" })
    persistence.save(stateWithRuns())

    const loaded = new FileUlwPersistence({ fs, filePath: "/ulw/store.json" }).load()
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.state.runs).toHaveLength(1)
    expect(loaded.state.runs[0].roster).toEqual({ G001: ["ses_worker_a"], G002: ["ses_worker_b"] })
    expect(loaded.state.runs[0].receipts["G001"]).toMatchObject({ status: "completed" })
  })

  test("#given no store file #when loaded #then the miss names itself instead of failing", () => {
    const loaded = new FileUlwPersistence({ fs: fakeFs(), filePath: "/ulw/store.json" }).load()
    expect(loaded).toEqual({ ok: false, reason: "no-store" })
  })

  test("#given torn JSON #when loaded #then it is corrupt, never partial state", () => {
    const files = new Map([["/ulw/store.json", '{"version":1,"runs":[']] as const)
    const loaded = new FileUlwPersistence({ fs: fakeFs(new Map(files)), filePath: "/ulw/store.json" }).load()
    expect(loaded).toEqual({ ok: false, reason: "corrupt-store" })
  })

  test("#given a newer schema version #when loaded #then it is refused instead of misread", () => {
    const files = new Map([["/ulw/store.json", JSON.stringify({ version: 999, savedAt: new Date(0).toISOString(), runs: [] })]])
    const loaded = new FileUlwPersistence({ fs: fakeFs(files), filePath: "/ulw/store.json" }).load()
    expect(loaded).toEqual({ ok: false, reason: "corrupt-store" })
  })

  test("#given a receipt that settles no dispatch #when loaded #then it is refused", () => {
    const state = stateWithRuns()
    const tampered = {
      ...state,
      runs: state.runs.map((run) => ({
        ...run,
        receipts: {
          G009: { goalId: "G009", childSessionId: "ses_stranger", status: "completed", recordedAt: new Date(0).toISOString() },
        },
      })),
    }
    expect(parsePersistedUlwState(tampered)).toBeNull()
  })

  test("#given a dead worker that was never dispatched #when loaded #then it is refused", () => {
    const state = stateWithRuns()
    const tampered = {
      ...state,
      runs: state.runs.map((run) => ({ ...run, deadWorkers: { G001: ["ses_ghost"] } })),
    }
    expect(parsePersistedUlwState(tampered)).toBeNull()
  })

  test("#given a rename crash #when saving #then the previous snapshot stays readable", () => {
    const files = new Map<string, string>()
    const writer = new FileUlwPersistence({ fs: fakeFs(files), filePath: "/ulw/store.json" })
    writer.save(stateWithRuns())
    const before = files.get("/ulw/store.json")

    const crashing = fakeFs(files, { rename: true })
    const failing = new FileUlwPersistence({ fs: crashing, filePath: "/ulw/store.json" })
    expect(() => failing.save(stateWithRuns())).toThrow("rename failed")
    // The failed publish left no temp file behind and the target is untouched.
    expect(files.get("/ulw/store.json")).toBe(before)
    expect([...files.keys()].some((key) => key.includes(".tmp-"))).toBe(false)
    expect(new FileUlwPersistence({ fs: fakeFs(files), filePath: "/ulw/store.json" }).load().ok).toBe(true)
  })

  test("#given a nested file path #when saved #then parent directories are created", () => {
    const files = new Map<string, string>()
    const fs = fakeFs(files)
    new FileUlwPersistence({ fs, filePath: "/data/ulw/store.json" }).save(stateWithRuns())
    expect(fs.calls.some((call) => call === "mkdir:/data/ulw")).toBe(true)
    expect(files.has("/data/ulw/store.json")).toBe(true)
  })
})

describe("ulw store file lock", () => {
  const lockDirFor = (filePath: string) => `${filePath}.lockdir`

  test("#given a free store #when transacting #then the lock is acquired and released", () => {
    const files = new Map<string, string>()
    const fs = fakeFs(files)
    const persistence = new FileUlwPersistence({ fs, filePath: "/ulw/store.json" })
    persistence.transact(() => stateWithRuns())
    expect(fs.dirs.has(lockDirFor("/ulw/store.json"))).toBe(false)
    expect(files.has("/ulw/store.json")).toBe(true)
  })

  test("#given a lock held by a live writer #when transacting #then it fails fast without touching the snapshot", () => {
    const files = new Map<string, string>()
    const fs = fakeFs(files)
    // A live holder's lock: holder timestamp one second before the waiter's clock.
    fs.mkdirSync(lockDirFor("/ulw/store.json"))
    fs.writeFileSync(
      `${lockDirFor("/ulw/store.json")}/holder.json`,
      JSON.stringify({ token: "other-1", at: 1700000000000 }),
    )
    const waiter = new FileUlwPersistence({ fs, filePath: "/ulw/store.json", now: () => 1700000001000 })
    expect(() => waiter.transact(() => stateWithRuns())).toThrow("locked by another writer")
    expect(files.has("/ulw/store.json")).toBe(false)
  })

  test("#given a stale lock from a dead process #when transacting #then the lock is broken and the save succeeds", () => {
    const files = new Map<string, string>()
    const fs = fakeFs(files)
    const lockDir = lockDirFor("/ulw/store.json")
    fs.mkdirSync(lockDir)
    fs.writeFileSync(`${lockDir}/holder.json`, JSON.stringify({ token: "dead-9", at: 1700000000000 }))
    const waiter = new FileUlwPersistence({ fs, filePath: "/ulw/store.json", now: () => 1700000061000 })
    waiter.transact(() => stateWithRuns())
    expect(files.has("/ulw/store.json")).toBe(true)
    expect(fs.dirs.has(lockDir)).toBe(false)
  })

  test("#given a lock broken between acquire and publish #when publishing #then it fails instead of clobbering", () => {
    const files = new Map<string, string>()
    const fs = fakeFs(files)
    // An intruder breaks the holder mid-transaction: the publish must refuse.
    const persistence = new FileUlwPersistence({ fs, filePath: "/ulw/store.json" })
    expect(() =>
      persistence.transact(() => {
        fs.writeFileSync("/ulw/store.json.lockdir/holder.json", JSON.stringify({ token: "intruder", at: Date.now() }))
        return { state: stateWithRuns(), result: null }
      }),
    ).toThrow("lock lost")
    expect(files.has("/ulw/store.json")).toBe(false)
  })

  test("#given a lock dir with no holder file #when fresh #then it is treated as held, not broken", () => {
    const files = new Map<string, string>()
    const fs = fakeFs(files)
    const lockDir = lockDirFor("/ulw/store.json")
    // A holder crashed between mkdir and its holder write: the directory exists with a fresh mtime.
    fs.mkdirSync(lockDir)
    const waiter = new FileUlwPersistence({ fs, filePath: "/ulw/store.json", now: () => Date.now() + 1000 })
    expect(() => waiter.transact(() => stateWithRuns())).toThrow("locked by another writer")
  })
})

describe("ulw snapshot merge", () => {
  const stamp = new Date(1700000000000).toISOString()
  const run = (
    id: string,
    overrides: {
      record?: { status?: UlwRunStatus; updatedAt?: string }
      roster?: UlwDispatchRoster
      receipts?: UlwChildReceipts
      deadWorkers?: Readonly<Record<string, readonly string[]>>
    } = {},
  ): PersistedUlwRun => ({
    record: {
      id,
      brief: "Ship the loop",
      sessionScope: "ses_main",
      status: overrides.record?.status ?? "active",
      createdAt: stamp,
      updatedAt: overrides.record?.updatedAt ?? stamp,
    },
    roster: { ...(overrides.roster ?? {}) },
    receipts: { ...(overrides.receipts ?? {}) },
    deadWorkers: { ...(overrides.deadWorkers ?? {}) },
  })

  const state = (generation: number, runs: readonly PersistedUlwRun[]): PersistedUlwState => ({
    version: ULW_STORE_SCHEMA_VERSION,
    savedAt: stamp,
    generation,
    runs: [...runs],
  })

  test("#given runs on both sides #when merged #then every run survives", () => {
    const merged = mergePersistedStates(
      state(1, [run("run-a", { roster: { G001: ["ses_a"] } })]),
      state(1, [run("run-b", { roster: { G002: ["ses_b"] } })]),
    )
    expect(merged.runs.map((entry) => entry.record.id).sort()).toEqual(["run-a", "run-b"])
    expect(merged.generation).toBe(1)
  })

  test("#given dispatches on both sides #when merged #then rosters union without duplicates", () => {
    const merged = mergePersistedStates(
      state(2, [run("run-1", { roster: { G001: ["ses_a"] } })]),
      state(1, [run("run-1", { roster: { G001: ["ses_a", "ses_b"], G002: ["ses_c"] } })]),
    )
    expect(merged.runs).toHaveLength(1)
    expect(merged.runs[0].roster).toEqual({ G001: ["ses_a", "ses_b"], G002: ["ses_c"] })
  })

  test("#given competing receipts #when merged #then the latest recording wins", () => {
    const old = {
      goalId: "G001",
      childSessionId: "ses_a",
      status: "completed" as const,
      recordedAt: new Date(1700000000000).toISOString(),
    }
    const young = { ...old, status: "failed" as const, recordedAt: new Date(1700000001000).toISOString() }
    const merged = mergePersistedStates(
      state(2, [run("run-1", { roster: { G001: ["ses_a"] }, receipts: { G001: young } })]),
      state(1, [run("run-1", { roster: { G001: ["ses_a"] }, receipts: { G001: old } })]),
    )
    expect(merged.runs[0].receipts["G001"]).toMatchObject({ status: "failed" })
  })

  test("#given terminal status on one side #when merged #then terminal truth wins over active", () => {
    const merged = mergePersistedStates(
      state(2, [run("run-1", { record: { status: "complete" as const } })]),
      state(1, [run("run-1", {})]),
    )
    expect(merged.runs[0].record.status).toBe("complete")
  })

  test("#given nothing new on either side #when merged #then nothing is invented", () => {
    const merged = mergePersistedStates(state(4, [run("run-1", {})]), state(4, [run("run-1", {})]))
    expect(merged.runs).toHaveLength(1)
    expect(merged.runs[0].roster).toEqual({})
    expect(merged.generation).toBe(4)
  })
})

describe("ulw store lock ownership", () => {
  const lockDirFor = (filePath: string) => `${filePath}.lockdir`

  test("#given a lock stolen mid-transaction #when the loser exits #then the successor lock survives", () => {
    const files = new Map<string, string>()
    const fs = fakeFs(files)
    const persistence = new FileUlwPersistence({ fs, filePath: "/ulw/store.json" })
    // A stalls inside its critical section while B breaks the stale lock:
    // B is still holding its fresh lock when A finally releases.
    expect(() =>
      persistence.transact(() => {
        fs.writeFileSync("/ulw/store.json.lockdir/holder.json", JSON.stringify({ token: "successor-live", at: Date.now() }))
        return { state: stateWithRuns(), result: null }
      }),
    ).toThrow("lock lost")
    expect(fs.dirs.has(lockDirFor("/ulw/store.json"))).toBe(true)
    expect(files.get(`${lockDirFor("/ulw/store.json")}/holder.json`)).toContain("successor-live")
    expect(files.has("/ulw/store.json")).toBe(false)
  })

  test("#given a lock the same writer still owns #when the transaction completes #then the lock is released", () => {
    const files = new Map<string, string>()
    const fs = fakeFs(files)
    new FileUlwPersistence({ fs, filePath: "/ulw/store.json" }).transact(() => stateWithRuns())
    expect(fs.dirs.has(lockDirFor("/ulw/store.json"))).toBe(false)
    expect(files.has("/ulw/store.json")).toBe(true)
  })

  test("#given the mkdir race after a stale break #when another breaker wins #then contention is reported", () => {
    const files = new Map<string, string>()
    const base = fakeFs(files)
    const lockDir = lockDirFor("/ulw/store.json")
    base.mkdirSync(lockDir)
    base.writeFileSync(`${lockDir}/holder.json`, JSON.stringify({ token: "dead", at: 1700000000000 }))
    let mkdirCalls = 0
    const racyFs = {
      ...base,
      mkdirSync: (path: string, options?: { recursive?: boolean }) => {
        if (path === lockDir && mkdirCalls++ === 1) {
          // Our break removed the dead lock; a rival breaker recreated it first.
          base.mkdirSync(path, options)
          // SAFETY: the fake only needs the errno code the lock protocol reads; no other ErrnoException field is touched.
          const error = new Error(`EEXIST: file already exists, mkdir '${path}'`) as NodeJS.ErrnoException
          error.code = "EEXIST"
          throw error
        }
        return base.mkdirSync(path, options)
      },
    }
    const persistence = new FileUlwPersistence({ fs: racyFs, filePath: "/ulw/store.json", now: () => 1700000061000 })
    expect(() => persistence.transact(() => stateWithRuns())).toThrow("locked by another writer")
  })

  test("#given successive acquires #when tokens are minted #then every token is unique", () => {
    const files = new Map<string, string>()
    const seen = new Set<string>()
    for (let i = 0; i < 25; i++) {
      const fs = fakeFs(files)
      const persistence = new FileUlwPersistence({ fs, filePath: "/ulw/store.json" })
      persistence.transact(() => {
        seen.add(files.get("/ulw/store.json.lockdir/holder.json") ?? "missing")
        return { state: stateWithRuns(), result: null }
      })
    }
    expect(seen.size).toBe(25)
  })
})
