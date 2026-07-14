/**
 * terminal/sftp/serial class
 */
const {
  readRemoteFile,
  readRemoteFilePreview,
  readRemoteFileRange,
  readRemoteFileChunk,
  listRemoteArchive,
  readRemoteArchiveTextEntry,
  writeRemoteFile
} = require('./sftp-file')
const { commonExtends } = require('./session-common.js')
const { TerminalBase } = require('./session-base.js')
const { Transform } = require('stream')
const { pipeline } = require('stream/promises')
const { posix: pathPosix } = require('path')
const {
  getSizeCount,
  getSizeCountWin
} = require('../common/get-folder-size-and-file-count.js')
const { searchTextReader } = require('../common/log-search')
const globalState = require('./global-state')
const {
  assertSftpCopyTargetOutsideSource,
  consumeSftpCopyActualBytes,
  consumeSftpCopyBudget,
  createSftpCopyBudget
} = require('./sftp-copy-budget')

function sftpStatType (stat) {
  const isDirectory = typeof stat?.isDirectory === 'function'
    ? stat.isDirectory()
    : stat?.isDirectory === true
  const isFile = typeof stat?.isFile === 'function'
    ? stat.isFile()
    : !isDirectory && (Number(stat?.mode) & 0o170000) === 0o100000
  return isDirectory ? 'directory' : isFile ? 'file' : 'special'
}

function requiredSftpOwnership (stat) {
  if (!Number.isSafeInteger(stat?.uid) || stat.uid < 0 ||
    !Number.isSafeInteger(stat?.gid) || stat.gid < 0) {
    throw new Error('SFTP 复制无法读取有效的 uid/gid，已拒绝继续。')
  }
  return { uid: stat.uid, gid: stat.gid }
}

function throwIfSftpOperationAborted (signal) {
  if (!signal?.aborted) return
  const error = new Error('SFTP 操作已取消。')
  error.name = 'AbortError'
  throw error
}

function validateSftpCancelToken (value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error('SFTP 取消令牌无效。')
  }
  return value
}

function isMissingSftpError (error) {
  return error?.code === 2 || error?.code === 'ENOENT' ||
    error?.code === 'SFTP_NO_SUCH_FILE' ||
    /no such|not found|does not exist/i.test(String(error?.message || error))
}

class Sftp extends TerminalBase {
  connect (initOptions) {
    return this.remoteInitSftp(initOptions)
  }

  applySshFsOverride = (sshFs) => {
    sshFs.isSshFsFallback = true
    this.sftp = sshFs
    this.isSshFsFallback = true
    const proto = Object.getPrototypeOf(sshFs)
    const keys = Object.getOwnPropertyNames(proto)
    for (const method of keys) {
      if (method === 'constructor') {
        continue
      }
      if (typeof sshFs[method] === 'function') {
        this[method] = sshFs[method].bind(sshFs)
      }
    }
  }

  initSshFsFallback = (conn) => {
    const { SshFs } = require('ssh2-scp')
    const opts = {}
    const encode = this.initOptions?.encode || 'utf8'
    if (encode !== 'utf8') {
      opts.encoding = encode
      opts.iconv = require('iconv-lite')
    }
    const sshFs = new SshFs(conn, opts)
    this.applySshFsOverride(sshFs)
  }

  async remoteInitSftp (initOptions) {
    this.initOptions = initOptions
    this.transfers = {}
    const terminalInst = globalState.getSession(initOptions.terminalId)
    const {
      conn
    } = terminalInst
    this.client = conn
    this.enableSsh = initOptions.enableSsh
    try {
      const sftp = await new Promise((resolve, reject) => {
        conn.sftp((err, sftp) => {
          if (err) {
            return reject(err)
          }
          resolve(sftp)
        })
      })
      this.sftp = sftp
    } catch (err) {
      this.initSshFsFallback(conn)
    }

    globalState.setSession(this.pid, this)
    return 'ok'
  }

  kill () {
    const keys = Object.keys(this.transfers || {})
    for (const k of keys) {
      const jj = this.transfers[k]
      jj && jj.destroy && jj.destroy()
      delete this.transfers[k]
    }
    this.sftp && this.sftp.end && this.sftp.end()
    delete this.sftp
    delete this.initOptions
    this.onEndConn()
  }

  cancelOperation (cancelToken) {
    const token = validateSftpCancelToken(cancelToken)
    const controller = this.sftpOperationControllers?.get(token)
    if (!controller) return false
    controller.abort()
    return true
  }

