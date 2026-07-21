const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const modelModuleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/main/safety-operation-center-model.js'
)).href
const operationModelsModuleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/models.js'
)).href
const transactionStoreModuleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/transaction-store.js'
)).href

function importModel () {
  return import(modelModuleUrl)
}

function readSource (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8')
}

function operation (id, state, updatedAt, extra = {}) {
  return {
    id,
    source: 'terminal',
    state,
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root'
    },
    createdAt: updatedAt,
    updatedAt,
    ...extra
  }
}

function task (id, status, updatedAt, extra = {}) {
  return {
    id,
    source: 'server-status',
    status,
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root'
    },
    createdAt: updatedAt,
    updatedAt,
    steps: [],
    ...extra
  }
}

function recoveryStructure (id) {
  return {
    recoveryBinding: {
      schemaVersion: 1,
      algorithm: 'SHA-256',
      fingerprint: 'a'.repeat(64)
    },
    plan: {
      operationDir: `~/.shellpilot/operations/${id}/`,
      rollbackCommand: `rollback-${id}`,
      verifyCommand: `verify-${id}`
    },
    artifacts: {
      manifest: `~/.shellpilot/operations/${id}/manifest.json`
    },
    recoveryReadyAt: '2026-07-13T06:30:00.000Z'
  }
}

function deferred () {
  let resolveDeferred
  let rejectDeferred
  const promise = new Promise((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })
  return { promise, resolve: resolveDeferred, reject: rejectDeferred }
}

test('groups operations and tasks into four mutually exclusive tabs', async () => {
  const { groupSafetyCenterRecords } = await importModel()
  const records = [
    operation('op-preparing', 'preparing', '2026-07-13T10:00:00.000Z'),
    operation('op-ready', 'rollback-available', '2026-07-13T09:00:00.000Z', recoveryStructure('op-ready')),
    operation('op-kept', 'kept', '2026-07-13T08:00:00.000Z'),
    operation('op-failed-recoverable', 'failed', '2026-07-13T07:00:00.000Z', {
      ...recoveryStructure('op-failed-recoverable')
    }),
    operation('op-failed-final', 'failed', '2026-07-13T06:00:00.000Z'),
    operation('legacy-1', 'rollback-available', '2026-07-13T11:00:00.000Z', {
      metadata: { legacy: true }
    })
  ]
  const tasks = [
    task('task-running', 'running-readonly', '2026-07-13T12:00:00.000Z'),
    task('task-completed', 'completed', '2026-07-13T05:00:00.000Z'),
    task('task-partial', 'partially-completed', '2026-07-13T04:00:00.000Z')
  ]

  const groups = groupSafetyCenterRecords(records, tasks)

  assert.deepEqual(groups.running.map(item => item.id), [
    'task-running',
    'op-preparing'
  ])
  assert.deepEqual(groups.rollback.map(item => item.id), [
    'op-ready',
    'op-failed-recoverable'
  ])
  assert.deepEqual(groups.history.map(item => item.id), [
    'op-kept',
    'op-failed-final',
    'task-completed',
    'task-partial'
  ])
  assert.deepEqual(groups.legacy.map(item => item.id), ['legacy-1'])

  const allIds = Object.values(groups).flat().map(item => item.id)
  assert.equal(allIds.length, new Set(allIds).size)
})

