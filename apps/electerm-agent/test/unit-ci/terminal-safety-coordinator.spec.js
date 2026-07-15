const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const domainRoot = path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions'
)

function importDomainModule (name) {
  return import(pathToFileURL(path.join(domainRoot, name)).href)
}

async function importSafetyModules () {
  const root = path.resolve(__dirname, '../../src/client/components/terminal')
  const [controllerModule, coordinatorModule] = await Promise.all([
    import(pathToFileURL(path.join(root, 'terminal-safety-controller.js'))),
    import(pathToFileURL(path.join(root, 'terminal-safety-coordinator.js')))
  ])
  return { ...controllerModule, ...coordinatorModule }
}

function deferred () {
  let resolveDeferred
  let rejectDeferred
  const promise = new Promise((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })
  return { promise, resolve: resolveDeferred, reject: rejectDeferred }
}

function clone (value) {
  return value === undefined ? undefined : structuredClone(value)
}

function createRunnerStore () {
  const records = new Map()

  async function guardedPatch (id, predicate, value) {
    const current = records.get(id)
    if (!current) throw new Error(`missing record: ${id}`)
    if (await predicate(clone(current)) !== true) {
      throw new Error('guarded patch rejected')
    }
    const resolved = typeof value === 'function'
      ? await value(clone(current))
      : value
    const next = { ...current, ...clone(resolved) }
    records.set(id, next)
    return clone(next)
  }

  return {
    async save (value) {
      records.set(value.id, clone(value))
      return clone(value)
    },
    async get (id) {
      return clone(records.get(id))
    },
    async patch (id, value) {
      const current = records.get(id)
      if (!current) throw new Error(`missing record: ${id}`)
      const next = { ...current, ...clone(value) }
      records.set(id, next)
      return clone(next)
    },
    guardedPatch,
    guardedPatchOperation: guardedPatch
  }
}

function marker (phase, id, code = 0) {
  return `__SHELLPILOT_${phase.toUpperCase()}_RC_${id}=${code}`
}

function protectedContext () {
  return {
    enabled: true,
    isSsh: true,
    passwordMode: false,
    alternateBuffer: false,
    isPaste: false,
    shellIntegrationActive: true,
    commandInputActive: true,
    canonicalInputReliable: true
  }
}

function createHarness (createTerminalSafetyCoordinator, createTerminalSafetyController, options = {}) {
  const calls = {
    prepare: [],
    begin: [],
    cancel: [],
    complete: [],
    expected: [],
    released: [],
    cancelledExpected: []
  }
  let requestSequence = 0
  let submissionSequence = 0
  const runner = {
    prepare: async request => {
      calls.prepare.push(request)
      if (options.prepare) return options.prepare(request)
      return { ...request, state: 'awaiting-confirmation' }
    },
    beginExternalExecution: async (id, executeOptions) => {
      calls.begin.push({ id, executeOptions })
      if (options.begin) return options.begin(id, executeOptions)
      return { id, executionId: `${id}-external`, state: 'executing' }
    },
    cancel: async id => {
      calls.cancel.push(id)
      return { id, state: 'failed' }
    },
    completeExternalExecution: async (id, completion) => {
      calls.complete.push({ id, completion })
      return { id, state: completion.exitCode === 0 ? 'rollback-available' : 'failed' }
    }
  }
  const tracker = {
    expectSubmission: command => {
      const token = `submission-${++submissionSequence}`
      calls.expected.push({ token, command })
      return token
    },
    markExpectedSubmissionReleased: token => {
      calls.released.push(token)
      return true
    },
    cancelExpectedSubmission: token => {
      calls.cancelledExpected.push(token)
      return true
    }
  }
  const views = []
  const coordinator = createTerminalSafetyCoordinator({
    controller: createTerminalSafetyController(),
    runner,
    tracker,
    buildRequest: confirmation => ({
      id: `operation-${++requestSequence}`,
      source: 'terminal',
      command: confirmation.command
    }),
    onStateChange: state => views.push(state)
  })
  coordinator.beginSession()
  return { coordinator, calls, views }
}

