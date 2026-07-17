const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const storeUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/transaction-store.js'
)).href
const redactionUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/audit-redaction.js'
)).href
const riskTransactionUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-risk-transaction.js'
)).href

function clone (value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

function memoryAdapter () {
  const tables = new Map()
  const table = name => {
    if (!tables.has(name)) tables.set(name, new Map())
    return tables.get(name)
  }
  return {
    tables,
    async update (id, value, name) { table(name).set(id, clone(value)) },
    async findOne (name, id) { return clone(table(name).get(id)) },
    async find (name) { return [...table(name).values()].map(clone) },
    async remove (name, id) { table(name).delete(id) },
    async getData () { return null }
  }
}

test('audit redaction covers commands, observations, errors, cookies, and Skill file text', async () => {
  const { redactSensitiveData } = await import(redactionUrl)
  const secrets = [
    'command-password-123',
    'bearer-token-456',
    'cookie-session-789',
    'skill-api-key-abc',
    'private-key-body-xyz'
  ]
  const input = {
    command: 'deploy --password command-password-123',
    observation: 'Authorization: Bearer bearer-token-456',
    error: 'Cookie: session=cookie-session-789; theme=dark',
    skillFiles: {
      'SKILL.md': 'API Key: skill-api-key-abc',
      'scripts/deploy.sh': [
        '-----BEGIN OPENSSH PRIVATE KEY-----',
        'private-key-body-xyz',
        '-----END OPENSSH PRIVATE KEY-----'
      ].join('\n')
    }
  }
  const safe = redactSensitiveData(input)
  const serialized = JSON.stringify(safe)

  assert.match(serialized, /\[REDACTED\]/)
  for (const secret of secrets) assert.doesNotMatch(serialized, new RegExp(secret))
})

test('artifact cleanup retains every reference from active, unknown, verification, partial, and recoverable records', async () => {
  const { createTransactionStore } = await import(storeUrl)
  const adapter = memoryAdapter()
  const now = new Date('2026-07-17T12:00:00.000Z')
  const store = createTransactionStore({ adapter, now: () => now })
  const expired = '2026-07-01T00:00:00.000Z'
  const artifactIds = [
    'recovery:running',
    'output:unknown',
    'script:verification',
    'output:partial',
    'recovery:rollback',
    'output:expired'
  ]
  for (const id of artifactIds) {
    await store.saveArtifact({
      id,
      kind: id.split(':')[0],
      summary: `artifact ${id}`,
      evidence: `bounded ${id}`,
      expiresAt: expired
    })
  }
  const baseTask = {
    createdAt: expired,
    updatedAt: expired,
    steps: []
  }
  await store.saveTask({ ...baseTask, id: 'running', status: 'running-change', artifactReferences: ['recovery:running'] })
  await store.saveTask({ ...baseTask, id: 'unknown', status: 'failed', remoteState: 'unknown', artifactReferences: ['output:unknown'] })
  await store.saveTask({ ...baseTask, id: 'verify', status: 'running-change', awaitingVerification: true, artifactReferences: ['script:verification'] })
  await store.saveTask({ ...baseTask, id: 'partial', status: 'partially-completed', artifactReferences: ['output:partial'] })
  await store.saveOperation({
    id: 'rollback',
    source: 'terminal',
    command: 'systemctl restart nginx',
    endpoint: { host: 'srv.test', username: 'ops', port: 22 },
    state: 'rollback-available',
    artifactReferences: ['recovery:rollback'],
    createdAt: expired,
    updatedAt: expired
  })

  const result = await store.cleanupArtifacts({ expiresBefore: now })
  assert.deepEqual(result.removed.map(item => item.id), ['output:expired'])
  assert.deepEqual(result.retained.map(item => item.id).sort(), artifactIds.slice(0, 5).sort())
  assert.equal(JSON.stringify(result).includes('\\'), false)
})

test('insufficient storage refuses a new recovery reservation before persistence and preserves existing evidence', async () => {
  const { createTransactionStore } = await import(storeUrl)
  const adapter = memoryAdapter()
  adapter.tables.set('agentArtifacts', new Map([[
    'recovery:existing',
    { id: 'recovery:existing', kind: 'recovery', evidence: 'keep me' }
  ]]))
  const store = createTransactionStore({
    adapter,
    getFreeBytes: async () => 1024,
    minimumFreeBytes: 4096,
    defaultRecoveryReservationBytes: 8192
  })

  await assert.rejects(store.saveOperation({
    id: 'low-disk-op',
    source: 'terminal',
    command: 'cp /etc/app.conf /etc/app.conf.new',
    endpoint: { host: 'srv.test', username: 'ops', port: 22 },
    risk: 'change',
    reversible: true,
    recoveryProvider: 'file'
  }), error => {
    assert.equal(error.code, 'AGENT_STORAGE_INSUFFICIENT')
    assert.match(error.message, /free space/i)
    return true
  })
  assert.equal(adapter.tables.get('safetyOperations')?.size || 0, 0)
  assert.equal(adapter.tables.get('agentArtifacts').get('recovery:existing').evidence, 'keep me')
})

test('risk settlement stores a redacted bounded evidence artifact and links it from the task', async () => {
  const { createTransactionStore } = await import(storeUrl)
  const { settleRiskTransactionTask } = await import(riskTransactionUrl)
  const adapter = memoryAdapter()
  const store = createTransactionStore({ adapter })
  await store.saveTask({
    id: 'agent-risk-evidence',
    status: 'running-change',
    steps: [],
    artifactReferences: []
  })
  await settleRiskTransactionTask({
    taskId: 'agent-risk-evidence',
    status: 'completed',
    remoteState: 'verified',
    evidence: 'service ok\nCookie: session=settlement-cookie-secret',
    store
  })

  const task = await store.getTask('agent-risk-evidence')
  assert.deepEqual(task.artifactReferences, ['agent-output:agent-risk-evidence'])
  const artifact = await store.getArtifact(task.artifactReferences[0])
  assert.match(artifact.evidence, /service ok/)
  assert.match(artifact.evidence, /\[REDACTED\]/)
  assert.doesNotMatch(JSON.stringify({ task, artifact }), /settlement-cookie-secret/)
})
