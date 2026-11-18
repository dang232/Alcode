#!/usr/bin/env node
// Reports whether the provider/model in the engine config can serve a minimal
// request. The engine reads its own auth store. This script never reads a key to
// send it, never puts one in argv, and never prints one: it only knows the auth
// record shape and the secret values it must scrub from provider error text.
import { spawn as spawnProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { asBoolean, asFunction, asObjectValue, asString } from './wire-values.mjs'

const PROMPT = 'Reply with the single word: pong'
const DEFAULT_TIMEOUT_MS = 90_000
const ENDPOINT_TIMEOUT_MS = 8_000
const CATALOG_TIMEOUT_MS = 30_000
const INTEGRATION_TIMEOUT_MS = 2_000
const MAX_CAPTURE = 4_000_000
const MAX_PROVIDER_ERROR = 600
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@+/-]*$/
export const EXIT_CODES = { ok: 0, auth_expired: 1, no_provider: 2, unreachable: 3 }

function readJsonFile(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  return JSON.parse(text)
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

// Auth records are either { type: 'api', key } or { type: 'oauth', access, refresh, ... }.
// Every string value except the record type is treated as material to scrub.
export function collectSecretValues(record, found = []) {
  const container = asObjectValue(record)
  if (container === null) return found
  for (const [key, value] of Object.entries(container)) {
    if (key === 'type' || key === 'expires' || key === 'expiry' || key === 'expiresAt') continue
    const secret = asString(value)
    if (secret !== null && secret.length >= 8) found.push(secret)
    else if (asObjectValue(value) !== null) collectSecretValues(value, found)
  }
  return found
}

export function redact(text, secrets) {
  const raw = asString(text)
  if (raw === null || raw.length === 0) return null
  let out = raw
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join('[redacted]')
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
  out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
  return out
}

// A configured base URL can carry credentials in userinfo or a query string.
// Neither is needed to report or probe reachability.
export function safeEndpoint(raw) {
  const text = asString(raw)
  if (text === null || text.length === 0) return null
  try {
    const url = new URL(text)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function extractJsonObjects(text) {
  const objects = []
  let index = 0
  while (index < text.length) {
    const start = text.indexOf('{', index)
    if (start === -1) break
    let depth = 0
    let inString = false
    let escaped = false
    let end = -1
    for (let cursor = start; cursor < text.length; cursor += 1) {
      const char = text[cursor]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          end = cursor
          break
        }
      }
    }
    if (end === -1) break
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      if (asObjectValue(parsed) !== null) objects.push(parsed)
    } catch {
      // Engine catalogs interleave ids and JSON objects. Skip a chunk that is not JSON.
    }
    index = end + 1
  }
  return objects
}

function parseJsonEvents(stdout) {
  const events = []
  const clean = stdout.replace(/\u001b\[[0-9;]*m/g, '')
  for (const line of clean.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const event = JSON.parse(trimmed)
      if (asObjectValue(event) !== null) events.push(event)
    } catch {
      // A pretty-printed or partial line is not an event; the exit code still decides.
    }
  }
  return events
}

