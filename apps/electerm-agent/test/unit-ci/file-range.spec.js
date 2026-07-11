const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fss = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

process.env.NODE_ENV = 'development'
const { fsExport } = require('../../src/app/lib/fs')

function loadRangeHelpers () {
  return require('../../src/app/common/file-range')
}

function createReader (value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const reads = []
  return {
    reads,
    reader: {
      async size () {
        return buffer.length
      },
      async read (offset, length) {
        reads.push({ offset, length })
        return buffer.subarray(offset, offset + length)
      }
    }
  }
}

describe('local file range reading', () => {
  test('reads a complete small text file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electerm-file-range-'))
    const filePath = path.join(root, 'small.txt')
    const content = 'hello\nrange'
    fs.writeFileSync(filePath, content)

    try {
      assert.deepEqual(await fsExport.readFileRange(filePath), {
        content,
        binary: false,
        offset: 0,
        nextOffset: Buffer.byteLength(content),
        totalBytes: Buffer.byteLength(content),
        bytesRead: Buffer.byteLength(content),
        hasMore: false
      })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('closes the file handle when reading fails', async () => {
    const originalOpen = fss.open
    let closed = false
    fss.open = async () => ({
      async stat () {
        return { size: 10 }
      },
      async read () {
        throw new Error('read failed')
      },
      async close () {
        closed = true
      }
    })

    try {
      await assert.rejects(
        fsExport.readFileRange('unused.txt'),
        /read failed/
      )
      assert.equal(closed, true)
    } finally {
      fss.open = originalOpen
    }
  })
})

describe('file range helpers', () => {
  test('normalizes invalid options and caps maxBytes at 1 MiB', () => {
    const {
      DEFAULT_RANGE_BYTES,
      MAX_RANGE_BYTES,
      normalizeRangeOptions
    } = loadRangeHelpers()

    for (const offset of [
      undefined,
      null,
      -1,
      1.5,
      '1',
      NaN,
      Number.MAX_SAFE_INTEGER + 1
    ]) {
      assert.equal(normalizeRangeOptions({ offset }).offset, 0)
    }
    for (const maxBytes of [
      undefined,
      null,
      0,
      -1,
      1.5,
      '1024',
      NaN,
      Number.MAX_SAFE_INTEGER + 1
    ]) {
      assert.equal(
        normalizeRangeOptions({ maxBytes }).maxBytes,
        DEFAULT_RANGE_BYTES
      )
    }
    assert.deepEqual(normalizeRangeOptions({ offset: 12, maxBytes: 128 }), {
      offset: 12,
      maxBytes: 128
    })
    assert.equal(
      normalizeRangeOptions({ maxBytes: 2 * MAX_RANGE_BYTES }).maxBytes,
      MAX_RANGE_BYTES
    )
  })

  test('uses bounded default and explicit read sizes', async () => {
    const {
      DEFAULT_RANGE_BYTES,
      MAX_RANGE_BYTES,
      readTextRange
    } = loadRangeHelpers()
    const value = Buffer.alloc(MAX_RANGE_BYTES + 16, 0x61)

    const defaultReader = createReader(value)
    const defaultResult = await readTextRange(defaultReader.reader)
    assert.equal(defaultResult.bytesRead, DEFAULT_RANGE_BYTES)
    assert.ok(defaultReader.reads[0].length <= DEFAULT_RANGE_BYTES + 4)

    const cappedReader = createReader(value)
    const cappedResult = await readTextRange(cappedReader.reader, {
      maxBytes: 2 * MAX_RANGE_BYTES
    })
    assert.equal(cappedResult.bytesRead, MAX_RANGE_BYTES)
    assert.ok(cappedReader.reads[0].length <= MAX_RANGE_BYTES + 4)
  })

  test('reads from a non-zero offset through the end of the file', async () => {
    const { readTextRange } = loadRangeHelpers()
    const { reader } = createReader('0123456789')

    assert.deepEqual(await readTextRange(reader, { offset: 4, maxBytes: 20 }), {
      content: '456789',
      binary: false,
      offset: 4,
      nextOffset: 10,
      totalBytes: 10,
      bytesRead: 6,
      hasMore: false
    })
  })

  test('returns an empty range at or beyond the file tail', async () => {
    const { readTextRange } = loadRangeHelpers()
    const { reader } = createReader('tail')

    for (const offset of [4, 40]) {
      assert.deepEqual(await readTextRange(reader, { offset }), {
        content: '',
        binary: false,
        offset: 4,
        nextOffset: 4,
        totalBytes: 4,
        bytesRead: 0,
        hasMore: false
      })
    }
  })

  test('reads consecutive ranges without overlap or omission', async () => {
    const { readTextRange } = loadRangeHelpers()
    const original = 'abcdefghij'
    const { reader } = createReader(original)
    const first = await readTextRange(reader, { maxBytes: 4 })
    const second = await readTextRange(reader, {
      offset: first.nextOffset,
      maxBytes: 6
    })

    assert.equal(first.content + second.content, original)
    assert.equal(first.nextOffset, second.offset)
    assert.equal(second.nextOffset, Buffer.byteLength(original))
  })

  test('keeps UTF-8 boundaries safe across consecutive ranges', async () => {
    const { readTextRange } = loadRangeHelpers()
    const original = '甲乙丙丁戊'
    const { reader } = createReader(original)
    const parts = []
    let offset = 0

    while (offset < Buffer.byteLength(original)) {
      const range = await readTextRange(reader, { offset, maxBytes: 4 })
      assert.equal(range.content.includes('\ufffd'), false)
      assert.ok(Buffer.byteLength(range.content) <= 4)
      assert.ok(range.nextOffset > offset)
      parts.push(range.content)
      offset = range.nextOffset
    }

    assert.equal(parts[0], '甲')
    assert.equal(parts.join(''), original)
  })

  test('advances an offset inside a UTF-8 character to the next character', async () => {
    const { readTextRange } = loadRangeHelpers()
    const { reader } = createReader('甲乙丙')
    const result = await readTextRange(reader, { offset: 1, maxBytes: 5 })

    assert.equal(result.offset, 3)
    assert.equal(result.content, '乙')
    assert.equal(result.content.includes('\ufffd'), false)
    assert.equal(result.nextOffset, 6)
    assert.equal(result.bytesRead, 3)
    assert.equal(result.bytesRead, result.nextOffset - result.offset)
    assert.equal(result.hasMore, true)

    const narrowResult = await readTextRange(reader, { offset: 1, maxBytes: 1 })
    assert.equal(narrowResult.offset, 3)
    assert.equal(narrowResult.nextOffset, 3)
    assert.equal(narrowResult.content, '')
    assert.equal(narrowResult.bytesRead, 0)
    assert.equal(
      narrowResult.bytesRead,
      narrowResult.nextOffset - narrowResult.offset
    )
  })

  test('marks binary content without exposing it as text', async () => {
    const { readTextRange } = loadRangeHelpers()
    const value = Buffer.from([0x61, 0x00, 0x62, 0x63])
    const { reader } = createReader(value)

    assert.deepEqual(await readTextRange(reader), {
      content: '',
      binary: true,
      offset: 0,
      nextOffset: value.length,
      totalBytes: value.length,
      bytesRead: value.length,
      hasMore: false
    })
  })
})
