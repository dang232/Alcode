import { createHash, randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Owns the lifecycle of the one Senpi task host this backend process uses.
 *
 * The engine's own supervisor does the starting (`senpi host ensure --launch-spec`), a `warm` request makes
 * the extension graph load so the capability listener binds, and nothing is advertised as ready until
 * `/capability/health` answers 200. The token is generated per start and never logged.
 */

// An .exe is spawnable without a shell, and the sibling checkout's shim speaks the same
// "host ensure/session/stop" contract this supervisor drives. Derived from this module's location so no
// machine-specific path is baked in; absent (packaged builds, other layouts) the caller's env decides.
const siblingSenpiShim = () => {
  try {
    const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
    return joinPath(repoRoot, "..", "oh-my-openAlcore", "node_modules", ".bin", "senpi.exe");
  } catch {
    return undefined
  }
}
/**
 * The engine the app itself runs on, when this install can resolve it. A host started by the wrong build answers
 * \`ensure\` and never binds its listener, which is indistinguishable from a broken plugin.
 */
export const appRuntimeEngine = (requireImpl = createRequire(import.meta.url)) => {
  try {
    return [process.execPath, requireImpl.resolve("@code-yeongyu/senpi/dist/bundle/cli.js")]
  } catch {
    return undefined
  }
}

const DEFAULT_SENPI_BIN = (() => {
  const candidate = siblingSenpiShim()
  return candidate !== undefined && existsSync(candidate) ? candidate : undefined
})()

/**
 * Engines worth trying, best first: an explicit choice, then the runtime this install can resolve, then the global
 * omo-ai install (where dev machines keep the CLI the app itself uses), then the sibling checkout's shim.
 */
export const engineCandidates = ({ env = process.env, exists = existsSync, appdata = process.env.APPDATA } = {}) => {
  const list = []
  const push = (candidate) => {
    if (candidate === undefined) return
    if (list.some((existing) => JSON.stringify(existing) === JSON.stringify(candidate))) return
    list.push(candidate)
  }
  push(parseSenpiBin(env.ALCODE_TASK_HOST_SENPI))
  // The app's own runtime comes before any checkout shim: a host started by an older engine mounts and then answers a
  // child with an empty completion, which reads as a plugin bug and is not one.
  const app = appRuntimeEngine()
  if (app !== undefined) push(app)
  if (typeof appdata === "string" && appdata.length > 0) {
    const cli = join(appdata, "npm", "node_modules", "omo-ai", "node_modules", "@code-yeongyu", "senpi", "dist", "bundle", "cli.js")
    if (exists(cli)) push([process.execPath, cli])
  }
  push(DEFAULT_SENPI_BIN)
  push("senpi")
  return list
}

/**
 * Seeds the private agent dir the supervised host runs under: this plugin registered, and the provider pairing the host
 * needs to actually execute a task. Only the provider selection crosses over from the user's agent dir — never the whole
 * file, which can carry unrelated personal settings — and the auth file is copied 0600 and never read or logged here.
 */
export const seedAgentDir = ({ agentDir, pluginDir, userProfile = '', exists = existsSync, read = readFileSync, write = writeFileSync, mkdir = mkdirSync }) => {
  mkdir(agentDir, { recursive: true })
  const sourceDirs = [join(userProfile, '.omo', 'agent'), join(userProfile, '.senpi', 'agent')]
  const sourceDir = sourceDirs.find((candidate) => exists(join(candidate, 'settings.json')))
  let selected = {}
  if (sourceDir !== undefined) {
    try {
      const parsed = JSON.parse(String(read(join(sourceDir, 'settings.json'), 'utf8')))
      if (typeof parsed?.defaultProvider === 'string') selected.defaultProvider = parsed.defaultProvider
      if (typeof parsed?.defaultModel === 'string') selected.defaultModel = parsed.defaultModel
      // The catalog the engine will actually call from: without this list a resolved model can answer empty.
      if (Array.isArray(parsed?.enabledModels)) selected.enabledModels = parsed.enabledModels.filter((entry) => typeof entry === 'string')
    } catch {
      selected = {}
    }
  }
  const settings = { packages: [pluginDir], ...selected }
  write(join(agentDir, 'settings.json'), JSON.stringify(settings, null, 2), { mode: 0o600 })
  // Auth alone is not enough to run a task: the engine resolves a model from its provider catalog, so a host whose
  // agent dir lacks these answers "No senpi model registry is available yet" and can never start delegated work.
  const copied = ['auth.json', 'models.json', 'models-store.json'].filter((name) => sourceDirs.some((candidate) => exists(join(candidate, name))))
  for (const name of copied) {
    const from = sourceDirs.map((candidate) => join(candidate, name)).find((candidate) => exists(candidate))
    if (from !== undefined) copyFileSync(from, join(agentDir, name))
  }
  return { agentDir, provider: selected.defaultProvider ?? null, model: selected.defaultModel ?? null, authCopied: copied.includes('auth.json'), copied }
}

/**
 * Where the host plugin lives. An explicit env wins; otherwise the sibling checkout is probed, so a dev tree can start the
 * supervised host without anyone having to know the path. An absent plugin returns an empty string, which keeps the
 * feature off rather than starting a host with nothing to load.
 */
export const resolvePluginDir = ({ env = process.env, moduleUrl = import.meta.url, exists = existsSync } = {}) => {
  const explicit = typeof env.ALCODE_TASK_HOST_PLUGIN_DIR === 'string' ? env.ALCODE_TASK_HOST_PLUGIN_DIR.trim() : ''
  if (explicit.length > 0) return explicit
  // Order matters and is decided in .omo/evidence/r1-14-plugin-distribution/plugin-and-engine-decision.md: a packaged
  // resource, then the product's staged tree, then a sibling checkout. The staged tree must match the engine in use -
  // the sibling 2026.10 build accepts `warm` and mounts nothing, which reads as "listener never became ready".
  const candidates = []
  try {
    if (typeof env.ALCODE_RESOURCES_PATH === 'string' && env.ALCODE_RESOURCES_PATH.trim().length > 0) {
      candidates.push(joinPath(env.ALCODE_RESOURCES_PATH.trim(), 'senpi-plugin'))
    }
    const webRoot = fileURLToPath(new URL('../../../', moduleUrl))
    candidates.push(joinPath(webRoot, 'dist', 'senpi-plugin'))
    const migrationRoot = fileURLToPath(new URL('../../../../../../', moduleUrl))
    candidates.push(joinPath(migrationRoot, 'oh-my-openAlcore', 'packages', 'omo-senpi', 'plugin'))
  } catch {
    return ''
  }
  const found = candidates.find((candidate) => exists(joinPath(candidate, 'extensions', 'omo.js')))
  return found ?? ''
}


/**
 * An engine is not always one executable: the app's own runtime is a script run by its own interpreter, so the env may
 * name a command line as `interpreter|script|extra...`.
 */
export const parseSenpiBin = (raw) => {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value.length === 0) return undefined
  if (!value.includes('|')) return value
  const parts = value.split('|').map((part) => part.trim()).filter((part) => part.length > 0)
  return parts.length === 0 ? undefined : parts
}

