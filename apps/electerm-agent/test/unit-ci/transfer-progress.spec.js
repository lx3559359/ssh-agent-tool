const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const Module = require('node:module')

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'original-fs') {
    return fs
  }
  if (request === '../common/log') {
    return {
      error () {},
      warn () {},
      info () {},
      log () {}
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}
const { Transfer } = require(path.resolve(__dirname, '../../src/app/server/transfer'))
Module._load = originalLoad

function makeTmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-transfer-'))
}

function createFsLikeSftp () {
  return {
    open: fs.open,
    fstat: fs.fstat,
    stat: fs.stat,
    read: fs.read,
    write: fs.write,
    close: fs.close,
    fchmod: fs.fchmod,
    chmod: fs.chmod,
    futimes: fs.futimes,
    utimes: fs.utimes
  }
}

function waitForTransferMessage (buildTransfer, transferId) {
  const messages = []
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for transfer result. Messages: ${JSON.stringify(messages)}`))
    }, 3000)
    const ws = {
      s (message) {
        messages.push(message)
        if (message.id === `transfer:end:${transferId}` ||
          message.id === `transfer:err:${transferId}`) {
          clearTimeout(timer)
          resolve({ message, messages, transfer })
        }
      }
    }
    const transfer = buildTransfer(ws)
  })
}

test('file transfer progress includes transferred bytes, chunk bytes, and total size', async () => {
  const tmp = makeTmpDir()
  const localPath = path.join(tmp, 'large-source.bin')
  const remotePath = path.join(tmp, 'remote-large.bin')
  const source = Buffer.alloc(256 * 1024)
  for (let index = 0; index < source.length; index++) {
    source[index] = index % 251
  }
  fs.writeFileSync(localPath, source)

  const messages = []
  let transfer
  const endMessage = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for transfer end. Messages: ${JSON.stringify(messages)}`))
    }, 3000)
    const ws = {
      s (message) {
        messages.push(message)
        if (message.id === 'transfer:end:large-upload') {
          clearTimeout(timer)
          resolve(message)
        }
      }
    }

    transfer = new Transfer({
      id: 'large-upload',
      type: 'upload',
      localPath,
      remotePath,
      sftp: createFsLikeSftp(),
      options: {
        chunkSize: 32 * 1024,
        concurrency: 2
      },
      ws
    })
  })
  transfer.kill()

  const progressMessages = messages.filter(message => message.id === 'transfer:data:large-upload')
  assert.ok(progressMessages.length > 0, 'transfer should emit progress messages')
  assert.deepEqual(progressMessages[0].data, {
    transferred: 32 * 1024,
    chunk: 32 * 1024,
    total: source.length
  })
  assert.equal(endMessage.id, 'transfer:end:large-upload')
  assert.deepEqual(fs.readFileSync(remotePath), source)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test('file transfer downloads large binary files with progress and byte integrity', async () => {
  const tmp = makeTmpDir()
  const remotePath = path.join(tmp, 'remote-source-large.bin')
  const localPath = path.join(tmp, 'downloaded-large.bin')
  const source = Buffer.alloc(384 * 1024)
  for (let index = 0; index < source.length; index++) {
    source[index] = (index * 17) % 251
  }
  fs.writeFileSync(remotePath, source)

  const messages = []
  let transfer
  const endMessage = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for transfer end. Messages: ${JSON.stringify(messages)}`))
    }, 3000)
    const ws = {
      s (message) {
        messages.push(message)
        if (message.id === 'transfer:end:large-download') {
          clearTimeout(timer)
          resolve(message)
        }
      }
    }

    transfer = new Transfer({
      id: 'large-download',
      type: 'download',
      localPath,
      remotePath,
      sftp: createFsLikeSftp(),
      options: {
        chunkSize: 48 * 1024,
        concurrency: 3
      },
      ws
    })
  })
  transfer.kill()

  const progressMessages = messages.filter(message => message.id === 'transfer:data:large-download')
  assert.ok(progressMessages.length > 0, 'download should emit progress messages')
  assert.deepEqual(progressMessages[0].data, {
    transferred: 48 * 1024,
    chunk: 48 * 1024,
    total: source.length
  })
  assert.equal(endMessage.id, 'transfer:end:large-download')
  assert.deepEqual(fs.readFileSync(localPath), source)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test('atomic SFTP upload replaces the destination only after the temporary file is complete', async () => {
  const tmp = makeTmpDir()
  const localPath = path.join(tmp, 'atomic-source.txt')
  const remotePath = path.join(tmp, 'atomic-target.txt')
  fs.writeFileSync(localPath, 'new-content')
  fs.writeFileSync(remotePath, 'old-content')

  const renameCalls = []
  const sftp = {
    ...createFsLikeSftp(),
    _extensions: {
      'posix-rename@openssh.com': '1'
    },
    ext_openssh_rename (fromPath, toPath, callback) {
      renameCalls.push({ fromPath, toPath })
      fs.rename(fromPath, toPath, callback)
    },
    unlink: fs.unlink
  }

  const { message, transfer } = await waitForTransferMessage(ws => new Transfer({
    id: 'atomic-upload',
    type: 'upload',
    localPath,
    remotePath,
    sftp,
    options: {
      atomicUpload: true,
      chunkSize: 4,
      concurrency: 1
    },
    ws
  }), 'atomic-upload')
  transfer.kill()

  assert.equal(message.id, 'transfer:end:atomic-upload')
  assert.equal(renameCalls.length, 1)
  assert.notEqual(renameCalls[0].fromPath, remotePath)
  assert.equal(renameCalls[0].toPath, remotePath)
  assert.match(path.basename(renameCalls[0].fromPath), /^\.atomic-target\.txt\.shellpilot-upload-[a-zA-Z0-9_-]+\.part$/)
  assert.equal(fs.readFileSync(remotePath, 'utf8'), 'new-content')
  assert.equal(fs.existsSync(renameCalls[0].fromPath), false)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test('failed atomic SFTP upload keeps the original destination and removes the partial file', async () => {
  const tmp = makeTmpDir()
  const localPath = path.join(tmp, 'failed-source.txt')
  const remotePath = path.join(tmp, 'failed-target.txt')
  fs.writeFileSync(localPath, 'new-content-that-must-not-replace-the-old-file')
  fs.writeFileSync(remotePath, 'old-content')

  const openedDestinations = []
  const sftp = {
    ...createFsLikeSftp(),
    open (filePath, flags, callback) {
      if (flags === 'w') openedDestinations.push(filePath)
      fs.open(filePath, flags, callback)
    },
    write (handle, buffer, offset, length, position, callback) {
      const error = new Error('socket closed during upload')
      error.code = 'ECONNRESET'
      callback(error)
    },
    ext_openssh_rename: fs.rename,
    unlink: fs.unlink
  }

  const { message, transfer } = await waitForTransferMessage(ws => new Transfer({
    id: 'failed-atomic-upload',
    type: 'upload',
    localPath,
    remotePath,
    sftp,
    options: {
      atomicUpload: true,
      chunkSize: 4,
      concurrency: 1
    },
    ws
  }), 'failed-atomic-upload')
  transfer.kill()

  assert.equal(message.id, 'transfer:err:failed-atomic-upload')
  assert.equal(fs.readFileSync(remotePath, 'utf8'), 'old-content')
  assert.equal(openedDestinations.length, 1)
  assert.notEqual(openedDestinations[0], remotePath)
  assert.equal(fs.existsSync(openedDestinations[0]), false)

  fs.rmSync(tmp, { recursive: true, force: true })
})
