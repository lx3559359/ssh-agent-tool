const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../../src/client/components/sftp')
const moduleUrl = pathToFileURL(path.join(root, 'sftp-text-change-preview.js')).href

test('builds an accurate bounded line preview for a remote text modification', async () => {
  const { buildSftpTextChangePreview } = await import(moduleUrl)
  const preview = buildSftpTextChangePreview({
    path: '/etc/example.conf',
    beforeText: 'enabled=false\nport=80\nkeep=yes\n',
    afterText: 'enabled=true\nport=8080\nkeep=yes\n'
  })

  assert.equal(preview.changeType, 'modified')
  assert.equal(preview.path, '/etc/example.conf')
  assert.equal(preview.addedLines, 2)
  assert.equal(preview.removedLines, 2)
  assert.equal(preview.truncated, false)
  assert.deepEqual(
    preview.lines.map(line => [line.type, line.text]),
    [
      ['remove', 'enabled=false'],
      ['remove', 'port=80'],
      ['add', 'enabled=true'],
      ['add', 'port=8080'],
      ['context', 'keep=yes']
    ]
  )
})

test('marks a new file and omits unchanged content outside bounded context', async () => {
  const { buildSftpTextChangePreview } = await import(moduleUrl)
  const preview = buildSftpTextChangePreview({
    path: '/etc/new.conf',
    beforeText: '',
    afterText: 'alpha=1\nbeta=2\n',
    existed: false,
    contextLines: 0
  })

  assert.equal(preview.changeType, 'created')
  assert.equal(preview.addedLines, 2)
  assert.equal(preview.removedLines, 0)
  assert.deepEqual(preview.lines.map(line => line.text), ['alpha=1', 'beta=2'])
})

test('truncates large previews without retaining the omitted remote content', async () => {
  const { buildSftpTextChangePreview } = await import(moduleUrl)
  const beforeText = Array.from({ length: 120 }, (_, index) => `old-secret-${index}`).join('\n')
  const afterText = Array.from({ length: 120 }, (_, index) => `new-value-${index}`).join('\n')
  const preview = buildSftpTextChangePreview({
    path: '/etc/large.conf',
    beforeText,
    afterText,
    maxPreviewLines: 12,
    maxLineLength: 32
  })

  assert.equal(preview.truncated, true)
  assert.ok(preview.lines.length <= 12)
  assert.equal(JSON.stringify(preview).includes('old-secret-119'), false)
  assert.equal(JSON.stringify(preview).includes('new-value-119'), false)
})

test('reads only a bounded verified snapshot for the confirmation preview', async () => {
  const { readSftpSnapshotText } = await import(moduleUrl)
  const calls = []
  const source = Buffer.from('first\nsecond\n', 'utf8')
  const sftp = {
    async readFileChunk (remotePath, options) {
      calls.push({ remotePath, ...options })
      const chunk = source.subarray(options.offset, options.offset + options.maxBytes)
      return {
        offset: options.offset,
        nextOffset: options.offset + chunk.length,
        totalBytes: source.length,
        bytesRead: chunk.length,
        hasMore: options.offset + chunk.length < source.length,
        base64: chunk.toString('base64')
      }
    }
  }
  const result = await readSftpSnapshotText(sftp, {
    snapshotPath: '/tmp/.shellpilot-transactions/op/target',
    original: { type: 'file', size: source.length }
  }, { maxBytes: 64 })

  assert.equal(result.available, true)
  assert.equal(result.text, 'first\nsecond\n')
  assert.deepEqual(calls, [{
    remotePath: '/tmp/.shellpilot-transactions/op/target',
    offset: 0,
    maxBytes: source.length
  }])
})

test('Agent remote text writes surface the preview through the existing single SFTP confirmation', () => {
  const source = fs.readFileSync(path.join(root, 'sftp-entry.jsx'), 'utf8')

  assert.match(source, /buildSftpTextChangePreview/)
  assert.match(source, /readSftpSnapshotText/)
  assert.match(source, /confirmationDetails/)
  assert.match(
    source,
    /let confirmationDetails = options\.confirmationDetails/
  )
  assert.match(
    source,
    /confirmPreparedSftpOperation\([\s\S]{0,180}confirmationDetails/
  )
  assert.match(
    source,
    /formatShellPilotTranslation\(\s*e,\s*'shellpilotSftpTextChangeSummary',\s*\{/
  )
})
