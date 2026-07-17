const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const gatewayUrl = pathToFileURL(path.join(aiRoot, 'agent-tool-gateway.js')).href
const registryUrl = pathToFileURL(path.join(aiRoot, 'agent-takeover-registry.js')).href
const runtimeUrl = pathToFileURL(path.join(aiRoot, 'agent-runtime-context.js')).href
const terminalUrl = pathToFileURL(path.join(aiRoot, 'agent-terminal-command.js')).href

function endpoint () {
  return {
    host: 'srv.test',
    port: 22,
    username: 'ops',
    tabId: 'tab-a',
    pid: 'pid-a',
    terminalPid: 'terminal-a',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:abc'
  }
}

test('the same AbortSignal reaches gateway preparation, execution and verification', async () => {
  const { executeAgentTool } = await import(gatewayUrl)
  const { createTakeoverRegistry } = await import(registryUrl)
  const registry = createTakeoverRegistry()
  registry.enable(endpoint())
  registry.transition(endpoint(), 'active-idle')
  const controller = new AbortController()
  const observed = []

  const result = await executeAgentTool({
    toolName: 'send_terminal_command',
    args: { command: 'systemctl restart nginx' },
    endpoint: endpoint(),
    resolveEndpoint: endpoint,
    registry,
    signal: controller.signal,
    prepareRisky: async context => {
      observed.push(context.signal)
      return { riskTaskId: 'risk-a' }
    },
    execute: async (_endpoint, _prepared, context) => {
      observed.push(context.signal)
      return { exitCode: 0 }
    },
    verifyRisky: async (_result, _endpoint, _prepared, context) => {
      observed.push(context.signal)
      return { passed: true }
    }
  })

  assert.deepEqual(result, { exitCode: 0 })
  assert.deepEqual(observed, [controller.signal, controller.signal, controller.signal])
})

test('aborting a gateway call stops before a later executor begins', async () => {
  const { executeAgentTool } = await import(gatewayUrl)
  const { createTakeoverRegistry } = await import(registryUrl)
  const registry = createTakeoverRegistry()
  registry.enable(endpoint())
  registry.transition(endpoint(), 'active-idle')
  const controller = new AbortController()
  controller.abort()
  let executorCalls = 0

  await assert.rejects(executeAgentTool({
    toolName: 'read_service_status',
    args: { service: 'nginx' },
    endpoint: endpoint(),
    resolveEndpoint: endpoint,
    registry,
    signal: controller.signal,
    execute: async () => { executorCalls += 1 }
  }), error => error.name === 'AbortError')
  assert.equal(executorCalls, 0)
})

test('registered cancellation runs once and failed remote stop is not success', async () => {
  const {
    cancelAgentRuntimeOperations,
    registerAgentCancellation
  } = await import(runtimeUrl)
  const runtime = { cancellations: new Set() }
  let calls = 0
  registerAgentCancellation(runtime, async () => {
    calls += 1
    const error = new Error('remote stop could not be confirmed')
    error.remoteState = 'unknown'
    throw error
  })

  await assert.rejects(cancelAgentRuntimeOperations(runtime), error => {
    assert.equal(error.code, 'AGENT_CANCELLATION_FAILED')
    assert.equal(error.remoteState, 'unknown')
    return true
  })
  await cancelAgentRuntimeOperations(runtime)
  assert.equal(calls, 1)
})

test('agent loop preserves backend AIAgentCancel and terminal signal wiring', () => {
  const agentSource = fs.readFileSync(path.join(aiRoot, 'agent.js'), 'utf8')
  const terminalSource = fs.readFileSync(path.join(aiRoot, 'agent-terminal-command.js'), 'utf8')
  assert.match(agentSource, /runGlobalAsync\('AIAgentCancel', activeBackendRequestId\)/)
  assert.match(terminalSource, /runSafetyCommand\([\s\S]*signal/)
})

test('terminal safety dispatch and wait receive the runtime AbortSignal', async () => {
  const { runAgentTerminalCommand } = await import(terminalUrl)
  const controller = new AbortController()
  const observed = []
  const result = await runAgentTerminalCommand({
    args: { command: 'uptime', tabId: 'tab-a' },
    signal: controller.signal,
    store: {
      runSafetyCommand: async (_command, options) => {
        observed.push(options.signal)
        return { sent: true }
      },
      mcpWaitForTerminalIdle: async options => {
        observed.push(options.signal)
        return { success: true }
      }
    }
  })

  assert.deepEqual(result, { success: true })
  assert.deepEqual(observed, [controller.signal, controller.signal])
})
