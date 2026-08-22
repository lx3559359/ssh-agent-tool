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
