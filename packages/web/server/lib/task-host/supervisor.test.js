import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

import { createTaskHostSupervisor, defaultProbe, engineCandidates, engineDependencyClosure, launchOf, openRootSession, releaseDaemonState, resolvePluginDir, retainedRootSessionCount, seedAgentDir } from "./supervisor"

const roots = []

function dirs() {
  const root = mkdtempSync(join(tmpdir(), "task-host-supervisor-"))
  roots.push(root)
  return { pluginDir: join(root, "plugin"), stateDir: join(root, "state"), projectDir: join(root, "project") }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("engineDependencyClosure", () => {
  const writeEngine = (root, dependencies, present) => {
    const engineDir = join(root, "engine")
    mkdirSync(join(engineDir, "dist", "bundle"), { recursive: true })
    writeFileSync(join(engineDir, "package.json"), JSON.stringify({ name: "engine", version: "1.0.0", dependencies }))
    for (const name of present) {
      mkdirSync(join(engineDir, "node_modules", name), { recursive: true })
      writeFileSync(join(engineDir, "node_modules", name, "package.json"), JSON.stringify({ name, version: "1.0.0" }))
    }
    return join(engineDir, "dist", "bundle", "cli.js")
  }

  it("reports a bundle-only stage as having none of its closure", () => {
    const root = mkdtempSync(join(tmpdir(), "engine-deps-"))
    roots.push(root)
    const script = writeEngine(root, { "@earendil-works/chord": "1.0.0", typebox: "1.0.0" }, [])
    const closure = engineDependencyClosure(script)
    expect(closure.declared).toBe(2)
    expect(closure.missing).toEqual(["@earendil-works/chord", "typebox"])
  })

  it("reports a partial closure without claiming it is empty", () => {
    const root = mkdtempSync(join(tmpdir(), "engine-deps-"))
    roots.push(root)
    const script = writeEngine(root, { "@earendil-works/chord": "1.0.0", typebox: "1.0.0" }, ["@earendil-works/chord"])
    const closure = engineDependencyClosure(script)
    expect(closure.declared).toBe(2)
    expect(closure.missing).toEqual(["typebox"])
  })

  it("drops a script candidate whose whole closure is missing, whatever shape it arrives in", () => {
    const candidates = engineCandidates({
      env: { ALCODE_TASK_HOST_SENPI: "C:/app/engine/dist/bundle/cli.js" },
      exists: () => true,
      probe: () => ({ declared: 33, missing: new Array(33).fill("x") }),
    })
    expect(candidates).not.toContain("C:/app/engine/dist/bundle/cli.js")
  })

  it("keeps a candidate that resolves most of its closure, because optional gaps still run", () => {
    const candidates = engineCandidates({
      env: { ALCODE_TASK_HOST_SENPI: "C:/app/Alcode.exe|C:/app/engine/cli.js" },
      exists: () => true,
      probe: () => ({ declared: 34, missing: ["@earendil-works/pi-ai"] }),
    })
    expect(candidates).toContainEqual(["C:/app/Alcode.exe", "C:/app/engine/cli.js"])
  })
})

describe("launchOf", () => {
  it("starts a staged engine with the runtime and the script only", () => {
    const argv = launchOf("C:/app/resources/senpi-engine/dist/bundle/cli.js", "C:/app/Alcode.exe")
    expect(argv).toEqual(["C:/app/Alcode.exe", "C:/app/resources/senpi-engine/dist/bundle/cli.js"])
  })

  it("passes no runtime flag: Electron answers `bad option: --js-flags` and exits 9 before Node starts", () => {
    const argv = launchOf("C:/app/resources/senpi-engine/dist/bundle/cli.js", "C:/app/Alcode.exe")
    expect(argv.some((part) => part.startsWith("--js-flags"))).toBe(false)
  })

  it("keeps an explicit multi-part command verbatim", () => {
    expect(launchOf(["bun", "C:/x/cli.js"])).toEqual(["bun", "C:/x/cli.js"])
  })
})

function supervisor(overrides = {}) {
  const { pluginDir, stateDir, projectDir } = dirs()
  mkdirSync(join(pluginDir, "extensions"), { recursive: true })
  writeFileSync(join(pluginDir, "extensions", "omo.js"), "", "utf8")
  const calls = []
  const probed = []
  const logs = []
  const instance = createTaskHostSupervisor({
    openSession: async () => 'ses_test_host',
    senpiBin: "senpi",
    pluginDir,
    stateDir,
    resolveProjectDir: () => projectDir,
    resolveModel: () => "local-8317/al-1.4",
    run: async (argv) => {
      calls.push(argv)
      if (argv[2] === "session") return { code: 0, stdout: JSON.stringify({ action: "open", sessionId: "rpc-1" }) }
      if (argv[2] === "ensure") return { code: 0, stdout: JSON.stringify({ action: "start", pid: 1234 }) }
      return { code: 0, stdout: "{}" }
    },
    warm: async () => true,
    waitForSecret: async () => true,
    probe: async (url) => {
      probed.push(url)
      return true
    },
    logger: { info: (m) => logs.push(["info", m]), warn: (m) => logs.push(["warn", m]) },
    ...overrides,
  })
  return { instance, calls, logs, probed, pluginDir, stateDir, projectDir }
}

describe("task host supervisor", () => {
  it("reports ready only after the capability listener answers, and exposes its url then", async () => {
    const { instance } = supervisor()
    expect(instance.url()).toBeUndefined()

    const snapshot = await instance.ensure()

    expect(snapshot.state).toBe("ready")
    expect(instance.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it("starts the host through the engine supervisor and never drives a subcommand the engine lacks", async () => {
    const { instance, calls, probed } = supervisor()

    await instance.ensure()

    expect(calls[0].slice(1, 3)).toEqual(["host", "ensure"])
    // Neither engine exposes `host session open`; issuing it made readiness fail with "unknown host command".
    expect(calls.some((call) => call.includes("session"))).toBe(false)
    expect(probed.some((url) => url.endsWith("/capability/health"))).toBe(true)
  })

  it("never puts the generated token in a log line or a snapshot", async () => {
    const { instance, logs, stateDir } = supervisor()

    const snapshot = await instance.ensure()

    const spec = JSON.parse(readFileSync(join(stateDir, "alcode-task-host.spec.json"), "utf8"))
    const token = spec.env.OMO_CAPABILITY_TOKEN
    expect(token.length).toBeGreaterThan(30)
    expect(JSON.stringify(snapshot)).not.toContain(token)
    expect(JSON.stringify(logs)).not.toContain(token)
  })

  it("fails closed when the listener never becomes ready", async () => {
    const { instance } = supervisor({ probe: async () => false, healthTimeoutMs: 1 })

    const snapshot = await instance.ensure()

    expect(snapshot.state).toBe("failed")
    expect(snapshot.failure).toMatch(/never became ready/)
    expect(instance.url()).toBeUndefined()
  })

  it("refuses to start for a host with no project directory", async () => {
    const { instance } = supervisor({ resolveProjectDir: () => "" })

    const snapshot = await instance.ensure()

    expect(snapshot.state).toBe("failed")
    expect(snapshot.failure).toBe("no active project directory")
  })

  it("shares one launch between concurrent ensure calls", async () => {
    const { instance, calls } = supervisor()

    await Promise.all([instance.ensure(), instance.ensure(), instance.ensure()])

    expect(calls.filter((argv) => argv[2] === "ensure")).toHaveLength(1)
  })

  it("stops the host through the engine and removes its launch spec", async () => {
    const { instance, calls, pluginDir } = supervisor()
    await instance.ensure()

    const snapshot = await instance.stop()

    expect(snapshot.state).toBe("stopped")
    expect(instance.url()).toBeUndefined()
    expect(calls.at(-1).slice(1, 3)).toEqual(["host", "stop"])
    expect(existsSync(join(pluginDir, "alcode-task-host.spec.json"))).toBe(false)
  })

  it("stops relaunching after the restart budget is spent", async () => {
    const { instance, calls } = supervisor({ probe: async () => false, healthTimeoutMs: 1, maxRestarts: 1 })

    await instance.ensure()
    await instance.ensure()
    const snapshot = await instance.ensure()

    expect(snapshot.state).toBe("failed")
    expect(snapshot.failure).toBe("task host restart budget exhausted")
    expect(calls.filter((argv) => argv[2] === "ensure")).toHaveLength(2)
  })

  it("reports a lost listener as degraded rather than ready", async () => {
    let reachable = true
    const { instance } = supervisor({ probe: async () => reachable })
    await instance.ensure()

    reachable = false
    const snapshot = await instance.status()

    expect(snapshot.state).toBe("degraded")
    expect(instance.url()).toBeUndefined()
  })
})

describe("workspace scoping", () => {
  it("refuses a second project instead of reusing the host it already started", async () => {
    const { instance, calls, projectDir } = supervisor()
    await instance.ensure(projectDir)
    const before = calls.length

    const refused = await instance.ensure(join(projectDir, "..", "other-project"))

    expect(refused.state).toBe("unavailable")
    expect(refused.failure).toBe("foreign-project")
    expect(calls.length).toBe(before)
    expect(instance.projectDir()).toBe(projectDir)
  })

  it("reports the scoped project while ready and forgets it after stop", async () => {
    const { instance, projectDir } = supervisor()
    await instance.ensure(projectDir)
    expect(instance.projectDir()).toBe(projectDir)

    await instance.stop()

    expect(instance.projectDir()).toBeUndefined()
  })
})

describe("plugin entry check", () => {
  it("refuses to launch when the installed plugin has no extension entry", async () => {
    const { pluginDir, stateDir, projectDir } = dirs()
    mkdirSync(pluginDir, { recursive: true })
    const calls = []
    const instance = createTaskHostSupervisor({
    openSession: async () => 'ses_test_host',
    senpiBin: "senpi",
      pluginDir,
      stateDir,
      resolveProjectDir: () => projectDir,
      resolveModel: () => "local-8317/al-1.4",
      run: async (argv) => {
        calls.push(argv)
        return { code: 0, stdout: "{}" }
      },
      probe: async () => true,
      logger: { info: () => {}, warn: () => {} },
    })

    const snapshot = await instance.ensure()

    expect(snapshot.state).toBe("failed")
    expect(snapshot.failure).toMatch(/task host plugin not found/)
    expect(calls).toHaveLength(0)
  })
})

describe("token and model exposure", () => {
  it("hands the gateway its token only while serving, and never before a launch", async () => {
    const { instance } = supervisor()
    expect(instance.token()).toBeUndefined()

    await instance.ensure()
    expect(instance.token()).toMatch(/^[A-Za-z0-9_-]{40,}$/)

    await instance.stop()
    expect(instance.token()).toBeUndefined()
  })

  it("lets the host use its own default when the caller declares no model", async () => {
    const { instance, stateDir } = supervisor({ resolveModel: undefined })

    await instance.ensure()

    const spec = JSON.parse(readFileSync(join(stateDir, "alcode-task-host.spec.json"), "utf8"))
    expect(JSON.stringify(spec)).not.toContain("--model")
  })
})

describe("stale host state", () => {
  const setup = (run) => {
    const { pluginDir, stateDir, projectDir } = dirs()
    mkdirSync(join(pluginDir, "extensions"), { recursive: true })
    writeFileSync(join(pluginDir, "extensions", "omo.js"), "", "utf8")
    const logs = []
    const calls = []
    const instance = createTaskHostSupervisor({
    openSession: async () => 'ses_test_host',
    senpiBin: "senpi",
      pluginDir,
      stateDir,
      resolveProjectDir: () => projectDir,
      run: async (argv) => {
        calls.push(argv.slice(1).join(" "))
        return run(argv, calls.length)
      },
      warm: async () => true,
      waitForSecret: async () => true,
      probe: async () => true,
      logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
    })
    return { instance, logs, calls }
  }

  it("clears a reused generation and launches again", async () => {
    const { instance, calls, logs } = setup((argv, n) => {
      const command = argv.slice(2, 3).join("")
      if (command === "stop") return { code: 0, stdout: JSON.stringify({ action: "stopped", pid: 0 }) }
      return n === 1
        ? { code: 0, stdout: JSON.stringify({ action: "reuse", pid: 0 }) }
        : { code: 0, stdout: JSON.stringify({ action: "start", pid: 4242 }) }
    })

    await instance.ensure()

    expect(calls.some((c) => c.includes("stop"))).toBe(true)
    expect(logs.join("\n")).toMatch(/releasing an existing host generation \(reuse pid 0\)/)
  })

  it("fails when the engine keeps reusing a host this gateway cannot serve", async () => {
    const { instance } = setup(() => ({ code: 0, stdout: JSON.stringify({ action: "reuse", pid: 0 }) }))

    const snapshot = await instance.ensure()

    expect(snapshot.state).toBe("failed")
    expect(snapshot.failure).toMatch(/kept reusing a host this gateway cannot serve/)
  })
})

describe("extension graph", () => {
  it("warms the host before probing readiness", async () => {
    const order = []
    const { instance } = supervisor({
      warm: async () => { order.push("warm"); return true },
      probe: async () => { order.push("probe"); return true },
    })

    const snapshot = await instance.ensure()

    expect(snapshot.state).toBe("ready")
    expect(order[0]).toBe("warm")
    expect(order).toContain("probe")
  })
})

describe("plugin dir resolution", () => {
  it("prefers an explicit env value", () => {
    expect(resolvePluginDir({ env: { ALCODE_TASK_HOST_PLUGIN_DIR: "C:/plugins/host" }, exists: () => false })).toBe("C:/plugins/host")
  })

  it("probes the sibling checkout and resolves the real plugin path", () => {
    // A real directory tree at the real depth, not a stub: the sibling lookup walks six levels up from this
    // module, and a suffix-matching stub hid a wrong depth before. Built under the temp dir so the oracle is
    // the filesystem on any host, instead of whatever absolute path the machine that wrote the test had.
    const root = mkdtempSync(join(tmpdir(), "task-host-sibling-"))
    roots.push(root)
    const repo = join(root, "Alwork")
    const plugin = join(root, "oh-my-openAlcore", "packages", "omo-senpi", "plugin")
    mkdirSync(join(repo, "packages", "web", "server", "lib", "task-host"), { recursive: true })
    mkdirSync(join(plugin, "extensions"), { recursive: true })
    writeFileSync(join(plugin, "extensions", "omo.js"), "", "utf8")

    const resolved = resolvePluginDir({
      env: {},
      moduleUrl: pathToFileURL(join(repo, "packages", "web", "server", "lib", "task-host", "supervisor.js")).href,
    })

    expect(resolved.replace(/\\/g, "/")).toBe(plugin.replace(/\\/g, "/"))
    expect(existsSync(join(resolved, "extensions", "omo.js"))).toBe(true)
  })

  it("prefers a packaged resource over the staged tree and the sibling checkout", () => {
    const seen = []
    const exists = (target) => {
      const flat = String(target).replace(/\\/g, "/")
      seen.push(flat)
      return flat.endsWith("senpi-plugin/extensions/omo.js")
    }
    const resolved = resolvePluginDir({ env: { ALCODE_RESOURCES_PATH: "C:/app/resources" }, exists, moduleUrl: new URL("./supervisor.js", import.meta.url).href })
    expect(resolved.replace(/\\/g, "/")).toBe("C:/app/resources/senpi-plugin")
  })

  it("falls back to the staged tree when nothing is packaged", () => {
    const exists = (target) => String(target).replace(/\\/g, "/").endsWith("dist/senpi-plugin/extensions/omo.js")
    const resolved = resolvePluginDir({ env: {}, exists, moduleUrl: new URL("./supervisor.js", import.meta.url).href })
    expect(resolved.replace(/\\/g, "/")).toContain("packages/web/dist/senpi-plugin")
  })

  it("stays empty when there is no plugin, so the feature is off rather than misconfigured", () => {
    expect(resolvePluginDir({ env: {}, exists: () => false, moduleUrl: "file:///I:/migration/Alwork/packages/web/server/lib/task-host/supervisor.js" })).toBe("")
  })
})

describe("agent dir seeding", () => {
  it("carries the provider pairing across without copying unrelated user settings", () => {
    const base = mkdtempSync(join(tmpdir(), "task-host-seed-"))
    roots.push(base)
    const source = join(base, "home", ".omo", "agent")
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, "settings.json"), JSON.stringify({ theme: "dark", hideThinkingBlock: true, defaultProvider: "local-8317", defaultModel: "al-1.4", enabledModels: ["local-8317/al-1.4"] }))
    writeFileSync(join(source, "auth.json"), JSON.stringify({ "local-8317": { type: "api_key", key: "sk-test" } }))
    writeFileSync(join(source, "models.json"), JSON.stringify({ providers: { "local-8317": { models: [{ id: "al-1.4" }] } } }))
    const agentDir = join(base, "state", "agent")

    const result = seedAgentDir({ agentDir, pluginDir: "C:/plugin", userProfile: join(base, "home") })
    const written = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))

    expect(result.provider).toBe("local-8317")
    expect(result.model).toBe("al-1.4")
    expect(result.authCopied).toBe(true)
    expect(written.packages).toEqual(["C:/plugin"])
    expect(written.defaultProvider).toBe("local-8317")
    expect(written.theme).toBeUndefined()
    expect(result.copied).toEqual(["auth.json", "models.json"])
    expect(written.hideThinkingBlock).toBeUndefined()
  })

  it("still registers the plugin when the user has no agent dir", () => {
    const base = mkdtempSync(join(tmpdir(), "task-host-seed-none-"))
    roots.push(base)
    const agentDir = join(base, "state", "agent")
    const result = seedAgentDir({ agentDir, pluginDir: "C:/plugin", userProfile: join(base, "empty") })
    const written = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))
    expect(written.packages).toEqual(["C:/plugin"])
    expect(result.provider).toBe(null)
    expect(result.authCopied).toBe(false)
  })
})

