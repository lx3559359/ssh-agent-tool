const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { importModule } = require('./helpers/import-esm')

const digestModule =
  'src/client/components/sftp/streaming-sha256.js'

function expectedSha256 (value) {
  return createHash('sha256').update(value).digest('hex')
}

test('streaming SHA-256 matches standard vectors across arbitrary chunks', async () => {
  const { createStreamingSha256 } = await importModule(digestModule)
  for (const value of [
    Buffer.alloc(0),
    Buffer.from('abc'),
    Buffer.from('a'.repeat(1000000)),
    Buffer.from(Array.from({ length: 257 }, (_, index) => index & 0xff))
  ]) {
    for (const chunkSize of [1, 7, 63, 64, 65, 8192]) {
      const digest = createStreamingSha256()
      for (let offset = 0; offset < value.length; offset += chunkSize) {
        digest.update(value.subarray(offset, offset + chunkSize))
      }
      assert.equal(digest.size, value.length)
      assert.equal(digest.digestHex(), expectedSha256(value))
    }
  }
})

test('streaming SHA-256 rejects updates after finalization', async () => {
  const { createStreamingSha256 } = await importModule(digestModule)
  const digest = createStreamingSha256()
  digest.update(new TextEncoder().encode('abc'))
  assert.equal(digest.digestHex(), expectedSha256('abc'))
  assert.throws(() => digest.update(new Uint8Array([1])), /final|完成|结束/i)
  assert.equal(digest.digestHex(), expectedSha256('abc'))
})
