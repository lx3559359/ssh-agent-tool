const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const controllerModule =
  'src/client/components/terminal/managed-pty-task-controller.js'

function deferred () {
  let resolveDeferred
  let rejectDeferred
  const promise = new Promise((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })
  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred
  }
}

function delay (milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function encodeMarkerField (value) {
  return Buffer.from(String(value), 'utf8').toString('base64')
}

function taskMarker (token, phase, ...fields) {
  return `\u001b]697;SHELLPILOT_OPS;${token};${phase};${fields.join(';')}\u0007`
}

function createBoundedProbeProtocol ({
  token = 'c'.repeat(48),
  readResult,
  output = []
} = {}) {
  return {
    createToken: () => token,
    buildCommand: ({ token, request }) => `file:${token}:${request.operation}`,
    createParser: ({ token }) => {
      let pending = ''
      let effectiveIdentity = null
      let completedExitCode = null
      let result = null
      let started = false
      let ended = false
      return {
        push: chunk => {
          pending += String(chunk || '')
          let newlineIndex = pending.indexOf('\n')
          while (newlineIndex >= 0) {
            const line = pending.slice(0, newlineIndex)
            pending = pending.slice(newlineIndex + 1)
            const fields = line.split(':')
            assert.equal(fields[0], 'file')
            assert.equal(fields[1], token)
            if (fields[2] === 'start') {
              effectiveIdentity = { uid: fields[3], username: fields[4] }
              started = true
            } else if (fields[2] === 'result') {
              result = {
                kind: fields[3],
                capabilities: fields[4].split(',')
              }
            } else if (fields[2] === 'end') {
              completedExitCode = Number(fields[3])
              ended = true
            }
            newlineIndex = pending.indexOf('\n')
          }
          return { output }
        },
        identity: () => effectiveIdentity,
        exitCode: () => completedExitCode,
        started: () => started,
        ended: () => ended,
        result: () => result
      }
    },
    readResult: readResult || (parser => parser.result())
  }
}

function createThrowingAccessorProtocol (field, token = 'e'.repeat(48)) {
  const protocol = createBoundedProbeProtocol({ token })
  if (field === 'readResult') {
    protocol.readResult = () => {
      throw new Error(`custom protocol ${field} failed`)
    }
    return protocol
  }
  const createParser = protocol.createParser
  protocol.createParser = options => {
    const parser = createParser(options)
    parser[field] = () => {
      throw new Error(`custom protocol ${field} failed`)
    }
    return parser
  }
  return protocol
}

async function createControllerHarness (options = {}) {
  const { createManagedPtyTaskController } = await importModule(controllerModule)
  const listeners = new Set()
  const output = []
  const submissions = []
  const cancelledSubmissions = []
  const armedSubmissions = []
  const state = {
    alternateBuffer: false,
    passwordPrompt: false,
    shellIntegrationActive: true,
    commandInputActive: true,
    currentInput: '',
    ...options.state
  }
  let tokenSequence = 0
  let submissionSequence = 0
  let interrupts = 0
  let disposedListeners = 0
  const ensureGate = options.ensureGate || null
  const controller = createManagedPtyTaskController({
    ensureReady: async () => {
      if (ensureGate) await ensureGate.promise
      return true
    },
    getTerminalState: () => ({ ...state }),
    expectSubmission: command => {
      const token = `submission-${++submissionSequence}`
      submissions.push({ token, command })
      return token
    },
    armSubmission: token => {
      armedSubmissions.push(token)
      options.onArm?.()
      return options.armSubmission !== false
    },
    cancelSubmission: token => {
      cancelledSubmissions.push(token)
      return true
    },
    submitCommand: command => {
      if (options.submitCommand === false) return false
      submissions.at(-1).submittedCommand = command
      return true
    },
    interrupt: () => {
      interrupts += 1
      return true
    },
    subscribeOutput: listener => {
      listeners.add(listener)
      return {
        dispose: () => {
          if (listeners.delete(listener)) disposedListeners += 1
        }
      }
    },
    createToken: () => (++tokenSequence).toString(16).padStart(32, '0'),
    recoveryTimeoutMs: options.recoveryTimeoutMs || 30
  })

  function emit (value) {
    for (const listener of [...listeners]) listener(value)
  }

  function currentProtocolToken () {
    return tokenSequence.toString(16).padStart(32, '0')
  }

  return {
    controller,
    output,
    state,
    submissions,
    armedSubmissions,
    cancelledSubmissions,
    emit,
    emitManagedStart (identity = { uid: '0', username: 'root' }) {
      emit(taskMarker(
        currentProtocolToken(),
        'start',
        encodeMarkerField(identity.uid),
        encodeMarkerField(identity.username)
      ))
    },
    emitManagedEnd (exitCode = 0) {
      emit(taskMarker(currentProtocolToken(), 'end', String(exitCode)))
    },
    emitCommandFinished (exitCode = 0, overrides = {}) {
      const submission = submissions.at(-1)
      return controller.handleCommandFinished({
        token: submission.token,
        command: submission.command,
        exitCode,
        ...overrides
      })
    },
    emitPromptStarted () {
      return controller.handlePromptStarted()
    },
    get interrupts () {
      return interrupts
    },
    get disposedListeners () {
      return disposedListeners
    }
  }
}

test('one lease resolves only after matching marker command finish and prompt', async () => {
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('operations-1')
  const running = lease.execute({
    taskId: 'operations-1-discovery',
    script: 'id',
    timeoutMs: 1000,
    onChunk: chunk => harness.output.push(chunk)
  })

  assert.equal(harness.controller.isBusy(), true)
  await assert.rejects(
    harness.controller.acquire('operations-2'),
    /当前终端已有运维任务/
  )
  harness.emitManagedStart()
  harness.emit('effective root\r\n')
  harness.emitManagedEnd(0)
  assert.equal(harness.emitCommandFinished(0), true)
  let settled = false
  running.then(
    () => { settled = true },
    () => { settled = true }
  )
  await Promise.resolve()
  assert.equal(settled, false)

  harness.emitPromptStarted()
  const result = await running
  assert.deepEqual(result, {
    exitCode: 0,
    identity: { uid: '0', username: 'root' }
  })
  assert.deepEqual(harness.output, ['effective root\n'])
  assert.equal(await lease.release(), true)
  assert.equal(harness.controller.isBusy(), false)
  assert.equal(harness.disposedListeners, 1)
})

test('one lease rejects an effective identity change between steps', async () => {
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('operations-identity')
  const first = lease.execute({
    taskId: 'identity-first',
    script: 'id',
    timeoutMs: 1000
  })
  harness.emitManagedStart({ uid: '0', username: 'root' })
  harness.emitManagedEnd(0)
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()
  await first

  const second = lease.execute({
    taskId: 'identity-second',
    script: 'id',
    timeoutMs: 1000
  })
  harness.emitManagedStart({ uid: '1000', username: 'hik' })
  assert.equal(harness.interrupts, 1)
  harness.emitCommandFinished(130)
  harness.emitPromptStarted()

  await assert.rejects(second, /有效身份.*变化/)
  assert.equal(await lease.release(), true)
})

test('tracked completion without a start marker rejects instead of reporting success', async () => {
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('operations-no-start')
  const running = lease.execute({
    taskId: 'no-start',
    script: 'id',
    timeoutMs: 1000
  })
  harness.emit('ordinary output\r\n')
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()

  const outcome = await Promise.race([
    running.then(() => null, error => error),
    delay(30).then(() => 'pending')
  ])
  assert.notEqual(outcome, 'pending')
  assert.match(outcome.message, /开始边界/)
  assert.equal(await lease.release(), true)
})

test('abort sends one Ctrl+C and waits for tracked prompt recovery', async () => {
  const harness = await createControllerHarness()
  const signalController = new AbortController()
  const lease = await harness.controller.acquire('operations-cancel')
  const running = lease.execute({
    taskId: 'cancel-step',
    script: 'sleep 60',
    timeoutMs: 1000,
    signal: signalController.signal
  })
  harness.emitManagedStart()
  signalController.abort()
  signalController.abort()
  assert.equal(harness.interrupts, 1)
  harness.emitCommandFinished(130)
  harness.emitPromptStarted()

  await assert.rejects(running, error => error.name === 'AbortError')
  assert.equal(await lease.release(), true)
})

test('cancel without prompt recovery keeps the terminal locked until invalidation', async () => {
  const harness = await createControllerHarness({ recoveryTimeoutMs: 20 })
  const signalController = new AbortController()
  const lease = await harness.controller.acquire('operations-unknown')
  const running = lease.execute({
    taskId: 'unknown-step',
    script: 'sleep 60',
    timeoutMs: 1000,
    signal: signalController.signal
  })
  harness.emitManagedStart()
  signalController.abort()

  const outcome = await Promise.race([
    running.then(() => null, error => error),
    delay(60).then(() => 'pending')
  ])
  assert.notEqual(outcome, 'pending')
  assert.equal(outcome.name, 'CancellationUnknownError')
  assert.equal(await lease.release(), false)
  assert.equal(harness.controller.isBusy(), true)
  assert.equal(harness.disposedListeners, 1)
  await harness.controller.invalidate('fixture disconnected')
  assert.equal(harness.controller.isBusy(), false)
  harness.emitManagedEnd(0)
})

test('timeout interrupts once and reports TimeoutError after prompt recovery', async () => {
  const harness = await createControllerHarness({ recoveryTimeoutMs: 100 })
  const lease = await harness.controller.acquire('operations-timeout')
  const running = lease.execute({
    taskId: 'timeout-step',
    script: 'sleep 60',
    timeoutMs: 15
  })
  harness.emitManagedStart()
  await delay(25)
  assert.equal(harness.interrupts, 1)
  harness.emitCommandFinished(130)
  harness.emitPromptStarted()

  await assert.rejects(running, error => error.name === 'TimeoutError')
  assert.equal(await lease.release(), true)
})

test('managed input blocks ordinary keys and routes Ctrl+C through cancellation', async () => {
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('operations-input')
  const signalController = new AbortController()
  const running = lease.execute({
    taskId: 'input-step',
    script: 'sleep 60',
    timeoutMs: 1000,
    signal: signalController.signal
  })
  harness.emitManagedStart()

  assert.deepEqual(
    harness.controller.handleUserInput('x'),
    { handled: true, send: false }
  )
  assert.deepEqual(
    harness.controller.handleUserInput('\x03'),
    { handled: true, send: false }
  )
  assert.equal(harness.interrupts, 1)
  harness.emitCommandFinished(130)
  harness.emitPromptStarted()
  await assert.rejects(running, error => error.name === 'AbortError')
  await lease.release()

  assert.deepEqual(
    harness.controller.handleUserInput('x'),
    { handled: false, send: false }
  )
})

test('acquire reserves the terminal while readiness is still pending', async () => {
  const ensureGate = deferred()
  const harness = await createControllerHarness({ ensureGate })
  const acquiring = harness.controller.acquire('operations-first')

  await assert.rejects(
    harness.controller.acquire('operations-second'),
    /当前终端已有运维任务/
  )
  ensureGate.resolve()
  const lease = await acquiring
  assert.equal(await lease.release(), true)
})

test('unrunnable terminal state and tracker arm failure send no command', async () => {
  const alternate = await createControllerHarness({
    state: { alternateBuffer: true }
  })
  await assert.rejects(
    alternate.controller.acquire('operations-tui'),
    /交互程序/
  )

  const armFailure = await createControllerHarness({ armSubmission: false })
  const lease = await armFailure.controller.acquire('operations-arm')
  await assert.rejects(lease.execute({
    taskId: 'arm-step',
    script: 'id',
    timeoutMs: 1000
  }), /锁定.*追踪/)
  assert.equal(armFailure.submissions.at(-1).submittedCommand, undefined)
  assert.equal(armFailure.cancelledSubmissions.length, 1)
  assert.equal(await lease.release(), true)
})

test('abort during tracker arming never submits the managed command', async () => {
  const signalController = new AbortController()
  const harness = await createControllerHarness({
    onArm: () => signalController.abort()
  })
  const lease = await harness.controller.acquire('operations-arm-abort')

  await assert.rejects(lease.execute({
    taskId: 'arm-abort-step',
    script: 'id',
    timeoutMs: 1000,
    signal: signalController.signal
  }), error => error.name === 'AbortError')
  assert.equal(harness.submissions.at(-1).submittedCommand, undefined)
  assert.equal(harness.interrupts, 0)
  assert.equal(await lease.release(), true)
})

test('stale prompts and duplicate completion events cannot finish a command', async () => {
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('operations-events')
  const running = lease.execute({
    taskId: 'events-step',
    script: 'id',
    timeoutMs: 1000
  })
  harness.emitManagedStart()
  harness.emitManagedEnd(0)

  assert.equal(harness.emitPromptStarted(), false)
  assert.equal(harness.emitCommandFinished(0, { token: 'stale-token' }), false)
  assert.equal(harness.emitCommandFinished(0), true)
  assert.equal(harness.emitCommandFinished(0), false)
  let settled = false
  running.then(
    () => { settled = true },
    () => { settled = true }
  )
  await Promise.resolve()
  assert.equal(settled, false)
  assert.equal(harness.emitPromptStarted(), true)
  await running
  await lease.release()
})

test('disconnect rejects the active command and ignores late terminal output', async () => {
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('operations-disconnect')
  const running = lease.execute({
    taskId: 'disconnect-step',
    script: 'sleep 60',
    timeoutMs: 1000
  })
  harness.emitManagedStart()

  await harness.controller.invalidate('fixture disconnected')
  await assert.rejects(running, error => error.name === 'DisconnectedError')
  assert.equal(harness.controller.isBusy(), false)
  assert.equal(harness.disposedListeners, 1)
  harness.emitManagedEnd(0)
  assert.equal(await lease.release(), true)
})

test('bounded custom protocol uses its own command parser and result', async () => {
  const customToken = 'c'.repeat(48)
  let createTokenCalls = 0
  const protocol = createBoundedProbeProtocol({ token: customToken })
  protocol.createToken = () => {
    createTokenCalls += 1
    return customToken
  }
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('files-1')
  const running = lease.execute({
    request: { operation: 'probe' },
    protocol,
    timeoutMs: 1000
  })

  assert.equal(createTokenCalls, 1)
  assert.equal(customToken.length, 48)
  assert.equal(harness.submissions.at(-1).command, `file:${customToken}:probe`)
  harness.emit(`file:${customToken}:start:0:`)
  harness.emit(`root\nfile:${customToken}:result:probe:stat,base64\n`)
  harness.emit(`file:${customToken}:end:0\n`)
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()

  assert.deepEqual(await running, {
    exitCode: 0,
    identity: { uid: '0', username: 'root' },
    kind: 'probe',
    capabilities: ['stat', 'base64']
  })
  assert.equal(await lease.release(), true)
})

test('custom protocol cannot override authoritative completion fields', async () => {
  const customToken = 'd'.repeat(48)
  const protocol = createBoundedProbeProtocol({
    token: customToken,
    readResult: () => ({
      kind: 'probe',
      capabilities: ['stat', 'base64'],
      exitCode: 99,
      identity: { uid: '9999', username: 'attacker' }
    })
  })
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('files-authority')
  const running = lease.execute({
    request: { operation: 'probe' },
    protocol,
    timeoutMs: 1000
  })

  harness.emit(`file:${customToken}:start:0:root\n`)
  harness.emit(`file:${customToken}:result:probe:stat,base64\n`)
  harness.emit(`file:${customToken}:end:0\n`)
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()

  assert.deepEqual(await running, {
    exitCode: 0,
    identity: { uid: '0', username: 'root' },
    kind: 'probe',
    capabilities: ['stat', 'base64']
  })
  assert.equal(await lease.release(), true)
})

test('protocol completion accessor failures reject immediately and release cleanly', async () => {
  for (const field of [
    'started',
    'ended',
    'exitCode',
    'readResult'
  ]) {
    const harness = await createControllerHarness()
    const lease = await harness.controller.acquire(`files-throw-${field}`)
    const running = lease.execute({
      request: { operation: 'probe' },
      protocol: createThrowingAccessorProtocol(field),
      timeoutMs: 1000
    })

    harness.emit(`file:${'e'.repeat(48)}:start:0:root\n`)
    if (field !== 'identity') {
      harness.emit(`file:${'e'.repeat(48)}:result:probe:stat,base64\n`)
      harness.emit(`file:${'e'.repeat(48)}:end:0\n`)
      harness.emitCommandFinished(0)
      harness.emitPromptStarted()
    }

    const outcome = await Promise.race([
      running.then(() => null, error => error),
      delay(100).then(() => 'pending')
    ])
    assert.notEqual(outcome, 'pending', `${field} failure must settle promptly`)
    assert.match(outcome.message, new RegExp(`custom protocol ${field} failed`))
    assert.equal(harness.interrupts, 0)
    assert.equal(harness.disposedListeners, 1)
    assert.equal(await lease.release(), true)
  }
})

test('running protocol output failures cancel once and retain the lease through recovery', async () => {
  for (const field of ['identity', 'push', 'onChunk']) {
    const token = 'o'.repeat(48)
    const harness = await createControllerHarness()
    const lease = await harness.controller.acquire(`files-output-${field}`)
    const protocol = field === 'onChunk'
      ? createBoundedProbeProtocol({ token, output: ['visible'] })
      : createThrowingAccessorProtocol(field, token)
    const running = lease.execute({
      request: { operation: 'probe' },
      protocol,
      timeoutMs: 1000,
      onChunk: field === 'onChunk'
        ? () => { throw new Error('custom protocol onChunk failed') }
        : undefined
    })

    harness.emit(`file:${token}:start:0:root\n`)
    if (field === 'onChunk') {
      harness.emit(`file:${token}:result:probe:stat,base64\n`)
    }
    assert.equal(harness.interrupts, 1)
    assert.equal(harness.controller.isBusy(), true)
    await assert.rejects(
      harness.controller.acquire(`files-output-next-${field}`),
      /当前终端已有运维任务/
    )
    await assert.rejects(lease.release(), /PTY 运维命令仍在执行/)

    harness.emitCommandFinished(130)
    harness.emitPromptStarted()
    await assert.rejects(
      running,
      error => error.message === `custom protocol ${field} failed`
    )
    await delay(20)
    assert.equal(harness.interrupts, 1)
    assert.equal(await lease.release(), true)
  }
})

test('invalid protocol command and parser contracts fail before submission', async () => {
  const commandCases = [
    { value: '', label: 'empty command' },
    { value: 42, label: 'non-string command' }
  ]
  for (const commandCase of commandCases) {
    const harness = await createControllerHarness()
    const lease = await harness.controller.acquire(`files-${commandCase.label}`)
    const protocol = createBoundedProbeProtocol({ token: 'f'.repeat(48) })
    protocol.buildCommand = () => commandCase.value
    await assert.rejects(
      lease.execute({
        request: { operation: 'probe' },
        protocol,
        timeoutMs: 1000
      }),
      /受控 PTY 命令无效/
    )
    assert.equal(harness.submissions.length, 0)
    assert.equal(await lease.release(), true)
  }

  for (const field of [
    'push',
    'identity',
    'exitCode',
    'started',
    'ended'
  ]) {
    const harness = await createControllerHarness()
    const lease = await harness.controller.acquire(`files-parser-${field}`)
    const protocol = createBoundedProbeProtocol({ token: 'f'.repeat(48) })
    const createParser = protocol.createParser
    protocol.createParser = options => {
      const parser = createParser(options)
      delete parser[field]
      return parser
    }
    await assert.rejects(
      lease.execute({
        request: { operation: 'probe' },
        protocol,
        timeoutMs: 1000
      }),
      new RegExp(`受控 PTY parser 缺少 ${field}`)
    )
    assert.equal(harness.submissions.length, 0)
    assert.equal(await lease.release(), true)
  }
})

test('missing managed protocol methods fail before reserving execution state', async () => {
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('files-invalid-protocol')

  for (const field of [
    'createToken',
    'buildCommand',
    'createParser',
    'readResult'
  ]) {
    const protocol = {
      createToken: () => 'c'.repeat(48),
      buildCommand: () => 'file:command',
      createParser: () => ({}),
      readResult: () => ({})
    }
    delete protocol[field]
    await assert.rejects(
      lease.execute({ protocol, request: { operation: 'probe' } }),
      new RegExp(`受控 PTY 协议缺少 ${field}`)
    )
    assert.equal(harness.controller.isBusy(), true)
    assert.equal(harness.submissions.length, 0)
  }

  assert.equal(await lease.release(), true)
  assert.equal(harness.controller.isBusy(), false)
})
