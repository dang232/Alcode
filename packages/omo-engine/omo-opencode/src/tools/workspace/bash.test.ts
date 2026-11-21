import { afterAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { WorkspaceToolError } from "./errors.ts"
import { BASH_TOOL_NAME, bashInvocation, createWorkspaceBashTool } from "./bash.ts"

const roots: string[] = []

function workspace(): string {
  const base = mkdtempSync(join(tmpdir(), "omo-workspace-bash-"))
  roots.push(base)
  const root = join(base, "project")
  mkdirSync(root, { recursive: true })
  return root
}

const AUTHENTICATED = { authenticated: true, sessionID: "ses_test_0001" }

const run = async (root: string, args: Record<string, unknown>, context: Record<string, unknown> = AUTHENTICATED): Promise<string> => {
  const tool = createWorkspaceBashTool({ directory: root })
  return (await tool.execute(args as never, context as never)) as string
}

const refusalOf = async (root: string, args: Record<string, unknown>): Promise<WorkspaceToolError> => {
  try {
    await run(root, args)
  } catch (error) {
    if (error instanceof WorkspaceToolError) return error
    throw error
  }
  throw new Error("expected the bash tool to refuse")
}

afterAll(async () => {
  for (const root of roots) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        rmSync(root, { recursive: true, force: true })
        break
      } catch {
        await Bun.sleep(50)
      }
    }
  }
})

const isWindows = process.platform === "win32"
const echo = isWindows ? "echo hello" : "printf 'hello\\n'"
const failing = isWindows ? "exit 3" : "exit 3"
const slow = isWindows ? "ping -n 6 127.0.0.1 > NUL" : "sleep 5"
const listing = isWindows ? "dir" : "pwd"

describe("platform invocation", () => {
  it("uses cmd.exe on Windows without a detached process", () => {
    expect(bashInvocation("win32", "echo hi")).toEqual({
      shell: "cmd.exe",
      argv: ["cmd.exe", "/d", "/s", "/c", "echo hi"],
      detached: false,
    })
  })

  it("uses /bin/bash with a detached process on Linux and macOS", () => {
    for (const platform of ["linux", "darwin"] as const) {
      expect(bashInvocation(platform, "echo hi")).toEqual({
        shell: "/bin/bash",
        argv: ["/bin/bash", "-lc", "echo hi"],
        detached: true,
      })
    }
  })
})

describe("native bash tool", () => {
  it("is advertised under the name the catalog publishes", () => {
    expect(BASH_TOOL_NAME).toBe("bash")
    expect(createWorkspaceBashTool({ directory: tmpdir() }).args.properties).toHaveProperty("command")
  })

  it("runs a real command in the workspace and reports exit 0 with its output", async () => {
    const root = workspace()
    const result = await run(root, { command: echo })
    expect(result).toContain("exit 0")
    expect(result).toContain("hello")
    expect(result).toContain(process.platform === "win32" ? "shell: cmd.exe" : "shell: /bin/bash")
  })

  it("reports a non-zero exit as a failure instead of an empty success", async () => {
    const root = workspace()
    const result = await run(root, { command: failing })
    expect(result).toContain("exit 3")
  })

  it("runs with the workspace as its working directory", async () => {
    const root = workspace()
    const result = await run(root, { command: listing })
    expect(result).toContain(root.split(/[\\/]/).pop() ?? "")
  })

  it("kills the command at its deadline and says it timed out", async () => {
    const root = workspace()
    const started = Date.now()
    const result = await run(root, { command: slow, timeoutMs: 400 })
    const elapsed = Date.now() - started
    expect(result).toContain("timed out after 400ms")
    expect(elapsed).toBeLessThan(10000)
  })

  it("fails closed when the host supplied no authenticated caller", async () => {
    const root = workspace()
    const error = await (async () => {
      try {
        await run(root, { command: echo }, { authenticated: false, sessionID: "" })
      } catch (caught) {
        if (caught instanceof WorkspaceToolError) return caught
        throw caught
      }
      throw new Error("expected an unauthenticated refusal")
    })()
    expect(error.code).toBe("UNAUTHENTICATED")
  })

  it("does not start the command when the host approval is denied", async () => {
    const root = workspace()
    let started = false
    const error = await (async () => {
      try {
        await run(root, { command: echo }, {
          authenticated: true,
          sessionID: "ses_host_0001",
          ask: async () => {
            started = true
            throw new Error("denied by policy")
          },
        })
      } catch (caught) {
        if (caught instanceof WorkspaceToolError) return caught
        throw caught
      }
      throw new Error("expected an approval refusal")
    })()
    expect(error.code).toBe("APPROVAL_DENIED")
    expect(started).toBe(true)
  })

  it("records that the host granted approval when the surface allows it", async () => {
    const root = workspace()
    const result = await run(root, { command: echo }, { authenticated: true, sessionID: "ses_host_0001", ask: async () => {} })
    expect(result).toContain("approval: granted by host")
    expect(result).toContain("hello")
  })

  it("refuses a cwd that leaves the workspace", async () => {
    const root = workspace()
    expect((await refusalOf(root, { command: echo, cwd: "../.." })).code).toBe("PATH_OUTSIDE_WORKSPACE")
  })

  it("refuses an empty command and an out-of-range deadline", async () => {
    const root = workspace()
    expect((await refusalOf(root, { command: "  " })).code).toBe("INVALID_INPUT")
    expect((await refusalOf(root, { command: echo, timeoutMs: 600_001 })).code).toBe("INVALID_INPUT")
  })
})

describe("per-invocation workspace", () => {
  it("runs in the caller's directory instead of the load-time one", async () => {
    workspace()
    const base = mkdtempSync(join(tmpdir(), "omo-workspace-bash-caller-"))
    roots.push(base)
    const caller = join(base, "caller-workspace")
    mkdirSync(caller, { recursive: true })
    const tool = createWorkspaceBashTool({ directory: join(base, "load-time-workspace") })
    mkdirSync(join(base, "load-time-workspace"), { recursive: true })
    const result = (await tool.execute({ command: listing } as never, { authenticated: true, sessionID: "ses_caller_0001", directory: caller } as never)) as string
    expect(result).toContain("caller-workspace")
  })
})
