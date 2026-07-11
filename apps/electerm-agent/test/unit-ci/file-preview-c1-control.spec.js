const test = require('node:test')
const assert = require('node:assert/strict')
const { isLikelyBinaryBuffer } = require('../../src/app/common/file-preview')

test('UTF-8 C1 control-heavy content is treated as binary-like', () => {
  assert.equal(
    isLikelyBinaryBuffer(Buffer.from('\u0081\u0082\u0083\u0084text')),
    true
  )
})

test('normal Unicode text remains text', () => {
  assert.equal(
    isLikelyBinaryBuffer(Buffer.from('正常中文文本\nwith tab\tvalue')),
    false
  )
})
