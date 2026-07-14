process.env.NODE_ENV = 'development'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const { Readable, Writable } = require('node:stream')
const Module = require('node:module')
const { Server, utils } = require('@electerm/ssh2')
const { STATUS_CODE, OPEN_MODE } = require('@electerm/ssh2/lib/protocol/SFTP.js')
const { session } = require('../../src/app/server/session-ssh')
const { Sftp } = require('../../src/app/server/session-sftp')

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'original-fs') {
    return fs
  }
  return originalLoad.call(this, request, parent, isMain)
}
const { Transfer } = require('../../src/app/server/transfer')
Module._load = originalLoad

const USERNAME = 'tester'
const PASSWORD = 'electerm-test'
const HOST_KEY = utils.generateKeyPairSync('ed25519', {
  comment: 'electerm-sftp-test-host'
})

function makeTmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aigshell-sftp-test-'))
}

function createPromptWs () {
  return {
    s () {},
    once (handler) {
      queueMicrotask(() => handler({ results: ['trust'] }))
    },
    close () {}
  }
}

function toLocalPath (root, remotePath) {
  const normalized = path.posix.normalize(`/${remotePath || ''}`)
  const relative = normalized.replace(/^\/+/, '')
  const localPath = path.resolve(root, relative)
  if (localPath !== root && !localPath.startsWith(root + path.sep)) {
    throw new Error(`Blocked path outside test root: ${remotePath}`)
  }
  return localPath
}

function attrsFor (localPath) {
  const stat = fs.statSync(localPath)
  return {
    mode: stat.mode,
    uid: 0,
    gid: 0,
    size: stat.size,
    atime: Math.floor(stat.atimeMs / 1000),
    mtime: Math.floor(stat.mtimeMs / 1000)
  }
}

function longnameFor (localPath, name) {
  const stat = fs.statSync(localPath)
  const type = stat.isDirectory() ? 'd' : '-'
  return `${type}rw-r--r-- 1 tester tester ${stat.size} Jan 01 00:00 ${name}`
}

function createPatternBuffer (size, multiplier = 17) {
  const buffer = Buffer.alloc(size)
  for (let index = 0; index < buffer.length; index++) {
    buffer[index] = (index * multiplier) % 251
  }
  return buffer
}

