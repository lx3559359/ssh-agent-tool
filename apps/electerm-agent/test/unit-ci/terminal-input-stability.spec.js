const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const fs = require('node:fs')

async function importController () {
  return import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/terminal/terminal-safety-controller.js'
  )))
}

async function importAttachAddon () {
  globalThis.window = globalThis.window || {}
  const module = await import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/terminal/attach-addon-custom.js'
  )))
  return module.default
}

async function importCommandTracker () {
  return import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/terminal/command-tracker-addon.js'
  )))
}

async function importManagedPtyController () {
  return import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/terminal/managed-pty-task-controller.js'
  )))
}

async function importShellIntegration () {
  return import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/terminal/shell.js'
  )))
}

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

function terminalControlMessage (action, fields = {}) {
  return JSON.stringify({
    __aigshellTerminalControl: true,
    action,
    ...fields
  })
}

function createAttachHarness (beforeTerminalEnter) {
  const calls = []
  const sent = []
  const parent = {
    getCurrentInput: () => 'systemctl restart nginx',
    getTerminalSafetyContext: () => ({ enabled: true, isSsh: true }),
    beforeTerminalEnter: (command, context) => {
      calls.push({ command, context })
      return beforeTerminalEnter(command, context)
    },
    onPasswordPromptCancelled: () => calls.push({ passwordCancelled: true })
  }
  const term = {
    parent,
    buffer: { active: { type: 'normal' } }
  }
  return importAttachAddon().then(AttachAddon => {
    const addon = new AttachAddon(term, {}, false)
    addon._sendData = data => sent.push(data)
    return { addon, calls, sent, parent, term }
  })
}

function createDirectAttachHarness () {
  const sent = []
  const safetyCalls = []
  const parent = {
    agentTakeoverActive: true,
    notifyOnData: () => {},
    requestTerminalSafetyConfirmation: command => {
      safetyCalls.push({ type: 'confirmation', command })
    },
    runSafetyCommand: command => {
      safetyCalls.push({ type: 'transaction', command })
    }
  }
  const term = {
    parent,
    buffer: { active: { type: 'normal' } }
  }
  return importAttachAddon().then(AttachAddon => {
    const addon = new AttachAddon(term, {}, false)
    addon._sendData = data => sent.push(data)
    addon.managedPtyTransport = {
      submit: command => {
        addon._sendTerminalControl('managed-input', {
          requestId: testTrackerNonce,
          command
        })
        return true
      },
      interrupt: () => {
        addon._sendTerminalControl('managed-input-interrupt')
        return true
      },
      ready: () => Promise.resolve(true),
      handleControlMessage: () => false,
      dispose: () => true
    }
    return { addon, safetyCalls, sent, parent, term }
  })
}

