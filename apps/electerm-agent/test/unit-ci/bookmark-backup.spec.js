const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

test('creates a ShellPilot bookmark backup package with metadata and credentials intact', async () => {
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
  assert.equal(backup.app.name, 'ShellPilot')
  assert.equal(backup.app.version, '3.15.105')
  assert.equal(backup.exportedAt, '2026-07-08T00:00:00.000Z')
  assert.deepEqual(backup.data.bookmarks, bookmarks)
  assert.deepEqual(backup.data.bookmarkGroups, bookmarkGroups)

  const parsed = parseBookmarkBackup(JSON.stringify(backup))
  assert.deepEqual(parsed.bookmarks, bookmarks)
  assert.deepEqual(parsed.bookmarkGroups, bookmarkGroups)
})

test('creates a bookmark backup without credentials when requested', async () => {
  const {
    createBookmarkBackup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-backup.js')))

  const backup = createBookmarkBackup({
    bookmarks: [
      {
        id: 'server-1',
        title: 'prod-web-01',
        host: '10.0.1.23',
        username: 'root',
        password: 'secret',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
        passphrase: 'key-passphrase',
        certificate: 'ssh-certificate',
        proxy: 'socks5://proxy-user:proxy-secret@127.0.0.1:1080',
        connectionHoppings: [
          {
            host: 'jump.example.com',
            username: 'jump',
            password: 'jump-secret',
            privateKey: 'jump-private-key',
            passphrase: 'jump-passphrase'
          }
        ]
      }
    ],
    bookmarkGroups: [],
    includeCredentials: false
  })

  const [bookmark] = backup.data.bookmarks
  assert.equal(bookmark.password, undefined)
  assert.equal(bookmark.privateKey, undefined)
  assert.equal(bookmark.passphrase, undefined)
  assert.equal(bookmark.certificate, undefined)
  assert.equal(bookmark.connectionHoppings[0].password, undefined)
  assert.equal(bookmark.connectionHoppings[0].privateKey, undefined)
  assert.equal(bookmark.connectionHoppings[0].passphrase, undefined)
  assert.equal(bookmark.host, '10.0.1.23')
  assert.equal(bookmark.username, 'root')
  assert.equal(bookmark.proxy, 'socks5://proxy-user@127.0.0.1:1080')

  const serialized = JSON.stringify(backup)
  assert.equal(serialized.includes('secret'), false)
  assert.equal(serialized.includes('PRIVATE KEY'), false)
  assert.equal(serialized.includes('passphrase'), false)
})

test('creates an encrypted bookmark backup that hides server details and decrypts with the passphrase', async () => {
  const {
    createEncryptedBookmarkBackup,
    parseEncryptedBookmarkBackup
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
      title: 'production',
      bookmarkIds: ['server-1'],
      bookmarkGroupIds: []
    }
  ]

  const backup = await createEncryptedBookmarkBackup({
    bookmarks,
    bookmarkGroups,
    passphrase: 'backup-password',
    now: '2026-07-08T00:00:00.000Z',
    version: '3.15.105'
  })

  assert.equal(backup.format, 'AIGShell.bookmarks.encrypted-backup')
  assert.equal(backup.formatVersion, 1)
  assert.equal(backup.app.name, 'ShellPilot')
  assert.equal(backup.app.version, '3.15.105')
  assert.equal(backup.exportedAt, '2026-07-08T00:00:00.000Z')
  assert.equal(backup.encryption.algorithm, 'AES-GCM')
  assert.equal(backup.encryption.kdf, 'PBKDF2-SHA256')
  assert.equal(typeof backup.ciphertext, 'string')

  const serialized = JSON.stringify(backup)
  assert.equal(serialized.includes('prod-web-01'), false)
  assert.equal(serialized.includes('10.0.1.23'), false)
  assert.equal(serialized.includes('secret'), false)
  assert.equal(serialized.includes('OPENSSH PRIVATE KEY'), false)

  const parsed = await parseEncryptedBookmarkBackup(serialized, {
    passphrase: 'backup-password'
  })
  assert.deepEqual(parsed.bookmarks, bookmarks)
  assert.deepEqual(parsed.bookmarkGroups, bookmarkGroups)
})

