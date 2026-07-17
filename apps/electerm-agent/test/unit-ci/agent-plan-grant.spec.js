const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-plan-grant.js'
)).href

function plan () {
  return {
    schemaVersion: 1,
    endpoint: {
      host: 'srv.test',
      port: 22,
      username: 'ops',
      tabId: 'tab-a',
      pid: 'pid-a',
      terminalPid: 'term-a',
      sessionType: 'ssh',
      hostKeyFingerprint: 'SHA256:abc'
    },
    goal: 'restart nginx safely',
    orderedCalls: [{
      name: 'send_terminal_command',
      args: { command: 'systemctl restart nginx' }
    }],
    skillBindings: [{ id: 'skill-a', version: '1.0.0', digest: 'sha256:skill' }],
    artifactDigests: [{ id: 'script-a', digest: 'sha256:script' }],
    impactTargets: ['service:nginx'],
    resourceImpact: {
      cpu: 'low',
      memory: 'low',
      disk: 'low',
      network: 'low',
      duration: 'short'
    },
    recovery: { type: 'service-state', verified: true },
    verification: [{
      name: 'read_service_status',
      args: { service: 'nginx' }
    }]
  }
}

test('plan grants are deterministic immutable SHA-256 snapshots', async () => {
  const {
    createPlanGrant,
    createPlanPayload,
    verifyPlanGrant
  } = await import(moduleUrl)
  const first = await createPlanGrant(plan(), {
    confirmedBy: 'user',
    now: () => new Date('2026-07-17T00:00:00.000Z')
  })
  const reordered = {
    verification: plan().verification,
    recovery: plan().recovery,
    resourceImpact: plan().resourceImpact,
    impactTargets: plan().impactTargets,
    artifactDigests: plan().artifactDigests,
    skillBindings: plan().skillBindings,
    orderedCalls: plan().orderedCalls,
    goal: plan().goal,
    endpoint: plan().endpoint,
    schemaVersion: 1
  }
  const second = await createPlanGrant(reordered, {
    confirmedBy: 'user',
    now: () => new Date('2026-07-17T00:00:01.000Z')
  })

  assert.match(first.digest, /^[a-f0-9]{64}$/)
  assert.equal(first.algorithm, 'SHA-256')
  assert.equal(first.digest, second.digest)
  assert.equal(await verifyPlanGrant(plan(), first), true)
  assert.deepEqual(Object.keys(first.payload), Object.keys(createPlanPayload(plan())))
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first.payload.orderedCalls[0].args), true)
})

test('invalidates a grant when any bound field changes', async () => {
  const { createPlanGrant, verifyPlanGrant } = await import(moduleUrl)
  const original = plan()
  const grant = await createPlanGrant(original, { confirmedBy: 'user' })
  const mutations = [
    value => ({ ...value, endpoint: { ...value.endpoint, hostKeyFingerprint: 'SHA256:changed' } }),
    value => ({ ...value, goal: 'changed' }),
    value => ({ ...value, orderedCalls: [] }),
    value => ({ ...value, orderedCalls: [{ ...value.orderedCalls[0], args: { command: 'systemctl stop nginx' } }] }),
    value => ({ ...value, skillBindings: [{ ...value.skillBindings[0], version: '2.0.0' }] }),
    value => ({ ...value, skillBindings: [{ ...value.skillBindings[0], digest: 'sha256:other-skill' }] }),
    value => ({ ...value, artifactDigests: [{ ...value.artifactDigests[0], digest: 'sha256:other-script' }] }),
    value => ({ ...value, impactTargets: ['service:apache'] }),
    value => ({ ...value, resourceImpact: { ...value.resourceImpact, duration: 'unknown' } }),
    value => ({ ...value, recovery: { ...value.recovery, verified: false } }),
    value => ({ ...value, verification: [] })
  ]

  for (const mutate of mutations) {
    assert.equal(await verifyPlanGrant(mutate(original), grant), false)
  }
})

test('payload contains exactly the authorized fields and rejects non-JSON values', async () => {
  const { createPlanPayload } = await import(moduleUrl)
  const payload = createPlanPayload({ ...plan(), ignoredAuthority: 'model-says-safe' })
  assert.deepEqual(Object.keys(payload), [
    'schemaVersion',
    'endpoint',
    'goal',
    'orderedCalls',
    'skillBindings',
    'artifactDigests',
    'impactTargets',
    'resourceImpact',
    'recovery',
    'verification'
  ])
  assert.equal(Object.hasOwn(payload, 'ignoredAuthority'), false)
  assert.throws(
    () => createPlanPayload({
      ...plan(),
      recovery: { value: undefined }
    }),
    error => error.code === 'AGENT_PLAN_INVALID'
  )
})
