const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const Module = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const appLogPath = path.join(root, 'src/app/common/log.js')
const appTracePath = path.join(root, 'src/app/lib/quality/trace-context.js')
const qualityLogPath = path.join(root, 'src/app/lib/quality/quality-log.js')
const clientTracePath = path.join(root, 'src/client/common/quality/trace-context.js')
const clientEventsPath = path.join(root, 'src/client/common/quality/quality-events.js')
const ipcPath = path.join(root, 'src/app/lib/ipc.js')

const credentialValues = {
  operationId: 'sk-live-secret',
  taskId: 'Bearer:auth-secret',
  requestId: 'api-key:relay-secret',
  sessionId: 'token:session-secret',
  tabId: 'password:server-secret',
  module: 'private-key:body-secret',
  action: 'Authorization:Bearer-token'
}

const credentialEventValues = {
  module: 'sk-live-secret',
  action: 'Bearer:auth-secret',
  phase: 'api-key:relay-secret',
  result: 'token:session-secret',
  messageCode: 'password:server-secret',
  reasonCode: 'private-key:body-secret',
  status: 'Authorization:Bearer-token'
}

const vendorCredentialValues = [
  'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
  'github_pat_11AA0_exampleToken1234567890',
  'AKIAIOSFODNN7EXAMPLE',
  'ASIAIOSFODNN7EXAMPLE',
  'AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe',
  'xoxb-123456789012-123456789012-example',
  'req_sk-live-embedded-secret'
]

const ordinaryStableValues = [
  'V1StGXR',
  'command-connect'
]

const ecdhEsDirectJwe = `${Buffer.from(JSON.stringify({
  alg: 'ECDH-ES',
  enc: 'A256GCM',
  epk: {
    kty: 'EC',
    crv: 'P-256',
    x: 'f83OJ3D2xF4u-s4P6eWcLZpD0wJ7GqXvN8mK5bT1aRc',
    y: 'x_FEzRu9m36HLN_tJ2pOSY6Y5vD4f1Q3B8cA7nM0kLs'
  }
})).toString('base64url')}..MTIzNDU2Nzg5MDEy.YWRtaW4tc2VjcmV0LWNsYWlt.c2lnbmF0dXJlLXRhZy0xMjM0NTY`

const ecdhEsKeyWrapWithEmptyKey = `${Buffer.from(JSON.stringify({
  alg: 'ECDH-ES+A256KW',
  enc: 'A256GCM',
  epk: { kty: 'EC', crv: 'P-256', x: 'eA', y: 'eQ' }
})).toString('base64url')}..MTIzNDU2Nzg5MDEy.Y2lwaGVydGV4dA.c2lnbmF0dXJlLXRhZy0xMjM0NTY`

const structuredCredentialValues = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJvcGVyYXRvciIsInNjb3BlIjoiYWRtaW4ifQ.4AvZQdZQ1ap0Z4Yw0o0JfrP6hPw8cY2zQ9xYkV7L0pM',
  `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'operator' })).toString('base64url')}.`,
  `${Buffer.from(JSON.stringify({ alg: 'dir', enc: 'A256GCM', typ: 'JWT' })).toString('base64url')}..MTIzNDU2Nzg5MDEy.YWRtaW4tc2VjcmV0LWNsYWlt.c2lnbmF0dXJlLXRhZy0xMjM0NTY`,
  ecdhEsDirectJwe,
  'v4.public.ZXlKemRXSWlPaUp2Y0dWeVlYUnZjaUo5cTF3MmUzcjR0NXk2dTdpOG85cDBhMXMyZDNmNGc1aDZqN2s4bDl6MHgxYw'
]

const ordinaryDottedIds = [
  'operation.service.v2',
  'request.eu-west-1.retry.2',
  'request.region.service.retry.2'
]

const unusualRandomByteCases = [
  {
    bytes: [-1, Number.NaN, 256, 15],
    suffix: '0000000f'
  },
  {
    bytes: [1],
    suffix: '01000000'
  }
]