export const launchOf = (bin, execPath = process.execPath) => {
  if (Array.isArray(bin)) return [...bin]
  if (!bin.toLowerCase().endsWith('.js')) return [bin]
  // Electron refuses `--js-flags` before it ever becomes Node (`bad option:`, exit 9), so the
  // staged engine is started with ELECTRON_RUN_AS_NODE alone: a host launched through this
  // branch must reach the engine, and an argument the runtime rejects reaches nothing.
  return [execPath, bin]
}

const WINDOWS_PIPE_PREFIX = '\\\\.\\pipe\\senpi-rpc-'
const WARM_TIMEOUT_MS = 60_000
const SECRET_WAIT_MS = 10_000

// A root session lives on its connection: if the socket object is unreferenced the runtime may collect it, the host
// sees its last client leave, and the loopback listener disappears while the supervisor still reports "ready".
const retainedRootConnections = new Set()

/** How many root-session connections this process is holding open; the listener dies when this drops to zero. */
export const retainedRootSessionCount = () => retainedRootConnections.size

/** The daemon publishes `<socket>.secret` once it listens; a warm sent before that cannot even resolve the transport. */
const waitForHostSecret = async (socket, deadlineMs = SECRET_WAIT_MS, now = () => Date.now()) => {
  const deadline = now() + deadlineMs
  while (now() < deadline) {
    if (process.platform !== 'win32' || existsSync(`${socket}.secret`)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return process.platform !== 'win32' || existsSync(`${socket}.secret`)
}

/**
 * Asks the host to load its extension graph. Nothing else makes the capability listener bind: the mount lives in the
 * task component's register, which runs when the graph loads, and a daemon that is only ensured never loads it. A warm
 * costs no model call and creates no session, and readiness still comes from /capability/health.
 */
/**
 * Opens the root session this host serves gateway work from, and returns its DURABLE id. The host answers
 * `open_session` with a stream whose `sessionId` is only the connection handle; the identity the records and the DAG
 * are keyed by is the header of the session file the host writes, which is what this returns.
 */
export const openRootSession = async ({ socket, sessionPath, cwd, timeoutMs = 20000, connect = createConnection, exists = existsSync, read = readFileSync }) => {
  const transport = await resolveHostTransport(socket)
  if (transport === undefined) return undefined
  const request = {
    id: 'alcode-task-host-session',
    type: 'open_session',
    sessionPath,
    cwd,
    kind: 'worker',
    // The host reads these snake_case keys; camelCase is silently ignored, and an ignored retain flag drops the session
    // with the connection, leaving children with no live parent.
    retain_on_disconnect: true,
    auto_title: false,
  }
  const connection = connect(transport.endpoint)
  connection.setEncoding?.('utf8')
  connection.on?.('data', () => {})
  connection.on?.('error', () => {})
  // The write rides the connect event instead of blocking on it, so a host that never answers cannot hang the start.
  connection.once('connect', () => {
    try {
      if (transport.secret !== undefined) connection.write(transport.secret)
      // The client that works probes the protocol before opening a session; the host expects that first frame.
      connection.write(`${JSON.stringify({ id: 'ensure-host-probe', type: 'get_protocol_info' })}\n`)
      connection.write(`${JSON.stringify(request)}\n`)
    } catch {}
  })
  const deadline = Date.now() + timeoutMs
  let found
  try {
    while (Date.now() < deadline) {
      if (exists(sessionPath)) {
        const header = String(read(sessionPath, 'utf8')).split(/\r?\n/).find((line) => line.trim().length > 0)
        if (header !== undefined) {
          try {
            const parsed = JSON.parse(header)
            const id = parsed?.id ?? parsed?.sessionId
            if (typeof id === 'string' && id.length > 0) { found = id; break }
          } catch {
            // the file exists but its first line is not written yet; keep waiting
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return found
  } finally {
    if (found === undefined) {
      connection.destroy()
    } else {
      // Keep it referenced for the life of the process: closing it detaches the session the children run under.
      retainedRootConnections.add(connection)
      connection.once?.('close', () => retainedRootConnections.delete(connection))
    }
  }
}

const warmHost = async ({ socket, cwd, stateDir, timeoutMs = WARM_TIMEOUT_MS }) => {
  const transport = await resolveHostTransport(socket)
  if (transport === undefined) return false
  // The host validates the warm-up state directory it is handed, so it has to exist before the request goes out;
  // nothing may survive afterwards, which is why it is created and removed here rather than left on disk.
  const warmDir = mkdtempSync(joinPath(tmpdir(), 'alcode-warm-'))
  const request = {
    id: 'omo-task-host-warm',
    type: 'warm',
    cwd,
    kind: 'worker',
    context: { role: 'child', task_id: 'host-warmup', state_dir: warmDir, host_warmup: '1' },
  }
  return await new Promise((resolve) => {
    const connection = createConnection(transport.endpoint)
    let buffer = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      connection.destroy()
      try {
        rmSync(warmDir, { recursive: true, force: true })
      } catch {}
      resolve(value)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    connection.setEncoding('utf8')
    connection.once('connect', () => {
      if (transport.secret !== undefined) connection.write(transport.secret)
      connection.write(`${JSON.stringify(request)}\n`)
    })
    connection.on('data', (chunk) => {
      buffer += chunk
      for (let newline = buffer.indexOf('\n'); newline !== -1; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        try {
          const reply = JSON.parse(line)
          if (reply?.id !== request.id) continue
          // A success reply is the engine's own statement that the profile was built; older builds omit data.state, and
          // refusing those turned a working warm into a silent no-mount.
          finish(reply?.success === true)
        } catch {
          // a lifecycle broadcast line, not our answer
        }
      }
    })
    connection.once('error', () => finish(false))
    connection.once('close', () => finish(false))
  })
}

const resolveHostTransport = async (socket) => {
  if (process.platform !== 'win32') return { endpoint: socket }
  try {
    const secret = readFileSync(`${socket}.secret`)
    if (secret.length !== 32) return undefined
    const canonical = socket.replace(/\//g, '\\').toLowerCase()
    const name = createHash('sha256')
      .update(Buffer.concat([Buffer.from(canonical, 'utf8'), secret]))
      .digest('hex')
      .slice(0, 32)
    return { endpoint: `${WINDOWS_PIPE_PREFIX}${name}`, secret }
  } catch {
    return undefined
  }
}

// A gateway host must outlive idle gaps between delegations; it is stopped explicitly when it is no longer wanted.
const HOST_IDLE_EXIT_MS = 30 * 60_000
const DEFAULT_START_TIMEOUT_MS = 60_000
const DEFAULT_HEALTH_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RESTARTS = 2
const SPEC_FILE_NAME = "alcode-task-host.spec.json"

const joinPath = join

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = address !== null && typeof address === "object" ? address.port : 0
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("no free loopback port"))))
    })
  })

