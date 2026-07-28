const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const crypto = require('node:crypto')
const Module = require('node:module')
const { pathToFileURL } = require('node:url')

const resumeUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/file-transfer/transfer-resume.js'
)).href

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'original-fs') return fs
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
const { Transfer, atomicUploadPath } = require(path.resolve(
  __dirname,
  '../../src/app/server/transfer'
))
const { Sftp } = require(path.resolve(
  __dirname,
  '../../src/app/server/session-sftp'
))
Module._load = originalLoad

function makeTmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-resume-'))
}

function createFsLikeSftp ({
  writeDelay = 0,
  onWriteStart
} = {}) {
  return {
    open: fs.open,
    fstat: fs.fstat,
    stat: fs.stat,
    read: fs.read,
    write (handle, buffer, offset, length, position, callback) {
      onWriteStart?.()
      setTimeout(() => {
        fs.write(handle, buffer, offset, length, position, callback)
      }, writeDelay)
    },
    close: fs.close,
    fchmod: fs.fchmod,
    chmod: fs.chmod,
    futimes: fs.futimes,
    utimes: fs.utimes,
    unlink: fs.unlink,
    rename: fs.rename,
    _extensions: {
      'posix-rename@openssh.com': '1'
    },
    ext_openssh_rename: fs.rename
  }
}

function waitForMessage (messages, id, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const check = () => {
      const message = messages.find(item => item.id === id)
      if (message) return resolve(message)
      if (Date.now() - started >= timeoutMs) {
        return reject(new Error(
          `Timed out waiting for ${id}. Messages: ${JSON.stringify(messages)}`
        ))
      }
      setTimeout(check, 5)
    }
    check()
  })
}

test('resume validator accepts an unchanged source and partial target', async () => {
  const { validateTransferResume } = await import(resumeUrl)
  const source = {
    size: 8192,
    mtimeMs: 1000,
    firstSha256: 'source-first',
    lastSha256: 'source-last'
  }
  const target = {
    size: 4096,
    boundarySha256: 'partial-boundary'
  }
  const result = validateTransferResume({
    checkpoint: {
      offset: 4096,
      source,
      target
    },
    source: { ...source },
    target: { ...target }
  })

  assert.deepEqual(result, {
    ok: true,
    offset: 4096
  })
})

test('resume validator rejects changed source or changed partial target', async () => {
  const { validateTransferResume } = await import(resumeUrl)
  const checkpoint = {
    offset: 4096,
    source: {
      size: 8192,
      mtimeMs: 1000,
      firstSha256: 'source-first',
      lastSha256: 'source-last'
    },
    target: {
      size: 4096,
      boundarySha256: 'partial-boundary'
    }
  }

  assert.equal(validateTransferResume({
    checkpoint,
    source: {
      ...checkpoint.source,
      size: 8193
    },
    target: { ...checkpoint.target }
  }).code, 'TRANSFER_SOURCE_CHANGED')

  assert.equal(validateTransferResume({
    checkpoint,
    source: { ...checkpoint.source },
    target: {
      ...checkpoint.target,
      boundarySha256: 'changed'
    }
  }).code, 'TRANSFER_PARTIAL_CHANGED')
})