const normalizationContractCases = [
  {
    name: 'allowed bounded fields',
    context: {
      traceId: 'sp-1784304000000-12345678',
      operationId: ' operation-1 ',
      module: 'sftp',
      action: 'upload',
      unsupported: 'drop-me'
    },
    event: {
      phase: 'finished',
      result: 'success',
      durationMs: 125.8,
      messageCode: 'sftp_upload_ok',
      unsupported: 'drop-me'
    }
  },
  {
    name: 'bounded and invalid values',
    context: {
      operationId: 'x'.repeat(200),
      requestId: 'contains spaces',
      tabId: 42
    },
    event: {
      messageCode: 'x'.repeat(200),
      reasonCode: 'contains spaces',
      count: Number.MAX_SAFE_INTEGER + 100,
      itemCount: -1
    }
  },
  {
    name: 'credential-shaped values',
    context: {
      traceId: 'sp-1784304000000-12345678',
      ...credentialValues
    },
    event: {
      ...credentialEventValues,
      durationMs: 10
    }
  },
  {
    name: 'non-record inputs',
    context: null,
    event: []
  }
]

const unsafeNowCases = [
  {
    name: 'oversized finite value',
    now: () => 1e21,
    expectedTimestamp: '0000000000000'
  },
  {
    name: 'infinite value',
    now: () => Number.POSITIVE_INFINITY
  },
  {
    name: 'negative value',
    now: () => -1
  },
  {
    name: 'throwing adapter',
    now: () => {
      throw new Error('clock unavailable')
    }
  }
]

const malformedTraceIds = [
  'trace-1784304000000-12345678',
  'sp-178430400000-12345678',
  'sp-1784304000000-1234567g',
  'SP-1784304000000-12345678',
  ' sp-1784304000000-12345678',
  'sp-1784304000000-12345678 '
]

function deterministicAdapters () {
  return {
    now: () => 1784304000000,
    randomBytes: () => Buffer.from('12345678', 'hex')
  }
}

function assertSafeTimestamps (createTraceContext) {
  for (const { name, now, expectedTimestamp } of unsafeNowCases) {
    let context
    assert.doesNotThrow(() => {
      context = createTraceContext({}, {
        now,
        randomBytes: () => Buffer.from('12345678', 'hex')
      })
    }, name)
    assert.match(context.traceId, /^sp-\d{13}-[0-9a-f]{8}$/, name)
    if (expectedTimestamp) {
      assert.equal(context.traceId, `sp-${expectedTimestamp}-12345678`, name)
    }
  }
}

function withGlobalCrypto (value, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value,
    writable: true
  })
  try {
    return callback()
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'crypto', descriptor)
    } else {
      delete globalThis.crypto
    }
  }
}

test('main trace context creates the stable id format', () => {
  const {
    createTraceContext
  } = require(appTracePath)

  const deterministic = createTraceContext({
    module: 'ssh',
    action: 'connect'
  }, deterministicAdapters())
  const generated = createTraceContext()

  assert.equal(deterministic.traceId, 'sp-1784304000000-12345678')
  assert.match(generated.traceId, /^sp-\d{13}-[0-9a-f]{8}$/)
})

test('main trace context normalizes unusual random adapter bytes', () => {
  const {
    createTraceContext
  } = require(appTracePath)

  for (const { bytes, suffix } of unusualRandomByteCases) {
    const context = createTraceContext({}, {
      now: () => 1784304000000,
      randomBytes: () => bytes
    })

    assert.equal(context.traceId, `sp-1784304000000-${suffix}`)
    assert.match(context.traceId, /^sp-\d{13}-[0-9a-f]{8}$/)
  }
})