export function classifyRun(result) {
  const events = parseJsonEvents(result.stdout ?? '')
  const errorEvent = events.find((event) => event?.type === 'error')
  if (errorEvent) {
    const data = errorEvent.error?.data ?? {}
    const message = asString(data.message) ?? String(errorEvent.error?.message ?? '')
    const body = asString(data.responseBody) ?? ''
    const statusCode = Number(data.statusCode ?? 0) || null
    const combined = `${message} ${body}`
    if (statusCode === 401 || statusCode === 403 || /authentication|unauthorized|forbidden|api[_ -]?key|credential|expired/i.test(combined)) {
      return { status: 'auth_expired', failedLayer: 'credentials', providerError: message || null, statusCode, retryable: false }
    }
    if (/model unavailable|unknown model|model not found|no such model/i.test(combined)) {
      return {
        status: 'unreachable',
        failedLayer: 'registration',
        providerError: message || null,
        statusCode,
        retryable: false,
        reason: 'model_not_registered',
      }
    }
    if (result.timedOut) {
      return { status: 'unreachable', failedLayer: 'credentials', providerError: message || null, statusCode, retryable: false, reason: 'timeout' }
    }
    if (result.spawnError) {
      return {
        status: 'unreachable',
        failedLayer: 'engine',
        providerError: message || null,
        statusCode,
        retryable: false,
        reason: spawnReason(result.spawnError),
      }
    }
    if (/fetch failed|econnrefused|enotfound|etimedout|econnreset|network|socket|connection/i.test(combined)) {
      return { status: 'unreachable', failedLayer: 'credentials', providerError: message || null, statusCode, retryable: false, reason: 'connection_error' }
    }
    return {
      status: 'unreachable',
      failedLayer: 'credentials',
      providerError: message || null,
      statusCode,
      retryable: data.isRetryable === true,
      reason: 'provider_error',
    }
  }
  if (result.timedOut) {
    return { status: 'unreachable', failedLayer: 'credentials', providerError: null, retryable: false, reason: 'timeout' }
  }
  if (result.spawnError) {
    return { status: 'unreachable', failedLayer: 'engine', providerError: null, retryable: false, reason: spawnReason(result.spawnError) }
  }
  if (result.exitCode === 0) return { status: 'ok', failedLayer: 'none', providerError: null, retryable: false }
  const tail = (result.stderr || result.stdout || '').slice(-MAX_PROVIDER_ERROR)
  if (/model unavailable|unknown model|model not found|no such model/i.test(tail)) {
    return { status: 'unreachable', failedLayer: 'registration', providerError: tail || null, retryable: false, reason: 'model_not_registered' }
  }
  if (/authentication|unauthorized|forbidden|api[_ -]?key|credential|expired|\b401\b|\b403\b/i.test(tail)) {
    return { status: 'auth_expired', failedLayer: 'credentials', providerError: tail || null, retryable: false }
  }
  return { status: 'unreachable', failedLayer: 'credentials', providerError: tail || null, retryable: false, reason: 'exit_nonzero' }
}

function spawnReason(code) {
  return code === 'ENOENT' || code === 'EINVAL' ? 'engine_not_found' : `engine_spawn_failed:${code}`
}

// Runs the engine without a shell. Credentials reach it only through the engine's
// own auth store; `env` deliberately carries no auth material.
export function runEngine(command, args, options) {
  return new Promise((resolve) => {
    let child
    try {
      child = options.spawnImpl(command, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError: error?.code ?? 'spawn_failed' })
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let timer
    let forceTimer

    const finish = (exitCode, spawnError = null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(forceTimer)
      resolve({ exitCode, stdout, stderr, timedOut, spawnError })
    }

    child.stdout?.on('data', (chunk) => {
      if (stdout.length < MAX_CAPTURE) stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < MAX_CAPTURE) stderr += String(chunk)
    })
    child.on('error', (error) => finish(null, error?.code ?? 'spawn_failed'))
    child.on('close', (code) => finish(code))

    timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone.
      }
      forceTimer = setTimeout(() => finish(null, 'timeout'), 2_000)
      forceTimer.unref?.()
    }, Math.max(1, options.timeoutMs))
    timer.unref?.()
  })
}

function resolveCmdShim(shimPath, fsImpl) {
  let text
  try {
    text = fsImpl.readFileSync(shimPath, 'utf8')
  } catch {
    return null
  }
  const directory = path.win32.dirname(shimPath)
  for (const line of text.split(/\r?\n/)) {
    const match = /"([^"]+\.exe)"/i.exec(line)
    if (!match) continue
    const resolved = match[1]
      .replace(/%~dp0%/gi, `${directory}${path.sep}`)
      .replace(/%dp0%/gi, `${directory}${path.sep}`)
    if (fsImpl.existsSync(resolved)) return resolved
  }
  return null
}

// On Windows the npm `opencode` entry is an extensionless sh script plus a .cmd
// wrapper. Node cannot spawn either with shell: false, so resolve the real .exe.
export function resolveEngineBinary(bin, fsImpl = fs) {
  const candidates = []
  if (path.isAbsolute(bin) || bin.includes('/') || bin.includes('\\')) candidates.push(bin)
  else {
    for (const directory of String(process.env.PATH ?? '').split(path.delimiter)) {
      if (directory) candidates.push(path.join(directory, bin))
    }
  }

  const extensions = process.platform === 'win32' ? ['.exe', '.com', '.cmd', '.bat'] : ['']
  for (const base of candidates) {
    for (const extension of extensions) {
      const candidate = base.toLowerCase().endsWith(extension.toLowerCase()) ? base : `${base}${extension}`
      if (!fsImpl.existsSync(candidate)) continue
      if (/\.(cmd|bat)$/i.test(candidate)) {
        const target = resolveCmdShim(candidate, fsImpl)
        if (target) return { command: target, argsPrefix: [] }
        return { command: process.env.ComSpec ?? 'cmd.exe', argsPrefix: ['/d', '/s', '/c', candidate] }
      }
      return { command: candidate, argsPrefix: [] }
    }
  }
  return null
}

