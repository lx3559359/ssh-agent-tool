const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const gateUrl = pathToFileURL(path.join(aiRoot, 'agent-takeover-gate.js')).href
const registryUrl = pathToFileURL(path.join(aiRoot, 'agent-takeover-registry.js')).href

function endpoint (suffix = 'a') {
  return {
    host: 'srv.test',
    port: 22,
    username: 'ops',
    tabId: 'tab-a',
    pid: `pid-${suffix}`,
    terminalPid: `terminal-${suffix}`,
    sessionType: 'ssh',
    hostKeyFingerprint: `SHA256:${suffix}`
  }
}

async function activeRegistry () {
  const { createTakeoverRegistry } = await import(registryUrl)
  const registry = createTakeoverRegistry()
  registry.enable(endpoint())
  registry.transition(endpoint(), 'active-idle')
  return registry
}

test('endpoint and grant are revalidated after async confirmation before dispatch', async () => {
  const { executeAgentToolWithGate } = await import(gateUrl)
  const registry = await activeRegistry()
  let currentEndpoint = endpoint()
  let releaseConfirmation
  const confirmation = new Promise(resolve => {
    releaseConfirmation = resolve
  })
  let executions = 0

  const pending = executeAgentToolWithGate({
    descriptor: { scope: 'session-write' },
    resolveEndpoint: () => currentEndpoint,
    registry,
    risk: true,
    prepare: () => confirmation,
    execute: () => {
      executions += 1
    }
  })

  assert.equal(registry.get(endpoint()).state, 'awaiting-risk-confirmation')
  registry.disable(endpoint(), 'disconnect')
  currentEndpoint = endpoint('replacement')
  releaseConfirmation()

  await assert.rejects(pending, error => error.code === 'AI_TAKEOVER_REQUIRED')
  assert.equal(executions, 0)
})

test('runtime gate publishes readonly and risky execution states', async () => {
  const { executeAgentToolWithGate } = await import(gateUrl)
  const registry = await activeRegistry()
  const readonlyStates = []

  await executeAgentToolWithGate({
    descriptor: { scope: 'session-read' },
    resolveEndpoint: () => endpoint(),
    registry,
    execute: () => {
      readonlyStates.push(registry.get(endpoint()).state)
      return 'read-result'
    }
  })
  assert.deepEqual(readonlyStates, ['running-readonly'])
  assert.equal(registry.get(endpoint()).state, 'active-idle')

  const riskyStates = []
  await executeAgentToolWithGate({
    descriptor: { scope: 'session-write' },
    resolveEndpoint: () => endpoint(),
    registry,
    risk: true,
    prepare: () => {
      riskyStates.push(registry.get(endpoint()).state)
    },
    execute: () => {
      riskyStates.push(registry.get(endpoint()).state)
      return 'write-result'
    }
  })
  assert.deepEqual(riskyStates, [
    'awaiting-risk-confirmation',
    'running-confirmed-change'
  ])
  assert.equal(registry.get(endpoint()).state, 'active-idle')
})

test('non-command session writes and controls publish confirmed change states', async () => {
  const { executeAgentToolWithGate } = await import(gateUrl)
  for (const scope of ['session-write', 'session-control']) {
    const registry = await activeRegistry()
    const states = []
    await executeAgentToolWithGate({
      descriptor: { scope },
      resolveEndpoint: () => endpoint(),
      registry,
      execute: () => {
        states.push(registry.get(endpoint()).state)
        return 'changed'
      }
    })
    assert.deepEqual(states, ['running-confirmed-change'], scope)
    assert.equal(registry.get(endpoint()).state, 'active-idle', scope)
  }
})

test('Agent confirmations are asynchronous and abort-aware', () => {
  const confirmationSource = fs.readFileSync(
    path.join(aiRoot, 'agent-confirmation.js'),
    'utf8'
  )
  const toolConfirmSource = fs.readFileSync(
    path.join(aiRoot, 'agent-tool-confirm.js'),
    'utf8'
  )
  const taskModeSource = fs.readFileSync(
    path.join(aiRoot, 'agent-task-mode.js'),
    'utf8'
  )

  assert.match(confirmationSource, /Modal\.confirm/)
  assert.match(confirmationSource, /signal\?\.addEventListener\('abort'/)
  assert.doesNotMatch(toolConfirmSource + taskModeSource, /window\.confirm/)
})

test('aborting an Agent confirmation closes it without approval', async () => {
  const confirmationUrl = pathToFileURL(path.join(
    aiRoot,
    'agent-confirmation.js'
  )).href
  const { requestAgentConfirmation } = await import(confirmationUrl)
  const controller = new AbortController()
  let options
  let destroyed = 0
  const pending = requestAgentConfirmation('dangerous command', {
    signal: controller.signal,
    Modal: {
      confirm: value => {
        options = value
        return { destroy: () => { destroyed += 1 } }
      }
    }
  })

  assert.equal(typeof options.onOk, 'function')
  controller.abort()
  assert.equal(await pending, false)
  assert.equal(destroyed, 1)
})
