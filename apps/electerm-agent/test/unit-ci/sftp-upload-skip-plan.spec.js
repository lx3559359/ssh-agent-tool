const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const sourcePlanUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/file-transfer/transfer-source-plan.js'
)).href
const batchUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/file-transfer/transfer-batch-results.js'
)).href
test('local upload listing is restricted to the verified descriptor tree', async () => {
  const { filterPlannedDirectoryEntries } = await import(sourcePlanUrl)
  const descriptor = {
    type: 'directory',
    entries: [{ name: 'allowed.txt', entry: { type: 'file', size: 7 } }]
  }
  const result = filterPlannedDirectoryEntries([
    { name: 'allowed.txt', size: 7 },
    { name: 'unlocked-later.dat', size: 9 }
  ], descriptor)

  assert.deepEqual(result, [{
    name: 'allowed.txt',
    size: 7,
    sourceDescriptor: { type: 'file', size: 7 }
  }])
})

test('filtered directory entries do not expose mutable descriptor children', async () => {
  const { filterPlannedDirectoryEntries } = await import(sourcePlanUrl)
  const descriptor = {
    type: 'directory',
    entries: [{
      name: 'allowed-dir',
      entry: {
        type: 'directory',
        entries: [{ name: 'nested.txt', entry: { type: 'file', size: 7 } }]
      }
    }]
  }

  const [result] = filterPlannedDirectoryEntries([
    { name: 'allowed-dir' }
  ], descriptor)

  result.sourceDescriptor.entries[0].entry.size = 99

  assert.equal(
    descriptor.entries[0].entry.entries[0].entry.size,
    7
  )
})

test('source plan verification binds both descriptors and pinned skips', async () => {
  const { assertSameLocalTransferPlan } = await import(sourcePlanUrl)
  const expected = {
    descriptor: { type: 'file', size: 3, digest: 'abc' },
    skipped: [{ relativePath: 'locked.dat', code: 'EBUSY', reason: 'locked' }]
  }
  assert.equal(assertSameLocalTransferPlan(expected, structuredClone(expected)), true)
  assert.throws(
    () => assertSameLocalTransferPlan(expected, { ...expected, skipped: [] }),
    error => {
      assert.equal(error.message, '本地上传源在传输期间发生变化，远程目标可执行回滚。')
      return true
    }
  )
})

test('batch collector emits one terminal summary after every item settles', async () => {
  const { createTransferBatchResultCollector } = await import(batchUrl)
  const collector = createTransferBatchResultCollector()

  assert.equal(collector.record({
    batchId: 'b1',
    transferId: 't1',
    expected: 2,
    status: 'completed'
  }), null)
  assert.equal(collector.record({
    batchId: 'b1',
    transferId: 't1',
    expected: 2,
    status: 'exception'
  }), null)

  const summary = collector.record({
    batchId: 'b1',
    transferId: 't2',
    expected: 2,
    status: 'skipped',
    skipped: [{ relativePath: 'NTUSER.DAT', code: 'EBUSY', reason: 'locked' }]
  })

  assert.deepEqual(summary, {
    batchId: 'b1',
    expected: 2,
    completed: 1,
    skippedCount: 1,
    exceptionCount: 0,
    skipped: [{ relativePath: 'NTUSER.DAT', code: 'EBUSY', reason: 'locked' }]
  })
  assert.equal(collector.record({
    batchId: 'b1',
    transferId: 't1',
    expected: 2,
    status: 'completed'
  }), null)
  assert.equal(collector.record({
    batchId: 'b1',
    transferId: 't2',
    expected: 2,
    status: 'skipped'
  }), null)
  assert.equal(collector.size, 0)
})

test('batch collector keeps skipped child entries on an otherwise successful transfer', async () => {
  const { createTransferBatchResultCollector } = await import(batchUrl)
  const collector = createTransferBatchResultCollector()

  const summary = collector.record({
    batchId: 'mixed-success',
    transferId: 'directory-transfer',
    expected: 1,
    status: 'success',
    skipped: [{ relativePath: 'locked.dat', code: 'EBUSY', reason: 'locked' }]
  })

  assert.deepEqual(summary, {
    batchId: 'mixed-success',
    expected: 1,
    completed: 1,
    skippedCount: 1,
    exceptionCount: 0,
    skipped: [{ relativePath: 'locked.dat', code: 'EBUSY', reason: 'locked' }]
  })
})

test('batch collector snapshots skipped items when each record is stored', async () => {
  const { createTransferBatchResultCollector } = await import(batchUrl)
  const collector = createTransferBatchResultCollector()
  const skipped = [
    { relativePath: 'locked-a.dat', code: 'EBUSY', reason: 'locked' },
    { relativePath: 'locked-b.dat', code: 'EPERM', reason: 'denied' }
  ]

  assert.equal(collector.record({
    batchId: 'snapshot-batch',
    transferId: 't1',
    expected: 2,
    status: 'skipped',
    skipped
  }), null)

  skipped[0].relativePath = 'mutated.dat'
  skipped.length = 0

  const summary = collector.record({
    batchId: 'snapshot-batch',
    transferId: 't2',
    expected: 2,
    status: 'completed'
  })

  assert.deepEqual(summary, {
    batchId: 'snapshot-batch',
    expected: 2,
    completed: 1,
    skippedCount: 2,
    exceptionCount: 0,
    skipped: [
      { relativePath: 'locked-a.dat', code: 'EBUSY', reason: 'locked' },
      { relativePath: 'locked-b.dat', code: 'EPERM', reason: 'denied' }
    ]
  })
})

