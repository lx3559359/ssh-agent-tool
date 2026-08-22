const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/sftp/sftp-fast-delete.js'
)).href

function remoteFile (name, extra = {}) {
  return {
    type: 'remote',
    path: '/srv/app',
    name,
    isDirectory: false,
    ...extra
  }
}

test('fast delete validates the whole batch before starting remote work', async () => {
  const { executeFastRemoteDelete } = await import(moduleUrl)
  let calls = 0
  const sftp = {
    rm: async () => { calls += 1 },
    rmdir: async () => { calls += 1 }
  }
  const invalidFiles = [
    remoteFile('..'),
    remoteFile('.'),
    remoteFile(''),
    remoteFile('child', { path: '/srv/../escape' }),
    remoteFile('/etc/passwd'),
    remoteFile('../escape'),
    remoteFile('nested/escape'),
    remoteFile('nested\\escape'),
    remoteFile('missing-parent', { path: '' }),
    remoteFile('windows-parent', { path: '\\srv\\app' }),
    remoteFile('item', { path: 'relative/path' }),
    remoteFile('nested', { path: '/srv/.SHELLPILOT-TRANSACTIONS' }),
    remoteFile('.shellpilot-transactions', { isDirectory: true }),
    { type: 'remote', path: '/', name: '', isDirectory: true, isEmpty: true },
    { type: 'remote', path: '/', name: '..', isDirectory: true, isParent: true },
    { type: 'local', path: 'C:\\temp', name: 'local.txt' }
  ]

  for (const invalidFile of invalidFiles) {
    await assert.rejects(
      executeFastRemoteDelete({
        sftp,
        files: [remoteFile('valid-before-invalid.txt'), invalidFile]
      }),
      /拒绝|不能|没有|只支持|安全|事务|远程/
    )
  }
  assert.equal(calls, 0)
})

test('fast delete preserves the exact selected remote name', async () => {
  const { executeFastRemoteDelete } = await import(moduleUrl)
  const removed = []
  const sftp = {
    rm: async target => { removed.push(target) },
    rmdir: async () => {}
  }

  await executeFastRemoteDelete({
    sftp,
    files: [remoteFile(' spaced.txt ')]
  })

  assert.deepEqual(removed, ['/srv/app/ spaced.txt '])
})

test('fast delete rejects missing batches and the remote root', async () => {
  const { buildFastDeleteTargets } = await import(moduleUrl)

  assert.throws(() => buildFastDeleteTargets([]), /没有/)
  assert.throws(() => buildFastDeleteTargets(null), /没有/)
  assert.throws(
    () => buildFastDeleteTargets([{
      type: 'remote',
      path: '/',
      name: '/',
      isDirectory: true
    }]),
    /拒绝|绝对|根目录|安全/
  )
})

test('fast delete limits concurrency, routes directories, and keeps partial results', async () => {
  const { executeFastRemoteDelete } = await import(moduleUrl)
  let active = 0
  let peak = 0
  const calls = []
  const enter = async (method, target) => {
    calls.push({ method, target })
    active += 1
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active -= 1
    if (target.endsWith('/bad.txt')) throw new Error('permission denied')
  }
  const sftp = {
    rm: target => enter('rm', target),
    rmdir: target => enter('rmdir', target)
  }
  const files = [
    ...Array.from({ length: 7 }, (_, index) => remoteFile(`ok-${index}.txt`)),
    remoteFile('folder', { isDirectory: true }),
    remoteFile('bad.txt')
  ]

  const result = await executeFastRemoteDelete({
    sftp,
    files,
    concurrency: 99
  })

  assert.equal(peak, 4)
  assert.equal(result.total, 9)
  assert.equal(result.completed.length, 8)
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0].file.name, 'bad.txt')
  assert.equal(result.failed[0].path, '/srv/app/bad.txt')
  assert.match(result.failed[0].error.message, /permission denied/)
  assert.deepEqual(
    calls.find(call => call.target === '/srv/app/folder'),
    { method: 'rmdir', target: '/srv/app/folder' }
  )
})

test('fast delete clamps low concurrency to one', async () => {
  const { executeFastRemoteDelete } = await import(moduleUrl)
  let active = 0
  let peak = 0
  const sftp = {
    async rm () {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 2))
      active -= 1
    },
    async rmdir () {}
  }

  const result = await executeFastRemoteDelete({
    sftp,
    files: [remoteFile('one'), remoteFile('two')],
    concurrency: 0
  })

  assert.equal(peak, 1)
  assert.equal(result.completed.length, 2)
  assert.equal(result.failed.length, 0)
})
