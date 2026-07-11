const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { EventEmitter } = require('node:events')
const { pathToFileURL } = require('node:url')
const { instSftpKeys: serverSftpKeys } = require('../../src/app/common/constants')
const { readRemoteFilePreview } = require('../../src/app/server/sftp-file')

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
  assert.match(clientConstants, /instSftpKeys[\s\S]*'readFilePreview'/)
  assert.match(clientSftp, /keys\.forEach\(func/)
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