test('main trace context absorbs random source failures', () => {
  const {
    createTraceContext
  } = require(appTracePath)
  const originalRandomBytes = crypto.randomBytes

  try {
    crypto.randomBytes = () => Buffer.from('cafebabe', 'hex')
    assert.equal(createTraceContext({}, {
      now: () => 1784304000000,
      randomBytes: () => {
        throw new Error('adapter failed')
      }
    }).traceId, 'sp-1784304000000-cafebabe')

    crypto.randomBytes = () => {
      throw new Error('secure random unavailable')
    }
    let context
    assert.doesNotThrow(() => {
      context = createTraceContext({}, {
        now: () => 1784304000000,
        randomBytes: () => {
          throw new Error('adapter failed')
        }
      })
    })
    assert.equal(context.traceId, 'sp-1784304000000-00000000')
  } finally {
    crypto.randomBytes = originalRandomBytes
  }
})

test('main trace context safely normalizes unstable clocks', () => {
  const {
    createTraceContext
  } = require(appTracePath)

  assertSafeTimestamps(createTraceContext)
})

test('main trace context replaces malformed seeded trace ids', () => {
  const {
    createTraceContext,
    normalizeTraceContext
  } = require(appTracePath)
  for (const traceId of malformedTraceIds) {
    assert.deepEqual(normalizeTraceContext({ traceId }), {})
    assert.equal(
      createTraceContext({ traceId }, deterministicAdapters()).traceId,
      'sp-1784304000000-12345678'
    )
  }
})

test('main trace context preserves parent ids and accepts only bounded fields', () => {
  const {
    childTraceContext,
    createTraceContext,
    normalizeTraceContext
  } = require(appTracePath)
  const parent = createTraceContext({
    module: 'ssh',
    action: 'connect',
    password: 'parent-secret'
  }, deterministicAdapters())

  const child = childTraceContext(parent, {
    traceId: 'sp-1111111111111-deadbeef',
    requestId: 'req-1',
    taskId: 'task-1',
    password: 'child-secret'
  })
  const normalized = normalizeTraceContext({
    ...child,
    operationId: 'x'.repeat(500),
    unsupported: 'drop-me'
  })

  assert.equal(child.traceId, parent.traceId)
  assert.equal(child.requestId, 'req-1')
  assert.equal(child.taskId, 'task-1')
  assert.equal('password' in child, false)
  assert.equal('unsupported' in normalized, false)
  assert.ok(normalized.operationId.length <= 128)
})

test('trace log fields exclude credentials, paths, and user content', () => {
  const {
    createTraceContext,
    toLogFields
  } = require(appTracePath)
  const context = createTraceContext({
    module: 'agent',
    action: 'run'
  }, deterministicAdapters())
  const fields = toLogFields({
    ...context,
    password: 'server-password',
    apiKey: 'sk-live-secret',
    Authorization: 'Bearer auth-secret',
    localPath: 'C:\\Users\\alice\\private.txt',
    requestId: 'C:\\Users\\alice\\private-request.txt',
    taskId: 'private terminal body',
    terminalInput: 'cat private.txt',
    terminalOutput: 'private terminal output',
    chatContent: 'private chat body',
    fileContent: 'private file body'
  })
  const serialized = JSON.stringify(fields)

  assert.deepEqual(fields, context)
  assert.doesNotMatch(serialized, /password|apiKey|Authorization|Users|private/i)
})

test('main trace context rejects credential-shaped allowed fields', () => {
  const {
    normalizeTraceContext
  } = require(appTracePath)
  const fields = normalizeTraceContext({
    traceId: 'sp-1784304000000-12345678',
    ...credentialValues
  })

  assert.deepEqual(fields, {
    traceId: 'sp-1784304000000-12345678'
  })
})

test('main quality surfaces reject vendor credentials and preserve ordinary ids', () => {
  const {
    normalizeTraceContext
  } = require(appTracePath)
  const {
    normalizeQualityEvent
  } = require(qualityLogPath)

  for (const value of vendorCredentialValues) {
    assert.deepEqual(normalizeTraceContext({ requestId: value }), {})
    assert.deepEqual(normalizeQualityEvent({ messageCode: value }), {})
  }

  for (const value of ordinaryStableValues) {
    assert.deepEqual(normalizeTraceContext({ requestId: value }), {
      requestId: value
    })
    assert.deepEqual(normalizeQualityEvent({ messageCode: value }), {
      messageCode: value
    })
  }
})