  async withSftpOperationCancellation (options, work) {
    const cancelToken = options?.cancelToken
    const externalSignal = options?.signal
    let controller
    let signal = externalSignal
    let abortFromExternalSignal
    if (cancelToken !== undefined) {
      const token = validateSftpCancelToken(cancelToken)
      if (!this.sftpOperationControllers) {
        this.sftpOperationControllers = new Map()
      }
      if (this.sftpOperationControllers.has(token)) {
        throw new Error('SFTP 取消令牌正在使用。')
      }
      controller = new AbortController()
      signal = controller.signal
      abortFromExternalSignal = () => controller.abort()
      if (externalSignal?.aborted) {
        abortFromExternalSignal()
      } else if (typeof externalSignal?.addEventListener === 'function') {
        externalSignal.addEventListener('abort', abortFromExternalSignal, { once: true })
      }
      this.sftpOperationControllers.set(token, controller)
      try {
        throwIfSftpOperationAborted(signal)
        return await work(signal)
      } finally {
        this.sftpOperationControllers.delete(token)
        if (typeof externalSignal?.removeEventListener === 'function') {
          externalSignal.removeEventListener('abort', abortFromExternalSignal)
        }
      }
    }
    throwIfSftpOperationAborted(signal)
    return work(signal)
  }

