const { once } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const { Server, utils } = require('@electerm/ssh2')
const { resolveVirtualPath } = require('./local-sftp-fixture')

const TEST_USERNAME = 'shellpilot-e2e'
const TEST_PASSWORD = 'shellpilot-e2e-password'
const HOST_KEY = utils.generateKeyPairSync('ed25519', {
  comment: 'shellpilot-e2e-host'
})

function writePrompt (stream) {
  stream.write('\r\n$ ')
}

function runCommand (stream, command) {
  if (command === 'echo shellpilot-e2e') {
    stream.write('shellpilot-e2e\r\n')
  } else if (command === 'pwd') {
    stream.write('/home/shellpilot\r\n')
  } else if (command) {
    stream.write(`command received: ${command}\r\n`)
  }
  stream.write('$ ')
}

function attachShell (stream, state) {
  let line = ''
  let lastWasCarriageReturn = false

  stream.write('ShellPilot E2E ready\r\n$ ')
  stream.on('error', () => {})
  stream.on('data', chunk => {
    for (const byte of chunk) {
      if (byte === 3) {
        state.ctrlCCount += 1
        line = ''
        stream.write('^C')
        writePrompt(stream)
        lastWasCarriageReturn = false
        continue
      }
      if (byte === 13 || byte === 10) {
        if (byte === 10 && lastWasCarriageReturn) {
          lastWasCarriageReturn = false
          continue
        }
        lastWasCarriageReturn = byte === 13
        stream.write('\r\n')
        runCommand(stream, line.trim())
        line = ''
        continue
      }
      lastWasCarriageReturn = false
      if (byte === 8 || byte === 127) {
        line = line.slice(0, -1)
        stream.write('\b \b')
        continue
      }
      const char = String.fromCharCode(byte)
      line += char
      stream.write(char)
    }
  })
}

function sftpAttrs (stats) {
  return {
    mode: stats.mode,
    uid: stats.uid || 0,
    gid: stats.gid || 0,
    size: stats.size,
    atime: Math.floor(stats.atimeMs / 1000),
    mtime: Math.floor(stats.mtimeMs / 1000)
  }
}

function sftpStatusForError (error) {
  const status = utils.sftp.STATUS_CODE
  if (error?.code === 'ENOENT') return status.NO_SUCH_FILE
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return status.PERMISSION_DENIED
  return status.FAILURE
}

function openFlags (flags) {
  const mode = utils.sftp.OPEN_MODE
  const translated = utils.sftp.flagsToString(flags)
  if (translated) return translated
  if (flags & mode.APPEND) return flags & mode.READ ? 'a+' : 'a'
  if (flags & mode.TRUNC) return flags & mode.READ ? 'w+' : 'w'
  if (flags & mode.CREAT) return flags & mode.READ ? 'a+' : 'a'
  if (flags & mode.WRITE) return flags & mode.READ ? 'r+' : 'r+'
  return 'r'
}

