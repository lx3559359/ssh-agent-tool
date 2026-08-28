const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const zlib = require('node:zlib')
const JSZip = require('jszip')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/sftp/remote-file-context-reader.js'
)).href

function backendFor (contents, calls = []) {
  const bytes = Buffer.from(contents)
  return {
    async lstat (filePath, options) {
      calls.push(['lstat', filePath, options?.signal])
      return { type: 'f', size: bytes.length }
    },
    async readFileChunk (filePath, options) {
      calls.push([
        'readFileChunk',
        filePath,
        options.offset,
        options.maxBytes,
        options.signal
      ])
      const chunk = bytes.subarray(
        options.offset,
        options.offset + options.maxBytes
      )
      return {
        base64: chunk.toString('base64'),
        bytesRead: chunk.length,
        nextOffset: options.offset + chunk.length,
        totalBytes: bytes.length,
        hasMore: options.offset + chunk.length < bytes.length
      }
    }
  }
}

function tarEntry (name, contents) {
  const value = Buffer.from(contents)
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(`${value.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
  header.write('00000000000\0', 136, 12, 'ascii')
  header.fill(' ', 148, 156)
  header[156] = '0'.charCodeAt(0)
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  const padding = Buffer.alloc((512 - (value.length % 512)) % 512)
  return Buffer.concat([header, value, padding, Buffer.alloc(1024)])
}

function forgeZipUncompressedSize (value, size) {
  const bytes = Buffer.from(value)
  for (let offset = 0; offset + 30 <= bytes.length; offset++) {
    const signature = bytes.readUInt32LE(offset)
    if (signature === 0x04034b50) bytes.writeUInt32LE(size, offset + 22)
    if (signature === 0x02014b50) bytes.writeUInt32LE(size, offset + 24)
  }
  return bytes
}

test('bounded remote preview uses only lstat and readFileChunk with AbortSignal', async () => {
  const { createRemoteFileContextReader } = await import(moduleUrl)
  const calls = []
  const controller = new AbortController()
  const reader = createRemoteFileContextReader(
    backendFor('hello privileged file', calls),
    { signal: controller.signal }
  )

  assert.deepEqual(await reader.readFilePreview('/root/app.log', 5), {
    content: 'hello',
    truncated: true,
    binary: false,
    bytesRead: 5
  })
  assert.deepEqual(calls.map(call => call[0]), ['lstat', 'readFileChunk'])
  assert.equal(calls.every(call => call.at(-1) === controller.signal), true)
})

test('bounded remote archive reader supports zip and enforces entry limits', async () => {
  const { createRemoteFileContextReader } = await import(moduleUrl)
  const zip = new JSZip()
  zip.file('logs/error.log', 'zip context')
  const bytes = await zip.generateAsync({ type: 'nodebuffer' })
  const reader = createRemoteFileContextReader(backendFor(bytes))

  const listing = await reader.listArchive('/root/logs.zip')
  assert.deepEqual(listing.entries, [{ path: 'logs/error.log', size: 11 }])
  assert.deepEqual(
    await reader.readArchiveTextEntry(
      '/root/logs.zip',
      'logs/error.log',
      { maxBytes: 4 }
    ),
    {
      content: 'zip ',
      truncated: true,
      binary: false,
      bytesRead: 4,
      archiveType: 'zip',
      entryPath: 'logs/error.log'
    }
  )

  const many = new JSZip()
  for (let index = 0; index <= 512; index++) {
    many.file(`entry-${index}.log`, 'x')
  }
  const manyBytes = await many.generateAsync({ type: 'nodebuffer' })
  await assert.rejects(
    createRemoteFileContextReader(backendFor(manyBytes))
      .listArchive('/root/many.zip'),
    /512/
  )
})

test('bounded remote archive reader supports gzip and tgz without full remote reads', async () => {
  const { createRemoteFileContextReader } = await import(moduleUrl)
  const gzipReader = createRemoteFileContextReader(backendFor(
    zlib.gzipSync(Buffer.from('gzip context'))
  ))
  const gzipListing = await gzipReader.listArchive('/root/app.log.gz')
  assert.equal(gzipListing.entries[0].path, 'app.log')
  assert.equal((await gzipReader.readArchiveTextEntry(
    '/root/app.log.gz', 'app.log', { maxBytes: 4 }
  )).content, 'gzip')

  const tarBytes = tarEntry('logs/app.log', 'tar context')
  const tgzReader = createRemoteFileContextReader(backendFor(
    zlib.gzipSync(tarBytes)
  ))
  const tgzListing = await tgzReader.listArchive('/root/logs.tgz')
  assert.deepEqual(tgzListing.entries, [{ path: 'logs/app.log', size: 11 }])
  assert.equal((await tgzReader.readArchiveTextEntry(
    '/root/logs.tgz', 'logs/app.log', { maxBytes: 3 }
  )).content, 'tar')
})

test('archive compressed input and decompressed output have hard byte caps', async () => {
  const {
    REMOTE_CONTEXT_ARCHIVE_MAX_BYTES,
    REMOTE_CONTEXT_EXPANDED_MAX_BYTES,
    createRemoteFileContextReader
  } = await import(moduleUrl)
  const oversizedInput = {
    lstat: async () => ({
      type: 'f',
      size: REMOTE_CONTEXT_ARCHIVE_MAX_BYTES + 1
    }),
    readFileChunk: async () => assert.fail('oversized archive must not read')
  }
  await assert.rejects(
    createRemoteFileContextReader(oversizedInput).listArchive('/root/logs.zip'),
    /8 MiB/
  )

  const expanded = Buffer.alloc(REMOTE_CONTEXT_EXPANDED_MAX_BYTES + 1, 65)
  await assert.rejects(
    createRemoteFileContextReader(backendFor(zlib.gzipSync(expanded)))
      .listArchive('/root/bomb.tgz'),
    /8 MiB/
  )
})

test('preview rejects a backend chunk that exceeds the requested byte cap', async () => {
  const { createRemoteFileContextReader } = await import(moduleUrl)
  const backend = {
    lstat: async () => ({ type: 'f', size: 6 }),
    readFileChunk: async () => ({
      base64: Buffer.from('123456').toString('base64'),
      bytesRead: 6,
      nextOffset: 6,
      totalBytes: 6,
      hasMore: false
    })
  }
  await assert.rejects(
    createRemoteFileContextReader(backend).readFilePreview('/root/a', 5),
    /byte cap/
  )
})

test('forged zip size cannot trigger an unbounded full-entry inflate', async () => {
  const { createRemoteFileContextReader } = await import(moduleUrl)
  const zip = new JSZip()
  zip.file('bomb.log', Buffer.alloc(9 * 1024 * 1024, 65))
  const archive = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  })
  const forged = forgeZipUncompressedSize(archive, 1)
  const reader = createRemoteFileContextReader(backendFor(forged))

  const result = await reader.readArchiveTextEntry(
    '/root/bomb.zip',
    'bomb.log',
    { maxBytes: 4 }
  )
  assert.equal(result.content, 'AAAA')
  assert.equal(result.bytesRead, 4)
  assert.equal(result.truncated, true)
})