test('AttachAddon publishes remote output and blocks managed terminal input', async () => {
  const { addon, sent, parent, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  parent.handleManagedPtyInput = data => ({
    handled: true,
    send: data === '\x03'
  })
  const subscription = addon.onRemoteOutput(chunk => output.push(chunk))

  addon.writeToTerminal('root output\r\n')
  addon.sendToServer('x')
  addon.sendToServer('\x03')
  subscription.dispose()
  addon.writeToTerminal('after dispose')

  assert.deepEqual(output, ['root output\r\n'])
  assert.deepEqual(writes, ['root output\r\n', 'after dispose'])
  assert.deepEqual(sent, ['\x03'])
})

test('AttachAddon streams split UTF-8 bytes once to managed output listeners', async () => {
  const { addon, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  term.parent.notifyOnData = () => {}
  addon.onRemoteOutput(chunk => output.push(chunk))
  const bytes = new TextEncoder().encode('A中文B')

  addon.onRead({ target: { result: bytes.slice(0, 2).buffer } })
  addon.onRead({ target: { result: bytes.slice(2, 5).buffer } })
  addon.onRead({ target: { result: bytes.slice(5).buffer } })

  assert.equal(output.join(''), 'A中文B')
  assert.equal(output.join('').includes('�'), false)
  assert.equal(writes.join('').includes('A'), true)
})

test('AttachAddon exposes controller-only managed submit and interrupt methods', async () => {
  const { addon, sent } = await createDirectAttachHarness()

  assert.equal(addon.submitManagedPtyCommand('printf root', testTrackerNonce), true)
  assert.equal(addon.submitManagedPtyCommand('printf second', testTrackerNonce), false)
  assert.equal(addon.submitManagedPtyCommand('  ', testTrackerNonce), false)
  assert.equal(addon.submitManagedPtyCommand('printf invalid', 'invalid'), false)
  assert.equal(addon.interruptManagedPtyCommand(), true)
  assert.deepEqual(sent, [
    terminalControlMessage('managed-input', {
      requestId: testTrackerNonce,
      command: 'printf root'
    }),
    terminalControlMessage('managed-input-interrupt')
  ])
  await addon.stopOutputSuppression(true)
})

test('AttachAddon rejects an oversized UTF-8 managed frame before transport', async () => {
  const { addon, sent } = await createDirectAttachHarness()
  const oversized = '深'.repeat(1281)
  assert.ok(Buffer.byteLength(oversized, 'utf8') > 3840)
  assert.throws(
    () => addon.submitManagedPtyCommand(oversized, testTrackerNonce),
    error => error?.code === 'MANAGED_PTY_FRAME_LIMIT' &&
      !error.message.includes(oversized.slice(0, 32))
  )
  assert.deepEqual(sent, [])
  assert.equal(addon.outputSuppressed, false)
})

test('managed PTY hides command output while streaming it to the task parser', async () => {
  const { addon, sent, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  addon.onRemoteOutput(chunk => output.push(chunk))
  const command = 'command /usr/bin/env SHELLPILOT_FILE=1 __sp_secret=hidden'
  const commandRecord =
    `\u001b]633;E;${testTrackerNonce};${command}\u0007`
  const remainder =
    `\u001b]633;C;${testTrackerNonce}\u0007` +
    '\u001b]698;SHELLPILOT_FILE;token;start;MA==;cm9vdA==\u0007'
  const prompt =
    `\u001b]633;A;${testTrackerNonce}\u0007fixture:# ` +
    `\u001b]633;B;${testTrackerNonce}\u0007`

  assert.equal(addon.submitManagedPtyCommand(command, testTrackerNonce), true)
  assert.equal(addon.outputSuppressed, true)
  assert.deepEqual(sent, [terminalControlMessage('managed-input', {
    requestId: testTrackerNonce,
    command
  })])

  addon.writeToTerminal(`${command}\r\n`)
  assert.deepEqual(writes, [])
  assert.deepEqual(output, [])

  addon.writeToTerminal(commandRecord + remainder)
  assert.equal(addon.outputSuppressed, true)
  assert.deepEqual(writes, [`\u001b]633;C;${testTrackerNonce}\u0007`])
  assert.deepEqual(output, [remainder])

  addon.writeToTerminal(prompt)
  assert.equal(addon.outputSuppressed, false)
  assert.equal(addon.managedPtySessionNonce, '')
  assert.equal(addon.prepareManagedPtyEchoRecovery(), false)
  assert.equal(
    writes.join(''),
    `\u001b]633;C;${testTrackerNonce}\u0007` + prompt
  )
  assert.deepEqual(output, [remainder, prompt])
})

test('managed PTY holds suppression across command-plan prompts', async () => {
  const { addon, sent, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  addon.onRemoteOutput(chunk => output.push(chunk))
  const first = 'frame-init-safe'
  const final = 'frame-final-safe'
  const firstRecord =
    `\u001b]633;E;${testTrackerNonce};${first}\u0007`
  const firstOutput = [
    `\u001b]633;C;${testTrackerNonce}\u0007`,
    `\u001b]698;SHELLPILOT_FILE_FRAME;token;0;2;${'a'.repeat(64)};ok\u0007`,
    `\u001b]633;D;${testTrackerNonce};0\u0007`
  ].join('')
  const firstPrompt =
    `\u001b]633;A;${testTrackerNonce}\u0007fixture:# ` +
    `\u001b]633;B;${testTrackerNonce}\u0007`

  assert.equal(addon.submitManagedPtyCommand(
    first,
    testTrackerNonce,
    { holdSuppression: true }
  ), true)
  addon.writeToTerminal(firstRecord + firstOutput)
  addon.sendToServer('queued-user-input')
  addon.writeToTerminal(firstPrompt)

  assert.equal(addon.outputSuppressed, true)
  assert.equal(writes.join('').includes('fixture:#'), false)
  assert.equal(writes.join('').includes(
    `\u001b]633;B;${testTrackerNonce}\u0007`
  ), true)
  assert.equal(writes.join('').includes(first), false)
  assert.deepEqual(sent, [terminalControlMessage('managed-input', {
    requestId: testTrackerNonce,
    command: first
  })])

  const finalRecord =
    `\u001b]633;E;${testTrackerNonce};${final}\u0007`
  const finalOutput = [
    `\u001b]633;C;${testTrackerNonce}\u0007`,
    `\u001b]698;SHELLPILOT_FILE_FRAME;token;1;2;${'a'.repeat(64)};ok\u0007`,
    '\u001b]698;SHELLPILOT_FILE;token;start;MA==;cm9vdA==\u0007',
    `\u001b]633;D;${testTrackerNonce};0\u0007`
  ].join('')
  assert.equal(addon.submitManagedPtyCommand(
    final,
    testTrackerNonce,
    { holdSuppression: false }
  ), true)
  addon.writeToTerminal(finalRecord + finalOutput)
  addon.writeToTerminal(firstPrompt)
  await Promise.resolve()

  assert.equal(addon.outputSuppressed, false)
  assert.equal(writes.join('').includes(first), false)
  assert.equal(writes.join('').includes(final), false)
  assert.equal(writes.join('').includes('fixture:#'), true)
  assert.deepEqual(sent, [
    terminalControlMessage('managed-input', {
      requestId: testTrackerNonce,
      command: first
    }),
    terminalControlMessage('managed-input', {
      requestId: testTrackerNonce,
      command: final
    }),
    'queued-user-input'
  ])
  assert.equal(output.join('').includes('SHELLPILOT_FILE_FRAME'), true)
})

test('real tracker attach and controller advance a held command plan only after B', async () => {
  const AttachAddon = await importAttachAddon()
  const { CommandTrackerAddon } = await importCommandTracker()
  const { createManagedPtyTaskController } = await importManagedPtyController()
  const trackerHarness = createTrackerTerminal()
  const lifecycleWrites = []
  const coalescedEvents = []
  let coalescedFrameIndex = null
  const submissions = []
  const transportWrites = []
  let rejectNextChunk = false
  let blockedChunk = null
  let cleanupAcceptance = null
  const planToken = 'd'.repeat(48)
  const planDigest = 'a'.repeat(64)
  const commands = ['frame-init', 'frame-chunk', 'frame-final']
  const parent = {
    notifyOnData: () => {}
  }
  const term = trackerHarness.terminal
  term.parent = parent
  term.write = value => {
    lifecycleWrites.push(String(value))
    const escape = String.fromCharCode(27)
    const bell = String.fromCharCode(7)
    const pattern = new RegExp(
      `${escape}\\]633;([^${bell}]+)${bell}`, 'g')
    let match = pattern.exec(String(value))
    while (match) {
      trackerHarness.osc(match[1])
      const phase = match[1].split(';')[0]
      if (coalescedFrameIndex !== null &&
        ['D', 'A', 'B'].includes(phase)) {
        coalescedEvents.push(
          `${coalescedFrameIndex}:tracker-${phase}`
        )
      }
      match = pattern.exec(String(value))
    }
  }
  const tracker = new CommandTrackerAddon()
  tracker.activate(term)
  tracker.beginSession(testTrackerNonce)
  const addon = new AttachAddon(term, {}, false)
  addon._sendData = data => transportWrites.push(data)
  addon.onRemoteOutput(chunk => {
    if (coalescedFrameIndex === null) return
    const output = String(chunk)
    const acknowledgement =
      `\u001b]698;SHELLPILOT_FILE_FRAME;${planToken};` +
      `${coalescedFrameIndex};${commands.length};${planDigest};ok\u0007`
    const fileMarker =
      `\u001b]698;SHELLPILOT_FILE;${planToken};start;MA==;cm9vdA==\u0007`
    const promptFrame = `\u001b]633;A;${testTrackerNonce}\u0007`
    const inputFrame = `\u001b]633;B;${testTrackerNonce}\u0007`
    if (output.includes(acknowledgement)) {
      coalescedEvents.push(`${coalescedFrameIndex}:listener-ack`)
    }
    if (output.includes(fileMarker)) {
      coalescedEvents.push(`${coalescedFrameIndex}:listener-file`)
    }
    if (output.includes(promptFrame)) {
      coalescedEvents.push(`${coalescedFrameIndex}:listener-A`)
    }
    if (output.includes(inputFrame)) {
      coalescedEvents.push(`${coalescedFrameIndex}:listener-B`)
    }
  })
  addon.managedPtyTransport = {
    submit: command => {
      submissions.push(command)
      const accepted = cleanupAcceptance && command === 'frame-cleanup'
        ? cleanupAcceptance.promise
        : rejectNextChunk && command === 'frame-chunk'
          ? (() => {
              blockedChunk = deferred()
              return blockedChunk.promise
            })()
          : Promise.resolve(true)
      return Object.freeze({
        accepted,
        written: Promise.resolve(true)
      })
    },
    interrupt: () => true,
    ready: () => Promise.resolve(true),
    handleControlMessage: () => false,
    dispose: () => true
  }
  const protocol = {
    createToken: () => planToken,
    buildCommand: () => commands.at(-1),
    buildExecutionPlan: () => Object.freeze({
      kind: 'managed-pty-command-plan',
      version: 1,
      token: planToken,
      digest: planDigest,
      frames: Object.freeze(commands.map((command, sequence) => Object.freeze({
        sequence,
        command,
        acknowledgement:
          `\u001b]698;SHELLPILOT_FILE_FRAME;${planToken};${sequence};${commands.length};${planDigest};ok\u0007`,
        executesOperation: sequence === commands.length - 1
      }))),
      cleanup: Object.freeze({
        sequence: commands.length,
        command: 'frame-cleanup',
        acknowledgement:
          `\u001b]698;SHELLPILOT_FILE_FRAME;${planToken};3;3;${planDigest};ok\u0007`,
        executesOperation: false
      })
    }),
    createParser: () => {
      let output = ''
      return {
        push: chunk => {
          output += String(chunk || '')
          return { output: [] }
        },
        identity: () => output.includes('PLAN_START')
          ? { uid: '0', username: 'root' }
          : null,
        started: () => output.includes('PLAN_START'),
        ended: () => output.includes('PLAN_END'),
        exitCode: () => output.includes('PLAN_END') ? 0 : null
      }
    },
    readResult: () => ({ ok: true })
  }
  const controller = createManagedPtyTaskController({
    ensureReady: async () => true,
    getTerminalState: () => ({
      alternateBuffer: false,
      passwordPrompt: false,
      shellIntegrationActive: tracker.hasShellIntegration(),
      commandInputActive: tracker.isCommandInputActive(),
      currentInput: tracker.getCurrentCommandInput()
    }),
    expectSubmission: command => tracker.expectExternalSubmission(command),
    armSubmission: token => tracker.markExpectedSubmissionReleased(token),
    cancelSubmission: token => tracker.cancelExpectedSubmission(token),
    prepareSubmissionOutputRecovery: () => addon.prepareManagedPtyEchoRecovery(),
    cancelSubmissionOutput: () => addon.cancelManagedPtyEchoSuppression(),
    submitCommand: (command, options) => addon.submitManagedPtyCommand(
      command,
      tracker.getSessionNonce(),
      options
    ),
    interrupt: () => addon.interruptManagedPtyCommand(),
    subscribeOutput: listener => addon.onRemoteOutput(listener),
    onIdle: () => addon.flushPendingInput(),
    createToken: () => planToken
  })
  parent.handleManagedPtyCommandObserved = (command, nonce) =>
    tracker.observeManagedExternalSubmission(command, nonce)
  parent.handleManagedPtyInput = data => controller.handleUserInput(data)
  tracker.onPromptStarted(() => controller.handlePromptStarted())
  tracker.onCommandInputStarted(() => controller.handleCommandInputStarted())
  tracker.onCommandFinished(event => controller.handleCommandFinished(event))
  trackerHarness.osc(`A;${testTrackerNonce}`)
  trackerHarness.osc(`B;${testTrackerNonce}`)

  const lease = await controller.acquire('real-framed-plan')
  const running = lease.execute({
    request: { operation: 'probe' },
    protocol,
    timeoutMs: 1000
  })
  await Promise.resolve()
  assert.deepEqual(submissions, ['frame-init'])

  const completeFrame = (index, result = '') => {
    const promptText = index < commands.length - 1
      ? 'intermediate-hidden:# '
      : 'final-visible:# '
    addon.writeToTerminal([
      `\u001b]633;E;${testTrackerNonce};${commands[index]}\u0007`,
      `\u001b]633;C;${testTrackerNonce}\u0007`,
      `\u001b]698;SHELLPILOT_FILE_FRAME;${planToken};${index};${commands.length};${planDigest};ok\u0007`,
      result,
      `\u001b]633;D;${testTrackerNonce};0\u0007`
    ].join(''))
    addon.writeToTerminal(
      `\u001b]633;A;${testTrackerNonce}\u0007${promptText}` +
      `\u001b]633;B;${testTrackerNonce}\u0007`
    )
  }
  const completeCoalescedFrame = (index, inputInFirstChunk) => {
    const acknowledgement =
      `\u001b]698;SHELLPILOT_FILE_FRAME;${planToken};${index};` +
      `${commands.length};${planDigest};ok\u0007`
    const fileMarker =
      `\u001b]698;SHELLPILOT_FILE;${planToken};start;MA==;cm9vdA==\u0007`
    const promptFrame = `\u001b]633;A;${testTrackerNonce}\u0007`
    const inputFrame = `\u001b]633;B;${testTrackerNonce}\u0007`
    coalescedFrameIndex = index
    addon.writeToTerminal([
      `\u001b]633;E;${testTrackerNonce};${commands[index]}\u0007`,
      `\u001b]633;C;${testTrackerNonce}\u0007`,
      acknowledgement,
      fileMarker,
      `\u001b]633;D;${testTrackerNonce};0\u0007`,
      promptFrame,
      `coalesced-${index}:# `,
      inputInFirstChunk ? inputFrame : ''
    ].join(''))
    const expectedBeforeInput = [
      `${index}:listener-ack`,
      `${index}:listener-file`,
      `${index}:tracker-D`,
      `${index}:tracker-A`
    ]
    const expectedAfterInput = [
      ...expectedBeforeInput,
      `${index}:listener-A`,
      `${index}:listener-B`,
      `${index}:tracker-B`
    ]
    assert.deepEqual(
      coalescedEvents.filter(event => event.startsWith(`${index}:`)),
      inputInFirstChunk
        ? expectedAfterInput
        : expectedBeforeInput
    )
    if (!inputInFirstChunk) addon.writeToTerminal(inputFrame)
    assert.deepEqual(
      coalescedEvents.filter(event => event.startsWith(`${index}:`)),
      expectedAfterInput
    )
    assert.equal(lifecycleWrites.join('').includes(acknowledgement), false)
    assert.equal(lifecycleWrites.join('').includes(fileMarker), false)
    coalescedFrameIndex = null
    assert.equal(
      lifecycleWrites.join('').includes(`coalesced-${index}:# `), false
    )
  }
  completeCoalescedFrame(0, true)
  await Promise.resolve()
  assert.deepEqual(submissions, ['frame-init', 'frame-chunk'])
  completeCoalescedFrame(1, false)
  await Promise.resolve()
  assert.deepEqual(submissions, commands)
  let finalSettled = false
  running.then(() => {
    finalSettled = true
  })
  addon.writeToTerminal([
    `\u001b]633;E;${testTrackerNonce};frame-final\u0007`,
    `\u001b]633;C;${testTrackerNonce}\u0007`,
    `\u001b]698;SHELLPILOT_FILE_FRAME;${planToken};2;3;${planDigest};ok\u0007`,
    'PLAN_START\nPLAN_END\n',
    `\u001b]633;D;${testTrackerNonce};0\u0007`
  ].join(''))
  addon.sendToServer('queued-final-input')
  addon.writeToTerminal(
    `\u001b]633;A;${testTrackerNonce}\u0007final-visible:# `
  )
  await Promise.resolve()
  assert.equal(finalSettled, false)
  assert.equal(controller.isBusy(), true)
  assert.equal(addon.outputSuppressed, true)
  assert.equal(transportWrites.includes('queued-final-input'), false)
  addon.writeToTerminal(`\u001b]633;B;${testTrackerNonce}\u0007`)
  assert.deepEqual(await running, {
    exitCode: 0,
    identity: { uid: '0', username: 'root' },
    ok: true
  })
  assert.equal(lifecycleWrites.join('').includes('intermediate-hidden:#'), false)
  assert.equal(lifecycleWrites.join('').includes('final-visible:#'), true)
  assert.equal(addon.outputSuppressed, false)
  assert.equal(await lease.release(), true)
  assert.equal(
    submissions.filter(command => command === 'frame-cleanup').length,
    0
  )
  await Promise.resolve()
  assert.equal(
    transportWrites.filter(value => value === 'queued-final-input').length,
    1
  )

  const cancellationCommand = 'ordinary-accepted-cancel'
  const cancellationProtocol = {
    ...protocol,
    buildExecutionPlan: () => Object.freeze({
      kind: 'managed-pty-command-plan',
      version: 1,
      token: planToken,
      digest: planDigest,
      frames: Object.freeze([Object.freeze({
        sequence: 0,
        command: cancellationCommand,
        acknowledgement:
          `\u001b]698;SHELLPILOT_FILE_FRAME;${planToken};0;1;${planDigest};ok\u0007`,
        executesOperation: true
      })]),
      cleanup: null
    })
  }
  const cancellationSignal = new AbortController()
  const cancellationLease = await controller.acquire('real-accepted-cancel')
  const cancellationRunning = cancellationLease.execute({
    request: { operation: 'probe' },
    protocol: cancellationProtocol,
    timeoutMs: 1000,
    signal: cancellationSignal.signal
  })
  const cancellationObserved = cancellationRunning.catch(error => error)
  let cancellationSettled = false
  cancellationObserved.then(() => {
    cancellationSettled = true
  })
  await Promise.resolve()
  cancellationSignal.abort()
  addon.sendToServer('queued-cancel-input')
  addon.writeToTerminal(
    `\u001b]633;A;${testTrackerNonce}\u0007cancel-visible:# `
  )
  await Promise.resolve()
  assert.equal(cancellationSettled, false)
  assert.equal(controller.isBusy(), true)
  assert.equal(addon.outputSuppressed, true)
  assert.equal(transportWrites.includes('queued-cancel-input'), false)
  addon.writeToTerminal(`\u001b]633;B;${testTrackerNonce}\u0007`)
  assert.equal((await cancellationObserved).name, 'AbortError')
  assert.equal(await cancellationLease.release(), true)
  await Promise.resolve()
  assert.equal(
    transportWrites.filter(value => value === 'queued-cancel-input').length,
    1
  )

  rejectNextChunk = true
  const signalController = new AbortController()
  const cleanupLease = await controller.acquire('real-framed-cleanup')
  const cancelled = cleanupLease.execute({
    request: { operation: 'probe' },
    protocol,
    timeoutMs: 1000,
    signal: signalController.signal
  }).catch(error => error)
  await Promise.resolve()
  completeFrame(0)
  await Promise.resolve()
  assert.equal(submissions.at(-1), 'frame-chunk')
  signalController.abort()
  const rejection = new Error('definitive transport rejection')
  rejection.name = 'AbortError'
  blockedChunk.reject(rejection)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(submissions.at(-1), 'frame-cleanup')
  assert.equal(submissions.filter(command => command === 'frame-final').length, 1)
  await Promise.resolve()
  let cleanupSettled = false
  cancelled.then(() => {
    cleanupSettled = true
  })
  addon.writeToTerminal([
    `\u001b]633;E;${testTrackerNonce};frame-cleanup\u0007`,
    `\u001b]633;C;${testTrackerNonce}\u0007`,
    `\u001b]698;SHELLPILOT_FILE_FRAME;${planToken};3;3;${planDigest};ok\u0007`,
    `\u001b]633;D;${testTrackerNonce};0\u0007`
  ].join(''))
  addon.writeToTerminal(
    `\u001b]633;A;${testTrackerNonce}\u0007cleanup:# `
  )
  addon.sendToServer('queued-cleanup-input')
  await Promise.resolve()
  assert.equal(cleanupSettled, false)
  assert.equal(controller.isBusy(), true)
  assert.equal(addon.outputSuppressed, true)
  assert.equal(transportWrites.includes('queued-cleanup-input'), false)
  addon.writeToTerminal(`\u001b]633;B;${testTrackerNonce}\u0007`)
  assert.equal((await cancelled).name, 'AbortError')
  assert.equal(await cleanupLease.release(), true)
  await Promise.resolve()
  assert.equal(
    transportWrites.filter(value => value === 'queued-cleanup-input').length,
    1
  )

  rejectNextChunk = false
  cleanupAcceptance = deferred()
  const boundaryLease = await controller.acquire('real-framed-boundary-cleanup')
  const boundaryRunning = boundaryLease.execute({
    request: { operation: 'probe' },
    protocol,
    timeoutMs: 1000
  })
  const boundaryObserved = boundaryRunning.catch(error => error)
  let boundarySettled = false
  boundaryObserved.then(() => {
    boundarySettled = true
  })
  await Promise.resolve()
  const initialSubmissionCount = submissions.length
  addon.writeToTerminal([
    `\u001b]633;E;${testTrackerNonce};frame-init\u0007`,
    `\u001b]633;C;${testTrackerNonce}\u0007`,
    `\u001b]698;SHELLPILOT_FILE_FRAME;${planToken};0;3;${'b'.repeat(64)};ok\u0007`,
    `\u001b]633;D;${testTrackerNonce};0\u0007`
  ].join(''))
  addon.writeToTerminal(
    `\u001b]633;A;${testTrackerNonce}\u0007boundary:# `
  )
  await Promise.resolve()
  assert.equal(boundarySettled, false)
  assert.equal(submissions.length, initialSubmissionCount)

  addon.writeToTerminal(`\u001b]633;B;${testTrackerNonce}\u0007`)
  await Promise.resolve()
  assert.equal(submissions.at(-1), 'frame-cleanup')

  controller.handlePromptStarted()
  controller.handleCommandInputStarted()
  cleanupAcceptance.resolve(true)
  await Promise.resolve()
  addon.writeToTerminal([
    `\u001b]633;E;${testTrackerNonce};frame-cleanup\u0007`,
    `\u001b]633;C;${testTrackerNonce}\u0007`,
    `\u001b]698;SHELLPILOT_FILE_FRAME;${planToken};3;3;${planDigest};ok\u0007`,
    `\u001b]633;D;${testTrackerNonce};0\u0007`
  ].join(''))
  await Promise.resolve()
  assert.equal(boundarySettled, false)

  addon.writeToTerminal(
    `\u001b]633;A;${testTrackerNonce}\u0007cleanup-boundary:# ` +
    `\u001b]633;B;${testTrackerNonce}\u0007`
  )
  const boundaryError = await boundaryObserved
  assert.match(boundaryError.message, /顺序或认证无效/)
  assert.equal(await boundaryLease.release(), true)
})

test('managed PTY bounds unterminated lifecycle bytes and recovers at a prompt', async () => {
  const { addon, sent, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  addon.onRemoteOutput(chunk => output.push(chunk))
  const command = 'frame-with-unterminated-lifecycle'
  assert.ok(addon.submitManagedPtyCommand(
    command,
    testTrackerNonce,
    { holdSuppression: true }
  ))
  addon.writeToTerminal(
    `\u001b]633;E;${testTrackerNonce};${command}\u0007`
  )
  addon.sendToServer('queued-after-overflow')

  const prefix = `\u001b]633;E;${testTrackerNonce};`
  for (const chunk of [prefix, ...Array(6).fill('深'.repeat(600))]) {
    addon.writeToTerminal(chunk)
  }
  assert.ok(addon.managedPtyLifecycleBytes.byteLength <= 8192)
  assert.equal(addon.outputSuppressed, true)
  assert.equal(sent.includes('queued-after-overflow'), false)
  assert.equal(writes.join('').includes('深'), false)
  assert.equal(output.join('').includes('深'), false)

  addon.writeToTerminal(
    `\u001b]633;A;${testTrackerNonce}\u0007recovered:# ` +
    `\u001b]633;B;${testTrackerNonce}\u0007`
  )
  await Promise.resolve()
  assert.equal(addon.outputSuppressed, false)
  assert.equal(addon.managedPtyLifecycleBytes.byteLength, 0)
  assert.equal(sent.at(-1), 'queued-after-overflow')
  assert.equal(writes.join('').includes('recovered:#'), true)
  assert.equal(writes.join('').includes('深'), false)
})

test('managed PTY recovers when an oversized lifecycle frame precedes A B', async () => {
  const { addon, sent, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  addon.onRemoteOutput(chunk => output.push(chunk))
  const command = 'frame-with-complete-oversized-lifecycle'
  assert.ok(addon.submitManagedPtyCommand(
    command,
    testTrackerNonce,
    { holdSuppression: true }
  ))
  addon.writeToTerminal(
    `\u001b]633;E;${testTrackerNonce};${command}\u0007`
  )
  addon.sendToServer('queued-after-complete-overflow')

  addon.writeToTerminal(
    `\u001b]633;E;${testTrackerNonce};${'深'.repeat(3000)}\u0007` +
    `\u001b]633;A;${testTrackerNonce}\u0007recovered-same-chunk:# ` +
    `\u001b]633;B;${testTrackerNonce}\u0007`
  )
  await Promise.resolve()
  assert.equal(addon.outputSuppressed, false)
  assert.equal(sent.at(-1), 'queued-after-complete-overflow')
  assert.equal(writes.join('').includes('recovered-same-chunk:#'), true)
  assert.equal(writes.join('').includes('深'), false)
  assert.equal(output.join('').includes('深'), false)
})

test('managed PTY recovers from pre-E overflow and same-chunk A B', async () => {
  const { addon, sent, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  addon.onRemoteOutput(chunk => output.push(chunk))
  const command = 'frame-awaiting-command-record'
  assert.ok(addon.submitManagedPtyCommand(
    command,
    testTrackerNonce,
    { holdSuppression: true }
  ))
  addon.sendToServer('queued-before-command-record')

  addon.writeToTerminal(
    `\u001b]633;E;${testTrackerNonce};${'深'.repeat(3000)}\u0007` +
    `\u001b]633;A;${testTrackerNonce}\u0007recovered-pre-E:# ` +
    `\u001b]633;B;${testTrackerNonce}\u0007`
  )
  await Promise.resolve()
  assert.equal(addon.outputSuppressed, false)
  assert.equal(sent.at(-1), 'queued-before-command-record')
  assert.equal(writes.join('').includes('recovered-pre-E:#'), true)
  assert.equal(writes.join('').includes('深'), false)
  assert.equal(output.join('').includes('深'), false)
})

test('managed PTY publishes safe data around split lifecycle frames once', async () => {
  const { addon, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  addon.onRemoteOutput(chunk => output.push(chunk))
  const command = 'frame-with-split-lifecycle-output'
  assert.ok(addon.submitManagedPtyCommand(
    command,
    testTrackerNonce,
    { holdSuppression: true }
  ))
  addon.writeToTerminal(
    `\u001b]633;E;${testTrackerNonce};${command}\u0007`
  )

  const acknowledgement =
    `\u001b]698;SHELLPILOT_FILE_FRAME;token;0;1;${'a'.repeat(64)};ok\u0007`
  const firstLifecycle =
    `\u001b]633;D;${testTrackerNonce};0\u0007`
  const fileMarker =
    '\u001b]698;SHELLPILOT_FILE;token;start;MA==;cm9vdA==\u0007'
  const secondLifecycle =
    `\u001b]633;A;${testTrackerNonce}\u0007`
  const inputLifecycle =
    `\u001b]633;B;${testTrackerNonce}\u0007`

  addon.writeToTerminal(
    acknowledgement + firstLifecycle.slice(0, -1)
  )
  assert.equal(output.join(''), acknowledgement)
  addon.writeToTerminal(
    firstLifecycle.slice(-1) + fileMarker + '\u001b]63'
  )
  assert.equal(
    output.join(''),
    acknowledgement + firstLifecycle + fileMarker
  )
  addon.writeToTerminal(secondLifecycle.slice('\u001b]63'.length))
  assert.equal(
    output.join(''),
    acknowledgement + firstLifecycle + fileMarker
  )
  addon.writeToTerminal(inputLifecycle)
  assert.equal(
    output.join(''),
    acknowledgement + firstLifecycle + fileMarker +
      secondLifecycle + inputLifecycle
  )
  assert.equal(output.join('').split(acknowledgement).length - 1, 1)
  assert.equal(output.join('').split(fileMarker).length - 1, 1)
  assert.equal(writes.join('').includes(acknowledgement), false)
  assert.equal(writes.join('').includes(fileMarker), false)
  addon.cancelManagedPtyEchoSuppression()
})

test('managed PTY preserves a coalesced safe prefix before prompt A B', async () => {
  const acknowledgement =
    `\u001b]698;SHELLPILOT_FILE_FRAME;token;0;1;${'a'.repeat(64)};ok\u0007`
  const fileMarker =
    '\u001b]698;SHELLPILOT_FILE;token;start;MA==;cm9vdA==\u0007'
  const finishFrame = `\u001b]633;D;${testTrackerNonce};0\u0007`
  const promptFrame = `\u001b]633;A;${testTrackerNonce}\u0007`
  const inputFrame = `\u001b]633;B;${testTrackerNonce}\u0007`
  const safePrefix = acknowledgement + fileMarker + finishFrame
  const promptTail = 'coalesced:# '

  for (const inputInFirstChunk of [false, true]) {
    const { addon, term } = await createDirectAttachHarness()
    const writes = []
    const output = []
    term.write = value => writes.push(value)
    addon.onRemoteOutput(chunk => output.push(chunk))
    const command = `coalesced-prefix-${inputInFirstChunk}`
    assert.ok(addon.submitManagedPtyCommand(
      command,
      testTrackerNonce
    ))
    addon.writeToTerminal(
      `\u001b]633;E;${testTrackerNonce};${command}\u0007`
    )
    assert.equal(addon.managedPtyOutputStreamingActive, true)

    addon.writeToTerminal(
      safePrefix + promptFrame + promptTail +
      (inputInFirstChunk ? inputFrame : '')
    )
    if (!inputInFirstChunk) {
      assert.equal(
        writes.join('').split(finishFrame).length - 1,
        1
      )
      assert.ok(
        writes.join('').indexOf(finishFrame) <
        writes.join('').indexOf(promptFrame)
      )
      assert.equal(output.join(''), safePrefix)
      addon.writeToTerminal(inputFrame)
    }

    const expected = safePrefix + promptFrame + promptTail + inputFrame
    assert.equal(output.join(''), expected)
    assert.equal(
      writes.join('').split(finishFrame).length - 1,
      1
    )
    assert.ok(
      writes.join('').indexOf(finishFrame) <
      writes.join('').indexOf(promptFrame)
    )
    assert.equal(
      output.join('').split(acknowledgement).length - 1,
      1
    )
    assert.equal(output.join('').split(fileMarker).length - 1, 1)
    assert.equal(writes.join('').includes(acknowledgement), false)
    assert.equal(writes.join('').includes(fileMarker), false)
    addon.cancelManagedPtyEchoSuppression()
  }
})

test('managed PTY ignores authenticated B before A until a later B', async () => {
  const { addon, sent, term } = await createDirectAttachHarness()
  const writes = []
  term.write = value => writes.push(value)
  const command = 'ordered-prompt-boundary'
  const finishFrame = `\u001b]633;D;${testTrackerNonce};0\u0007`
  const promptFrame = `\u001b]633;A;${testTrackerNonce}\u0007`
  const inputFrame = `\u001b]633;B;${testTrackerNonce}\u0007`
  const queuedInput = 'queued-after-b-before-a'
  assert.equal(addon.submitManagedPtyCommand(
    command,
    testTrackerNonce
  ), true)
  addon.writeToTerminal(
    `\u001b]633;E;${testTrackerNonce};${command}\u0007`
  )
  addon.sendToServer(queuedInput)

  addon.writeToTerminal(
    finishFrame + inputFrame + promptFrame + 'ordered:# '
  )

  assert.equal(addon.outputSuppressed, true)
  assert.equal(sent.includes(queuedInput), false)
  assert.equal(writes.join('').split(finishFrame).length - 1, 1)
  assert.equal(writes.join('').split(promptFrame).length - 1, 1)
  assert.equal(writes.join('').split(inputFrame).length - 1, 0)
  assert.ok(
    writes.join('').indexOf(finishFrame) <
    writes.join('').indexOf(promptFrame)
  )

  addon.writeToTerminal(inputFrame)
  await Promise.resolve()

  assert.equal(addon.outputSuppressed, false)
  assert.equal(sent.at(-1), queuedInput)
  assert.equal(writes.join('').split(finishFrame).length - 1, 1)
  assert.equal(writes.join('').split(promptFrame).length - 1, 1)
  assert.equal(writes.join('').split(inputFrame).length - 1, 1)
  assert.ok(
    writes.join('').indexOf(promptFrame) <
    writes.join('').indexOf(inputFrame)
  )
})

test('managed PTY keeps privileged probe output hidden until authenticated prompt', async () => {
  const { addon, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  addon.onRemoteOutput(chunk => output.push(chunk))
  const command = 'command /usr/bin/env SHELLPILOT_FILE=1 __sp_probe=hidden'
  const commandRecord =
    `\u001b]633;E;${testTrackerNonce};${command}\u0007`
  const hiddenOutput = [
    `\u001b]633;C;${testTrackerNonce}\u0007`,
    '\u001b]698;SHELLPILOT_FILE;token;start;MA==;cm9vdA==\u0007',
    'shellpilot root one read\r\n',
    `\u001b]633;D;${testTrackerNonce};0\u0007`
  ].join('')
  const prompt =
    `\u001b]633;A;${testTrackerNonce}\u0007` +
    'user@fixture:$ ' +
    `\u001b]633;B;${testTrackerNonce}\u0007`

  assert.equal(addon.submitManagedPtyCommand(command, testTrackerNonce), true)
  addon.writeToTerminal(`${command}\r\n`)
  addon.writeToTerminal(commandRecord + hiddenOutput)

  assert.equal(addon.outputSuppressed, true)
  assert.equal(writes.join('').includes('shellpilot root one read'), false)
  assert.equal(output.join('').includes('shellpilot root one read'), true)

  addon.writeToTerminal(prompt)

  assert.equal(addon.outputSuppressed, false)
  assert.equal(writes.join('').includes('shellpilot root one read'), false)
  assert.equal(writes.join('').includes('user@fixture:$ '), true)
  assert.equal(addon.managedPtySessionNonce, '')
})

test('managed PTY consumes a maximum-budget authenticated E record before xterm', async () => {
  const { addon, sent, parent, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  const observed = []
  term.write = value => writes.push(value)
  parent.handleManagedPtyCommandObserved = (command, nonce) => {
    observed.push({ command, nonce })
    return true
  }
  addon.onRemoteOutput(chunk => output.push(chunk))
  const command = [
    '__sp_secret=hidden',
    `__sp_payload=${'x'.repeat(3000)}`,
    "printf '\\007'"
  ].join('; ')
  const escapedCommand = command
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\x3b')
  const commandRecord =
    `\u001b]633;E;${testTrackerNonce};${escapedCommand}\u0007`
  const visibleRemainder =
    `\u001b]633;C;${testTrackerNonce}\u0007` +
    '\u001b]698;SHELLPILOT_FILE;token;start;MA==;cm9vdA==\u0007'
  const prompt =
    `\u001b]633;A;${testTrackerNonce}\u0007fixture:# ` +
    `\u001b]633;B;${testTrackerNonce}\u0007`

  assert.equal(addon.submitManagedPtyCommand(command, testTrackerNonce), true)
  addon.writeToTerminal(`${command}\r\n${commandRecord.slice(0, 1024)}`)
  assert.equal(addon.outputSuppressed, true)
  assert.deepEqual(writes, [])
  assert.deepEqual(output, [])

  addon.writeToTerminal(commandRecord.slice(1024) + visibleRemainder)

  assert.equal(addon.outputSuppressed, true)
  assert.deepEqual(observed, [{ command, nonce: testTrackerNonce }])
  assert.deepEqual(output, [visibleRemainder])
  assert.equal(writes.join('').includes('__sp_secret'), false)
  assert.equal(output.join('').includes('__sp_secret'), false)

  addon.writeToTerminal(prompt)
  assert.equal(addon.outputSuppressed, false)
  assert.equal(writes.join('').includes('fixture:# '), true)
  assert.deepEqual(output, [visibleRemainder, prompt])
  addon.sendToServer('x')
  assert.deepEqual(sent, [
    terminalControlMessage('managed-input', {
      requestId: testTrackerNonce,
      command
    }),
    'x'
  ])
})

test('managed PTY suppression ignores a wrong nonce and finds a split authenticated marker', async () => {
  const { addon, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  addon.onRemoteOutput(chunk => output.push(chunk))
  const command = 'printf managed'
  const wrongNonce = 'fedcba0987654321fedcba0987654321'
  const commandRecord =
    `\u001b]633;E;${testTrackerNonce};${command}\u0007`
  const remainder =
    `\u001b]633;C;${testTrackerNonce}\u0007` +
    '\u001b]698;SHELLPILOT_FILE;token;start;MA==;cm9vdA==\u0007'
  const prompt =
    `\u001b]633;A;${testTrackerNonce}\u0007fixture:# ` +
    `\u001b]633;B;${testTrackerNonce}\u0007`

  assert.equal(addon.submitManagedPtyCommand(command, testTrackerNonce), true)
  addon.writeToTerminal(
    `\u001b]633;E;${wrongNonce};forged\u0007\u001b]63`
  )
  assert.equal(addon.outputSuppressed, true)
  assert.deepEqual(writes, [])
  assert.deepEqual(output, [])

  addon.writeToTerminal(
    (commandRecord + remainder).slice('\u001b]63'.length)
  )
  assert.equal(addon.outputSuppressed, true)
  assert.deepEqual(output, [remainder])

  addon.writeToTerminal(prompt)
  assert.equal(addon.outputSuppressed, false)
  assert.equal(addon.managedPtySessionNonce, '')
  assert.equal(addon.prepareManagedPtyEchoRecovery(), false)
  assert.equal(writes.join('').includes('fixture:# '), true)
  assert.deepEqual(output, [remainder, prompt])
})

test('managed PTY suppression finds an authenticated marker split across binary chunks', async () => {
  const { addon, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  addon.onRemoteOutput(chunk => output.push(chunk))
  const command = 'printf binary'
  const commandRecord =
    `\u001b]633;E;${testTrackerNonce};${command}\u0007`
  const remainder =
    `\u001b]633;C;${testTrackerNonce}\u0007` +
    '\u001b]698;SHELLPILOT_FILE;token;start;MA==;cm9vdA==\u0007'
  const prompt =
    `\u001b]633;A;${testTrackerNonce}\u0007fixture:# ` +
    `\u001b]633;B;${testTrackerNonce}\u0007`
  const bytes = new TextEncoder().encode(commandRecord + remainder)

  assert.equal(addon.submitManagedPtyCommand(command, testTrackerNonce), true)
  addon.writeToTerminal(bytes.slice(0, 4))
  assert.equal(addon.outputSuppressed, true)
  addon.writeToTerminal(bytes.slice(4))

  assert.equal(addon.outputSuppressed, true)
  assert.deepEqual(output, [remainder])

  addon.writeToTerminal(new TextEncoder().encode(prompt))
  assert.equal(addon.outputSuppressed, false)
  assert.equal(addon.managedPtySessionNonce, '')
  assert.equal(addon.prepareManagedPtyEchoRecovery(), false)
  assert.equal(writes.join('').includes('fixture:# '), true)
  assert.deepEqual(output, [remainder, prompt])
})

test('managed PTY command echo stays hidden past the legacy deadline', async () => {
  const { addon, term } = await createDirectAttachHarness()
  const writes = []
  term.write = value => writes.push(value)
  const originalStart = addon.startOutputSuppression
  let requestedTimeout
  addon.startOutputSuppression = (timeout, ...args) => {
    requestedTimeout = timeout
    return originalStart(timeout === null ? null : 5, ...args)
  }

  assert.equal(addon.submitManagedPtyCommand(
    'SHELLPILOT_FILE=1 __sp_secret=hidden',
    testTrackerNonce
  ), true)
  addon.writeToTerminal('SHELLPILOT_FILE=1 __sp_first=hidden')
  await new Promise(resolve => setTimeout(resolve, 20))
  addon.writeToTerminal(' __sp_after_legacy_deadline=hidden')

  assert.equal(requestedTimeout, null)
  assert.equal(addon.outputSuppressed, true)
  assert.deepEqual(writes, [])
  assert.equal(addon.cancelManagedPtyEchoSuppression(), true)
  assert.equal(addon.outputSuppressed, false)
  assert.equal(addon.managedPtySessionNonce, '')
  assert.equal(addon.prepareManagedPtyEchoRecovery(), false)
  addon.writeToTerminal('ordinary output')
  assert.deepEqual(writes, ['ordinary output'])
  assert.equal(addon.cancelManagedPtyEchoSuppression(), true)
})

test('managed PTY cancellation hides late echo until the authenticated prompt', async () => {
  const { addon, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  addon.onRemoteOutput(chunk => output.push(chunk))
  const command = 'SHELLPILOT_FILE=1 __sp_secret=hidden'
  const wrongNonce = 'fedcba0987654321fedcba0987654321'
  const prompt =
    `\u001b]633;A;${testTrackerNonce}\u0007` +
    'root@fixture:# ' +
    `\u001b]633;B;${testTrackerNonce}\u0007`

  assert.equal(addon.submitManagedPtyCommand(command, testTrackerNonce), true)
  addon.writeToTerminal(`${command}\r\n`)
  assert.equal(addon.prepareManagedPtyEchoRecovery(), true)
  addon.writeToTerminal('__sp_cancel_tail=hidden')
  addon.writeToTerminal(`\u001b]633;A;${wrongNonce}\u0007forged prompt`)

  assert.equal(addon.outputSuppressed, true)
  assert.deepEqual(writes, [])
  assert.deepEqual(output, [])

  const split = 12
  addon.writeToTerminal(prompt.slice(0, split))
  assert.equal(addon.outputSuppressed, true)
  addon.writeToTerminal(prompt.slice(split))

  assert.equal(addon.outputSuppressed, false)
  assert.equal(writes.join(''), prompt)
  assert.deepEqual(output, [prompt])
  assert.equal(addon.managedPtySessionNonce, '')
  assert.equal(addon.prepareManagedPtyEchoRecovery(), false)
  assert.equal(writes.join('').includes('__sp_cancel_tail'), false)
  assert.equal(output.join('').includes('__sp_cancel_tail'), false)
  assert.equal(addon.cancelManagedPtyEchoSuppression(), true)
})

test('managed PTY recovery preserves binary prompt bytes split across UTF-8 characters', async () => {
  const { addon, term } = await createDirectAttachHarness()
  const writes = []
  const output = []
  term.write = value => writes.push(value)
  addon.onRemoteOutput(chunk => output.push(chunk))
  const command = 'SHELLPILOT_FILE=1 __sp_secret=hidden'
  const marker = `\u001b]633;A;${testTrackerNonce}\u0007`
  const inputMarker = `\u001b]633;B;${testTrackerNonce}\u0007`
  const prompt = `${marker}中root@fixture:# ${inputMarker}`
  const promptBytes = new TextEncoder().encode(prompt)
  const split = marker.length + 1

  assert.equal(addon.submitManagedPtyCommand(command, testTrackerNonce), true)
  addon.writeToTerminal(`${command}\r\n`)
  assert.equal(addon.prepareManagedPtyEchoRecovery(), true)
  addon.writeToTerminal('__sp_cancel_tail=hidden')
  addon.writeToTerminal(promptBytes.slice(0, split))
  const originalFileReader = globalThis.FileReader
  const originalBlob = globalThis.window.Blob
  globalThis.window.Blob = Blob
  globalThis.FileReader = class {
    addEventListener (_type, handler) {
      this.handler = handler
    }

    readAsArrayBuffer (blob) {
      blob.arrayBuffer().then(buffer => this.handler({ target: { result: buffer } }))
    }
  }
  try {
    addon.writeToTerminal(promptBytes.slice(split))
    await new Promise(resolve => setTimeout(resolve, 0))
  } finally {
    globalThis.FileReader = originalFileReader
    globalThis.window.Blob = originalBlob
  }

  assert.equal(addon.outputSuppressed, false)
  assert.equal(addon.managedPtySessionNonce, '')
  assert.equal(addon.prepareManagedPtyEchoRecovery(), false)
  assert.equal(writes.join(''), prompt)
  assert.equal(output.join(''), prompt)
  assert.equal(writes.join('').includes('\ufffd'), false)
  assert.equal(output.join('').includes('\ufffd'), false)
  assert.equal(writes.join('').includes('__sp_cancel_tail'), false)
  assert.equal(output.join('').includes('__sp_cancel_tail'), false)
})

test('managed PTY bounds the first authenticated A prompt tail', async () => {
  const promptFrame = `\u001b]633;A;${testTrackerNonce}\u0007`
  const inputFrame = `\u001b]633;B;${testTrackerNonce}\u0007`
  const oversizedPrompt = '深'.repeat(3000)
  assert.ok(Buffer.byteLength(oversizedPrompt, 'utf8') > 8192)

  for (const inputInFirstChunk of [true, false]) {
    const { addon, sent, term } = await createDirectAttachHarness()
    const writes = []
    const output = []
    term.write = value => writes.push(value)
    addon.onRemoteOutput(chunk => output.push(chunk))
    const command = 'bounded-authenticated-prompt'
    assert.equal(addon.submitManagedPtyCommand(
      command,
      testTrackerNonce
    ), true)
    addon.writeToTerminal(
      `\u001b]633;E;${testTrackerNonce};${command}\u0007`
    )
    assert.equal(addon.managedPtyOutputStreamingActive, true)
    addon.sendToServer('queued-after-large-prompt')
    addon.writeToTerminal(
      promptFrame + oversizedPrompt + (inputInFirstChunk ? inputFrame : '')
    )
    if (!inputInFirstChunk) addon.writeToTerminal(inputFrame)

    assert.equal(addon.outputSuppressed, true)
    assert.ok(addon.managedPtyPromptReleaseBytes.byteLength <= 8192)
    assert.equal(sent.includes('queued-after-large-prompt'), false)
    assert.equal(writes.join('').includes(oversizedPrompt), false)
    assert.equal(output.join('').includes(oversizedPrompt), false)

    addon.writeToTerminal(promptFrame + 'recovered:# ' + inputFrame)
    await Promise.resolve()
    assert.equal(addon.outputSuppressed, false)
    assert.equal(sent.at(-1), 'queued-after-large-prompt')
    assert.equal(writes.join('').includes(oversizedPrompt), false)
    assert.equal(output.join('').includes(oversizedPrompt), false)
  }
})

test('managed PTY suppression clears after synchronous send failure', async () => {
  const failedHarness = await createDirectAttachHarness()
  failedHarness.addon._sendData = () => {
    throw new Error('send failed')
  }
  assert.throws(
    () => failedHarness.addon.submitManagedPtyCommand(
      'printf failure',
      testTrackerNonce
    ),
    /send failed/
  )
  assert.equal(failedHarness.addon.outputSuppressed, false)
  assert.equal(failedHarness.addon.managedPtyEchoSuppressionActive, false)
  assert.equal(failedHarness.addon.managedPtySessionNonce, '')
  assert.equal(failedHarness.addon.prepareManagedPtyEchoRecovery(), false)
  assert.deepEqual(failedHarness.addon.suppressedData, [])
})

test('managed PTY suppression dispose clears hidden output and pending input', async () => {
  const { addon, term } = await createDirectAttachHarness()
  const writes = []
  term.write = value => writes.push(value)

  assert.equal(addon.submitManagedPtyCommand(
    'SHELLPILOT_FILE=1 __sp_secret=hidden',
    testTrackerNonce
  ), true)
  addon.writeToTerminal('SHELLPILOT_FILE=1 __sp_hidden=secret')
  addon.pendingInput.push('queued input')

  addon.dispose()

  assert.equal(addon.outputSuppressed, false)
  assert.equal(addon.managedPtyEchoSuppressionActive, false)
  assert.equal(addon.managedPtySessionNonce, '')
  assert.equal(addon.prepareManagedPtyEchoRecovery(), false)
  assert.deepEqual(addon.suppressedData, [])
  assert.equal(addon.suppressionReleaseMarker, '')
  assert.equal(addon.suppressionScanText, '')
  assert.deepEqual(addon.pendingInput, [])
  assert.equal(addon.term, null)
  assert.equal(addon.suppressionDecoder instanceof TextDecoder, true)
  assert.deepEqual(writes, [])
})

test('AttachAddon exposes password state without publishing suppressed integration output', async () => {
  const { addon, term } = await createDirectAttachHarness()
  const output = []
  term.write = () => {}
  addon.onRemoteOutput(chunk => output.push(chunk))
  addon._passwordPromptDetected = true
  addon.startOutputSuppression(1000)

  addon.writeToTerminal('hidden integration command')

  assert.equal(addon.isPasswordPromptDetected(), true)
  assert.deepEqual(output, [])
  await addon.stopOutputSuppression(true)
})

test('current child shell integration clears inherited stale state and reuses nonce', async () => {
  const {
    getCurrentShellIntegrationCommand
  } = await importShellIntegration()
  const command = getCurrentShellIntegrationCommand(testTrackerNonce)

  assert.match(command, /unset ELECTERM_SHELL_INTEGRATION/)
  assert.match(command, /BASH_VERSION/)
  assert.match(command, /ZSH_VERSION/)
  assert.equal(command.split(testTrackerNonce).length > 2, true)
  assert.equal(command.endsWith('\r'), true)
  assert.doesNotMatch(command, /detectRemoteShell|runCmd/)
})

test('shell transition detection is conservative about interactive child shells', async () => {
  const { isInteractiveShellTransitionCommand } =
    await importShellIntegration()
  const accepted = [
    'su root',
    'su - root',
    'sudo -i',
    'sudo -u root -s',
    'bash',
    '/bin/zsh -l'
  ]
  const rejected = [
    'sleep 60',
    'sudo tcpdump -i eth0',
    'su root -c id',
    'bash -c id',
    'sudo -i whoami',
    'su root; id'
  ]

  for (const command of accepted) {
    assert.equal(isInteractiveShellTransitionCommand(command), true, command)
  }
  for (const command of rejected) {
    assert.equal(isInteractiveShellTransitionCommand(command), false, command)
  }
})

test('shell integration detection forwards authenticated OSC data after hidden injection echo', async () => {
  const writes = []
  const term = {
    write: data => writes.push(data),
    buffer: { active: { type: 'normal' } }
  }
  const AttachAddon = await importAttachAddon()
  const addon = new AttachAddon(term, {}, false)
  let suppressionEnded = false
  addon.startOutputSuppression(1000, () => { suppressionEnded = true })

  addon.writeToTerminal(
    ` hidden injection echo\r\n\u001b]633;A;${testTrackerNonce}\u0007prompt`
  )

  assert.equal(suppressionEnded, true)
  assert.deepEqual(writes, [
    `\u001b]633;A;${testTrackerNonce}\u0007prompt`
  ])
})

test('AttachAddon queues user input while shell integration output is suppressed', async () => {
  const { addon, sent } = await createDirectAttachHarness()
  addon.startOutputSuppression(1000)

  addon.sendToServer('echo ')
  addon.sendToServer('shellpilot-e2e')
  addon.sendToServer('\r')

  assert.deepEqual(sent, [])
  await addon.stopOutputSuppression(true)
  assert.deepEqual(sent, ['echo ', 'shellpilot-e2e', '\r'])
})

test('AttachAddon preserves ordinary input while a managed PTY lease is active', async () => {
  const { addon, parent, sent } = await createDirectAttachHarness()
  let managedActive = true
  parent.handleManagedPtyInput = data => managedActive
    ? {
        handled: true,
        send: false,
        queue: data !== '\x03'
      }
    : { handled: false, send: false }

  addon.sendToServer('echo ')
  addon.sendToServer('shellpilot-e2e')
  addon.sendToServer('\r')
  addon.sendToServer('\x03')

  assert.deepEqual(sent, [])
  assert.deepEqual(addon.pendingInput, ['echo ', 'shellpilot-e2e', '\r'])
  managedActive = false
  await addon.flushPendingInput()
  assert.deepEqual(sent, ['echo ', 'shellpilot-e2e', '\r'])
  assert.deepEqual(addon.pendingInput, [])
})

function createTrackerTerminal (options = {}) {
  const cols = options.cols || 40
  let oscHandler
  let lineDefinitions = options.lines || [{ text: '$ ', isWrapped: false }]
  const active = {
    type: 'normal',
    baseY: options.baseY || 0,
    cursorY: options.cursorY || 0,
    cursorX: options.cursorX ?? 2,
    getLine: index => {
      const definition = lineDefinitions[index]
      if (!definition) return undefined
      return {
        isWrapped: definition.isWrapped === true,
        getCell: options.cellAware
          ? column => {
            const character = String(definition.text || '')[column]
            return {
              getCode: () => character === undefined ? 0 : character.codePointAt(0),
              getChars: () => character === undefined ? '' : character
            }
          }
          : undefined,
        translateToString: (trimRight, start = 0, end = cols) => {
          const padded = String(definition.text || '').padEnd(cols, ' ').slice(0, cols)
          const selected = padded.slice(start, end)
          return trimRight ? selected.replace(/\s+$/, '') : selected
        }
      }
    }
  }
  const terminal = {
    cols,
    buffer: { active },
    parser: {
      registerOscHandler: (_code, handler) => {
        oscHandler = handler
        return { dispose () {} }
      }
    }
  }
  return {
    terminal,
    osc: data => oscHandler(data),
    setCursor: (absoluteRow, column) => {
      active.cursorY = absoluteRow - active.baseY
      active.cursorX = column
    },
    setLines: definitions => { lineDefinitions = definitions }
  }
}

const testTrackerNonce = '1234567890abcdef1234567890abcdef'

function beginTrackerSession (tracker) {
  return tracker.beginSession(testTrackerNonce)
}

function completionOsc (exitCode = '') {
  return `D;${testTrackerNonce};${exitCode}`
}

function lifecycleOsc (type, payload, nonce = testTrackerNonce) {
  return payload === undefined
    ? `${type};${nonce}`
    : `${type};${nonce};${payload}`
}

function protectedSshContext (overrides = {}) {
  return {
    enabled: true,
    isSsh: true,
    passwordMode: false,
    alternateBuffer: false,
    isPaste: false,
    shellIntegrationActive: true,
    commandInputActive: true,
    canonicalInputReliable: true,
    ...overrides
  }
}

function readClientFile (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../src/client', relativePath), 'utf8')
}

test('password local disabled paste TUI and untracked shells stay transparent', async () => {
  const { createTerminalSafetyController } = await importController()
  const contexts = [
    protectedSshContext({ passwordMode: true }),
    protectedSshContext({ isSsh: false }),
    protectedSshContext({ enabled: false }),
    protectedSshContext({ isPaste: true }),
    protectedSshContext({ alternateBuffer: true }),
    protectedSshContext({ shellIntegrationActive: false }),
    protectedSshContext({ commandInputActive: false }),
    protectedSshContext({ canonicalInputReliable: false })
  ]

  for (const context of contexts) {
    const controller = createTerminalSafetyController()
    assert.deepEqual(
      controller.beforeEnter('systemctl restart nginx', context),
      { sendNow: true }
    )
  }
})

test('CommandTrackerAddon reconstructs the full command after a cursor-middle edit', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({
    cols: 80,
    cursorX: 2,
    cellAware: true
  })
  const tracker = new CommandTrackerAddon()
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  harness.setLines([{
    text: '$ /usr/bin/uptime; /usr/bin/systemctl start nginx',
    isWrapped: false
  }])
  harness.setCursor(0, '$ /usr/bin/uptime'.length)

  const command = tracker.getCurrentCommandInput()

  assert.equal(command, '/usr/bin/uptime; /usr/bin/systemctl start nginx')
  const { createTerminalSafetyController } = await importController()
  const decision = createTerminalSafetyController().beforeEnter(
    command,
    protectedSshContext()
  )
  assert.equal(decision.sendNow, false)
  assert.equal(decision.confirmation.classification.risk, 'change')
  assert.equal(decision.confirmation.automaticRollback, false)
})

test('CommandTrackerAddon reconstructs soft-wrapped input through its logical end', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({
    cols: 12,
    cursorX: 2,
    cellAware: true
  })
  const tracker = new CommandTrackerAddon()
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  harness.setLines([
    { text: '$ systemctl ', isWrapped: false },
    { text: 'restart ngin', isWrapped: true },
    { text: 'x', isWrapped: true }
  ])
  harness.setCursor(1, 4)

  assert.equal(
    tracker.getCurrentCommandInput(),
    'systemctl restart nginx'
  )
})

test('CommandTrackerAddon preserves cursor-proven trailing whitespace', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const tracker = new CommandTrackerAddon()
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  const command = 'printf x > /tmp/task5-review\\ '
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)

  const current = tracker.getCurrentCommandInput()

  assert.equal(current, command)
  const { createTerminalSafetyController } = await importController()
  assert.equal(
    createTerminalSafetyController().beforeEnter(
      current,
      protectedSshContext()
    ).sendNow,
    false
  )
})

test('CommandTrackerAddon preserves occupied trailing space after a middle cursor', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({
    cols: 80,
    cursorX: 2,
    cellAware: true
  })
  const tracker = new CommandTrackerAddon()
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  const command = 'printf x > /tmp/task5-review\\ '
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, '$ printf'.length)

  assert.equal(tracker.getCurrentCommandInput(), command)
})

test('CommandTrackerAddon rejects cursor-middle input without logical-end metadata', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const tracker = new CommandTrackerAddon()
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  const command = 'printf x > /tmp/task5-review\\ '
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, '$ printf'.length)

  assert.equal(tracker.getCurrentCommandInput(), undefined)
  assert.equal(tracker.hasReliableCommandInput(), false)
})

test('CommandTrackerAddon exposes no command when its input anchor cannot be proven', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cursorX: 2 })
  const tracker = new CommandTrackerAddon()
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  harness.setLines([])

  assert.equal(tracker.getCurrentCommandInput(), undefined)
  assert.equal(tracker.hasReliableCommandInput(), false)
})

test('OSC phases allow safety only while the shell accepts command input', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cursorX: 2 })
  const tracker = new CommandTrackerAddon()
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)

  harness.osc(lifecycleOsc('A'))
  assert.equal(tracker.hasShellIntegration(), true)
  assert.equal(tracker.isCommandInputActive(), false)
  harness.osc(lifecycleOsc('B'))
  assert.equal(tracker.isCommandInputActive(), true)
  harness.osc(lifecycleOsc('E', 'cat'))
  assert.equal(tracker.isCommandInputActive(), false)
  harness.osc(lifecycleOsc('C'))
  assert.equal(tracker.isCommandInputActive(), false)
  harness.osc(completionOsc(0))
  assert.equal(tracker.isCommandInputActive(), false)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  assert.equal(tracker.isCommandInputActive(), true)
})