function waitForTransfer (buildTransfer, endId) {
  const messages = []
  let transfer
  const end = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for transfer end. Messages: ${JSON.stringify(messages)}`))
    }, 5000)
    const ws = {
      s (message) {
        messages.push(message)
        if (message.id === endId) {
          clearTimeout(timer)
          resolve(message)
        }
        if (message.id.startsWith('transfer:err:')) {
          clearTimeout(timer)
          reject(new Error(message.error?.message || 'transfer failed'))
        }
      }
    }
    transfer = buildTransfer(ws)
  })
  return end.then(message => ({
    message,
    messages,
    transfer
  }))
}

async function startSftpServer (root) {
  const clients = new Set()
  const handles = new Map()
  let handleId = 0
  const server = new Server({
    hostKeys: [HOST_KEY.private]
  }, (client) => {
    clients.add(client)
    const cleanup = () => clients.delete(client)
    client.on('close', cleanup)
    client.on('end', cleanup)
    client.on('authentication', (ctx) => {
      if (ctx.method === 'none') {
        return ctx.reject(['password'])
      }
      if (ctx.method === 'password' && ctx.username === USERNAME && ctx.password === PASSWORD) {
        return ctx.accept()
      }
      return ctx.reject(['password'])
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const sshSession = accept()
        sshSession.on('pty', (accept) => accept())
        sshSession.on('shell', (accept) => {
          const stream = accept()
          stream.write('sftp test shell ready\n')
        })
        sshSession.on('sftp', (accept) => {
          const sftp = accept()
          sftp.on('REALPATH', (reqId, remotePath) => {
            try {
              const normalizedPath = path.posix.normalize(`/${remotePath || ''}`)
              const localPath = toLocalPath(root, normalizedPath)
              sftp.name(reqId, [{
                filename: normalizedPath,
                longname: longnameFor(localPath, normalizedPath),
                attrs: attrsFor(localPath)
              }])
            } catch (err) {
              sftp.status(reqId, STATUS_CODE.FAILURE, err.message)
            }
          })
          sftp.on('OPENDIR', (reqId, remotePath) => {
            const localPath = toLocalPath(root, remotePath)
            const handle = Buffer.from(`dir:${++handleId}`)
            handles.set(handle.toString('hex'), { type: 'dir', localPath, read: false })
            sftp.handle(reqId, handle)
          })
          sftp.on('READDIR', (reqId, handle) => {
            const item = handles.get(handle.toString('hex'))
            if (!item || item.type !== 'dir') {
              return sftp.status(reqId, STATUS_CODE.FAILURE)
            }
            if (item.read) {
              return sftp.status(reqId, STATUS_CODE.EOF)
            }
            item.read = true
            const names = fs.readdirSync(item.localPath).map((name) => {
              const localPath = path.join(item.localPath, name)
              return {
                filename: name,
                longname: longnameFor(localPath, name),
                attrs: attrsFor(localPath)
              }
            })
            sftp.name(reqId, names)
          })
          sftp.on('CLOSE', (reqId, handle) => {
            handles.delete(handle.toString('hex'))
            sftp.status(reqId, STATUS_CODE.OK)
          })
          sftp.on('OPEN', (reqId, remotePath, flags) => {
            const localPath = toLocalPath(root, remotePath)
            if ((flags & OPEN_MODE.EXCL) && fs.existsSync(localPath)) {
              return sftp.status(reqId, STATUS_CODE.FAILURE)
            }
            if (flags & OPEN_MODE.CREAT) {
              fs.mkdirSync(path.dirname(localPath), { recursive: true })
            }
            if (flags & OPEN_MODE.TRUNC) {
              fs.writeFileSync(localPath, '')
            }
            const handle = Buffer.from(`file:${++handleId}`)
            handles.set(handle.toString('hex'), { type: 'file', localPath })
            sftp.handle(reqId, handle)
          })
          sftp.on('READ', (reqId, handle, offset, length) => {
            const item = handles.get(handle.toString('hex'))
            if (!item || item.type !== 'file') {
              return sftp.status(reqId, STATUS_CODE.FAILURE)
            }
            const data = fs.readFileSync(item.localPath).subarray(Number(offset), Number(offset) + length)
            if (!data.length) {
              return sftp.status(reqId, STATUS_CODE.EOF)
            }
            sftp.data(reqId, data)
          })
          sftp.on('WRITE', (reqId, handle, offset, data) => {
            const item = handles.get(handle.toString('hex'))
            if (!item || item.type !== 'file') {
              return sftp.status(reqId, STATUS_CODE.FAILURE)
            }
            const fd = fs.openSync(item.localPath, 'r+')
            fs.writeSync(fd, data, 0, data.length, Number(offset))
            fs.closeSync(fd)
            sftp.status(reqId, STATUS_CODE.OK)
          })
          sftp.on('STAT', (reqId, remotePath) => {
            try {
              sftp.attrs(reqId, attrsFor(toLocalPath(root, remotePath)))
            } catch (error) {
              sftp.status(reqId, error?.code === 'ENOENT'
                ? STATUS_CODE.NO_SUCH_FILE
                : STATUS_CODE.FAILURE)
            }
          })
          sftp.on('LSTAT', (reqId, remotePath) => {
            try {
              sftp.attrs(reqId, attrsFor(toLocalPath(root, remotePath)))
            } catch (error) {
              sftp.status(reqId, error?.code === 'ENOENT'
                ? STATUS_CODE.NO_SUCH_FILE
                : STATUS_CODE.FAILURE)
            }
          })
          sftp.on('FSTAT', (reqId, handle) => {
            const item = handles.get(handle.toString('hex'))
            if (!item || item.type !== 'file') {
              return sftp.status(reqId, STATUS_CODE.FAILURE)
            }
            sftp.attrs(reqId, attrsFor(item.localPath))
          })
          sftp.on('FSETSTAT', (reqId) => {
            sftp.status(reqId, STATUS_CODE.OK)
          })
          sftp.on('SETSTAT', (reqId) => {
            sftp.status(reqId, STATUS_CODE.OK)
          })
          sftp.on('MKDIR', (reqId, remotePath) => {
            fs.mkdirSync(toLocalPath(root, remotePath), { recursive: true })
            sftp.status(reqId, STATUS_CODE.OK)
          })
          sftp.on('RENAME', (reqId, oldPath, newPath) => {
            fs.renameSync(toLocalPath(root, oldPath), toLocalPath(root, newPath))
            sftp.status(reqId, STATUS_CODE.OK)
          })
          sftp.on('REMOVE', (reqId, remotePath) => {
            fs.unlinkSync(toLocalPath(root, remotePath))
            sftp.status(reqId, STATUS_CODE.OK)
          })
          sftp.on('RMDIR', (reqId, remotePath) => {
            fs.rmdirSync(toLocalPath(root, remotePath))
            sftp.status(reqId, STATUS_CODE.OK)
          })
        })
      })
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  return {
    port: server.address().port,
    async close () {
      for (const client of clients) {
        client.end()
      }
      await new Promise((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve())
      })
    }
  }
}

describe('session-sftp transport flows', () => {
  test('copyEntry meters actual streamed bytes and cleans a growing partial target', async () => {
    const sftp = Object.create(Sftp.prototype)
    const removed = []
    let targetExists = false
    let writtenBytes = 0
    const sourceStat = {
      mode: 0o100644,
      size: 2,
      uid: 1000,
      gid: 1000,
      isDirectory: () => false,
      isFile: () => true
    }
    sftp.lstat = async remotePath => {
      if (remotePath === '/source.bin') return sourceStat
      if (remotePath === '/stage.bin' && targetExists) {
        return { ...sourceStat, size: writtenBytes }
      }
      const error = new Error('No such file')
      error.code = 'ENOENT'
      throw error
    }
    sftp.sftp = {
      createReadStream: () => Readable.from([
        Buffer.from('ab'),
        Buffer.from('cdef')
      ]),
      createWriteStream: () => {
        const stream = new Writable({
          write (chunk, encoding, callback) {
            targetExists = true
            writtenBytes += chunk.length
            callback()
          }
        })
        queueMicrotask(() => stream.emit('open', Buffer.from('fake-handle')))
        return stream
      }
    }
    sftp.rm = async remotePath => {
      removed.push(remotePath)
      targetExists = false
      return 1
    }
    sftp.chmod = async () => 1
    sftp.chown = async () => 1

    await assert.rejects(
      sftp.copyEntry('/source.bin', '/stage.bin', { maxTotalBytes: 4 }),
      /byte|size|limit|字节|大小|上限/i
    )
    assert.equal(writtenBytes <= 4, true)
    assert.equal(targetExists, false)
    assert.deepEqual(removed, ['/stage.bin'])
  })

  test('copyEntry claims a file exclusively without deleting a concurrent target', async () => {
    const sftp = Object.create(Sftp.prototype)
    const removed = []
    let targetContent
    const sourceStat = {
      mode: 0o100640,
      size: 6,
      uid: 1000,
      gid: 1000,
      isDirectory: () => false,
      isFile: () => true
    }
    sftp.lstat = async remotePath => {
      if (remotePath === '/source.txt') return sourceStat
      if (remotePath === '/snapshot.txt' && targetContent !== undefined) {
        return { ...sourceStat, size: targetContent.length }
      }
      const error = new Error('No such file')
      error.code = 'ENOENT'
      throw error
    }
    sftp.sftp = {
      createReadStream: () => Readable.from([Buffer.from('source')]),
      createWriteStream: (remotePath, options = {}) => {
        targetContent = Buffer.from('concurrent')
        if (options.flags === 'wx') {
          const error = new Error('Target exists')
          error.code = 'EEXIST'
          throw error
        }
        return new Writable({
          write (chunk, encoding, callback) {
            targetContent = Buffer.from(chunk)
            callback()
          }
        })
      }
    }
    sftp.chown = async () => { throw new Error('metadata failure') }
    sftp.chmod = async () => 1
    sftp.rm = async remotePath => {
      removed.push(remotePath)
      targetContent = undefined
      return 1
    }

    await assert.rejects(sftp.copyEntry('/source.txt', '/snapshot.txt'))
    assert.equal(targetContent?.toString(), 'concurrent')
    assert.deepEqual(removed, [])
  })

  test('copyEntry claims a directory root without deleting concurrent content', async () => {
    const sftp = Object.create(Sftp.prototype)
    const removed = []
    let targetExists = false
    let concurrentFileExists = false
    const directoryStat = {
      mode: 0o040750,
      size: 0,
      uid: 1000,
      gid: 1000,
      isDirectory: () => true,
      isFile: () => false
    }
    sftp.lstat = async remotePath => {
      if (remotePath === '/source') return directoryStat
      if (remotePath === '/snapshot' && targetExists) return directoryStat
      const error = new Error('No such file')
      error.code = 'ENOENT'
      throw error
    }
    sftp.mkdir = async remotePath => {
      if (remotePath === '/snapshot') {
        targetExists = true
        concurrentFileExists = true
        throw new Error('Failure')
      }
      return 1
    }
    sftp.list = async remotePath => {
      if (remotePath === '/source') return []
      if (remotePath === '/snapshot' && concurrentFileExists) {
        return [{ name: 'concurrent.txt', type: '-' }]
      }
      return []
    }
    sftp.chown = async () => { throw new Error('metadata failure') }
    sftp.chmod = async () => 1
    sftp.rm = async remotePath => {
      removed.push(remotePath)
      concurrentFileExists = false
      return 1
    }
    sftp.rmFolder = async remotePath => {
      removed.push(remotePath)
      targetExists = false
      return 1
    }

    await assert.rejects(
      sftp.copyEntry('/source', '/snapshot'),
      /failure|exist|claim|target|占用|存在|认领/i
    )
    assert.equal(targetExists, true)
    assert.equal(concurrentFileExists, true)
    assert.deepEqual(removed, [])
  })

  test('cooperatively cancels recursive removal after the current atomic call', async () => {
    const sftp = Object.create(Sftp.prototype)
    const removed = []
    let markStarted
    let releaseRemove
    const started = new Promise(resolve => { markStarted = resolve })
    const atomicRemove = new Promise(resolve => { releaseRemove = resolve })
    sftp.lstat = async () => ({ isDirectory: () => true })
    sftp.list = async () => [
      { name: 'first.txt', type: '-' },
      { name: 'second.txt', type: '-' }
    ]
    sftp.rm = async remotePath => {
      removed.push(remotePath)
      if (removed.length === 1) {
        markStarted()
        await atomicRemove
      }
      return 1
    }
    sftp.rmFolder = async remotePath => {
      removed.push(remotePath)
      return 1
    }

    const removing = sftp.removeEntry('/tree', {
      cancelToken: 'cancel-delete-tree'
    })
    await started
    const supportsCancel = typeof sftp.cancelOperation === 'function'
    if (supportsCancel) sftp.cancelOperation('cancel-delete-tree')
    releaseRemove()
    if (!supportsCancel) {
      await removing
      assert.fail('SFTP recursive remove does not expose cooperative cancellation')
    }
    await assert.rejects(removing, /cancel|abort|取消|中止/i)
    assert.deepEqual(removed, ['/tree/first.txt'])
  })

  test('cooperatively cancels recursive copy before starting the next entry', async () => {
    const sftp = Object.create(Sftp.prototype)
    const copied = []
    let markStarted
    let releaseCopy
    const started = new Promise(resolve => { markStarted = resolve })
    const firstCopy = new Promise(resolve => { releaseCopy = resolve })
    const directoryStat = {
      mode: 0o040750,
      size: 0,
      uid: 1000,
      gid: 1000,
      isDirectory: () => true,
      isFile: () => false
    }
    const fileStat = {
      mode: 0o100640,
      size: 1,
      uid: 1000,
      gid: 1000,
      isDirectory: () => false,
      isFile: () => true
    }
    sftp.lstat = async remotePath => {
      if (remotePath === '/source') return directoryStat
      if (remotePath.startsWith('/source/')) return fileStat
      const error = new Error('No such file')
      error.code = 'ENOENT'
      throw error
    }
    sftp.list = async remotePath => remotePath === '/source'
      ? [
          { name: 'first.txt', type: '-' },
          { name: 'second.txt', type: '-' }
        ]
      : []
    sftp.mkdir = async () => 1
    sftp.copySftpFile = async remotePath => {
      copied.push(remotePath)
      if (copied.length === 1) {
        markStarted()
        await firstCopy
      }
    }
    sftp.applySftpCopyMetadata = async () => 1

    const copying = sftp.copyEntry('/source', '/snapshot', {
      cancelToken: 'cancel-copy-tree'
    })
    await started
    assert.equal(sftp.cancelOperation('cancel-copy-tree'), true)
    releaseCopy()
    await assert.rejects(copying, /cancel|abort|取消|中止/i)
    assert.deepEqual(copied, ['/source/first.txt'])
  })

  test('copies files and folders when the connection only exposes SFTP', async () => {
    const root = makeTmpDir()
    const server = await startSftpServer(root)
    let term
    let sftp
    try {
      term = await session({
        host: '127.0.0.1',
        port: server.port,
        username: USERNAME,
        password: PASSWORD,
        useSshAgent: false,
        enableSsh: false,
        readyTimeout: 5000
      }, createPromptWs())
      sftp = new Sftp({
        uid: 'sftp-copy-only-session-ci',
        terminalId: term.pid,
        enableSsh: false
      })
      await sftp.connect(sftp.initOptions)

      await sftp.mkdir('/source')
      await sftp.mkdir('/source/nested')
      await sftp.writeFile('/source/app.conf', 'copy me')
      const binary = createPatternBuffer(256 * 1024, 31)
      fs.writeFileSync(toLocalPath(root, '/source/nested/data.bin'), binary)
      await sftp.mkdir('/backups')

      await sftp.cp('/source', '/backups/source-copy')

      assert.equal(
        await sftp.readFile('/backups/source-copy/app.conf'),
        'copy me'
      )
      assert.deepEqual(
        fs.readFileSync(toLocalPath(root, '/backups/source-copy/nested/data.bin')),
        binary
      )

      await sftp.copyEntry('/source', '/backups/transaction-copy')
      const sourceOwnership = await sftp.lstat('/source/app.conf')
      const copiedOwnership = await sftp.lstat('/backups/transaction-copy/app.conf')
      assert.deepEqual(
        { uid: copiedOwnership.uid, gid: copiedOwnership.gid },
        { uid: sourceOwnership.uid, gid: sourceOwnership.gid }
      )
      const chunk = await sftp.readFileChunk(
        '/backups/transaction-copy/app.conf',
        { offset: 2, maxBytes: 4 }
      )
      assert.deepEqual(chunk, {
        base64: Buffer.from('py m').toString('base64'),
        offset: 2,
        nextOffset: 6,
        bytesRead: 4,
        totalBytes: 7,
        hasMore: true
      })
      await sftp.removeEntry('/backups/transaction-copy')
      assert.equal(
        fs.existsSync(toLocalPath(root, '/backups/transaction-copy')),
        false
      )
      await assert.rejects(
        sftp.copyEntry('/source', '/source/inside'),
        /源|目标|内部|source|target/i
      )
      assert.equal(fs.existsSync(toLocalPath(root, '/source/inside')), false)
      await assert.rejects(
        sftp.copyEntry('/source/app.conf', '/backups/over-budget.conf', {
          maxTotalBytes: 2
        }),
        /字节|byte|上限/i
      )
      assert.equal(
        fs.existsSync(toLocalPath(root, '/backups/over-budget.conf')),
        false
      )
    } finally {
      sftp && sftp.kill()
      term && term.kill()
      await server.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('performs core SFTP file operations over an SSH session', async () => {
    const root = makeTmpDir()
    const server = await startSftpServer(root)
    let term
    let sftp
    try {
      term = await session({
        host: '127.0.0.1',
        port: server.port,
        username: USERNAME,
        password: PASSWORD,
        useSshAgent: false,
        enableSsh: true,
        readyTimeout: 5000
      }, createPromptWs())
      sftp = new Sftp({
        uid: 'sftp-session-ci',
        terminalId: term.pid,
        enableSsh: true
      })
      await sftp.connect(sftp.initOptions)

      await sftp.mkdir('/logs')
      await sftp.writeFile('/logs/app.log', 'hello sftp')
      assert.equal(await sftp.readFile('/logs/app.log'), 'hello sftp')

      const list = await sftp.list('/logs')
      assert.deepEqual(list.map(item => item.name), ['app.log'])

      await sftp.rename('/logs/app.log', '/logs/renamed.log')
      assert.equal(await sftp.readFile('/logs/renamed.log'), 'hello sftp')

      const stat = await sftp.stat('/logs/renamed.log')
      assert.equal(stat.isDirectory, false)
      assert.equal(stat.size, 'hello sftp'.length)

      await sftp.rm('/logs/renamed.log')
      await sftp.rmFolder('/logs')
      assert.equal(fs.existsSync(path.join(root, 'logs')), false)
    } finally {
      sftp && sftp.kill()
      term && term.kill()
      await server.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('handles unicode paths and large text files over an SSH SFTP session', async () => {
    const root = makeTmpDir()
    const server = await startSftpServer(root)
    let term
    let sftp
    try {
      term = await session({
        host: '127.0.0.1',
        port: server.port,
        username: USERNAME,
        password: PASSWORD,
        useSshAgent: false,
        enableSsh: true,
        readyTimeout: 5000
      }, createPromptWs())
      sftp = new Sftp({
        uid: 'sftp-unicode-large-session-ci',
        terminalId: term.pid,
        enableSsh: true
      })
      await sftp.connect(sftp.initOptions)

      const dir = '/日志目录'
      const file = `${dir}/部署输出-大文件.log`
      const content = Array.from({ length: 4096 }, (_, index) => {
        return `第 ${index + 1} 行：AIGShell SFTP 中文路径和大文件传输验证 ${'x'.repeat(80)}`
      }).join('\n')

      await sftp.mkdir(dir)
      await sftp.writeFile(file, content)

      const preview = await sftp.readFilePreview(file, 64)
      assert.deepEqual(preview, {
        content: Buffer.from(content).subarray(0, 64).toString('utf8'),
        truncated: true,
        binary: false,
        bytesRead: 64
      })

      const list = await sftp.list(dir)
      assert.deepEqual(list.map(item => item.name), ['部署输出-大文件.log'])
      assert.equal(await sftp.readFile(file), content)

      const stat = await sftp.stat(file)
      assert.equal(stat.isDirectory, false)
      assert.equal(stat.size, Buffer.byteLength(content))
    } finally {
      sftp && sftp.kill()
      term && term.kill()
      await server.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('uploads and downloads large binary files over the SSH SFTP transfer path', async () => {
    const root = makeTmpDir()
    const server = await startSftpServer(root)
    const localDir = makeTmpDir()
    let term
    let sftp
    try {
      term = await session({
        host: '127.0.0.1',
        port: server.port,
        username: USERNAME,
        password: PASSWORD,
        useSshAgent: false,
        enableSsh: true,
        readyTimeout: 5000
      }, createPromptWs())
      sftp = new Sftp({
        uid: 'sftp-transfer-session-ci',
        terminalId: term.pid,
        enableSsh: true
      })
      await sftp.connect(sftp.initOptions)
      await sftp.mkdir('/transfer')

      const uploadSource = createPatternBuffer(512 * 1024, 19)
      const uploadLocalPath = path.join(localDir, 'upload-large.bin')
      const uploadRemotePath = '/transfer/upload-large.bin'
      fs.writeFileSync(uploadLocalPath, uploadSource)

      const uploadResult = await waitForTransfer((ws) => new Transfer({
        id: 'ssh-sftp-upload-large',
        type: 'upload',
        localPath: uploadLocalPath,
        remotePath: uploadRemotePath,
        sftp: sftp.sftp,
        conn: term.conn,
        options: {
          chunkSize: 64 * 1024,
          concurrency: 4
        },
        ws
      }), 'transfer:end:ssh-sftp-upload-large')

      uploadResult.transfer.kill()
      assert.deepEqual(fs.readFileSync(toLocalPath(root, uploadRemotePath)), uploadSource)
      assert.ok(
        uploadResult.messages.some(message => message.id === 'transfer:data:ssh-sftp-upload-large'),
        'upload should emit transfer progress'
      )

      const downloadSource = createPatternBuffer(640 * 1024, 23)
      const downloadRemotePath = '/transfer/download-source.bin'
      const downloadLocalPath = path.join(localDir, 'downloaded-large.bin')
      fs.writeFileSync(toLocalPath(root, downloadRemotePath), downloadSource)

      const downloadResult = await waitForTransfer((ws) => new Transfer({
        id: 'ssh-sftp-download-large',
        type: 'download',
        localPath: downloadLocalPath,
        remotePath: downloadRemotePath,
        sftp: sftp.sftp,
        conn: term.conn,
        options: {
          chunkSize: 80 * 1024,
          concurrency: 3
        },
        ws
      }), 'transfer:end:ssh-sftp-download-large')

      downloadResult.transfer.kill()
      assert.deepEqual(fs.readFileSync(downloadLocalPath), downloadSource)
      assert.ok(
        downloadResult.messages.some(message => message.id === 'transfer:data:ssh-sftp-download-large'),
        'download should emit transfer progress'
      )
    } finally {
      sftp && sftp.kill()
      term && term.kill()
      await server.close()
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(localDir, { recursive: true, force: true })
    }
  })

  test('resolves remote paths and lists nested directories for navigation', async () => {
    const root = makeTmpDir()
    const server = await startSftpServer(root)
    let term
    let sftp
    try {
      term = await session({
        host: '127.0.0.1',
        port: server.port,
        username: USERNAME,
        password: PASSWORD,
        useSshAgent: false,
        enableSsh: true,
        readyTimeout: 5000
      }, createPromptWs())
      sftp = new Sftp({
        uid: 'sftp-navigation-session-ci',
        terminalId: term.pid,
        enableSsh: true
      })
      await sftp.connect(sftp.initOptions)

      assert.equal(await sftp.getHomeDir(), '/')

      await sftp.mkdir('/projects')
      await sftp.mkdir('/projects/releases')
      await sftp.writeFile('/projects/releases/build.log', 'release ok')

      const normalizedReleasePath = await sftp.realpath('/projects/../projects/releases')
      assert.equal(normalizedReleasePath, '/projects/releases')

      const projectList = await sftp.list('/projects')
      assert.deepEqual(projectList.map(item => [item.name, item.type]), [
        ['releases', 'd']
      ])

      const releaseList = await sftp.list(normalizedReleasePath)
      assert.deepEqual(releaseList.map(item => [item.name, item.type]), [
        ['build.log', '-']
      ])
      assert.equal(await sftp.readFile(`${normalizedReleasePath}/build.log`), 'release ok')
    } finally {
      sftp && sftp.kill()
      term && term.kill()
      await server.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