function attachSftp (sftp, root, state) {
  const handles = new Map()
  let nextHandle = 1
  const status = utils.sftp.STATUS_CODE
  const makeHandle = value => {
    const handle = Buffer.alloc(4)
    handle.writeUInt32BE(nextHandle++)
    handles.set(handle.toString('hex'), value)
    return handle
  }
  const getHandle = handle => handles.get(handle.toString('hex'))
  const replyError = (reqid, error) => sftp.status(reqid, sftpStatusForError(error))
  const resolve = value => resolveVirtualPath(root, value)
  const applyPathAttrs = async (localPath, attrs = {}) => {
    if (Number.isFinite(attrs.size)) await fs.promises.truncate(localPath, attrs.size)
    if (Number.isFinite(attrs.mode)) await fs.promises.chmod(localPath, attrs.mode)
    if (Number.isFinite(attrs.atime) || Number.isFinite(attrs.mtime)) {
      const current = await fs.promises.stat(localPath)
      await fs.promises.utimes(
        localPath,
        Number.isFinite(attrs.atime) ? attrs.atime : current.atime,
        Number.isFinite(attrs.mtime) ? attrs.mtime : current.mtime
      )
    }
  }
  const applyHandleAttrs = async (fd, attrs = {}) => {
    if (Number.isFinite(attrs.size)) await fs.promises.ftruncate(fd, attrs.size)
    if (Number.isFinite(attrs.mode)) await fs.promises.fchmod(fd, attrs.mode)
  }

  state.sftpSessions += 1
  sftp.on('REALPATH', (reqid, givenPath) => {
    try {
      const filename = path.posix.normalize('/' + String(givenPath || '/').replace(/\\/g, '/'))
      fs.stat(resolve(filename), (error, stats) => {
        if (error) return replyError(reqid, error)
        sftp.name(reqid, [{ filename, longname: filename, attrs: sftpAttrs(stats) }])
      })
    } catch (error) {
      replyError(reqid, error)
    }
  })
  for (const eventName of ['STAT', 'LSTAT']) {
    sftp.on(eventName, (reqid, filename) => {
      try {
        fs[eventName === 'STAT' ? 'stat' : 'lstat'](resolve(filename), (error, stats) => {
          if (error) return replyError(reqid, error)
          sftp.attrs(reqid, sftpAttrs(stats))
        })
      } catch (error) {
        replyError(reqid, error)
      }
    })
  }
  sftp.on('OPENDIR', (reqid, dirname) => {
    try {
      const localPath = resolve(dirname)
      fs.readdir(localPath, { withFileTypes: true }, async (error, entries) => {
        if (error) return replyError(reqid, error)
        try {
          const records = []
          for (const entry of entries) {
            const stats = await fs.promises.lstat(path.join(localPath, entry.name))
            records.push({ filename: entry.name, longname: entry.name, attrs: sftpAttrs(stats) })
          }
          sftp.handle(reqid, makeHandle({ type: 'dir', records, sent: false }))
        } catch (readError) {
          replyError(reqid, readError)
        }
      })
    } catch (error) {
      replyError(reqid, error)
    }
  })
  sftp.on('READDIR', (reqid, handle) => {
    const record = getHandle(handle)
    if (!record || record.type !== 'dir') return sftp.status(reqid, status.FAILURE)
    if (record.sent) return sftp.status(reqid, status.EOF)
    record.sent = true
    if (!record.records.length) return sftp.status(reqid, status.EOF)
    sftp.name(reqid, record.records)
  })
  sftp.on('OPEN', (reqid, filename, flags) => {
    try {
      fs.open(resolve(filename), openFlags(flags), (error, fd) => {
        if (error) return replyError(reqid, error)
        sftp.handle(reqid, makeHandle({ type: 'file', fd }))
      })
    } catch (error) {
      replyError(reqid, error)
    }
  })
  sftp.on('READ', (reqid, handle, offset, length) => {
    const record = getHandle(handle)
    if (!record || record.type !== 'file') return sftp.status(reqid, status.FAILURE)
    const buffer = Buffer.alloc(length)
    fs.read(record.fd, buffer, 0, length, offset, (error, bytesRead) => {
      if (error) return replyError(reqid, error)
      if (!bytesRead) return sftp.status(reqid, status.EOF)
      sftp.data(reqid, buffer.subarray(0, bytesRead))
    })
  })
  sftp.on('WRITE', (reqid, handle, offset, data) => {
    const record = getHandle(handle)
    if (!record || record.type !== 'file') return sftp.status(reqid, status.FAILURE)
    fs.write(record.fd, data, 0, data.length, offset, error => {
      if (error) return replyError(reqid, error)
      state.sftpWrites += 1
      sftp.status(reqid, status.OK)
    })
  })
  sftp.on('FSTAT', (reqid, handle) => {
    const record = getHandle(handle)
    if (!record || record.type !== 'file') return sftp.status(reqid, status.FAILURE)
    fs.fstat(record.fd, (error, stats) => {
      if (error) return replyError(reqid, error)
      sftp.attrs(reqid, sftpAttrs(stats))
    })
  })
  sftp.on('FSETSTAT', (reqid, handle, attrs) => {
    const record = getHandle(handle)
    if (!record || record.type !== 'file') return sftp.status(reqid, status.FAILURE)
    applyHandleAttrs(record.fd, attrs)
      .then(() => sftp.status(reqid, status.OK))
      .catch(error => replyError(reqid, error))
  })
  sftp.on('CLOSE', (reqid, handle) => {
    const key = handle.toString('hex')
    const record = handles.get(key)
    handles.delete(key)
    if (!record) return sftp.status(reqid, status.FAILURE)
    if (record.type !== 'file') return sftp.status(reqid, status.OK)
    fs.close(record.fd, error => {
      if (error) return replyError(reqid, error)
      sftp.status(reqid, status.OK)
    })
  })
  const pathOperation = (eventName, method, success) => {
    sftp.on(eventName, (reqid, filename, attrs) => {
      try {
        fs[method](resolve(filename), ...(success?.args || []), error => {
          if (error) return replyError(reqid, error)
          success?.after?.()
          sftp.status(reqid, status.OK)
        })
      } catch (error) {
        replyError(reqid, error)
      }
    })
  }
  pathOperation('MKDIR', 'mkdir', { args: [{ recursive: false }] })
  pathOperation('RMDIR', 'rmdir')
  pathOperation('REMOVE', 'unlink')
  sftp.on('RENAME', (reqid, oldPath, newPath) => {
    try {
      fs.rename(resolve(oldPath), resolve(newPath), error => {
        if (error) return replyError(reqid, error)
        state.sftpRenames += 1
        sftp.status(reqid, status.OK)
      })
    } catch (error) {
      replyError(reqid, error)
    }
  })
  sftp.on('SETSTAT', (reqid, filename, attrs) => {
    try {
      const localPath = resolve(filename)
      applyPathAttrs(localPath, attrs)
        .then(() => sftp.status(reqid, status.OK))
        .catch(error => replyError(reqid, error))
    } catch (error) {
      replyError(reqid, error)
    }
  })
}