test('shell integration variants emit OSC B after their prompt content', () => {
  const source = readClientFile('components/terminal/shell.js')
  const functionNames = [
    'getBashInlineIntegration',
    'getZshInlineIntegration',
    'getFishInlineIntegration',
    'getShInlineIntegration'
  ]

  for (let index = 0; index < functionNames.length; index += 1) {
    const start = source.indexOf(`function ${functionNames[index]}`)
    const end = index + 1 < functionNames.length
      ? source.indexOf(`function ${functionNames[index + 1]}`, start)
      : source.indexOf('export function detectShellType', start)
    const functionBody = source.slice(start, end)
    assert.match(functionBody, /633;B/, functionNames[index])
    assert.equal(
      functionBody.lastIndexOf('633;B') > functionBody.indexOf('633;A'),
      true,
      functionNames[index]
    )
  }
})

test('bash shell integration isolates an existing PROMPT_COMMAND from command tracking', async () => {
  const { getInlineShellIntegration } = await importShellIntegration()
  const integration = getInlineShellIntegration(
    'bash',
    '0123456789abcdef0123456789abcdef'
  )

  assert.match(integration, /__e_old_prompt_command="\$\{PROMPT_COMMAND:-\}"/)
  assert.match(integration, /__e_prompting:-0/)
  assert.match(integration, /builtin eval "\$__e_old_prompt_command"/)
  assert.match(integration, /PROMPT_COMMAND="__e_cmd"/)
  assert.doesNotMatch(integration, /PROMPT_COMMAND="__e_cmd\$\{PROMPT_COMMAND:/)
})

test('terminal safety alone never makes forced-command or TUI output injectable', async () => {
  const { shouldInjectShellIntegration } = await importShellIntegration()
  const base = {
    showCmdSuggestions: false,
    sftpPathFollowSsh: false,
    terminalSafetyProtection: true,
    isSsh: true,
    isLocal: false,
    isWindows: false
  }

  assert.equal(shouldInjectShellIntegration({
    ...base,
    forcedCommand: true
  }), false)
  assert.equal(shouldInjectShellIntegration({
    ...base,
    alternateBuffer: true
  }), false)
  assert.equal(shouldInjectShellIntegration({
    ...base,
    showCmdSuggestions: true
  }), true)
  assert.equal(shouldInjectShellIntegration({
    ...base,
    sftpPathFollowSsh: true
  }), true)
})

test('OSC completion accepts only the current session nonce', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const finished = []
  const tracker = new CommandTrackerAddon()
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate(harness.terminal)
  const nonce = tracker.beginSession()
  assert.match(nonce, /^[a-f0-9]{32}$/)
  harness.osc(lifecycleOsc('A', undefined, nonce))
  harness.osc(lifecycleOsc('B', undefined, nonce))
  const command = '/usr/bin/systemctl start nginx'
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)
  const token = tracker.expectSubmission(command)
  assert.equal(tracker.markExpectedSubmissionReleased(token), true)

  harness.osc('D;0')
  harness.osc('D;00000000000000000000000000000000;0')
  assert.deepEqual(finished, [])
  assert.equal(tracker.hasExpectedSubmission(token), true)

  harness.osc(`E;${nonce};${command}`)
  harness.osc(`C;${nonce}`)
  harness.osc(`D;${nonce};0`)
  harness.osc(`D;${nonce};9`)
  assert.deepEqual(finished, [{ token, command, exitCode: 0 }])
})

