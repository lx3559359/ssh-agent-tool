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
const { Transfer: FtpTransfer } = require(path.resolve(
  __dirname,
  '../../src/app/server/ftp-transfer'
))
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
  assert.deepEqual(endMessage.data, {
    transferred: source.length,
    size: source.length
  })
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
  assert.deepEqual(endMessage.data, {
    transferred: source.length,
    size: source.length
  })
  assert.deepEqual(fs.readFileSync(localPath), source)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test('failed fchmod falls back to chmod once and then terminates on failure', async () => {
  const tmp = makeTmpDir()
  const localPath = path.join(tmp, 'mode-source.txt')
  const remotePath = path.join(tmp, 'mode-target.txt')
  fs.writeFileSync(localPath, 'mode-content')

  let fchmodCalls = 0
  let chmodCalls = 0
  const sftp = {
    ...createFsLikeSftp(),
    fchmod (handle, mode, callback) {
      fchmodCalls += 1
      callback(new Error('fchmod unsupported'))
    },
    chmod (filePath, mode, callback) {
      chmodCalls += 1
      callback(new Error('chmod denied'))
    }
  }

  const { message, transfer } = await waitForTransferMessage(ws => new Transfer({
    id: 'mode-fallback-fails',
    type: 'upload',
    localPath,
    remotePath,
    sftp,
    options: {
      mode: 0o600,
      chunkSize: 4,
      concurrency: 1
    },
    ws
  }), 'mode-fallback-fails')
  transfer.kill()

  assert.equal(message.id, 'transfer:err:mode-fallback-fails')
  assert.match(String(message.error?.message || ''), /chmod denied/)
  assert.equal(fchmodCalls, 1)
  assert.equal(chmodCalls, 1)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test('terminal cancellation waits for a late source handle to close', async () => {
  const tmp = makeTmpDir()
  const remotePath = path.join(tmp, 'late-source.bin')
  const localPath = path.join(tmp, 'late-download.bin')
  fs.writeFileSync(remotePath, Buffer.alloc(64 * 1024, 0x61))
  let releaseOpen
  let closeCount = 0
  const sftp = {
    ...createFsLikeSftp(),
    open (filePath, flags, callback) {
      releaseOpen = () => fs.open(filePath, flags, callback)
    },
    close (handle, callback) {
      closeCount += 1
      setTimeout(() => fs.close(handle, callback), 50)
    }
  }
  const transfer = new Transfer({
    id: 'late-source-cancel',
    type: 'download',
    localPath,
    remotePath,
    sftp,
    options: { chunkSize: 32 * 1024, concurrency: 1 },
    ws: { s () {} }
  })

  const cancelling = transfer.cancel()
  releaseOpen()
  assert.equal(closeCount, 0)
  assert.equal(await cancelling, true)
  assert.equal(closeCount, 1)
  assert.equal(fs.existsSync(localPath), false)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test('FTP terminal cancellation joins a late operation client before acknowledging', async () => {
  let resolveClient
  const clientReady = new Promise(resolve => { resolveClient = resolve })
  let releaseClose
  const closeGate = new Promise(resolve => { releaseClose = resolve })
  let uploadCalls = 0
  let closeCalls = 0
  const transfer = new FtpTransfer({
    id: 'late-ftp-control',
    type: 'upload',
    localPath: 'C:/tmp/source.bin',
    remotePath: '/target.bin',
    ftpSession: {
      createOperationClient: () => clientReady
    },
    ws: { s () {} }
  })

  let settled = false
  const cancelling = transfer.cancel().finally(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)

  resolveClient({
    trackProgress () {},
    async uploadFrom () { uploadCalls += 1 },
    async downloadTo () { throw new Error('unexpected download') },
    close () {
      closeCalls += 1
      return closeGate
    }
  })
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(uploadCalls, 0)
  assert.equal(closeCalls, 1)
  assert.equal(settled, false)
  releaseClose()
  assert.equal(await cancelling, true)
})

test('FTP terminal cancellation rejects within its server deadline when client creation hangs', async () => {
  const transfer = new FtpTransfer({
    id: 'hung-ftp-create',
    type: 'download',
    localPath: 'C:/tmp/target.bin',
    remotePath: '/source.bin',
    ftpSession: {
      createOperationClient: () => new Promise(() => {})
    },
    ws: { s () {} }
  })
  transfer.terminalJoinTimeout = 25

  const result = await Promise.race([
    transfer.cancel().then(
      () => ({ status: 'resolved' }),
      error => ({ status: 'rejected', error })
    ),
    new Promise(resolve => setTimeout(
      () => resolve({ status: 'pending' }),
      200
    ))
  ])

  assert.equal(result.status, 'rejected')
  assert.match(result.error.message, /FTP transfer start/)
})

test('FTP terminal cancellation rejects within its server deadline when close hangs', async () => {
  const transfer = new FtpTransfer({
    id: 'hung-ftp-close',
    type: 'upload',
    localPath: 'C:/tmp/source.bin',
    remotePath: '/target.bin',
    ftpSession: {
      async createOperationClient () {
        return {
          trackProgress () {},
          uploadFrom: () => new Promise(() => {}),
          close: () => new Promise(() => {})
        }
      }
    },
    ws: { s () {} }
  })
  transfer.terminalJoinTimeout = 25
  await new Promise(resolve => setImmediate(resolve))

  const result = await Promise.race([
    transfer.cancel().then(
      () => ({ status: 'resolved' }),
      error => ({ status: 'rejected', error })
    ),
    new Promise(resolve => setTimeout(
      () => resolve({ status: 'pending' }),
      200
    ))
  ])

  assert.equal(result.status, 'rejected')
  assert.match(result.error.message, /FTP operation client/)
})

test('terminal cancellation joins an atomic upload finalization before acknowledging', async () => {
  const tmp = makeTmpDir()
  const localPath = path.join(tmp, 'atomic-race-source.txt')
  const remotePath = path.join(tmp, 'atomic-race-target.txt')
  fs.writeFileSync(localPath, 'new-content')
  fs.writeFileSync(remotePath, 'old-content')

  let resolveRenameStarted
  const renameStarted = new Promise(resolve => { resolveRenameStarted = resolve })
  let releaseRename
  const messages = []
  const sftp = {
    ...createFsLikeSftp(),
    _extensions: {
      'posix-rename@openssh.com': '1'
    },
    ext_openssh_rename (fromPath, toPath, callback) {
      releaseRename = () => fs.rename(fromPath, toPath, callback)
      resolveRenameStarted()
    },
    unlink: fs.unlink
  }
  const transfer = new Transfer({
    id: 'atomic-finalize-cancel',
    type: 'upload',
    localPath,
    remotePath,
    sftp,
    options: {
      atomicUpload: true,
      chunkSize: 4,
      concurrency: 1
    },
    ws: { s (message) { messages.push(message) } }
  })

  await renameStarted
  let settled = false
  const cancelling = transfer.cancel().finally(() => { settled = true })
  await new Promise(resolve => setTimeout(resolve, 250))

  assert.equal(settled, false)
  assert.equal(fs.readFileSync(remotePath, 'utf8'), 'old-content')
  releaseRename()
  assert.equal(await cancelling, true)
  assert.equal(fs.readFileSync(remotePath, 'utf8'), 'new-content')
  assert.equal(messages.filter(message =>
    message.id === 'transfer:end:atomic-finalize-cancel'
  ).length, 1)

  fs.rmSync(tmp, { recursive: true, force: true })
})

test('terminal cancellation bounds an uncertain atomic finalization without unlinking its partial', async () => {
  const tmp = makeTmpDir()
  const localPath = path.join(tmp, 'atomic-timeout-source.txt')
  const remotePath = path.join(tmp, 'atomic-timeout-target.txt')
  fs.writeFileSync(localPath, 'new-content')
  fs.writeFileSync(remotePath, 'old-content')

  let resolveRenameStarted
  const renameStarted = new Promise(resolve => { resolveRenameStarted = resolve })
  let partialPath
  const unhandled = []
  const captureUnhandled = error => { unhandled.push(error) }
  process.on('unhandledRejection', captureUnhandled)
  const sftp = {
    ...createFsLikeSftp(),
    _extensions: {
      'posix-rename@openssh.com': '1'
    },
    ext_openssh_rename (fromPath) {
      partialPath = fromPath
      resolveRenameStarted()
    },
    unlink: fs.unlink
  }
  const transfer = new Transfer({
    id: 'atomic-finalize-timeout',
    type: 'upload',
    localPath,
    remotePath,
    sftp,
    options: {
      atomicUpload: true,
      chunkSize: 4,
      concurrency: 1
    },
    ws: { s () {} }
  })

  await renameStarted
  transfer.terminalJoinTimeout = 50
  transfer.kill = () => new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('late kill failure')), 20)
  })
  const result = await Promise.race([
    transfer.cancel().then(
      () => ({ status: 'resolved' }),
      error => ({ status: 'rejected', error })
    ),
    new Promise(resolve => setTimeout(
      () => resolve({ status: 'pending' }),
      300
    ))
  ])

  assert.equal(result.status, 'rejected')
  assert.match(result.error.message, /successful finalization/)
  assert.equal(fs.readFileSync(remotePath, 'utf8'), 'old-content')
  assert.equal(fs.existsSync(partialPath), true)
  await new Promise(resolve => setTimeout(resolve, 40))
  process.removeListener('unhandledRejection', captureUnhandled)
  assert.equal(unhandled.length, 0)

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

test('atomic partial cleanup only accepts authoritative missing and exposes residual failures', async () => {
  const makeTransfer = error => {
    const transfer = Object.create(Transfer.prototype)
    transfer.atomicUpload = true
    transfer.atomicUploadCommitted = false
    transfer.dstPath = '/tmp/.target.shellpilot-upload-proof.part'
    transfer.dst = {
      unlink (remotePath, callback) {
        assert.equal(remotePath, transfer.dstPath)
        callback(error)
      }
    }
    return transfer
  }

  for (const code of [2, 'ENOENT', 'SFTP_NO_SUCH_FILE']) {
    const missing = new Error('arbitrary localized message')
    missing.code = code
    await assert.doesNotReject(makeTransfer(missing).cleanupAtomicUpload())
  }

  for (const failure of [
    Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    Object.assign(new Error('not found text is not authoritative'), {
      code: 'ECONNRESET'
    }),
    new Error('generic cleanup failure')
  ]) {
    const transfer = makeTransfer(failure)
    await assert.rejects(transfer.cleanupAtomicUpload(), error => {
      assert.equal(error, failure)
      assert.equal(error.partialResidual, true)
      assert.equal(error.residualPath, transfer.dstPath)
      assert.equal(error.cleanupPhase, 'atomic-upload-partial-unlink')
      return true
    })
  }
})

test('atomic upload I/O failure reports cleanup residual without losing the first cause', async () => {
  const tmp = makeTmpDir()
  const localPath = path.join(tmp, 'cleanup-primary-source.txt')
  const remotePath = path.join(tmp, 'cleanup-primary-target.txt')
  fs.writeFileSync(localPath, 'new-content')
  fs.writeFileSync(remotePath, 'old-content')
  let partialPath
  const sftp = {
    ...createFsLikeSftp(),
    open (filePath, flags, callback) {
      if (flags === 'w') partialPath = filePath
      fs.open(filePath, flags, callback)
    },
    write (handle, buffer, offset, length, position, callback) {
      const error = new Error('socket failed during atomic upload')
      error.code = 'ECONNRESET'
      callback(error)
    },
    unlink (filePath, callback) {
      const error = new Error('partial unlink denied')
      error.code = 'EACCES'
      callback(error)
    }
  }

  const { message, transfer } = await waitForTransferMessage(ws => new Transfer({
    id: 'atomic-cleanup-residual',
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
  }), 'atomic-cleanup-residual')
  await transfer.kill()

  assert.equal(message.id, 'transfer:err:atomic-cleanup-residual')
  assert.equal(message.error.message, 'socket failed during atomic upload')
  assert.equal(message.error.partialResidual, true)
  assert.equal(message.error.residualPath, partialPath)
  assert.equal(message.error.cleanupPhase, 'atomic-upload-partial-unlink')
  if (partialPath && fs.existsSync(partialPath)) fs.unlinkSync(partialPath)
  fs.rmSync(tmp, { recursive: true, force: true })
})
