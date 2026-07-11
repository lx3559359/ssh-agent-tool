const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isLikelyBinaryBuffer,
  createTextFilePreview
} = require('../../src/app/common/file-preview')

test('truncated UTF-8 text backs up to the last complete character', () => {
  assert.deepEqual(
    createTextFilePreview(Buffer.from('a你'), { maxBytes: 2 }),
    {
      content: 'a',
      truncated: true,
      binary: false,
      bytesRead: 1
    }
  )
})

test('invalid UTF-8 remains binary when it is not an incomplete text tail', () => {
  assert.equal(isLikelyBinaryBuffer(Buffer.from([0xff, 0xff, 0xff])), true)
  assert.deepEqual(
    createTextFilePreview(Buffer.from([0xff, 0xff, 0xff]), { maxBytes: 2 }),
    {
      content: '',
      truncated: true,
      binary: true,
      bytesRead: 2
    }
  )
})
