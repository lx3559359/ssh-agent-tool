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
  harness.osc('A')
  harness.osc('B')
  harness.setLines([{
    text: '$ uptime; systemctl restart nginx',
    isWrapped: false
  }])
  harness.setCursor(0, '$ uptime'.length)

  const command = tracker.getCurrentCommandInput()

  assert.equal(command, 'uptime; systemctl restart nginx')
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
  harness.osc('A')
  harness.osc('B')
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
  harness.osc('A')
  harness.osc('B')
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
  harness.osc('A')
  harness.osc('B')
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
  harness.osc('A')
  harness.osc('B')
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
  harness.osc('A')
  harness.osc('B')
  harness.setLines([])

  assert.equal(tracker.getCurrentCommandInput(), undefined)
  assert.equal(tracker.hasReliableCommandInput(), false)
})

test('OSC phases allow safety only while the shell accepts command input', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cursorX: 2 })
  const tracker = new CommandTrackerAddon()
  tracker.activate(harness.terminal)

  harness.osc('A')
  assert.equal(tracker.hasShellIntegration(), true)
  assert.equal(tracker.isCommandInputActive(), false)
  harness.osc('B')
  assert.equal(tracker.isCommandInputActive(), true)
  harness.osc('E;cat')
  assert.equal(tracker.isCommandInputActive(), false)
  harness.osc('C')
  assert.equal(tracker.isCommandInputActive(), false)
  harness.osc('D;0')
  assert.equal(tracker.isCommandInputActive(), false)
  harness.osc('A')
  harness.osc('B')
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
  const next = controller.beforeEnter('systemctl restart nginx', context)
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

  const next = controller.beforeEnter('systemctl restart nginx', context)
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
  harness.osc('A')
  harness.osc('B')
  const command = 'systemctl restart nginx'
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)
  const token = tracker.expectSubmission(command)
  tracker.markExpectedSubmissionReleased(token)

  harness.osc('E;systemctl restart nginx')
  harness.osc('D;0')
  harness.osc('D;9')

  assert.deepEqual(finished, [{
    token,
    command,
    exitCode: 0
  }])
})

test('CommandTrackerAddon reports interrupted commands with a null exit code', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const finished = []
  const tracker = new CommandTrackerAddon()
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate(harness.terminal)
  harness.osc('A')
  harness.osc('B')
  const command = 'custom-admin-tool --rotate'
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)
  const token = tracker.expectSubmission(command)
  tracker.markExpectedSubmissionReleased(token)

  harness.osc('E;custom-admin-tool --rotate')
  harness.osc('D')

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

  oscHandler('A')

  assert.equal(promptCount, 1)
})

test('CommandTrackerAddon completes a compound expected submission with exact client identity', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const histories = []
  const finished = []
  const tracker = new CommandTrackerAddon()
  tracker.onCommandExecuted(command => histories.push(command))
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate(harness.terminal)
  harness.osc('A')
  harness.osc('B')
  const command = 'systemctl status nginx && systemctl restart nginx'
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)
  const token = tracker.expectSubmission(command)
  assert.equal(tracker.markExpectedSubmissionReleased(token), true)

  harness.osc('E;systemctl status nginx')
  harness.osc('C')
  harness.osc('D;0')

  assert.deepEqual(histories, ['systemctl status nginx'])
  assert.deepEqual(finished, [{ token, command, exitCode: 0 }])
})

test('CommandTrackerAddon binds completion to released client identity not OSC E text', async () => {
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
    harness.osc('A')
    harness.osc('B')
    harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
    harness.setCursor(0, command.length + 2)
    const token = tracker.expectSubmission(command)
    assert.equal(tracker.markExpectedSubmissionReleased(token), true)

    harness.osc(`E;${observed}`)
    harness.osc('C')
    harness.osc('D;0')

    assert.deepEqual(histories, [observed], command)
    assert.deepEqual(finished, [{ token, command, exitCode: 0 }], command)
  }
})

test('CommandTrackerAddon completes an armed no-E submission at prompt boundary once', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cols: 80, cursorX: 2 })
  const finished = []
  const tracker = new CommandTrackerAddon()
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate(harness.terminal)
  harness.osc('A')
  harness.osc('B')
  const command = '(systemctl restart nginx)'
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)
  const token = tracker.expectSubmission(command)
  assert.equal(tracker.markExpectedSubmissionReleased(token), true)

  harness.osc('C')
  harness.osc('A')
  harness.osc('D;7')
  harness.osc('A')

  assert.deepEqual(finished, [{ token, command, exitCode: null }])
})