test('CommandTracker ignores unauthenticated lifecycle OSC without side effects', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const events = []
  const tracker = new CommandTrackerAddon()
  tracker.onPromptStarted(() => events.push('prompt'))
  tracker.onCommandExecuted(command => events.push(`execute:${command}`))
  tracker.onCommandFinished(event => events.push(`finish:${event.exitCode}`))
  tracker.onCwdChanged(cwd => events.push(`cwd:${cwd}`))
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)

  for (const data of [
    'A',
    'B',
    'C',
    'E;/tmp/forged',
    'P;Cwd=/tmp/forged',
    'D;0',
    'A;00000000000000000000000000000000',
    'B;00000000000000000000000000000000',
    'C;00000000000000000000000000000000',
    'E;00000000000000000000000000000000;forged',
    'P;00000000000000000000000000000000;Cwd=/tmp/forged',
    'D;00000000000000000000000000000000;0'
  ]) {
    harness.osc(data)
  }

  assert.equal(tracker.hasShellIntegration(), false)
  assert.equal(tracker.isCommandInputActive(), false)
  assert.equal(tracker.shellPhase, 'inactive')
  assert.equal(tracker.cwd, '')
  assert.equal(tracker.executedCommand, '')
  assert.equal(tracker.lastExitCode, null)
  assert.deepEqual(events, [])

  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  harness.osc(lifecycleOsc('E', 'uptime'))
  harness.osc(lifecycleOsc('C'))
  harness.osc(lifecycleOsc('P', 'Cwd=/srv/app'))
  assert.equal(tracker.hasShellIntegration(), true)
  assert.equal(tracker.shellPhase, 'executing')
  assert.equal(tracker.cwd, '/srv/app')
  assert.equal(tracker.executedCommand, 'uptime')
  assert.deepEqual(events, ['prompt', 'execute:uptime', 'cwd:/srv/app'])
})

