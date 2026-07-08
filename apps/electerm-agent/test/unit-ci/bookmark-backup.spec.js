const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

test('creates an AIGShell bookmark backup package with metadata and credentials intact', async () => {
  const {
    createBookmarkBackup,
    parseBookmarkBackup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-backup.js')))

  const bookmarks = [
    {
      id: 'server-1',
      title: 'prod-web-01',
      host: '10.0.1.23',
      username: 'root',
      password: 'secret',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----'
    }
  ]
  const bookmarkGroups = [
    {
      id: 'group-1',
      title: '生产环境',
      bookmarkIds: ['server-1'],
      bookmarkGroupIds: []
    }
  ]

  const backup = createBookmarkBackup({
    bookmarks,
    bookmarkGroups,
    now: '2026-07-08T00:00:00.000Z',
    version: '3.15.105'
  })

  assert.equal(backup.format, 'AIGShell.bookmarks.backup')
  assert.equal(backup.formatVersion, 1)
  assert.equal(backup.app.name, 'AIGShell')
  assert.equal(backup.app.version, '3.15.105')
  assert.equal(backup.exportedAt, '2026-07-08T00:00:00.000Z')
  assert.deepEqual(backup.data.bookmarks, bookmarks)
  assert.deepEqual(backup.data.bookmarkGroups, bookmarkGroups)

  const parsed = parseBookmarkBackup(JSON.stringify(backup))
  assert.deepEqual(parsed.bookmarks, bookmarks)
  assert.deepEqual(parsed.bookmarkGroups, bookmarkGroups)
})

test('parses legacy bookmark exports for backwards compatibility', async () => {
  const {
    parseBookmarkBackup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-backup.js')))

  const legacyObject = {
    bookmarks: [{ id: 'server-1', title: 'prod-web-01' }],
    bookmarkGroups: [{ id: 'group-1', title: '生产环境', bookmarkIds: ['server-1'] }]
  }
  assert.deepEqual(parseBookmarkBackup(JSON.stringify(legacyObject)), legacyObject)

  const legacyArray = [{ id: 'server-2', title: 'prod-db-01' }]
  assert.deepEqual(parseBookmarkBackup(JSON.stringify(legacyArray)), {
    bookmarks: legacyArray,
    bookmarkGroups: []
  })
})

test('parses legacy bookmark exports whose connections do not have ids yet', async () => {
  const {
    parseBookmarkBackup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-backup.js')))

  const legacyObject = {
    bookmarks: [
      {
        title: 'prod-web-01',
        host: '10.0.1.23',
        username: 'root',
        password: 'secret'
      }
    ],
    bookmarkGroups: []
  }

  assert.deepEqual(parseBookmarkBackup(JSON.stringify(legacyObject)), legacyObject)
})

test('parses bookmark backup json with a utf-8 bom prefix', async () => {
  const {
    parseBookmarkBackup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-backup.js')))

  const legacyObject = {
    bookmarks: [{ id: 'server-1', title: 'prod-web-01' }],
    bookmarkGroups: []
  }

  assert.deepEqual(parseBookmarkBackup('\uFEFF' + JSON.stringify(legacyObject)), legacyObject)
})

test('rejects invalid bookmark backup content with a clear error', async () => {
  const {
    parseBookmarkBackup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-backup.js')))

  assert.throws(
    () => parseBookmarkBackup(''),
    /备份文件内容不是有效的 JSON/
  )
  assert.throws(
    () => parseBookmarkBackup('{bad json'),
    /备份文件内容不是有效的 JSON/
  )
  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({ hello: 'world' })),
    /备份文件中没有可导入的服务器连接/
  )
  assert.throws(
    () => parseBookmarkBackup(JSON.stringify([])),
    /备份文件中没有可导入的服务器连接/
  )
  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({
      format: 'AIGShell.bookmarks.backup',
      data: {
        bookmarks: [],
        bookmarkGroups: []
      }
    })),
    /备份文件中没有可导入的服务器连接/
  )
  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({
      format: 'AIGShell.bookmarks.backup',
      data: {
        bookmarks: { id: 'server-1' },
        bookmarkGroups: []
      }
    })),
    /备份文件中的服务器或分组格式不正确/
  )
  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({
      format: 'AIGShell.bookmarks.backup',
      formatVersion: 2,
      data: {
        bookmarks: [{ id: 'server-1', title: 'prod-web-01' }],
        bookmarkGroups: []
      }
    })),
    /备份文件版本过新/
  )
  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({
      bookmarks: [],
      bookmarkGroups: { id: 'group-1' }
    })),
    /备份文件中的服务器或分组格式不正确/
  )
  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({
      bookmarks: ['not-a-server'],
      bookmarkGroups: []
    })),
    /备份文件中的服务器或分组格式不正确/
  )
  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({
      bookmarks: [],
      bookmarkGroups: [null]
    })),
    /备份文件中的服务器或分组格式不正确/
  )
  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({
      bookmarks: [{ title: 'prod-web-01' }],
      bookmarkGroups: []
    })),
    /备份文件中的服务器或分组格式不正确/
  )
  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({
      bookmarks: [],
      bookmarkGroups: [{ title: '生产环境', bookmarkIds: [] }]
    })),
    /备份文件中的服务器或分组格式不正确/
  )
})