test('paused atomic upload keeps its partial file and resumes at checkpoint', async () => {
  const tmp = makeTmpDir()
  const localPath = path.join(tmp, 'source.bin')
  const remotePath = path.join(tmp, 'target.bin')
  const source = Buffer.alloc(256 * 1024)
  for (let index = 0; index < source.length; index++) {
    source[index] = (index * 19) % 251
  }
  fs.writeFileSync(localPath, source)

  const firstMessages = []
  let pauseRequested = false
  const first = new Transfer({
    id: 'resume-upload-first',
    type: 'upload',
    localPath,
    remotePath,
    sftp: createFsLikeSftp({
      writeDelay: 15,
      onWriteStart () {
        if (pauseRequested) return
        pauseRequested = true
        first.pause()
      }
    }),
    options: {
      atomicUpload: true,
      keepPartial: true,
      chunkSize: 32 * 1024,
      concurrency: 1
    },
    ws: {
      s (message) {
        firstMessages.push(message)
      },
      close () {}
    }
  })

  const paused = await waitForMessage(
    firstMessages,
    'transfer:paused:resume-upload-first'
  )
  assert.equal(paused.data.offset, 32 * 1024)
  assert.equal(
    paused.data.partialPath,
    atomicUploadPath(remotePath, 'resume-upload-first')
  )
  assert.equal(fs.existsSync(paused.data.partialPath), true)
  assert.equal(fs.existsSync(remotePath), false)

  first.interrupt()
  await new Promise(resolve => setTimeout(resolve, 250))
  assert.equal(fs.existsSync(paused.data.partialPath), true)

  const resumedMessages = []
  const resumed = new Transfer({
    id: 'resume-upload-second',
    type: 'upload',
    localPath,
    remotePath,
    sftp: createFsLikeSftp(),
    options: {
      atomicUpload: true,
      keepPartial: true,
      startOffset: paused.data.offset,
      partialPath: paused.data.partialPath,
      chunkSize: 32 * 1024,
      concurrency: 1
    },
    ws: {
      s (message) {
        resumedMessages.push(message)
      },
      close () {}
    }
  })

  await waitForMessage(
    resumedMessages,
    'transfer:end:resume-upload-second'
  )
  resumed.kill()

  assert.deepEqual(fs.readFileSync(remotePath), source)
  assert.equal(fs.existsSync(paused.data.partialPath), false)
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('explicit cancellation removes a resumable partial upload', async () => {
  const tmp = makeTmpDir()
  const localPath = path.join(tmp, 'source.bin')
  const remotePath = path.join(tmp, 'target.bin')
  fs.writeFileSync(localPath, Buffer.alloc(128 * 1024, 3))

  const messages = []
  let pauseRequested = false
  const transfer = new Transfer({
    id: 'cancel-upload',
    type: 'upload',
    localPath,
    remotePath,
    sftp: createFsLikeSftp({
      writeDelay: 15,
      onWriteStart () {
        if (pauseRequested) return
        pauseRequested = true
        transfer.pause()
      }
    }),
    options: {
      atomicUpload: true,
      keepPartial: true,
      chunkSize: 32 * 1024,
      concurrency: 1
    },
    ws: {
      s (message) {
        messages.push(message)
      },
      close () {}
    }
  })

  const paused = await waitForMessage(
    messages,
    'transfer:paused:cancel-upload'
  )
  transfer.cancel()
  await new Promise(resolve => setTimeout(resolve, 250))

  assert.equal(fs.existsSync(paused.data.partialPath), false)
  assert.equal(fs.existsSync(remotePath), false)
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('resume entry fingerprint reads only bounded first and last chunks', async () => {
  const content = Buffer.alloc(192 * 1024)
  for (let index = 0; index < content.length; index++) {
    content[index] = (index * 23) % 251
  }
  const reads = []
  const context = {
    async lstat () {
      return {
        size: content.length,
        mtime: 1234
      }
    },
    async readFileChunk (filePath, { offset, maxBytes }) {
      reads.push({ filePath, offset, maxBytes })
      const value = content.subarray(offset, offset + maxBytes)
      return {
        base64: value.toString('base64')
      }
    }
  }

  const result = await Sftp.prototype.describeResumeEntry.call(
    context,
    '/var/tmp/upload.part',
    128 * 1024
  )
  const first = content.subarray(0, 64 * 1024)
  const last = content.subarray(content.length - (64 * 1024))
  assert.deepEqual(result, {
    size: content.length,
    mtimeMs: 1234 * 1000,
    firstSha256: crypto.createHash('sha256').update(first).digest('hex'),
    lastSha256: crypto.createHash('sha256').update(last).digest('hex'),
    boundarySha256: crypto.createHash('sha256').update(last).digest('hex')
  })
  assert.deepEqual(reads, [
    {
      filePath: '/var/tmp/upload.part',
      offset: 0,
      maxBytes: 64 * 1024
    },
    {
      filePath: '/var/tmp/upload.part',
      offset: content.length - (64 * 1024),
      maxBytes: 64 * 1024
    }
  ])
})