test('renderer trace context exposes the same deterministic behavior', async () => {
  const {
    childTraceContext,
    createTraceContext,
    normalizeTraceContext,
    toLogFields
  } = await import(pathToFileURL(clientTracePath))
  const context = createTraceContext({
    module: 'sftp',
    action: 'upload',
    privateKey: 'private-key-body'
  }, deterministicAdapters())
  const child = childTraceContext(context, {
    operationId: 'operation-1',
    terminalContent: 'user terminal body'
  })

  assert.equal(context.traceId, 'sp-1784304000000-12345678')
  assert.equal(child.traceId, context.traceId)
  assert.equal(child.operationId, 'operation-1')
  assert.deepEqual(toLogFields(child), normalizeTraceContext(child))
  assert.equal('privateKey' in context, false)
  assert.equal('terminalContent' in child, false)
})

test('renderer trace context normalizes unusual random adapter bytes', async () => {
  const {
    createTraceContext
  } = await import(`${pathToFileURL(clientTracePath).href}?random-bytes`)

  for (const { bytes, suffix } of unusualRandomByteCases) {
    const context = createTraceContext({}, {
      now: () => 1784304000000,
      randomBytes: () => bytes
    })

    assert.equal(context.traceId, `sp-1784304000000-${suffix}`)
    assert.match(context.traceId, /^sp-\d{13}-[0-9a-f]{8}$/)
  }
})

test('renderer trace context falls back through safe random sources', async () => {
  const {
    createTraceContext
  } = await import(`${pathToFileURL(clientTracePath).href}?random-failures`)
  const throwingAdapters = {
    now: () => 1784304000000,
    randomBytes: () => {
      throw new Error('adapter failed')
    }
  }

  const secureFallback = withGlobalCrypto({
    getRandomValues: (bytes) => {
      bytes.set([0xca, 0xfe, 0xba, 0xbe])
      return bytes
    }
  }, () => createTraceContext({}, throwingAdapters))
  assert.equal(secureFallback.traceId, 'sp-1784304000000-cafebabe')

  let nonSensitiveFallback
  assert.doesNotThrow(() => {
    nonSensitiveFallback = withGlobalCrypto(undefined, () => (
      createTraceContext({}, throwingAdapters)
    ))
  })
  assert.equal(nonSensitiveFallback.traceId, 'sp-1784304000000-00000000')
})

test('renderer trace context safely normalizes unstable clocks', async () => {
  const {
    createTraceContext
  } = await import(`${pathToFileURL(clientTracePath).href}?unstable-clocks`)

  assertSafeTimestamps(createTraceContext)
})

test('renderer trace context replaces malformed seeds and rejects credentials', async () => {
  const {
    createTraceContext,
    normalizeTraceContext
  } = await import(`${pathToFileURL(clientTracePath).href}?strict-seed`)

  for (const traceId of malformedTraceIds) {
    assert.deepEqual(normalizeTraceContext({ traceId }), {})
    assert.equal(
      createTraceContext({ traceId }, deterministicAdapters()).traceId,
      'sp-1784304000000-12345678'
    )
  }
  assert.deepEqual(normalizeTraceContext({
    traceId: 'sp-1784304000000-12345678',
    ...credentialValues
  }), {
    traceId: 'sp-1784304000000-12345678'
  })
})

