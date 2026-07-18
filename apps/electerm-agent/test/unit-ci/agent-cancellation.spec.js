const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createRiskPreparation } = require('./agent-risk-fixture.js')

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
      return createRiskPreparation({
        args: { command: 'systemctl restart nginx' },
        endpoint: endpoint(),
        riskTaskId: 'risk-a'
      })
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

test('terminal Agent risk passes its authenticated delegation to the safety entrypoint', async () => {
  const { runAgentTerminalCommand } = await import(terminalUrl)
  const riskDelegation = Object.freeze({ opaque: true })
  let observedDelegation

  await runAgentTerminalCommand({
    args: { command: 'journalctl -f', tabId: 'tab-a' },
    riskDelegation,
    store: {
      runSafetyCommand: async (_command, options) => {
        observedDelegation = options.riskDelegation
        return { sent: false, cancelled: true }
      },
      mcpWaitForTerminalIdle: async () => {
        throw new Error('wait should not run')
      }
    }
  })

  assert.equal(observedDelegation, riskDelegation)
})

test('terminal cancellation is not armed until the command was dispatched', async () => {
  const { runAgentTerminalCommand } = await import(terminalUrl)
  let armed = 0
  await runAgentTerminalCommand({
    args: { command: 'uptime', tabId: 'tab-a' },
    store: {
      runSafetyCommand: async () => ({ sent: false, cancelled: true }),
      mcpWaitForTerminalIdle: async () => {
        throw new Error('wait should not run')
      }
    },
    onDispatched: () => { armed += 1 }
  })
  assert.equal(armed, 0)

  await runAgentTerminalCommand({
    args: { command: 'uptime', tabId: 'tab-a' },
    store: {
      runSafetyCommand: async () => ({ sent: true }),
      mcpWaitForTerminalIdle: async () => ({ timedOut: false })
    },
    onDispatched: () => { armed += 1 }
  })
  assert.equal(armed, 1)
})

test('a cancellation race after terminal dispatch still arms remote stop', async () => {
  const { runAgentTerminalCommand } = await import(terminalUrl)
  const controller = new AbortController()
  let armed = 0
  await assert.rejects(runAgentTerminalCommand({
    args: { command: 'uptime', tabId: 'tab-a' },
    signal: controller.signal,
    store: {
      runSafetyCommand: async () => {
        controller.abort()
        return { sent: true }
      },
      mcpWaitForTerminalIdle: async () => {
        throw new Error('wait should not run after abort')
      }
    },
    onDispatched: () => { armed += 1 }
  }), error => error.name === 'AbortError')
  assert.equal(armed, 1)
})

