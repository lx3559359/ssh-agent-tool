const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-task-recovery.js'
))

function endpoint (overrides = {}) {
  return {
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    tabId: 'tab-1',
    pid: 1001,
    terminalPid: 2001,
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:prod',
    ...overrides
  }
}

function task (overrides = {}) {
  return {
    id: 'task-1',
    source: 'server-status',
    kind: 'diagnostic',
    status: 'completed',
    endpoint: endpoint(),
    metadata: { diagnosticKey: 'diagnostic-key' },
    createdAt: '2026-08-03T01:00:00.000Z',
    updatedAt: '2026-08-03T01:00:00.000Z',
    steps: [],
    ...overrides
  }
}

function storeWith (tasks = []) {
  return {
    async listTasks () {
      return structuredClone(tasks)
    },
    async getTask (id) {
      return structuredClone(tasks.find(item => item.id === id) || null)
    }
  }
}

test('diagnostic key uses request id kind and normalized target name only', async () => {
  const { createAgentDiagnosticKey } = await import(moduleUrl)
  const left = createAgentDiagnosticKey({
    requestId: ' request-1 ',
    type: 'SERVICE',
    data: { name: '  Nginx   API ' },
    endpointFingerprint: 'must-not-be-used'
  })
  const right = createAgentDiagnosticKey({
    requestId: 'request-1',
    kind: 'service',
    item: { name: 'nginx api' },
    endpointFingerprint: 'different-observation-id'
  })

  assert.equal(left, right)
  assert.notEqual(left, createAgentDiagnosticKey({
    requestId: 'request-2',
    kind: 'service',
    data: { name: 'nginx api' }
  }))
  assert.doesNotMatch(left, /must-not-be-used|different-observation-id/)
})

test('diagnostic key accepts the closed-runner null target', async () => {
  const { createAgentDiagnosticKey } = await import(moduleUrl)

  assert.equal(createAgentDiagnosticKey(null), createAgentDiagnosticKey())
})

test('live matching diagnostic registry task wins over persisted history', async () => {
  const { restoreAgentDiagnosticTask } = await import(moduleUrl)
  const live = task({ id: 'live-task', status: 'running-readonly' })
  const persisted = task({
    id: 'newer-completed',
    updatedAt: '2026-08-03T02:00:00.000Z'
  })
  const registry = {
    list: () => [{
      taskId: live.id,
      kind: 'diagnostic',
      scopeId: 'tab-1',
      endpoint: endpoint(),
      diagnosticKey: 'diagnostic-key'
    }]
  }

  const restored = await restoreAgentDiagnosticTask({
    registry,
    store: storeWith([live, persisted]),
    scopeId: 'tab-1',
    endpoint: endpoint(),
    diagnosticKey: 'diagnostic-key'
  })

  assert.equal(restored.live, true)
  assert.equal(restored.task.id, 'live-task')
})

test('persisted recovery returns the newest exact matching completed or orphan task', async () => {
  const { restoreAgentDiagnosticTask } = await import(moduleUrl)
  const oldCompleted = task({ id: 'old-completed' })
  const recoveredOrphan = task({
    id: 'recovered-orphan',
    status: 'failed',
    error: 'executor unavailable after restart',
    updatedAt: '2026-08-03T03:00:00.000Z'
  })

  const restored = await restoreAgentDiagnosticTask({
    registry: { list: () => [] },
    store: storeWith([recoveredOrphan, oldCompleted]),
    scopeId: 'tab-1',
    endpoint: endpoint(),
    diagnosticKey: 'diagnostic-key'
  })

  assert.equal(restored.live, false)
  assert.equal(restored.task.id, 'recovered-orphan')
  assert.match(restored.task.error, /restart/)
})

test('recovery never returns a cross-endpoint task even with matching opaque ids', async () => {
  const { restoreAgentDiagnosticTask } = await import(moduleUrl)
  const foreign = task({
    id: 'foreign-endpoint',
    endpoint: endpoint({ host: 'other.example.com', hostKeyFingerprint: 'SHA256:other' }),
    endpointFingerprint: 'endpoint-same',
    endpointKey: 'root@prod.example.com:22'
  })

  const restored = await restoreAgentDiagnosticTask({
    registry: { list: () => [] },
    store: storeWith([foreign]),
    scopeId: 'tab-1',
    endpoint: endpoint(),
    diagnosticKey: 'diagnostic-key'
  })

  assert.equal(restored, null)
})

test('recovery ignores different targets sources kinds and malformed legacy metadata', async () => {
  const { restoreAgentDiagnosticTask } = await import(moduleUrl)
  const records = [
    task({ id: 'different-target', metadata: { diagnosticKey: 'other-key' } }),
    task({ id: 'different-source', source: 'agent' }),
    task({ id: 'different-kind', kind: 'chat-agent' }),
    task({ id: 'malformed-metadata', metadata: 'legacy' })
  ]

  const restored = await restoreAgentDiagnosticTask({
    registry: { list: () => [] },
    store: storeWith(records),
    scopeId: 'tab-1',
    endpoint: endpoint(),
    diagnosticKey: 'diagnostic-key'
  })

  assert.equal(restored, null)
})

test('recovery handles an empty or unavailable task store', async () => {
  const { restoreAgentDiagnosticTask } = await import(moduleUrl)
  const options = {
    registry: { list: () => [] },
    scopeId: 'tab-1',
    endpoint: endpoint(),
    diagnosticKey: 'diagnostic-key'
  }

  assert.equal(await restoreAgentDiagnosticTask({
    ...options,
    store: storeWith([])
  }), null)
  assert.equal(await restoreAgentDiagnosticTask({
    ...options,
    store: null
  }), null)
})
