const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const modelsUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/operation-tasks/models.js'
)).href
const storeUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/operation-tasks/task-store.js'
)).href

function clone (value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

function createMemoryAdapter () {
  const rows = new Map()
  return {
    rows,
    async update (id, value, table) {
      assert.equal(table, 'operationTasks')
      rows.set(id, clone(value))
      return 1
    },
    async findOne (table, id) {
      assert.equal(table, 'operationTasks')
      return clone(rows.get(id))
    },
    async find (table) {
      assert.equal(table, 'operationTasks')
      return [...rows.values()].map(clone)
    },
    async remove (table, id) {
      assert.equal(table, 'operationTasks')
      rows.delete(id)
    }
  }
}

function clockAt (iso) {
  return () => new Date(iso)
}

test('operation task model keeps only safe serializable metadata', async () => {
  const {
    normalizeOperationTask,
    operationTaskKinds,
    operationTaskStatuses
  } = await import(modelsUrl)
  const task = normalizeOperationTask({
    id: 'transfer-1',
    kind: operationTaskKinds.sftpTransfer,
    status: operationTaskStatuses.running,
    title: 'upload app.log',
    endpoint: {
      host: 'example.test',
      port: 22,
      username: 'root',
      password: 'must-not-survive'
    },
    progress: {
      transferred: 128,
      total: 1024
    },
    metadata: {
      direction: 'upload',
      sourcePath: 'C:\\logs\\app.log',
      targetPath: '/tmp/app.log',
      apiKey: 'must-not-survive',
      nested: {
        token: 'must-not-survive',
        safe: 'kept'
      }
    },
    runtime: {
      stream: Buffer.from('secret')
    },
    password: 'must-not-survive'
  }, clockAt('2026-07-28T00:00:00.000Z'))

  assert.equal(task.schemaVersion, 1)
  assert.equal(task.progress.percent, 12)
  assert.deepEqual(task.endpoint, {
    host: 'example.test',
    port: 22,
    username: 'root'
  })
  assert.equal(task.metadata.direction, 'upload')
  assert.equal(task.metadata.nested.safe, 'kept')
  assert.equal('apiKey' in task.metadata, false)
  assert.equal('token' in task.metadata.nested, false)
  assert.equal('password' in task, false)
  assert.equal('runtime' in task, false)
  assert.doesNotThrow(() => structuredClone(task))
})

test('operation task model rejects invalid task transitions', async () => {
  const {
    assertOperationTaskTransition
  } = await import(modelsUrl)

  assert.throws(
    () => assertOperationTaskTransition('completed', 'running'),
    error => error.code === 'OPERATION_TASK_TRANSITION_INVALID'
  )
  assert.doesNotThrow(
    () => assertOperationTaskTransition('running', 'pausing')
  )
})

test('operation task store serializes patches and marks unfinished work interrupted', async () => {
  const {
    operationTaskKinds,
    operationTaskStatuses
  } = await import(modelsUrl)
  const {
    findOperationTask,
    markUnfinishedOperationTasksInterrupted,
    patchOperationTask,
    saveOperationTask
  } = await import(storeUrl)
  const adapter = createMemoryAdapter()
  const clock = clockAt('2026-07-28T01:00:00.000Z')

  await saveOperationTask({
    id: 'one',
    kind: operationTaskKinds.sftpTransfer,
    status: operationTaskStatuses.running,
    progress: { transferred: 0, total: 100 }
  }, { adapter, clock })
  await Promise.all([
    patchOperationTask('one', {
      progress: { transferred: 10, total: 100 }
    }, { adapter, clock }),
    patchOperationTask('one', {
      progress: { transferred: 20, total: 100 }
    }, { adapter, clock })
  ])
  await markUnfinishedOperationTasksInterrupted({ adapter, clock })

  const saved = await findOperationTask('one', { adapter })
  assert.equal(saved.status, operationTaskStatuses.interrupted)
  assert.equal(saved.progress.transferred, 20)
  assert.equal(saved.metadata.interruptionReason, 'client-restarted')
})

test('operation task store interrupts paused tasks after client restart', async () => {
  const {
    operationTaskKinds,
    operationTaskStatuses
  } = await import(modelsUrl)
  const {
    findOperationTask,
    markUnfinishedOperationTasksInterrupted,
    saveOperationTask
  } = await import(storeUrl)
  const adapter = createMemoryAdapter()

  await saveOperationTask({
    id: 'paused-transfer',
    kind: operationTaskKinds.sftpTransfer,
    status: operationTaskStatuses.paused,
    metadata: {
      checkpoint: {
        offset: 4096
      }
    }
  }, {
    adapter,
    clock: clockAt('2026-07-28T01:00:00.000Z')
  })
  await markUnfinishedOperationTasksInterrupted({
    adapter,
    clock: clockAt('2026-07-28T01:01:00.000Z')
  })

  const saved = await findOperationTask('paused-transfer', { adapter })
  assert.equal(saved.status, operationTaskStatuses.interrupted)
  assert.equal(saved.metadata.checkpoint.offset, 4096)
})

test('operation task patches refresh updated time', async () => {
  const {
    operationTaskKinds,
    operationTaskStatuses
  } = await import(modelsUrl)
  const {
    findOperationTask,
    patchOperationTask,
    saveOperationTask
  } = await import(storeUrl)
  const adapter = createMemoryAdapter()

  await saveOperationTask({
    id: 'timed-task',
    kind: operationTaskKinds.sshTunnel,
    status: operationTaskStatuses.running
  }, {
    adapter,
    clock: clockAt('2026-07-28T01:00:00.000Z')
  })
  await patchOperationTask('timed-task', {
    progress: { transferred: 1, total: 2 }
  }, {
    adapter,
    clock: clockAt('2026-07-28T01:02:00.000Z')
  })

  const saved = await findOperationTask('timed-task', { adapter })
  assert.equal(saved.updatedAt, '2026-07-28T01:02:00.000Z')
})

test('operation task store keeps active records while pruning old final history', async () => {
  const {
    operationTaskKinds,
    operationTaskStatuses
  } = await import(modelsUrl)
  const {
    listOperationTasks,
    pruneOperationTasks,
    saveOperationTask
  } = await import(storeUrl)
  const adapter = createMemoryAdapter()

  for (let index = 0; index < 4; index++) {
    await saveOperationTask({
      id: `final-${index}`,
      kind: operationTaskKinds.sftpTransfer,
      status: operationTaskStatuses.completed,
      createdAt: `2026-07-28T00:00:0${index}.000Z`,
      updatedAt: `2026-07-28T00:00:0${index}.000Z`
    }, {
      adapter,
      clock: clockAt(`2026-07-28T00:00:0${index}.000Z`)
    })
  }
  await saveOperationTask({
    id: 'active',
    kind: operationTaskKinds.sshTunnel,
    status: operationTaskStatuses.running
  }, { adapter, clock: clockAt('2026-07-28T00:01:00.000Z') })

  const removed = await pruneOperationTasks({
    adapter,
    maxFinalRecords: 2
  })
  const records = await listOperationTasks({ adapter })

  assert.equal(removed, 2)
  assert.equal(records.some(record => record.id === 'active'), true)
  assert.deepEqual(
    records.filter(record => record.status === 'completed').map(record => record.id),
    ['final-3', 'final-2']
  )
})