test('production handlers use abortable waits and prepare upload recovery before queueing', () => {
  const source = fs.readFileSync(path.resolve(
    aiRoot,
    '../../store/mcp-handler.js'
  ), 'utf8')
  const commandEntrypoint = fs.readFileSync(path.resolve(
    aiRoot,
    '../../common/safety-transactions/command-entrypoint.js'
  ), 'utf8')
  const wait = source.slice(
    source.indexOf('Store.prototype.mcpWaitForTerminalIdle'),
    source.indexOf('// ==================== Terminal Status')
  )
  const background = source.slice(
    source.indexOf('Store.prototype.mcpRunBackgroundCommand'),
    source.indexOf('Store.prototype.mcpGetBackgroundTaskStatus')
  )
  const upload = source.slice(
    source.indexOf('Store.prototype.mcpSftpUpload'),
    source.indexOf('Store.prototype.mcpSftpDownload')
  )
  assert.match(wait, /abortableDelay\(minWait, signal/)
  assert.match(wait, /abortableDelay\(pollInterval, signal/)
  assert.match(background, /options\.signal/)
  assert.match(commandEntrypoint, /runOptions\.signal\.addEventListener\('abort'/)
  assert.ok(
    upload.indexOf('verifyLocalTransferSource') <
      upload.indexOf('prepareTransferSafetyOperation')
  )
  assert.ok(
    upload.indexOf('prepareTransferSafetyOperation') <
      upload.indexOf('addTransferList')
  )
  assert.match(upload, /preparedTransfer\?\.transferId/)
  assert.match(upload, /Prepared SFTP recovery operation changed before queueing/)
  assert.match(upload, /safetyOperationId/)

  const sftpDelete = source.slice(
    source.indexOf('Store.prototype.mcpSftpDel'),
    source.indexOf('// ==================== File Transfer APIs')
  )
  assert.match(sftpDelete, /recoverable\s*=\s*Boolean\(success && !isFtp\)/)
  assert.match(sftpDelete, /permanently deleted/)

  const describeUpload = source.slice(
    source.indexOf('Store.prototype.mcpDescribeSftpUploadSource'),
    source.indexOf('Store.prototype.mcpCancelPreparedSftpUpload')
  )
  assert.match(describeUpload, /assertMcpActive\(options\.signal[\s\S]*cancelTransferSafetyOperation/)

  const agentTools = fs.readFileSync(path.join(aiRoot, 'agent-tools.js'), 'utf8')
  const prepareArgs = agentTools.slice(
    agentTools.indexOf('export async function prepareAgentRiskArgs'),
    agentTools.indexOf('function batchPreparationFor')
  )
  const invalidate = agentTools.slice(
    agentTools.indexOf('invalidateRisky:'),
    agentTools.indexOf('execute: async', agentTools.indexOf('invalidateRisky:'))
  )
  assert.match(prepareArgs, /catch[\s\S]*cancelPreparedRiskArtifacts/)
  assert.ok(
    invalidate.indexOf('cancelPreparedRiskArtifacts') <
      invalidate.indexOf('failAgentRiskPreparation')
  )
})

test('agent cancellation settles an open risk batch before returning', () => {
  const agentSource = fs.readFileSync(path.join(aiRoot, 'agent.js'), 'utf8')
  const cancellation = agentSource.slice(
    agentSource.indexOf('async function markCancelled'),
    agentSource.indexOf('\n  try {', agentSource.indexOf('async function markCancelled'))
  )

  assert.match(cancellation, /failAgentRiskBatch\(agentRuntime/)
  assert.ok(
    cancellation.indexOf('failAgentRiskBatch') <
      cancellation.indexOf('settleAgentCancellation')
  )

  const agentTools = fs.readFileSync(path.join(aiRoot, 'agent-tools.js'), 'utf8')
  const failBatch = agentTools.slice(
    agentTools.indexOf('export async function failAgentRiskBatch'),
    agentTools.indexOf('function parseToolResult')
  )
  assert.match(failBatch, /error\?\.name === 'AbortError' && !dispatched[\s\S]*'cancelled'/)
})

test('upload preparation failures clean recovery and remain not dispatched', () => {
  const agentSource = fs.readFileSync(path.join(aiRoot, 'agent-tools.js'), 'utf8')
  const uploadCase = agentSource.slice(
    agentSource.indexOf("case 'sftp_upload'"),
    agentSource.indexOf("case 'sftp_download'")
  )
  const executionCatch = agentSource.slice(
    agentSource.indexOf('execute: async (verifiedEndpoint'),
    agentSource.indexOf('verifyRisky:', agentSource.indexOf('execute: async (verifiedEndpoint'))
  )
  const gatewaySource = fs.readFileSync(path.join(aiRoot, 'agent-tool-gateway.js'), 'utf8')

  assert.match(uploadCase, /catch[\s\S]*cancelPreparedRiskArtifacts\(args/)
  assert.match(uploadCase, /mutationDispatched\s*=\s*false/)
  assert.match(uploadCase, /remoteState\s*=\s*'not-dispatched'/)
  assert.match(executionCatch, /dispatched:\s*error\?\.mutationDispatched\s*!==\s*false/)
  assert.match(gatewaySource, /error\?\.mutationDispatched\s*!==\s*false/)
})
