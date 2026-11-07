import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { EXIT_CODES, main } from './provider-preflight.mjs'
import { asString } from './wire-values.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-preflight-test-'))
  roots.push(root)
  const paths = {}
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name)
    const text = asString(content)
    fs.writeFileSync(file, text !== null ? text : JSON.stringify(content))
    paths[name] = file
  }
  return { root, paths }
}

function fakeChild({ stdout = '', stderr = '', exitCode = 0 }) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {}
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout))
    if (stderr) child.stderr.emit('data', Buffer.from(stderr))
    child.emit('close', exitCode)
  })
  return child
}

function recordingSpawn(respond) {
  const calls = []
  const spawn = (command, args, options) => {
    calls.push({ command, args: [...args], options: { cwd: options.cwd, env: options.env, shell: options.shell } })
    return respond(args, calls.length)
  }
  return { calls, spawn }
}

const engineStub = () => ({ command: 'opencode', argsPrefix: [] })

function catalogFor(provider, id) {
  return `${provider}/${id}\n${JSON.stringify({
    id,
    providerID: provider,
    api: { url: 'https://fake-provider.test/v1' },
  })}`
}

function integrationResponse(ids) {
  return { status: 200, json: async () => ({ data: ids.map((id) => ({ id })) }) }
}

function integrationFetch({ ids = null, endpointStatus = 200 } = {}) {
  return async (url) => {
    if (url.includes('/api/integration')) {
      if (ids === null) throw new Error('connect ECONNREFUSED')
      return integrationResponse(ids)
    }
    return { status: endpointStatus }
  }
}

const baseOptions = (root, paths, extra = {}) => ({
  configPath: paths['opencode.json'],
  authPath: paths['auth.json'],
  resolveEngine: engineStub,
  env: {},
  home: root,
  tmpdir: root,
  write: () => {},
  ...extra,
})

test('an expired key maps to auth_expired once at credentials, and the seeded sentinel reaches no argv, output, or log', async () => {
  const sentinel = 'SENTINEL_DO_NOT_LEAK_7f3a9c'
  const { root, paths } = fixture({
    'opencode.json': { model: 'fake-provider/fake-model' },
    'auth.json': { 'fake-provider': { type: 'api', key: sentinel } },
  })
  const { calls, spawn } = recordingSpawn((args) => {
    if (args[0] === 'debug') return fakeChild({ stdout: '{}' })
    if (args[0] === 'models') return fakeChild({ stdout: catalogFor('fake-provider', 'fake-model') })
    return fakeChild({
      stdout: `${JSON.stringify({
        type: 'error',
        error: {
          name: 'APIError',
          data: {
            message: `401 unauthorized: the API key ${sentinel} has expired`,
            statusCode: 401,
            isRetryable: false,
          },
        },
      })}\n`,
      exitCode: 1,
    })
  })

  const output = []
  const logs = []
  const verdict = await main(
    baseOptions(root, paths, {
      spawn,
      env: { PATH: 'C:\\fake' },
      integrationUrl: 'http://integration.test',
      fetchImpl: async () => ({ status: 401 }),
      write: (chunk) => output.push(chunk),
      log: (line) => logs.push(line),
    }),
  )

  assert.equal(verdict.status, 'auth_expired')
  assert.equal(verdict.failedLayer, 'credentials')
  assert.equal(verdict.provider, 'fake-provider')
  assert.equal(verdict.model, 'fake-provider/fake-model')
  assert.equal(verdict.authRecordExists, true)
  assert.equal(verdict.endpoint, 'https://fake-provider.test/v1')
  assert.equal(verdict.endpointReachable, true)
  assert.equal(verdict.providerListedInIntegration, null)
  assert.equal(verdict.integrationRead, false)
  assert.match(verdict.providerError, /expired/)
  assert.doesNotMatch(verdict.providerError, new RegExp(sentinel))
  assert.equal(verdict.attempts, 1)

  const runCalls = calls.filter((call) => call.args[0] === 'run')
  assert.equal(runCalls.length, 1, 'an authentication failure is not retried')
  assert.equal(calls.filter((call) => call.args[0] === 'debug').length, 1)
  assert.equal(calls.filter((call) => call.args[0] === 'models').length, 1)
  assert.ok(runCalls[0].args.includes('--model'))
  assert.ok(runCalls[0].args.includes('fake-provider/fake-model'))

  const everything = [output.join(''), logs.join('\n'), JSON.stringify(verdict), JSON.stringify(calls)].join('\n')
  assert.ok(everything.length > 0)
  assert.ok(!everything.includes(sentinel), 'the credential must not appear in output, logs, env, or argv')
  assert.equal(EXIT_CODES.auth_expired, 1)
})

