process.env.NODE_ENV = 'development'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { EventEmitter, getEventListeners } = require('node:events')
const childProcess = require('node:child_process')

const servicePath = require.resolve('../../src/app/server/fleet-status-service')
const sessionProcessPath = require.resolve('../../src/app/server/session-process')
const clientUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/fleet-status-client.js'
)).href
const probesUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/server-status/server-status-probes.js'
)).href
const fleetProbesPath = require.resolve('../../src/app/common/fleet-status-probes')
const findFreePortPath = require.resolve('find-free-port')
const originalFork = childProcess.fork
const originalFindFreePort = require(findFreePortPath)

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor (predicate, message = 'condition') {
  const deadline = Date.now() + 1000
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${message}`)
    }
    await delay(2)
  }
}

function target (index, extra = {}) {
  return {
    id: `target-${index}`,
    title: `Server ${index}`,
    connection: {
      host: `10.0.0.${index + 1}`,
      port: 22,
      username: 'ops',
      password: `secret-${index}`,
      ...extra
    }
  }
}

function createHarness ({ connectDelay = 0, runProbeBatch } = {}) {
  const opened = []
  const closed = []
  const active = new Set()
  const connecting = new Map()
  const terminals = new Map()

  async function openTerminal (options) {
    opened.push(options)
    active.add(options.uid)
    if (connectDelay) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, connectDelay)
        connecting.set(options.uid, {
          reject: error => {
            clearTimeout(timer)
            reject(error)
          }
        })
      })
      connecting.delete(options.uid)
    }
    if (!active.has(options.uid)) {
      const error = new Error('connection cancelled')
      error.name = 'AbortError'
      throw error
    }
    terminals.set(options.uid, {
      runCmd: async () => ({ stdout: 'ok', code: 0 })
    })
    return { pid: options.uid }
  }

  function getTerminal (pid) {
    return terminals.get(pid) || null
  }

  async function closeTerminal (pid) {
    if (!active.has(pid)) return false
    closed.push(pid)
    active.delete(pid)
    terminals.delete(pid)
    const pending = connecting.get(pid)
    if (pending) {
      connecting.delete(pid)
      const error = new Error('connection cancelled')
      error.name = 'AbortError'
      pending.reject(error)
    }
    return true
  }

  return {
    opened,
    closed,
    active,
    openTerminal,
    getTerminal,
    closeTerminal,
    runProbeBatch: runProbeBatch || (async () => [{ id: 'system', status: 'success' }])
  }
}

test.afterEach(() => {
  childProcess.fork = originalFork
  require.cache[findFreePortPath].exports = originalFindFreePort
  delete require.cache[servicePath]
  delete require.cache[sessionProcessPath]
  delete require.cache[fleetProbesPath]
})

test('collects 12 targets with default and maximum concurrency of five', async () => {
  let running = 0
  let maxRunning = 0
  const harness = createHarness({
    runProbeBatch: async () => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      await delay(15)
      running -= 1
      return [{ id: 'system', status: 'success' }]
    }
  })
  const { createFleetStatusService } = require(servicePath)
  const service = createFleetStatusService(harness)

  const result = await service.collect({
    taskId: 'batch-12',
    targets: Array.from({ length: 12 }, (_, index) => target(index)),
    probeIds: ['system'],
    concurrency: 99
  })

  assert.equal(maxRunning, 5)
  assert.equal(result.results.length, 12)
  assert.ok(result.results.every(item => item.status === 'success'))
  assert.equal(harness.active.size, 0)
  assert.equal(harness.opened.length, 12)
  for (const options of harness.opened) {
    assert.equal(options.enableSsh, false)
    assert.equal(options.saveTerminalLogToFile, false)
    assert.deepEqual(options.sshTunnels, [])
    assert.equal(options.x11, false)
    assert.match(options.uid, /^fleet-status-batch-12-/)
  }
})

test('a target timeout is aggregated without blocking successful targets', async () => {
  const harness = createHarness({
    runProbeBatch: async (runCmd, options) => {
      if (options.target.id === 'target-1') return new Promise(() => {})
      await delay(2)
      return [{ id: 'system', status: 'success' }]
    }
  })
  const { createFleetStatusService } = require(servicePath)
  const service = createFleetStatusService(harness)

  const result = await service.collect({
    taskId: 'partial-timeout',
    targets: [target(0), target(1), target(2)],
    probeIds: ['system'],
    targetTimeoutMs: 25,
    totalTimeoutMs: 200
  })

  assert.deepEqual(result.results.map(item => item.status), [
    'success',
    'timeout',
    'success'
  ])
  assert.equal(result.results[1].error.code, 'TARGET_TIMEOUT')
  assert.equal(harness.active.size, 0)
})

test('cancel during connect closes the connecting terminal and is duplicate-safe', async () => {
  const harness = createHarness({ connectDelay: 500 })
  const { createFleetStatusService } = require(servicePath)
  const service = createFleetStatusService(harness)
  const collection = service.collect({
    taskId: 'cancel-connect',
    targets: [target(0)],
    probeIds: ['system']
  })
  await waitFor(() => harness.opened.length === 1, 'connection start')

  const first = await service.cancel('cancel-connect')
  const second = await service.cancel('cancel-connect')
  const result = await collection

  assert.equal(first.cancelled, true)
  assert.equal(second.cancelled, true)
  assert.equal(result.results[0].status, 'cancelled')
  assert.equal(harness.closed.length, 1)
  assert.equal(harness.active.size, 0)
})

test('cancel during command prevents queued targets from connecting', async () => {
  let commandStarted = false
  const harness = createHarness({
    runProbeBatch: async () => {
      commandStarted = true
      return new Promise(() => {})
    }
  })
  const { createFleetStatusService } = require(servicePath)
  const service = createFleetStatusService(harness)
  const collection = service.collect({
    taskId: 'cancel-command',
    targets: [target(0), target(1), target(2), target(3)],
    probeIds: ['system'],
    concurrency: 1
  })
  await waitFor(() => commandStarted, 'probe command')

  await service.cancel('cancel-command')
  const result = await collection

  assert.equal(harness.opened.length, 1)
  assert.ok(result.results.every(item => item.status === 'cancelled'))
  assert.equal(harness.active.size, 0)
})

test('websocket close cancels its collection and leaves no temporary sessions', async () => {
  const request = new EventEmitter()
  request.once = () => {}
  let commandStarted = false
  const harness = createHarness({
    runProbeBatch: async () => {
      commandStarted = true
      return new Promise(() => {})
    }
  })
  const { createFleetStatusService } = require(servicePath)
  const service = createFleetStatusService(harness)
  const collection = service.collect({
    taskId: 'ws-close',
    targets: [target(0), target(1)],
    probeIds: ['system'],
    concurrency: 1,
    totalTimeoutMs: 100
  }, request)
  await waitFor(() => commandStarted, 'probe command')

  request.emit('close')
  const result = await collection

  assert.equal(harness.opened.length, 1)
  assert.ok(result.results.every(item => item.status === 'cancelled'))
  assert.equal(harness.active.size, 0)
})

test('rejects arbitrary commands and probe ids before opening a connection', async () => {
  const harness = createHarness()
  const { createFleetStatusService } = require(servicePath)
  const service = createFleetStatusService(harness)

  await assert.rejects(service.collect({
    taskId: 'bad-command',
    targets: [target(0)],
    probeIds: ['system'],
    command: 'rm -rf /'
  }), error => error.code === 'INVALID_REQUEST')
  await assert.rejects(service.collect({
    taskId: 'bad-probe',
    targets: [target(0)],
    probeIds: ['system; reboot']
  }), error => error.code === 'INVALID_PROBE_ID')
  await assert.rejects(service.collect({
    taskId: 'nested-command',
    targets: [target(0, { cmd: 'shutdown -h now' })],
    probeIds: ['system']
  }), error => error.code === 'INVALID_REQUEST')

  assert.equal(harness.opened.length, 0)
})

test('rejects non-whitelisted request fields before opening a connection', async () => {
  const harness = createHarness()
  const { createFleetStatusService } = require(servicePath)
  const service = createFleetStatusService(harness)
  const requests = [
    {
      taskId: 'top-level-exec',
      targets: [target(0)],
      probeIds: ['system'],
      exec: 'hostname'
    },
    {
      taskId: 'target-run',
      targets: [{ ...target(0), run: 'hostname' }],
      probeIds: ['system']
    },
    {
      taskId: 'connection-command',
      targets: [target(0, { command: 'hostname' })],
      probeIds: ['system']
    },
    {
      taskId: 'hopping-script',
      targets: [target(0, {
        connectionHoppings: [{ host: 'jump.internal', script: 'hostname' }]
      })],
      probeIds: ['system']
    },
    {
      taskId: 'unknown-metadata',
      targets: [target(0)],
      probeIds: ['system'],
      metadata: { label: 'not part of the request schema' }
    }
  ]

  for (const request of requests) {
    await assert.rejects(
      service.collect(request),
      error => error.code === 'INVALID_REQUEST'
    )
  }
  assert.equal(harness.opened.length, 0)
})

test('accepts the complete whitelisted collection request structure', async () => {
  const harness = createHarness()
  const { createFleetStatusService } = require(servicePath)
  const service = createFleetStatusService(harness)

  const result = await service.collect({
    action: 'collect-fleet-status',
    taskId: 'allowed-request',
    targets: [{
      id: 'allowed-target',
      title: 'Allowed target',
      connection: {
        host: 'allowed.internal',
        port: 22,
        username: 'ops',
        password: 'secret',
        privateKey: 'key',
        passphrase: 'phrase',
        certificate: 'certificate',
        encode: 'utf8',
        useSshAgent: false,
        sshAgent: '',
        serverHostKey: ['ssh-ed25519 AAAA'],
        cipher: ['aes256-gcm'],
        compress: true,
        isMFA: false,
        ignoreKeyboardInteractive: false,
        interactiveValues: '',
        hasHopping: true,
        connectionHoppings: [{
          host: 'jump.internal',
          port: 22,
          username: 'jump',
          password: 'jump-secret'
        }],
        readyTimeout: 12000,
        keepaliveCountMax: 3,
        keepaliveInterval: 1000,
        proxy: '',
        term: 'xterm-256color',
        envLang: 'en_US.UTF-8'
      }
    }],
    probeIds: ['system', 'resources'],
    concurrency: 2,
    targetTimeoutMs: 30000,
    totalTimeoutMs: 30000
  })

  assert.equal(result.status, 'completed')
  assert.equal(harness.opened.length, 1)
})

test('dispatch boundary strips only the wsFetch transport id from a real collection message', async () => {
  const {
    collectionInputFromMessage,
    createFleetStatusService
  } = require(servicePath)
  const message = {
    id: 'ws-fetch-transport-id',
    action: 'collect-fleet-status',
    taskId: 'transport-message',
    targets: [target(0)],
    probeIds: ['system']
  }
  const input = collectionInputFromMessage(message)
  const harness = createHarness()
  const service = createFleetStatusService(harness)

  assert.equal(input.id, undefined)
  assert.equal(input.taskId, message.taskId)
  const result = await service.collect(input)
  assert.equal(result.status, 'completed')
  assert.equal(harness.opened.length, 1)

  await assert.rejects(
    service.collect(collectionInputFromMessage({ ...message, exec: 'hostname' })),
    error => error.code === 'INVALID_REQUEST'
  )
  assert.equal(harness.opened.length, 1)
})

test('recursively removes sensitive fields and unsafe error details from results', async () => {
  const harness = createHarness({
    runProbeBatch: async () => [{
      id: 'system',
      status: 'success',
      password: 'probe-password',
      nested: {
        privateKey: 'PRIVATE KEY DATA',
        apiKey: 'api-secret',
        note: 'password=inline-secret',
        commandLine: 'worker --token cli-value',
        keyBlock: '-----BEGIN PRIVATE KEY-----\nPEM-DATA\n-----END PRIVATE KEY-----',
        endpoint: 'ssh://user:url-pass@example.com',
        postgres: 'postgres://dbuser:pg-pass@db.internal/app',
        mongodb: 'mongodb://mongo:mongo-pass@db.internal/admin',
        customUri: 'custom+ssl://agent:custom-pass@service.internal',
        rawOutput: 'raw password=raw-secret'
      },
      stack: 'stack with token=stack-secret'
    }]
  })
  const { createFleetStatusService } = require(servicePath)
  const service = createFleetStatusService(harness)
  const result = await service.collect({
    taskId: 'redaction',
    targets: [target(0, { passphrase: 'phrase-secret' })],
    probeIds: ['system']
  })
  const serialized = JSON.stringify(result)

  assert.doesNotMatch(serialized, /secret|PRIVATE KEY DATA|PEM-DATA|cli-value|url-pass|pg-pass|mongo-pass|custom-pass|passphrase|password|apiKey|token|stack/i)
  assert.equal('rawOutput' in result.results[0].probes[0].nested, false)
  assert.equal(result.results[0].target.host, '10.0.0.1')
})

test('server and client redact complete quoted assignment and cookie values containing spaces', async () => {
  const { redactSensitive } = require(servicePath)
  const serverResult = redactSensitive({
    note: 'password="server alpha beta" token=\'server gamma delta\' Cookie = "server cookie double tail" cookie=\'server cookie single tail\''
  })
  const { createFleetStatusClient } = await import(`${clientUrl}?quoted=${Date.now()}`)
  const client = createFleetStatusClient({
    request: async () => ({
      note: 'password="client alpha beta" token=\'client gamma delta\' cookie = "client cookie double tail" Cookie=\'client cookie single tail\''
    }),
    applyProfileToTabs: value => value,
    config: {}
  })
  const clientResult = await client.collect({
    taskId: 'quoted-redaction',
    bookmarks: [target(0)],
    probeIds: ['system']
  })
  const serialized = JSON.stringify({ serverResult, clientResult })

  assert.equal(serverResult.note, '[REDACTED] [REDACTED] [REDACTED] [REDACTED]')
  assert.equal(clientResult.note, '[REDACTED] [REDACTED] [REDACTED] [REDACTED]')
  assert.doesNotMatch(serialized, /server alpha|beta|server gamma|delta|cookie double|cookie single|tail|client alpha|client gamma/i)
})

test('server and client redact complete authorization and multi-value cookie headers', async () => {
  const { redactSensitive } = require(servicePath)
  const serverResult = redactSensitive({
    key: 'SERVER_OBJECT_KEY',
    basic: 'Authorization: Basic dXNlcjpwYXNz',
    bearer: 'Authorization: Bearer server-token with-spaces',
    multi: 'Cookie: session=SERVER_FIRST; refresh=SERVER_SECOND',
    spaced: 'Cookie: session="SERVER QUOTED"; refresh="SERVER TAIL"',
    assignedBasic: 'Authorization=Basic SERVER_BASIC with-spaces',
    assignedBearer: 'Authorization=Bearer SERVER_TOPSECRET with-spaces',
    equalsMulti: 'Cookie=session=SERVER_COOKIE_FIRST; refresh=SERVER_COOKIE_SECOND'
  })
  const { createFleetStatusClient } = await import(`${clientUrl}?headers=${Date.now()}`)
  const client = createFleetStatusClient({
    request: async () => ({
      key: 'CLIENT_OBJECT_KEY',
      basic: 'Authorization: Basic Y2xpZW50OnBhc3M=',
      bearer: 'Authorization: Custom client-token with-spaces',
      multi: 'Cookie: session=CLIENT_FIRST; refresh=CLIENT_SECOND',
      spaced: 'Cookie: session="CLIENT QUOTED"; refresh="CLIENT TAIL"',
      assignedBasic: 'Authorization=Basic CLIENT_BASIC with-spaces',
      assignedBearer: 'Authorization=Bearer CLIENT_TOPSECRET with-spaces',
      equalsMulti: 'Cookie=session=CLIENT_COOKIE_FIRST; refresh=CLIENT_COOKIE_SECOND'
    }),
    applyProfileToTabs: value => value,
    config: {}
  })
  const clientResult = await client.collect({
    taskId: 'header-redaction',
    bookmarks: [target(0)],
    probeIds: ['system']
  })
  const serialized = JSON.stringify({ serverResult, clientResult })

  assert.doesNotMatch(serialized, /dXNlcj|Y2xpZW|server-token|client-token|(?:SERVER|CLIENT)_(?:OBJECT_KEY|BASIC|TOPSECRET|COOKIE_(?:FIRST|SECOND)|FIRST|SECOND|QUOTED|TAIL)/i)
  for (const result of [serverResult, clientResult]) {
    assert.equal(Object.hasOwn(result, 'key'), false)
    assert.deepEqual(Object.values(result), [
      '[REDACTED]',
      '[REDACTED]',
      '[REDACTED]',
      '[REDACTED]',
      '[REDACTED]',
      '[REDACTED]',
      '[REDACTED]'
    ])
  }
})

test('server and client redact compound sensitive CLI option values without hiding service identity', async () => {
  const execStart = '/usr/bin/worker --client-secret="client secret tail" --db-password db-password-value --oauth-client-token=oauth-token-value --log-level info'
  const { redactSensitive } = require(servicePath)
  const serverResult = redactSensitive({
    service: {
      name: 'worker.service',
      execStart
    }
  })
  const { createFleetStatusClient } = await import(`${clientUrl}?compound-cli=${Date.now()}`)
  const client = createFleetStatusClient({
    request: async () => ({
      service: {
        name: 'worker.service',
        execStart
      }
    }),
    applyProfileToTabs: value => value,
    config: {}
  })
  const clientResult = await client.collect({
    taskId: 'compound-cli-redaction',
    bookmarks: [target(0)],
    probeIds: ['services']
  })
  const serialized = JSON.stringify({ serverResult, clientResult })

  assert.equal(serverResult.service.name, 'worker.service')
  assert.equal(clientResult.service.name, 'worker.service')
  assert.doesNotMatch(
    serialized,
    /client secret tail|db-password-value|oauth-token-value/i
  )
})

test('successful probe commands restore abort listeners to the batch baseline', async () => {
  let listenerDelta
  const harness = createHarness({
    runProbeBatch: async (runCommand, { signal }) => {
      await Promise.resolve()
      const baseline = getEventListeners(signal, 'abort').length
      for (let index = 0; index < 20; index += 1) {
        await runCommand(`probe-${index}`)
      }
      listenerDelta = getEventListeners(signal, 'abort').length - baseline
      return [{ id: 'system', status: 'success' }]
    }
  })
  const { createFleetStatusService } = require(servicePath)
  const service = createFleetStatusService(harness)

  const result = await service.collect({
    taskId: 'listener-cleanup',
    targets: [target(0)],
    probeIds: ['system']
  })

  assert.equal(result.status, 'completed')
  assert.equal(listenerDelta, 0)
})

test('fixed probe timeout actively cancels the command once and cleans both abort signals', async () => {
  const { createFleetStatusService } = require(servicePath)
  const { runFleetStatusProbes } = require(fleetProbesPath)
  const cancelIds = []
  let commandOptions
  let targetSignal
  let probeSignal
  const service = createFleetStatusService({
    openTerminal: async options => ({ pid: options.uid }),
    getTerminal: () => ({
      runCmd: async (command, executionId, options) => {
        commandOptions = options
        return new Promise(() => {})
      },
      cancelRunCmd: async executionId => {
        cancelIds.push(executionId)
        return true
      }
    }),
    closeTerminal: async () => true,
    runProbeBatch: (runCmd, options) => {
      targetSignal = options.signal
      return runFleetStatusProbes((command, probeOptions) => {
        probeSignal = probeOptions.signal
        return runCmd(command, probeOptions)
      }, {
        probeIds: options.probeIds,
        concurrency: 1,
        signal: options.signal
      })
    }
  })
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (callback, milliseconds, ...args) => {
    return originalSetTimeout(callback, milliseconds === 8000 ? 5 : milliseconds, ...args)
  }
  let result
  try {
    result = await service.collect({
      taskId: 'probe-timeout-cancel',
      targets: [target(0)],
      probeIds: ['system']
    })
  } finally {
    global.setTimeout = originalSetTimeout
  }

  assert.equal(result.results[0].probes[0].status, 'timeout')
  assert.equal(cancelIds.length, 1)
  assert.ok(commandOptions.signal)
  assert.equal(commandOptions.signal.aborted, true)
  assert.equal(getEventListeners(targetSignal, 'abort').length, 0)
  assert.equal(getEventListeners(probeSignal, 'abort').length, 0)
})

test('target cancellation joins the probe signal without duplicate command cancellation', async () => {
  const { createFleetStatusService } = require(servicePath)
  const { runFleetStatusProbes } = require(fleetProbesPath)
  const cancelIds = []
  let commandOptions
  let commandStarted = false
  let targetSignal
  let probeSignal
  const service = createFleetStatusService({
    openTerminal: async options => ({ pid: options.uid }),
    getTerminal: () => ({
      runCmd: async (command, executionId, options) => {
        commandOptions = options
        commandStarted = true
        return new Promise(() => {})
      },
      cancelRunCmd: async executionId => {
        cancelIds.push(executionId)
        return true
      }
    }),
    closeTerminal: async () => true,
    runProbeBatch: (runCmd, options) => {
      targetSignal = options.signal
      return runFleetStatusProbes((command, probeOptions) => {
        probeSignal = probeOptions.signal
        return runCmd(command, probeOptions)
      }, {
        probeIds: options.probeIds,
        concurrency: 1,
        signal: options.signal
      })
    }
  })
  const collection = service.collect({
    taskId: 'target-and-probe-cancel',
    targets: [target(0)],
    probeIds: ['system']
  })
  await waitFor(() => commandStarted, 'probe command start')

  await service.cancel('target-and-probe-cancel')
  const result = await collection
  await waitFor(() => {
    return getEventListeners(targetSignal, 'abort').length === 0 &&
      getEventListeners(probeSignal, 'abort').length === 0
  }, 'abort listener cleanup')

  assert.equal(result.results[0].status, 'cancelled')
  assert.equal(cancelIds.length, 1)
  assert.ok(commandOptions.signal)
  assert.equal(commandOptions.signal.aborted, true)
})

test('cancel validates task ids and redacts every response', async () => {
  const harness = createHarness()
  let redactCalls = 0
  const { createFleetStatusService } = require(servicePath)
  const service = createFleetStatusService({
    ...harness,
    redact: value => {
      redactCalls += 1
      return { ...value, redacted: true }
    }
  })

  const result = await service.cancel('valid-task-id')

  assert.equal(result.redacted, true)
  assert.equal(redactCalls, 1)
  await assert.rejects(
    service.cancel({ password: 'object-secret' }),
    error => error.code === 'INVALID_TASK_ID' && !/object-secret/.test(error.message)
  )
  await assert.rejects(
    service.cancel('bad task id with password=string-secret'),
    error => error.code === 'INVALID_TASK_ID' && !/string-secret/.test(error.message)
  )
})

test('packaged runtime can load fixed probes without client source files', async () => {
  const sourceApp = path.resolve(__dirname, '../../src/app')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-status-runtime-'))
  const runtimeApp = path.join(tempRoot, 'app')
  const sourceProbePath = path.join(sourceApp, 'common/fleet-status-probes.js')
  const sourceInventoryPath = path.join(sourceApp, 'common/fleet-service-inventory.js')
  const runtimeProbePath = path.join(runtimeApp, 'common/fleet-status-probes.js')
  const runtimeInventoryPath = path.join(runtimeApp, 'common/fleet-service-inventory.js')
  const runtimeServicePath = path.join(runtimeApp, 'server/fleet-status-service.js')
  try {
    assert.equal(fs.existsSync(sourceProbePath), true)
    assert.equal(fs.existsSync(sourceInventoryPath), true)
    fs.mkdirSync(path.dirname(runtimeProbePath), { recursive: true })
    fs.mkdirSync(path.dirname(runtimeServicePath), { recursive: true })
    fs.copyFileSync(sourceProbePath, runtimeProbePath)
    fs.copyFileSync(sourceInventoryPath, runtimeInventoryPath)
    fs.copyFileSync(servicePath, runtimeServicePath)
    const runtimeProbes = require(runtimeProbePath)
    const runtimeService = require(runtimeServicePath)
    const forbidden = /\b(?:sudo|su|rm|mv|cp|touch|mkdir|chmod|chown|tee|sed\s+-i|systemctl\s+(?:start|stop|restart|enable|disable)|service\s+\S+\s+(?:start|stop|restart)|firewall-cmd\s+--(?:add|remove)|ufw\s+(?:allow|deny|delete)|iptables\s+-[AIFDX]|nft\s+(?:add|delete|flush))\b/i
    const commands = []
    const results = await runtimeProbes.runFleetStatusProbes(async (command, options) => {
      commands.push({ command, options })
      return { stdout: '', stderr: '', code: 0 }
    }, { probeIds: ['system'] })
    const serviceSource = fs.readFileSync(runtimeServicePath, 'utf8')

    assert.equal(results[0].id, 'system')
    for (const probe of runtimeProbes.fleetStatusProbes) {
      assert.equal(forbidden.test(probe.command), false, `${probe.id} must remain read-only`)
      assert.ok(probe.timeoutMs >= 1000 && probe.timeoutMs <= 30000)
      assert.ok(probe.maxOutputBytes >= 1024 && probe.maxOutputBytes <= 128 * 1024)
    }
    assert.deepEqual(runtimeService.ALLOWED_PROBE_IDS, [
      'system',
      'resources',
      'services',
      'network',
      'firewall',
      'security',
      'containers'
    ])
    assert.equal(commands.length, 1)
    assert.ok(commands[0].options.maxOutputBytes > 0)
    assert.doesNotMatch(serviceSource, /src[\\/]client|client[\\/]components|\bimport\s*\(/)
    assert.match(serviceSource, /require\('\.\.\/common\/fleet-status-probes'\)/)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('fixed service probes do not collect arbitrary ExecStart command lines', async () => {
  const { fleetStatusProbes } = require(fleetProbesPath)
  const fleetServiceProbe = fleetStatusProbes.find(probe => probe.id === 'services')
  const { serverStatusProbes } = await import(`${probesUrl}?service-command=${Date.now()}`)
  const serverServiceProbe = serverStatusProbes.find(probe => probe.id === 'services')

  assert.doesNotMatch(fleetServiceProbe.command, /ExecStart/i)
  assert.doesNotMatch(serverServiceProbe.command, /ExecStart/i)
  assert.match(fleetServiceProbe.command, /Id,Description,LoadState,ActiveState,SubState,FragmentPath,WorkingDirectory/)
  assert.match(serverServiceProbe.command, /Id,Description,LoadState,ActiveState,SubState,FragmentPath,WorkingDirectory/)
})

test('uses the pid returned by openTerminal for probes and cleanup', async () => {
  const requestedPids = []
  const closedPids = []
  const { createFleetStatusService } = require(servicePath)
  const service = createFleetStatusService({
    openTerminal: async () => ({ pid: 'returned-session-pid' }),
    getTerminal: pid => {
      requestedPids.push(pid)
      return { runCmd: async () => ({ stdout: 'ok', code: 0 }) }
    },
    closeTerminal: async pid => {
      closedPids.push(pid)
      return true
    },
    runProbeBatch: async runCmd => {
      await runCmd('fixed-read-only-command', {
        timeoutMs: 100,
        maxOutputBytes: 1024
      })
      return [{ id: 'system', status: 'success' }]
    }
  })

  await service.collect({
    taskId: 'returned-pid',
    targets: [target(0)],
    probeIds: ['system']
  })

  assert.deepEqual(requestedPids, ['returned-session-pid'])
  assert.ok(closedPids.includes('returned-session-pid'))
})

test('dispatch center exposes only fixed fleet actions with safe error responses', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/app/server/dispatch-center.js'
  ), 'utf8')

  assert.match(source, /action === 'collect-fleet-status'/)
  assert.match(source, /action === 'cancel-fleet-status'/)
  assert.match(source, /collectionInputFromMessage\(msg\)/)
  assert.match(source, /fleetStatusService\.cancel\(msg\.taskId\)/)
  assert.match(source, /FLEET_STATUS_ERROR/)
  assert.doesNotMatch(source, /fleet[^\n]*stack|stack[^\n]*fleet/i)
})

test('client applies profiles and global SSH settings without returning secrets', async () => {
  const { createFleetStatusClient } = await import(`${clientUrl}?profile=${Date.now()}`)
  let sent
  const bookmark = {
    id: 'bookmark-1',
    title: 'Production',
    host: 'prod.internal',
    port: 22,
    username: 'root',
    authType: 'profiles',
    profile: 'profile-1'
  }
  const client = createFleetStatusClient({
    request: async payload => {
      sent = payload
      return {
        taskId: payload.taskId,
        results: [{
          status: 'success',
          password: 'response-password',
          nested: {
            privateKey: 'response-key',
            value: 'safe',
            commandLine: 'worker --api-key client-cli-value',
            database: 'mongodb://client:client-uri-secret@db.internal/app',
            rawOutput: 'password=client-raw-secret'
          }
        }]
      }
    },
    applyProfileToTabs: value => ({
      ...value,
      password: 'profile-password',
      privateKey: 'profile-key',
      keepaliveInterval: 2222
    }),
    config: {
      sshReadyTimeout: 12345,
      keepaliveInterval: 4321,
      keepaliveCountMax: 7,
      enableGlobalProxy: true,
      proxy: 'socks5://127.0.0.1:1080'
    },
    createTaskId: () => 'client-task'
  })

  const result = await client.collect({
    bookmarks: [bookmark],
    probeIds: ['system']
  })

  assert.equal(sent.action, 'collect-fleet-status')
  assert.equal(sent.taskId, 'client-task')
  assert.equal(sent.targets[0].connection.password, 'profile-password')
  assert.equal(sent.targets[0].connection.privateKey, 'profile-key')
  assert.equal(sent.targets[0].connection.readyTimeout, 12000)
  assert.equal(sent.targets[0].connection.keepaliveInterval, 2222)
  assert.equal(sent.targets[0].connection.keepaliveCountMax, 7)
  assert.equal(sent.targets[0].connection.proxy, 'socks5://127.0.0.1:1080')
  assert.equal(sent.targetTimeoutMs, 30000)
  assert.equal(sent.totalTimeoutMs, 30000)
  assert.equal(bookmark.password, undefined)
  assert.doesNotMatch(
    JSON.stringify(result),
    /password|privateKey|response-key|client-cli-value|client-uri-secret|client-raw-secret|rawOutput/i
  )

  await client.cancel('client-task')
  assert.equal(sent.action, 'cancel-fleet-status')
  assert.equal(sent.taskId, 'client-task')
})

test('client exposes a stable credential-free identity for resolved profile connections', async () => {
  const { createFleetStatusClient } = await import(`${clientUrl}?identity=${Date.now()}`)
  const bookmark = {
    id: 'profile-bookmark',
    profile: 'shared-profile',
    host: 'bookmark-host'
  }
  let profile = {
    host: 'resolved-a.internal',
    port: 22,
    username: 'alice',
    password: 'password-one',
    privateKey: 'private-key-one',
    proxy: 'socks5://proxy-user:proxy-password-one@proxy-a.internal:1080',
    connectionHoppings: [{
      host: 'hop-a.internal',
      port: 2222,
      username: 'jump-user',
      password: 'hop-password-one'
    }]
  }
  const client = createFleetStatusClient({
    request: async () => ({}),
    applyProfileToTabs: value => ({ ...value, ...profile }),
    config: {
      enableGlobalProxy: true,
      proxy: 'socks5://global:global-secret@global-proxy.internal:1080',
      keepaliveInterval: 1000,
      keepaliveCountMax: 3
    }
  })
  assert.equal(typeof client.connectionIdentity, 'function')
  const first = client.connectionIdentity(bookmark)

  profile = {
    ...profile,
    host: 'resolved-b.internal',
    username: 'bob',
    proxy: 'socks5://proxy-user:proxy-password-two@proxy-b.internal:1080',
    connectionHoppings: [{
      ...profile.connectionHoppings[0],
      host: 'hop-b.internal',
      password: 'hop-password-two'
    }]
  }
  const changedConnection = client.connectionIdentity(bookmark)

  profile = {
    ...profile,
    password: 'password-three',
    privateKey: 'private-key-three',
    passphrase: 'passphrase-three',
    certificate: 'certificate-three',
    interactiveValues: ['otp-three'],
    proxy: 'socks5://proxy-user:proxy-password-three@proxy-b.internal:1080',
    connectionHoppings: [{
      ...profile.connectionHoppings[0],
      password: 'hop-password-three',
      privateKey: 'hop-private-key-three'
    }]
  }
  const changedSecretsOnly = client.connectionIdentity(bookmark)
  const serialized = JSON.stringify([first, changedConnection, changedSecretsOnly])

  assert.equal(typeof first, 'string')
  assert.notEqual(first, changedConnection)
  assert.equal(changedConnection, changedSecretsOnly)
  assert.doesNotMatch(
    serialized,
    /password-(?:one|two|three)|private-key|passphrase|certificate|otp-three|global-secret|proxy-user|jump-user@/i
  )
  assert.match(changedConnection, /resolved-b\.internal/)
  assert.match(changedConnection, /proxy-b\.internal/)
  assert.match(changedConnection, /hop-b\.internal/)
})

test('scheme-less proxy identity removes userinfo and ignores secret changes', async () => {
  const { createFleetStatusClient } = await import(`${clientUrl}?scheme-less-proxy=${Date.now()}`)
  let proxy = 'proxy-user:proxy-password-one@proxy.internal:1080'
  const client = createFleetStatusClient({
    request: async () => ({}),
    applyProfileToTabs: value => ({ ...value, proxy }),
    config: {}
  })
  const bookmark = { id: 'proxy-target', host: 'server.internal' }
  const first = client.connectionIdentity(bookmark)
  proxy = 'proxy-user:proxy-password-two@proxy.internal:1080'
  const second = client.connectionIdentity(bookmark)
  const serialized = JSON.stringify([first, second])

  assert.equal(first, second)
  assert.doesNotMatch(
    serialized,
    /proxy-user|proxy-password-(?:one|two)|[^/]@proxy\.internal/i
  )
  assert.match(first, /proxy\.internal:1080/)
})

test('server status runner passes the real maximum output limit to the SSH run layer', async () => {
  const { runServerStatusProbes } = await import(`${probesUrl}?limit=${Date.now()}`)
  let receivedOptions
  const probes = [{
    id: 'bounded',
    command: 'fixed-read-only-command',
    timeoutMs: 1000,
    maxOutputBytes: 2048,
    parse: output => output
  }]

  await runServerStatusProbes(async (command, options) => {
    receivedOptions = options
    return { stdout: 'ok', code: 0 }
  }, { probes })

  assert.equal(receivedOptions.maxOutputBytes, 2048)
})

test('empty fixed probe output is explicit no-data and never parses empty numbers as zero', async () => {
  const { runFleetStatusProbes } = require(fleetProbesPath)
  const fleetResults = await runFleetStatusProbes(async () => ({
    stdout: '',
    stderr: '',
    code: 0
  }), { probeIds: ['system'] })
  const { runServerStatusProbes } = await import(`${probesUrl}?empty=${Date.now()}`)
  let parsed = false
  const serverResults = await runServerStatusProbes(async () => ({
    stdout: '',
    stderr: '',
    code: 0
  }), {
    probes: [{
      id: 'empty',
      command: 'fixed-read-only-command',
      timeoutMs: 8000,
      maxOutputBytes: 1024,
      parse: () => {
        parsed = true
        return { value: 0 }
      }
    }]
  })

  assert.equal(fleetResults[0].status, 'pending')
  assert.equal(fleetResults[0].data, null)
  assert.equal(serverResults[0].status, 'pending')
  assert.equal(serverResults[0].data, null)
  assert.equal(parsed, false)
})

test('partial system and resource output keeps every absent numeric value null', async () => {
  const { fleetStatusProbes } = require(fleetProbesPath)
  const system = fleetStatusProbes.find(probe => probe.id === 'system')
  const resources = fleetStatusProbes.find(probe => probe.id === 'resources')

  const systemData = system.parse('__HOSTNAME__\npartial.internal\n')
  const resourceData = resources.parse('__MEMINFO__\nMemTotal:       2048 kB\n')
  const { serverStatusProbes } = await import(probesUrl + '?partial-system=' + Date.now())
  const singleSystem = serverStatusProbes.find(probe => probe.id === 'system')
  const singleSystemData = singleSystem.parse('__HOSTNAME__\nsingle.internal\n')

  assert.equal(systemData.hostname, 'partial.internal')
  assert.equal(systemData.cpuCores, null)
  assert.equal(systemData.uptimeSeconds, null)
  assert.equal(singleSystemData.hostname, 'single.internal')
  assert.equal(singleSystemData.cpuCores, null)
  assert.equal(singleSystemData.uptimeSeconds, null)
  assert.deepEqual(resourceData.load, {
    one: null,
    five: null,
    fifteen: null
  })
  assert.deepEqual(resourceData.memory, {
    totalBytes: 2 * 1024 * 1024,
    availableBytes: null,
    freeBytes: null
  })
  assert.deepEqual(resourceData.swap, {
    totalBytes: null,
    freeBytes: null
  })
})

test('single server status resources keeps every missing load number null', async () => {
  const { serverStatusProbes } = await import(probesUrl + '?partial-resources=' + Date.now())
  const resources = serverStatusProbes.find(probe => probe.id === 'resources')
  const data = resources.parse('__MEMINFO__\nMemTotal:       2048 kB\n')

  assert.deepEqual(data.load, {
    one: null,
    five: null,
    fifteen: null
  })
  assert.deepEqual(data.memory, {
    totalBytes: 2 * 1024 * 1024,
    availableBytes: null,
    freeBytes: null
  })
  assert.deepEqual(data.swap, {
    totalBytes: null,
    freeBytes: null
  })
})

test('fleet filesystem keeps missing inode numbers as explicit null fields', () => {
  const { fleetStatusProbes } = require(fleetProbesPath)
  const resources = fleetStatusProbes.find(probe => probe.id === 'resources')
  const data = resources.parse([
    '__FILESYSTEMS__',
    'Filesystem 1-blocks Used Available Capacity Mounted on',
    '/dev/sda1 1000 500 500 50% /',
    ''
  ].join('\n'))

  assert.deepEqual(data.filesystems, [{
    filesystem: '/dev/sda1',
    totalBytes: 1000,
    usedBytes: 500,
    availableBytes: 500,
    usedPercent: 50,
    mount: '/',
    inodes: null,
    inodesUsed: null,
    inodesFree: null,
    inodeUsedPercent: null
  }])
})

test('fleet collection uses the fixed 12s connection 8s probe and 30s batch budgets', async () => {
  const harness = createHarness()
  const {
    createFleetStatusService,
    FLEET_STATUS_TIMEOUTS
  } = require(servicePath)
  const service = createFleetStatusService(harness)
  await service.collect({
    taskId: 'fixed-budgets',
    targets: [target(0, { readyTimeout: 60000 })],
    probeIds: ['system'],
    targetTimeoutMs: 60000,
    totalTimeoutMs: 60000
  })
  const { fleetStatusProbes } = require(fleetProbesPath)
  const { createFleetStatusClient } = await import(`${clientUrl}?budgets=${Date.now()}`)
  let sent
  const client = createFleetStatusClient({
    request: async payload => {
      sent = payload
      return { taskId: payload.taskId, results: [] }
    },
    applyProfileToTabs: value => value,
    config: { sshReadyTimeout: 60000 }
  })
  await client.collect({
    taskId: 'client-fixed-budgets',
    bookmarks: [target(0)],
    probeIds: ['system']
  })

  assert.deepEqual(FLEET_STATUS_TIMEOUTS, {
    connectionMs: 12000,
    probeMs: 8000,
    targetMs: 30000,
    totalMs: 30000
  })
  assert.equal(harness.opened[0].readyTimeout, 12000)
  assert.ok(fleetStatusProbes.every(probe => probe.timeoutMs === 8000))
  assert.equal(sent.targets[0].connection.readyTimeout, 12000)
  assert.equal(sent.targetTimeoutMs, 30000)
  assert.equal(sent.totalTimeoutMs, 30000)
})

test('connection failures retain safe host-key auth permission and timeout categories', async () => {
  const failures = new Map([
    ['10.0.0.1', ['HOST_KEY_MISMATCH', 'host key mismatch password="host secret"']],
    ['10.0.0.2', ['AUTHENTICATION_FAILED', 'authentication failed token="auth secret"']],
    ['10.0.0.3', ['EACCES', 'permission denied privateKey="key secret"']],
    ['10.0.0.4', ['ETIMEDOUT', 'handshake timeout password="timeout secret"']]
  ])
  const { createFleetStatusService } = require(servicePath)
  const service = createFleetStatusService({
    openTerminal: async options => {
      const [code, message] = failures.get(options.host)
      const error = new Error(message)
      error.code = code
      error.stack = `unsafe stack ${message}`
      throw error
    },
    getTerminal: () => null,
    closeTerminal: async () => true,
    runProbeBatch: async () => []
  })
  const result = await service.collect({
    taskId: 'safe-errors',
    targets: [target(0), target(1), target(2), target(3)],
    probeIds: ['system']
  })

  assert.deepEqual(result.results.map(item => [
    item.error.code,
    item.error.category,
    item.status
  ]), [
    ['HOST_KEY_MISMATCH', 'host-key', 'error'],
    ['AUTH_FAILED', 'auth', 'error'],
    ['PERMISSION_DENIED', 'permission', 'error'],
    ['CONNECTION_TIMEOUT', 'timeout', 'timeout']
  ])
  assert.doesNotMatch(JSON.stringify(result), /host secret|auth secret|key secret|timeout secret|unsafe stack|privateKey|password|token/i)
})

test('generic connection and probe failures use only the fixed unknown category', async () => {
  const { createFleetStatusService } = require(servicePath)
  const connectionService = createFleetStatusService({
    openTerminal: async () => {
      throw new Error('socket closed unexpectedly')
    },
    getTerminal: () => null,
    closeTerminal: async () => true,
    runProbeBatch: async () => []
  })
  const unavailableService = createFleetStatusService({
    openTerminal: async options => ({ pid: options.uid }),
    getTerminal: () => null,
    closeTerminal: async () => true,
    runProbeBatch: async () => []
  })
  const probeService = createFleetStatusService(createHarness({
    runProbeBatch: async () => {
      throw new Error('unexpected probe failure')
    }
  }))

  const results = await Promise.all([
    connectionService.collect({
      taskId: 'generic-connection',
      targets: [target(0)],
      probeIds: ['system']
    }),
    unavailableService.collect({
      taskId: 'terminal-unavailable',
      targets: [target(0)],
      probeIds: ['system']
    }),
    probeService.collect({
      taskId: 'generic-probe',
      targets: [target(0)],
      probeIds: ['system']
    })
  ])

  assert.deepEqual(results.map(result => [
    result.results[0].error.code,
    result.results[0].error.category
  ]), [
    ['CONNECTION_FAILED', 'unknown'],
    ['TERMINAL_UNAVAILABLE', 'unknown'],
    ['PROBE_FAILED', 'unknown']
  ])
})

function installFork ({
  earlyExit = false,
  holdRunCmd = false,
  emitExitOnKill = true
} = {}) {
  const children = []
  childProcess.fork = () => {
    const child = new EventEmitter()
    child.connected = true
    child.killed = false
    child.killCalls = []
    child.kill = signal => {
      child.killCalls.push(signal || 'SIGTERM')
      child.killed = true
      child.connected = false
      if (emitExitOnKill) {
        queueMicrotask(() => child.emit('exit', 0, signal || 'SIGTERM'))
      }
      return true
    }
    child.send = payload => {
      if (payload?.data?.action === 'create-terminal') {
        queueMicrotask(() => child.emit('message', {
          id: payload.data.id,
          data: { connected: true }
        }))
      } else if (payload?.data?.action === 'run-cmd' && !holdRunCmd) {
        queueMicrotask(() => child.emit('message', {
          id: payload.data.id,
          data: { stdout: 'ok', code: 0 }
        }))
      }
    }
    children.push(child)
    queueMicrotask(() => {
      if (earlyExit) child.emit('exit', 1, null)
      else child.emit('message', { serverInited: true })
    })
    return child
  }
  return children
}

function installControlledFork () {
  const children = []
  childProcess.fork = (_modulePath, options) => {
    const child = new EventEmitter()
    child.label = `child-${children.length}`
    child.connected = true
    child.killed = false
    child.emitExitOnKill = true
    child.killCalls = []
    child.sent = []
    child.wsPort = Number(options?.env?.wsPort)
    child.kill = signal => {
      child.killCalls.push(signal || 'SIGTERM')
      child.killed = true
      child.connected = false
      if (child.emitExitOnKill) {
        queueMicrotask(() => child.emit('exit', 0, signal || 'SIGTERM'))
      }
      return true
    }
    child.send = (payload, callback) => {
      child.sent.push(payload)
      if (payload?.data?.action === 'run-cmd') {
        queueMicrotask(() => child.emit('message', {
          id: payload.data.id,
          data: { label: child.label, stdout: 'ok', code: 0 }
        }))
      }
      if (typeof callback === 'function') queueMicrotask(() => callback(null))
    }
    children.push(child)
    return child
  }
  return children
}

async function finishControlledConnection (child, { error } = {}) {
  child.emit('message', { serverInited: true })
  await waitFor(() => child.sent.some(payload => payload?.data?.action === 'create-terminal'), 'create-terminal request')
  const request = child.sent.find(payload => payload?.data?.action === 'create-terminal')
  child.emit('message', error
    ? { id: request.data.id, error: { message: error } }
    : { id: request.data.id, data: { connected: true } })
}

function createTrackedWs () {
  const ws = new EventEmitter()
  ws.sent = []
  ws.s = value => ws.sent.push(value)
  ws.addEventListener = (type, listener) => ws.on(type, listener)
  ws.removeEventListener = (type, listener) => ws.removeListener(type, listener)
  ws.once = (callback, id) => {
    const listener = event => {
      const value = JSON.parse(event.data)
      if (value.id !== id) return
      callback(value)
      ws.removeEventListener('message', listener)
    }
    ws.addEventListener('message', listener)
  }
  return ws
}

test('failed same-uid replacement preserves the previous active SSH session', async () => {
  const children = installControlledFork()
  const sessionProcess = require(sessionProcessPath)
  const first = sessionProcess.terminal({ uid: 'replace-me', host: 'old' }, null, 'old-request')
  await waitFor(() => children.length === 1, 'first child')
  await finishControlledConnection(children[0])
  await first

  const replacement = sessionProcess.terminal({ uid: 'replace-me', host: 'new' }, null, 'new-request')
  await waitFor(() => children.length === 2, 'replacement child')
  await finishControlledConnection(children[1], { error: 'replacement failed' })
  await assert.rejects(replacement, /replacement failed/)

  const result = await sessionProcess.getTerminal('replace-me')
    .runCmd('fixed-read-only-command', 'old-still-active')
  assert.equal(result.label, 'child-0')
  assert.equal(children[0].killCalls.length, 0)
  assert.equal(children[1].killCalls.length, 1)
  await sessionProcess.closeTerminal('replace-me')
})

test('latest same-uid connection remains active when an older request finishes last', async () => {
  const children = installControlledFork()
  const sessionProcess = require(sessionProcessPath)
  const first = sessionProcess.terminal({ uid: 'concurrent-uid', host: 'first' }, null, 'first-request')
  const firstOutcome = first.then(value => ({ value }), error => ({ error }))
  await waitFor(() => children.length === 1, 'first concurrent child')
  const second = sessionProcess.terminal({ uid: 'concurrent-uid', host: 'second' }, null, 'second-request')
  const secondOutcome = second.then(value => ({ value }), error => ({ error }))
  await waitFor(() => children.length === 2, 'second concurrent child')
  await finishControlledConnection(children[1])
  await second
  await finishControlledConnection(children[0])
  const outcomes = await Promise.all([firstOutcome, secondOutcome])

  assert.match(outcomes[0].error?.message || '', /superseded/i)
  assert.ok(outcomes[1].value && !outcomes[1].error)
  const result = await sessionProcess.getTerminal('concurrent-uid')
    .runCmd('fixed-read-only-command', 'latest-active')
  assert.equal(result.label, 'child-1')
  assert.equal(children[0].killCalls.length, 1)
  assert.equal(children[1].killCalls.length, 0)
  await sessionProcess.closeTerminal('concurrent-uid')
})

test('concurrent port probes reserve the actual returned port until each child binds', async () => {
  const callbacks = []
  const starts = []
  require.cache[findFreePortPath].exports = (start, host, callback) => {
    starts.push(start)
    if (callbacks.length < 2) {
      callbacks.push(callback)
      return
    }
    queueMicrotask(() => callback(null, start))
  }
  const children = installControlledFork()
  const sessionProcess = require(sessionProcessPath)
  const first = sessionProcess.terminal({ uid: 'port-a', host: 'first' }, null, 'port-a-request')
  const second = sessionProcess.terminal({ uid: 'port-b', host: 'second' }, null, 'port-b-request')
  await waitFor(() => callbacks.length === 2, 'concurrent free-port probes')

  callbacks[0](null, 32000)
  callbacks[1](null, 32000)
  await waitFor(() => children.length === 2, 'children with reserved ports')
  await Promise.all(children.map(child => finishControlledConnection(child)))
  const opened = await Promise.all([first, second])

  assert.equal(new Set(opened.map(item => item.port)).size, 2)
  assert.equal(new Set(children.map(child => child.wsPort)).size, 2)
  assert.ok(starts.length >= 3)
  await Promise.all([
    sessionProcess.closeTerminal('port-a'),
    sessionProcess.closeTerminal('port-b')
  ])
})

test('closeTerminal cancels a pending connection before it becomes active', async () => {
  const children = installControlledFork()
  const sessionProcess = require(sessionProcessPath)
  const connecting = sessionProcess.terminal({ uid: 'pending-close', host: 'pending' }, null, 'pending-request')
  await waitFor(() => children.length === 1, 'pending child')

  assert.equal(await sessionProcess.closeTerminal('pending-close'), true)
  await assert.rejects(connecting, /exited|closed|disconnect/i)
  assert.equal(children[0].killCalls.length, 1)
  assert.equal(sessionProcess.getTerminal('pending-close'), null)
})

test('repeated MFA listeners are disposed after close timeout and ignore late replies', async () => {
  const children = installControlledFork()
  const ws = createTrackedWs()
  const sessionProcess = require(sessionProcessPath)
  const connection = sessionProcess.terminal({ uid: 'mfa-timeout', host: 'mfa' }, ws, 'mfa-request')
  await waitFor(() => children.length === 1, 'MFA child')
  await finishControlledConnection(children[0])
  await connection
  children[0].emitExitOnKill = false
  children[0].emit('message', { type: 'common', data: { id: 'mfa-1' } })
  children[0].emit('message', { type: 'common', data: { id: 'mfa-2' } })
  assert.equal(ws.listenerCount('message'), 2)
  ws.emit('message', { data: JSON.stringify({ id: 'mfa-1', answer: 'one' }) })
  assert.equal(ws.listenerCount('message'), 1)

  await sessionProcess.closeTerminal('mfa-timeout', { timeoutMs: 5 })
  const sentBeforeLateReply = children[0].sent.length
  ws.emit('message', { data: JSON.stringify({ id: 'mfa-2', answer: 'late' }) })

  assert.equal(ws.listenerCount('message'), 0)
  assert.equal(children[0].sent.length, sentBeforeLateReply)
})

test('MFA listeners are disposed when the session child disconnects', async () => {
  const children = installControlledFork()
  const ws = createTrackedWs()
  const sessionProcess = require(sessionProcessPath)
  const connection = sessionProcess.terminal({ uid: 'mfa-disconnect', host: 'mfa' }, ws, 'mfa-request')
  await waitFor(() => children.length === 1, 'disconnect child')
  await finishControlledConnection(children[0])
  await connection
  children[0].emit('message', { type: 'common', data: { id: 'mfa-disconnect-1' } })
  assert.equal(ws.listenerCount('message'), 1)

  children[0].connected = false
  children[0].emit('disconnect')
  const sentBeforeLateReply = children[0].sent.length
  ws.emit('message', { data: JSON.stringify({ id: 'mfa-disconnect-1', answer: 'late' }) })

  assert.equal(ws.listenerCount('message'), 0)
  assert.equal(children[0].sent.length, sentBeforeLateReply)
  assert.equal(sessionProcess.getTerminal('mfa-disconnect'), null)
})

test('a disconnected child that ignores SIGTERM remains tracked through force kill', async () => {
  const children = installFork({ emitExitOnKill: false })
  const sessionProcess = require(sessionProcessPath)
  await sessionProcess.terminal({
    uid: 'disconnect-stubborn',
    host: '127.0.0.1',
    port: 22,
    username: 'root',
    enableSsh: false
  }, null, 'disconnect-stubborn')

  children[0].connected = false
  children[0].emit('disconnect')
  const closed = await sessionProcess.closeTerminal('disconnect-stubborn')

  assert.equal(closed, true)
  assert.deepEqual(children[0].killCalls, ['SIGTERM', 'SIGKILL'])
  assert.equal(sessionProcess.getTerminal('disconnect-stubborn'), null)
  assert.equal(await sessionProcess.closeTerminal('disconnect-stubborn'), false)
})

test('session child early exit rejects connection and removes the active terminal', async () => {
  installFork({ earlyExit: true })
  const sessionProcess = require(sessionProcessPath)

  await assert.rejects(sessionProcess.terminal({
    uid: 'early-exit',
    host: '127.0.0.1',
    port: 22,
    username: 'root',
    enableSsh: false
  }, null, 'early-exit'))

  assert.equal(sessionProcess.getTerminal('early-exit'), null)
})

test('session child exit rejects a pending command promise', async () => {
  const children = installFork({ holdRunCmd: true })
  const sessionProcess = require(sessionProcessPath)
  await sessionProcess.terminal({
    uid: 'pending-command',
    host: '127.0.0.1',
    port: 22,
    username: 'root',
    enableSsh: false
  }, null, 'pending-command')

  const command = sessionProcess.getTerminal('pending-command')
    .runCmd('fixed-read-only-command', 'command-1', {
      timeoutMs: 1000,
      maxOutputBytes: 1024
    })
  queueMicrotask(() => children[0].emit('exit', 1, null))

  await assert.rejects(command, /exited|disconnected/i)
  assert.equal(sessionProcess.getTerminal('pending-command'), null)
})

test('session closeTerminal is asynchronous and idempotent', async () => {
  const children = installFork()
  const sessionProcess = require(sessionProcessPath)
  await sessionProcess.terminal({
    uid: 'close-once',
    host: '127.0.0.1',
    port: 22,
    username: 'root',
    enableSsh: false
  }, null, 'close-once')

  const first = sessionProcess.closeTerminal('close-once')
  const second = sessionProcess.closeTerminal('close-once')
  assert.equal(first, second)
  await Promise.all([first, second])

  assert.equal(children[0].killCalls.length, 1)
  assert.equal(sessionProcess.getTerminal('close-once'), null)
  assert.equal(await sessionProcess.closeTerminal('close-once'), false)
})

test('session closeTerminal force kills a child that does not exit', async () => {
  const children = installFork({ emitExitOnKill: false })
  const sessionProcess = require(sessionProcessPath)
  await sessionProcess.terminal({
    uid: 'force-close',
    host: '127.0.0.1',
    port: 22,
    username: 'root',
    enableSsh: false
  }, null, 'force-close')

  await sessionProcess.closeTerminal('force-close', { timeoutMs: 5 })

  assert.deepEqual(children[0].killCalls, ['SIGTERM', 'SIGKILL'])
  assert.equal(sessionProcess.getTerminal('force-close'), null)
})