describe("root session binding", () => {
  it("returns the durable id the host wrote, not the connection handle", async () => {
    const base = mkdtempSync(join(tmpdir(), "task-host-session-"))
    roots.push(base)
    const socket = join(base, "h.sock")
    writeFileSync(socket + ".secret", "x".repeat(32))
    const sessionPath = join(base, "host-session.jsonl")
    const connection = {
      handlers: {},
      setEncoding() {},
      on() {},
      once(event, cb) { this.handlers[event] = cb; if (event === "connect") setTimeout(() => cb(), 0); return this },
      write(payload) {
        if (String(payload).includes("open_session")) writeFileSync(sessionPath, JSON.stringify({ type: "session", id: "01a1db05-host" }) + "\n")
      },
      destroy() {},
    }
    const id = await openRootSession({ socket, sessionPath, cwd: base, connect: () => connection, timeoutMs: 2000 })
    expect(id).toBe("01a1db05-host")
  })

  it("keeps the root session connection referenced after it opens", async () => {
    const base = mkdtempSync(join(tmpdir(), "task-host-session-retain-"))
    roots.push(base)
    const socket = join(base, "h.sock")
    writeFileSync(socket + ".secret", "x".repeat(32))
    const sessionPath = join(base, "host-session.jsonl")
    const before = retainedRootSessionCount()
    const connection = {
      setEncoding() {},
      on() {},
      once(event, cb) { if (event === "connect") setTimeout(() => cb(), 0); return this },
      write(payload) {
        if (String(payload).includes("open_session")) writeFileSync(sessionPath, JSON.stringify({ type: "session", id: "01a1dcde-retained" }) + "\n")
      },
      destroy() {},
    }
    await openRootSession({ socket, sessionPath, cwd: base, connect: () => connection, timeoutMs: 2000 })
    // An unreferenced socket is collectable: the host then loses its last client and its loopback listener dies, which
    // surfaces later as "the task host is unreachable: fetch failed".
    expect(retainedRootSessionCount()).toBe(before + 1)
  })

  it("answers undefined when the host never writes a session", async () => {
    const base = mkdtempSync(join(tmpdir(), "task-host-session-none-"))
    roots.push(base)
    const socket = join(base, "h.sock")
    writeFileSync(socket + ".secret", "x".repeat(32))
    const connection = { setEncoding() {}, on() {}, once() { return this }, write() {}, destroy() {} }
    const id = await openRootSession({ socket, sessionPath: join(base, "never.jsonl"), cwd: base, connect: () => connection, timeoutMs: 300 })
    expect(id).toBeUndefined()
  })
})

