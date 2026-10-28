import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  analyzePostEdit,
  collectChangedFiles,
  type ChangedFile,
} from "./post-edit-impact"

const REVISION = "b".repeat(40)
const OTHER_REVISION = "a".repeat(40)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "post-edit-impact-"))
  roots.push(dir)
  return dir
}

function write(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, name), content)
}

function pinRevision(dir: string, revision = REVISION): void {
  mkdirSync(join(dir, ".git", "refs", "heads"), { recursive: true })
  writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n")
  writeFileSync(join(dir, ".git", "refs", "heads", "main"), `${revision}\n`)
}

function git(dir: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "ignore" })
}

function changed(path: string, status = "M"): ChangedFile {
  return { path, status }
}

describe("post-edit impact", () => {
  test("#given a clean tree with no revision #when analyzed #then the graph is not servable and no refresh ran", async () => {
    const dir = makeDir()
    const result = await analyzePostEdit({ directory: dir })

    expect(result.changed).toEqual([])
    expect(result.envelope.status.queryServable).toBe(false)
    expect(result.refresh).toBe("unavailable")
    expect(result.invalidated).toBe(false)
    expect(result.unrelatedExpansion).toEqual([])
  })

  test("#given a real worktree with a modified file #when collected #then git status reports it", async () => {
    const dir = makeDir()
    git(dir, "init", "-q")
    git(dir, "config", "user.email", "test@example.com")
    git(dir, "config", "user.name", "test")
    write(dir, "a.ts", "export function a(): number { return 1 }\n")
    git(dir, "add", "a.ts")
    git(dir, "commit", "-qm", "add a")
    write(dir, "a.ts", "export function a(): number { return 2 }\n")

    const changedFiles = await collectChangedFiles(dir)

    expect(changedFiles).toEqual([{ path: "a.ts", status: "M" }])
  })

  test("#given porcelain renames and untracked files #when collected with a stub runner #then paths resolve to the new name", async () => {
    const dir = makeDir()
    const changedFiles = await collectChangedFiles(dir, async () => ({
      stdout: "R  old.ts -> new.ts\n?? fresh.ts\n",
    }))

    expect(changedFiles).toEqual([
      { path: "new.ts", status: "R" },
      { path: "fresh.ts", status: "??" },
    ])
  })

  test("#given a revision drift from the graph baseline #when analyzed #then the snapshot is invalidated and never presented as current", async () => {
    const dir = makeDir()
    write(dir, "math.ts", "export function add(a: number, b: number): number { return a + b }\n")
    write(dir, "main.ts", 'import { add } from "./math"\nexport function run(): number { return add(1, 2) }\n')
    pinRevision(dir, REVISION)

    const result = await analyzePostEdit({
      directory: dir,
      graphRevision: OTHER_REVISION,
      graphGeneration: "gen-9",
      files: [changed("math.ts")],
    })

    expect(result.invalidated).toBe(true)
    expect(result.refresh).not.toBe("reused")
    expect(result.refresh).toBe("refreshed")
    expect(result.envelope.status.freshness).toBe("stale")
    expect(result.envelope.status.queryServable).toBe(true)
    expect(result.envelope.unanswered).toContain("GRAPH_STALE")
    expect(result.envelope.status.reasons).toContain("revision-mismatch")
    expect(result.envelope.reasonCodes).toContain("POST_EDIT_STALE")
  }, 60_000)

  test("#given more dependents than the display limit #when one file changed #then totals stay at the engine counts", async () => {
    const dir = makeDir()
    write(dir, "hub.ts", "export function hub(): number { return 0 }\n")
    for (let index = 0; index < 25; index += 1) {
      const name = `c${String(index).padStart(2, "0")}.ts`
      write(
        dir,
        name,
        `import { hub } from "./hub"\nexport function caller${index}(): number { return hub() }\n`,
      )
    }

    const result = await analyzePostEdit({ directory: dir, files: [changed("hub.ts")] })

    expect(result.envelope.status.queryServable).toBe(true)
    // One subject: the engine walked 25 dependents but displays at most 20, so
    // known and hidden must describe the walked set, not the displayed rows.
    expect(result.envelope.totals.known).toBe(25)
    expect(result.envelope.totals.hidden).toBe(25 - result.envelope.items.length)
    expect(result.envelope.items.length).toBeLessThan(25)
    expect(result.envelope.items.length).toBe(result.envelope.totals.displayed)
  }, 60_000)

  test("#given two subjects reaching the same row #when analyzed #then the union count is unknown rather than a double count", async () => {
    const dir = makeDir()
    write(dir, "hub.ts", "export function a(): number { return 0 }\nexport function b(): number { return 1 }\n")
    write(dir, "caller.ts", 'import { a, b } from "./hub"\nexport function both(): number { return a() + b() }\n')

    const result = await analyzePostEdit({ directory: dir, files: [changed("hub.ts")] })

    // caller.ts is reachable from both a() and b(): summing the per-subject
    // knowns would count it twice while the row list shows it once, so the
    // union is reported as unknown instead of an inflated number.
    expect(result.envelope.items.filter((item) => item.id.includes("caller"))).toHaveLength(1)
    expect(result.envelope.totals.known).toBeNull()
    expect(result.envelope.totals.hidden).toBeNull()
    expect(result.envelope.totals.displayed).toBe(result.envelope.items.length)
  }, 60_000)

  test("#given direct and transitive test links #when analyzed #then single-hop tests separate from import-chain heuristics", async () => {
    const dir = makeDir()
    write(dir, "src.ts", "export function val(): number { return 1 }\n")
    write(dir, "direct.test.ts", 'import { val } from "./src"\nexport const direct = val\n')
    write(dir, "mid.ts", 'import { val } from "./src"\nexport const mid = val\n')
    write(dir, "deep.test.ts", 'import { mid } from "./mid"\nexport const deep = mid\n')

    const result = await analyzePostEdit({ directory: dir, files: [changed("src.ts")] })

    const direct = result.envelope.items.filter((item) => item.evidence.length === 1)
    const heuristic = result.envelope.items.filter((item) => item.evidence.length > 1)
    const byId = new Map(result.envelope.items.map((item) => [item.id, item] as const))
    expect(byId.has("file:direct.test.ts")).toBe(true)
    expect(byId.has("file:deep.test.ts")).toBe(true)
    // The direct test arrives on a single hop; the transitive one only
    // through the mid.ts import chain, so the two groups never mix.
    expect(direct.map((item) => item.id)).toContain("file:direct.test.ts")
    expect(heuristic.map((item) => item.id)).toContain("file:deep.test.ts")
    expect(direct.map((item) => item.id)).not.toContain("file:deep.test.ts")
    expect(heuristic.every((item) => item.evidence[0]?.edge === "IMPORTS")).toBe(true)
  }, 60_000)

  test("#given a changed file the impact walk never mentions #when analyzed #then it is listed for expansion", async () => {
    const dir = makeDir()
    write(dir, "a.ts", "export function used(): number { return 1 }\n")
    write(dir, "b.ts", 'import { used } from "./a"\nexport function run(): number { return used() }\n')
    write(dir, "lonely.ts", "export function lonely(): number { return 2 }\n")

    const result = await analyzePostEdit({ directory: dir, files: [changed("a.ts"), changed("lonely.ts")] })

    expect(result.envelope.items.map((item) => item.file)).toContain("b.ts")
    expect(result.unrelatedExpansion).toContain("lonely.ts")
  }, 60_000)

  test("#given changes on the current revision #when analyzed #then the baseline is reused and the answer is fresh", async () => {
    const dir = makeDir()
    write(dir, "a.ts", "export function used(): number { return 1 }\n")
    write(dir, "b.ts", 'import { used } from "./a"\nexport function run(): number { return used() }\n')

    const result = await analyzePostEdit({ directory: dir, files: [changed("a.ts")] })

    expect(result.invalidated).toBe(false)
    expect(result.refresh).toBe("reused")
    expect(result.envelope.status.freshness).toBe("fresh")
    expect(result.envelope.status.queryServable).toBe(true)
  }, 60_000)
})