test('a minimal successful call with a listed provider reports ok at every layer', async () => {
  const { root, paths } = fixture({
    'opencode.json': { model: 'fake-provider/fake-model' },
    'auth.json': { 'fake-provider': { type: 'api', key: 'sk-fake-valid-key-0001' } },
  })
  const { calls, spawn } = recordingSpawn((args) => {
    if (args[0] === 'debug') return fakeChild({ stdout: '{}' })
    if (args[0] === 'models') return fakeChild({ stdout: catalogFor('fake-provider', 'fake-model') })
    return fakeChild({ stdout: `${JSON.stringify({ type: 'text', text: 'pong' })}\n`, exitCode: 0 })
  })

  const verdict = await main(
    baseOptions(root, paths, {
      spawn,
      integrationUrl: 'http://integration.test',
      fetchImpl: integrationFetch({ ids: ['fake-provider'] }),
    }),
  )

  assert.equal(verdict.status, 'ok')
  assert.equal(verdict.failedLayer, 'none')
  assert.equal(verdict.providerListedInIntegration, true)
  assert.equal(verdict.integrationRead, true)
  assert.equal(verdict.attempts, 1)
  assert.equal(calls.filter((call) => call.args[0] === 'run').length, 1)
  assert.equal(EXIT_CODES.ok, 0)
})

test('a connection failure reports unreachable at credentials without a second attempt', async () => {
  const { root, paths } = fixture({
    'opencode.json': { model: 'fake-provider/fake-model' },
    'auth.json': { 'fake-provider': { type: 'api', key: 'sk-fake-valid-key-0002' } },
  })
  const { calls, spawn } = recordingSpawn((args) => {
    if (args[0] === 'debug') return fakeChild({ stdout: '{}' })
    if (args[0] === 'models') return fakeChild({ stdout: catalogFor('fake-provider', 'fake-model') })
    return fakeChild({
      stdout: `${JSON.stringify({
        type: 'error',
        error: { data: { message: 'fetch failed: connect ECONNREFUSED 127.0.0.1:1', isRetryable: false } },
      })}\n`,
      exitCode: 1,
    })
  })

  const verdict = await main(
    baseOptions(root, paths, {
      spawn,
      integrationUrl: 'http://integration.test',
      endpointTimeoutMs: 50,
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED')
      },
    }),
  )

  assert.equal(verdict.status, 'unreachable')
  assert.equal(verdict.failedLayer, 'credentials')
  assert.equal(verdict.endpointReachable, false)
  assert.equal(verdict.providerListedInIntegration, null)
  assert.equal(verdict.integrationRead, false)
  assert.equal(verdict.reason, 'connection_error')
  assert.equal(verdict.attempts, 1)
  assert.equal(calls.filter((call) => call.args[0] === 'run').length, 1)
  assert.equal(EXIT_CODES.unreachable, 3)
})

test('a config without model reports no_provider at config and never starts the engine', async () => {
  const { root, paths } = fixture({
    'opencode.json': { provider: {} },
    'auth.json': {},
  })
  const { calls, spawn } = recordingSpawn(() => fakeChild({}))

  const verdict = await main(baseOptions(root, paths, { spawn }))

  assert.equal(verdict.status, 'no_provider')
  assert.equal(verdict.failedLayer, 'config')
  assert.equal(verdict.reason, 'model_not_configured')
  assert.equal(verdict.authRecordExists, false)
  assert.equal(verdict.providerListedInIntegration, null)
  assert.equal(verdict.integrationRead, false)
  assert.equal(calls.length, 0)
  assert.equal(EXIT_CODES.no_provider, 2)
})

test('a configured endpoint is reported without userinfo or query and a missing catalog entry is advisory for a declared provider', async () => {
  const { root, paths } = fixture({
    'opencode.json': {
      model: 'local/model-a',
      provider: { local: { name: 'Local', options: { baseURL: 'https://user:secretpass@api.example.test/v1?token=abc' } } },
    },
    'auth.json': {},
  })
  const { calls, spawn } = recordingSpawn((args) => {
    if (args[0] === 'debug') return fakeChild({ stdout: JSON.stringify({ provider: { local: { name: 'Local' } } }) })
    if (args[0] === 'models') return fakeChild({ stdout: '' })
    return fakeChild({
      stdout: `${JSON.stringify({
        type: 'error',
        error: { data: { message: 'unauthorized: missing credentials', statusCode: 401, isRetryable: false } },
      })}\n`,
      exitCode: 1,
    })
  })
  const probed = []
  const fetchImpl = async (url) => {
    probed.push(url)
    if (url.includes('/api/integration')) return integrationResponse(['other'])
    return { status: 403 }
  }

  const verdict = await main(baseOptions(root, paths, { spawn, integrationUrl: 'http://integration.test', fetchImpl }))

  assert.equal(verdict.providerName, 'Local')
  assert.equal(verdict.endpoint, 'https://api.example.test/v1')
  assert.equal(verdict.endpointReachable, true)
  assert.equal(verdict.status, 'auth_expired')
  assert.equal(verdict.failedLayer, 'credentials')
  assert.equal(verdict.providerListedInIntegration, false)
  assert.equal(verdict.integrationRead, true)
  assert.ok(probed.includes('https://api.example.test/'))
  assert.equal(calls.filter((call) => call.args[0] === 'models').length, 1)
  assert.ok(!calls.some((call) => JSON.stringify(call).includes('secretpass')))
})