test('CommandTrackerAddon ignores pre-arm and late D while completing exactly once', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const harness = createTrackerTerminal({ cursorX: 2 })
  const finished = []
  const tracker = new CommandTrackerAddon()
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate(harness.terminal)

  harness.osc('E;uptime')
  harness.osc('D;0')
  harness.osc('A')
  harness.osc('B')
  const command = 'systemctl restart nginx'
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)
  const token = tracker.expectSubmission(command)
  tracker.markExpectedSubmissionReleased(token)
  harness.osc('D;9')
  assert.equal(tracker.hasExpectedSubmission(token), true)
  assert.deepEqual(finished, [])

  harness.osc('E;uptime')
  harness.osc('C')
  harness.osc('D;0')
  harness.osc('D;7')
  harness.osc('A')

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
  harness.osc('A')
  harness.osc('B')
  const command = 'systemctl restart nginx   '
  harness.setLines([{ text: `$ ${command}`, isWrapped: false }])
  harness.setCursor(0, command.length + 2)

  const token = tracker.expectSubmission(command)

  assert.match(token, /^terminal-submission-/)
  assert.equal(tracker.markExpectedSubmissionReleased(token), true)
})

test('terminal wires the tested safety coordinator into socket and modal lifecycle', () => {
  const source = readClientFile('components/terminal/terminal.jsx')
  const coordinator = readClientFile('components/terminal/terminal-safety-coordinator.js')

  assert.match(source, /createTerminalSafetyCoordinator/)
  assert.match(source, /terminalSafetyCoordinator\.beforeEnter/)
  assert.match(source, /terminalSafetyCoordinator\.consumeRelease/)
  assert.match(source, /terminalSafetyCoordinator\.handleCommandFinished/)
  assert.match(source, /terminalSafetyCoordinator\.beginSession/)
  assert.equal(
    (source.match(/terminalSafetyCoordinator\.invalidateSession/g) || []).length,
    2
  )
  assert.match(coordinator, /runner\.prepare\(request\)/)
  assert.match(coordinator, /runner\.beginExternalExecution/)
  assert.doesNotMatch(source, /terminalSafetyRunner\.execute/)
  assert.doesNotMatch(source, /_sendData\(confirmation\.command/)
})

test('terminal resets continuation safety state at each tracked prompt', () => {
  const source = readClientFile('components/terminal/terminal.jsx')

  assert.match(source, /cmdAddon\.onPromptStarted/)
  assert.match(source, /terminalSafetyController\.onPromptStarted/)
})

test('terminal protection is default-on configurable and enables SSH shell integration', () => {
  const defaults = readClientFile('common/default-setting.js')
  const setting = readClientFile('components/setting-panel/setting-terminal.jsx')
  const locale = readClientFile('common/shellpilot-i18n-overrides.js')
  const terminal = readClientFile('components/terminal/terminal.jsx')

  assert.match(defaults, /terminalSafetyProtection:\s*true/)
  assert.match(setting, /terminalSafetyProtection/)
  assert.match(setting, /terminalSafetyProtectionHelp/)
  assert.match(locale, /terminalSafetyProtection:\s*'SSH 终端安全保护'/)
  assert.match(locale, /terminalSafetyProtectionHelp:/)
  assert.match(terminal, /config\.terminalSafetyProtection\s*!==\s*false/)
  assert.match(terminal, /canInjectShellIntegration/)
})

test('compact Chinese safety modal exposes only policy-allowed actions', () => {
  const source = readClientFile('components/terminal/terminal-command-safety-modal.jsx')
  const style = readClientFile('components/terminal/terminal-command-safety-modal.styl')
  const modal = readClientFile('components/common/modal.jsx')

  assert.match(source, /创建恢复点并执行/)
  assert.match(source, /确认风险并执行一次/)
  assert.match(source, /取消/)
  assert.match(source, /没有自动回滚/)
  assert.match(source, /confirmation\.kind !== 'blocked'/)
  assert.match(source, /keyboardConfirm={false}/)
  assert.match(modal, /keyboardConfirm = true/)
  assert.match(modal, /keyboardConfirm &&/)
  assert.match(style, /max-height/)
  assert.match(style, /terminal-command-safety-modal/)
})

test('terminal runCmd adapter forwards safety timeout and output cap options', () => {
  const source = readClientFile('components/terminal/terminal-apis.js')

  assert.match(source, /timeoutMs:\s*options\.timeoutMs/)
  assert.match(source, /maxOutputBytes:\s*options\.maxOutputBytes/)
})