test('groups every declared operation and task lifecycle status exactly once', async () => {
  const [
    { groupSafetyCenterRecords },
    { operationStates },
    { taskStatuses }
  ] = await Promise.all([
    importModel(),
    import(operationModelsModuleUrl),
    import(transactionStoreModuleUrl)
  ])
  const operationRunning = new Set([
    operationStates.preparing,
    operationStates.recoveryReady,
    operationStates.awaitingConfirmation,
    operationStates.executing,
    operationStates.rollingBack
  ])
  const operationRollback = new Set([
    operationStates.verificationPassed,
    operationStates.rollbackAvailable
  ])
  const operationHistory = new Set([
    operationStates.kept,
    operationStates.restored,
    operationStates.failed,
    operationStates.cancelled
  ])
  const taskHistory = new Set([
    taskStatuses.completed,
    taskStatuses.partiallyCompleted,
    taskStatuses.failed,
    taskStatuses.cancelled
  ])
  const records = Object.values(operationStates).map((state, index) => {
    const id = `operation-${state}`
    return operation(
      id,
      state,
      `2026-07-13T10:${String(index).padStart(2, '0')}:00.000Z`,
      operationRollback.has(state) ? recoveryStructure(id) : {}
    )
  })
  const tasks = Object.values(taskStatuses).map((status, index) => (
    task(`task-${status}`, status, `2026-07-13T11:${String(index).padStart(2, '0')}:00.000Z`)
  ))

  const groups = groupSafetyCenterRecords(records, tasks)
  const membership = new Map()
  for (const [group, items] of Object.entries(groups)) {
    for (const item of items) {
      assert.equal(membership.has(item.id), false, `${item.id} 被重复分组`)
      membership.set(item.id, group)
    }
  }

  assert.equal(
    operationRunning.size + operationRollback.size + operationHistory.size,
    Object.values(operationStates).length,
    'operationStates 新状态必须明确分组'
  )
  for (const state of Object.values(operationStates)) {
    const expected = operationRollback.has(state)
      ? 'rollback'
      : operationRunning.has(state) ? 'running' : 'history'
    assert.equal(membership.get(`operation-${state}`), expected, state)
  }
  for (const status of Object.values(taskStatuses)) {
    const expected = taskHistory.has(status) ? 'history' : 'running'
    assert.equal(membership.get(`task-${status}`), expected, status)
  }
  assert.equal(membership.size, records.length + tasks.length)
})

test('only rollback-available or fully recoverable failed operations are rollbackable', async () => {
  const { isSafetyOperationRollbackable } = await importModel()
  const time = '2026-07-13T10:00:00.000Z'
  const complete = operation('complete', 'failed', time, {
    ...recoveryStructure('complete')
  })

  assert.equal(isSafetyOperationRollbackable(operation(
    'verification-crash',
    'verification-passed',
    time,
    recoveryStructure('verification-crash')
  )), true)
  assert.equal(isSafetyOperationRollbackable(operation(
    'ready',
    'rollback-available',
    time,
    recoveryStructure('ready')
  )), true)
  assert.equal(isSafetyOperationRollbackable(complete), true)
  assert.equal(isSafetyOperationRollbackable(operation('failed', 'failed', time)), false)
  assert.equal(isSafetyOperationRollbackable({ ...complete, plan: { rollbackCommand: 'rollback' } }), false)
})

test('damaged recovery structures stay in history with an integrity error and no rollback action', async () => {
  const {
    buildSafetyRecordViewModel,
    groupSafetyCenterRecords,
    isSafetyOperationRollbackable
  } = await importModel()
  const time = '2026-07-13T10:00:00.000Z'
  const base = operation('damaged', 'failed', time, recoveryStructure('damaged'))
  const damagedRecords = [
    { ...base, id: 'missing-binding', recoveryBinding: undefined },
    { ...base, id: 'bad-schema', recoveryBinding: { ...base.recoveryBinding, schemaVersion: 2 } },
    { ...base, id: 'bad-algorithm', recoveryBinding: { ...base.recoveryBinding, algorithm: 'MD5' } },
    { ...base, id: 'bad-fingerprint', recoveryBinding: { ...base.recoveryBinding, fingerprint: 'short' } },
    { ...base, id: 'missing-plan', plan: undefined },
    { ...base, id: 'missing-rollback', plan: { ...base.plan, rollbackCommand: '' } },
    { ...base, id: 'missing-verify', plan: { ...base.plan, verifyCommand: '' } },
    { ...base, id: 'missing-artifacts', artifacts: undefined },
    { ...base, id: 'missing-ready-at', recoveryReadyAt: undefined }
  ]

  const groups = groupSafetyCenterRecords(damagedRecords, [])

  assert.equal(groups.rollback.length, 0)
  assert.equal(groups.history.length, damagedRecords.length)
  for (const record of damagedRecords) {
    assert.equal(isSafetyOperationRollbackable(record), false, record.id)
    assert.match(buildSafetyRecordViewModel(record).error, /完整性/)
  }
})