test('forced command and TUI forged A B records cannot activate terminal safety', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const { createTerminalSafetyController } = await importController()

  for (const alternateBuffer of [false, true]) {
    const harness = createTrackerTerminal({ cursorX: 2 })
    const tracker = new CommandTrackerAddon()
    tracker.activate(harness.terminal)
    beginTrackerSession(tracker)
    harness.osc('A')
    harness.osc('B')

    assert.equal(tracker.hasShellIntegration(), false)
    assert.equal(tracker.isCommandInputActive(), false)
    assert.deepEqual(
      createTerminalSafetyController().beforeEnter(
        'systemctl restart nginx',
        protectedSshContext({
          alternateBuffer,
          shellIntegrationActive: tracker.hasShellIntegration(),
          commandInputActive: tracker.isCommandInputActive()
        })
      ),
      { sendNow: true }
    )
  }
})

test('reconnect rotates OSC nonce and invalidates prior-session completion', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const finished = []
  const tracker = new CommandTrackerAddon()
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate(harness.terminal)
  const firstNonce = tracker.beginSession()
  harness.osc(lifecycleOsc('A', undefined, firstNonce))
  harness.osc(lifecycleOsc('B', undefined, firstNonce))
  const command = '/usr/bin/systemctl start nginx'
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)
  const staleToken = tracker.expectSubmission(command)
  tracker.markExpectedSubmissionReleased(staleToken)

  const nextNonce = tracker.beginSession()
  assert.notEqual(nextNonce, firstNonce)
  harness.osc(`D;${firstNonce};0`)
  assert.deepEqual(finished, [])
  assert.equal(tracker.hasExpectedSubmission(staleToken), false)
})

