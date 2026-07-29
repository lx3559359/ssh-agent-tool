const test = require('node:test')
const assert = require('node:assert/strict')
const {
  INCIDENT_STATES,
  createIncidentRecord,
  createIncidentPatch,
  validateTransition
} = require('../../src/app/lib/incidents/incident-model')

test('creates a bounded incident without copying credentials', () => {
  const record = createIncidentRecord({
    title: 'Nginx 502',
    endpointRef: 'bookmark-1',
    serviceTags: ['nginx', 'nginx'],
    customTags: ['production'],
    summary: 'Upstream unavailable'
  }, { id: 'incident-1', now: 1000 })

  assert.equal(record.id, 'incident-1')
  assert.equal(record.state, INCIDENT_STATES.investigating)
  assert.deepEqual(record.serviceTags, ['nginx'])
  assert.equal(record.storagePolicy, 'standard')
})

test('rejects sensitive and unknown mutation fields', () => {
  assert.throws(
    () => createIncidentRecord({
      title: 'Unsafe',
      password: 'secret'
    }, { id: 'incident-2', now: 1000 }),
    error => error.code === 'INCIDENT_SENSITIVE_FIELD'
  )
  assert.throws(
    () => createIncidentRecord({
      title: 'Nested unsafe value',
      sessionRefs: [{ api_key: 'secret' }]
    }, { id: 'incident-4', now: 1000 }),
    error => error.code === 'INCIDENT_SENSITIVE_FIELD'
  )
  assert.throws(
    () => createIncidentPatch({ archivedAt: 10 }),
    error => error.code === 'INCIDENT_FIELD_READONLY'
  )
  assert.throws(
    () => createIncidentRecord({
      title: 'Unknown field',
      arbitraryField: true
    }, { id: 'incident-3', now: 1000 }),
    error => error.code === 'INCIDENT_FIELD_READONLY'
  )
})

test('requires verification before resolved and records legal reopen', () => {
  assert.throws(
    () => validateTransition('verifying', {
      state: 'resolved',
      verificationStatus: 'pending'
    }),
    error => error.code === 'INCIDENT_VERIFICATION_REQUIRED'
  )
  assert.deepEqual(
    validateTransition('archived', {
      state: 'investigating',
      verificationStatus: 'pending'
    }),
    {
      state: 'investigating',
      verificationStatus: 'pending'
    }
  )
  assert.deepEqual(
    validateTransition(
      'resolved',
      { state: 'archived' },
      'passed_manual'
    ),
    {
      state: 'archived',
      verificationStatus: 'passed_manual'
    }
  )
})