async function probeEndpoint(endpoint, fetchImpl, timeoutMs) {
  if (asFunction(fetchImpl) === null) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const url = new URL(endpoint)
    await fetchImpl(`${url.origin}/`, { method: 'GET', redirect: 'manual', signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function engineEnv(baseEnv, tempDir) {
  return {
    ...baseEnv,
    // A session database written by another engine version must not decide this probe.
    OPENCODE_DB: path.join(tempDir, 'preflight.db'),
    OPENCODE_DISABLE_AUTOUPDATE: '1',
  }
}

async function checkEngineConfig({ config, provider, engine, deps, env, cwd }) {
  if (!engine) return { ok: false, reason: 'engine_not_found' }
  const result = await runEngine(engine.command, [...engine.argsPrefix, 'debug', 'config'], {
    cwd,
    env,
    timeoutMs: CATALOG_TIMEOUT_MS,
    spawnImpl: deps.spawn,
  })
  if (result.spawnError) return { ok: false, reason: spawnReason(result.spawnError) }
  if (result.timedOut) return { ok: false, reason: 'engine_config_timeout' }
  if (result.exitCode !== 0) return { ok: false, reason: 'engine_config_unavailable' }

  let resolved
  try {
    resolved = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim())
  } catch {
    return { ok: false, reason: 'engine_config_unreadable' }
  }

  // Built-in providers are resolved by the engine, not declared in the config file.
  const declared = Boolean(config?.provider?.[provider] || config?.providers?.[provider])
  if (!declared) return { ok: true, declared: false }
  const present = Boolean(resolved?.provider?.[provider] || resolved?.providers?.[provider])
  return present ? { ok: true, declared: true } : { ok: false, declared: true, reason: 'provider_missing_from_engine_config' }
}

async function readEngineCatalog({ provider, modelId, config, engine, deps, env, cwd }) {
  const configured =
    config?.provider?.[provider]?.options?.baseURL ??
    config?.provider?.[provider]?.options?.baseUrl ??
    config?.providers?.[provider]?.options?.baseURL ??
    config?.providers?.[provider]?.options?.baseUrl
  const endpointFromConfig = safeEndpoint(configured)
  if (!engine) return { endpoint: endpointFromConfig, modelRegistered: null, catalogRead: false }

  const catalog = await runEngine(engine.command, [...engine.argsPrefix, 'models', '--verbose', '--pure', provider], {
    cwd,
    env,
    timeoutMs: CATALOG_TIMEOUT_MS,
    spawnImpl: deps.spawn,
  })
  if (catalog.exitCode !== 0) return { endpoint: endpointFromConfig, modelRegistered: null, catalogRead: false }

  const hit = extractJsonObjects(catalog.stdout).find(
    (entry) => entry?.id === modelId && (!entry.providerID || entry.providerID === provider),
  )
  const endpoint = endpointFromConfig ?? safeEndpoint(hit?.api?.url)
  return { endpoint, modelRegistered: Boolean(hit), catalogRead: true }
}

function discoverIntegrationBaseUrl(home, fsImpl) {
  const directory = path.join(home, '.config', 'alcode', 'managed-opencode')
  let names
  try {
    names = fsImpl.readdirSync(directory)
  } catch {
    return null
  }
  const candidates = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const record = JSON.parse(fsImpl.readFileSync(path.join(directory, name), 'utf8').replace(/^\uFEFF/, ''))
      const port = Number(record?.port)
      if (!Number.isInteger(port) || port <= 0) continue
      candidates.push({ port, startedAt: String(record?.startedAt ?? '') })
    } catch {
      // Not a managed-engine record.
    }
  }
  candidates.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  return candidates.length > 0 ? `http://127.0.0.1:${candidates[0].port}` : null
}