test('batch collector rejects inconsistent or invalid expected counts', async () => {
  const { createTransferBatchResultCollector } = await import(batchUrl)
  const collector = createTransferBatchResultCollector()

  assert.equal(collector.record({
    batchId: 'b3',
    transferId: 't1',
    expected: 3,
    status: 'completed'
  }), null)
  assert.throws(
    () => collector.record({
      batchId: 'b3',
      transferId: 't2',
      expected: 1,
      status: 'completed'
    }),
    /批次数量/
  )
  assert.equal(collector.record({
    batchId: 'b3',
    transferId: 't2',
    expected: 3,
    status: 'completed'
  }), null)
  assert.equal(collector.record({
    batchId: 'b3',
    transferId: 't3',
    expected: 3,
    status: 'completed'
  }).completed, 3)
  assert.equal(collector.size, 0)

  for (const expected of [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    '2',
    null
  ]) {
    assert.throws(
      () => collector.record({
        batchId: `invalid-${String(expected)}`,
        transferId: 't1',
        expected,
        status: 'completed'
      }),
      /批次数量/
    )
  }
  assert.equal(collector.size, 0)
})

test('batch collector bounds completed-batch memory without leaking active state', async () => {
  const { createTransferBatchResultCollector } = await import(batchUrl)
  const collector = createTransferBatchResultCollector()

  for (let index = 0; index <= 1000; index += 1) {
    assert.equal(collector.record({
      batchId: `bounded-${index}`,
      transferId: 't1',
      expected: 1,
      status: 'completed'
    }).completed, 1)
    assert.equal(collector.size, 0)
  }

  assert.equal(collector.record({
    batchId: 'bounded-0',
    transferId: 't1',
    expected: 2,
    status: 'completed'
  }), null)
  assert.equal(collector.size, 1)
  assert.equal(collector.record({
    batchId: 'bounded-0',
    transferId: 't2',
    expected: 2,
    status: 'completed'
  }).completed, 2)
  assert.equal(collector.size, 0)
})

test('batch collector keeps at most 1000 flattened skipped entries', async () => {
  const { createTransferBatchResultCollector } = await import(batchUrl)
  const collector = createTransferBatchResultCollector()
  const skipped = Array.from({ length: 1005 }, (_, index) => ({
    relativePath: `locked-${index}.dat`,
    code: 'EBUSY',
    reason: 'locked'
  }))

  const summary = collector.record({
    batchId: 'b2',
    transferId: 't1',
    expected: 1,
    status: 'skipped',
    skipped
  })

  assert.equal(summary.skippedCount, 1005)
  assert.equal(summary.skipped.length, 1000)
  assert.equal(summary.skipped[0].relativePath, 'locked-0.dat')
  assert.equal(summary.skipped.at(-1).relativePath, 'locked-999.dat')
})

test('transfer list annotates every queued item with shared batch metadata', async () => {
  const source = await fs.readFile(path.resolve(
    __dirname,
    '../../src/client/store/transfer-list.js'
  ), 'utf8')
  const normalized = source.replace(
    "import uid from '../common/uid'",
    `import uid from ${JSON.stringify(pathToFileURL(path.resolve(
      __dirname,
      '../../src/client/common/uid.js'
    )).href)}`
  )
  const { default: attachTransferList } = await import(
    `data:text/javascript,${encodeURIComponent(normalized)}`
  )
  const Store = function () {}
  global.window = {
    store: {
      fileTransfers: []
    }
  }
  attachTransferList(Store)

  const store = new Store()
  const items = [{ id: 'a' }, { id: 'b' }]
  store.addTransferList(items)

  assert.equal(window.store.fileTransfers.length, 2)
  assert.equal(window.store.fileTransfers[0].transferBatch, window.store.fileTransfers[1].transferBatch)
  assert.equal(window.store.fileTransfers[0].transferBatchSize, 2)
  assert.equal(window.store.fileTransfers[1].transferBatchSize, 2)
  assert.equal(window.store.fileTransfers[0], items[0])
  assert.equal(window.store.fileTransfers[1], items[1])
  delete global.window
})

test('transfer completion records batch results once and reserves skipped warnings for the final summary', async () => {
  const source = await fs.readFile(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/transfer.jsx'
  ), 'utf8')

  assert.match(source, /sharedTransferBatchResultCollector\.record\(\{/)
  assert.match(source, /batchId:\s*transfer\.transferBatch/)
  assert.match(source, /transferId:\s*transfer\.id/)
  assert.match(source, /expected:\s*transfer\.transferBatchSize/)
  assert.match(source, /status:\s*update\.status\s*\|\|\s*'success'/)
  assert.match(source, /skipped:\s*update\.skipped\s*\|\|\s*\[\]/)
  assert.match(source, /message\.warning\(/)
})