test('generated shell integration binds D records to its supplied nonce', async () => {
  const { getInlineShellIntegration } = await importShellIntegration()
  const nonce = '0123456789abcdef0123456789abcdef'

  for (const shellType of ['bash', 'zsh', 'fish']) {
    const integration = getInlineShellIntegration(shellType, nonce)
    assert.match(integration, new RegExp(`633;D;.*${nonce}|${nonce}.*633;D;`), shellType)
  }
})

test('generated reliable shell integrations authenticate every OSC lifecycle record', async () => {
  const { getInlineShellIntegration } = await importShellIntegration()
  const nonce = '0123456789abcdef0123456789abcdef'

  for (const shellType of ['bash', 'zsh', 'fish']) {
    const integration = getInlineShellIntegration(shellType, nonce)
    for (const type of ['A', 'B', 'C', 'D', 'E', 'P']) {
      assert.match(integration, new RegExp(`633;${type};`), `${shellType}:${type}`)
    }
    assert.doesNotMatch(integration, /633;A\\a/, shellType)
    assert.doesNotMatch(integration, /633;B\\a/, shellType)
    assert.doesNotMatch(integration, /633;C\\a/, shellType)
    assert.doesNotMatch(integration, /633;P;Cwd=/, shellType)
  }
})

test('Enter sent to executing program stdin remains transparent', async () => {
  const { createTerminalSafetyController } = await importController()
  const controller = createTerminalSafetyController()

  assert.deepEqual(
    controller.beforeEnter(
      'systemctl restart nginx',
      protectedSshContext({ commandInputActive: false })
    ),
    { sendNow: true }
  )
})

