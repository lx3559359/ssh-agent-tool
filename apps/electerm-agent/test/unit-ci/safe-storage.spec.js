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