test('legacy records always stay in the legacy tab', async () => {
  const { groupSafetyCenterRecords } = await importModel()
  const records = [
    operation('legacy-running', 'executing', '2026-07-13T08:00:00.000Z', {
      metadata: { legacy: true }
    }),
    operation('legacy-restored', 'restored', '2026-07-13T09:00:00.000Z', {
      metadata: { legacy: true }
    })
  ]

  const groups = groupSafetyCenterRecords(records, [])

  assert.deepEqual(groups.legacy.map(item => item.id), [
    'legacy-restored',
    'legacy-running'
  ])
  assert.equal(groups.running.length, 0)
  assert.equal(groups.history.length, 0)
})

test('expired legacy claims expose an unknown-result warning and a retry action', async () => {
  const {
    buildSafetyRecordViewModel,
    getLegacyClaimStatus,
    isLegacyOperationActionable
  } = await importModel()
  const claimed = operation(
    'legacy-crashed',
    'rolling-back',
    '2026-07-13T10:00:00.000Z',
    {
      source: 'sftp',
      metadata: {
        legacy: true,
        legacyRecord: {
          id: 'legacy-crashed',
          source: 'sftp',
          host: 'prod.example.com',
          port: 22,
          username: 'root'
        },
        safetyCenterLegacyClaim: {
          claimId: 'crashed-owner',
          action: 'rollback',
          claimedAt: '2026-07-13T10:00:00.000Z',
          expiresAt: '2026-07-13T10:01:00.000Z'
        }
      }
    }
  )

  assert.equal(
    getLegacyClaimStatus(claimed, new Date('2026-07-13T10:00:30.000Z')),
    'active'
  )
  assert.equal(
    isLegacyOperationActionable(claimed, new Date('2026-07-13T10:00:30.000Z')),
    false
  )
  assert.equal(
    getLegacyClaimStatus(claimed, new Date('2026-07-13T10:02:00.000Z')),
    'stale'
  )
  assert.equal(
    isLegacyOperationActionable(claimed, new Date('2026-07-13T10:02:00.000Z')),
    true
  )
  assert.equal(
    buildSafetyRecordViewModel(
      claimed,
      undefined,
      new Date('2026-07-13T10:02:00.000Z')
    ).error,
    '上次执行中断，结果未知'
  )

  const oldClaimWithoutExpiry = {
    ...claimed,
    metadata: {
      ...claimed.metadata,
      safetyCenterLegacyClaim: {
        claimId: 'pre-lease-owner',
        action: 'rollback',
        claimedAt: '2026-07-13T10:00:00.000Z'
      }
    }
  }
  assert.equal(getLegacyClaimStatus(oldClaimWithoutExpiry), 'stale')
  assert.equal(isLegacyOperationActionable(oldClaimWithoutExpiry), true)

  const claimWithoutStart = {
    ...claimed,
    metadata: {
      ...claimed.metadata,
      safetyCenterLegacyClaim: {
        claimId: 'missing-start-owner',
        action: 'rollback',
        expiresAt: '2099-07-13T10:01:00.000Z'
      }
    }
  }
  assert.equal(getLegacyClaimStatus(claimWithoutStart), 'stale')
  assert.equal(isLegacyOperationActionable(claimWithoutStart), true)
})

test('sorting is newest first and stable for equal or invalid timestamps', async () => {
  const { groupSafetyCenterRecords } = await importModel()
  const groups = groupSafetyCenterRecords([
    operation('same-a', 'executing', '2026-07-13T10:00:00.000Z'),
    operation('invalid-a', 'preparing', 'invalid'),
    operation('newest', 'rolling-back', '2026-07-13T11:00:00.000Z'),
    operation('same-b', 'recovery-ready', '2026-07-13T10:00:00.000Z'),
    operation('invalid-b', 'awaiting-confirmation', '')
  ], [])

  assert.deepEqual(groups.running.map(item => item.id), [
    'newest',
    'same-a',
    'same-b',
    'invalid-a',
    'invalid-b'
  ])
})

