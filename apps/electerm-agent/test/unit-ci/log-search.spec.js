const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  searchTextReader
} = require('../../src/app/common/log-search')

process.env.NODE_ENV = 'development'
const { fsExport } = require('../../src/app/lib/fs')

function makeReaderFromPages (pages) {
  const calls = []
  return {
    calls,
    reader: {
      async readFileRange (options) {
        calls.push(options)
        return pages.shift()
      }
    }
  }
}

test('searches a large log through bounded range reads', async () => {
  const pages = [
    {
      content: 'INFO boot\nWARN slow\nERR',
      binary: false,
      offset: 0,
      nextOffset: 23,
      totalBytes: 44,
      hasMore: true
    },
    {
      content: 'OR failed\nINFO retry\nERROR done\n',
      binary: false,
      offset: 23,
      nextOffset: 54,
      totalBytes: 54,
      hasMore: false
    }
  ]
  const source = makeReaderFromPages(pages)

  const result = await searchTextReader(source.reader, {
    query: 'ERROR',
    maxMatches: 2,
    contextLines: 1,
    chunkBytes: 8
  })

  assert.equal(result.matches.length, 2)
  assert.equal(result.matches[0].line, 'ERROR failed')
  assert.deepEqual(result.matches[0].before, ['WARN slow'])
  assert.deepEqual(result.matches[0].after, ['INFO retry'])
  assert.equal(result.matches[1].line, 'ERROR done')
  assert.equal(result.truncated, false)
  assert.equal(result.scannedBytes, 54)
  assert.ok(source.calls.every(call => call.maxBytes <= 8))
})

test('stops when maxMatches is reached and reports continuation offset', async () => {
  const source = makeReaderFromPages([
    {
      content: 'ERROR one\nERROR two\nERROR three\n',
      binary: false,
      offset: 0,
      nextOffset: 32,
      totalBytes: 64,
      hasMore: true
    }
  ])

  const result = await searchTextReader(source.reader, {
    query: 'error',
    maxMatches: 1,
    caseSensitive: false,
    chunkBytes: 16
  })

  assert.equal(result.matches.length, 1)
  assert.equal(result.truncated, true)
  assert.equal(result.nextOffset, 32)
})

test('rejects empty long or binary searches with clear errors', async () => {
  await assert.rejects(
    searchTextReader({ readFileRange: async () => ({}) }, { query: '' }),
    /关键词|query/
  )
  await assert.rejects(
    searchTextReader({ readFileRange: async () => ({}) }, {
      query: 'x'.repeat(257)
    }),
    /关键词|query/
  )
  await assert.rejects(
    searchTextReader({
      readFileRange: async () => ({
        binary: true,
        content: '',
        offset: 0,
        nextOffset: 3,
        totalBytes: 3,
        hasMore: false
      })
    }, { query: 'ERROR' }),
    /二进制|binary/
  )
})

test('fsExport searches local text files without full reads', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-log-search-'))
  const filePath = path.join(root, 'app.log')
  fs.writeFileSync(filePath, 'INFO boot\nERROR failed\nINFO retry\n')

  try {
    const result = await fsExport.searchFileText(filePath, {
      query: 'ERROR',
      contextLines: 1,
      chunkBytes: 8
    })
    assert.equal(result.matches.length, 1)
    assert.equal(result.matches[0].line, 'ERROR failed')
    assert.deepEqual(result.matches[0].before, ['INFO boot'])
    assert.deepEqual(result.matches[0].after, ['INFO retry'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