// Reads /api/integration without a credential. A 401 or an unreachable port is
// reported as unread, never as an empty integration list.
async function readIntegrationCatalog({ provider, baseUrl, fetchImpl, timeoutMs, directory }) {
  if (!baseUrl || asFunction(fetchImpl) === null) return { read: false, listed: null, source: 'unavailable' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
  try {
    const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/api/integration`, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'x-opencode-directory': directory },
    })
    if (response?.status !== 200) return { read: false, listed: null, source: `http_${response?.status ?? 'unknown'}` }
    const body = await response.json()
    const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : null
    if (!list) return { read: false, listed: null, source: 'unexpected_shape' }
    const listed = list.some(
      (entry) =>
        entry === provider ||
        entry?.id === provider ||
        entry?.providerID === provider ||
        entry?.providerId === provider,
    )
    return { read: true, listed, source: 'api' }
  } catch {
    return { read: false, listed: null, source: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

function createVerdict(fields) {
  const verdict = {
    status: fields.status,
    failedLayer: fields.failedLayer ?? 'none',
    provider: fields.provider ?? null,
    providerName: fields.providerName ?? null,
    model: fields.model ?? null,
    authRecordExists: Boolean(fields.authRecordExists),
    endpoint: fields.endpoint ?? null,
    endpointReachable: asBoolean(fields.endpointReachable),
    providerListedInIntegration: asBoolean(fields.providerListedInIntegration),
    integrationRead: Boolean(fields.integrationRead),
    providerError: fields.providerError ?? null,
    attempts: fields.attempts ?? 0,
  }
  if (fields.reason) verdict.reason = fields.reason
  if (fields.statusCode) verdict.statusCode = fields.statusCode
  return verdict
}

export async function runPreflight(options = {}) {
  const deps = {
    env: process.env,
    spawn: spawnProcess,
    fetchImpl: globalThis.fetch,
    resolveEngine: resolveEngineBinary,
    tmpdir: os.tmpdir(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    endpointTimeoutMs: ENDPOINT_TIMEOUT_MS,
    integrationTimeoutMs: INTEGRATION_TIMEOUT_MS,
    home: os.homedir(),
    log: () => {},
    ...options,
  }
  const configPath = deps.configPath ?? path.join(deps.home, '.config', 'opencode', 'opencode.json')
  const authPath = deps.authPath ?? path.join(deps.home, '.local', 'share', 'opencode', 'auth.json')
  const log = (message) => deps.log(message)

  let config
  try {
    config = readJsonFile(configPath)
  } catch {
    return createVerdict({ status: 'no_provider', failedLayer: 'config', reason: 'config_unreadable' })
  }

  const configuredModel = asString(config.model)
  const model = configuredModel !== null ? configuredModel.replace(/#.*$/, '').trim() : ''
  const slash = model.indexOf('/')
  if (slash <= 0 || slash === model.length - 1) {
    return createVerdict({ status: 'no_provider', failedLayer: 'config', reason: 'model_not_configured' })
  }
  const provider = model.slice(0, slash)
  const modelId = model.slice(slash + 1)
  if (!IDENTIFIER.test(provider) || !IDENTIFIER.test(modelId)) {
    return createVerdict({ status: 'no_provider', failedLayer: 'config', reason: 'invalid_model_id' })
  }
  const providerName = config?.provider?.[provider]?.name ?? config?.providers?.[provider]?.name ?? provider

  let authRecord = null
  try {
    const auth = readJsonFile(authPath)
    authRecord = auth?.[provider] ?? null
  } catch {
    // Missing or malformed auth is reported as "no record"; the engine call still decides.
  }
  const authRecordExists = Boolean(authRecord)
  const secrets = unique(collectSecretValues(authRecord))
  log(`provider=${provider} model=${modelId} authRecordExists=${authRecordExists}`)

  // The five layers, in order: config, engine, registration, credentials, catalog.
  // /api/integration is config-derived, so a readable list without the provider
  // only proves the UI catalog layer is empty. A dropped registration can still
  // appear here; that is why the registration check runs before the live call.
  const declaredInConfig = Boolean(config?.provider?.[provider] || config?.providers?.[provider])
  const integration = await readIntegrationCatalog({
    provider,
    baseUrl:
      deps.integrationUrl ??
      deps.env.ALCODE_PREFLIGHT_INTEGRATION_URL ??
      deps.env.OPENCODE_SERVER_URL ??
      discoverIntegrationBaseUrl(deps.home, fs),
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.integrationTimeoutMs,
    directory: deps.directory ?? process.cwd(),
  })
  log(`integrationRead=${integration.read} listed=${integration.listed} source=${integration.source}`)

  const engine = deps.resolveEngine(deps.bin ?? 'opencode', fs)
  let tempDir
  try {
    tempDir = fs.mkdtempSync(path.join(deps.tmpdir, 'alcode-provider-preflight-'))
  } catch {
    return createVerdict({
      status: 'unreachable',
      failedLayer: 'engine',
      provider,
      providerName,
      model,
      authRecordExists,
      reason: 'temp_dir_failed',
      providerListedInIntegration: integration.listed,
      integrationRead: integration.read,
    })
  }

  try {
    const env = engineEnv(deps.env, tempDir)
    if (!engine) {
      return createVerdict({
        status: 'unreachable',
        failedLayer: 'engine',
        provider,
        providerName,
        model,
        authRecordExists,
        reason: 'engine_not_found',
        providerListedInIntegration: integration.listed,
        integrationRead: integration.read,
      })
    }

    const engineConfig = await checkEngineConfig({ config, provider, engine, deps, env, cwd: tempDir })
    log(`engineConfig=${engineConfig.ok ? 'ok' : 'failed'}`)
    if (!engineConfig.ok) {
      return createVerdict({
        status: 'unreachable',
        failedLayer: 'engine',
        provider,
        providerName,
        model,
        authRecordExists,
        reason: engineConfig.reason,
        providerListedInIntegration: integration.listed,
        integrationRead: integration.read,
      })
    }

    const catalog = await readEngineCatalog({ provider, modelId, config, engine, deps, env, cwd: tempDir })
    const endpoint = catalog.endpoint
    const endpointReachable = endpoint ? await probeEndpoint(endpoint, deps.fetchImpl, deps.endpointTimeoutMs) : null
    log(`endpoint=${endpoint ? redact(endpoint, secrets) : 'unknown'} reachable=${endpointReachable}`)
    log(`catalogRead=${catalog.catalogRead} modelRegistered=${catalog.modelRegistered}`)

    // A config-declared custom provider is under-reported by this CLI surface, so
    // its missing catalog entry is advisory. A built-in provider has no such excuse.
    if (!declaredInConfig && catalog.catalogRead && catalog.modelRegistered === false) {
      return createVerdict({
        status: 'unreachable',
        failedLayer: 'registration',
        provider,
        providerName,
        model,
        authRecordExists,
        endpoint,
        endpointReachable,
        reason: 'model_not_registered',
        providerListedInIntegration: integration.listed,
        integrationRead: integration.read,
      })
    }

    const args = [...engine.argsPrefix, 'run', '--pure', '--model', model, '--format', 'json', '--log-level', 'ERROR', PROMPT]
    let attempts = 0
    let verdict = { status: 'unreachable', failedLayer: 'credentials', providerError: null, retryable: false, reason: 'not_run' }
    while (attempts < 2) {
      attempts += 1
      const result = await runEngine(engine.command, args, {
        cwd: tempDir,
        env,
        timeoutMs: deps.timeoutMs,
        spawnImpl: deps.spawn,
      })
      verdict = classifyRun(result)
      log(`attempt=${attempts} status=${verdict.status}${verdict.reason ? ` reason=${verdict.reason}` : ''}`)
      if (verdict.status === 'ok' || verdict.status === 'auth_expired' || !verdict.retryable) break
    }

    // Layer 4 owns the live provider connection, so transport and provider
    // errors land there unless the engine says the model itself is unavailable.
    const failedLayer =
      verdict.status === 'ok'
        ? integration.read && integration.listed === false
          ? 'catalog'
          : 'none'
        : (verdict.failedLayer ?? 'credentials')

    return createVerdict({
      status: verdict.status,
      failedLayer,
      provider,
      providerName,
      model,
      authRecordExists,
      endpoint,
      endpointReachable,
      providerListedInIntegration: integration.listed,
      integrationRead: integration.read,
      providerError: redact(verdict.providerError, secrets),
      attempts,
      reason: verdict.reason,
      statusCode: verdict.statusCode,
    })
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // The engine may still hold a file handle on Windows; the OS temp cleaner wins later.
    }
  }
}

export async function main(options = {}) {
  const write = options.write ?? ((chunk) => process.stdout.write(chunk))
  const verdict = await runPreflight(options)
  write(`${JSON.stringify(verdict)}\n`)
  return verdict
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (entry === fileURLToPath(import.meta.url)) {
  try {
    const verdict = await main()
    process.exitCode = EXIT_CODES[verdict.status] ?? 1
  } catch {
    process.stdout.write(
      `${JSON.stringify({
        status: 'unreachable',
        failedLayer: 'engine',
        provider: null,
        providerName: null,
        model: null,
        authRecordExists: false,
        endpoint: null,
        endpointReachable: null,
        providerListedInIntegration: null,
        integrationRead: false,
        providerError: null,
        attempts: 0,
        reason: 'internal_error',
      })}\n`,
    )
    process.exitCode = EXIT_CODES.unreachable
  }
}