test('renderer quality surfaces reject vendor credentials and preserve ordinary ids', async () => {
  const calls = []
  global.window = {
    pre: {
      runGlobalAsync: async (...args) => {
        calls.push(args)
        return true
      }
    }
  }
  try {
    const {
      normalizeTraceContext
    } = await import(`${pathToFileURL(clientTracePath).href}?vendor-credentials`)
    const {
      recordQualityEvent
    } = await import(`${pathToFileURL(clientEventsPath).href}?vendor-credentials`)

    for (const value of vendorCredentialValues) {
      assert.deepEqual(normalizeTraceContext({ requestId: value }), {})
      await recordQualityEvent({ requestId: value }, { messageCode: value })
      assert.deepEqual(calls.pop(), ['recordQualityEvent', {}, {}])
    }

    for (const value of ordinaryStableValues) {
      assert.deepEqual(normalizeTraceContext({ requestId: value }), {
        requestId: value
      })
      await recordQualityEvent({ requestId: value }, { messageCode: value })
      assert.deepEqual(calls.pop(), [
        'recordQualityEvent',
        { requestId: value },
        { messageCode: value }
      ])
    }
  } finally {
    delete global.window
  }
})

test('main and renderer normalization contracts stay aligned', async () => {
  const {
    normalizeTraceContext: normalizeMainTraceContext
  } = require(appTracePath)
  const {
    normalizeQualityEvent: normalizeMainQualityEvent
  } = require(qualityLogPath)
  const {
    normalizeTraceContext: normalizeRendererTraceContext
  } = await import(`${pathToFileURL(clientTracePath).href}?contract`)
  const {
    normalizeQualityEvent: normalizeRendererQualityEvent
  } = await import(`${pathToFileURL(clientEventsPath).href}?contract`)

  assert.equal(typeof normalizeRendererQualityEvent, 'function')
  for (const { name, context, event } of normalizationContractCases) {
    assert.deepEqual(
      normalizeRendererTraceContext(context),
      normalizeMainTraceContext(context),
      `${name}: trace context`
    )
    assert.deepEqual(
      normalizeRendererQualityEvent(event),
      normalizeMainQualityEvent(event),
      `${name}: quality event`
    )
  }
})

test('main quality events reject credential-shaped strings', () => {
  const {
    normalizeQualityEvent
  } = require(qualityLogPath)

  assert.deepEqual(normalizeQualityEvent({
    ...credentialEventValues,
    durationMs: 10
  }), {
    durationMs: 10
  })
})

test('quality logger accepts events for the warn transport queue', () => {
  const {
    createQualityLogger
  } = require(qualityLogPath)
  const calls = []
  const recordQualityEvent = createQualityLogger({
    warn: (...args) => calls.push(args)
  })

  const accepted = recordQualityEvent({
    traceId: 'sp-1784304000000-12345678',
    sessionId: 'session-1',
    module: 'ssh',
    action: 'connect',
    password: 'secret'
  }, {
    phase: 'finished',
    result: 'success',
    durationMs: 125.8,
    messageCode: 'ssh_connect_ok',
    message: 'user supplied log body',
    terminalOutput: 'private terminal body',
    arbitrary: { nested: true }
  })

  assert.equal(accepted, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'quality_event')
  assert.deepEqual(calls[0][1], {
    traceId: 'sp-1784304000000-12345678',
    sessionId: 'session-1',
    module: 'ssh',
    action: 'connect',
    phase: 'finished',
    result: 'success',
    durationMs: 126,
    messageCode: 'ssh_connect_ok'
  })
  assert.doesNotMatch(JSON.stringify(calls), /secret|user supplied|terminal body/i)
})

test('quality logger enqueue failures never escape to business callers', () => {
  const fallbackCalls = []
  const {
    createQualityLogger
  } = require(qualityLogPath)
  const recordQualityEvent = createQualityLogger({
    warn: (...args) => {
      fallbackCalls.push(args)
      if (fallbackCalls.length === 1) {
        throw new Error('transport failed')
      }
    }
  })

  let result
  assert.doesNotThrow(() => {
    result = recordQualityEvent({}, {
      module: 'update',
      action: 'check',
      phase: 'finished',
      result: 'failed',
      password: 'must-not-leak'
    })
  })
  assert.equal(result, false)
  assert.equal(fallbackCalls.length, 2)
  assert.equal(fallbackCalls[1][0], 'quality_event_enqueue_failed')
  assert.doesNotMatch(JSON.stringify(fallbackCalls), /must-not-leak|transport failed/i)
})

