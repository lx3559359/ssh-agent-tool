const test = require('node:test')
const assert = require('node:assert/strict')
const {
  INCIDENT_STATES,
  createIncidentRecord,
  createIncidentPatch,
  createIncidentCandidate,
  createIncidentTimelineEvent,
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

test('normalizes candidate evidence and rejects sensitive automatic context', () => {
  const candidate = createIncidentCandidate({
    fingerprint: 'fleet:server-1:nginx:failed',
    source: 'fleet-status',
    sourceRef: 'server-1:nginx',
    endpointRef: 'server-1',
    title: 'Nginx 服务异常',
    severity: 'high',
    summary: '服务状态为 failed',
    evidence: {
      service: 'nginx',
      state: 'failed',
      recentLines: ['upstream timed out']
    }
  }, { id: 'candidate-1', now: 2000 })

  assert.equal(candidate.status, 'pending')
  assert.equal(candidate.occurrenceCount, 1)
  assert.deepEqual(candidate.evidence.recentLines, ['upstream timed out'])
  assert.throws(
    () => createIncidentCandidate({
      fingerprint: 'unsafe',
      source: 'operations',
      title: 'Unsafe evidence',
      evidence: { authorization: 'Bearer secret' }
    }, { id: 'candidate-2', now: 2000 }),
    error => error.code === 'INCIDENT_SENSITIVE_FIELD'
  )
})

test('normalizes idempotent incident timeline events', () => {
  const event = createIncidentTimelineEvent({
    kind: 'diagnostic',
    source: 'operations',
    sourceRef: 'task-1',
    title: '端口诊断失败',
    body: '连接任务返回超时。',
    metadata: {
      taskStatus: 'timed-out',
      exitCode: 124
    }
  }, {
    id: 'event-1',
    incidentId: 'incident-1',
    now: 3000
  })

  assert.equal(event.incidentId, 'incident-1')
  assert.equal(event.kind, 'diagnostic')
  assert.equal(event.metadata.exitCode, 124)
  assert.throws(
    () => createIncidentTimelineEvent({
      kind: 'diagnostic',
      source: 'operations',
      sourceRef: 'task-2',
      title: 'Unsafe timeline',
      metadata: { apiKey: 'secret' }
    }, {
      id: 'event-2',
      incidentId: 'incident-1',
      now: 3000
    }),
    error => error.code === 'INCIDENT_SENSITIVE_FIELD'
  )
})
