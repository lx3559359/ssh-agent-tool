const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

test('operations task cannot leave a final state', async () => {
  const {
    createOperationsTask,
    transitionOperationsTask
  } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-model.js'
  )
  const task = createOperationsTask({
    id: 'ops-1',
    toolId: 'system.overview',
    endpointKey: 'root@example.com:22'
  })
  const completed = transitionOperationsTask(task, 'completed')
  assert.throws(
    () => transitionOperationsTask(completed, 'running'),
    /终态/
  )
  assert.equal(completed.completedAt > 0, true)
})

test('runtime identity is normalized separately from the SSH login endpoint', async () => {
  const {
    normalizeOperationsRuntimeIdentity
  } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-model.js'
  )

  assert.deepEqual(normalizeOperationsRuntimeIdentity({
    uid: 0,
    username: 'root'
  }), {
    channel: 'pty',
    effectiveUid: '0',
    effectiveUsername: 'root'
  })
  for (const identity of [
    {},
    { uid: 'root', username: 'root' },
    { uid: '0', username: '' },
    { uid: '-1', username: 'root' },
    { uid: '0', username: 'x'.repeat(257) }
  ]) {
    assert.throws(
      () => normalizeOperationsRuntimeIdentity(identity),
      /身份无效/
    )
  }
})

test('cancellation unknown is a final state requiring terminal recovery', async () => {
  const {
    createOperationsTask,
    operationsTaskStatuses,
    transitionOperationsTask
  } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-model.js'
  )
  const task = createOperationsTask({
    id: 'ops-unknown',
    toolId: 'system.overview',
    endpointKey: 'hik@example.com:22'
  })
  const unknown = transitionOperationsTask(
    task,
    operationsTaskStatuses.cancellationUnknown,
    { terminalRecoveryRequired: true }
  )

  assert.equal(unknown.status, 'cancellation-unknown')
  assert.equal(unknown.terminalRecoveryRequired, true)
  assert.throws(
    () => transitionOperationsTask(unknown, operationsTaskStatuses.cancelled),
    /终态/
  )
})

test('legacy task records remain readable without runtime identity', async () => {
  const { createOperationsTaskRecordStore } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-record-store.js'
  )
  const legacy = {
    id: 'legacy-task',
    status: 'completed',
    endpoint: { username: 'hik' },
    steps: []
  }
  const records = createOperationsTaskRecordStore({
    storage: {
      read: () => [legacy],
      write: () => {}
    }
  })

  assert.deepEqual(records.get('legacy-task'), legacy)
  assert.equal(records.get('legacy-task').runtimeIdentity, undefined)
})

test('output buffer keeps 5000 lines and marks truncation', async () => {
  const { createOutputBuffer } = await importModule(
    'src/client/components/operations-toolkit/runtime/output-buffer.js'
  )
  const buffer = createOutputBuffer({ maxLines: 5000 })
  buffer.append(
    Array.from({ length: 5010 }, (_, index) => `line-${index}`).join('\n')
  )
  const snapshot = buffer.snapshot()
  assert.equal(snapshot.lines.length, 5000)
  assert.equal(snapshot.lines[0], 'line-10')
  assert.equal(snapshot.truncated, true)
})

test('output buffer joins streamed partial lines without inventing line breaks', async () => {
  const { createOutputBuffer } = await importModule(
    'src/client/components/operations-toolkit/runtime/output-buffer.js'
  )
  const buffer = createOutputBuffer({ maxLines: 10 })
  buffer.append('hel')
  buffer.append('lo\nwor')
  buffer.append('ld')
  assert.deepEqual(buffer.snapshot().lines, ['hello', 'world'])
  assert.equal(buffer.toString(), 'hello\nworld')
})

test('task record store is bounded and redacts sensitive output', async () => {
  const { createOperationsTaskRecordStore } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-record-store.js'
  )
  let persisted = []
  const storage = {
    read: () => persisted,
    write: value => {
      persisted = value
    }
  }
  const records = createOperationsTaskRecordStore({
    maxRecords: 2,
    maxStepBytes: 128,
    storage
  })
  records.save({
    id: 'ops-1',
    steps: [{ output: 'Authorization: Bearer secret-token' }]
  })
  records.save({ id: 'ops-2', steps: [{ output: 'ok' }] })
  records.save({ id: 'ops-3', steps: [{ output: 'done' }] })
  assert.deepEqual(records.list().map(item => item.id), ['ops-3', 'ops-2'])
  assert.doesNotMatch(JSON.stringify(persisted), /secret-token/)
})

test('task record store truncates UTF-8 without replacement characters', async () => {
  const { createOperationsTaskRecordStore } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-record-store.js'
  )
  let persisted = []
  const records = createOperationsTaskRecordStore({
    maxStepBytes: 7,
    storage: {
      read: () => persisted,
      write: value => {
        persisted = value
      }
    }
  })
  records.save({
    id: 'ops-unicode',
    steps: [{ output: '中文🙂内容' }]
  })
  const output = records.get('ops-unicode').steps[0].output
  assert.doesNotMatch(output, /\uFFFD/)
  assert.equal(new TextEncoder().encode(output).length <= 7, true)
})

test('task record store strips runtime proxies from persisted history', async () => {
  const { createOperationsTaskRecordStore } = await importModule(
    'src/client/components/operations-toolkit/runtime/task-record-store.js'
  )
  let persisted = []
  const records = createOperationsTaskRecordStore({
    storage: {
      read: () => persisted,
      write: value => {
        persisted = value
      }
    }
  })

  records.save({
    id: 'ops-runtime-proxy',
    capabilities: new Proxy({ tools: ['uptime'] }, {}),
    runtimeCallback: () => {},
    steps: [{ output: 'ok' }]
  })

  assert.doesNotThrow(() => records.list())
  assert.deepEqual(records.list()[0].capabilities, { tools: ['uptime'] })
  assert.equal(records.list()[0].runtimeCallback, undefined)
})
