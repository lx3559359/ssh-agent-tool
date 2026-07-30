const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function loadModule () {
  const source = path.resolve(
    __dirname,
    '../../src/client/components/incidents/incident-capture.js'
  )
  return import(`${pathToFileURL(source).href}?test=${Date.now()}`)
}

test('turns abnormal fleet services into stable candidate drafts', async () => {
  const { createFleetIncidentCandidates } = await loadModule()
  const candidates = createFleetIncidentCandidates({
    rows: [{
      id: 'bookmark-1',
      name: '生产 Web',
      host: '10.0.0.8',
      port: 22,
      overallStatus: 'warning',
      snapshot: {
        services: [
          { name: 'nginx', state: 'failed' },
          { name: 'sshd', state: 'active' }
        ]
      }
    }]
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].source, 'fleet-status')
  assert.equal(candidates[0].endpointRef, 'bookmark-1')
  assert.equal(candidates[0].evidence.service, 'nginx')
  assert.equal(candidates[0].evidence.state, 'failed')
  assert.equal(
    candidates[0].fingerprint,
    createFleetIncidentCandidates({
      rows: [{
        id: 'bookmark-1',
        name: '生产 Web',
        host: '10.0.0.8',
        snapshot: { services: [{ name: 'nginx', state: 'failed' }] }
      }]
    })[0].fingerprint
  )
})

test('creates candidates only for abnormal final operation tasks', async () => {
  const { createOperationsIncidentCandidate } = await loadModule()
  assert.equal(createOperationsIncidentCandidate({
    id: 'task-ok',
    status: 'completed'
  }), null)

  const candidate = createOperationsIncidentCandidate({
    id: 'task-timeout',
    toolId: 'network.tcp-connections',
    title: 'TCP 连接检查',
    status: 'timed-out',
    endpoint: {
      host: '10.0.0.8',
      port: 22,
      username: 'root',
      tabId: 'tab-1'
    },
    steps: [{
      id: 'connections',
      status: 'failed',
      output: 'timed out'
    }],
    error: 'timeout'
  })

  assert.equal(candidate.source, 'operations')
  assert.equal(candidate.sourceRef, 'task-timeout')
  assert.equal(candidate.severity, 'high')
  assert.equal(candidate.evidence.steps[0].output, 'timed out')
})

test('redacts credentials from automatically captured task evidence', async () => {
  const {
    createOperationsIncidentCandidate,
    createSafetyOperationIncidentCandidate
  } = await loadModule()
  const operationCandidate = createOperationsIncidentCandidate({
    id: 'task-secret',
    title: '接口检查',
    status: 'failed',
    error: 'Authorization: Bearer secret-token-value',
    steps: [{
      id: 'request',
      status: 'failed',
      output: 'API_KEY=secret-value'
    }]
  })
  const safetyCandidate = createSafetyOperationIncidentCandidate({
    id: 'operation-secret',
    title: '更新配置',
    state: 'failed',
    error: 'password=plain-text-password'
  })

  assert.doesNotMatch(JSON.stringify(operationCandidate), /secret-token-value/)
  assert.doesNotMatch(JSON.stringify(operationCandidate), /secret-value/)
  assert.doesNotMatch(JSON.stringify(safetyCandidate), /plain-text-password/)
})

test('builds bounded incident timeline events from completed tasks', async () => {
  const { createOperationsTimelineEvent } = await loadModule()
  const event = createOperationsTimelineEvent({
    id: 'task-1',
    toolId: 'service.inventory-health',
    title: '服务状态',
    status: 'completed',
    endpoint: { host: '10.0.0.8', port: 22, username: 'root' },
    steps: Array.from({ length: 20 }, (_, index) => ({
      id: `step-${index}`,
      status: 'completed',
      output: 'x'.repeat(5000)
    }))
  })

  assert.equal(event.kind, 'diagnostic')
  assert.equal(event.sourceRef, 'task-1')
  assert.ok(JSON.stringify(event.metadata).length < 64000)
})

test('records completed AI diagnostics without creating noisy candidates', async () => {
  const {
    createAgentTaskIncidentCandidate,
    createAgentTaskTimelineEvent
  } = await loadModule()
  const task = {
    id: 'agent-task-1',
    summary: 'Nginx 异常只读诊断',
    source: 'server-status',
    status: 'completed',
    endpoint: {
      tabId: 'tab-1',
      host: '10.0.0.8',
      port: 22,
      username: 'root'
    },
    target: {
      type: 'service',
      name: 'nginx.service',
      status: 'failed'
    },
    steps: [{
      id: 'status',
      title: '服务状态',
      status: 'completed',
      output: 'inactive (dead)'
    }]
  }

  assert.equal(createAgentTaskIncidentCandidate(task), null)
  const event = createAgentTaskTimelineEvent(task)
  assert.equal(event.kind, 'diagnostic')
  assert.equal(event.source, 'ai-diagnostic')
  assert.equal(event.sourceRef, 'agent-task-1')
  assert.equal(event.metadata.endpointRef, 'tab-1')
  assert.equal(event.metadata.target.name, 'nginx.service')
  assert.equal(createAgentTaskTimelineEvent({
    ...task,
    status: 'running-readonly'
  }), null)
})

