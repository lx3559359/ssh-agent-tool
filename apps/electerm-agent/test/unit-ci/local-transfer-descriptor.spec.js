const test = require('node:test')
const assert = require('node:assert/strict')
const fileSystem = require('node:fs')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')

process.env.NODE_ENV = 'development'
const { fsExport } = require('../../src/app/lib/fs')

test('local transfer descriptor streams file digests and detects same-size changes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-descriptor-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'release.bin')
  await fs.writeFile(file, Buffer.from('abc'))

  const before = await fsExport.describeTransferEntry(file)
  await fs.writeFile(file, Buffer.from('xyz'))
  const after = await fsExport.describeTransferEntry(file)

  assert.equal(before.type, 'file')
  assert.equal(before.size, 3)
  assert.equal(before.digestAlgorithm, 'SHELLPILOT-SHA-256-CHAIN-V1')
  assert.notEqual(before.digest, after.digest)
  assert.equal('content' in before, false)
})

test('local transfer descriptor binds a sorted complete directory tree', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-tree-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'nested'))
  await fs.writeFile(path.join(root, 'z.txt'), 'z')
  await fs.writeFile(path.join(root, 'nested', 'a.txt'), 'a')

  const descriptor = await fsExport.describeTransferEntry(root)
  assert.equal(descriptor.type, 'directory')
  assert.deepEqual(descriptor.entries.map(item => item.name), ['nested', 'z.txt'])
  assert.equal(descriptor.entries[0].entry.entries[0].name, 'a.txt')

  await fs.rm(path.join(root, 'nested', 'a.txt'))
  const changed = await fsExport.describeTransferEntry(root)
  assert.notDeepEqual(changed, descriptor)
})

test('local transfer descriptor fails closed for symlinks and exhausted budgets', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-budget-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'data.txt')
  const link = path.join(root, 'data-link.txt')
  await fs.writeFile(file, 'data')
  try {
    await fs.symlink(file, link)
    await assert.rejects(
      fsExport.describeTransferEntry(link),
      /符号链接/
    )
  } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error
  }
  await assert.rejects(
    fsExport.describeTransferEntry(root, { maxNodes: 1 }),
    /节点上限/
  )
  await assert.rejects(
    fsExport.describeTransferEntry(file, { maxTotalBytes: 2 }),
    /总字节上限/
  )
})

test('skip-aware planner omits an EBUSY child while describing readable siblings', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-plan-child-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const readable = path.join(root, 'readable.txt')
  const busy = path.join(root, 'busy.txt')
  await fs.writeFile(readable, 'ok')
  await fs.writeFile(busy, 'busy')

  const io = {
    lstat: async (filePath) => {
      if (filePath === busy) {
        const error = new Error('locked child')
        error.code = 'ebusy'
        throw error
      }
      return fs.lstat(filePath)
    },
    readdir: (...args) => fs.readdir(...args),
    createReadStream: (...args) => fileSystem.createReadStream(...args)
  }

  const plan = await fsExport.prepareTransferEntry(root, { io })
  assert.equal(plan.descriptor.type, 'directory')
  assert.deepEqual(plan.descriptor.entries.map(item => item.name), ['readable.txt'])
  assert.equal(plan.descriptor.entries[0].entry.type, 'file')
  assert.deepEqual(plan.skipped, [{
    path: busy,
    relativePath: 'busy.txt',
    code: 'EBUSY',
    reason: 'locked'
  }])
})

test('skip-aware planner returns a null descriptor when the root is locked', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-plan-root-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const io = {
    lstat: async (filePath) => {
      if (filePath === root) {
        const error = new Error('root locked')
        error.code = 'EBUSY'
        throw error
      }
      return fs.lstat(filePath)
    },
    readdir: (...args) => fs.readdir(...args),
    createReadStream: (...args) => fileSystem.createReadStream(...args)
  }

  const plan = await fsExport.prepareTransferEntry(root, { io })
  assert.equal(plan.descriptor, null)
  assert.deepEqual(plan.skipped, [{
    path: root,
    relativePath: path.basename(root),
    code: 'EBUSY',
    reason: 'locked'
  }])
})

