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

function createManualTimers () {
  let sequence = 0
  const callbacks = new Map()
  return {
    setTimer: callback => {
      const id = ++sequence
      callbacks.set(id, callback)
      return id
    },
    clearTimer: id => callbacks.delete(id),
    runAll: () => {
      const pending = [...callbacks.values()]
      callbacks.clear()
      for (const callback of pending) callback()
    },
    size: () => callbacks.size
  }
}

function encodeMarkerField (value) {
  return Buffer.from(String(value), 'utf8').toString('base64')
}

function taskMarker (token, phase, ...fields) {
  return `\u001b]697;SHELLPILOT_OPS;${token};${phase};${fields.join(';')}\u0007`
}

function fileFrameAcknowledgement (
  token,
  sequence,
  total = 3,
  digest = 'a'.repeat(64),
  status = 'ok'
) {
  return `\u001b]698;SHELLPILOT_FILE_FRAME;${token};${sequence};${total};${digest};${status}\u0007`
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

function createFramedProbeProtocol ({
  token = 'd'.repeat(48),
  commands = ['frame-init', 'frame-chunk', 'frame-final']
} = {}) {
  const protocol = createBoundedProbeProtocol({ token })
  protocol.buildExecutionPlan = () => Object.freeze({
    kind: 'managed-pty-command-plan',
    version: 1,
    token,
    digest: 'a'.repeat(64),
    commandBytes: 9000,
    frames: Object.freeze(commands.map((command, sequence) => Object.freeze({
      sequence,
      command,
      acknowledgement: fileFrameAcknowledgement(
        token, sequence, commands.length),
      executesOperation: sequence === commands.length - 1
    }))),
    cleanup: Object.freeze({
      sequence: commands.length,
      command: 'frame-cleanup',
      acknowledgement: fileFrameAcknowledgement(
        token, commands.length, commands.length),
      executesOperation: false
    })
  })
  return protocol
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
  const lifecycleEvents = []
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
  const acceptedGate = options.acceptedGate || null
  const writtenGate = options.writtenGate || null
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
    prepareSubmissionOutputRecovery: () => {
      lifecycleEvents.push('prepare-output-recovery')
      return true
    },
    submitCommand: (command, submitOptions) => {
      if (options.submitCommand === false) return false
      submissions.at(-1).submittedCommand = command
      submissions.at(-1).submitOptions = submitOptions
      if (typeof options.submitCommand === 'function') {
        return options.submitCommand(command, submitOptions, submissions.length)
      }
      return Object.freeze({
        requestId: 'f'.repeat(32),
        accepted: acceptedGate?.promise || Promise.resolve(true),
        written: writtenGate?.promise || Promise.resolve(true)
      })
    },
    cancelSubmissionOutput: () => {
      lifecycleEvents.push('cancel-output')
      return true
    },
    interrupt: () => {
      lifecycleEvents.push('interrupt')
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
    onIdle: () => {
      lifecycleEvents.push('idle')
      return options.onIdle?.()
    },
    createToken: () => (++tokenSequence).toString(16).padStart(32, '0'),
    recoveryTimeoutMs: options.recoveryTimeoutMs || 30,
    setTimer: options.setTimer || setTimeout,
    clearTimer: options.clearTimer || clearTimeout
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
    lifecycleEvents,
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
      const handled = controller.handlePromptStarted()
      controller.handleCommandInputStarted()
      return handled
    },
    emitPromptBoundary () {
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

test('one lease submits an authenticated command plan in order', async () => {
  const token = 'd'.repeat(48)
  const protocol = createFramedProbeProtocol({ token })
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('operations-framed')
  const running = lease.execute({
    taskId: 'operations-framed-probe',
    request: { operation: 'probe' },
    protocol,
    timeoutMs: 1000
  })

  assert.equal(harness.submissions.length, 1)
  assert.equal(harness.submissions[0].command, 'frame-init')
  harness.emit(fileFrameAcknowledgement(token, 0))
  harness.emit('intermediate-hidden-output\n')
  assert.equal(harness.emitCommandFinished(0), true)
  assert.equal(harness.emitPromptStarted(), true)
  await Promise.resolve()

  assert.equal(harness.submissions.length, 2)
  assert.equal(harness.submissions[1].command, 'frame-chunk')
  harness.emit(fileFrameAcknowledgement(token, 1))
  assert.equal(harness.emitCommandFinished(0), true)
  assert.equal(harness.emitPromptStarted(), true)
  await Promise.resolve()

  assert.equal(harness.submissions.length, 3)
  assert.equal(harness.submissions[2].command, 'frame-final')
  harness.emit(fileFrameAcknowledgement(token, 2))
  harness.emit(`file:${token}:start:0:root\n`)
  harness.emit(`file:${token}:result:probe:sh,base64\n`)
  harness.emit(`file:${token}:end:0\n`)
  assert.equal(harness.emitCommandFinished(0), true)
  assert.equal(harness.emitPromptStarted(), true)

  assert.deepEqual(await running, {
    exitCode: 0,
    identity: { uid: '0', username: 'root' },
    kind: 'probe',
    capabilities: ['sh', 'base64']
  })
  assert.deepEqual(
    harness.submissions.map(value => value.submitOptions?.holdSuppression),
    [true, true, false]
  )
  assert.equal(await lease.release(), true)
})

test('command plan rejects missing and late acknowledgements', async () => {
  const token = 'd1'.repeat(24)
  const protocol = createFramedProbeProtocol({ token })
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('operations-frame-missing')
  const running = lease.execute({
    request: { operation: 'probe' },
    protocol,
    timeoutMs: 1000
  })

  harness.emitCommandFinished(0)
  harness.emitPromptStarted()
  await assert.rejects(running, /命令帧确认缺失/)
  assert.equal(harness.submissions.length, 1)
  harness.emit(fileFrameAcknowledgement(token, 0))
  await Promise.resolve()
  assert.equal(harness.submissions.length, 1)
  assert.equal(await lease.release(), true)
})

test('command plan rejects an authenticated out-of-order acknowledgement', async () => {
  const token = 'd2'.repeat(24)
  const protocol = createFramedProbeProtocol({ token })
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('operations-frame-order')
  const running = lease.execute({
    request: { operation: 'probe' },
    protocol,
    timeoutMs: 1000
  })

  harness.emit(fileFrameAcknowledgement(token, 1))
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()
  await assert.rejects(running, /顺序或认证无效/)
  assert.equal(harness.submissions.length, 1)
  assert.equal(await lease.release(), true)
})

test('command plan rejects malformed acknowledgement contracts before submission', async () => {
  const token = 'da'.repeat(24)
  const valid = fileFrameAcknowledgement(token, 0)
  const malformed = [
    valid.replace(';3;', ';4;'),
    valid.replace('a'.repeat(64), 'b'.repeat(64)),
    valid.replace(';ok\u0007', ';ok;extra\u0007'),
    valid.slice(0, -1),
    valid.replace(';ok\u0007', ';error\u0007')
  ]
  for (const [index, acknowledgement] of malformed.entries()) {
    const protocol = createFramedProbeProtocol({ token })
    const buildExecutionPlan = protocol.buildExecutionPlan
    protocol.buildExecutionPlan = () => {
      const plan = buildExecutionPlan()
      return {
        ...plan,
        frames: [
          { ...plan.frames[0], acknowledgement },
          ...plan.frames.slice(1)
        ]
      }
    }
    const harness = await createControllerHarness()
    const lease = await harness.controller.acquire(`invalid-ack-${index}`)
    await assert.rejects(
      lease.execute({ request: { operation: 'probe' }, protocol }),
      /确认合同无效/
    )
    assert.equal(harness.submissions.length, 0)
    assert.equal(await lease.release(), true)
  }
})

test('runtime acknowledgement failures clean a staged plan before rejecting', async () => {
  const token = 'db'.repeat(24)
  const valid = fileFrameAcknowledgement(token, 0)
  const malformed = [
    fileFrameAcknowledgement(token, 0, 4),
    fileFrameAcknowledgement(token, 0, 3, 'b'.repeat(64)),
    valid.replace(';ok\u0007', ';ok;extra\u0007'),
    valid.slice(0, -1)
  ]
  for (const [index, acknowledgement] of malformed.entries()) {
    const protocol = createFramedProbeProtocol({ token })
    const harness = await createControllerHarness()
    const lease = await harness.controller.acquire(`runtime-invalid-ack-${index}`)
    const running = lease.execute({
      request: { operation: 'probe' },
      protocol,
      timeoutMs: 1000
    })
    const observed = running.catch(error => error)
    await Promise.resolve()
    harness.emit(acknowledgement)
    harness.emitCommandFinished(0)
    harness.emitPromptStarted()
    await Promise.resolve()
    assert.equal(harness.submissions.at(-1).command, 'frame-cleanup')
    assert.equal(harness.submissions.some(
      submission => submission.command === 'frame-final'
    ), false)
    harness.emit(fileFrameAcknowledgement(token, 3))
    harness.emitCommandFinished(0)
    harness.emitPromptStarted()
    const error = await observed
    assert.match(error.message, /命令帧确认/)
    assert.equal(await lease.release(), true)
  }
})

test('staged acknowledgement failure without B times out sticky', async () => {
  const token = 'da'.repeat(24)
  const protocol = createFramedProbeProtocol({ token })
  const harness = await createControllerHarness({ recoveryTimeoutMs: 10 })
  const lease = await harness.controller.acquire('ack-failure-missing-input')
  const running = lease.execute({
    request: { operation: 'probe' },
    protocol,
    timeoutMs: 1000
  })
  const observed = running.catch(error => error)
  await Promise.resolve()
  harness.emit(fileFrameAcknowledgement(token, 0))
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()
  await Promise.resolve()
  assert.equal(harness.submissions.at(-1).command, 'frame-chunk')

  harness.emit(fileFrameAcknowledgement(
    token,
    1,
    3,
    'b'.repeat(64)
  ))
  harness.emitCommandFinished(0)
  assert.equal(harness.emitPromptBoundary(), true)
  const error = await observed
  assert.equal(error.name, 'CancellationUnknownError')
  assert.match(error.cause?.message || '', /命令帧确认顺序或认证无效/)
  assert.deepEqual(harness.submissions.map(entry => entry.command), [
    'frame-init',
    'frame-chunk'
  ])
  assert.equal(await lease.release(), false)
  await assert.rejects(
    harness.controller.acquire('ack-failure-sticky-successor'),
    /已有运维任务|重连恢复/
  )
})

test('unterminated frame acknowledgement enforces its UTF-8 byte cap', async () => {
  const token = 'de'.repeat(24)
  const protocol = createFramedProbeProtocol({ token })
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('ack-utf8-byte-cap')
  const running = lease.execute({
    request: { operation: 'probe' }, protocol, timeoutMs: 1000
  })
  const observed = running.catch(error => error)
  await Promise.resolve()
  harness.emit(
    `\u001b]698;SHELLPILOT_FILE_FRAME;${token};` + '深'.repeat(200)
  )
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()
  await Promise.resolve()
  assert.equal(harness.submissions.at(-1).command, 'frame-cleanup')
  harness.emit(fileFrameAcknowledgement(token, 3))
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()
  const error = await observed
  assert.match(error.message, /确认超过安全上限/)
  assert.equal(await lease.release(), true)
})

test('command plan rejects an oversized frame before submission', async () => {
  const protocol = createFramedProbeProtocol({
    token: 'd3'.repeat(24),
    commands: ['frame-init', 'x'.repeat(3841), 'frame-final']
  })
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('operations-frame-limit')
  await assert.rejects(
    lease.execute({
      request: { operation: 'probe' },
      protocol,
      timeoutMs: 1000
    }),
    /命令帧超过安全上限/
  )
  assert.equal(harness.submissions.length, 0)
  assert.equal(await lease.release(), true)
})

test('aborting a partial command plan submits only its cleanup frame', async () => {
  const token = 'd4'.repeat(24)
  const protocol = createFramedProbeProtocol({ token })
  const signalController = new AbortController()
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('operations-frame-abort')
  const running = lease.execute({
    request: { operation: 'probe' },
    protocol,
    timeoutMs: 1000,
    signal: signalController.signal
  })
  await Promise.resolve()
  harness.emit(fileFrameAcknowledgement(token, 0))
  signalController.abort()
  assert.equal(harness.interrupts, 1)
  harness.emitCommandFinished(130)
  harness.emitPromptStarted()
  await Promise.resolve()

  assert.equal(harness.submissions.length, 2)
  assert.equal(harness.submissions[1].command, 'frame-cleanup')
  assert.equal(harness.submissions[1].submitOptions.holdSuppression, false)
  harness.emit(fileFrameAcknowledgement(token, 3))
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()
  await assert.rejects(running, error => error.name === 'AbortError')
  assert.deepEqual(
    harness.submissions.map(value => value.command),
    ['frame-init', 'frame-cleanup']
  )
  assert.equal(await lease.release(), true)
})

test('pre-accept rejection after a staged frame still runs plan cleanup', async () => {
  const token = 'd5'.repeat(24)
  const protocol = createFramedProbeProtocol({ token })
  const secondAccepted = deferred()
  const signalController = new AbortController()
  const harness = await createControllerHarness({
    submitCommand: (_command, _options, sequence) => Object.freeze({
      requestId: 'f'.repeat(32),
      accepted: sequence === 2
        ? secondAccepted.promise
        : Promise.resolve(true),
      written: Promise.resolve(true)
    })
  })
  const lease = await harness.controller.acquire('operations-frame-pre-accept')
  const running = lease.execute({
    request: { operation: 'probe' },
    protocol,
    timeoutMs: 1000,
    signal: signalController.signal
  })
  const observed = running.catch(error => error)
  await Promise.resolve()
  harness.emit(fileFrameAcknowledgement(token, 0))
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()
  await Promise.resolve()
  assert.equal(harness.submissions.at(-1).command, 'frame-chunk')

  signalController.abort()
  const rejection = new Error('definitive transport rejection')
  rejection.name = 'AbortError'
  secondAccepted.reject(rejection)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(harness.submissions.at(-1).command, 'frame-cleanup')
  assert.equal(harness.submissions.some(
    submission => submission.command === 'frame-final'
  ), false)

  await Promise.resolve()
  harness.emit(fileFrameAcknowledgement(token, 3))
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()
  const error = await observed
  assert.equal(error.name, 'AbortError')
  assert.deepEqual(harness.submissions.map(entry => entry.command), [
    'frame-init',
    'frame-chunk',
    'frame-cleanup'
  ])
  assert.equal(await lease.release(), true)
})

test('non-cancellation rejection after staged state runs cleanup first', async () => {
  const token = 'd7'.repeat(24)
  const protocol = createFramedProbeProtocol({ token })
  const secondAccepted = deferred()
  const harness = await createControllerHarness({
    submitCommand: (_command, _options, sequence) => Object.freeze({
      requestId: 'f'.repeat(32),
      accepted: sequence === 2
        ? secondAccepted.promise
        : Promise.resolve(true),
      written: Promise.resolve(true)
    })
  })
  const lease = await harness.controller.acquire('operations-frame-reject-cleanup')
  const running = lease.execute({
    request: { operation: 'probe' },
    protocol,
    timeoutMs: 1000
  })
  const observed = running.catch(error => error)
  await Promise.resolve()
  harness.emit(fileFrameAcknowledgement(token, 0))
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()
  await Promise.resolve()
  assert.equal(harness.submissions.at(-1).command, 'frame-chunk')

  const primaryError = new Error('staged frame transport rejected')
  secondAccepted.reject(primaryError)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(harness.submissions.at(-1).command, 'frame-cleanup')
  assert.equal(harness.submissions.some(
    submission => submission.command === 'frame-final'
  ), false)

  await Promise.resolve()
  harness.emit(fileFrameAcknowledgement(token, 3))
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()
  assert.equal(await observed, primaryError)
  assert.deepEqual(harness.submissions.map(entry => entry.command), [
    'frame-init',
    'frame-chunk',
    'frame-cleanup'
  ])
  assert.equal(await lease.release(), true)
})

test('failed staged-plan cleanup preserves cancellation and cleanup errors', async () => {
  const token = 'd6'.repeat(24)
  const protocol = createFramedProbeProtocol({ token })
  const secondAccepted = deferred()
  const cleanupAccepted = deferred()
  const signalController = new AbortController()
  const harness = await createControllerHarness({
    submitCommand: (_command, _options, sequence) => Object.freeze({
      requestId: 'f'.repeat(32),
      accepted: sequence === 2
        ? secondAccepted.promise
        : sequence === 3
          ? cleanupAccepted.promise
          : Promise.resolve(true),
      written: Promise.resolve(true)
    })
  })
  const lease = await harness.controller.acquire('operations-frame-cleanup-failure')
  const running = lease.execute({
    request: { operation: 'probe' },
    protocol,
    timeoutMs: 1000,
    signal: signalController.signal
  })
  const observed = running.catch(error => error)
  await Promise.resolve()
  harness.emit(fileFrameAcknowledgement(token, 0))
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()
  await Promise.resolve()

  signalController.abort()
  const transportError = new Error('definitive transport rejection')
  transportError.name = 'AbortError'
  secondAccepted.reject(transportError)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(harness.submissions.at(-1).command, 'frame-cleanup')
  const cleanupError = new Error('cleanup transport unavailable')
  cleanupAccepted.reject(cleanupError)
  const error = await observed
  assert.equal(error.name, 'CancellationUnknownError')
  assert.equal(error.cause instanceof AggregateError, true)
  assert.equal(error.cause.errors.some(value => value.name === 'AbortError'), true)
  assert.equal(error.cause.errors.includes(cleanupError), true)
  assert.equal(harness.submissions.some(
    submission => submission.command === 'frame-final'
  ), false)
})

test('cleanup written rejection aggregates the original staged failure', async () => {
  const token = 'dc'.repeat(24)
  const protocol = createFramedProbeProtocol({ token })
  const secondAccepted = deferred()
  const cleanupAccepted = deferred()
  const cleanupWritten = deferred()
  const harness = await createControllerHarness({
    submitCommand: (_command, _options, sequence) => Object.freeze({
      requestId: 'f'.repeat(32),
      accepted: sequence === 2
        ? secondAccepted.promise
        : sequence === 3
          ? cleanupAccepted.promise
          : Promise.resolve(true),
      written: sequence === 3
        ? cleanupWritten.promise
        : Promise.resolve(true)
    })
  })
  const lease = await harness.controller.acquire('cleanup-written-reject')
  const running = lease.execute({
    request: { operation: 'probe' }, protocol, timeoutMs: 1000
  })
  const observed = running.catch(error => error)
  await Promise.resolve()
  harness.emit(fileFrameAcknowledgement(token, 0))
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()
  await Promise.resolve()
  const primaryError = new Error('staged frame rejected')
  secondAccepted.reject(primaryError)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(harness.submissions.at(-1).command, 'frame-cleanup')

  const cleanupError = new Error('cleanup write failed')
  cleanupWritten.reject(cleanupError)
  const error = await observed
  assert.equal(error.name, 'CancellationUnknownError')
  assert.equal(error.cause instanceof AggregateError, true)
  assert.equal(error.cause.errors.includes(primaryError), true)
  assert.equal(error.cause.errors.includes(cleanupError), true)
  assert.equal(await lease.release(), false)
})

test('cleanup deadline aggregates timeout and keeps the lease locked', async () => {
  const token = 'dd'.repeat(24)
  const protocol = createFramedProbeProtocol({ token })
  const secondAccepted = deferred()
  const cleanupAccepted = deferred()
  const timers = createManualTimers()
  const harness = await createControllerHarness({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    submitCommand: (_command, _options, sequence) => Object.freeze({
      requestId: 'f'.repeat(32),
      accepted: sequence === 2
        ? secondAccepted.promise
        : sequence === 3
          ? cleanupAccepted.promise
          : Promise.resolve(true),
      written: Promise.resolve(true)
    })
  })
  const lease = await harness.controller.acquire('cleanup-deadline')
  const running = lease.execute({
    request: { operation: 'probe' }, protocol, timeoutMs: 1000
  })
  const observed = running.catch(error => error)
  await Promise.resolve()
  harness.emit(fileFrameAcknowledgement(token, 0))
  harness.emitCommandFinished(0)
  harness.emitPromptStarted()
  await Promise.resolve()
  const primaryError = new Error('staged frame rejected')
  secondAccepted.reject(primaryError)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(harness.submissions.at(-1).command, 'frame-cleanup')
  cleanupAccepted.resolve(true)
  await Promise.resolve()
  harness.emit(fileFrameAcknowledgement(token, 3))
  harness.emitCommandFinished(0)
  assert.equal(harness.emitPromptBoundary(), true)
  await Promise.resolve()
  timers.runAll()

  const error = await observed
  assert.equal(error.name, 'CancellationUnknownError')
  assert.equal(error.cause instanceof AggregateError, true)
  assert.equal(error.cause.errors.includes(primaryError), true)
  assert.equal(error.cause.errors.some(
    value => value.name === 'TimeoutError'
  ), true)
  assert.equal(await lease.release(), false)
})

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
  await Promise.resolve()
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
  await Promise.resolve()
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
  await Promise.resolve()
  harness.emitManagedStart()
  signalController.abort()
  signalController.abort()
  assert.equal(harness.interrupts, 1)
  assert.deepEqual(
    harness.lifecycleEvents.slice(0, 2),
    ['prepare-output-recovery', 'interrupt']
  )
  harness.emitCommandFinished(130)
  harness.emitPromptStarted()

  await assert.rejects(running, error => {
    assert.equal(error.name, 'AbortError')
    assert.equal(error.code, 'PTY_TASK_CANCELLED')
    assert.equal(error.cancelled, true)
    assert.equal(error.cancellationOrigin, 'signal')
    return true
  })
  assert.equal(await lease.release(), true)
})

test('cancelled command unlocks on a new prompt without command finish', async () => {
  const harness = await createControllerHarness({ recoveryTimeoutMs: 100 })
  const signalController = new AbortController()
  const lease = await harness.controller.acquire('operations-prompt-recovery')
  const running = lease.execute({
    taskId: 'prompt-recovery-step',
    script: 'sleep 60',
    timeoutMs: 1000,
    signal: signalController.signal
  })
  await Promise.resolve()
  harness.emitManagedStart()

  signalController.abort()
  assert.deepEqual(
    harness.lifecycleEvents.slice(0, 2),
    ['prepare-output-recovery', 'interrupt']
  )
  assert.equal(harness.emitPromptStarted(), true)

  await assert.rejects(running, error => {
    assert.equal(error.name, 'AbortError')
    assert.equal(error.code, 'PTY_TASK_CANCELLED')
    return true
  })
  assert.deepEqual(harness.lifecycleEvents.slice(0, 3), [
    'prepare-output-recovery',
    'interrupt',
    'cancel-output'
  ])
  assert.equal(await lease.release(), true)
  assert.equal(harness.controller.isBusy(), false)
  assert.deepEqual(
    harness.controller.handleUserInput('x'),
    { handled: false, send: false }
  )
})

test('late authenticated prompt unlocks after cancellation recovery deadline', async () => {
  const harness = await createControllerHarness({ recoveryTimeoutMs: 20 })
  const signalController = new AbortController()
  const lease = await harness.controller.acquire('operations-unknown')
  const running = lease.execute({
    taskId: 'unknown-step',
    script: 'sleep 60',
    timeoutMs: 1000,
    signal: signalController.signal
  })
  await Promise.resolve()
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
  assert.equal(harness.lifecycleEvents.includes('cancel-output'), false)

  assert.equal(harness.emitPromptBoundary(), true)
  assert.equal(harness.controller.isBusy(), true)
  assert.equal(harness.lifecycleEvents.includes('cancel-output'), false)
  assert.deepEqual(harness.controller.handleUserInput('queued-late'), {
    handled: true, send: false, queue: true
  })
  assert.equal(harness.controller.handleCommandInputStarted(), true)
  assert.equal(harness.controller.isBusy(), false)
  assert.equal(harness.lifecycleEvents.includes('cancel-output'), true)
  assert.deepEqual(
    harness.controller.handleUserInput('x'),
    { handled: false, send: false }
  )
  assert.equal(await lease.release(), true)
  harness.emitManagedEnd(0)
})

test('cancellation recovery without B remains locked until invalidation', async () => {
  const harness = await createControllerHarness({ recoveryTimeoutMs: 20 })
  const signalController = new AbortController()
  const lease = await harness.controller.acquire('operations-no-prompt')
  const running = lease.execute({
    taskId: 'no-prompt-step',
    script: 'sleep 60',
    timeoutMs: 1000,
    signal: signalController.signal
  })
  await Promise.resolve()
  harness.emitManagedStart()
  signalController.abort()
  assert.equal(harness.emitPromptBoundary(), true)

  await assert.rejects(running, error => error.name === 'CancellationUnknownError')
  assert.equal(harness.controller.isBusy(), true)
  assert.equal(harness.lifecycleEvents.includes('cancel-output'), false)
  await harness.controller.invalidate('fixture disconnected')
  assert.equal(harness.controller.isBusy(), false)
  assert.equal(harness.lifecycleEvents.includes('cancel-output'), true)
  assert.equal(await lease.release(), true)
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

test('managed input queues ordinary keys and routes Ctrl+C through cancellation', async () => {
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('operations-input')
  const signalController = new AbortController()
  const running = lease.execute({
    taskId: 'input-step',
    script: 'sleep 60',
    timeoutMs: 1000,
    signal: signalController.signal
  })
  await Promise.resolve()
  harness.emitManagedStart()

  assert.deepEqual(
    harness.controller.handleUserInput('x'),
    { handled: true, send: false, queue: true }
  )
  assert.deepEqual(
    harness.controller.handleUserInput('\x03'),
    { handled: true, send: false, queue: false }
  )
  assert.equal(harness.interrupts, 1)
  harness.emitCommandFinished(130)
  harness.emitPromptStarted()
  await assert.rejects(running, error => {
    assert.equal(error.name, 'AbortError')
    assert.equal(error.code, 'PTY_TASK_CANCELLED')
    assert.equal(error.cancelled, true)
    assert.equal(error.cancellationOrigin, 'user')
    return true
  })
  await lease.release()
  assert.equal(harness.lifecycleEvents.at(-1), 'idle')

  assert.deepEqual(
    harness.controller.handleUserInput('x'),
    { handled: false, send: false }
  )
})

test('ordinary input preempts a running read-only managed task', async () => {
  const harness = await createControllerHarness()
  const lease = await harness.controller.acquire('root-file:list:home')
  const running = lease.execute({
    protocol: createBoundedProbeProtocol(),
    request: { operation: 'probe' },
    timeoutMs: 1000
  })
  await Promise.resolve()

  assert.deepEqual(
    harness.controller.handleUserInput('s'),
    { handled: true, send: false, queue: true }
  )
  assert.equal(harness.interrupts, 1)
  harness.emitPromptStarted()
  await assert.rejects(running, error => {
    assert.equal(error.name, 'AbortError')
    assert.equal(error.cancellationOrigin, 'user')
    return true
  })
  assert.equal(await lease.release(), true)
})

test('pending readiness reserves concurrency without capturing user input', async () => {
  const ensureGate = deferred()
  const harness = await createControllerHarness({ ensureGate })
  const acquiring = harness.controller.acquire('operations-first')

  assert.equal(harness.controller.isBusy(), true)
  assert.deepEqual(
    harness.controller.handleUserInput('x'),
    { handled: false, send: false }
  )
  await assert.rejects(
    harness.controller.acquire('operations-second'),
    /当前终端已有运维任务/
  )
  ensureGate.resolve()
  await assert.rejects(acquiring, /用户已开始终端输入/)
  assert.equal(harness.controller.isBusy(), false)
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

test('transport rejection cleans tracking without sending Ctrl+C', async () => {
  const acceptedGate = deferred()
  const harness = await createControllerHarness({ acceptedGate })
  const lease = await harness.controller.acquire('transport-reject')
  const running = lease.execute({
    taskId: 'transport-reject-step',
    script: 'id',
    timeoutMs: 1000
  })

  acceptedGate.reject(Object.assign(
    new Error('受控输入确认超时'),
    { name: 'ManagedInputTransportError' }
  ))
  await assert.rejects(running, /确认超时/)
  assert.equal(harness.cancelledSubmissions.length, 1)
  assert.equal(harness.disposedListeners, 1)
  assert.equal(harness.interrupts, 0)
  assert.equal(harness.lifecycleEvents.includes('cancel-output'), true)
  assert.equal(await lease.release(), true)
})

test('abort after transport send waits for confirmed pre-accept interruption', async () => {
  const acceptedGate = deferred()
  const writtenGate = deferred()
  const signalController = new AbortController()
  const harness = await createControllerHarness({ acceptedGate, writtenGate })
  const lease = await harness.controller.acquire('transport-pre-accept-abort')
  const running = lease.execute({
    taskId: 'transport-pre-accept-abort-step',
    script: 'sleep 60',
    timeoutMs: 1000,
    signal: signalController.signal
  })

  signalController.abort()
  assert.equal(harness.interrupts, 1)
  assert.equal(harness.controller.isBusy(), true)
  await assert.rejects(lease.release(), /仍在执行/)
  assert.equal(await Promise.race([
    running.then(() => 'settled', () => 'settled'),
    delay(10).then(() => 'pending')
  ]), 'pending')

  const interrupted = Object.assign(
    new Error('受控输入写入已中断'),
    { name: 'AbortError' }
  )
  acceptedGate.reject(interrupted)
  writtenGate.reject(interrupted)
  await assert.rejects(running, error => error.name === 'AbortError')
  assert.equal(harness.cancelledSubmissions.length, 1)
  assert.equal(await lease.release(), true)
})

test('pre-accept prompt cannot unlock cancellation before transport decides', async () => {
  const acceptedGate = deferred()
  const writtenGate = deferred()
  const signalController = new AbortController()
  const harness = await createControllerHarness({
    acceptedGate,
    writtenGate,
    recoveryTimeoutMs: 100
  })
  const lease = await harness.controller.acquire('transport-pending-prompt')
  const running = lease.execute({
    taskId: 'transport-pending-prompt-step',
    script: 'sleep 60',
    timeoutMs: 1000,
    signal: signalController.signal
  })
  let settled = false
  running.then(
    () => { settled = true },
    () => { settled = true }
  )

  signalController.abort()
  assert.equal(harness.interrupts, 1)
  assert.equal(harness.emitPromptStarted(), false)
  await Promise.resolve()

  assert.equal(settled, false)
  assert.equal(harness.controller.isBusy(), true)
  assert.equal(harness.lifecycleEvents.includes('cancel-output'), false)
  assert.equal(harness.lifecycleEvents.includes('idle'), false)
  await assert.rejects(lease.release(), /仍在执行/)

  const interrupted = Object.assign(
    new Error('受控输入写入已中断'),
    { name: 'AbortError' }
  )
  acceptedGate.reject(interrupted)
  writtenGate.reject(interrupted)
  await assert.rejects(running, error => error.name === 'AbortError')
  assert.equal(await lease.release(), true)
})

test('pre-accept recovery deadline stays locked until late acceptance recovers', async () => {
  const timers = createManualTimers()
  const acceptedGate = deferred()
  const writtenGate = deferred()
  const signalController = new AbortController()
  const harness = await createControllerHarness({
    acceptedGate,
    writtenGate,
    recoveryTimeoutMs: 100,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  })
  const lease = await harness.controller.acquire('transport-late-after-deadline')
  const running = lease.execute({
    taskId: 'transport-late-after-deadline-step',
    script: 'sleep 60',
    timeoutMs: 1000,
    signal: signalController.signal
  })

  signalController.abort()
  assert.equal(harness.emitPromptStarted(), false)
  assert.equal(timers.size(), 1)
  timers.runAll()
  await assert.rejects(
    running,
    error => error.name === 'CancellationUnknownError'
  )
  assert.equal(await lease.release(), false)
  assert.equal(harness.controller.isBusy(), true)
  assert.equal(harness.emitPromptStarted(), false)
  assert.equal(harness.controller.isBusy(), true)
  assert.equal(harness.lifecycleEvents.includes('cancel-output'), false)
  assert.equal(harness.lifecycleEvents.includes('idle'), false)

  acceptedGate.resolve(true)
  writtenGate.resolve(true)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(harness.interrupts, 2)
  assert.equal(harness.controller.isBusy(), true)
  assert.equal(harness.emitPromptStarted(), true)
  assert.equal(harness.controller.isBusy(), false)
  assert.equal(harness.lifecycleEvents.includes('cancel-output'), true)
  assert.equal(harness.lifecycleEvents.includes('idle'), true)
  assert.equal(await lease.release(), true)
})

test('late explicit transport rejection releases an unknown pre-accept lock', async () => {
  const timers = createManualTimers()
  const acceptedGate = deferred()
  const writtenGate = deferred()
  const signalController = new AbortController()
  const harness = await createControllerHarness({
    acceptedGate,
    writtenGate,
    recoveryTimeoutMs: 100,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  })
  const lease = await harness.controller.acquire('transport-reject-after-deadline')
  const running = lease.execute({
    taskId: 'transport-reject-after-deadline-step',
    script: 'id',
    timeoutMs: 1000,
    signal: signalController.signal
  })

  signalController.abort()
  timers.runAll()
  await assert.rejects(
    running,
    error => error.name === 'CancellationUnknownError'
  )
  assert.equal(await lease.release(), false)
  const rejected = Object.assign(
    new Error('受控输入请求被拒绝'),
    { name: 'ManagedInputTransportError' }
  )
  acceptedGate.reject(rejected)
  writtenGate.reject(rejected)
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(harness.controller.isBusy(), false)
  assert.equal(harness.lifecycleEvents.includes('cancel-output'), true)
  assert.equal(harness.lifecycleEvents.includes('idle'), true)
  assert.equal(await lease.release(), true)
})

test('late transport acceptance requires a new interrupt and prompt recovery', async () => {
  const acceptedGate = deferred()
  const writtenGate = deferred()
  const signalController = new AbortController()
  const harness = await createControllerHarness({
    acceptedGate,
    writtenGate,
    recoveryTimeoutMs: 100
  })
  const lease = await harness.controller.acquire('transport-late-accept')
  const running = lease.execute({
    taskId: 'transport-late-accept-step',
    script: 'sleep 60',
    timeoutMs: 1000,
    signal: signalController.signal
  })
  let settled = false
  running.then(
    () => { settled = true },
    () => { settled = true }
  )

  signalController.abort()
  assert.equal(harness.emitPromptStarted(), false)
  acceptedGate.resolve(true)
  writtenGate.resolve(true)
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(harness.interrupts, 2)
  assert.equal(settled, false)
  assert.equal(harness.controller.isBusy(), true)
  assert.equal(harness.lifecycleEvents.includes('cancel-output'), false)
  assert.equal(harness.lifecycleEvents.includes('idle'), false)
  assert.equal(harness.emitPromptStarted(), true)
  await assert.rejects(running, error => error.name === 'AbortError')
  assert.equal(await lease.release(), true)
})

test('explicit pre-accept transport rejection completes cancellation safely', async () => {
  const acceptedGate = deferred()
  const writtenGate = deferred()
  const signalController = new AbortController()
  const harness = await createControllerHarness({
    acceptedGate,
    writtenGate,
    recoveryTimeoutMs: 20
  })
  const lease = await harness.controller.acquire('transport-explicit-reject')
  const running = lease.execute({
    taskId: 'transport-explicit-reject-step',
    script: 'id',
    timeoutMs: 1000,
    signal: signalController.signal
  })

  signalController.abort()
  const rejected = Object.assign(
    new Error('受控输入请求被拒绝'),
    { name: 'ManagedInputTransportError' }
  )
  acceptedGate.reject(rejected)
  writtenGate.reject(rejected)

  await assert.rejects(running, error => error.name === 'AbortError')
  assert.equal(harness.interrupts, 1)
  assert.equal(harness.controller.isBusy(), true)
  assert.equal(await lease.release(), true)
})

test('abort racing with transport acceptance waits for prompt recovery', async () => {
  const acceptedGate = deferred()
  const writtenGate = deferred()
  const signalController = new AbortController()
  const harness = await createControllerHarness({ acceptedGate, writtenGate })
  const lease = await harness.controller.acquire('transport-accept-race-abort')
  const running = lease.execute({
    taskId: 'transport-accept-race-abort-step',
    script: 'sleep 60',
    timeoutMs: 1000,
    signal: signalController.signal
  })

  signalController.abort()
  acceptedGate.resolve(true)
  writtenGate.resolve(true)
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(harness.interrupts, 2)
  assert.equal(harness.controller.isBusy(), true)
  await assert.rejects(lease.release(), /仍在执行/)
  assert.equal(await Promise.race([
    running.then(() => 'settled', () => 'settled'),
    delay(10).then(() => 'pending')
  ]), 'pending')

  harness.emitManagedStart()
  harness.emitCommandFinished(130)
  assert.equal(harness.emitPromptStarted(), true)
  await assert.rejects(running, error => error.name === 'AbortError')
  // The matching command-finished event already consumed the tracker token.
  assert.equal(harness.cancelledSubmissions.length, 0)
  assert.equal(await lease.release(), true)
})

test('task timeout starts only after transport acceptance', async () => {
  const acceptedGate = deferred()
  const harness = await createControllerHarness({
    acceptedGate,
    recoveryTimeoutMs: 100
  })
  const lease = await harness.controller.acquire('transport-delayed-accept')
  const running = lease.execute({
    taskId: 'transport-delayed-accept-step',
    script: 'sleep 60',
    timeoutMs: 15
  })

  await delay(25)
  assert.equal(harness.interrupts, 0)
  acceptedGate.resolve(true)
  await Promise.resolve()
  await delay(25)
  assert.equal(harness.interrupts, 1)
  assert.equal(harness.emitPromptStarted(), true)
  await assert.rejects(running, error => error.name === 'TimeoutError')
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
  assert.equal(harness.lifecycleEvents.includes('cancel-output'), true)
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

test('controller scopes hidden natural prompt text to root-file owners', async () => {
  const cases = [
    { owner: 'root-file:list:tab-a', hidePromptText: true },
    { owner: 'operations-system-overview', hidePromptText: false }
  ]

  const observed = []
  for (const [index, testCase] of cases.entries()) {
    const token = String(index + 1).repeat(48)
    const protocol = createBoundedProbeProtocol({ token })
    const harness = await createControllerHarness()
    const lease = await harness.controller.acquire(testCase.owner)
    const running = lease.execute({
      request: { operation: 'probe' },
      protocol,
      timeoutMs: 1000
    })

    observed.push({
      owner: testCase.owner,
      hidePromptText: harness.submissions[0].submitOptions.hidePromptText
    })
    harness.emit(`file:${token}:start:0:root\n`)
    harness.emit(`file:${token}:result:probe:stat,base64\n`)
    harness.emit(`file:${token}:end:0\n`)
    assert.equal(harness.emitCommandFinished(0), true)
    assert.equal(harness.emitPromptStarted(), true)
    await running
    assert.equal(await lease.release(), true)
  }
  assert.deepEqual(observed, cases)
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
    await Promise.resolve()

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
