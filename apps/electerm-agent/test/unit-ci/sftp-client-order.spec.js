const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { importModule } = require('./helpers/import-esm')

test('subscribes to SFTP RPC results before sending the request', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/common/sftp.js'
  ), 'utf8')
  const request = source.indexOf("action: 'sftp-func'")
  const responseSubscription = source.indexOf('ws.once((arg) =>')

  assert.ok(request >= 0, 'SFTP RPC request must exist')
  assert.ok(responseSubscription >= 0, 'SFTP RPC response subscription must exist')
  assert.ok(
    responseSubscription < request,
    'SFTP RPC response subscription must be installed before a fast response can arrive'
  )
})

test('SFTP transport captures one immutable SSH session generation', async () => {
  const { bindSftpTransportGeneration } = await importModule(
    'src/client/common/sftp-session-generation.js'
  )
  const transport = {}

  assert.equal(
    bindSftpTransportGeneration(transport, 'ssh-generation-one'),
    'ssh-generation-one'
  )
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(transport, 'sshSessionGeneration'),
    {
      value: 'ssh-generation-one',
      enumerable: true,
      configurable: false,
      writable: false
    }
  )
  assert.throws(
    () => bindSftpTransportGeneration(transport, 'ssh-generation-two'),
    /generation|redefine|重定义/i
  )
})

test('SFTP connect request and response are bound to the captured generation', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/common/sftp.js'
  ), 'utf8')

  assert.match(source, /sshSessionGeneration: generation/)
  assert.match(
    source,
    /arg\.data\?\.sshSessionGeneration !== generation/
  )
})