test('renderer quality events use legacy async IPC and report acceptance', async () => {
  const calls = []
  global.window = {
    pre: {
      runGlobalAsync: async (...args) => {
        calls.push(args)
        return true
      }
    }
  }
  try {
    const {
      recordQualityEvent
    } = await import(`${pathToFileURL(clientEventsPath).href}?success`)
    const accepted = await recordQualityEvent({
      traceId: 'sp-1784304000000-12345678',
      module: 'agent',
      action: 'run',
      apiKey: 'secret'
    }, {
      phase: 'started',
      result: 'pending',
      messageCode: 'agent_started',
      message: 'private chat body'
    })

    assert.equal(accepted, true)
    assert.deepEqual(calls, [[
      'recordQualityEvent',
      {
        traceId: 'sp-1784304000000-12345678',
        module: 'agent',
        action: 'run'
      },
      {
        phase: 'started',
        result: 'pending',
        messageCode: 'agent_started'
      }
    ]])

    calls.length = 0
    assert.equal(await recordQualityEvent({
      traceId: 'sp-1784304000000-12345678',
      ...credentialValues
    }, {
      ...credentialEventValues,
      durationMs: 10
    }), true)
    assert.deepEqual(calls, [[
      'recordQualityEvent',
      {
        traceId: 'sp-1784304000000-12345678'
      },
      {
        durationMs: 10
      }
    ]])

    global.window.pre.runGlobalAsync = async () => {
      throw new Error('ipc unavailable')
    }
    assert.equal(await recordQualityEvent({}, {
      module: 'frontend',
      action: 'load'
    }), false)
  } finally {
    delete global.window
  }
})

