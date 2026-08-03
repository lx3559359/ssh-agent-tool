const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

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