const parseJsonLine = (text) => {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.startsWith("{"))
    .pop()
  if (line === undefined) return undefined
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

const socketPathFor = (stateDir) => join(stateDir, "rpc", "task-host.sock")

/**
 * Forget a host generation the engine still believes in.
 *
 * The engine keys a generation by the socket and decides liveness from the child pid plus a heartbeat. A host whose
 * extension has unloaded keeps heartbeating with no capability listener at all (measured: the process was alive, the
 * heartbeat fresh, and the pid owned no listening port), so `ensure` keeps answering `reuse`. This gateway mints a
 * fresh port and token per start, so a reused host can never serve it: the generation has to be dropped and its child
 * stopped before a real launch.
 */
export const releaseDaemonState = ({ agentDir, socket, kill = (pid) => process.kill(pid), rm = rmSync, readdir = readdirSync, exists = existsSync, read = readFileSync }) => {
  const root = join(agentDir, "rpc-host-daemon")
  if (!exists(root)) return { released: 0, killed: [] }
  const killed = []
  let released = 0
  for (const entry of readdir(root)) {
    const dir = join(root, entry)
    const endpointFile = join(dir, "endpoint.json")
    let owned = false
    try {
      const endpoint = JSON.parse(read(endpointFile, "utf8"))
      owned = endpoint?.socket === socket
    } catch {
      // No endpoint record: a leftover generation with no owner, still worth clearing when its dir matches a socket we know.
      owned = false
    }
    if (!owned) continue
    const generations = join(dir, "generations")
    if (exists(generations)) {
      for (const generation of readdir(generations)) {
        const pidFile = join(generations, generation, "host-child.pid")
        try {
          const record = JSON.parse(read(pidFile, "utf8"))
          if (Number.isInteger(record?.pid) && record.pid > 0) {
            kill(record.pid)
            killed.push(record.pid)
          }
        } catch {}
      }
    }
    try {
      rm(dir, { recursive: true, force: true })
      released += 1
    } catch {}
  }
  return { released, killed }
}