test('escaped trailing-space approval prepares recovery and completes external lifecycle', async () => {
  const {
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  } = await importSafetyModules()
  const [
    { createTransactionRunner },
    { buildRecoveryPlan },
    { buildSafetyRequest }
  ] = await Promise.all([
    importDomainModule('transaction-runner.js'),
    importDomainModule('recovery-providers.js'),
    importDomainModule('models.js')
  ])
  const id = 'terminal-trailing-space'
  const command = String.raw`/usr/bin/printf x > /tmp/task5-review\ `
  const endpoint = {
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    tabId: 'tab-1',
    pid: 1001
  }
  const store = createRunnerStore()
  const remoteCalls = []
  const runner = createTransactionRunner({
    runRemote: async (remoteCommand, options) => {
      remoteCalls.push({ command: remoteCommand, options })
      return {
        stdout: `prepared\n${marker(options.phase, id)}`,
        stderr: '',
        code: 0
      }
    },
    cancelRemote: async () => {},
    getCurrentEndpoint: async () => endpoint,
    buildRecoveryPlan,
    store
  })
  const submissionToken = 'submission-trailing-space'
  const states = []
  const tracker = {
    expectSubmission: submitted => {
      assert.equal(submitted, command)
      return submissionToken
    },
    markExpectedSubmissionReleased: token => token === submissionToken,
    cancelExpectedSubmission: () => true
  }
  const coordinator = createTerminalSafetyCoordinator({
    controller: createTerminalSafetyController(),
    runner,
    tracker,
    onStateChange: state => states.push(state),
    buildRequest: confirmation => buildSafetyRequest({
      id,
      source: 'terminal',
      endpoint,
      command: confirmation.command
    })
  })
  coordinator.beginSession()

  const decision = coordinator.beforeEnter(command, protectedContext())
  assert.equal(states.at(-1).confirmation.kind, 'reversible')
  assert.equal(states.at(-1).confirmation.automaticRollback, true)
  assert.equal(
    await coordinator.confirmExecute(),
    true,
    states.at(-1)?.error
  )
  const release = await decision

  assert.equal(release.sendNow, true)
  assert.equal(release.releaseToken, submissionToken)
  assert.equal(coordinator.consumeRelease(submissionToken), true)
  assert.equal(remoteCalls.length, 1)
  assert.equal(remoteCalls[0].options.phase, 'prepare')
  assert.match(remoteCalls[0].command, /'\/tmp\/task5-review '/)
  const executing = await store.get(id)
  assert.equal(executing.state, 'executing')
  assert.equal(executing.plan.executeCommand, command)

  assert.equal(await coordinator.handleCommandFinished({
    token: submissionToken,
    command,
    exitCode: 0
  }), true)
  const completed = await store.get(id)
  assert.equal(completed.state, 'rollback-available')
  assert.equal(completed.plan.rollbackCommand.length > 0, true)
})

test('disconnect during confirmation closes it and never releases Enter', async () => {
  const {
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  } = await importSafetyModules()
  const { coordinator, calls, views } = createHarness(
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  )
  const decision = coordinator.beforeEnter(
    '/usr/bin/systemctl start nginx',
    protectedContext()
  )

  await coordinator.invalidateSession()

  assert.deepEqual(await decision, { sendNow: false, clear: false })
  assert.equal(await coordinator.confirmExecute(), false)
  assert.deepEqual(calls.prepare, [])
  assert.deepEqual(calls.begin, [])
  assert.equal(views.at(-1).confirmation, null)
})

test('nonreversible confirmation after disconnect creates no execution record', async () => {
  const {
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  } = await importSafetyModules()
  const { coordinator, calls } = createHarness(
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  )
  const decision = coordinator.beforeEnter(
    'custom-admin-tool --rotate',
    protectedContext()
  )

  await coordinator.invalidateSession()

  assert.deepEqual(await decision, { sendNow: false, clear: false })
  assert.equal(await coordinator.confirmExecute(), false)
  assert.deepEqual(calls.prepare, [])
  assert.deepEqual(calls.begin, [])
})

test('credential-bearing one-time confirmation creates no persistent transaction', async () => {
  const {
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  } = await importSafetyModules()
  const { coordinator, calls } = createHarness(
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  )
  const decision = coordinator.beforeEnter(
    'curl -H "Authorization: Bearer secret-value" https://example.com/admin',
    protectedContext()
  )

  assert.equal(await coordinator.confirmExecute(), true)
  const release = await decision

  assert.equal(coordinator.consumeRelease(release.releaseToken), true)
  assert.deepEqual(calls.prepare, [])
  assert.deepEqual(calls.begin, [])
  assert.deepEqual(calls.expected, [])
})

test('disconnect during prepare cancels the transaction and ignores its late result', async () => {
  const {
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  } = await importSafetyModules()
  const preparation = deferred()
  const { coordinator, calls } = createHarness(
    createTerminalSafetyCoordinator,
    createTerminalSafetyController,
    { prepare: () => preparation.promise }
  )
  const decision = coordinator.beforeEnter(
    '/usr/bin/systemctl start nginx',
    protectedContext()
  )
  const confirmation = coordinator.confirmExecute()
  await Promise.resolve()

  await coordinator.invalidateSession()
  preparation.resolve({ state: 'awaiting-confirmation' })

  assert.equal(await confirmation, false)
  assert.deepEqual(await decision, { sendNow: false, clear: false })
  assert.deepEqual(calls.begin, [])
  assert.deepEqual(calls.cancel, ['operation-1', 'operation-1'])
})

test('a stale prepare cannot release into a reconnected session', async () => {
  const {
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  } = await importSafetyModules()
  const preparation = deferred()
  const { coordinator, calls } = createHarness(
    createTerminalSafetyCoordinator,
    createTerminalSafetyController,
    { prepare: () => preparation.promise }
  )
  const staleDecision = coordinator.beforeEnter(
    '/usr/bin/systemctl start nginx',
    protectedContext()
  )
  const staleConfirmation = coordinator.confirmExecute()
  await Promise.resolve()
  await coordinator.invalidateSession()
  coordinator.beginSession()
  const freshDecision = coordinator.beforeEnter('/usr/bin/uptime', protectedContext())
  preparation.resolve({ state: 'awaiting-confirmation' })

  assert.deepEqual(freshDecision, { sendNow: true })
  assert.equal(await staleConfirmation, false)
  assert.deepEqual(await staleDecision, { sendNow: false, clear: false })
  assert.deepEqual(calls.begin, [])
  assert.equal(coordinator.consumeRelease('stale-token'), false)
})

