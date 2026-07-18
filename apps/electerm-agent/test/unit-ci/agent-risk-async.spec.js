const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-risk-async.js'
)).href

test('batch verification waits until every confirmed call reaches its real terminal state', async () => {
  const { completeAgentRiskPreparation } = await import(moduleUrl)
  const settlements = []
  let verifications = 0
  const batch = {
    transaction: { calls: [{ name: 'first' }, { name: 'second' }] },
    cursor: 2,
    completedCalls: new Set(),
    terminal: false
  }
  const common = {
    verify: async () => {
      verifications += 1
      return { passed: true, count: 1, status: 'verified' }
    },
    settle: async value => settlements.push(value)
  }

  const first = await completeAgentRiskPreparation({
    preparation: { riskTaskId: 'risk-batch', riskBatch: batch, riskCallIndex: 0 },
    ...common
  })
  assert.equal(first.pending, true)
  assert.equal(verifications, 0)
  assert.deepEqual(settlements, [])

  const second = await completeAgentRiskPreparation({
    preparation: { riskTaskId: 'risk-batch', riskBatch: batch, riskCallIndex: 1 },
    ...common
  })
  assert.equal(second.passed, true)
  assert.equal(verifications, 1)
  assert.deepEqual(settlements, [{
    taskId: 'risk-batch',
    status: 'completed',
    remoteState: 'verified',
    canAutoRetry: false
  }])
})

test('zero checked verification steps never settle remote state as verified', async () => {
  const { completeAgentRiskPreparation } = await import(moduleUrl)
  for (const [verification, expectedRemoteState] of [
    [{ passed: true, count: 0, status: 'not-applicable' }, 'not-applicable'],
    [undefined, 'unverified'],
    [{ passed: true, count: 0 }, 'unverified']
  ]) {
    const settlements = []
    const result = await completeAgentRiskPreparation({
      preparation: { riskTaskId: `risk-${expectedRemoteState}` },
      verify: async () => verification,
      settle: async value => settlements.push(value)
    })
    assert.equal(result.passed, true)
    assert.equal(settlements.length, 1)
    assert.equal(settlements[0].status, 'completed')
    assert.equal(settlements[0].remoteState, expectedRemoteState)
    assert.notEqual(settlements[0].remoteState, 'verified')
  }

  const verified = []
  await completeAgentRiskPreparation({
    preparation: { riskTaskId: 'risk-verified' },
    verify: async () => ({ passed: true, count: 1, status: 'verified' }),
    settle: async value => verified.push(value)
  })
  assert.equal(verified[0].remoteState, 'verified')
})

test('async terminal handlers settle once and preserve failed or unknown terminal truth', async () => {
  const { createAgentRiskTerminalHandler } = await import(moduleUrl)
  const settlements = []
  let verifications = 0
  const preparation = { riskTaskId: 'risk-async' }
  const handler = createAgentRiskTerminalHandler({
    preparation,
    verify: async () => { verifications += 1 },
    settle: async value => settlements.push(value)
  })

  await handler({ status: 'failed', error: 'transfer failed' })
  await handler({ status: 'completed' })
  assert.equal(verifications, 0)
  assert.equal(settlements.length, 1)
  assert.equal(settlements[0].status, 'partially-completed')
  assert.equal(settlements[0].remoteState, 'known-failed')
})

test('a confirmed batch can be failed before dispatch without remaining stuck running', async () => {
  const { failAgentRiskPreparation } = await import(moduleUrl)
  const settlements = []
  const batch = {
    transaction: { calls: [{ name: 'sftp_upload' }] },
    cursor: 0,
    completedCalls: new Set(),
    terminal: false
  }
  await failAgentRiskPreparation({
    preparation: { riskTaskId: 'risk-before-dispatch', riskBatch: batch },
    error: new Error('takeover disabled'),
    dispatched: false,
    settle: async value => settlements.push(value)
  })
  assert.equal(batch.terminal, true)
  assert.equal(settlements[0].status, 'failed')
  assert.equal(settlements[0].remoteState, 'not-dispatched')
})

test('delegated lower confirmations still run declared target verification once', async () => {
  const {
    completeAgentRiskPreparation,
    createAgentRiskTerminalHandler
  } = await import(moduleUrl)
  let verifications = 0
  const verify = async () => {
    verifications += 1
    return { passed: true }
  }

  assert.deepEqual(await completeAgentRiskPreparation({
    preparation: {
      delegatedSafetyConfirmation: true,
      confirmedArgs: { remotePath: '/srv/app/cache' }
    },
    verify
  }), {
    passed: true,
    verification: { passed: true }
  })

  const handler = createAgentRiskTerminalHandler({
    preparation: {
      delegatedSafetyConfirmation: true,
      confirmedArgs: {
        command: '/usr/bin/systemctl start nginx.service'
      }
    },
    verify
  })
  await Promise.all([
    handler({ status: 'completed' }),
    handler({ status: 'completed' })
  ])
  assert.equal(verifications, 2)
})