test('heredoc multiline and syntactically incomplete commands stay transparent', async () => {
  const {
    createTerminalSafetyController,
    isCompleteTerminalCommand
  } = await importController()
  const commands = [
    'cat <<EOF',
    'printf one\nprintf two',
    'systemctl restart nginx &&',
    'systemctl restart nginx |',
    'echo "unfinished',
    'for item in one two; do'
  ]

  for (const command of commands) {
    assert.equal(isCompleteTerminalCommand(command), false, command)
    const controller = createTerminalSafetyController()
    assert.deepEqual(
      controller.beforeEnter(command, protectedSshContext()),
      { sendNow: true },
      command
    )
  }
})

test('heredoc continuation stays transparent until OSC reports command execution', async () => {
  const { createTerminalSafetyController } = await importController()
  const controller = createTerminalSafetyController()
  const context = protectedSshContext()

  assert.deepEqual(controller.beforeEnter('cat <<EOF', context), { sendNow: true })
  assert.deepEqual(
    controller.beforeEnter('systemctl restart nginx', context),
    { sendNow: true }
  )
  assert.deepEqual(controller.beforeEnter('EOF', context), { sendNow: true })

  controller.onCommandExecuted()
  const next = controller.beforeEnter('/usr/bin/systemctl start nginx', context)
  assert.equal(next.sendNow, false)
  assert.equal(next.confirmation.kind, 'reversible')
})

test('a new OSC prompt resets continuation mode after Ctrl+C or syntax abort', async () => {
  const { createTerminalSafetyController } = await importController()
  const controller = createTerminalSafetyController()
  const context = protectedSshContext()

  assert.deepEqual(controller.beforeEnter('echo "unfinished', context), {
    sendNow: true
  })
  controller.onPromptStarted()

  const next = controller.beforeEnter('/usr/bin/systemctl start nginx', context)
  assert.equal(next.sendNow, false)
  assert.equal(next.confirmation.kind, 'reversible')
})

test('empty Enter and embedded-newline paste chunks are never intercepted', async () => {
  const { createTerminalSafetyController } = await importController()
  const controller = createTerminalSafetyController()

  assert.deepEqual(
    controller.beforeEnter('   ', protectedSshContext()),
    { sendNow: true }
  )
  assert.deepEqual(
    controller.beforeSend(
      'systemctl restart nginx\r',
      protectedSshContext({ command: 'systemctl restart nginx' })
    ),
    { sendNow: true }
  )
})

test('AttachAddon keeps ordinary typing controls paste and TUI data synchronous', async () => {
  const { addon, calls, sent } = await createAttachHarness(() => {
    throw new Error('Enter gate must not run for non-Enter input')
  })

  for (const data of ['a', '\x03', '\x1b[A', 'pasted command\r', 'line 1\nline 2']) {
    const result = addon.sendToServer(data)
    assert.equal(result, undefined, data)
  }

  assert.deepEqual(sent, ['a', '\x03', '\x1b[A', 'pasted command\r', 'line 1\nline 2'])
  assert.deepEqual(calls, [])
})

test('manual Enter stays direct while AI takeover is active for every command class', async () => {
  const { addon, safetyCalls, sent } = await createDirectAttachHarness()
  const commands = [
    'ip a',
    'systemctl restart nginx',
    'opaque-command --unknown-mode'
  ]

  for (const command of commands) {
    assert.equal(addon.sendToServer(command), undefined)
    assert.equal(addon.sendToServer('\r'), undefined)
  }

  assert.deepEqual(sent, commands.flatMap(command => [command, '\r']))
  assert.deepEqual(safetyCalls, [])
})

test('AttachAddon submits an approved safety command through one controlled boundary', async () => {
  const { addon, sent } = await createAttachHarness(() => ({ sendNow: true }))

  assert.equal(addon.submitSafetyCommand('uptime', 'submission-1'), true)
  assert.deepEqual(sent, ['uptime\r'])
  assert.equal(addon.submitSafetyCommand('uptime', ''), false)
  assert.deepEqual(sent, ['uptime\r'])
})

test('AttachAddon marks the Enter after a single-line paste as transparent', async () => {
  const { addon, calls, sent } = await createAttachHarness(() => ({ sendNow: true }))

  addon._onTerminalPaste()
  addon.sendToServer('systemctl restart nginx')
  addon.sendToServer('\r')

  assert.deepEqual(sent, ['systemctl restart nginx', '\r'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].context.isPaste, true)
})

test('terminal programmatic paste actions mark the following Enter as paste', () => {
  const source = readClientFile('components/terminal/terminal.jsx')
  const pasteStart = source.indexOf('onPaste = async')
  const pasteEnd = source.indexOf('toggleSearch =', pasteStart)
  const pasteBody = source.slice(pasteStart, pasteEnd)

  assert.notEqual(pasteStart, -1)
  assert.match(
    pasteBody,
    /attachAddon\?\._onTerminalPaste\(\)[\s\S]*term\.paste\(selected \|\| ''\)/
  )
  assert.equal(
    (pasteBody.match(/attachAddon\?\._onTerminalPaste\(\)/g) || []).length,
    2
  )
})

test('AttachAddon gates only standalone Enter with current command and context', async () => {
  const { addon, calls, sent } = await createAttachHarness(() => ({ sendNow: true }))

  const result = addon.sendToServer('\r')

  assert.equal(result, undefined)
  assert.deepEqual(sent, ['\r'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'systemctl restart nginx')
  assert.equal(calls[0].context.passwordMode, false)
  assert.equal(calls[0].context.alternateBuffer, false)
})

test('AttachAddon releases one Enter after async acceptance and drops duplicate Enter', async () => {
  const decision = deferred()
  const { addon, calls, sent } = await createAttachHarness(() => decision.promise)

  const first = addon.sendToServer('\r')
  const duplicate = addon.sendToServer('\r')
  assert.deepEqual(sent, [])
  assert.equal(calls.length, 1)

  decision.resolve({ sendNow: true })
  await first
  await duplicate

  assert.deepEqual(sent, ['\r'])
})

test('AttachAddon revalidates an async release token at the socket boundary', async () => {
  const blocked = await createAttachHarness(() => Promise.resolve({
    sendNow: true,
    releaseToken: 'stale-release'
  }))
  const consumed = []
  blocked.parent.consumeTerminalSafetyRelease = token => {
    consumed.push(token)
    return false
  }

  await blocked.addon.sendToServer('\r')

  assert.deepEqual(consumed, ['stale-release'])
  assert.deepEqual(blocked.sent, [])

  const accepted = await createAttachHarness(() => Promise.resolve({
    sendNow: true,
    releaseToken: 'live-release'
  }))
  accepted.parent.consumeTerminalSafetyRelease = () => true

  await accepted.addon.sendToServer('\r')

  assert.deepEqual(accepted.sent, ['\r'])
})

test('AttachAddon invalidates a pending approval when transparent input edits the line', async () => {
  const firstDecision = deferred()
  let gateCount = 0
  const { addon, calls, sent, parent } = await createAttachHarness(() => {
    gateCount += 1
    return gateCount === 1 ? firstDecision.promise : { sendNow: true }
  })
  parent.onTerminalSafetyInputChanged = () => {
    calls.push({ inputChanged: true })
    firstDecision.resolve({ sendNow: false, clear: false })
  }

  const staleEnter = addon.sendToServer('\r')
  addon.sendToServer('x')
  addon.sendToServer('\r')
  await staleEnter

  assert.deepEqual(sent, ['x', '\r'])
  assert.equal(gateCount, 2)
  assert.equal(calls.some(call => call.inputChanged), true)
})

test('AttachAddon cancellation clears the pending canonical line exactly once', async () => {
  const decision = deferred()
  const { addon, sent } = await createAttachHarness(() => decision.promise)

  const pending = addon.sendToServer('\r')
  decision.resolve({ sendNow: false, clear: true })
  await pending

  assert.deepEqual(sent, ['\x15'])
})

test('AttachAddon password Enter remains synchronous and resets password state', async () => {
  const { addon, calls, sent } = await createAttachHarness((command, context) => {
    assert.equal(context.passwordMode, true)
    return { sendNow: true }
  })
  addon._passwordPromptDetected = true

  const result = addon.sendToServer('\r')

  assert.equal(result, undefined)
  assert.deepEqual(sent, ['\r'])
  assert.equal(addon._passwordPromptDetected, false)
  assert.deepEqual(calls, [
    {
      command: 'systemctl restart nginx',
      context: {
        enabled: true,
        isSsh: true,
        passwordMode: true,
        alternateBuffer: false,
        isPaste: false
      }
    },
    { passwordCancelled: true }
  ])
})

test('CommandTrackerAddon completes a released expected simple command once', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const finished = []
  const tracker = new CommandTrackerAddon()
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  const command = 'systemctl restart nginx'
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)
  const token = tracker.expectSubmission(command)
  tracker.markExpectedSubmissionReleased(token)

  harness.osc(lifecycleOsc('E', 'systemctl restart nginx'))
  harness.osc(lifecycleOsc('C'))
  harness.osc(completionOsc(0))
  harness.osc(completionOsc(9))

  assert.deepEqual(finished, [{
    token,
    command,
    exitCode: 0
  }])
})

test('CommandTrackerAddon binds an external safety submission from an empty prompt', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const finished = []
  const tracker = new CommandTrackerAddon()
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  const command = 'uptime'

  const token = tracker.expectExternalSubmission(command)
  assert.match(token, /^terminal-submission-/)
  assert.equal(tracker.markExpectedSubmissionReleased(token), true)
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)
  harness.osc(lifecycleOsc('E', command))
  harness.osc(lifecycleOsc('C'))
  harness.osc(completionOsc(0))

  assert.deepEqual(finished, [{ token, command, exitCode: 0 }])
})

test('CommandTrackerAddon accepts a pre-authenticated managed E without command history', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const histories = []
  const finished = []
  const tracker = new CommandTrackerAddon()
  tracker.onCommandExecuted(command => histories.push(command))
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  const command = `__sp_secret=hidden; __sp_payload=${'x'.repeat(24 * 1024)}`
  const token = tracker.expectExternalSubmission(command)
  assert.equal(tracker.markExpectedSubmissionReleased(token), true)

  assert.equal(
    tracker.observeManagedExternalSubmission(
      command,
      'fedcba0987654321fedcba0987654321'
    ),
    false
  )
  assert.equal(
    tracker.observeManagedExternalSubmission('different command', testTrackerNonce),
    false
  )
  assert.equal(
    tracker.observeManagedExternalSubmission(command, testTrackerNonce),
    true
  )
  harness.osc(lifecycleOsc('C'))
  harness.osc(completionOsc(0))

  assert.deepEqual(histories, [])
  assert.deepEqual(finished, [{ token, command, exitCode: 0 }])
})

test('CommandTrackerAddon requires exact nonce-bound E then C then D ordering', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const finished = []
  const tracker = new CommandTrackerAddon()
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  const command = 'uptime'
  const token = tracker.expectExternalSubmission(command)
  assert.equal(tracker.markExpectedSubmissionReleased(token), true)

  harness.osc(completionOsc(0))
  harness.osc(lifecycleOsc('C'))
  harness.osc(lifecycleOsc('E', 'pwd'))
  harness.osc(completionOsc(0))
  assert.deepEqual(finished, [])

  harness.osc(lifecycleOsc('E', command))
  harness.osc(completionOsc(0))
  assert.deepEqual(finished, [])

  harness.osc(lifecycleOsc('C'))
  harness.osc(completionOsc(7))
  assert.deepEqual(finished, [{ token, command, exitCode: 7 }])
})

test('CommandTrackerAddon reports interrupted commands with a null exit code', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const finished = []
  const tracker = new CommandTrackerAddon()
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  const command = 'custom-admin-tool --rotate'
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)
  const token = tracker.expectSubmission(command)
  tracker.markExpectedSubmissionReleased(token)

  harness.osc(lifecycleOsc('E', 'custom-admin-tool --rotate'))
  harness.osc(lifecycleOsc('C'))
  harness.osc(completionOsc())

  assert.deepEqual(finished, [{
    token,
    command,
    exitCode: null
  }])
})

test('CommandTrackerAddon reports a new prompt boundary', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  let oscHandler
  let promptCount = 0
  const tracker = new CommandTrackerAddon()
  tracker.onPromptStarted(() => { promptCount += 1 })
  tracker.activate({
    parser: {
      registerOscHandler: (_code, handler) => {
        oscHandler = handler
        return { dispose () {} }
      }
    }
  })
  beginTrackerSession(tracker)

  oscHandler(lifecycleOsc('A'))

  assert.equal(promptCount, 1)
})

