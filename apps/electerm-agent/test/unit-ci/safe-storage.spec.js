const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

test('safe storage fallback encrypts secrets instead of returning plaintext', () => {
  const {
    safeEncrypt,
    safeDecrypt
  } = require(path.resolve(__dirname, '../../src/app/lib/safe-storage'))

  const secret = JSON.stringify({
    password: 'root-password',
    privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----'
  })

  const encrypted = safeEncrypt(secret)

  assert.notEqual(encrypted, secret)
  assert.equal(encrypted.includes('root-password'), false)
  assert.equal(encrypted.includes('OPENSSH PRIVATE KEY'), false)
  assert.equal(safeDecrypt(encrypted), secret)
})

test('sqlite bookmark storage does not write ssh credentials as plaintext', async () => {
  const {
    safeEncrypt,
    safeDecrypt
  } = require(path.resolve(__dirname, '../../src/app/lib/safe-storage'))
  const { createDb } = require(path.resolve(__dirname, '../../src/app/lib/sqlite'))
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-db-security-'))
  const { dbAction } = createDb(appPath, 'default_user', {
    enc: safeEncrypt,
    dec: safeDecrypt
  })

  const bookmark = {
    _id: 'server-1',
    host: '10.0.1.23',
    username: 'root',
    password: 'root-password',
    privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----'
  }

  await dbAction('bookmarks', 'insert', bookmark)

  const stored = fs.readFileSync(
    path.join(appPath, 'electerm', 'users', 'default_user', 'electerm.db')
  )
  const storedText = stored.toString('utf8')
  assert.equal(storedText.includes('root-password'), false)
  assert.equal(storedText.includes('OPENSSH PRIVATE KEY'), false)

  const [restored] = await dbAction('bookmarks', 'find', {})
  assert.equal(restored.password, 'root-password')
  assert.equal(restored.privateKey, '-----BEGIN OPENSSH PRIVATE KEY-----')
})

test('sqlite bookmark storage encrypts all server connection secrets at rest', async () => {
  const {
    safeEncrypt,
    safeDecrypt
  } = require(path.resolve(__dirname, '../../src/app/lib/safe-storage'))
  const { createDb } = require(path.resolve(__dirname, '../../src/app/lib/sqlite'))
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-db-server-secrets-'))
  const { dbAction } = createDb(appPath, 'default_user', {
    enc: safeEncrypt,
    dec: safeDecrypt
  })

  const bookmark = {
    _id: 'server-1',
    host: '10.0.1.23',
    username: 'root',
    password: 'root-password',
    privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
    passphrase: 'private-key-passphrase',
    certificate: 'ssh-user-certificate',
    proxy: 'socks5://proxy-user:proxy-password@127.0.0.1:1080',
    connectionHoppings: [
      {
        host: 'jump.example.com',
        username: 'jump',
        password: 'jump-password',
        privateKey: 'jump-private-key',
        passphrase: 'jump-passphrase'
      }
    ]
  }

  await dbAction('bookmarks', 'insert', bookmark)

  const stored = fs.readFileSync(
    path.join(appPath, 'electerm', 'users', 'default_user', 'electerm.db')
  ).toString('utf8')
  for (const secret of [
    'root-password',
    'OPENSSH PRIVATE KEY',
    'private-key-passphrase',
    'ssh-user-certificate',
    'proxy-password',
    'jump-password',
    'jump-private-key',
    'jump-passphrase'
  ]) {
    assert.equal(stored.includes(secret), false)
  }

  const [restored] = await dbAction('bookmarks', 'find', {})
  assert.equal(restored.password, bookmark.password)
  assert.equal(restored.privateKey, bookmark.privateKey)
  assert.equal(restored.passphrase, bookmark.passphrase)
  assert.equal(restored.certificate, bookmark.certificate)
  assert.equal(restored.proxy, bookmark.proxy)
  assert.deepEqual(restored.connectionHoppings, bookmark.connectionHoppings)
})

test('sqlite userConfig storage encrypts model api credentials at rest', async () => {
  const {
    safeEncrypt,
    safeDecrypt
  } = require(path.resolve(__dirname, '../../src/app/lib/safe-storage'))
  const { createDb } = require(path.resolve(__dirname, '../../src/app/lib/sqlite'))
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-db-user-config-security-'))
  const { dbAction } = createDb(appPath, 'default_user', {
    enc: safeEncrypt,
    dec: safeDecrypt
  })

  const config = {
    _id: 'userConfig',
    apiKeyAI: 'sk-live-secret',
    authHeaderNameAI: 'Authorization: Bearer',
    proxyAI: 'http://proxy-user:proxy-password@127.0.0.1:7890'
  }

  await dbAction('data', 'insert', config)

  const stored = fs.readFileSync(
    path.join(appPath, 'electerm', 'users', 'default_user', 'electerm_data.db')
  ).toString('utf8')
  assert.equal(stored.includes('sk-live-secret'), false)
  assert.equal(stored.includes('proxy-password'), false)

  const restored = await dbAction('data', 'findOne', { _id: 'userConfig' })
  assert.equal(restored.apiKeyAI, config.apiKeyAI)
  assert.equal(restored.proxyAI, config.proxyAI)
})