describe("stale reuse recovery", () => {
  it("relaunches once when a reused host never becomes ready", async () => {
    const commands = []
    let probes = 0
    const sup = createTaskHostSupervisor({
      openSession: async () => "ses_host",
      pluginDir: "C:/plugin",
      stateDir: mkdtempSync(join(tmpdir(), "task-host-reuse-")),
      senpiBin: "senpi",
      logger: { info: () => {}, warn: () => {} },
      exists: () => true,
      resolveProjectDir: async () => "I:/migration/Alwork",
      // first ensure reports a reuse of a dead host, the relaunch reports a start
      run: async (argv) => {
        commands.push(argv.join(" "))
        const isEnsure = argv.includes("ensure")
        const isStop = argv.includes("stop")
        if (isStop) return { code: 0, stdout: "{}" }
        const started = commands.filter((c) => c.includes("ensure")).length
        return { code: 0, stdout: JSON.stringify(isEnsure && started === 1 ? { action: "reuse", pid: 111 } : { action: "start", pid: 222 }) }
      },
      // dead on the first prepare, healthy after the relaunch
      probe: async () => { probes += 1; return probes > 2 },
      warm: async () => true,
      waitForSecret: async () => {},
      healthTimeoutMs: 400,
      startTimeoutMs: 400,
    })
    const snapshot = await sup.ensure()
    expect(snapshot.state).toBe("ready")
    expect(commands.some((c) => c.includes("stop"))).toBe(true)
    expect(commands.filter((c) => c.includes("ensure")).length).toBeGreaterThanOrEqual(2)
    // the relaunch must not reuse the socket of a host that refused to stop
    expect(commands[commands.length - 1]).not.toBe(commands[0])
  })
})