test('rejects bookmark backups with prototype pollution keys', async () => {
  const {
    parseBookmarkBackup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-backup.js')))

  const maliciousBookmark = '{"bookmarks":[{"id":"server-1","host":"10.0.1.23","__proto__":{"polluted":true}}],"bookmarkGroups":[]}'
  const maliciousGroup = '{"bookmarks":[{"id":"server-1","host":"10.0.1.23"}],"bookmarkGroups":[{"id":"group-1","constructor":{"prototype":{"polluted":true}}}]}'

  assert.throws(
    () => parseBookmarkBackup(maliciousBookmark),
    /服务器或分组格式不正确/
  )
  assert.throws(
    () => parseBookmarkBackup(maliciousGroup),
    /服务器或分组格式不正确/
  )
})

test('rejects bookmark backups with duplicated bookmark ids', async () => {
  const {
    parseBookmarkBackup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-backup.js')))

  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({
      bookmarks: [
        { id: 'server-1', host: '10.0.1.23' },
        { id: 'server-1', host: '10.0.1.24' }
      ],
      bookmarkGroups: []
    })),
    /服务器或分组格式不正确/
  )
})

test('rejects bookmark backups with duplicated bookmark group ids', async () => {
  const {
    parseBookmarkBackup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-backup.js')))

  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({
      bookmarks: [{ id: 'server-1', host: '10.0.1.23' }],
      bookmarkGroups: [
        { id: 'group-1', title: '生产环境', bookmarkIds: ['server-1'] },
        { id: 'group-1', title: '测试环境', bookmarkIds: [] }
      ]
    })),
    /服务器或分组格式不正确/
  )
})

test('rejects bookmark backups with malformed group reference fields', async () => {
  const {
    parseBookmarkBackup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-backup.js')))

  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({
      bookmarks: [{ id: 'server-1', host: '10.0.1.23' }],
      bookmarkGroups: [
        { id: 'group-1', bookmarkIds: 'server-1' }
      ]
    })),
    /服务器或分组格式不正确/
  )

  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({
      bookmarks: [{ id: 'server-1', host: '10.0.1.23' }],
      bookmarkGroups: [
        { id: 'group-1', bookmarkIds: ['server-1'], bookmarkGroupIds: { id: 'group-2' } }
      ]
    })),
    /服务器或分组格式不正确/
  )
})

test('uses the AIGShell bookmark backup package from every toolbar export entry', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/tree-list/bookmark-toolbar.jsx'),
    'utf8'
  )

  assert.match(source, /createBookmarkBackup/)
  assert.match(source, /download\('aigshell-bookmarks-backup-/)
  assert.match(source, /label:\s*e\('export'\)[\s\S]*?onClick:\s*handleDownload/)
  assert.doesNotMatch(source, /onClick:\s*onExport/)
})

function pathToFileURL (filePath) {
  return new URL(`file://${filePath.replace(/\\/g, '/')}`).href
}