test('skip-aware planner consumes pinned skips before reading an exact child', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-plan-pinned-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const readable = path.join(root, 'readable.txt')
  const locked = path.join(root, 'locked.txt')
  await fs.writeFile(readable, 'ok')
  await fs.writeFile(locked, 'locked')
  let lockedReads = 0
  const pinnedSkip = {
    path: locked,
    relativePath: 'locked.txt',
    code: 'EBUSY',
    reason: 'locked'
  }
  const io = {
    lstat: async (filePath) => {
      if (filePath === locked) {
        lockedReads += 1
      }
      return fs.lstat(filePath)
    },
    readdir: (...args) => fs.readdir(...args),
    createReadStream: (...args) => fileSystem.createReadStream(...args)
  }

  const plan = await fsExport.prepareTransferEntry(root, {
    io,
    pinnedSkips: [pinnedSkip]
  })

  assert.equal(lockedReads, 0)
  assert.deepEqual(plan.descriptor.entries.map(item => item.name), ['readable.txt'])
  assert.deepEqual(plan.skipped, [pinnedSkip])
})

test('strict transfer description ignores pinned skips for existing children', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-strict-pinned-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const readable = path.join(root, 'readable.txt')
  const locked = path.join(root, 'locked.txt')
  await fs.writeFile(readable, 'ok')
  await fs.writeFile(locked, 'locked')

  const descriptor = await fsExport.describeTransferEntry(root, {
    pinnedSkips: [{
      path: locked,
      relativePath: 'locked.txt',
      code: 'EBUSY',
      reason: 'locked'
    }]
  })

  assert.equal(descriptor.type, 'directory')
  assert.deepEqual(descriptor.entries.map(item => item.name), ['locked.txt', 'readable.txt'])
})

test('skip-aware planner rejects invalid pinned skip codes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-invalid-pinned-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const locked = path.join(root, 'locked.txt')
  await fs.writeFile(locked, 'locked')

  await assert.rejects(
    fsExport.prepareTransferEntry(root, {
      pinnedSkips: [{
        path: locked,
        relativePath: 'locked.txt',
        code: 'EIO',
        reason: 'fatal'
      }]
    }),
    error => {
      assert.equal(error && error.code, 'TRANSFER_PINNED_SKIP_INVALID')
      assert.match(String(error && error.message), /pinned/i)
      return true
    }
  )
})

test('skip-aware planner canonicalizes pinned skip records from scanned children', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-pinned-canonical-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const readable = path.join(root, 'readable.txt')
  const unreadable = path.join(root, 'unreadable.txt')
  await fs.writeFile(readable, 'ok')
  await fs.writeFile(unreadable, 'hidden')

  const plan = await fsExport.prepareTransferEntry(root, {
    pinnedSkips: [{
      path: path.join(root, 'fake-caller-path.txt'),
      relativePath: 'unreadable.txt',
      code: 'eacces',
      reason: 'caller supplied'
    }]
  })

  assert.equal(plan.descriptor.type, 'directory')
  assert.deepEqual(plan.descriptor.entries.map(item => item.name), ['readable.txt'])
  assert.deepEqual(plan.skipped, [{
    path: unreadable,
    relativePath: 'unreadable.txt',
    code: 'EACCES',
    reason: 'unreadable'
  }])
})

test('strict transfer description still fails on non-skippable stream errors', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellpilot-plan-eio-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'data.txt')
  await fs.writeFile(file, 'abc')

  await assert.rejects(
    fsExport.describeTransferEntry(file, {
      io: {
        lstat: (...args) => fs.lstat(...args),
        readdir: (...args) => fs.readdir(...args),
        createReadStream: () => Readable.from((async function * () {
          yield Buffer.from('a')
          const error = new Error('device failure')
          error.code = 'EIO'
          throw error
        })())
      }
    }),
    error => error && error.code === 'EIO'
  )
})

test('local transfer descriptor planner is exposed through the renderer fs allowlist', async () => {
  const ipcSource = await fs.readFile(path.resolve(
    __dirname,
    '../../src/app/lib/ipc-sync.js'
  ), 'utf8')
  assert.match(ipcSource, /'describeTransferEntry'/)
  assert.match(ipcSource, /'describeTransferEntry',\s*'prepareTransferEntry',/)
})