describe("liveness recovery", () => {
  const liveSupervisor = (overrides) => {
    const commands = []
    let listen = true
    const sup = createTaskHostSupervisor({
      openSession: async () => "ses_live",
      pluginDir: "C:/plugin",
      stateDir: mkdtempSync(join(tmpdir(), "task-host-live-")),
      senpiBin: "senpi",
      logger: { info: () => {}, warn: () => {} },
      exists: () => true,
      resolveProjectDir: async () => "I:/migration/Alwork",
      run: async (argv) => {
        commands.push(argv.join(" "))
        if (argv.includes("stop")) return { code: 0, stdout: "{}" }
        // Once the relaunched host is up it listens again; the revived listener is what the recovery must prove.
        if (commands.filter((c) => c.includes("ensure")).length >= 2) listen = true
        return { code: 0, stdout: JSON.stringify({ action: "start", pid: 333 }) }
      },
      probe: async () => listen,
      warm: async () => true,
      waitForSecret: async () => {},
      healthTimeoutMs: 400,
      startTimeoutMs: 400,
      ...overrides,
    })
    return { sup, commands, die: () => { listen = false } }
  }

  it("relaunches when the listener stops answering while ready", async () => {
    const { sup, commands, die } = liveSupervisor()
    expect((await sup.ensure()).state).toBe("ready")
    const firstUrl = sup.url()
    die()
    // Without this the gateway keeps a dead URL for the rest of the session and every task reads "fetch failed".
    expect(await sup.ensureLive()).toBe(true)
    expect(sup.state()).toBe("ready")
    expect(sup.url()).not.toBe(firstUrl)
    expect(commands.filter((c) => c.includes("ensure")).length).toBeGreaterThanOrEqual(2)
  })

  it("answers quickly instead of holding the caller through the relaunch", async () => {
    const slow = async (argv) => {
      await new Promise((resolve) => setTimeout(resolve, 250))
      return { code: 0, stdout: JSON.stringify(argv.includes("stop") ? {} : { action: "start", pid: 333 }) }
    }
    const { sup, die } = liveSupervisor({ recoveryWaitMs: 50, run: slow })
    expect((await sup.ensure()).state).toBe("ready")
    die()
    // The caller is a plugin with its own timeout; a slow relaunch must surface as a retryable refusal, not a hang.
    const started = Date.now()
    expect(await sup.ensureLive()).toBe(false)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it("heals a listener that dies between tasks, without a caller asking", async () => {
    const slow = async (argv) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { code: 0, stdout: JSON.stringify(argv.includes("stop") ? {} : { action: "start", pid: 333 }) }
    }
    const { sup, die } = liveSupervisor({ run: slow, watchdogMs: 30 })
    expect((await sup.ensure()).state).toBe("ready")
    die()
    // The host's listener dies while nothing is delegating; the watchdog is what notices, so the next task is not the
    // one that discovers it.
    const deadline = Date.now() + 5000
    while (sup.state() !== "ready" && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sup.state()).toBe("ready")
    expect(sup.url()).toBeDefined()
    await sup.stop()
  })

  it("stops spending the full health budget on a host it already knows is dead", async () => {
    const commands = []
    let probes = 0
    const slowlyDead = createTaskHostSupervisor({
      openSession: async () => "ses_dead",
      pluginDir: "C:/plugin",
      stateDir: mkdtempSync(join(tmpdir(), "task-host-budget-")),
      senpiBin: "senpi",
      logger: { info: () => {}, warn: () => {} },
      exists: () => true,
      resolveProjectDir: async () => "I:/migration/Alwork",
      run: async (argv) => {
        commands.push(argv.join(" "))
        return { code: 0, stdout: JSON.stringify(argv.includes("stop") ? {} : { action: "start", pid: 7 }) }
      },
      // Never healthy: with a 10 s budget the measured case spent 29 s of a 38 s recovery here.
      probe: async () => { probes += 1; return false },
      warm: async () => true,
      waitForSecret: async () => {},
      healthTimeoutMs: 1_500,
      startTimeoutMs: 300,
      maxRestarts: 1,
    })
    const started = Date.now()
    await slowlyDead.ensure()
    const elapsed = Date.now() - started
    // Two prepares at most (initial + one escalation), each capped at 5 s, so the caller keeps its time.
    expect(elapsed).toBeLessThan(8_000)
    expect(probes).toBeGreaterThan(1)
  }, 20_000)

  it("stops trying once the restart budget is spent", async () => {
    const { sup, die } = liveSupervisor({ maxRestarts: 0 })
    expect((await sup.ensure()).state).toBe("ready")
    die()
    expect(await sup.ensureLive()).toBe(false)
    expect(sup.state()).toBe("failed")
  })
})

describe("fresh session per launch", () => {
  it("does not reuse the session id a previous host wrote", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "task-host-fresh-"))
    const sessionDir = join(stateDir, "session")
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, "host-session.jsonl"), JSON.stringify({ type: "session", id: "ses_old_host" }) + "\n")
    const opened = []
    const sup = createTaskHostSupervisor({
      openSession: async ({ sessionPath }) => {
        expect(existsSync(sessionPath)).toBe(false)
        writeFileSync(sessionPath, JSON.stringify({ type: "session", id: "ses_new_host" }) + "\n")
        opened.push("ses_new_host")
        return "ses_new_host"
      },
      pluginDir: "C:/plugin",
      stateDir,
      senpiBin: "senpi",
      logger: { info: () => {}, warn: () => {} },
      exists: () => true,
      resolveProjectDir: async () => "I:/migration/Alwork",
      run: async () => ({ code: 0, stdout: JSON.stringify({ action: "start", pid: 1 }) }),
      probe: async () => true,
      warm: async () => true,
      waitForSecret: async () => {},
    })
    const snapshot = await sup.ensure()
    expect(snapshot.state).toBe("ready")
    expect(snapshot.sessionId).toBe("ses_new_host")
    expect(opened).toHaveLength(1)
  })
})