test('app log switches only the file transport to async mode', () => {
  const originalLoad = Module._load
  let electronLog
  let isDev

  Module._load = function (request, parent, isMain) {
    if (parent?.filename === appLogPath) {
      if (request === 'electron-log') {
        return electronLog
      }
      if (request === './runtime-constants') {
        return { isDev }
      }
      if (request === '../lib/log-redaction') {
        return { installLogRedaction: () => {} }
      }
      if (request === '../lib/quality/quality-log') {
        return { createQualityLogger: () => () => true }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    for (const testCase of [
      {
        name: 'development',
        isDev: true,
        expectedConsoleLevel: 'debug',
        expectedFileLevel: 'info'
      },
      {
        name: 'production',
        isDev: false,
        expectedConsoleLevel: 'warn',
        expectedFileLevel: 'warn'
      }
    ]) {
      electronLog = {
        transports: {
          console: { level: 'debug' },
          file: { level: 'info', sync: true }
        }
      }
      isDev = testCase.isDev
      delete require.cache[appLogPath]
      require(appLogPath)

      assert.equal(electronLog.transports.file.sync, false, testCase.name)
      assert.equal(
        electronLog.transports.console.level,
        testCase.expectedConsoleLevel,
        testCase.name
      )
      assert.equal(
        electronLog.transports.file.level,
        testCase.expectedFileLevel,
        testCase.name
      )
    }
  } finally {
    Module._load = originalLoad
    delete require.cache[appLogPath]
  }
})

test('async IPC handler dispatches quality events to the logger', async (t) => {
  const handlers = new Map()
  const qualityCalls = []
  const electron = {
    ipcMain: {
      on: () => {},
      handle: (channel, handler) => handlers.set(channel, handler)
    },
    app: {},
    BrowserWindow: {},
    dialog: {},
    powerMonitor: {
      on: () => {}
    },
    globalShortcut: {},
    shell: {}
  }
  const logger = {
    recordQualityEvent: (...args) => {
      qualityCalls.push(args)
      return 'recorded'
    }
  }
  const dependencyStub = new Proxy(() => {}, {
    get: () => dependencyStub
  })
  const originalLoad = Module._load

  delete require.cache[ipcPath]
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === ipcPath) {
      if (request === 'electron') {
        return electron
      }
      if (request === '../common/log') {
        return logger
      }
      if (request.startsWith('.')) {
        return dependencyStub
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  let ipc
  try {
    ipc = require(ipcPath)
  } finally {
    Module._load = originalLoad
  }
  t.after(() => {
    delete require.cache[ipcPath]
  })

  ipc.initIpc()
  const handler = handlers.get('async')
  const context = {
    traceId: 'sp-1784304000000-12345678',
    module: 'ssh'
  }
  const event = {
    action: 'connect',
    phase: 'started'
  }
  const result = await handler({}, {
    name: 'recordQualityEvent',
    args: [context, event]
  })

  assert.equal(result, 'recorded')
  assert.deepEqual(qualityCalls, [[context, event]])
})

test('structured credentials cannot cross renderer normalization and IPC into quality logs', async (t) => {
  const {
    createQualityLogger
  } = require(qualityLogPath)
  const {
    isCredentialLikeValue: isMainCredentialLikeValue,
    normalizeTraceContext: normalizeMainTraceContext
  } = require(appTracePath)
  const {
    isCredentialLikeValue: isRendererCredentialLikeValue,
    normalizeTraceContext: normalizeRendererTraceContext
  } = await import(`${pathToFileURL(clientTracePath).href}?structured-credentials`)
  const logged = []
  const handlers = new Map()
  const logger = {
    recordQualityEvent: createQualityLogger({
      warn: (...args) => logged.push(args)
    })
  }
  const electron = {
    ipcMain: {
      on: () => {},
      handle: (channel, handler) => handlers.set(channel, handler)
    },
    app: {},
    BrowserWindow: {},
    dialog: {},
    powerMonitor: { on: () => {} },
    globalShortcut: {},
    shell: {}
  }
  const dependencyStub = new Proxy(() => {}, {
    get: () => dependencyStub
  })
  const originalLoad = Module._load

  delete require.cache[ipcPath]
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === ipcPath) {
      if (request === 'electron') return electron
      if (request === '../common/log') return logger
      if (request.startsWith('.')) return dependencyStub
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  let ipc
  try {
    ipc = require(ipcPath)
  } finally {
    Module._load = originalLoad
  }
  t.after(() => {
    delete require.cache[ipcPath]
    delete global.window
  })
  ipc.initIpc()
  const handler = handlers.get('async')
  global.window = {
    pre: {
      runGlobalAsync: (name, ...args) => handler({}, { name, args })
    }
  }
  const {
    recordQualityEvent
  } = await import(`${pathToFileURL(clientEventsPath).href}?structured-credentials`)

  for (const credential of structuredCredentialValues) {
    assert.deepEqual(normalizeMainTraceContext({ requestId: credential }), {})
    assert.deepEqual(normalizeRendererTraceContext({ requestId: credential }), {})
    assert.equal(await recordQualityEvent({ requestId: credential }, {
      messageCode: credential
    }), true)
    assert.equal(await handler({}, {
      name: 'recordQualityEvent',
      args: [{ operationId: credential }, { reasonCode: credential }]
    }), true)
  }

  for (const id of ordinaryDottedIds) {
    assert.deepEqual(normalizeMainTraceContext({ requestId: id }), {
      requestId: id
    })
    assert.deepEqual(normalizeRendererTraceContext({ requestId: id }), {
      requestId: id
    })
    assert.equal(await recordQualityEvent({ requestId: id }, {
      messageCode: id
    }), true)
  }
  assert.equal(isMainCredentialLikeValue(ecdhEsKeyWrapWithEmptyKey), false)
  assert.equal(isRendererCredentialLikeValue(ecdhEsKeyWrapWithEmptyKey), false)

  const serialized = JSON.stringify(logged)
  for (const credential of structuredCredentialValues) {
    assert.equal(serialized.includes(credential), false)
    assert.equal(serialized.includes(credential.slice(0, 64)), false)
  }
  for (const id of ordinaryDottedIds) {
    assert.equal(serialized.includes(id), true)
  }
})
