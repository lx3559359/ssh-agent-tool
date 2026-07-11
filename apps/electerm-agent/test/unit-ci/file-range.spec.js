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

  test('combines short reads until the requested range or EOF', async () => {
    const originalOpen = fss.open
    const value = Buffer.from('short read text')
    let readCalls = 0
    fss.open = async () => ({
      async stat () {
        return { size: value.length }
      },
      async read (buffer, bufferOffset, length, position) {
        const bytesRead = Math.min(2, length, value.length - position)
        value.copy(buffer, bufferOffset, position, position + bytesRead)
        readCalls += 1
        return { bytesRead, buffer }
      },
      async close () {}
    })

    try {
      const result = await fsExport.readFileRange('unused.txt', {
        maxBytes: value.length
      })
      assert.equal(result.content, value.toString())
      assert.equal(result.hasMore, false)
      assert.ok(readCalls > 1)
    } finally {
      fss.open = originalOpen
    }
  })

  test('rechecks size after a zero-byte read caused by truncation', async () => {
    const originalOpen = fss.open
    let statCalls = 0
    fss.open = async () => ({
      async stat () {
        statCalls += 1
        return { size: statCalls === 1 ? 10 : 0 }
      },
      async read () {
        return { bytesRead: 0, buffer: Buffer.alloc(0) }
      },
      async close () {}
    })

    try {
      assert.deepEqual(await fsExport.readFileRange('unused.txt'), {
        content: '',
        binary: false,
        offset: 0,
        nextOffset: 0,
        totalBytes: 0,
        bytesRead: 0,
        hasMore: false
      })
      assert.equal(statCalls, 2)
    } finally {
      fss.open = originalOpen
    }
  })

  test('reassembles a large real UTF-8 file from bounded ranges', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electerm-file-range-'))
    const filePath = path.join(root, 'large.txt')
    const content = '行甲乙丙\n'.repeat(2000)
    fs.writeFileSync(filePath, content)
    const parts = []
    let offset = 0

    try {
      while (offset < Buffer.byteLength(content)) {
        const range = await fsExport.readFileRange(filePath, {
          offset,
          maxBytes: 257
        })
        assert.ok(range.nextOffset > offset)
        assert.ok(Buffer.byteLength(range.content) <= 257)
        parts.push(range.content)
        offset = range.nextOffset
      }
      assert.equal(parts.join(''), content)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('corrects a non-zero UTF-8 offset in a real file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electerm-file-range-'))
    const filePath = path.join(root, 'utf8.txt')
    fs.writeFileSync(filePath, '甲乙丙')

    try {
      const range = await fsExport.readFileRange(filePath, {
        offset: 1,
        maxBytes: 5
      })
      assert.equal(range.binary, false)
      assert.equal(range.offset, 3)
      assert.equal(range.content, '乙')
      assert.equal(range.nextOffset, 6)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('rejects binary content from a real file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electerm-file-range-'))
    const filePath = path.join(root, 'binary.bin')
    fs.writeFileSync(filePath, Buffer.from([0x61, 0x00, 0x62]))

    try {
      const range = await fsExport.readFileRange(filePath)
      assert.equal(range.binary, true)
      assert.equal(range.content, '')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('file range helpers', () => {
  test('normalizes invalid options and caps maxBytes at 1 MiB', () => {
    const {
      DEFAULT_RANGE_BYTES,
      MIN_RANGE_BYTES,
      MAX_RANGE_BYTES,
      normalizeRangeOptions
    } = loadRangeHelpers()

    assert.equal(MIN_RANGE_BYTES, 4)

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
    for (const maxBytes of [1, 2, 3]) {
      assert.equal(normalizeRangeOptions({ maxBytes }).maxBytes, MIN_RANGE_BYTES)
    }
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

  test('normalizes tiny ranges and always advances while more text remains', async () => {
    const { readTextRange } = loadRangeHelpers()
    const original = '甲乙丙丁戊'

    for (const maxBytes of [1, 2, 3]) {
      const { reader } = createReader(original)
      const parts = []
      let offset = 0

      while (offset < Buffer.byteLength(original)) {
        const range = await readTextRange(reader, { offset, maxBytes })
        if (range.hasMore) {
          assert.ok(range.nextOffset > offset)
        }
        parts.push(range.content)
        offset = range.nextOffset
      }

      assert.equal(parts.join(''), original)
    }
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

  test('does not skip unproven continuation bytes at a non-zero offset', async () => {
    const { readTextRange } = loadRangeHelpers()
    const value = Buffer.from([0x61, 0x80, 0x80, 0x80, 0x80, 0x80, 0x62])
    const source = createReader(value)
    let offset = 1
    let sawBinary = false

    while (offset < value.length) {
      const range = await readTextRange(source.reader, {
        offset,
        maxBytes: 4
      })
      sawBinary = sawBinary || range.binary
      assert.ok(range.nextOffset > offset)
      offset = range.nextOffset
    }

    assert.equal(sawBinary, true)
    assert.ok(source.reads.every(read => read.length <= 8))
  })
})
