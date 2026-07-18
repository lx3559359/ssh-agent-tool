const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const stateUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-takeover-state.js'
)).href

test('declares the complete immutable takeover state set', async () => {
  const { TAKEOVER_STATES } = await import(stateUrl)
  assert.deepEqual(TAKEOVER_STATES, [
    'off',
    'enabling',
    'active-idle',
    'running-readonly',
    'awaiting-risk-confirmation',
    'running-confirmed-change',
    'verifying',
    'stopping',
    'failed',
    'partially-completed'
  ])
  assert.equal(Object.isFrozen(TAKEOVER_STATES), true)
})

test('allows only declared takeover transitions', async () => {
  const { canTransition } = await import(stateUrl)
  assert.equal(canTransition('off', 'enabling'), true)
  assert.equal(canTransition('enabling', 'active-idle'), true)
  assert.equal(canTransition('active-idle', 'running-readonly'), true)
  assert.equal(canTransition('active-idle', 'awaiting-risk-confirmation'), true)
  assert.equal(canTransition('running-readonly', 'running-confirmed-change'), false)
  assert.equal(canTransition('awaiting-risk-confirmation', 'running-confirmed-change'), true)
  assert.equal(canTransition('running-confirmed-change', 'verifying'), true)
  assert.equal(canTransition('verifying', 'active-idle'), true)
  assert.equal(canTransition('off', 'running-readonly'), false)
  assert.equal(canTransition('missing', 'off'), false)
})

test('all active states can stop and execution outcomes can recover', async () => {
  const {
    ACTIVE_TAKEOVER_STATES,
    EXECUTING_TAKEOVER_STATES,
    canTransition
  } = await import(stateUrl)

  for (const state of ACTIVE_TAKEOVER_STATES) {
    assert.equal(canTransition(state, 'stopping'), true, state)
  }
  assert.equal(canTransition('stopping', 'off'), true)

  for (const state of EXECUTING_TAKEOVER_STATES) {
    assert.equal(canTransition(state, 'failed'), true, `${state} -> failed`)
    assert.equal(
      canTransition(state, 'partially-completed'),
      true,
      `${state} -> partially-completed`
    )
  }
  assert.equal(canTransition('failed', 'active-idle'), true)
  assert.equal(canTransition('partially-completed', 'active-idle'), true)
})

test('transition assertion reports stable error codes', async () => {
  const { assertTakeoverTransition } = await import(stateUrl)
  assert.throws(
    () => assertTakeoverTransition('off', 'running-readonly'),
    error => error.code === 'INVALID_TAKEOVER_TRANSITION'
  )
  assert.throws(
    () => assertTakeoverTransition('unknown', 'off'),
    error => error.code === 'INVALID_TAKEOVER_STATE'
  )
})