test('empty and damaged inputs fail safe without manufacturing records', async () => {
  const { groupSafetyCenterRecords } = await importModel()

  assert.deepEqual(groupSafetyCenterRecords(null, { broken: true }), {
    running: [],
    rollback: [],
    history: [],
    legacy: []
  })

  const groups = groupSafetyCenterRecords([
    null,
    'broken',
    {},
    operation('unknown-state', 'future-state', 'not-a-date')
  ], [undefined, task('', 'completed', '2026-07-13T10:00:00.000Z')])

  assert.deepEqual(groups.history.map(item => item.id), ['unknown-state'])
  assert.equal(Object.values(groups).flat().length, 1)
})

test('filters preserve keyword server source and status behavior inside a tab', async () => {
  const { filterSafetyCenterRecords } = await importModel()
  const records = [
    operation('nginx', 'rollback-available', '2026-07-13T10:00:00.000Z', {
      source: 'terminal',
      title: '更新 Nginx 配置',
      command: 'sed -i s/old/new/ /etc/nginx/nginx.conf'
    }),
    operation('service', 'kept', '2026-07-13T09:00:00.000Z', {
      source: 'agent',
      title: '重启服务',
      endpoint: { host: 'staging.example.com', port: 2222, username: 'deploy' }
    })
  ]

  assert.deepEqual(filterSafetyCenterRecords(records, { keyword: 'nginx' }).map(item => item.id), ['nginx'])
  assert.deepEqual(filterSafetyCenterRecords(records, { host: 'staging.example.com' }).map(item => item.id), ['service'])
  assert.deepEqual(filterSafetyCenterRecords(records, { source: 'agent' }).map(item => item.id), ['service'])
  assert.deepEqual(filterSafetyCenterRecords(records, { status: 'rollback-available' }).map(item => item.id), ['nginx'])
  assert.deepEqual(filterSafetyCenterRecords('broken', { keyword: 'nginx' }), [])
})

test('terminal lookup requires an exact active SSH endpoint and session identity', async () => {
  const { findMatchingSafetyTerminal } = await importModel()
  const expected = operation('op-endpoint', 'rollback-available', '2026-07-13T10:00:00.000Z', {
    endpoint: {
      host: 'prod.example.com',
      port: 2222,
      username: 'deploy',
      tabId: 'tab-exact',
      pid: 'pid-exact',
      sessionType: 'ssh'
    }
  })
  const terminals = {
    'wrong-host': {
      pid: 'pid-exact',
      isSsh: () => true,
      getTerminalSafetyEndpoint: () => ({ ...expected.endpoint, host: 'other.example.com' })
    },
    'wrong-port': {
      pid: 'pid-exact',
      isSsh: () => true,
      getTerminalSafetyEndpoint: () => ({ ...expected.endpoint, port: 22 })
    },
    'wrong-user': {
      pid: 'pid-exact',
      isSsh: () => true,
      getTerminalSafetyEndpoint: () => ({ ...expected.endpoint, username: 'root' })
    },
    'wrong-session': {
      pid: 'pid-other',
      isSsh: () => true,
      getTerminalSafetyEndpoint: () => ({ ...expected.endpoint, pid: 'pid-other' })
    },
    exact: {
      pid: 'pid-exact',
      isSsh: () => true,
      getTerminalSafetyEndpoint: () => ({ ...expected.endpoint })
    }
  }

  const found = findMatchingSafetyTerminal(
    expected,
    ['wrong-host', 'wrong-port', 'wrong-user', 'wrong-session', 'exact'],
    id => terminals[id]
  )

  assert.equal(found, terminals.exact)
  assert.equal(findMatchingSafetyTerminal(
    expected,
    ['wrong-host', 'wrong-port', 'wrong-user', 'wrong-session'],
    id => terminals[id]
  ), undefined)
})

