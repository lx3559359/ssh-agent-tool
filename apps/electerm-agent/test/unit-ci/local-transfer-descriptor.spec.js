const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

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

test('local transfer descriptor is exposed through the renderer fs allowlist', async () => {
  const ipcSource = await fs.readFile(path.resolve(
    __dirname,
    '../../src/app/lib/ipc-sync.js'
  ), 'utf8')
  assert.match(ipcSource, /'describeTransferEntry'/)
})
