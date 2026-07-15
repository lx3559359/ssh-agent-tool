const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const domainRoot = path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions'
)
const bindingModuleUrl = pathToFileURL(path.join(
  domainRoot,
  'recovery-binding.js'
)).href
const centerModelUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/main/safety-operation-center-model.js'
)).href

function clone (value) {
  return structuredClone(value)
}

function recoveryOperation (id = 'binding-valid') {
  const artifacts = {
    manifest: `~/.shellpilot/operations/${id}/manifest.json`,
    state: `~/.shellpilot/operations/${id}/state.json`
  }
  const command = '/usr/bin/systemctl start nginx'
  return {
    schemaVersion: 1,
    id,
    source: 'terminal',
    command,
    state: 'rollback-available',
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      tabId: 'tab-1',
      pid: 1001,
      sessionType: 'ssh'
    },
    risk: 'change',
    reversible: true,
    recoveryProvider: 'systemd',
    plan: {
      provider: 'systemd',
      operationDir: `~/.shellpilot/operations/${id}/`,
      executeCommand: command,
      prepareCommandHash: 'a'.repeat(64),
      rollbackCommand: `rollback-${id}`,
      verifyCommand: `verify-${id}`,
      allowUnsafeExecute: true,
      artifacts: clone(artifacts)
    },
    artifacts,
    recoveryReadyAt: '2026-07-13T10:01:00.000Z',
    createdAt: '2026-07-13T10:00:00.000Z',
    updatedAt: '2026-07-13T10:01:00.000Z'
  }
}

async function boundRecoveryOperation (id = 'binding-valid') {
  const { createRecoveryBinding } = await import(bindingModuleUrl)
  const operation = recoveryOperation(id)
  operation.recoveryBinding = await createRecoveryBinding(
    operation,
    operation.plan,
    operation.artifacts
  )
  return operation
}

test('shared recovery binding verification rejects every bound payload tamper', async () => {
  const { verifyRecoveryBinding } = await import(bindingModuleUrl)
  const valid = await boundRecoveryOperation()
  assert.deepEqual(await verifyRecoveryBinding(valid), { valid: true, error: '' })

  const cases = [
    ['command', operation => { operation.command = '/usr/bin/systemctl stop nginx' }],
    ['endpoint', operation => { operation.endpoint.host = 'other.example.com' }],
    ['classification', operation => { operation.risk = 'readonly' }],
    ['plan', operation => { operation.plan.rollbackCommand = 'forged-rollback' }],
    ['artifacts', operation => { operation.artifacts.manifest = '/tmp/forged.json' }],
    ['fingerprint', operation => { operation.recoveryBinding.fingerprint = 'b'.repeat(64) }]
  ]

  for (const [name, tamper] of cases) {
    const operation = clone(valid)
    tamper(operation)
    const result = await verifyRecoveryBinding(operation)
    assert.equal(result.valid, false, name)
    assert.equal(result.error, '恢复记录完整性校验失败', name)
  }
})

test('safety center asynchronously verifies modern recovery candidates before grouping or actions', async () => {
  const {
    buildSafetyRecordViewModel,
    buildSafetyRecoveryIntegrityResults,
    groupSafetyCenterRecords,
    isSafetyOperationRollbackable
  } = await import(centerModelUrl)
  const valid = await boundRecoveryOperation('valid')
  const mutations = [
    ['command', operation => { operation.command = '/usr/bin/systemctl stop nginx' }],
    ['endpoint', operation => { operation.endpoint.username = 'deploy' }],
    ['classification', operation => { operation.reversible = false }],
    ['plan', operation => { operation.plan.verifyCommand = 'forged-verify' }],
    ['artifacts', operation => { operation.artifacts.state = '/tmp/forged-state' }],
    ['fingerprint', operation => { operation.recoveryBinding.fingerprint = 'c'.repeat(64) }],
    ['fingerprint-format', operation => { operation.recoveryBinding.fingerprint = 'short' }]
  ]
  const damaged = []
  for (const [name, mutate] of mutations) {
    const operation = await boundRecoveryOperation(`damaged-${name}`)
    mutate(operation)
    damaged.push(operation)
  }
  const legacy = {
    ...clone(valid),
    id: 'legacy-binding-not-required',
    source: 'sftp',
    recoveryBinding: undefined,
    plan: undefined,
    artifacts: undefined,
    metadata: {
      legacy: true,
      legacyRecord: {
        id: 'legacy-binding-not-required',
        source: 'sftp',
        host: 'prod.example.com',
        port: 22,
        username: 'root'
      }
    }
  }
  const records = [valid, ...damaged, legacy]

  const integrityResults = await buildSafetyRecoveryIntegrityResults(records)
  const groups = groupSafetyCenterRecords(records, [], integrityResults)

  assert.equal(integrityResults.get(valid.id).valid, true)
  assert.equal(integrityResults.has(legacy.id), false)
  assert.deepEqual(groups.rollback.map(record => record.id), [valid.id])
  assert.deepEqual(groups.legacy.map(record => record.id), [legacy.id])
  assert.deepEqual(
    groups.history.map(record => record.id).sort(),
    damaged.map(record => record.id).sort()
  )
  for (const operation of damaged) {
    assert.equal(isSafetyOperationRollbackable(operation, integrityResults), false)
    assert.equal(
      buildSafetyRecordViewModel(operation, integrityResults).error,
      '恢复记录完整性校验失败'
    )
  }
})

test('safety center binding verification skips legacy and non-recovery operations', async () => {
  const { buildSafetyRecoveryIntegrityResults } = await import(centerModelUrl)
  const candidate = recoveryOperation('candidate')
  candidate.recoveryBinding = {
    schemaVersion: 1,
    algorithm: 'SHA-256',
    fingerprint: 'a'.repeat(64)
  }
  const records = [
    { ...recoveryOperation('preparing'), state: 'preparing' },
    { ...recoveryOperation('kept'), state: 'kept' },
    {
      ...candidate,
      id: 'legacy',
      metadata: { legacy: true, legacyRecord: { id: 'legacy' } }
    },
    candidate
  ]
  const verified = []

  const results = await buildSafetyRecoveryIntegrityResults(
    records,
    async operation => {
      verified.push(operation.id)
      return { valid: true, error: '' }
    }
  )

  assert.deepEqual(verified, ['candidate'])
  assert.deepEqual([...results.keys()], ['candidate'])
})