test('rollback keep and cancel route only through explicit capabilities', async () => {
  const { routeSafetyCenterAction } = await importModel()
  const calls = []
  const terminal = {
    rollbackSafetyOperation: async id => {
      calls.push(['rollback', id])
      return { id, state: 'restored' }
    },
    keepSafetyOperation: async id => {
      calls.push(['keep', id])
      return { id, state: 'kept' }
    },
    cancelSafetyOperation: async id => {
      calls.push(['cancel-operation', id])
      return { id, state: 'cancelled' }
    }
  }
  const op = operation('op-route', 'rollback-available', '2026-07-13T10:00:00.000Z')

  await routeSafetyCenterAction({ action: 'rollback', record: op, terminal })
  await routeSafetyCenterAction({ action: 'keep', record: op, terminal })
  await routeSafetyCenterAction({ action: 'cancel', record: op, terminal })

  const taskCapability = {
    canCancel: true,
    cancel: async id => {
      calls.push(['cancel-task', id])
      return { id, status: 'cancelled' }
    }
  }
  await routeSafetyCenterAction({
    action: 'cancel',
    record: { ...task('task-route', 'running-readonly', op.updatedAt), recordType: 'task' },
    taskCapability
  })

  assert.deepEqual(calls, [
    ['rollback', 'op-route'],
    ['keep', 'op-route'],
    ['cancel-operation', 'op-route'],
    ['cancel-task', 'task-route']
  ])
  await assert.rejects(
    routeSafetyCenterAction({
      action: 'cancel',
      record: { ...task('task-no-capability', 'running-readonly', op.updatedAt), recordType: 'task' }
    }),
    /取消能力不可用/
  )
})

test('revoked rollback is rejected without invoking the terminal runner', async () => {
  const { routeSafetyCenterAction } = await importModel()
  const record = operation('revoked-route', 'rollback-available', '2026-07-13T10:00:00.000Z', {
    ...recoveryStructure('revoked-route'),
    recoveryRevokedAt: '2026-07-13T11:00:00.000Z'
  })
  let rollbackCalls = 0

  await assert.rejects(
    routeSafetyCenterAction({
      action: 'rollback',
      record,
      terminal: {
        rollbackSafetyOperation: async () => {
          rollbackCalls += 1
        }
      }
    }),
    /该恢复记录已撤销，不能再次回滚。/
  )
  assert.equal(rollbackCalls, 0)
})
test('action routing rejects terminal runner results that did not reach the requested state', async () => {
  const { routeSafetyCenterAction } = await importModel()
  const op = operation('op-failed-result', 'rollback-available', '2026-07-13T10:00:00.000Z')

  await assert.rejects(
    routeSafetyCenterAction({
      action: 'rollback',
      record: op,
      terminal: {
        rollbackSafetyOperation: async () => ({ id: op.id, state: 'failed' })
      }
    }),
    /未完成/
  )
  await assert.rejects(
    routeSafetyCenterAction({
      action: 'cancel',
      record: { ...task('task-failed-result', 'running-readonly', op.updatedAt), recordType: 'task' },
      taskCapability: {
        canCancel: true,
        cancel: async () => ({ id: 'task-failed-result', status: 'failed' })
      }
    }),
    /未完成/
  )
})

test('single-flight action lock rejects duplicate clicks until completion', async () => {
  const {
    createSafetyActionLock,
    safetyRecordActionLockKey
  } = await importModel()
  const pending = deferred()
  const changes = []
  const lock = createSafetyActionLock(keys => changes.push(keys))
  const record = operation('op-1', 'rollback-available', '2026-07-13T10:00:00.000Z')
  const recordKey = safetyRecordActionLockKey(record)

  const first = lock.run(recordKey, () => pending.promise)
  const conflictingAction = await lock.run(recordKey, async () => 'keep')

  assert.equal(recordKey, 'operation:op-1')
  assert.deepEqual(conflictingAction, { started: false })
  assert.equal(lock.isLocked(recordKey), true)
  pending.resolve('restored')
  assert.deepEqual(await first, { started: true, value: 'restored' })
  assert.equal(lock.isLocked(recordKey), false)
  assert.deepEqual(changes, [['operation:op-1'], []])
})

