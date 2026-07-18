const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createRiskPreparation } = require('./agent-risk-fixture.js')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const gatewayUrl = pathToFileURL(path.join(aiRoot, 'agent-tool-gateway.js')).href
const registryUrl = pathToFileURL(path.join(aiRoot, 'agent-takeover-registry.js')).href
const operationIdUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/operation-id.js'
)).href
const riskResultUrl = pathToFileURL(path.join(aiRoot, 'agent-risk-result.js')).href

function endpoint () {
  return {
    host: 'srv.test',
    port: 22,
    username: 'ops',
    tabId: 'tab-a',
    pid: 'pid-a',
    terminalPid: 'term-a',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:abc'
  }
}

async function registry () {
  const { createTakeoverRegistry } = await import(registryUrl)
  const value = createTakeoverRegistry()
  value.enable(endpoint())
  value.transition(endpoint(), 'active-idle')
  return value
}

test('trusted Agent operation ids are stable ASCII persistence keys', async () => {
  const { createTrustedOperationId } = await import(operationIdUrl)
  const id = createTrustedOperationId('agent-risk', {
    now: () => 1000,
    random: () => 'abc_123'
  })
  assert.equal(id, 'agent-risk-1000-abc_123')
})

test('transport uncertainty after dispatch never replays a changing call', async () => {
  const { executeAgentTool } = await import(gatewayUrl)
  const takeoverRegistry = await registry()
  const events = []
  let remoteWriteCalls = 0
  const timedOut = new Error('transport timed out after remote acceptance')
  timedOut.timedOut = true

  await assert.rejects(executeAgentTool({
    toolName: 'send_terminal_command',
    args: { command: 'systemctl restart nginx' },
    endpoint: endpoint(),
    resolveEndpoint: endpoint,
    registry: takeoverRegistry,
    prepareRisky: async () => {
      events.push('intent-persisted')
      return createRiskPreparation({
        args: { command: 'systemctl restart nginx' },
        endpoint: endpoint(),
        riskTaskId: 'agent-risk-1'
      })
    },
    execute: async () => {
      events.push('dispatch')
      remoteWriteCalls += 1
      throw timedOut
    }
  }), error => {
    assert.equal(error.operationId, 'agent-risk-1')
    assert.equal(error.remoteState, 'unknown')
    assert.equal(error.canAutoRetry, false)
    assert.equal(error.mutationDispatched, true)
    return true
  })

  assert.deepEqual(events, ['intent-persisted', 'dispatch'])
  assert.equal(remoteWriteCalls, 1)
  assert.equal(takeoverRegistry.get(endpoint()).state, 'partially-completed')
})

test('exit zero with failed target verification is partially completed and not replayed', async () => {
  const { executeAgentTool } = await import(gatewayUrl)
  const takeoverRegistry = await registry()
  let remoteWriteCalls = 0
  let verificationCalls = 0

  await assert.rejects(executeAgentTool({
    toolName: 'send_terminal_command',
    args: { command: 'systemctl restart nginx' },
    endpoint: endpoint(),
    resolveEndpoint: endpoint,
    registry: takeoverRegistry,
    prepareRisky: async () => createRiskPreparation({
      args: { command: 'systemctl restart nginx' },
      endpoint: endpoint(),
      riskTaskId: 'agent-risk-verify'
    }),
    execute: async () => {
      remoteWriteCalls += 1
      return { exitCode: 0 }
    },
    verifyRisky: async () => {
      verificationCalls += 1
      const error = new Error('nginx health check failed')
      error.code = 'AGENT_TARGET_VERIFICATION_FAILED'
      error.verificationFailed = true
      throw error
    }
  }), error => {
    assert.equal(error.operationId, 'agent-risk-verify')
    assert.equal(error.canAutoRetry, false)
    assert.equal(error.verificationFailed, true)
    return true
  })

  assert.equal(remoteWriteCalls, 1)
  assert.equal(verificationCalls, 1)
  assert.equal(takeoverRegistry.get(endpoint()).state, 'partially-completed')
})

