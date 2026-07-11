const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { EventEmitter } = require('node:events')
const { Readable } = require('node:stream')
const { pathToFileURL } = require('node:url')
const zlib = require('node:zlib')
const { instSftpKeys: serverSftpKeys } = require('../../src/app/common/constants')
const {
  readRemoteFilePreview,
  readRemoteFileRange,
  listRemoteArchive,
  readRemoteArchiveTextEntry
} = require('../../src/app/server/sftp-file')

const root = path.resolve(__dirname, '../..')
const contextActionsUrl = pathToFileURL(
  path.join(root, 'src/client/components/ai/ai-chat-context-actions.js')
).href

function createFakeSftpStream () {
  const stream = new EventEmitter()
  stream.destroyedByPreview = false
  stream.destroy = () => {
    stream.destroyedByPreview = true
  }
  return stream
}

function createFakeRangeSftp (value, options = {}) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const state = {
    closeCalled: false,
    readCalls: []
  }
  const fd = 42
  return {
    state,
    sftp: {
      open (remotePath, flags, callback) {
        assert.equal(remotePath, '/tmp/range.log')
        assert.equal(flags, 'r')
        callback(null, fd)
      },
      fstat (fileHandle, callback) {
        assert.equal(fileHandle, fd)
        callback(null, { size: buffer.length })
      },
      read (fileHandle, target, bufferOffset, length, position, callback) {
        assert.equal(fileHandle, fd)
        state.readCalls.push({ length, position })
        if (options.failRead) {
          callback(new Error('range read failed'))
          return
        }
        const bytesRead = Math.min(
          options.chunkBytes || length,
          length,
          Math.max(0, buffer.length - position)
        )
        buffer.copy(target, bufferOffset, position, position + bytesRead)
        callback(null, bytesRead, target)
      },
      close (fileHandle, callback) {
        assert.equal(fileHandle, fd)
        state.closeCalled = true
        callback()
      }
    }
  }
}

test('SFTP preview method is exposed by both client and server RPC lists', () => {
  const clientConstants = fs.readFileSync(
    path.join(root, 'src/client/common/constants.js'),
    'utf8'
  )
  const clientSftp = fs.readFileSync(
    path.join(root, 'src/client/common/sftp.js'),
    'utf8'
  )

  assert.equal(serverSftpKeys.includes('readFilePreview'), true)
  assert.equal(serverSftpKeys.includes('readFileRange'), true)
  assert.match(clientConstants, /instSftpKeys[\s\S]*'readFilePreview'/)
  assert.match(clientConstants, /instSftpKeys[\s\S]*'readFileRange'/)
  assert.match(clientSftp, /keys\.forEach\(func/)
})

test('remote range reads bounded SFTP pages and closes the handle', async () => {
  const fake = createFakeRangeSftp('abcdefghi', { chunkBytes: 2 })

  const result = await readRemoteFileRange(fake.sftp, '/tmp/range.log', {
    maxBytes: 4
  })

  assert.deepEqual(result, {
    content: 'abcd',
    binary: false,
    offset: 0,
    nextOffset: 4,
    totalBytes: 9,
    bytesRead: 4,
    hasMore: true
  })
  assert.equal(fake.state.closeCalled, true)
  assert.ok(fake.state.readCalls.length > 1)
  assert.ok(fake.state.readCalls.every(call => call.length <= 8))
})

test('remote range closes the SFTP handle when reading fails', async () => {
  const fake = createFakeRangeSftp('abcdefghi', { failRead: true })

  await assert.rejects(
    readRemoteFileRange(fake.sftp, '/tmp/range.log', { maxBytes: 4 }),
    /range read failed/
  )
  assert.equal(fake.state.closeCalled, true)
})

test('remote archive adapters read compressed logs without remote extraction', async () => {
  const archive = zlib.gzipSync('remote archive\n')
  const sftp = {
    stat (remotePath, callback) {
      assert.equal(remotePath, '/tmp/range.log.gz')
      callback(null, { size: archive.length })
    },
    createReadStream (remotePath) {
      assert.equal(remotePath, '/tmp/range.log.gz')
      return Readable.from(archive)
    }
  }

  const listing = await listRemoteArchive(sftp, '/tmp/range.log.gz')
  assert.deepEqual(listing.entries.map(entry => entry.path), ['range.log'])

  const result = await readRemoteArchiveTextEntry(
    sftp,
    '/tmp/range.log.gz',
    'range.log',
    { maxBytes: 64 }
  )
  assert.equal(result.content, 'remote archive\n')
  assert.equal(result.archiveType, 'gz')
})

test('remote preview rejects a stream that closes before end', async () => {
  const stream = createFakeSftpStream()
  const promise = readRemoteFilePreview({
    createReadStream: () => stream
  }, '/tmp/partial.log', 8)

  stream.emit('data', Buffer.from('ab'))
  stream.emit('close')

  await assert.rejects(promise, /提前关闭/)
})

test('remote preview keeps at most limit plus one byte and stops the stream', async () => {
  const stream = createFakeSftpStream()
  const promise = readRemoteFilePreview({
    createReadStream: () => stream
  }, '/tmp/oversized.log', 8)

  stream.emit('data', Buffer.alloc(1024, 0x61))
  const result = await promise

  assert.equal(result.content, 'aaaaaaaa')
  assert.equal(result.bytesRead, 8)
  assert.equal(result.truncated, true)
  assert.equal(stream.destroyedByPreview, true)
})

test('old SFTP backends fail closed without a full read', async () => {
  const { readSelectedSftpFileContext } = await import(contextActionsUrl)
  let fullReadCalled = false
  const result = await readSelectedSftpFileContext({
    sftpRef: {
      getSelectedFiles: () => [{
        name: 'small.log',
        path: '/tmp',
        type: 'remote',
        size: 8
      }],
      sftp: {
        readFile: async () => {
          fullReadCalled = true
          return 'small'
        }
      }
    }
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /安全预览/)
  assert.equal(fullReadCalled, false)
})

test('async prompt updates only replace the unchanged input value', async () => {
  const { replacePromptIfUnchanged } = await import(contextActionsUrl)

  assert.equal(replacePromptIfUnchanged('old', 'old', 'analysis'), 'analysis')
  assert.equal(replacePromptIfUnchanged('new typing', 'old', 'analysis'), 'new typing')
  assert.equal(replacePromptIfUnchanged('old', 'old', ''), '')
})