test('task progress counts terminal step states and limits output previews', async () => {
  const { summarizeSafetyTaskProgress } = await importModel()
  const summary = summarizeSafetyTaskProgress(task(
    'task-progress',
    'running-readonly',
    '2026-07-13T10:00:00.000Z',
    {
      steps: [
        { id: 'ok', title: '成功', status: 'completed', output: 'ok' },
        { id: 'failed', title: '失败', status: 'failed', output: 'password=step-secret' },
        { id: 'cancelled', title: '取消', status: 'cancelled' },
        { id: 'running', title: '当前', status: 'running', output: 'x'.repeat(5000) },
        { id: 'pending', title: '等待', status: 'pending' }
      ]
    }
  ))

  assert.equal(summary.total, 5)
  assert.equal(summary.source, 'server-status')
  assert.equal(summary.successCount, 1)
  assert.equal(summary.failedCount, 1)
  assert.equal(summary.cancelledCount, 1)
  assert.equal(summary.finishedCount, 3)
  assert.equal(summary.percent, 60)
  assert.equal(summary.currentStep.id, 'running')
  assert.equal(summary.steps[3].outputPreview.length <= 2048, true)
  assert.doesNotMatch(JSON.stringify(summary), /step-secret/)
})

test('task progress exposes redacted Agent risk transaction details', async () => {
  const { summarizeSafetyTaskProgress } = await importModel()
  const summary = summarizeSafetyTaskProgress(task(
    'task-risk',
    'awaiting-change-confirmation',
    '2026-07-13T10:00:00.000Z',
    {
      source: 'agent',
      riskTransaction: {
        purpose: 'restart nginx',
        affectedObjects: ['service:nginx'],
        worstCase: 'password=risk-secret',
        resourceImpact: { cpu: 'low', duration: 'unknown' },
        recovery: { type: 'systemd' },
        rollbackLimits: 'process memory is not restored',
        cancellationBehavior: 'future steps stop'
      }
    }
  ))

  assert.equal(summary.riskDetails.purpose, 'restart nginx')
  assert.deepEqual(summary.riskDetails.affectedObjects, ['service:nginx'])
  assert.equal(summary.riskDetails.resourceImpact.duration, 'unknown')
  assert.doesNotMatch(JSON.stringify(summary.riskDetails), /risk-secret/)
})