test('asynchronous mutation results cannot be marked verified at queue time', async () => {
  const {
    assertAgentRiskResultReadyForVerification,
    assertAgentVerificationDeclared
  } = await import(riskResultUrl)
  for (const value of [
    { pending: true },
    { taskId: 'task-a' },
    { transferId: 'transfer-a' }
  ]) {
    assert.throws(
      () => assertAgentRiskResultReadyForVerification(value),
      error => error.code === 'AGENT_ASYNC_OPERATION_PENDING' &&
        error.remoteState === 'in-progress'
    )
  }
  assert.equal(assertAgentRiskResultReadyForVerification({ exitCode: 0 }), true)
  assert.throws(
    () => assertAgentVerificationDeclared([]),
    error => error.code === 'AGENT_TARGET_VERIFICATION_REQUIRED' &&
      error.remoteState === 'changed-unverified'
  )
  assert.equal(assertAgentVerificationDeclared([{ name: 'read_service_status' }]), true)
})

test('risk transaction grant binds exact args endpoint and verification', async () => {
  const riskUrl = pathToFileURL(path.join(aiRoot, 'agent-risk-transaction.js')).href
  const grantUrl = pathToFileURL(path.join(aiRoot, 'agent-plan-grant.js')).href
  const {
    buildRiskPlanPayload,
    buildRiskTransaction,
    validateConfirmedRiskTransaction
  } = await import(riskUrl)
  const { createPlanGrant } = await import(grantUrl)
  const args = {
    command: 'systemctl restart nginx',
    tabId: 'tab-a',
    riskContext: {
      purpose: 'reload verified nginx configuration',
      impactTargets: ['nginx.service'],
      verification: [{
        name: 'read_service_status',
        args: { service: 'nginx' },
        expected: { contains: 'ActiveState=active' }
      }]
    }
  }
  const transaction = buildRiskTransaction([{ name: 'send_terminal_command', args }], {
    endpoint: endpoint(),
    goal: 'repair nginx',
    purpose: args.riskContext.purpose,
    affectedObjects: args.riskContext.impactTargets,
    verification: args.riskContext.verification
  })
  const grant = await createPlanGrant(buildRiskPlanPayload(transaction), {
    confirmedBy: 'user',
    now: 1000
  })

  const validated = await validateConfirmedRiskTransaction({
    transaction,
    planGrant: grant,
    endpoint: endpoint(),
    toolName: 'send_terminal_command',
    args
  })
  assert.equal(Object.isFrozen(validated.args.riskContext.verification), true)

  await assert.rejects(validateConfirmedRiskTransaction({
    transaction,
    planGrant: grant,
    endpoint: { ...endpoint(), pid: 'pid-b' },
    toolName: 'send_terminal_command',
    args
  }), error => error.code === 'PLAN_BINDING_CHANGED')
  await assert.rejects(validateConfirmedRiskTransaction({
    transaction,
    planGrant: grant,
    endpoint: endpoint(),
    toolName: 'send_terminal_command',
    args: {
      ...args,
      riskContext: {
        ...args.riskContext,
        verification: [{
          name: 'read_service_status',
          args: { service: 'sshd' }
        }]
      }
    }
  }), error => error.code === 'PLAN_BINDING_CHANGED')
})

test('post-risk verification is mandatory and command checks use readonly exec', () => {
  const source = fs.readFileSync(path.join(aiRoot, 'agent-tools.js'), 'utf8')
  const verification = source.match(
    /async function verifyPreparedAgentRisk[\s\S]*?\n}/
  )?.[0] || ''

  assert.match(verification, /assertAgentVerificationDeclared\(verification\)/)
  assert.match(verification, /executeStructuredAgentTool/)
  assert.match(verification, /executeCommand:\s*command\s*=>\s*runReadonlyTool/)
  assert.doesNotMatch(verification, /runTerminalTool|mcpWaitForTerminalIdle/)
})

test('delegated command risk reaches only the lower safety transaction', () => {
  const source = fs.readFileSync(path.join(aiRoot, 'agent-tools.js'), 'utf8')
  const terminalSource = fs.readFileSync(path.join(aiRoot, 'agent-terminal-command.js'), 'utf8')
  const preparation = source.match(
    /async function prepareResolvedAgentTool[\s\S]*?\n}/
  )?.[0] || ''

  assert.match(preparation, /shouldDelegateAgentSafetyConfirmation/)
  assert.match(preparation, /createDelegatedAgentSafetyPreparation/)
  assert.equal((terminalSource.match(/\.runSafetyCommand\(/g) || []).length, 1)
})