test('rejects encrypted bookmark backups without the correct passphrase', async () => {
  const {
    createEncryptedBookmarkBackup,
    parseBookmarkBackup,
    parseEncryptedBookmarkBackup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-backup.js')))

  const backup = await createEncryptedBookmarkBackup({
    bookmarks: [{ id: 'server-1', host: '10.0.1.23', password: 'secret' }],
    passphrase: 'backup-password'
  })
  const serialized = JSON.stringify(backup)

  assert.throws(
    () => parseBookmarkBackup(serialized),
    /加密/
  )
  await assert.rejects(
    () => parseEncryptedBookmarkBackup(serialized),
    /密码/
  )
  await assert.rejects(
    () => parseEncryptedBookmarkBackup(serialized, { passphrase: 'wrong-password' }),
    /密码/
  )
})

test('parses encrypted bookmark backups through the import helper after requesting a passphrase', async () => {
  const {
    createEncryptedBookmarkBackup,
    parseBookmarkBackupForImport
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-backup.js')))

  const bookmarks = [{ id: 'server-1', host: '10.0.1.23', password: 'secret' }]
  const backup = await createEncryptedBookmarkBackup({
    bookmarks,
    passphrase: 'backup-password'
  })
  const requested = []

  const parsed = await parseBookmarkBackupForImport(JSON.stringify(backup), {
    requestPassphrase: async () => {
      requested.push('passphrase')
      return 'backup-password'
    }
  })

  assert.deepEqual(parsed.bookmarks, bookmarks)
  assert.deepEqual(parsed.bookmarkGroups, [])
  assert.deepEqual(requested, ['passphrase'])
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

test('rejects bookmark backups with dangling group references', async () => {
  const {
    parseBookmarkBackup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-backup.js')))

  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({
      bookmarks: [{ id: 'server-1', host: '10.0.1.23' }],
      bookmarkGroups: [
        { id: 'group-1', bookmarkIds: ['missing-server'] }
      ]
    })),
    /服务器或分组格式不正确/
  )

  assert.throws(
    () => parseBookmarkBackup(JSON.stringify({
      bookmarks: [{ id: 'server-1', host: '10.0.1.23' }],
      bookmarkGroups: [
        { id: 'group-1', bookmarkIds: ['server-1'], bookmarkGroupIds: ['missing-group'] }
      ]
    })),
    /服务器或分组格式不正确/
  )
})

test('removes cyclic bookmark group references when importing backups', async () => {
  const {
    parseBookmarkBackup
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/bookmark-backup.js')))

  const parsed = parseBookmarkBackup(JSON.stringify({
    bookmarks: [{ id: 'server-1', host: '10.0.1.23' }],
    bookmarkGroups: [
      {
        id: 'group-a',
        title: '生产环境',
        bookmarkIds: ['server-1'],
        bookmarkGroupIds: ['group-b']
      },
      {
        id: 'group-b',
        title: '子分组',
        bookmarkIds: [],
        bookmarkGroupIds: ['group-a']
      }
    ]
  }))

  assert.deepEqual(parsed.bookmarkGroups, [
    {
      id: 'group-a',
      title: '生产环境',
      bookmarkIds: ['server-1'],
      bookmarkGroupIds: ['group-b']
    },
    {
      id: 'group-b',
      title: '子分组',
      bookmarkIds: [],
      bookmarkGroupIds: []
    }
  ])
})

test('uses secure bookmark backup actions from every toolbar export entry', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/tree-list/bookmark-toolbar.jsx'),
    'utf8'
  )

  assert.match(source, /createBookmarkBackup/)
  assert.match(source, /createEncryptedBookmarkBackup/)
  assert.match(source, /download\('shellpilot-bookmarks-plaintext-/)
  assert.match(source, /download\('shellpilot-bookmarks-no-credentials-/)
  assert.match(source, /download\('shellpilot-bookmarks-encrypted-/)
  assert.match(source, /window\.prompt/)
  assert.match(source, /includeCredentials:\s*false/)
  assert.match(source, /onClick:\s*handleDownloadEncrypted/)
  assert.match(source, /label:\s*`\$\{e\('export'\)\} \$\{e\('shellpilotWithoutCredentials'\)\}`[\s\S]*?onClick:\s*handleDownloadWithoutCredentials/)
  assert.match(source, /handleDownloadPlaintext/)
  assert.match(source, /window\.confirm/)
  assert.doesNotMatch(source, /onClick:\s*onExport/)
})

function pathToFileURL (filePath) {
  return new URL(`file://${filePath.replace(/\\/g, '/')}`).href
}