test('task progress component exposes compact counts and capability-gated cancel', () => {
  const component = readSource('src/client/components/main/safety-task-progress.jsx')
  const styles = readSource('src/client/components/main/safety-task-progress.styl')

  assert.match(component, /summarizeSafetyTaskProgress/)
  assert.match(component, /shellpilotSafetySuccess/)
  assert.match(component, /shellpilotSafetyFailed/)
  assert.match(component, /shellpilotSafetyCancelled/)
  assert.match(component, /shellpilotSafetySource/)
  assert.match(component, /canCancel/)
  assert.match(component, /disabled=!canCancel|disabled=\{!canCancel/)
  assert.match(component, /shellpilotSafetyRunnerUnavailable/)
  assert.match(component, /Progress/)
  assert.match(styles, /overflow-y auto/)
  assert.match(styles, /border-radius 6px/)
})

test('safety center gives every declared operation and task status a Chinese label', async () => {
  const [
    {
      getSafetyOperationStatusPresentation,
      getSafetyTaskStatusPresentation,
      safetyOperationStatusPresentations,
      safetyTaskStatusPresentations
    },
    { operationStates },
    { taskStatuses }
  ] = await Promise.all([
    importModel(),
    import(operationModelsModuleUrl),
    import(transactionStoreModuleUrl)
  ])
  const component = readSource('src/client/components/main/safety-task-progress.jsx')

  assert.equal(typeof getSafetyOperationStatusPresentation, 'function')
  assert.equal(typeof getSafetyTaskStatusPresentation, 'function')
  assert.deepEqual(
    Object.keys(safetyOperationStatusPresentations).sort(),
    Object.values(operationStates).sort()
  )
  assert.deepEqual(
    Object.keys(safetyTaskStatusPresentations).sort(),
    Object.values(taskStatuses).sort()
  )
  for (const state of Object.values(operationStates)) {
    const [label, color] = getSafetyOperationStatusPresentation(state)
    assert.match(label, /[\u4e00-\u9fff]/, state)
    assert.notEqual(label, state)
    assert.equal(typeof color, 'string')
  }
  for (const status of Object.values(taskStatuses)) {
    const [label, color] = getSafetyTaskStatusPresentation(status)
    assert.match(label, /[\u4e00-\u9fff]/, status)
    assert.notEqual(label, status)
    assert.equal(typeof color, 'string')
  }
  assert.deepEqual(getSafetyOperationStatusPresentation('future-state'), ['未知状态', 'default'])
  assert.deepEqual(getSafetyTaskStatusPresentation('future-status'), ['未知状态', 'default'])
  assert.match(component, /getSafetyTaskStatusPresentation/)
  assert.doesNotMatch(component, /\[summary\.status,\s*'default'\]/)
})

test('refresh lifecycle is event-driven and removes listeners without creating an interval', async () => {
  const {
    legacySafetyOperationUpdatedEvent,
    safetyTransactionUpdatedEvent,
    subscribeSafetyCenterRefresh
  } = await importModel()
  const listeners = new Map()
  const removed = []
  let intervalCount = 0
  let refreshCount = 0
  const eventTarget = {
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => {
      removed.push([name, listener])
      listeners.delete(name)
    }
  }
  const dispose = subscribeSafetyCenterRefresh({
    eventTarget,
    refresh: () => { refreshCount += 1 },
    hasRunning: true,
    setIntervalFn: () => { intervalCount += 1 }
  })

  listeners.get(safetyTransactionUpdatedEvent)()
  listeners.get(legacySafetyOperationUpdatedEvent)()
  assert.equal(refreshCount, 2)
  assert.equal(intervalCount, 0)

  const transactionListener = listeners.get(safetyTransactionUpdatedEvent)
  const legacyListener = listeners.get(legacySafetyOperationUpdatedEvent)
  dispose()
  assert.deepEqual(removed, [
    [safetyTransactionUpdatedEvent, transactionListener],
    [legacySafetyOperationUpdatedEvent, legacyListener]
  ])
  assert.equal(listeners.size, 0)
})

test('record view model never exposes endpoint credentials or unredacted output', async () => {
  const { buildSafetyRecordViewModel } = await importModel()
  const view = buildSafetyRecordViewModel(operation(
    'op-secret',
    'failed',
    '2026-07-13T10:00:00.000Z',
    {
      command: 'sshpass -p command-secret ssh root@prod.example.com',
      endpoint: {
        host: 'prod.example.com',
        port: 22,
        username: 'root',
        password: 'endpoint-secret',
        privateKey: 'private-key-secret'
      },
      error: 'Authorization: Bearer error-secret',
      audit: [{ phase: 'execute', preview: 'token=audit-secret' }],
      metadata: { token: 'metadata-secret' }
    }
  ))
  const rendered = JSON.stringify(view)

  assert.equal(view.endpoint, 'root@prod.example.com:22')
  assert.match(view.commandSummary, /\[REDACTED\]/)
  assert.equal(view.audit[0].phaseLabel, '执行')
  assert.doesNotMatch(rendered, /command-secret|endpoint-secret|private-key-secret|error-secret|audit-secret|metadata-secret/)
})

test('legacy operations preserve the verified SFTP and quick-command restore paths', async () => {
  const { getLegacySafetyRecord } = await importModel()
  const legacyRecord = {
    id: 'legacy-restore',
    source: 'quick-command',
    rollbackPath: '/tmp/shellpilot-rollback/network.sh',
    host: 'prod.example.com',
    port: 22,
    username: 'root'
  }
  const migrated = operation(
    legacyRecord.id,
    'rollback-available',
    '2026-07-13T10:00:00.000Z',
    { metadata: { legacy: true, legacyRecord } }
  )

  assert.equal(getLegacySafetyRecord(migrated), legacyRecord)
  assert.equal(getLegacySafetyRecord(operation('new', 'kept', migrated.updatedAt)), null)

  const modal = readSource('src/client/components/main/safety-operation-center-modal.jsx')
  assert.match(modal, /restoreSftpRecord/)
  assert.match(modal, /buildVerifiedQuickCommandRollbackAction/)
  assert.match(modal, /assertVerifiedQuickCommandRollbackResult/)
  assert.match(modal, /findSafetyOperationSession/)
  assert.match(modal, /executeSafetyCenterAction/)
})

test('terminal safety center methods validate stored endpoint before delegating to runner', () => {
  const terminal = readSource('src/client/components/terminal/terminal.jsx')

  assert.match(terminal, /assertSameSessionEndpoint/)
  assert.match(terminal, /terminalSafetyStore\.getOperation/)
  assert.match(terminal, /assertSafetyOperationEndpoint/)
  assert.match(terminal, /rollbackSafetyOperation\s*=\s*async/)
  assert.match(terminal, /keepSafetyOperation\s*=\s*async/)
  assert.match(terminal, /cancelSafetyOperation\s*=\s*async/)
  assert.match(terminal, /terminalSafetyRunner\.rollback\(id\)/)
  assert.match(terminal, /terminalSafetyRunner\.keep\(id\)/)
  assert.match(terminal, /terminalSafetyRunner\.cancel\(id\)/)
})

test('UI keeps one topbar entry and reads the encrypted transaction store', () => {
  const topbar = readSource('src/client/components/main/aigshell-topbar.jsx')
  const modal = readSource('src/client/components/main/safety-operation-center-modal.jsx')
  const terminal = readSource('src/client/components/terminal/terminal.jsx')

  assert.equal((topbar.match(/<SafetyOperationCenterModal/g) || []).length, 1)
  assert.match(topbar, /shellpilotTopbarSafetyCenter/)
  assert.match(modal, /listOperations/)
  assert.match(modal, /listTasks/)
  assert.match(modal, /buildSafetyRecoveryIntegrityResults/)
  assert.match(modal, /setIntegrityResults\(new Map\(\)\)/)
  assert.match(modal, /ReloadOutlined/)
  assert.match(modal, /aria-label=\{e\('refresh'\)\}/)
  assert.match(modal, /groupSafetyCenterRecords/)
  assert.match(modal, /SafetyTaskProgress/)
  assert.match(modal, /findMatchingSafetyTerminal/)
  assert.match(modal, /executeSafetyCenterAction/)
  assert.match(modal, /getOperation/)
  assert.match(modal, /guardedPatchOperation/)
  assert.match(modal, /createSafetyActionLock/)
  assert.match(modal, /subscribeSafetyCenterRefresh/)
  assert.match(modal, /Modal\.confirm/)
  assert.match(modal, /safetyTaskCapability/)
  assert.doesNotMatch(modal, /\bpatchOperation\b/)
  assert.doesNotMatch(modal, /readSafetyOperationRecords/)
  for (const key of [
    'shellpilotSafetyRunning',
    'shellpilotSafetyRollbackAvailable',
    'shellpilotSafetyHistory',
    'shellpilotSafetyLegacy'
  ]) {
    assert.match(modal, new RegExp(key))
  }
  assert.match(terminal, /rollbackSafetyOperation/)
  assert.match(terminal, /keepSafetyOperation/)
  assert.match(terminal, /cancelSafetyOperation/)
  assert.match(terminal, /terminalSafetyRunner\.rollback/)
  assert.match(terminal, /terminalSafetyRunner\.keep/)
  assert.match(terminal, /terminalSafetyRunner\.cancel/)
})

test('revoked recovery records have no rollback capability or center action', async () => {
  const { groupSafetyCenterRecords, isSafetyOperationRollbackable } = await importModel()
  const time = '2026-07-13T10:00:00.000Z'
  const records = [
    operation('revoked-failed', 'failed', time, {
      ...recoveryStructure('revoked-failed'),
      recoveryRevokedAt: '2026-07-13T11:00:00.000Z'
    }),
    operation('revoked-ready', 'rollback-available', time, {
      ...recoveryStructure('revoked-ready'),
      recoveryRevokedAt: '2026-07-13T11:00:00.000Z'
    })
  ]

  assert.deepEqual(records.map(record => isSafetyOperationRollbackable(record)), [false, false])
  const groups = groupSafetyCenterRecords(records, [])
  assert.deepEqual(groups.rollback, [])
  assert.deepEqual(groups.history.map(item => item.id), ['revoked-failed', 'revoked-ready'])
})