test('an unreadable engine config reports engine before registration or credentials', async () => {
  const { root, paths } = fixture({
    'opencode.json': { model: 'fake-provider/fake-model' },
    'auth.json': {},
  })
  const { calls, spawn } = recordingSpawn((args) => {
    if (args[0] === 'debug') return fakeChild({ stdout: '', stderr: 'config failed', exitCode: 1 })
    return fakeChild({})
  })

  const verdict = await main(
    baseOptions(root, paths, {
      spawn,
      integrationUrl: 'http://integration.test',
      fetchImpl: integrationFetch({ ids: null }),
    }),
  )

  assert.equal(verdict.status, 'unreachable')
  assert.equal(verdict.failedLayer, 'engine')
  assert.equal(verdict.reason, 'engine_config_unavailable')
  assert.equal(verdict.attempts, 0)
  assert.equal(calls.filter((call) => call.args[0] === 'debug').length, 1)
  assert.equal(calls.filter((call) => call.args[0] === 'models').length, 0)
  assert.equal(calls.filter((call) => call.args[0] === 'run').length, 0)
})

test('a built-in model absent from the engine catalog reports registration before any provider call', async () => {
  const { root, paths } = fixture({
    'opencode.json': { model: 'builtin/missing-model' },
    'auth.json': {},
  })
  const { calls, spawn } = recordingSpawn((args) => {
    if (args[0] === 'debug') return fakeChild({ stdout: '{}' })
    if (args[0] === 'models') return fakeChild({ stdout: catalogFor('builtin', 'other-model') })
    return fakeChild({ exitCode: 0 })
  })

  const verdict = await main(baseOptions(root, paths, { spawn, integrationUrl: 'http://integration.test', fetchImpl: integrationFetch({ ids: null }) }))

  assert.equal(verdict.status, 'unreachable')
  assert.equal(verdict.failedLayer, 'registration')
  assert.equal(verdict.reason, 'model_not_registered')
  assert.equal(verdict.attempts, 0)
  assert.equal(calls.filter((call) => call.args[0] === 'run').length, 0)
})

test('a provider listed in a readable integration list is still reported as a registration failure', async () => {
  const { root, paths } = fixture({
    'opencode.json': { model: 'builtin/missing-model' },
    'auth.json': {},
  })
  const { calls, spawn } = recordingSpawn((args) => {
    if (args[0] === 'debug') return fakeChild({ stdout: '{}' })
    if (args[0] === 'models') return fakeChild({ stdout: catalogFor('builtin', 'other-model') })
    return fakeChild({ exitCode: 0 })
  })

  const verdict = await main(
    baseOptions(root, paths, {
      spawn,
      integrationUrl: 'http://integration.test',
      fetchImpl: integrationFetch({ ids: ['builtin'] }),
    }),
  )

  assert.equal(verdict.status, 'unreachable')
  assert.equal(verdict.failedLayer, 'registration')
  assert.equal(verdict.providerListedInIntegration, true)
  assert.equal(verdict.integrationRead, true)
  assert.equal(verdict.attempts, 0)
  assert.equal(calls.filter((call) => call.args[0] === 'run').length, 0)
})

test('a model the engine declines at call time reports registration, not credentials', async () => {
  const { root, paths } = fixture({
    'opencode.json': { model: 'builtin/model' },
    'auth.json': {},
  })
  const { spawn } = recordingSpawn((args) => {
    if (args[0] === 'debug') return fakeChild({ stdout: '{}' })
    if (args[0] === 'models') return fakeChild({ stdout: catalogFor('builtin', 'model') })
    return fakeChild({
      stdout: `${JSON.stringify({ type: 'error', error: { data: { message: 'Model unavailable: builtin/model' } } })}\n`,
      exitCode: 1,
    })
  })

  const verdict = await main(baseOptions(root, paths, { spawn, integrationUrl: 'http://integration.test', fetchImpl: integrationFetch({ ids: null }) }))

  assert.equal(verdict.status, 'unreachable')
  assert.equal(verdict.failedLayer, 'registration')
  assert.equal(verdict.reason, 'model_not_registered')
  assert.equal(verdict.attempts, 1)
})

test('a successful call for a provider missing from a readable integration list reports catalog and still exits 0', async () => {
  const { root, paths } = fixture({
    'opencode.json': { model: 'builtin/model' },
    'auth.json': {},
  })
  const { spawn } = recordingSpawn((args) => {
    if (args[0] === 'debug') return fakeChild({ stdout: '{}' })
    if (args[0] === 'models') return fakeChild({ stdout: catalogFor('builtin', 'model') })
    return fakeChild({ stdout: `${JSON.stringify({ type: 'text', text: 'pong' })}\n`, exitCode: 0 })
  })

  const verdict = await main(
    baseOptions(root, paths, {
      spawn,
      integrationUrl: 'http://integration.test',
      fetchImpl: integrationFetch({ ids: ['other'] }),
    }),
  )

  assert.equal(verdict.status, 'ok')
  assert.equal(verdict.failedLayer, 'catalog')
  assert.equal(verdict.providerListedInIntegration, false)
  assert.equal(verdict.integrationRead, true)
  assert.equal(verdict.attempts, 1)
  assert.equal(EXIT_CODES.ok, 0)
})
