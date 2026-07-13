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

function protectedSshContext (overrides = {}) {
  return {
    enabled: true,
    isSsh: true,
    passwordMode: false,
    alternateBuffer: false,
    isPaste: false,
    shellIntegrationActive: true,
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
    protectedSshContext({ shellIntegrationActive: false })
  ]

  for (const context of contexts) {
    const controller = createTerminalSafetyController()
    assert.deepEqual(
      controller.beforeEnter('systemctl restart nginx', context),
      { sendNow: true }
    )
  }
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

test('CommandTrackerAddon associates one OSC 633 D event with the exact E command', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const finished = []
  let oscHandler
  const tracker = new CommandTrackerAddon()
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate({
    parser: {
      registerOscHandler: (code, handler) => {
        assert.equal(code, 633)
        oscHandler = handler
        return { dispose () {} }
      }
    }
  })

  oscHandler('E;systemctl restart nginx')
  oscHandler('D;0')
  oscHandler('D;9')

  assert.deepEqual(finished, [{
    command: 'systemctl restart nginx',
    exitCode: 0
  }])
})

test('CommandTrackerAddon reports interrupted commands with a null exit code', async () => {
  const { CommandTrackerAddon } = await importCommandTracker()
  const finished = []
  let oscHandler
  const tracker = new CommandTrackerAddon()
  tracker.onCommandFinished(event => finished.push(event))
  tracker.activate({
    parser: {
      registerOscHandler: (_code, handler) => {
        oscHandler = handler
        return { dispose () {} }
      }
    }
  })

  oscHandler('E;custom-admin-tool --rotate')
  oscHandler('D')

  assert.deepEqual(finished, [{
    command: 'custom-admin-tool --rotate',
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

test('terminal integrates recovery preparation before releasing canonical PTY Enter', () => {
  const source = readClientFile('components/terminal/terminal.jsx')
  const executeStart = source.indexOf('handleTerminalSafetyExecute = async')
  const executeEnd = source.indexOf('handleTerminalSafetyCancel =', executeStart)
  const executeBody = source.slice(executeStart, executeEnd)

  assert.notEqual(executeStart, -1)
  assert.notEqual(executeEnd, -1)
  assert.match(source, /createTerminalSafetyController/)
  assert.match(source, /createTransactionRunner/)
  assert.match(source, /beforeTerminalEnter\s*=\s*\(command, context\)/)
  assert.match(source, /cmdAddon\.onCommandFinished/)
  assert.match(source, /terminalSafetyController\.onCommandExecuted\(\)/)
  assert.match(source, /TerminalCommandSafetyModal/)
  assert.match(executeBody, /terminalSafetyRunner\.prepare\(request\)/)
  assert.match(executeBody, /terminalSafetyRunner\.beginExternalExecution/)
  assert.match(executeBody, /terminalSafetyController\.resolvePending\('execute'\)/)
  assert.equal(
    executeBody.indexOf('beginExternalExecution') < executeBody.indexOf("resolvePending('execute')"),
    true
  )
  assert.doesNotMatch(executeBody, /terminalSafetyRunner\.execute/)
  assert.doesNotMatch(executeBody, /_sendData\(confirmation\.command/)
})

test('terminal close cancels pending external lifecycle before async release can resume', () => {
  const source = readClientFile('components/terminal/terminal.jsx')
  const unmountStart = source.indexOf('componentWillUnmount () {')
  const unmountEnd = source.indexOf('terminalConfigProps =', unmountStart)
  const unmountBody = source.slice(unmountStart, unmountEnd)
  const executeStart = source.indexOf('handleTerminalSafetyExecute = async')
  const executeEnd = source.indexOf('handleTerminalSafetyCancel =', executeStart)
  const executeBody = source.slice(executeStart, executeEnd)

  assert.match(unmountBody, /this\.onClose = true/)
  assert.match(unmountBody, /terminalSafetyRunner\.cancel/)
  assert.match(
    executeBody,
    /terminalSafetyRunner\.prepare\(request\)[\s\S]*if \(this\.onClose\)[\s\S]*terminalSafetyRunner\.cancel[\s\S]*return[\s\S]*beginExternalExecution/
  )
})

test('SSH disconnect fails a pending external lifecycle before reconnect', () => {
  const source = readClientFile('components/terminal/terminal.jsx')
  const closeStart = source.indexOf('oncloseSocket = () =>')
  const closeEnd = source.indexOf('scheduleAutoReconnect =', closeStart)
  const closeBody = source.slice(closeStart, closeEnd)

  assert.notEqual(closeStart, -1)
  assert.match(closeBody, /pendingTerminalSafetyExecution/)
  assert.match(closeBody, /terminalSafetyRunner\.cancel/)
})

test('terminal invalidates stale safety approval when canonical input changes', () => {
  const source = readClientFile('components/terminal/terminal.jsx')

  assert.match(source, /onTerminalSafetyInputChanged = \(\) =>/)
  assert.match(source, /resolvePending\('invalidate'\)/)
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
