const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const lifecycleUrl = pathToFileURL(path.join(aiRoot, 'agent-takeover-lifecycle.js')).href
const takeoverRegistryUrl = pathToFileURL(path.join(aiRoot, 'agent-takeover-registry.js')).href
const taskRegistryUrl = pathToFileURL(path.join(aiRoot, 'agent-task-registry.js')).href

function endpoint (suffix = 'a') {
  return {
    host: `${suffix}.example.test`,
    port: 22,
    username: 'ops',
    tabId: `tab-${suffix}`,
    pid: `pid-${suffix}`,
    terminalPid: `pid-${suffix}`,
    sessionType: 'ssh',
    hostKeyFingerprint: `SHA256:${suffix}`
  }
}

async function activeFixture (state = 'active-idle') {
  const { createTakeoverRegistry } = await import(takeoverRegistryUrl)
  const { createAgentTaskRegistry } = await import(taskRegistryUrl)
  const takeoverRegistry = createTakeoverRegistry()
  const taskRegistry = createAgentTaskRegistry()
  const cancellations = []
  const controllers = new Map()
  for (const suffix of ['a', 'b']) {
    const target = endpoint(suffix)
    takeoverRegistry.enable(target)
    takeoverRegistry.transition(target, 'active-idle')
    if (suffix === 'a' && state !== 'active-idle') {
      takeoverRegistry.transition(target, state)
    }
    const controller = new AbortController()
    controllers.set(suffix, controller)
    taskRegistry.register({
      taskId: `task-${suffix}`,
      endpoint: target,
      scopeId: target.tabId,
      controller,
      runner: {
        cancel: async id => {
          cancellations.push(id)
          return { id, status: 'cancelled' }
        }
      }
    })
  }
  return { takeoverRegistry, taskRegistry, cancellations, controllers }
}

for (const type of [
  'disconnect',
  'reconnect-start',
  'endpoint-change',
  'manual-stop'
]) {
  test(`${type} cancels and revokes only the matching exact SSH session`, async () => {
    const { handleAgentTakeoverLifecycleEvent } = await import(lifecycleUrl)
    const fixture = await activeFixture('awaiting-risk-confirmation')

    const result = await handleAgentTakeoverLifecycleEvent({
      type,
      endpoint: endpoint('a'),
      tabId: 'tab-a'
    }, fixture)

    assert.equal(result.revoked, 1)
    assert.equal(fixture.takeoverRegistry.get(endpoint('a')), undefined)
    assert.equal(fixture.takeoverRegistry.isActive(endpoint('b')), true)
    assert.deepEqual(fixture.cancellations, ['task-a'])
    assert.equal(fixture.controllers.get('a').signal.aborted, true)
    assert.equal(fixture.controllers.get('b').signal.aborted, false)
  })
}

test('tab close uses scope identity and app exit revokes every in-memory grant', async () => {
  const { handleAgentTakeoverLifecycleEvent } = await import(lifecycleUrl)
  const tabFixture = await activeFixture()
  await handleAgentTakeoverLifecycleEvent({
    type: 'tab-close',
    tabId: 'tab-a'
  }, tabFixture)
  assert.equal(tabFixture.takeoverRegistry.get(endpoint('a')), undefined)
  assert.equal(tabFixture.takeoverRegistry.isActive(endpoint('b')), true)
  assert.deepEqual(tabFixture.cancellations, ['task-a'])

  const exitFixture = await activeFixture()
  const result = await handleAgentTakeoverLifecycleEvent({
    type: 'app-before-quit'
  }, exitFixture)
  assert.equal(result.revoked, 2)
  assert.deepEqual(exitFixture.takeoverRegistry.snapshot(), [])
  assert.deepEqual(exitFixture.cancellations.sort(), ['task-a', 'task-b'])
})

test('renderer session lifecycle is wired to the unified takeover adapter', () => {
  const terminalSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/terminal/terminal.jsx'),
    'utf8'
  )
  const tabStoreSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/tab.js'),
    'utf8'
  )
  const mainSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/main.jsx'),
    'utf8'
  )

  for (const type of ['disconnect', 'reconnect-start', 'endpoint-change']) {
    assert.match(terminalSource, new RegExp(`type: '${type}'`))
  }
  assert.match(terminalSource, /type: 'tab-close'/)
  assert.match(tabStoreSource, /type: 'tab-close'/)
  assert.match(mainSource, /installAgentTakeoverLifecycle/)
  assert.match(mainSource, /activeSessionStatus: currentTab\?\.status \|\| ''/)
})

test('takeover remains memory-only and adds no idle polling or remote work', () => {
  const lifecycleSource = fs.readFileSync(
    path.join(aiRoot, 'agent-takeover-lifecycle.js'),
    'utf8'
  )
  const registrySource = fs.readFileSync(
    path.join(aiRoot, 'agent-takeover-registry.js'),
    'utf8'
  )
  const initialStateSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/init-state.js'),
    'utf8'
  )

  assert.doesNotMatch(lifecycleSource + registrySource, /setInterval|setTimeout/)
  assert.doesNotMatch(lifecycleSource + registrySource, /AIchat|runCmd|createTerm/)
  assert.doesNotMatch(initialStateSource, /takeoverGrants/)
  assert.doesNotMatch(initialStateSource, /agentRunning:/)
})

test('terminal publishes connected status only after exact session identity is ready', () => {
  const terminalSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/terminal/terminal.jsx'),
    'utf8'
  )
  const connectedBlock = terminalSource.match(
    /this\.port = r\.port([\s\S]*?)const wsUrl = this\.buildWsUrl/
  )
  assert.ok(connectedBlock, 'SSH connection completion block is required')
  assert.ok(
    connectedBlock[1].indexOf('this.pid = id') <
      connectedBlock[1].indexOf('this.setStatus(statusMap.success)'),
    'session pid must be assigned before the observable connected status update'
  )
})