test('release is one-time and invalidation before consumption prevents socket send', async () => {
  const {
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  } = await importSafetyModules()
  const { coordinator, calls } = createHarness(
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  )
  const decision = coordinator.beforeEnter(
    '/usr/bin/systemctl start nginx',
    protectedContext()
  )
  assert.equal(await coordinator.confirmExecute(), true)
  const release = await decision

  await coordinator.invalidateSession()

  assert.equal(release.sendNow, true)
  assert.equal(coordinator.consumeRelease(release.releaseToken), false)
  assert.deepEqual(calls.released, [])
  assert.equal(calls.cancel.includes('operation-1'), true)
})

test('only the matching expected token can complete the current transaction', async () => {
  const {
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  } = await importSafetyModules()
  const { coordinator, calls } = createHarness(
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  )
  const decision = coordinator.beforeEnter(
    '/usr/bin/systemctl start nginx',
    protectedContext()
  )
  await coordinator.confirmExecute()
  const release = await decision
  assert.equal(coordinator.consumeRelease(release.releaseToken), true)

  assert.equal(await coordinator.handleCommandFinished({
    token: 'late-token',
    command: 'uptime',
    exitCode: 0
  }), false)
  assert.notEqual(coordinator.getPendingExecution(), null)
  assert.equal(await coordinator.handleCommandFinished({
    token: release.releaseToken,
    command: '/usr/bin/systemctl start nginx',
    exitCode: 0
  }), true)

  assert.equal(coordinator.getPendingExecution(), null)
  assert.equal(calls.complete.length, 1)
  assert.equal(calls.complete[0].completion.command, '/usr/bin/systemctl start nginx')
})

test('prompt-boundary interruption completes external execution with unknown exit', async () => {
  const {
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  } = await importSafetyModules()
  const { coordinator, calls } = createHarness(
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  )
  const decision = coordinator.beforeEnter(
    '/usr/bin/systemctl start nginx',
    protectedContext()
  )
  await coordinator.confirmExecute()
  const release = await decision
  assert.equal(coordinator.consumeRelease(release.releaseToken), true)

  assert.equal(await coordinator.handleCommandFinished({
    token: release.releaseToken,
    command: '/usr/bin/systemctl start nginx',
    exitCode: null
  }), true)

  assert.equal(calls.complete.length, 1)
  assert.equal(calls.complete[0].completion.exitCode, null)
})

test('prepare and external begin must return their exact lifecycle states', async () => {
  const {
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  } = await importSafetyModules()
  const unprepared = createHarness(
    createTerminalSafetyCoordinator,
    createTerminalSafetyController,
    { prepare: async () => ({ state: 'failed' }) }
  )
  const unpreparedDecision = unprepared.coordinator.beforeEnter(
    '/usr/bin/systemctl start nginx',
    protectedContext()
  )

  assert.equal(await unprepared.coordinator.confirmExecute(), false)
  assert.deepEqual(unprepared.calls.begin, [])
  assert.deepEqual(unprepared.calls.expected, [])
  await unprepared.coordinator.cancelConfirmation()
  await unpreparedDecision

  const unbegun = createHarness(
    createTerminalSafetyCoordinator,
    createTerminalSafetyController,
    { begin: async id => ({ id, state: 'failed' }) }
  )
  const unbegunDecision = unbegun.coordinator.beforeEnter(
    '/usr/bin/systemctl start nginx',
    protectedContext()
  )

  assert.equal(await unbegun.coordinator.confirmExecute(), false)
  assert.deepEqual(unbegun.calls.expected, [])
  await unbegun.coordinator.cancelConfirmation()
  await unbegunDecision
})

test('duplicate confirmation starts only one preparation', async () => {
  const {
    createTerminalSafetyCoordinator,
    createTerminalSafetyController
  } = await importSafetyModules()
  const preparation = deferred()
  const { coordinator, calls } = createHarness(
    createTerminalSafetyCoordinator,
    createTerminalSafetyController,
    { prepare: () => preparation.promise }
  )
  const decision = coordinator.beforeEnter(
    '/usr/bin/systemctl start nginx',
    protectedContext()
  )

  const first = coordinator.confirmExecute()
  const duplicate = coordinator.confirmExecute()
  await Promise.resolve()

  const prepareCount = calls.prepare.length
  preparation.resolve({ state: 'awaiting-confirmation' })
  assert.equal(await duplicate, false)
  assert.equal(prepareCount, 1)
  assert.equal(await first, true)
  const release = await decision
  assert.equal(coordinator.consumeRelease(release.releaseToken), true)
  await coordinator.invalidateSession()
})
