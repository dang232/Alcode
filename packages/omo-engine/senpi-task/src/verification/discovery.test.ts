import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { classifyCandidates } from "./approval"
import { discoverCandidates } from "./discovery"

const MARKER = "EXECUTED.txt"

type FixtureScripts = {
  test?: string
  typecheck?: string
  lint?: string
  build?: string
}

function writePackage(root: string, dir: string, name: string, scripts: FixtureScripts | undefined): void {
  if (scripts === undefined) return
  if (dir !== ".") mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, dir, "package.json"), JSON.stringify({ name, scripts }), "utf8")
}

function fixture(scripts: { root?: FixtureScripts; web?: FixtureScripts; electron?: FixtureScripts } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "alcode-disc-"))
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture-root", workspaces: ["packages/*"], scripts: scripts.root ?? {} }),
    "utf8",
  )
  writePackage(root, "packages/web", "@fx/web", scripts.web)
  writePackage(root, "packages/electron", "@fx/electron", scripts.electron)
  return root
}

const markerScript = `node -e "require('fs').writeFileSync('${MARKER}','x')"`

// Every script writes a marker, so "discovery executed something" is observable as a file on disk.
const noisy = (): FixtureScripts => ({ test: markerScript, lint: markerScript, build: markerScript })

describe("manifest discovery", () => {
  test("#given a workspace with scripts #when discovering #then candidates carry provenance and a fingerprint", () => {
    const root = fixture({ web: noisy() })
    const result = discoverCandidates({ projectRoot: root, workspaceId: "ws-1", changedFiles: ["packages/web/src/a.ts"] })
    expect(result.status).toBe("candidates")
    if (result.status !== "candidates") return
    const web = result.candidates.filter((candidate) => candidate.cwd === "packages/web")
    expect(web.length).toBe(3)
    expect(web[0]?.source).toBe("manifest")
    expect(web[0]?.location).toContain("package.json#scripts.")
    expect(web[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(web[0]?.reason).toContain("declares a")
  })

  test("#given scripts everywhere #when discovering #then nothing executes", () => {
    const root = fixture({ web: noisy() })
    discoverCandidates({ projectRoot: root, workspaceId: "ws-1", changedFiles: ["packages/web/src/a.ts"] })
    expect(existsSync(join(root, MARKER))).toBe(false)
    expect(existsSync(join(root, "packages", "web", MARKER))).toBe(false)
  })

  test("#given discovered candidates #when classified with no approval #then every one is approval_required", () => {
    const root = fixture({ web: noisy() })
    const result = discoverCandidates({ projectRoot: root, workspaceId: "ws-1", changedFiles: ["packages/web/src/a.ts"] })
    if (result.status !== "candidates") throw new Error("expected candidates")
    expect(classifyCandidates(result.candidates, []).state).toBe("approval_required")
  })

  test("#given changes only in one package #when discovering #then an unrelated package is not selected", () => {
    const root = fixture({ web: noisy(), electron: noisy() })
    const result = discoverCandidates({ projectRoot: root, workspaceId: "ws-1", changedFiles: ["packages/web/src/a.ts"] })
    if (result.status !== "candidates") throw new Error("expected candidates")
    expect(result.candidates.some((candidate) => candidate.cwd === "packages/electron")).toBe(false)
    expect(result.candidates.some((candidate) => candidate.cwd === "packages/web")).toBe(true)
  })

  test("#given a project with no package manifest #when discovering #then the ecosystem is unsupported", () => {
    const root = mkdtempSync(join(tmpdir(), "alcode-disc-empty-"))
    expect(discoverCandidates({ projectRoot: root, workspaceId: "ws-1", changedFiles: null }).status).toBe("unsupported")
  })

  test("#given a manifest with no relevant scripts #when discovering #then the result is none, not approval_required", () => {
    const root = fixture({ web: {} })
    const result = discoverCandidates({ projectRoot: root, workspaceId: "ws-1", changedFiles: ["packages/web/src/a.ts"] })
    expect(result.status).toBe("none")
  })

  test("#given attributable changes in another workspace #when discovering #then no candidate matches that approval", () => {
    const root = fixture({ web: noisy() })
    const mine = discoverCandidates({ projectRoot: root, workspaceId: "ws-1", changedFiles: ["packages/web/src/a.ts"] })
    const theirs = discoverCandidates({ projectRoot: root, workspaceId: "ws-2", changedFiles: ["packages/web/src/a.ts"] })
    if (mine.status !== "candidates" || theirs.status !== "candidates") throw new Error("expected candidates")
    expect(mine.candidates[0]?.fingerprint).not.toBe(theirs.candidates[0]?.fingerprint)
  })
})