describe("regressions that cost hours", () => {
  it("passes the host's own agent dir to every engine command", async () => {
    const envs = []
    const stateDir = mkdtempSync(join(tmpdir(), "task-host-env-"))
    const sup = createTaskHostSupervisor({
      openSession: async () => "ses_host",
      pluginDir: "C:/plugin",
      stateDir,
      senpiBin: "engineA",
      engines: ["engineA"],
      logger: { info: () => {}, warn: () => {} },
      exists: () => true,
      resolveProjectDir: async () => "I:/migration/Alwork",
      run: async (argv, env) => { envs.push(env); return { code: 0, stdout: JSON.stringify({ action: "start", pid: 9 }) } },
      probe: async () => true,
      warm: async () => true,
      waitForSecret: async () => {},
    })
    await sup.ensure()
    // A shadowed variable once made this undefined, and the host then loaded another installation's plugin.
    expect(envs.length).toBeGreaterThan(0)
    for (const env of envs) expect(env?.SENPI_CODING_AGENT_DIR).toBe(join(stateDir, "agent"))
  })

  it("escalates to the next engine when the first never binds its listener", async () => {
    const used = []
    let probes = 0
    const sup = createTaskHostSupervisor({
      openSession: async () => "ses_host",
      pluginDir: "C:/plugin",
      stateDir: mkdtempSync(join(tmpdir(), "task-host-engine-")),
      senpiBin: "engineA",
      engines: ["engineA", "engineB"],
      logger: { info: () => {}, warn: () => {} },
      exists: () => true,
      resolveProjectDir: async () => "I:/migration/Alwork",
      run: async (argv) => {
        used.push(String(argv[0]))
        return { code: 0, stdout: JSON.stringify({ action: "start", pid: 7 }) }
      },
      // only the second engine's host ever answers
      probe: async () => { probes += 1; return used.includes("engineB") && probes > 1 },
      warm: async () => true,
      waitForSecret: async () => {},
      healthTimeoutMs: 300,
      startTimeoutMs: 300,
      maxRestarts: 3,
    })
    const snapshot = await sup.ensure()
    expect(snapshot.state).toBe("ready")
    expect(used).toContain("engineA")
    expect(used).toContain("engineB")
  })
})