  escapePosixPath = (value) => {
    return `"${String(value).replace(/["\\$`]/g, '\\$&')}"`
  }

  escapePowerShellPath = (value) => {
    return `'${String(value).replace(/'/g, "''")}'`
  }

  normalizeWindowsExecPath = (value) => {
    return String(value).replace(/^\/([a-zA-Z]:)/, '$1')
  }

  buildPowerShellCommand = (script) => {
    return `powershell.exe -NoLogo -NonInteractive -NoProfile -Command "${script}"`
  }

  execBuffered (cmd) {
    return new Promise((resolve, reject) => {
      if (!this.enableSsh) {
        return reject(new Error(`do not support ${cmd.split(' ')[0]} operation in sftp mode`))
      }
      const { client } = this
      client.exec(cmd, this.getExecOpts(), (err, stream) => {
        if (err) {
          return reject(err)
        }
        let stdout = Buffer.from('')
        let stderr = Buffer.from('')
        let settled = false
        const settle = (result) => {
          if (settled) {
            return
          }
          settled = true
          resolve(result)
        }
        stream.on('close', (code) => {
          settle({
            code,
            stdout: stdout.toString(),
            stderr: stderr.toString()
          })
        }).on('end', () => {
          settle({
            code: 0,
            stdout: stdout.toString(),
            stderr: stderr.toString()
          })
        }).on('data', (data) => {
          stdout = Buffer.concat([stdout, data])
        })
        stream.stderr.on('data', (data) => {
          stderr = Buffer.concat([stderr, data])
        })
      })
    })
  }

  async getRemoteExecPlatform () {
    if (this.remoteExecPlatform) {
      return this.remoteExecPlatform
    }
    if (!this.remoteExecPlatformPromise) {
      this.remoteExecPlatformPromise = this.execBuffered('cmd.exe /d /s /c ver')
        .then(({ code, stdout, stderr }) => {
          const output = `${stdout}\n${stderr}`.toLowerCase()
          return code === 0 && output.includes('windows')
            ? 'windows'
            : 'posix'
        })
        .catch(() => 'posix')
        .then((platform) => {
          this.remoteExecPlatform = platform
          return platform
        })
    }
    return this.remoteExecPlatformPromise
  }

  async buildRemoteCommand (type, ...paths) {
    const platform = await this.getRemoteExecPlatform()
    if (platform === 'windows') {
      const args = paths
        .map(this.normalizeWindowsExecPath)
        .map(this.escapePowerShellPath)
      if (type === 'rmrf') {
        return this.buildPowerShellCommand(`Remove-Item -LiteralPath ${args[0]} -Force -Recurse`)
      }
      if (type === 'cp') {
        return this.buildPowerShellCommand(`Copy-Item -LiteralPath ${args[0]} -Destination ${args[1]} -Recurse -Force`)
      }
      if (type === 'mv') {
        return this.buildPowerShellCommand(`Move-Item -LiteralPath ${args[0]} -Destination ${args[1]} -Force`)
      }
      if (type === 'folder-size') {
        return this.buildPowerShellCommand(`Get-ChildItem -LiteralPath ${args[0]} -Recurse -File | Measure-Object -Property Length -Sum`)
      }
    }
    const posixArgs = paths.map(this.escapePosixPath)
    if (type === 'rmrf') {
      return `rm -rf ${posixArgs[0]}`
    }
    if (type === 'cp') {
      return `cp -r ${posixArgs[0]} ${posixArgs[1]}`
    }
    if (type === 'mv') {
      return `mv ${posixArgs[0]} ${posixArgs[1]}`
    }
    if (type === 'folder-size') {
      return `du -sh ${posixArgs[0]} && find ${posixArgs[0]} -type f | wc -l`
    }
    throw new Error(`unsupported remote command type: ${type}`)
  }

  /**
   * getHomeDir
   *
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * only support linux / mac
   * @return {Promise}
   */
  getHomeDir () {
    // return this.runCmd('eval echo "~$different_user"')
    // ext_home_dir
    return this.realpath('')
  }

  // getSftpHomeDir () {
  //   // return this.runCmd('eval echo "~$different_user"')
  //   // ext_home_dir
  //   return new Promise((resolve, reject) => {
  //     this.sftp.ext_home_dir('', (err, path) => {
  //       if (err) {
  //         return reject(err)
  //       }
  //       resolve(path)
  //     })
  //   })
  // }

  /**
   * rmdir
   *
   * @param {String} remotePath
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * only support rm -rf
   * @return {Promise}
   */
  rmdir (remotePath) {
    return this.rmrf(remotePath)
      .then(r => {
        return r
      })
      .catch(err => {
        console.error('rm -rf dir error', err)
        return this.removeDirectoryRecursively(remotePath)
      })
  }

  rmrf (remotePath) {
    return this.buildRemoteCommand('rmrf', remotePath)
      .then(cmd => this.runExec(cmd))
    // return new Promise((resolve, reject) => {
    //   const { client } = this
    //   const cmd = `rm -rf "${remotePath}"`
    //   this.runExec(cmd, this.getExecOpts(), (err, stream) => {
    //     if (err) {
    //       return reject(err)
    //     } else {
    //       console.log('rm -rf done', stream)
    //       resolve(1)
    //     }
    //   })
    // })
  }

  async removeDirectoryRecursively (remotePath, signal) {
    throwIfSftpOperationAborted(signal)
    const contents = await this.list(remotePath)
    throwIfSftpOperationAborted(signal)
    for (const item of contents) {
      throwIfSftpOperationAborted(signal)
      const itemPath = `${remotePath}/${item.name}`
      if (item.type === 'd') {
        // Recursively delete subdirectories
        await this.removeDirectoryRecursively(itemPath, signal)
      } else {
        // Delete files
        await this.rm(itemPath)
        throwIfSftpOperationAborted(signal)
      }
    }
    // Finally, remove the directory itself
    await this.rmFolder(remotePath)
    throwIfSftpOperationAborted(signal)
  }

  async removeEntry (remotePath, options = {}) {
    return this.withSftpOperationCancellation(options, async signal => {
      const stat = await this.lstat(remotePath)
      throwIfSftpOperationAborted(signal)
      if (stat.isDirectory()) {
        await this.removeDirectoryRecursively(remotePath, signal)
      } else {
        await this.rm(remotePath)
        throwIfSftpOperationAborted(signal)
      }
      return 1
    })
  }

  /**
   * touch a file
   *
   * @param {String} remotePath
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * @return {Promise}
   */
  touch (remotePath) {
    // if (this.enableSsh) {
    //   return new Promise((resolve, reject) => {
    //     const { client } = this
    //     const cmd = `touch "${remotePath}"`
    //     client.exec(cmd, this.getExecOpts(), err => {
    //       if (err) reject(err)
    //       else resolve(1)
    //     })
    //   })
    // }
    return this.touchFile(remotePath)
  }

  openFile = (remotePath) => {
    return new Promise((resolve, reject) => {
      this.sftp.open(remotePath, 'w', (err, fd) => {
        if (err) {
          return reject(err)
        }
        resolve(fd)
      })
    })
  }

  closeFile = (fd) => {
    return new Promise((resolve, reject) => {
      this.sftp.close(fd, err => {
        if (err) {
          return reject(err)
        }
        resolve(true)
      })
    })
  }

  touchFile = (remotePath) => {
    return this.openFile(remotePath)
      .then(this.closeFile)
  }

  /**
   * cp
   *
   * @param {String} from
   * @param {String} to
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * @return {Promise}
   */
  async cp (from, to) {
    if (this.enableSsh) {
      return this.buildRemoteCommand('cp', from, to)
        .then(cmd => this.runExec(cmd))
        .then(() => 1)
    }
    await this.copySftpEntry(from, to)
    return 1
  }

  async copyEntry (from, to, options = {}) {
    return this.withSftpOperationCancellation(options, async signal => {
      await this.copySftpEntry(from, to, {
        ...options,
        signal,
        preserveOwnership: true,
        requireAbsentTarget: true,
        cleanupOnFailure: true
      })
      return 1
    })
  }

  async applySftpCopyMetadata (path, stat, preserveOwnership, signal) {
    throwIfSftpOperationAborted(signal)
    if (preserveOwnership) {
      const { uid, gid } = requiredSftpOwnership(stat)
      await this.chown(path, uid, gid)
      throwIfSftpOperationAborted(signal)
    }
    await this.chmod(path, Number(stat.mode) & 0o7777)
    throwIfSftpOperationAborted(signal)
    if (preserveOwnership) {
      const copied = await this.lstat(path)
      throwIfSftpOperationAborted(signal)
      const { uid, gid } = requiredSftpOwnership(copied)
      if (uid !== stat.uid || gid !== stat.gid ||
        (Number(copied.mode) & 0o7777) !== (Number(stat.mode) & 0o7777)) {
        throw new Error('SFTP 复制后的 ownership 或 mode 校验失败。')
      }
    }
  }

  async copySftpFile (from, to, stat, options) {
    throwIfSftpOperationAborted(options.signal)
    const readStream = this.sftp.createReadStream(from)
    const writeStream = this.sftp.createWriteStream(to, {
      mode: 0o600,
      ...(options.atomicClaim ? { flags: 'wx' } : {})
    })
    const claimPromise = options.atomicClaim
      ? new Promise((resolve, reject) => {
        writeStream.once('open', () => {
          options.ownedEntries.push({ path: to, type: 'file' })
          resolve()
        })
        writeStream.once('error', reject)
      })
      : Promise.resolve()
    const actualBytesBefore = options.budget.actualBytes
    const meter = new Transform({
      transform (chunk, encoding, callback) {
        try {
          consumeSftpCopyActualBytes(options.budget, chunk.length)
          callback(null, chunk)
        } catch (error) {
          callback(error)
        }
      }
    })
    await Promise.all([
      claimPromise,
      pipeline(
        readStream,
        meter,
        writeStream,
        ...(options.signal ? [{ signal: options.signal }] : [])
      )
    ])
    throwIfSftpOperationAborted(options.signal)
    if (options.budget.actualBytes - actualBytesBefore !== Number(stat.size)) {
      throw new Error('SFTP 复制期间源文件大小发生变化，已拒绝快照。')
    }
    await this.applySftpCopyMetadata(
      to,
      stat,
      options.preserveOwnership,
      options.signal
    )
  }

  async copySftpDirectory (from, to, stat, options, depth) {
    throwIfSftpOperationAborted(options.signal)
    if (options.atomicClaim) {
      await this.mkdir(to, { mode: 0o700 })
      options.ownedEntries.push({ path: to, type: 'directory' })
    } else {
      await this.mkdir(to, {
        mode: 0o700
      }).catch(err => {
        if (!/exist|failure/i.test(String(err?.message || err))) {
          throw err
        }
      })
    }
    throwIfSftpOperationAborted(options.signal)
    const entries = await this.list(from)
    throwIfSftpOperationAborted(options.signal)
    for (const entry of entries) {
      throwIfSftpOperationAborted(options.signal)
      const sourcePath = pathPosix.join(from, entry.name)
      const targetPath = pathPosix.join(to, entry.name)
      await this.copySftpEntryWithinBudget(
        sourcePath,
        targetPath,
        options,
        depth + 1
      )
    }
    await this.applySftpCopyMetadata(
      to,
      stat,
      options.preserveOwnership,
      options.signal
    )
  }

  async copySftpEntryWithinBudget (from, to, options, depth) {
    throwIfSftpOperationAborted(options.signal)
    const sourceStat = await this.lstat(from)
    throwIfSftpOperationAborted(options.signal)
    const type = sftpStatType(sourceStat)
    if (type === 'special') {
      throw new Error('SFTP 复制不支持符号链接或特殊文件。')
    }
    const bytes = type === 'file' ? Number(sourceStat.size) : 0
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error('SFTP 复制源文件大小无效。')
    }
    consumeSftpCopyBudget(options.budget, { depth, bytes })
    if (type === 'directory') {
      await this.copySftpDirectory(from, to, sourceStat, options, depth)
    } else {
      await this.copySftpFile(from, to, sourceStat, options)
    }
  }

  async copySftpEntry (from, to, options = {}) {
    const paths = assertSftpCopyTargetOutsideSource(from, to)
    const copyOptions = {
      preserveOwnership: options.preserveOwnership === true,
      budget: createSftpCopyBudget(options),
      signal: options.signal,
      atomicClaim: options.requireAbsentTarget === true,
      ownedEntries: []
    }
    try {
      await this.copySftpEntryWithinBudget(
        paths.source,
        paths.target,
        copyOptions,
        0
      )
    } catch (error) {
      if (options.cleanupOnFailure === true) {
        for (const owned of [...copyOptions.ownedEntries].reverse()) {
          try {
            if (owned.type === 'directory') {
              await this.rmFolder(owned.path)
            } else {
              await this.rm(owned.path)
            }
          } catch (cleanupError) {
            if (!isMissingSftpError(cleanupError) && !error.cleanupError) {
              error.cleanupError = cleanupError
            }
          }
        }
      }
      throw error
    }
  }

  /**
   * mv
   *
   * @param {String} from
   * @param {String} to
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * @return {Promise}
   */
  mv (from, to) {
    return this.buildRemoteCommand('mv', from, to)
      .then(cmd => this.runExec(cmd))
      .then(() => 1)
  }

  runExec (cmd) {
    return this.execBuffered(cmd)
      .then(({ code, stdout, stderr }) => {
        if (stderr) {
          throw new Error(stderr.trim())
        }
        if (typeof code === 'number' && code !== 0) {
          throw new Error(stdout.trim() || `Command exited with code ${code}`)
        }
        return stdout
      })
  }

  async getFolderSize (folderPath) {
    const platform = await this.getRemoteExecPlatform()
    const cmd = await this.buildRemoteCommand('folder-size', folderPath)
    const output = await this.runExec(cmd)
    return platform === 'windows'
      ? getSizeCountWin(output)
      : getSizeCount(output)
  }

  /**
   * list remote directory
   *
   * @param {String} remotePath
   * @return {Promise} list
   */
  list (remotePath) {
    return new Promise((resolve, reject) => {
      const { sftp } = this
      const reg = /-/g

      sftp.readdir(remotePath, (err, list) => {
        if (err) {
          return reject(err)
        }
        resolve(list.map(item => {
          const {
            filename,
            longname,
            attrs: {
              size, mtime, atime, uid, gid, mode
            }
          } = item
          // from https://github.com/jyu213/ssh2-sftp-client/blob/master/src/index.js
          return {
            type: longname.substr(0, 1),
            name: filename,
            size,
            modifyTime: mtime * 1000,
            accessTime: atime * 1000,
            mode,
            rights: {
              user: longname.substr(1, 3).replace(reg, ''),
              group: longname.substr(4, 3).replace(reg, ''),
              other: longname.substr(7, 3).replace(reg, '')
            },
            owner: uid,
            group: gid
          }
        }))
      })
    })
  }

  /**
   * mkdir
   *
   * @param {String} remotePath
   * @param {Object} attributes
   * An object with the following valid properties:

      mode - integer - Mode/permissions for the resource.
      uid - integer - User ID of the resource.
      gid - integer - Group ID of the resource.
      size - integer - Resource size in bytes.
      atime - integer - UNIX timestamp of the access time of the resource.
      mtime - integer - UNIX timestamp of the modified time of the resource.

      When supplying an ATTRS object to one of the SFTP methods:
      atime and mtime can be either a Date instance or a UNIX timestamp.
      mode can either be an integer or a string containing an octal number.
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * @return {Promise}
   */
  mkdir (remotePath, options = {}) {
    return new Promise((resolve, reject) => {
      const { sftp } = this
      sftp.mkdir(remotePath, options, err => {
        if (err) reject(err)
        else resolve(1)
      })
    })
  }

  /**
   * stat
   *
   * @param {String} remotePath
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * @return {Promise} stat
   *  stats.isDirectory()
      stats.isFile()
      stats.isBlockDevice()
      stats.isCharacterDevice()
      stats.isSymbolicLink()
      stats.isFIFO()
      stats.isSocket()
   */
  stat (remotePath) {
    return new Promise((resolve, reject) => {
      const { sftp } = this
      sftp.stat(remotePath, (err, stat) => {
        if (err) reject(err)
        else {
          resolve(
            Object.assign(stat, {
              isDirectory: stat.isDirectory()
            })
          )
        }
      })
    })
  }

  /**
   * readlink
   *
   * @param {String} remotePath
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * @return {Promise} target
   */
  readlink (remotePath) {
    return new Promise((resolve, reject) => {
      const { sftp } = this
      sftp.readlink(remotePath, (err, target) => {
        if (err) reject(err)
        else resolve(target)
      })
    })
  }

  /**
   * realpath
   *
   * @param {String} remotePath
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * @return {Promise} target
   */
  realpath (remotePath) {
    return new Promise((resolve, reject) => {
      const { sftp } = this
      sftp.realpath(remotePath, (err, target) => {
        if (err) reject(err)
        else resolve(target)
      })
    })
  }

  /**
   * lstat
   *
   * @param {String} remotePath
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * @return {Promise} stat
   *  stats.isDirectory()
      stats.isFile()
      stats.isBlockDevice()
      stats.isCharacterDevice()
      stats.isSymbolicLink()
      stats.isFIFO()
      stats.isSocket()
   */
  lstat (remotePath) {
    return new Promise((resolve, reject) => {
      const { sftp } = this
      sftp.lstat(remotePath, (err, stat) => {
        if (err) reject(err)
        else resolve(stat)
      })
    })
  }

  /**
   * chmod
   *
   * @param {String} remotePath
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * @return {Promise}
   */
  chmod (remotePath, mode) {
    return new Promise((resolve, reject) => {
      const { sftp } = this
      sftp.chmod(remotePath, mode, (err) => {
        if (err) reject(err)
        else resolve(1)
      })
    })
  }

  /**
   * rename
   *
   * @param {String} remotePath
   * @param {String} remotePathNew
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * @return {Promise}
   */
  rename (remotePath, remotePathNew) {
    return new Promise((resolve, reject) => {
      const { sftp } = this
      sftp.rename(remotePath, remotePathNew, (err) => {
        if (err) reject(err)
        else resolve(1)
      })
    })
  }

  /**
   * rm delete single file
   *
   * @param {String} remotePath
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * @return {Promise}
   */
  rmFolder (remotePath) {
    return new Promise((resolve, reject) => {
      const { sftp } = this
      sftp.rmdir(remotePath, (err) => {
        if (err) reject(err)
        else resolve(1)
      })
    })
  }

  /**
   * rm delete single file
   *
   * @param {String} remotePath
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * @return {Promise}
   */
  rm (remotePath) {
    return new Promise((resolve, reject) => {
      const { sftp } = this
      sftp.unlink(remotePath, (err) => {
        if (err) reject(err)
        else resolve(1)
      })
    })
  }

  /**
   * readFile single file
   *
   * @param {String} remotePath
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * @return {Promise}
   */
  readFile (remotePath) {
    return readRemoteFile(this.sftp, remotePath)
  }

  readFilePreview (remotePath, maxBytes) {
    return readRemoteFilePreview(this.sftp, remotePath, maxBytes)
  }

  readFileRange (remotePath, options) {
    return readRemoteFileRange(this.sftp, remotePath, options)
  }

  chown (remotePath, uid, gid) {
    if (typeof this.sftp?.chown !== 'function') {
      return Promise.reject(new Error('当前 SFTP 服务端不支持 chown，无法保留 ownership。'))
    }
    return new Promise((resolve, reject) => {
      this.sftp.chown(remotePath, uid, gid, (err) => {
        if (err) reject(err)
        else resolve(1)
      })
    })
  }

  readFileChunk (remotePath, options) {
    return readRemoteFileChunk(this.sftp, remotePath, options)
  }

  searchFileText (remotePath, options) {
    return searchTextReader({
      readFileRange: rangeOptions => this.readFileRange(remotePath, rangeOptions)
    }, options)
  }

  listArchive (remotePath, options) {
    return listRemoteArchive(this.sftp, remotePath, options)
  }

  readArchiveTextEntry (remotePath, entryPath, options) {
    return readRemoteArchiveTextEntry(this.sftp, remotePath, entryPath, options)
  }

  /**
   * writeFile single file
   *
   * @param {String} remotePath
   * https://github.com/mscdex/ssh2/blob/master/SFTP.md
   * @return {Promise}
   */
  writeFile (remotePath, str, mode) {
    return writeRemoteFile(this.sftp, remotePath, str, mode)
  }
  // end
}

exports.Sftp = commonExtends(Sftp)
