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

test('reversible systemctl restart waits for one recovery confirmation', async () => {
  const { createTerminalSafetyController } = await importController()
  const controller = createTerminalSafetyController()

  const first = controller.beforeEnter(
    'systemctl restart nginx',
    completeSshContext()
  )
  const duplicate = controller.beforeEnter(
    'systemctl restart nginx',
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
  const context = completeSshContext({ command: 'uptime' })

  assert.deepEqual(controller.beforeEnter('uptime', context), { sendNow: true })
  assert.deepEqual(controller.beforeSend('x', context), { sendNow: true })
  assert.deepEqual(controller.beforeSend('\x03', context), { sendNow: true })
  assert.deepEqual(controller.beforeSend('\x1b[A', context), { sendNow: true })
})

test('only standalone Enter delegates to command classification', async () => {
  const { createTerminalSafetyController } = await importController()
  const controller = createTerminalSafetyController()
  const context = completeSshContext({ command: 'systemctl restart nginx' })

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
  const controller = createTerminalSafetyController()

  const result = controller.beforeEnter(
    'API_KEY=secret-value systemctl restart nginx',
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