describe("engine preference", () => {
  it("prefers the global omo-ai CLI over a checkout shim", () => {
    const cli = "C:/Users/x/AppData/Roaming/npm/node_modules/omo-ai/node_modules/@code-yeongyu/senpi/dist/bundle/cli.js"
    const candidates = engineCandidates({
      env: {},
      appdata: "C:/Users/x/AppData/Roaming",
      exists: (target) => String(target).replace(/\\/g, "/") === cli,
    })
    const flat = candidates.map((candidate) => (Array.isArray(candidate) ? candidate[1] : candidate).replace(/\\/g, "/"))
    // A host started by the old shim mounts and then answers children with empty completions.
    expect(flat[0]).toBe(cli.replace(/\\/g, "/"))
  })

  it("honours an explicit engine above everything else", () => {
    const candidates = engineCandidates({ env: { ALCODE_TASK_HOST_SENPI: "bun|C:/explicit/cli.js" }, exists: () => true })
    expect(candidates[0]).toEqual(["bun", "C:/explicit/cli.js"])
  })
})

describe("readiness probe", () => {
  it("probes a live listener and refuses a dead port", async () => {
    const { createServer } = await import("node:http")
    const server = createServer((_request, response) => response.writeHead(200).end("ok"))
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    const live = `http://127.0.0.1:${server.address().port}/capability/health`
    try {
      expect(await defaultProbe(live)).toBe(true)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
    // The port is closed now: a probe must answer false, never throw, because every readiness check depends on it.
    expect(await defaultProbe(live, 500)).toBe(false)
  })
})

describe("host default model", () => {
  const withAgentSettings = (settings) => {
    const { pluginDir, stateDir, projectDir } = dirs()
    mkdirSync(join(stateDir, "agent"), { recursive: true })
    if (settings !== undefined) writeFileSync(join(stateDir, "agent", "settings.json"), JSON.stringify(settings), "utf8")
    return createTaskHostSupervisor({
      openSession: async () => "ses_model",
      senpiBin: "senpi",
      pluginDir,
      stateDir,
      userProfile: "",
      resolveProjectDir: () => projectDir,
      logger: { info: () => {}, warn: () => {} },
    })
  }

  it("reports the model the host session runs with", () => {
    // A gateway task that names no target is refused unless the gateway supplies exactly this value.
    expect(withAgentSettings({ defaultProvider: "local-8317", defaultModel: "al-1.4" }).defaultModel()).toBe("local-8317/al-1.4")
  })

  it("keeps a fully qualified model untouched", () => {
    expect(withAgentSettings({ defaultProvider: "ignored", defaultModel: "openai/gpt-5.5" }).defaultModel()).toBe("openai/gpt-5.5")
  })

  it("reports nothing when the host has no configured model", () => {
    expect(withAgentSettings(undefined).defaultModel()).toBeUndefined()
  })
})

describe("launch spec", () => {
  const launchSpecFor = async (overrides = {}) => {
    const { pluginDir, stateDir, projectDir } = dirs()
    mkdirSync(join(pluginDir, "extensions"), { recursive: true })
    writeFileSync(join(pluginDir, "extensions", "omo.js"), "", "utf8")
    const written = []
    const sup = createTaskHostSupervisor({
      openSession: async () => "ses_spec",
      senpiBin: "senpi",
      pluginDir,
      stateDir,
      resolveProjectDir: () => projectDir,
      logger: { info: () => {}, warn: () => {} },
      exists: () => true,
      run: async (argv) => {
        const index = argv.indexOf("--launch-spec")
        if (index >= 0) written.push(JSON.parse(readFileSync(argv[index + 1], "utf8")))
        return { code: 0, stdout: JSON.stringify({ action: "start", pid: 1 }) }
      },
      probe: async () => true,
      warm: async () => true,
      waitForSecret: async () => {},
      ...overrides,
    })
    await sup.ensure()
    return written[0]
  }

  it("writes a launch spec the engine's schema accepts", async () => {
    const spec = await launchSpecFor()
    // The engine's schema is strict: a spec missing idleExitMs is rejected and the host silently runs a transient
    // default, exiting while idle (~45 s) and taking its capability listener with it.
    expect(spec.spec_version).toBe(1)
    expect(spec.tunables.coldStart).toBe("persistent")
    expect(Number.isInteger(spec.tunables.idleExitMs)).toBe(true)
    expect(spec.tunables.idleExitMs).toBeGreaterThan(60_000)
    expect(spec.core.session_runtime).toBe("in-process")
    expect(spec.core.multi_session).toBe(true)
    // No allowlist configured means no host policy, not an empty one.
    expect(spec.env.OMO_CAPABILITY_AGENTS).toBeUndefined()
  })

  it("publishes the same comma-joined allowlist the gateway uses into the launch spec", async () => {
    expect((await launchSpecFor({ allowedAgents: ["explore", "librarian"] })).env.OMO_CAPABILITY_AGENTS).toBe("explore,librarian")
    // A set-but-empty gateway list must reach the host as an empty list, not disappear.
    expect((await launchSpecFor({ allowedAgents: [] })).env.OMO_CAPABILITY_AGENTS).toBe("")
  })

  it("pins one private agent dir for the host, overriding an inherited omo install", async () => {
    const envs = []
    await launchSpecFor({
      run: async (argv, env) => {
        envs.push(env)
        return { code: 0, stdout: JSON.stringify({ action: "start", pid: 1 }) }
      },
    })
    const env = envs[0]
    expect(env.OMO_CODING_AGENT_DIR).toBe(env.SENPI_CODING_AGENT_DIR)
    expect(env.OMO_CODING_AGENT_DIR).toBe(env.PI_CODING_AGENT_DIR)
    expect(env.OMO_CODING_AGENT_DIR.endsWith("agent")).toBe(true)
  })
})

describe("waitReady", () => {
  const readyHost = (overrides = {}) => {
    const commands = []
    const openSessions = []
    let listen = true
    const sup = createTaskHostSupervisor({
      // A distinct id per call, so a relaunch shows up as a rotated root session.
      openSession: async () => {
        openSessions.push(`ses_ready_${openSessions.length + 1}`)
        return openSessions.at(-1)
      },
      pluginDir: "C:/plugin",
      stateDir: mkdtempSync(join(tmpdir(), "task-host-ready-")),
      senpiBin: "senpi",
      logger: { info: () => {}, warn: () => {} },
      exists: () => true,
      resolveProjectDir: async () => "I:/migration/Alwork",
      run: async (argv) => {
        commands.push(argv.join(" "))
        if (argv.includes("ensure") && commands.filter((c) => c.includes("ensure")).length >= 2) listen = true
        return { code: 0, stdout: JSON.stringify(argv.includes("stop") ? {} : { action: "start", pid: 333 }) }
      },
      probe: async () => listen,
      warm: async () => true,
      waitForSecret: async () => {},
      healthTimeoutMs: 300,
      startTimeoutMs: 300,
      ...overrides,
    })
    return { sup, commands, openSessions, die: () => { listen = false } }
  }

  it("starts a stopped host when asked to become ready", async () => {
    // No ensure() first: the gateway's wait must bring the host up by itself.
    const { sup } = readyHost()
    expect(await sup.waitReady({ budgetMs: 5000 })).toBe(true)
    expect(sup.state()).toBe("ready")
    await sup.stop()
  })

  it("keeps its bound root session when a second task becomes ready", async () => {
    const { sup, commands, openSessions, die } = readyHost()
    expect(await sup.waitReady({ budgetMs: 5000 })).toBe(true)
    const firstSession = sup.sessionId()
    expect(sup.state()).toBe("ready")

    // The gateway awaits waitReady on every task start. Launching again while ready mints a new port, token, host
    // generation and root session, which orphans every task the previous generation started.
    expect(await sup.waitReady({ budgetMs: 5000 })).toBe(true)
    expect(sup.sessionId()).toBe(firstSession)
    expect(openSessions).toHaveLength(1)
    expect(commands.filter((c) => c.includes("host stop"))).toHaveLength(0)
    expect(commands.filter((c) => c.includes("host ensure"))).toHaveLength(1)

    // The guard must not mask a real loss: a dead listener still relaunches from waitReady.
    die()
    expect(await sup.waitReady({ budgetMs: 5000 })).toBe(true)
    expect(commands.filter((c) => c.includes("host stop"))).toHaveLength(1)
    expect(commands.filter((c) => c.includes("host ensure"))).toHaveLength(2)
    expect(openSessions).toHaveLength(2)
    await sup.stop()
  })

  it("never claims ready from memory when the listener is gone", async () => {
    let live = true
    const { sup } = readyHost({ probe: async () => live })
    expect((await sup.ensure()).state).toBe("ready")
    live = false
    // The measured desktop case: the process stayed alive and heartbeating with no listener, and ensure answered
    // "ready" from cached state, so every later probe failed on a port nobody served.
    const second = await sup.ensure()
    expect(second.state).not.toBe("ready")
    await sup.stop()
  }, 20_000)

  it("reports false when the host never becomes serveable inside the budget", async () => {
    let live = true
    const { sup } = readyHost({ probe: async () => live })
    expect((await sup.ensure()).state).toBe("ready")
    // Nothing can revive this one: the budget must expire rather than hang or claim success.
    live = false
    const started = Date.now()
    expect(await sup.waitReady({ budgetMs: 400 })).toBe(false)
    expect(Date.now() - started).toBeLessThan(6000)
    await sup.stop()
  })
})

describe("reused host generation", () => {
  it("drops a reused generation and stops its child before launching", () => {
    const root = mkdtempSync(join(tmpdir(), "task-host-daemon-"))
    roots.push(root)
    const agentDir = join(root, "agent")
    const socket = join(root, "rpc", "task-host.sock")
    const daemon = join(agentDir, "rpc-host-daemon", "abc123")
    const generation = join(daemon, "generations", "inst-1")
    mkdirSync(generation, { recursive: true })
    writeFileSync(join(daemon, "endpoint.json"), JSON.stringify({ socket }), "utf8")
    writeFileSync(join(generation, "host-child.pid"), JSON.stringify({ pid: 4242 }), "utf8")
    const killed = []
    const result = releaseDaemonState({ agentDir, socket, kill: (pid) => killed.push(pid) })
    // The measured case: the child was alive, kept heartbeating, and owned no capability port, so nothing else could
    // dislodge it and every probe of this gateway's freshly minted port failed.
    expect(result.released).toBe(1)
    expect(killed).toEqual([4242])
    expect(existsSync(daemon)).toBe(false)
  })

  it("leaves a generation that belongs to another socket alone", () => {
    const root = mkdtempSync(join(tmpdir(), "task-host-daemon-other-"))
    roots.push(root)
    const agentDir = join(root, "agent")
    const daemon = join(agentDir, "rpc-host-daemon", "def456")
    mkdirSync(join(daemon, "generations", "inst-2"), { recursive: true })
    writeFileSync(join(daemon, "endpoint.json"), JSON.stringify({ socket: "C:/other/task-host.sock" }), "utf8")
    const result = releaseDaemonState({ agentDir, socket: "C:/mine/task-host.sock", kill: () => {} })
    expect(result.released).toBe(0)
    expect(existsSync(daemon)).toBe(true)
  })
})
