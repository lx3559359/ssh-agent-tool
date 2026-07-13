const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function importController () {
  return import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/terminal/terminal-safety-controller.js'
  )))
}

function completeSshContext (overrides = {}) {
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

test('trusted reversible systemctl start waits for one recovery confirmation', async () => {
  const { createTerminalSafetyController } = await importController()
  const controller = createTerminalSafetyController()

  const first = controller.beforeEnter(
    '/usr/bin/systemctl start nginx',
    completeSshContext()
  )
  const duplicate = controller.beforeEnter(
    '/usr/bin/systemctl start nginx',
    completeSshContext()
  )

  assert.equal(first.sendNow, false)
  assert.equal(first.confirmation.kind, 'reversible')
  assert.equal(first.confirmation.classification.risk, 'change')
  assert.equal(first.confirmation.classification.reversible, true)
  assert.equal(duplicate.sendNow, false)
  assert.equal(duplicate.pending, true)
  assert.equal(duplicate.confirmation, undefined)
})

test('readonly uptime and ordinary non-enter input remain synchronous', async () => {
  const { createTerminalSafetyController } = await importController()
  const controller = createTerminalSafetyController()
  const context = completeSshContext({ command: '/usr/bin/uptime' })

  assert.deepEqual(controller.beforeEnter('/usr/bin/uptime', context), { sendNow: true })
  assert.deepEqual(controller.beforeSend('x', context), { sendNow: true })
  assert.deepEqual(controller.beforeSend('\x03', context), { sendNow: true })
  assert.deepEqual(controller.beforeSend('\x1b[A', context), { sendNow: true })
})

test('only standalone Enter delegates to command classification', async () => {
  const { createTerminalSafetyController } = await importController()
  const controller = createTerminalSafetyController()
  const context = completeSshContext({ command: '/usr/bin/systemctl start nginx' })

  assert.deepEqual(controller.beforeSend('systemctl restart nginx\r', context), {
    sendNow: true
  })
  assert.deepEqual(controller.beforeSend('line one\nline two', context), {
    sendNow: true
  })

  const enter = controller.beforeSend('\r', context)
  assert.equal(enter.sendNow, false)
  assert.equal(enter.confirmation.kind, 'reversible')
})

test('plain sh prompt integration is not a reliable command-tracking capability', async () => {
  const { hasReliableTerminalCommandTracking } = await importController()

  assert.equal(hasReliableTerminalCommandTracking('sh', true), false)
  assert.equal(hasReliableTerminalCommandTracking('bash', true), true)
  assert.equal(hasReliableTerminalCommandTracking('zsh', true), true)
  assert.equal(hasReliableTerminalCommandTracking('bash', false), false)
})

test('ordinary do then and bracket arguments are complete and protected', async () => {
  const {
    createTerminalSafetyController,
    isCompleteTerminalCommand
  } = await importController()
  const commands = [
    'systemctl restart do',
    'systemctl restart then',
    'systemctl restart worker[1]'
  ]

  for (const command of commands) {
    assert.equal(isCompleteTerminalCommand(command), true, command)
    const decision = createTerminalSafetyController().beforeEnter(
      command,
      completeSshContext()
    )
    assert.equal(decision.sendNow, false, command)
    assert.notEqual(decision.confirmation, undefined, command)
  }
})

test('quoted heredoc text and an escaped pipe are complete arguments', async () => {
  const { isCompleteTerminalCommand } = await importController()

  assert.equal(isCompleteTerminalCommand("echo '<<EOF'"), true)
  assert.equal(isCompleteTerminalCommand('echo \\|'), true)
})

test('escaped trailing space is complete and classified from canonical bytes', async () => {
  const {
    createTerminalSafetyController,
    isCompleteTerminalCommand
  } = await importController()
  const command = 'printf x > /tmp/task5-review\\ '
  const classified = []
  const controller = createTerminalSafetyController({
    classifyCommand: text => {
      classified.push(text)
      return { risk: 'change', reversible: false }
    }
  })

  assert.equal(isCompleteTerminalCommand(command), true)
  const decision = controller.beforeEnter(command, completeSshContext())

  assert.equal(decision.sendNow, false)
  assert.equal(decision.confirmation.command, command)
  assert.deepEqual(classified, [command])
})

test('ordinary trailing padding stays complete and protected', async () => {
  const {
    createTerminalSafetyController,
    isCompleteTerminalCommand
  } = await importController()
  const command = '/usr/bin/systemctl start nginx   '
  const controller = createTerminalSafetyController()

  assert.equal(isCompleteTerminalCommand(command), true)
  const decision = controller.beforeEnter(command, completeSshContext())

  assert.equal(decision.sendNow, false)
  assert.equal(decision.confirmation.kind, 'reversible')
  assert.equal(decision.confirmation.command, command)
})

test('only demonstrable shell continuations remain transparent', async () => {
  const { isCompleteTerminalCommand } = await importController()
  const incomplete = [
    'echo "unfinished',
    'echo `unfinished',
    'systemctl restart nginx \\',
    'systemctl restart nginx &&',
    'systemctl restart nginx ||',
    'systemctl restart nginx |',
    'echo $(date',
    'echo ${HOME',
    'cat <<EOF'
  ]

  for (const command of incomplete) {
    assert.equal(isCompleteTerminalCommand(command), false, command)
  }
})

test('commented operators arrays and process substitutions remain transparent while open', async () => {
  const {
    createTerminalSafetyController,
    isCompleteTerminalCommand
  } = await importController()
  const incomplete = [
    '/usr/bin/systemctl start nginx && # continue',
    'arr=(one two',
    '/usr/bin/cp <(/usr/bin/printf x /tmp/a'
  ]

  for (const command of incomplete) {
    assert.equal(isCompleteTerminalCommand(command), false, command)
    assert.deepEqual(
      createTerminalSafetyController().beforeEnter(command, completeSshContext()),
      { sendNow: true },
      command
    )
  }
})

test('closed arrays process substitutions and commented commands enter safety classification', async () => {
  const {
    createTerminalSafetyController,
    isCompleteTerminalCommand
  } = await importController()
  const complete = [
    '/usr/bin/systemctl start nginx && /usr/bin/true # done',
    'arr=(one two); /usr/bin/systemctl start nginx',
    '/usr/bin/cp <(/usr/bin/printf x) /tmp/a',
    '/usr/bin/printf %s "arr=(one two"',
    '/usr/bin/printf %s "argument && # literal"'
  ]

  for (const command of complete) {
    assert.equal(isCompleteTerminalCommand(command), true, command)
    const decision = createTerminalSafetyController().beforeEnter(
      command,
      completeSshContext()
    )
    assert.equal(decision.sendNow, false, command)
    assert.notEqual(decision.confirmation, undefined, command)
  }
})

test('open shell compound bodies remain transparent continuations', async () => {
  const {
    createTerminalSafetyController,
    isCompleteTerminalCommand
  } = await importController()
  const incomplete = [
    'if true; then echo hi',
    'if false; then echo no; elif true; then echo hi',
    'if true; then echo hi; else echo no',
    'for x in a; do echo "$x"',
    'select x in a; do echo "$x"',
    'while true; do echo hi',
    'until false; do echo hi',
    'case "$x" in a) echo a ;;',
    'f() { echo hi',
    'function f { echo hi',
    '{ echo hi'
  ]

  for (const command of incomplete) {
    assert.equal(isCompleteTerminalCommand(command), false, command)
    assert.deepEqual(
      createTerminalSafetyController().beforeEnter(
        command,
        completeSshContext()
      ),
      { sendNow: true },
      command
    )
  }
})

test('pending Bash function subshell and arithmetic forms remain transparent', async () => {
  const {
    createTerminalSafetyController,
    isCompleteTerminalCommand
  } = await importController()
  const incomplete = [
    'f()',
    'function f',
    '(systemctl restart nginx',
    '(( x = 1'
  ]

  for (const command of incomplete) {
    assert.equal(isCompleteTerminalCommand(command), false, command)
    assert.deepEqual(
      createTerminalSafetyController().beforeEnter(
        command,
        completeSshContext()
      ),
      { sendNow: true },
      command
    )
  }
})

for (const command of [
  'f ()',
  '! (systemctl restart nginx',
  'time (systemctl restart nginx',
  'time -p (systemctl restart nginx'
]) {
  test(`Bash continuation stays transparent for ${command}`, async () => {
    const {
      createTerminalSafetyController,
      isCompleteTerminalCommand
    } = await importController()
    const controller = createTerminalSafetyController()
    const decision = controller.beforeSend(
      '\r',
      completeSshContext({ command })
    )

    assert.equal(isCompleteTerminalCommand(command), false)
    assert.equal(decision.sendNow, true)
    assert.equal(Boolean(decision.confirmation || controller.getPending()), false)
  })
}

test('closed function and prefixed subshell commands enter safety confirmation', async () => {
  const {
    createTerminalSafetyController,
    isCompleteTerminalCommand
  } = await importController()
  const complete = [
    'f () { systemctl restart nginx; }',
    '! (systemctl restart nginx)',
    'time (systemctl restart nginx)',
    'time -p (systemctl restart nginx)'
  ]

  for (const command of complete) {
    const controller = createTerminalSafetyController()
    const decision = controller.beforeSend(
      '\r',
      completeSshContext({ command })
    )

    assert.equal(isCompleteTerminalCommand(command), true, command)
    assert.equal(decision.sendNow, false, command)
    assert.notEqual(decision.confirmation, undefined, command)
  }
})

test('function and prefix words used as ordinary arguments stay complete', async () => {
  const {
    createTerminalSafetyController,
    isCompleteTerminalCommand
  } = await importController()
  const complete = [
    'systemctl restart "f ()"',
    'systemctl restart "!"',
    'systemctl restart time'
  ]

  for (const command of complete) {
    const controller = createTerminalSafetyController()
    const decision = controller.beforeSend(
      '\r',
      completeSshContext({ command })
    )

    assert.equal(isCompleteTerminalCommand(command), true, command)
    assert.equal(decision.sendNow, false, command)
    assert.notEqual(decision.confirmation, undefined, command)
  }
})

test('closed compounds and ordinary keyword or brace arguments stay complete', async () => {
  const { isCompleteTerminalCommand } = await importController()
  const complete = [
    'if true; then echo hi; fi',
    String.raw`if true; then printf "%s" "\""; fi`,
    'if false; then echo no; elif true; then echo hi; else echo no; fi',
    'for x in a; do echo "$x"; done',
    'select x in a; do echo "$x"; done',
    'while true; do echo hi; done',
    'until false; do echo hi; done',
    'case "$x" in a) echo a ;; esac',
    'f() { echo hi; }',
    'function f { echo hi; }',
    '{ echo hi; }',
    '(systemctl status nginx)',
    '(( x = 1 ))',
    'echo "(literal)"',
    'systemctl restart "name(with-paren)"',
    'systemctl restart do',
    'systemctl restart then',
    'systemctl restart else',
    'systemctl restart worker[1]',
    'systemctl restart /tmp/{draft',
    'systemctl restart ifconfig',
    "echo '{'"
  ]

  for (const command of complete) {
    assert.equal(isCompleteTerminalCommand(command), true, command)
  }
})

test('blocked commands cannot be released even through an execute resolution', async () => {
  const { createTerminalSafetyController } = await importController()
  const controller = createTerminalSafetyController()

  const result = controller.beforeEnter('reboot', completeSshContext())

  assert.equal(result.sendNow, false)
  assert.equal(result.confirmation.kind, 'blocked')
  assert.equal(result.confirmation.executeAllowed, false)
  assert.deepEqual(controller.resolvePending('execute'), {
    sendNow: false,
    clear: true
  })
})

test('stale confirmation can be invalidated without clearing the edited PTY line', async () => {
  const { createTerminalSafetyController } = await importController()
  const controller = createTerminalSafetyController()

  controller.beforeEnter('systemctl restart nginx', completeSshContext())

  assert.deepEqual(controller.resolvePending('invalidate'), {
    sendNow: false,
    clear: false
  })
  assert.equal(controller.getPending(), null)
})

test('unknown commands disclose that automatic rollback is unavailable', async () => {
  const { createTerminalSafetyController } = await importController()
  const controller = createTerminalSafetyController()

  const result = controller.beforeEnter(
    'custom-admin-tool --rotate',
    completeSshContext()
  )

  assert.equal(result.sendNow, false)
  assert.equal(result.confirmation.kind, 'nonreversible')
  assert.equal(result.confirmation.automaticRollback, false)
  assert.match(result.confirmation.message, /没有自动回滚/)
})

test('terminal safety endpoint projects exact SSH identity without credentials', async () => {
  const { buildTerminalSafetyEndpoint } = await importController()
  const endpoint = buildTerminalSafetyEndpoint({
    id: 'tab-prod',
    host: 'prod.example.com',
    port: 2222,
    username: 'deploy',
    password: 'do-not-record',
    privateKey: 'do-not-record-either',
    title: '生产环境',
    type: 'ssh'
  }, 'terminal-pid-7')

  assert.deepEqual(endpoint, {
    tabId: 'tab-prod',
    host: 'prod.example.com',
    port: 2222,
    username: 'deploy',
    title: '生产环境',
    pid: 'terminal-pid-7',
    terminalPid: 'terminal-pid-7',
    sessionType: 'ssh'
  })
  assert.equal(JSON.stringify(endpoint).includes('do-not-record'), false)
})

test('credential-bearing reversible commands are blocked before creating records', async () => {
  const { createTerminalSafetyController } = await importController()
  const controller = createTerminalSafetyController({
    classifyCommand: () => ({
      risk: 'change',
      reversible: true,
      provider: 'systemd',
      requiresConfirmation: true
    })
  })

  const result = controller.beforeEnter(
    '/usr/bin/systemctl start nginx --token=secret-value',
    completeSshContext()
  )

  assert.equal(result.sendNow, false)
  assert.equal(result.confirmation.kind, 'blocked')
  assert.equal(result.confirmation.recordable, false)
  assert.match(result.confirmation.message, /凭据/)
})

test('credential-bearing unknown commands can be confirmed without a persisted record', async () => {
  const { createTerminalSafetyController } = await importController()
  const controller = createTerminalSafetyController()

  const result = controller.beforeEnter(
    'curl -H "Authorization: Bearer secret-value" https://example.com/admin',
    completeSshContext()
  )

  assert.equal(result.confirmation.kind, 'nonreversible')
  assert.equal(result.confirmation.recordable, false)
  assert.equal(result.confirmation.automaticRollback, false)
})
