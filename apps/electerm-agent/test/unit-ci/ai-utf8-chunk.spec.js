const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const modulePath = path.resolve(
  __dirname,
  '../../src/client/common/utf8-chunk.js'
)

test('UTF-8 chunk decoding resumes at complete character boundaries', async () => {
  const { decodeUtf8Chunk } = await import(pathToFileURL(modulePath))
  const all = new TextEncoder().encode('A中文B')
  const first = decodeUtf8Chunk(all.slice(0, 3), {
    offset: 0,
    totalBytes: all.length,
    hasMore: true
  })
  const second = decodeUtf8Chunk(all.slice(first.nextOffset), {
    offset: first.nextOffset,
    totalBytes: all.length,
    hasMore: false
  })

  assert.equal(first.content, 'A')
  assert.equal(first.nextOffset, 1)
  assert.equal(second.content, '中文B')
  assert.equal(second.nextOffset, all.length)
  assert.equal(second.hasMore, false)
})

test('UTF-8 chunk decoding ignores continuation bytes at arbitrary offsets', async () => {
  const { decodeUtf8Chunk } = await import(pathToFileURL(modulePath))
  const bytes = new TextEncoder().encode('中文')
  const decoded = decodeUtf8Chunk(bytes.slice(1), {
    offset: 1,
    totalBytes: bytes.length,
    hasMore: false
  })

  assert.equal(decoded.content, '文')
  assert.equal(decoded.offset, 3)
  assert.equal(decoded.nextOffset, bytes.length)
})

test('Agent SFTP reads request at least one complete UTF-8 code point', () => {
  const root = path.resolve(__dirname, '../..')
  const tools = fs.readFileSync(path.join(
    root,
    'src/client/components/ai/agent-tools.js'
  ), 'utf8')
  const handler = fs.readFileSync(path.join(
    root,
    'src/client/store/mcp-handler.js'
  ), 'utf8')

  assert.match(tools, /maxBytes:\s*\{[\s\S]{0,160}minimum:\s*4/)
  assert.match(handler, /Math\.max\(4,\s*Math\.min\(requestedMaxBytes,\s*32 \* 1024\)\)/)
})
