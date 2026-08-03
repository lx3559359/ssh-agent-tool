const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

test('subscribes to terminal transfer events before starting the transfer', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/common/transfer.js'
  ), 'utf8')
  const start = source.indexOf("action: 'transfer-new'")
  const endSubscription = source.indexOf("'transfer:end:' + id")
  const errorSubscription = source.indexOf("'transfer:err:' + id")

  assert.ok(endSubscription >= 0, 'transfer end subscription must exist')
  assert.ok(errorSubscription >= 0, 'transfer error subscription must exist')
  assert.ok(start >= 0, 'transfer start message must exist')
  assert.ok(
    endSubscription < start && errorSubscription < start,
    'terminal event subscriptions must be installed before a zero-byte transfer can finish'
  )
})