async function startLocalSshServer (options = {}) {
  const clients = new Set()
  const state = {
    authenticationCount: 0,
    acceptedCount: 0,
    readyCount: 0,
    shellCount: 0,
    ctrlCCount: 0,
    sftpSessions: 0,
    sftpWrites: 0,
    sftpRenames: 0
  }
  const server = new Server({
    hostKeys: [HOST_KEY.private]
  }, client => {
    clients.add(client)
    const remove = () => clients.delete(client)
    client.on('error', remove)
    client.on('close', remove)
    client.on('end', remove)
    client.on('authentication', ctx => {
      state.authenticationCount += 1
      if (
        ctx.method === 'password' &&
        ctx.username === TEST_USERNAME &&
        ctx.password === TEST_PASSWORD
      ) {
        state.acceptedCount += 1
        ctx.accept()
        return
      }
      ctx.reject(['password'])
    })
    client.on('ready', () => {
      state.readyCount += 1
      client.on('session', accept => {
        const session = accept()
        session.on('env', acceptEnv => acceptEnv?.())
        session.on('pty', acceptPty => acceptPty())
        session.on('window-change', () => {})
        session.on('shell', acceptShell => {
          state.shellCount += 1
          attachShell(acceptShell(), state)
        })
        if (options.sftpRoot) {
          session.on('sftp', acceptSftp => {
            attachSftp(acceptSftp(), options.sftpRoot, state)
          })
        }
      })
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  return {
    host: '127.0.0.1',
    port: server.address().port,
    username: TEST_USERNAME,
    password: TEST_PASSWORD,
    state,
    disconnectClients () {
      for (const client of clients) client.end()
    },
    async close () {
      for (const client of clients) {
        client.end()
      }
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    }
  }
}

module.exports = {
  startLocalSshServer
}