test('CommandTrackerAddon rejects a compound submission when OSC E is not the exact expected command', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const histories = []
  const finished = []
  const tracker = new CommandTrackerAddon()
  tracker.onCommandExecuted(command => histories.push(command))
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  const command = 'systemctl status nginx && systemctl restart nginx'
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)
  const token = tracker.expectSubmission(command)
  assert.equal(tracker.markExpectedSubmissionReleased(token), true)

  harness.osc(lifecycleOsc('E', 'systemctl status nginx'))
  harness.osc(lifecycleOsc('C'))
  harness.osc(completionOsc(0))

  assert.deepEqual(histories, ['systemctl status nginx'])
  assert.deepEqual(finished, [])
  assert.equal(tracker.hasExpectedSubmission(token), true)
})

test('CommandTrackerAddon never substitutes local expected text for a different OSC E command', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const cases = [
    ['! systemctl restart nginx', 'systemctl restart nginx'],
    ['time systemctl restart nginx', 'systemctl restart nginx'],
    [
      'systemctl status nginx && systemctl restart nginx',
      'systemctl status nginx'
    ],
    ['(systemctl restart nginx)', 'systemctl restart nginx']
  ]

  for (const [command, observed] of cases) {
    const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
    const histories = []
    const finished = []
    const tracker = new CommandTrackerAddon()
    tracker.onCommandExecuted(value => histories.push(value))
    tracker.onCommandFinished(event => finished.push(event))
    tracker.activate(harness.terminal)
    beginTrackerSession(tracker)
    harness.osc(lifecycleOsc('A'))
    harness.osc(lifecycleOsc('B'))
    harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
    harness.setCursor(0, command.length + 2)
    const token = tracker.expectSubmission(command)
    assert.equal(tracker.markExpectedSubmissionReleased(token), true)

    harness.osc(lifecycleOsc('E', observed))
    harness.osc(lifecycleOsc('C'))
    harness.osc(completionOsc(0))

    assert.deepEqual(histories, [observed], command)
    assert.deepEqual(finished, [], command)
    assert.equal(tracker.hasExpectedSubmission(token), true, command)
  }
})

test('CommandTrackerAddon does not complete an armed submission without OSC E', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const finished = []
  const tracker = new CommandTrackerAddon()
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  const command = '(systemctl restart nginx)'
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)
  const token = tracker.expectSubmission(command)
  assert.equal(tracker.markExpectedSubmissionReleased(token), true)

  harness.osc(lifecycleOsc('C'))
  harness.osc(lifecycleOsc('A'))
  harness.osc(completionOsc(7))
  assert.deepEqual(finished, [])
  assert.equal(tracker.hasExpectedSubmission(token), true)

  harness.osc(lifecycleOsc('B'))
  harness.osc(lifecycleOsc('A'))

  assert.deepEqual(finished, [])
  assert.equal(tracker.hasExpectedSubmission(token), false)
})

test('CommandTrackerAddon ignores pre-arm and late D while completing exactly once', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cursorX: 2 })
  const finished = []
  const tracker = new CommandTrackerAddon()
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)

  harness.osc(lifecycleOsc('E', 'uptime'))
  harness.osc(completionOsc(0))
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  const command = 'systemctl restart nginx'
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)
  const token = tracker.expectSubmission(command)
  tracker.markExpectedSubmissionReleased(token)
  assert.equal(tracker.hasExpectedSubmission(token), true)
  assert.deepEqual(finished, [])

  harness.osc(lifecycleOsc('E', 'uptime'))
  harness.osc(lifecycleOsc('C'))
  harness.osc(completionOsc(0))
  harness.osc(completionOsc(7))
  harness.osc(lifecycleOsc('A'))

  assert.deepEqual(finished, [])
  assert.equal(tracker.hasExpectedSubmission(token), true)

  harness.osc(lifecycleOsc('E', command))
  harness.osc(lifecycleOsc('C'))
  harness.osc(completionOsc(0))

  assert.deepEqual(finished, [{
    token,
    command: 'systemctl restart nginx',
    exitCode: 0
  }])
})

test('CommandTrackerAddon expects the exact canonical command including padding', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const tracker = new CommandTrackerAddon()
  tracker.activate(harness.terminal)
  beginTrackerSession(tracker)
  harness.osc(lifecycleOsc('A'))
  harness.osc(lifecycleOsc('B'))
  const command = 'systemctl restart nginx   '
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)

  const token = tracker.expectSubmission(command)

  assert.match(token, /^terminal-submission-/)
  assert.equal(tracker.markExpectedSubmissionReleased(token), true)
})

test('terminal leaves manual Enter unwired while retaining programmatic safety transactions', () => {
  const source = readClientFile('components/terminal/terminal.jsx')

  assert.doesNotMatch(source, /beforeTerminalEnter\s*=/)
  assert.doesNotMatch(source, /createTerminalSafetyCoordinator/)
  assert.doesNotMatch(source, /consumeTerminalSafetyRelease/)
  assert.doesNotMatch(source, /terminalSafetyCoordinator/)
  assert.match(source, /runSafetyCommand = \(command, options = \{\}\)/)
  assert.match(source, /commandSafetyEntrypoint/)
  assert.doesNotMatch(source, /terminalSafetyRunner\.execute/)
  assert.doesNotMatch(source, /_sendData\(confirmation\.command/)
})

test('terminal exposes the unified command safety entrypoint without replacing manual input', () => {
  const source = readClientFile('components/terminal/terminal.jsx')

  assert.match(source, /createSafetyCommandEntrypoint/)
  assert.match(source, /ensureTrackerReady:\s*this\.ensureCommandSafetyTrackerReady/)
  assert.match(source, /ensureCommandSafetyTrackerReady\s*=/)
  assert.match(source, /injectShellIntegration\(\{\s*forceForSafety:\s*true\s*\}\)/)
  assert.match(source, /Shell Integration.*就绪|可靠.*跟踪/)
  assert.match(source, /runSafetyCommand = \(command, options = \{\}\)/)
  assert.match(source, /expectExternalSubmission/)
  assert.match(source, /attachAddon\?\.submitSafetyCommand/)
  assert.match(source, /commandSafetyEntrypoint\.beginSession/)
  assert.match(source, /commandSafetyEntrypoint\.invalidateSession/)
  assert.match(source, /commandSafetyEntrypoint\.handleCommandFinished/)
  assert.match(source, /commandSafetyEntrypoint\.inputChanged/)
  assert.doesNotMatch(source, /beforeTerminalEnter\s*=/)
})

test('terminal wires managed PTY tasks through authenticated tracker lifecycle', () => {
  const source = readClientFile('components/terminal/terminal.jsx')

  assert.match(source, /createManagedPtyTaskController/)
  assert.match(source, /createPtyTaskToken/)
  assert.match(source, /ensureReady:\s*this\.ensureOperationsPtyTrackerReady/)
  assert.match(source, /await this\.attachAddon\.ensureManagedPtyTransportReady\(\)/)
  assert.doesNotMatch(source, /submitManagedPtyCommand\([\s\S]{0,160}===\s*true/)
  assert.match(source, /subscribeOutput:\s*listener\s*=>\s*this\.attachAddon\.onRemoteOutput\(listener\)/)
  assert.match(source, /prepareSubmissionOutputRecovery:\s*\(\)\s*=>\s*this\.attachAddon\?\.prepareManagedPtyEchoRecovery\(\)/)
  assert.match(source, /cancelSubmissionOutput:\s*\(\)\s*=>\s*this\.attachAddon\?\.cancelManagedPtyEchoSuppression\(\)/)
  assert.match(source, /cmdAddon\.onPromptStarted\(this\.handleTerminalPromptStarted\)/)
  assert.match(source, /operationsPtyTaskController\.handleCommandFinished\(event\)/)
  assert.match(source, /operationsPtyTaskController\.handlePromptStarted\(\)/)
  assert.match(source, /cmdAddon\?\.observeManagedExternalSubmission\(command, nonce\)/)
  assert.match(source, /acquireOperationsPtyTask\s*=/)
  assert.match(source, /handleManagedPtyInput\s*=/)
  assert.match(source, /operationsPtyTaskController\.isBusy\(\)/)
})

test('terminal invalidates managed PTY leases and can rearm the current child shell only', () => {
  const source = readClientFile('components/terminal/terminal.jsx')

  assert.match(source, /isInteractiveShellTransitionCommand/)
  assert.match(source, /getCurrentShellIntegrationCommand/)
  assert.match(source, /forceCurrentShell/)
  assert.match(source, /shellTransitionCandidate/)
  assert.match(source, /outputObservedAt/)
  assert.match(source, /outputObservedSequence/)
  assert.match(source, /operationsPtyTaskController\.invalidate\(/)
  assert.match(source, /attachAddon\?\.isPasswordPromptDetected\?\.\(\)/)
})

test('terminal command tracking no longer routes through the manual safety controller', () => {
  const source = readClientFile('components/terminal/terminal.jsx')

  assert.doesNotMatch(source, /terminalSafetyController/)
  assert.match(source, /cmdAddon\.onCommandFinished\(this\.handleTerminalCommandFinished\)/)
})

test('manual terminal protection setting and locale copy are removed', () => {
  const defaults = readClientFile('common/default-setting.js')
  const setting = readClientFile('components/setting-panel/setting-terminal.jsx')
  const locale = readClientFile('common/shellpilot-i18n-overrides.js')
  const terminal = readClientFile('components/terminal/terminal.jsx')

  assert.doesNotMatch(defaults, /terminalSafetyProtection/)
  assert.doesNotMatch(setting, /renderTerminalSafetyToggle/)
  assert.doesNotMatch(setting, /terminalSafetyProtection/)
  assert.doesNotMatch(locale, /terminalSafetyProtectionHelp/)
  assert.doesNotMatch(locale, /terminalSafetyProtection/)
  assert.doesNotMatch(terminal, /config\.terminalSafetyProtection/)
})

test('compact Chinese safety modal exposes only policy-allowed actions', () => {
  const source = readClientFile('components/terminal/terminal-command-safety-modal.jsx')
  const style = readClientFile('components/terminal/terminal-command-safety-modal.styl')
  const modal = readClientFile('components/common/modal.jsx')

  assert.match(source, /shellpilotCommandCreateRecoveryAndRun/)
  assert.match(source, /shellpilotCommandConfirmRunOnce/)
  assert.match(source, /\{e\('cancel'\)\}/)
  assert.match(source, /shellpilotCommandNoRollback/)
  assert.match(source, /confirmation\.kind !== 'blocked'/)
  assert.match(source, /keyboardConfirm={false}/)
  assert.match(source, /confirmation\.classification\?\.riskContext/)
  assert.match(source, /riskContext\.purpose/)
  assert.match(source, /riskContext\.impactTargets/)
  assert.match(source, /riskContext\.verification/)
  assert.match(source, /step\.expected/)
  assert.match(source, /JSON\.stringify\(step\.expected\)/)
  assert.match(source, /confirmation\.classification\?\.endpoint/)
  assert.match(source, /endpoint\.hostKeyFingerprint/)
  assert.match(source, /endpoint\.username/)
  assert.match(source, /endpoint\.host/)
  assert.match(source, /endpoint\.port/)
  assert.match(source, /shellpilotNoExtraConditions/)
  assert.match(modal, /keyboardConfirm = true/)
  assert.match(modal, /keyboardConfirmRef\.current &&/)
  assert.doesNotMatch(modal, /\bkeyboardConfirm\s*&&/)
  assert.match(style, /max-height/)
  assert.match(style, /terminal-command-safety-modal/)
})

test('terminal runCmd adapter forwards safety timeout and output cap options', () => {
  const source = readClientFile('components/terminal/terminal-apis.js')
  const terminal = readClientFile('components/terminal/terminal.jsx')

  assert.match(source, /timeoutMs:\s*options\.timeoutMs/)
  assert.match(source, /maxOutputBytes:\s*options\.maxOutputBytes/)
  assert.match(source, /executionId:\s*options\.executionId/)
  assert.match(source, /action:\s*'cancel-run-cmd'/)
  assert.match(terminal, /cancelRunCmd\(this\.pid, executionId\)/)
})
