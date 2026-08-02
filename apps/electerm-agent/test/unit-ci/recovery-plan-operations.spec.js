const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const modulePath = path.resolve(
  __dirname,
  '../../src/client/common/recovery/recovery-plan-operations.js'
)

async function loadModule () {
  assert.equal(
    fs.existsSync(modulePath),
    true,
    'recovery plan operations must be implemented as a behavior-testable module'
  )
  const url = pathToFileURL(modulePath)
  url.search = `test=${Date.now()}-${Math.random()}`
  return import(url)
}

test('recovery plan load returns the validated plan without a failure event', async () => {
  const { loadRecoveryPlanOperation } = await loadModule()
  const events = []
  const rawPlan = { abnormalExit: true, id: 'raw-plan' }
  const validatedPlan = { abnormalExit: true, id: 'validated-plan' }

  const result = await loadRecoveryPlanOperation({
    loadPlan: async () => rawPlan,
    buildPlan: value => {
      assert.strictEqual(value, rawPlan)
      return validatedPlan
    },
    recordEvent: event => events.push(event)
  })

  assert.strictEqual(result.plan, validatedPlan)
  assert.equal(result.error, null)
  assert.deepEqual(events, [])
})

test('recovery plan load degrades safely and records only a stable event', async () => {
  const { loadRecoveryPlanOperation } = await loadModule()
  const events = []
  const error = new Error('C:\\Users\\demo\\private token=sk-secret-value')

  const result = await loadRecoveryPlanOperation({
    loadPlan: async () => { throw error },
    buildPlan: value => value,
    recordEvent: event => events.push(event)
  })

  assert.equal(result.plan, null)
  assert.strictEqual(result.error, error)
  assert.deepEqual(events, [{
    module: 'recovery',
    action: 'load-plan',
    phase: 'failed',
    result: 'ignored',
    messageCode: 'recovery-plan-load-failed'
  }])
  assert.doesNotMatch(JSON.stringify(events), /demo|private|sk-secret-value|token/i)
})

test('recovery plan dismissal clears local state only after acknowledgement', async () => {
  const { dismissRecoveryPlanOperation } = await loadModule()
  const events = []
  let recoveryPlan = { abnormalExit: true }

  const result = await dismissRecoveryPlanOperation({
    dismissPlan: async () => true,
    clearPlan: () => { recoveryPlan = null },
    recordEvent: event => events.push(event)
  })

  assert.equal(result.dismissed, true)
  assert.equal(result.error, null)
  assert.equal(recoveryPlan, null)
  assert.deepEqual(events, [])
})

test('unacknowledged recovery dismissal keeps local state and records failure', async () => {
  const { dismissRecoveryPlanOperation } = await loadModule()
  const events = []
  const recoveryPlan = { abnormalExit: true }
  let currentPlan = recoveryPlan

  const result = await dismissRecoveryPlanOperation({
    dismissPlan: async () => false,
    clearPlan: () => { currentPlan = null },
    recordEvent: event => events.push(event)
  })

  assert.equal(result.dismissed, false)
  assert.equal(result.error.code, 'RECOVERY_PLAN_DISMISS_NOT_ACKNOWLEDGED')
  assert.strictEqual(currentPlan, recoveryPlan)
  assert.deepEqual(events, [{
    module: 'recovery',
    action: 'dismiss-plan',
    phase: 'failed',
    result: 'retained',
    messageCode: 'recovery-plan-dismiss-failed'
  }])
})

test('rejected recovery dismissal returns the original error and keeps local state', async () => {
  const { dismissRecoveryPlanOperation } = await loadModule()
  const error = new Error('IPC transport failed')
  let cleared = false

  const result = await dismissRecoveryPlanOperation({
    dismissPlan: async () => { throw error },
    clearPlan: () => { cleared = true },
    recordEvent: async () => { throw new Error('optional diagnostics unavailable') }
  })

  assert.equal(result.dismissed, false)
  assert.strictEqual(result.error, error)
  assert.equal(cleared, false)
})
