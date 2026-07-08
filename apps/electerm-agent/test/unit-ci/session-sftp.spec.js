process.env.NODE_ENV = 'development'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const { Server, utils } = require('@electerm/ssh2')
const { STATUS_CODE, OPEN_MODE } = require('@electerm/ssh2/lib/protocol/SFTP.js')
const { session } = require('../../src/app/server/session-ssh')
const { Sftp } = require('../../src/app/server/session-sftp')

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
            sftp.attrs(reqId, attrsFor(toLocalPath(root, remotePath)))
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