/**
 * Ask the capability listener whether it is serving. This is the only thing that distinguishes a host that mounted
 * its plugin from one whose process answers but whose listener is gone, so it must never fail silently: a missing
 * default made every readiness check return false against a perfectly healthy host.
 */
export const defaultRun = (argv, env, options = {}) => {
  const [candidate, ...args] = Array.isArray(argv) ? argv : []
  const file = (candidate ?? "").trim?.() ?? ""
  if (file.length === 0) return { code: 1, stdout: "task host runner received no command" }
  const result = spawnSync(file, args, {
    cwd: options?.cwd,
    env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  })
  const code = Number.isInteger(result.status) ? result.status : 1
  const stdout = String(result.stdout ?? "")
  if (code === 0) return { code, stdout }
  const stderr = String(result.stderr ?? "").trim()
  if (stderr.length === 0) return { code, stdout }
  const separator = stdout.length === 0 || stdout.endsWith("\n") ? "" : "\n"
  return { code, stdout: `${stdout}${separator}${stderr}` }
}

export const defaultProbe = async (url, timeoutMs = 2000) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok === true
  } catch {
    return false
  }
}

export function createTaskHostSupervisor(options) {
  const {
    pluginDir,
    stateDir,
    // Which senpi binary performs ensure/session/stop. The app's PATH can resolve an internal runtime
    // build that rejects these subcommands, so the caller may name one explicitly.
    // The first attempt uses the best available engine; the sibling checkout's shim is a last resort, because a host
    // started by it mounts and then answers children with empty completions.
    senpiBin: configuredSenpiBin = engineCandidates({ env: process.env })[0],
    warm = warmHost,
    // The session opener talks to the host's socket; tests inject a no-op so they never wait on a pipe.
    openSession = openRootSession,
    // Engines to try, best first; tests inject this so escalation never depends on what this machine has installed.
    engines,
    waitForSecret = waitForHostSecret,
    exists = existsSync,
    run = defaultRun,
    probe = defaultProbe,
    resolveProjectDir,
    resolveModel,
    logger = { info: () => {}, warn: () => {} },
    now = () => Date.now(),
    startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
    healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
    maxRestarts = DEFAULT_MAX_RESTARTS,
    // The gateway's one allowlist, published into the launch spec under the name the host mount reads.
    allowedAgents,
    userProfile = process.env.USERPROFILE ?? "",
    recoveryWaitMs = 3000,
    // The caller aborts its own request at 30 s (capability-descriptor TIMEOUT_MS), so the wait must fit inside that;
    // recovery is kept fast instead of the budget being enlarged.
    readyBudgetMs = 25_000,
    restartWindowMs = 10 * 60_000,
    // A host that loses its listener between tasks is invisible until someone delegates. The watchdog closes that gap.
    watchdogMs = 15_000,
  } = options

  let state = "stopped"
  let hostSessionId
  // The socket of the host currently serving; a relaunch replaces it so an abandoned host is never re-attached.
  let socket = socketPathFor(stateDir)
  // The engine may be switched once if the first one starts a host whose listener never binds.
  let senpiBin = configuredSenpiBin
  let engineSwitched = false
  let failure
  let token
  let port
  // The budget bounds CONSECUTIVE trouble, not a session's lifetime: a host that ran fine for ten minutes and then lost
  // its listener deserves a fresh allowance, or a long session silently stops healing.
  let restartTimes = []
  const restartBudgetLeft = () => {
    const stamp = now()
    restartTimes = restartTimes.filter((at) => stamp - at < restartWindowMs)
    return restartTimes.length < maxRestarts
  }
  const noteRestart = () => {
    restartTimes.push(now())
  }
  let inflight
  let scopedProjectDir
  // The host runs under its own agent dir, but that must not leak into this process: the server resolves the same
  // project state for the DAG, and rewriting the process environment made both read different stores depending on
  // start order. The environment is handed to the child instead.
  let commandEnv
  const specPath = join(stateDir, SPEC_FILE_NAME)

  const snapshot = () => ({
    state,
    url: state === "ready" || state === "degraded" ? `http://127.0.0.1:${port}` : undefined,
    // The root session this host serves gateway work from, when one was opened.
    ...(hostSessionId === undefined ? {} : { sessionId: hostSessionId }),
    pid: undefined,
    restarts: restartTimes.length,
    ...(failure === undefined ? {} : { failure }),
  })

  const healthy = async () => {
    if (port === undefined) return false
    try {
      return (await probe(`http://127.0.0.1:${port}/capability/health`)) === true
    } catch {
      return false
    }
  }

  const awaitHealth = async (budgetMs = healthTimeoutMs) => {
    const deadline = now() + budgetMs
    while (now() < deadline) {
      if (await healthy()) return true
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return false
  }

  // The spec's extensions are relative to the engine's working directory, so every engine command runs from the plugin
  // root; running it from the server directory loads no plugin at all and the host answers nothing.
  const engineCwd = pluginDir
  const runStep = async (command) => {
    const result = await run(command, commandEnv, { cwd: engineCwd })
    const said = String(result.stdout ?? "").trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" | ")
    // The engine's own answer is the only evidence of what it did; a successful ensure that changed nothing has to be
    // visible, not inferred from a later timeout.
    logger.info?.(`[task-host] ${command.slice(-2).join(" ")} -> ${said.slice(0, 200)}`)
    if (result.code !== 0) {
      // The engine reports a crash as a Node fatal footer, whose cause sits many lines above it. Two lines of tail
      // turned that into `} | Node.js v24.22.0` and cost a whole diagnosis round, so a failed step carries the whole
      // captured stack into the log while a successful step still reports its one-line answer.
      const detail = String(result.stdout ?? "").trim().split(/\r?\n/).filter(Boolean).slice(-40).join(" | ")
      logger.warn?.(`[task-host] ${command.slice(0, 3).join(" ")} failed with code ${result.code}: ${detail.slice(0, 4000)}`)
      throw new Error(`${command.slice(0, 3).join(" ")} exited ${result.code}${said.length > 0 ? `: ${said}` : ""}`)
    }
    return result
  }

  const start = async (projectDir) => {
    state = "starting"
    failure = undefined
    try {
      scopedProjectDir = projectDir
      port = await freePort()
      token = randomBytes(32).toString("base64url")
      const entry = join(pluginDir, "extensions", "omo.js")
      if (!exists(entry)) throw new Error(`task host plugin not found: ${entry}`)
      // An empty model string means "use the host's own configured default" rather than pinning a
      // provider id the product has no business hardcoding.
      const model = (resolveModel?.() ?? "").trim()
      mkdirSync(dirname(socketPathFor(stateDir)), { recursive: true })
      mkdirSync(dirname(specPath), { recursive: true })
      const specEnv = { OMO_CAPABILITY_TOKEN: token, OMO_CAPABILITY_PORT: String(port) }
      if (allowedAgents !== undefined) specEnv.OMO_CAPABILITY_AGENTS = allowedAgents.join(",")
      writeFileSync(
        specPath,
        JSON.stringify(
          {
            spec_version: 1,
            core: { session_runtime: "in-process", multi_session: true, extensions: ["."] },
            // The engine's schema is strict and requires idleExitMs. Without it the spec is rejected and the host runs
            // on a default transient policy, exiting while idle — which presents as a capability listener that stops
            // answering ~45 s after a healthy start.
            tunables: { coldStart: "persistent", idleExitMs: HOST_IDLE_EXIT_MS },
            env: specEnv,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      )
      // The host loads its extension graph from the agent dir it runs under, and the capability listener lives in that
      // graph. Give it a private agent dir with this plugin registered, seeded with the user's provider auth (0600,
      // never logged) so a task can actually run.
      const agentDir = join(stateDir, "agent")
      seedAgentDir({ agentDir, pluginDir, userProfile: process.env.USERPROFILE ?? "" })
      commandEnv = { ...process.env, OMO_CODING_AGENT_DIR: agentDir, SENPI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_DIR: agentDir }
      // In the desktop app process.execPath is electron.exe: the engine is a node script, so the host must be started
      // with Electron acting as node, or the child inherits no tool runtime at all.
      if (process.versions?.electron !== undefined) commandEnv.ELECTRON_RUN_AS_NODE = "1"
      delete commandEnv.PI_CODING_AGENT
      // Each launch starts from the default socket; a failed reuse moves it (see the relaunch below).
      socket = socketPathFor(stateDir)
      const ensureOnce = () => runStep([...launchOf(senpiBin), "host", "ensure", "--json", "--launch-spec", specPath, "--socket", socket])
      // "reuse" naming no live pid is state that outlived its host: the engine registry still describes our
      // socket, so it reports a reuse of nothing. Clear it through the engine's own stop path, then launch again.
      // Every reuse is unusable, not only the dead-pid kind: this gateway mints a fresh port and token for this attempt,
      // so a host started earlier cannot be listening on them. Measured in the desktop app: the reused host was alive
      // with a fresh heartbeat while owning no listening port at all, and every probe of our new port failed.
      const isUnusable = (value) => value?.action === "reuse"
      let ensured = await ensureOnce()
      let decision = parseJsonLine(ensured.stdout)
      if (isUnusable(decision)) {
        logger.warn?.(`[task-host] releasing an existing host generation (reuse pid ${String(decision.pid ?? "none")})`)
        await runStep([...launchOf(senpiBin), "host", "stop", "--json", "--force", "--socket", socket]).catch(() => {})
        const released = releaseDaemonState({ agentDir, socket })
        logger.warn?.(`[task-host] released ${released.released} generation(s), stopped ${released.killed.length} host child(ren)`)
        ensured = await ensureOnce()
        decision = parseJsonLine(ensured.stdout)
        if (isUnusable(decision)) {
          throw new Error(`the engine kept reusing a host this gateway cannot serve; clear ${join(stateDir, "agent", "rpc-host-daemon")}`)
        }
      }
      await waitForSecret(socket)
      // A session is what actually loads the capability host in this engine build, and the supervisor needs one anyway to
      // serve gateway work, so it is opened before the readiness gate instead of after it.
      // The session gets its own directory, exactly like a real workspace: the host refuses a session whose file sits
      // inside its own state root, and that refusal was silent (the file simply never appeared).
      // Warm first: the engine's warm command builds the same extension graph a session would, and that is what mounts
      // this plugin's capability host.
      const sessionDir = join(stateDir, "session")
      mkdirSync(sessionDir, { recursive: true })
      // A reused host either answers quickly or is dead weight; waiting the full budget delays the whole startup.
      const prepareServing = async (healthBudget = healthTimeoutMs) => {
        // A session file left by a previous host holds an id that host owned; reusing it would bind the gateway to a
        // session the new host has never opened, so each prepare starts from a clean file.
        try {
          rmSync(join(sessionDir, "host-session.jsonl"), { force: true })
        } catch {}
        hostSessionId = undefined
        // The profile is built for this cwd, and the plugin loads from it: warming the user's project would build a graph
        // with no plugin in it, so the warm targets the plugin root exactly like the plugin's own launch spec does.
        await warm({ socket, cwd: engineCwd, stateDir }).catch(() => false)
        // The host accepts sessions only once it is up, and "up" is what the session itself proves: retry briefly instead
        // of firing once at a host that is still starting (a single early attempt looks exactly like a refusal).
        const sessionDeadline = now() + startTimeoutMs
        while (hostSessionId === undefined && now() < sessionDeadline) {
          hostSessionId = await openSession({ socket, sessionPath: join(sessionDir, "host-session.jsonl"), cwd: projectDir, timeoutMs: 2000 })
          if (hostSessionId === undefined) await new Promise((resolve) => setTimeout(resolve, 250))
        }
        logger.info?.(`[task-host] root session: ${hostSessionId ?? "none"}`)
        return awaitHealth(healthBudget)
      }
      const reused = decision?.action === "reuse"
      if (!(await prepareServing(reused ? Math.min(healthTimeoutMs, 4000) : healthTimeoutMs))) {
        // A reused host can be one whose listener died with a previous run: its process answers, its listener does not.
        // Stopping it and launching once more is the bounded restart this supervisor promised to do.
        // Escalate rather than give up: first a fresh socket with the same engine (the host may be an abandoned one
        // that refuses to stop), then the app's own runtime (the engine that started proves unable to serve).
        const escalate = async (switchEngine) => {
          // Bounded like any other restart: the budget is the contract, and an escalation is a restart.
          if (!restartBudgetLeft()) return false
          noteRestart()
          await runStep([...launchOf(senpiBin), "host", "stop", "--json", "--force", "--socket", socket]).catch(() => {})
          hostSessionId = undefined
          if (switchEngine) {
            const next = (engines ?? engineCandidates()).find((candidate) => JSON.stringify(candidate) !== JSON.stringify(senpiBin))
            if (next === undefined) return false
            senpiBin = next
            logger.warn?.(`[task-host] switching engine to ${Array.isArray(next) ? next[1] : next}`)
          } else {
            logger.warn?.("[task-host] relaunching on a fresh socket")
          }
          // A socket left behind belongs to the host that refused to stop; a new name is how it gets abandoned.
          socket = join(dirname(socket), `task-host-${Date.now().toString(36)}.sock`)
          mkdirSync(dirname(socket), { recursive: true })
          await ensureOnce()
          await waitForSecret(socket)
          // This host already failed its health check, so a long budget here only delays the caller: the measured desktop
          // recovery spent 29 of its 38 seconds waiting on exactly this.
          return await prepareServing(Math.min(healthTimeoutMs, 5000))
        }
        const recovered = (await escalate(false)) || (await escalate(true))
        if (!recovered) throw new Error("capability listener never became ready")
      }
      state = "ready"
      armWatchdog()
      return snapshot()
    } catch (error) {
      state = "failed"
      failure = error instanceof Error ? error.message : String(error)
      logger.warn(`task host unavailable: ${failure}`)
      return snapshot()
    }
  }

  const stop = async () => {
    if (state === "stopped") return snapshot()
    const wasRunning = state === "ready" || state === "degraded" || state === "starting"
    state = "stopping"
    try {
      if (wasRunning) await run([...launchOf(senpiBin), "host", "stop", "--socket", socket, "--drain", "--force"])
    } catch (error) {
      logger.warn(`task host stop failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      try {
        rmSync(specPath, { force: true })
      } catch {}
      disarmWatchdog()
      port = undefined
      hostSessionId = undefined
      scopedProjectDir = undefined
      state = "stopped"
    }
    return snapshot()
  }

  let watchdog
  const armWatchdog = () => {
    if (watchdog !== undefined || watchdogMs <= 0) return
    watchdog = setInterval(() => {
      if (state !== "ready") return
      probePort()
        .then((live) => (live ? undefined : ensureLiveFn()))
        .catch(() => {})
    }, watchdogMs)
    watchdog.unref?.()
  }
  const disarmWatchdog = () => {
    if (watchdog === undefined) return
    clearInterval(watchdog)
    watchdog = undefined
  }

  const ensureLiveFn = async () => {
    if (state === "starting" || state === "stopping") return false
    if (state !== "ready" && state !== "degraded") {
      logger.warn?.(`[task-host] ensureLive refused: state=${state} failure=${failure ?? "none"}`)
      return false
    }
    if (await probePort()) return true
    if (recovery !== undefined) return recovery
    let wrapped;
    wrapped = recovery = (async () => {
      if (!restartBudgetLeft()) {
        state = "failed"
        failure = `capability listener on port ${String(port)} stopped answering`
        logger.warn?.(`[task-host] ${failure} and the restart budget is spent`)
        return false
      }
      noteRestart()
      logger.warn?.(`[task-host] listener on port ${String(port)} stopped answering; relaunching`)
      const projectDir = scopedProjectDir
      await stop()
      const result = await start(projectDir)
      return result.state === "ready" && (await probePort())
    })().finally(() => {
      if (recovery === wrapped) recovery = undefined;
    });
    // The caller is a plugin with its own request timeout: holding it through a full relaunch (stop, ensure, session,
    // health) turns a retryable condition into "the operation timed out". Report not-live quickly and let the relaunch
    // finish in the background, so the caller's retry finds a live host.
    const bounded = Promise.race([
      recovery.then((value) => value === true, () => false),
      new Promise((resolve) => setTimeout(() => resolve(false), recoveryWaitMs)),
    ]);
    const recovered = await bounded;
    if (recovered !== true && recovery !== undefined) {
      logger.warn?.(`[task-host] relaunch still running after ${recoveryWaitMs} ms; answering with a retryable refusal`);
    }
    return recovered;
  }

  /**
   * Block until this host can actually serve a task: started when needed, ready, with its root session bound and its
   * listener answering. A gateway caller cannot retry on its own (the plugin reports a bare status), so a transient that
   * this process can wait out must never reach the caller as a refusal.
   */
  const waitReadyFn = async ({ budgetMs = readyBudgetMs } = {}) => {
    const deadline = now() + budgetMs
    const begun = async () => {
      if (state === "starting" && inflight !== undefined) return inflight
      if (state === "ready" || state === "stopped" || state === "failed" || state === "degraded") {
        const projectDir = scopedProjectDir ?? (await resolveProjectDir())
        if (typeof projectDir !== "string" || projectDir.trim().length === 0) return undefined
        if (inflight === undefined) {
          inflight = start(projectDir).finally(() => {
            inflight = undefined
          })
        }
        return inflight
      }
      return undefined
    }
    let pending = await begun()
    if (pending !== undefined) await pending
    while (now() < deadline) {
      if (state === "ready" && hostSessionId !== undefined && (await ensureLiveFn()) === true) return true
      if (state === "failed" && inflight === undefined) {
        pending = await begun()
        if (pending !== undefined) await pending
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return state === "ready" && hostSessionId !== undefined && (await probePort())
  }

  const probePort = async () =>
    port === undefined ? false : (await probe(`http://127.0.0.1:${port}/capability/health`)) === true

  // One recovery at a time: concurrent task starts must not each relaunch their own host.
  let recovery

  return {
    /**
     * Prove the host still answers, and relaunch it once when it does not. A host whose listener dies under a "ready"
     * supervisor otherwise answers every task with "unreachable: fetch failed" for the rest of the session.
     */
    ensureLive: ensureLiveFn,
    /** Resolves true once this host can serve a task, false when the budget ran out. */
    waitReady: waitReadyFn,
    async ensure(requestedDir) {
      const projectDir = requestedDir ?? (await resolveProjectDir())
      if (typeof projectDir !== "string" || projectDir.trim().length === 0) {
        state = "failed"
        failure = "no active project directory"
        return snapshot()
      }
      if (state === "ready") {
        // One host serves one project: reusing it for a different workspace would write records the
        // other project's DAG can never find, so the mismatch is refused out loud.
        if (scopedProjectDir !== projectDir) {
          return { ...snapshot(), state: "unavailable", failure: "foreign-project" }
        }
        // "ready" is this process's memory of a host, not proof: a host whose listener died still reports ready here.
        // Measured: the child was killed and this call still returned ready with a dead port.
        const readyToServe = await probePort()
        if (readyToServe) return snapshot()
        logger.warn?.("[task-host] host reports ready but its listener is gone; recovering")
        await ensureLiveFn()
        if (inflight !== undefined) await inflight
        if (state === "ready" && (await probePort())) return snapshot()
      }
      if (inflight !== undefined) return inflight
      if (restartTimes.length > 0 && !restartBudgetLeft()) {
        state = "failed"
        failure = "task host restart budget exhausted"
        return snapshot()
      }
      inflight = start(projectDir).finally(() => {
        inflight = undefined
      })
      const result = await inflight
      if (result.state === "failed") noteRestart()
      return result
    },
    async status() {
      if (state === "ready") {
        state = (await healthy()) ? "ready" : "degraded"
      }
      return snapshot()
    },
    async restart() {
      await stop()
      return this.ensure()
    },
    stop,
    /** The bearer token the gateway must present, present only while the host is serving. */
    token() {
      return state === "ready" || state === "degraded" ? token : undefined
    },
    /** The lifecycle state, so a caller can tell "still starting" from "refused". */
    state() {
      return state
    },

    /** The root session this host serves gateway work from, present only while the host is ready. */
    sessionId() {
      return state === "ready" && hostSessionId !== undefined ? hostSessionId : undefined
    },
    /**
     * The model the host session runs with, read from the agent dir the host was seeded with (falling back to the user's
     * own). A gateway caller that names no target still has to send one, and this is the value the host would use.
     */
    defaultModel() {
      const sources = [join(stateDir, "agent", "settings.json"), userProfile.length === 0 ? undefined : join(userProfile, ".omo", "agent", "settings.json")]
      for (const source of sources) {
        if (source === undefined) continue
        try {
          const parsed = JSON.parse(readFileSync(source, "utf8"))
          const model = typeof parsed?.defaultModel === "string" ? parsed.defaultModel.trim() : ""
          if (model.length === 0) continue
          if (model.includes("/")) return model
          const provider = typeof parsed?.defaultProvider === "string" ? parsed.defaultProvider.trim() : ""
          return provider.length === 0 ? model : `${provider}/${model}`
        } catch {}
      }
      return undefined
    },
    /** The project this host is scoped to, or undefined before it has started. */
    projectDir() {
      return scopedProjectDir
    },
    /** The capability URL the gateway should call, present only once the host is truly ready. */
    url() {
      return state === "ready" ? `http://127.0.0.1:${port}` : undefined
    },
  }
}