test('turns failed or partially completed AI diagnostics into candidates', async () => {
  const { createAgentTaskIncidentCandidate } = await loadModule()
  const candidate = createAgentTaskIncidentCandidate({
    id: 'agent-task-failed',
    purpose: '检查数据库连接',
    status: 'partially-completed',
    error: 'journalctl timed out',
    endpoint: {
      bookmarkId: 'bookmark-db',
      host: '10.0.0.9',
      port: 22,
      username: 'root'
    },
    steps: Array.from({ length: 20 }, (_, index) => ({
      id: `step-${index}`,
      status: index ? 'pending' : 'failed',
      output: 'x'.repeat(5000)
    }))
  })

  assert.equal(candidate.source, 'ai-diagnostic')
  assert.equal(candidate.endpointRef, 'bookmark-db')
  assert.equal(candidate.severity, 'medium')
  assert.equal(candidate.evidence.status, 'partially-completed')
  assert.ok(JSON.stringify(candidate.evidence).length < 64000)
})

test('recognizes fleet service status aliases from different collectors', async () => {
  const { createFleetIncidentCandidates } = await loadModule()
  const candidates = createFleetIncidentCandidates({
    rows: [{
      id: 'bookmark-aliases',
      snapshot: {
        services: [
          { name: 'nginx', activeState: 'failed' },
          { name: 'docker', status: 'inactive' },
          { name: 'sshd', health: 'healthy' }
        ]
      }
    }]
  })

  assert.deepEqual(
    candidates.map(candidate => candidate.evidence.service),
    ['nginx', 'docker']
  )
  assert.deepEqual(
    candidates.map(candidate => candidate.evidence.state),
    ['failed', 'inactive']
  )
})

test('turns fleet connection failures into pending candidates', async () => {
  const { createFleetIncidentCandidates } = await loadModule()
  const candidates = createFleetIncidentCandidates({
    rows: [{
      id: 'bookmark-offline',
      name: '数据库服务器',
      host: '10.0.0.9',
      port: 2222,
      overallStatus: 'offline',
      snapshot: {
        connection: {
          status: 'timeout',
          latencyMs: null,
          error: 'connect timeout'
        },
        services: []
      }
    }]
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].source, 'fleet-status')
  assert.equal(candidates[0].endpointRef, 'bookmark-offline')
  assert.equal(candidates[0].severity, 'high')
  assert.equal(candidates[0].evidence.kind, 'connection')
  assert.equal(candidates[0].evidence.status, 'timeout')
})

test('turns explicit fleet resource warnings into separate candidates', async () => {
  const { createFleetIncidentCandidates } = await loadModule()
  const candidates = createFleetIncidentCandidates({
    rows: [{
      id: 'bookmark-resource',
      name: '应用服务器',
      host: '10.0.0.10',
      overallStatus: 'warning',
      snapshot: {
        connection: { status: 'connected', latencyMs: 12 },
        resources: {
          cpu: { usedPercent: 94, status: 'critical' },
          memory: { usedPercent: 82, status: 'warning' },
          disk: { usedPercent: 55, status: 'healthy' }
        },
        services: []
      }
    }]
  })

  assert.deepEqual(
    candidates.map(candidate => candidate.evidence.resource),
    ['cpu', 'memory']
  )
  assert.deepEqual(
    candidates.map(candidate => candidate.severity),
    ['critical', 'medium']
  )
  assert.equal(candidates[0].evidence.usedPercent, 94)
})

test('maps safety operation states to incident timeline events and candidates', async () => {
  const {
    createSafetyOperationIncidentCandidate,
    createSafetyOperationTimelineEvent
  } = await loadModule()
  const base = {
    id: 'safe-op-1',
    title: '更新 Nginx 配置',
    source: 'agent',
    risk: 'change',
    reversible: true,
    recoveryProvider: 'file',
    endpoint: {
      tabId: 'tab-1',
      host: '10.0.0.8',
      port: 22,
      username: 'root'
    },
    artifacts: {
      backup: { path: '/tmp/shellpilot-backup/nginx.conf' }
    }
  }

  assert.equal(
    createSafetyOperationTimelineEvent({
      ...base,
      state: 'recovery-ready'
    }).kind,
    'backup'
  )
  assert.equal(
    createSafetyOperationTimelineEvent({
      ...base,
      state: 'verification-passed'
    }).kind,
    'verification'
  )
  assert.equal(
    createSafetyOperationTimelineEvent({
      ...base,
      state: 'restored'
    }).kind,
    'rollback'
  )
  assert.equal(
    createSafetyOperationIncidentCandidate({
      ...base,
      state: 'verification-passed'
    }),
    null
  )

  const candidate = createSafetyOperationIncidentCandidate({
    ...base,
    state: 'failed',
    error: 'verification failed'
  })
  assert.equal(candidate.source, 'safety-operation')
  assert.equal(candidate.endpointRef, 'tab-1')
  assert.equal(candidate.severity, 'high')
  assert.equal(candidate.evidence.reversible, true)
})

test('builds an incident review artifact draft from the formal archive', async () => {
  const { createIncidentReviewArtifactDraft } = await loadModule()
  const draft = createIncidentReviewArtifactDraft({
    id: 'incident-1',
    title: '生产 Nginx 访问异常',
    endpointRef: 'bookmark-1',
    severity: 'high',
    state: 'resolved',
    summary: '访问间歇失败。',
    rootCause: '上游连接池耗尽。',
    resolution: '调整连接池并验证。',
    verificationStatus: 'passed_manual',
    timelineEvents: [{
      id: 'event-1',
      title: '检查服务状态',
      body: 'Nginx 正常，后端连接异常。',
      createdAt: Date.parse('2026-07-30T10:00:00.000Z')
    }]
  })

  assert.equal(draft.schemaVersion, 1)
  assert.equal(draft.type, 'incident-review')
  assert.equal(draft.server, 'bookmark-1')
  assert.match(draft.summary, /访问间歇失败/)
  assert.ok(draft.sections.some(section => section.title === '事件时间线'))
  assert.ok(draft.tables.some(table => table.title === '关键状态'))
})
