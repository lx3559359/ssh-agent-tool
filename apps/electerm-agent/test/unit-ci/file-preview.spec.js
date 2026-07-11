const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  DEFAULT_FILE_PREVIEW_MAX_BYTES,
  normalizePreviewMaxBytes,
  isLikelyBinaryBuffer,
  createTextFilePreview
} = require('../../src/app/common/file-preview')

process.env.NODE_ENV = 'development'
const { fsExport } = require('../../src/app/lib/fs')

describe('file preview helpers', () => {
  test('returns a complete preview for small text', () => {
    const content = 'hello\npreview'

    assert.deepEqual(createTextFilePreview(Buffer.from(content), {}), {
      content,
      truncated: false,
      binary: false,
      bytesRead: Buffer.byteLength(content)
    })
  })

  test('truncates text at the normalized byte limit', () => {
    assert.deepEqual(
      createTextFilePreview(Buffer.from('abcdefgh'), {
        maxBytes: 5,
        truncated: false
      }),
      {
        content: 'abcde',
        truncated: true,
        binary: false,
        bytesRead: 5
      }
    )
  })

  test('does not expose content for buffers containing NUL bytes', () => {
    const buffer = Buffer.from([0x61, 0x62, 0x00, 0x63])

    assert.equal(isLikelyBinaryBuffer(buffer), true)
    assert.deepEqual(createTextFilePreview(buffer, {}), {
      content: '',
      truncated: false,
      binary: true,
      bytesRead: buffer.length
    })
  })

  test('recognizes control-heavy buffers while allowing text whitespace', () => {
    assert.equal(
      isLikelyBinaryBuffer(Buffer.from('line one\tvalue\nline two\r\n\f')),
      false
    )
    assert.equal(
      isLikelyBinaryBuffer(Buffer.from([0x61, 0x01, 0x02, 0x03, 0x62])),
      true
    )
  })

  test('normalizes invalid limits to the default and caps valid limits at 1 MiB', () => {
    for (const invalid of [undefined, null, 0, -1, 1.5, '1024', NaN]) {
      assert.equal(normalizePreviewMaxBytes(invalid), DEFAULT_FILE_PREVIEW_MAX_BYTES)
    }
    assert.equal(normalizePreviewMaxBytes(128), 128)
    assert.equal(normalizePreviewMaxBytes(2 * 1024 * 1024), 1024 * 1024)
  })
})

describe('local file preview', () => {
  test('reads only a bounded text prefix without changing readFile', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-file-preview-'))
    const filePath = path.join(root, 'large.txt')
    const content = '0123456789'.repeat(32)
    fs.writeFileSync(filePath, content)

    try {
      assert.deepEqual(await fsExport.readFilePreview(filePath, 12), {
        content: content.slice(0, 12),
        truncated: true,
        binary: false,
        bytesRead: 12
      })
      assert.equal(await fsExport.readFile(filePath), content)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
