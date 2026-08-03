/**
 * transfer class
 */

const fs = require('original-fs')
const tar = require('tar')
const _ = require('../lib/lodash.js')
const log = require('../common/log')

const { FolderTransfer } = require('ssh2-scp/folder-transfer')

function atomicUploadPath (remotePath, id) {
  const value = String(remotePath || '')
  const separatorIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  const directory = separatorIndex >= 0 ? value.slice(0, separatorIndex + 1) : ''
  const name = (separatorIndex >= 0 ? value.slice(separatorIndex + 1) : value) || 'upload'
  const safeName = name.slice(0, 96).replace(/[^a-zA-Z0-9._-]/g, '_')
  const safeId = String(id || 'transfer').replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${directory}.${safeName}.shellpilot-upload-${safeId}.part`
}

function atomicUploadDirectoryAndName (remotePath) {
  const value = String(remotePath || '')
  const separatorIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  const directory = separatorIndex >= 0 ? value.slice(0, separatorIndex + 1) : ''
  const name = (separatorIndex >= 0 ? value.slice(separatorIndex + 1) : value) || 'upload'
  return {
    directory,
    safeName: name.slice(0, 96).replace(/[^a-zA-Z0-9._-]/g, '_')
  }
}

function validateAtomicPartialPath (remotePath, partialPath) {
  if (!partialPath) return null
  const candidate = String(partialPath)
  const expected = atomicUploadDirectoryAndName(remotePath)
  const actual = atomicUploadDirectoryAndName(candidate)
  const escapedName = expected.safeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `^\\.${escapedName}\\.shellpilot-upload-[a-zA-Z0-9_-]+\\.part$`
  )
  if (
    actual.directory !== expected.directory ||
    !pattern.test(candidate.slice(actual.directory.length))
  ) {
    const error = new Error('Invalid resumable upload partial path')
    error.code = 'TRANSFER_PARTIAL_PATH_INVALID'
    throw error
  }
  return candidate
}

function isRecoverableTransferError (error) {
  return [
    'ECONNRESET',
    'ECONNABORTED',
    'ETIMEDOUT',
    'EPIPE',
    'ENETDOWN',
    'ENETRESET',
    'ENETUNREACH',
    'EHOSTDOWN',
    'EHOSTUNREACH'
  ].includes(error?.code) ||
    /socket|connection|channel.*closed|timed?\s*out/i.test(
      String(error?.message || error)
    )
}

class Transfer {
  constructor ({
    remotePath,
    localPath,
    options = {},
    id,
    type = 'download',
    sftp,
    conn,
    sftpId,
    isDirectory = false,
    ws,
    encode = 'utf8'
  }) {
    this.id = id
    const isd = type === 'download'
    this.src = isd ? sftp : fs
    this.dst = isd ? fs : sftp
    this.sftpId = sftpId
    this.srcPath = isd ? remotePath : localPath
    this.dstPath = !isd ? remotePath : localPath
    this.conn = conn
    this.pausing = false
    this.hadError = false
    this.isUpload = !isd
    this.isDirectory = isDirectory
    this.options = options
    this.startOffset = Math.max(0, Number(options.startOffset) || 0)
    this.keepPartial = options.keepPartial === true
    this.transferred = this.startOffset
    this.inFlightOperations = 0
    this.pauseAcknowledged = false
    this.pausedReads = new Map()
    this.stopReason = null
    this.atomicUpload = this.isUpload &&
      !isDirectory &&
      options.atomicUpload === true &&
      sftp &&
      sftp !== fs
    this.atomicOverwrite = options.atomicOverwrite === true
    if (this.atomicUpload) {
      this.finalDstPath = this.dstPath
      this.dstPath = validateAtomicPartialPath(
        this.finalDstPath,
        options.partialPath
      ) || atomicUploadPath(this.finalDstPath, id)
    }
    this.concurrency = options.concurrency || 64
    this.chunkSize = options.chunkSize || 32768
    this.mode = options.mode
    this.encode = encode
    this.onData = _.throttle((data) => {
      ws.s({
        id: 'transfer:data:' + id,
        data
      })
    }, 3000)
    this.timers = {}

    this.ws = ws
    this.initTransfer(type)
  }

  shouldUseSsh2ScpTransfer = () => {
    if ((this.src && this.src.isSshFsFallback) || (this.dst && this.dst.isSshFsFallback)) {
      return true
    }
    return false
  }

  initTransfer = async (type) => {
    if (this.shouldUseFolderTransfer(type)) {
      return this.ssh2ScpFolderTransfer(type)
    }
    if (this.shouldUseSsh2ScpTransfer()) {
      return this.ssh2ScpTransfer(type)
    }
    this.fastXfer(type)
  }

  shouldUseFolderTransfer = (type) => {
    return this.isDirectory &&
      this.conn
  }

  ssh2ScpFolderTransfer = async (type) => {
    try {
      const remotePath = type === 'download' ? this.srcPath : this.dstPath
      const localPath = type === 'download' ? this.dstPath : this.srcPath
      const folderOpts = {
        type,
        remotePath,
        localPath,
        chunkSize: this.chunkSize,
        onProgress: (transferred, total) => {
          this.onData({
            transferred,
            total
          })
        }
      }
      if (this.encode !== 'utf8') {
        folderOpts.iconv = require('iconv-lite')
        folderOpts.encoding = this.encode
      }
      this.scpTransfer = new FolderTransfer(this.conn, tar, folderOpts)
      await this.scpTransfer.startTransfer()
      const state = this.scpTransfer.getState
        ? this.scpTransfer.getState()
        : {}
      this.onEnd({
        transferred: state.transferred,
        size: state.total
      })
    } catch (err) {
      this.onError(err)
    }
  }

  ssh2ScpTransfer = async (type) => {
    try {
      const sshFs = type === 'download' ? this.src : this.dst
      const remotePath = type === 'download' ? this.srcPath : this.dstPath
      const localPath = type === 'download' ? this.dstPath : this.srcPath
      const { Transfer: Ssh2ScpTransfer } = require('ssh2-scp/transfer')
      this.scpTransfer = new Ssh2ScpTransfer(sshFs, {
        type,
        remotePath,
        localPath,
        chunkSize: this.chunkSize,
        onProgress: (transferred) => {
          this.onData(transferred)
        }
      })
      await this.scpTransfer.startTransfer()
      await this.finishSuccessfulTransfer()
    } catch (err) {
      this.onError(err)
    }
  }

  callSftp = (method, ...args) => {
    return new Promise((resolve, reject) => {
      if (typeof method !== 'function') {
        reject(new Error('SFTP operation is not supported by the server'))
        return
      }
      method.call(this.dst, ...args, err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  cleanupAtomicUpload = async () => {
    if (!this.atomicUpload || this.atomicUploadCommitted || !this.dstPath || !this.dst) return
    if (!this.atomicCleanupPromise) {
      this.atomicCleanupPromise = (async () => {
        try {
          await this.callSftp(this.dst.unlink, this.dstPath)
        } catch (error) {
          if (!/no such|not found/i.test(String(error?.message || error))) {
            log.warn('cleanup atomic SFTP upload failed', error)
          }
        }
      })()
    }
    await this.atomicCleanupPromise
  }

  supportsOpenSshRename = () => {
    return this.dst?._extensions?.['posix-rename@openssh.com'] === '1'
  }

  renameAtomicUpload = async () => {
    const { dst, dstPath, finalDstPath } = this
    if (this.supportsOpenSshRename() &&
      typeof dst.ext_openssh_rename === 'function') {
      try {
        await this.callSftp(dst.ext_openssh_rename, dstPath, finalDstPath)
        return
      } catch (error) {
        if (!/unsupported|not supported|does not support|unknown/i.test(String(error?.message || error))) {
          throw error
        }
      }
    }
    try {
      await this.callSftp(dst.rename, dstPath, finalDstPath)
    } catch (error) {
      if (!this.atomicOverwrite || typeof dst.unlink !== 'function') throw error
      await this.callSftp(dst.unlink, finalDstPath)
      await this.callSftp(dst.rename, dstPath, finalDstPath)
    }
  }

  finishSuccessfulTransfer = async (data) => {
    if (this.atomicUpload) {
      try {
        await this.renameAtomicUpload()
        this.atomicUploadCommitted = true
      } catch (error) {
        return this.onError(error)
      }
    }
    this.onEnd(data)
  }

  tryCreateBuffer = (size) => {
    try {
      return Buffer.allocUnsafe(size)
    } catch (ex) {
      return ex
    }
  }

  // from https://github.com/mscdex/ssh2-streams/blob/master/lib/sftp.js
  fastXfer () {
    const { src, srcPath } = this
    src.open(srcPath, 'r', this.onSrcOpen)
  }

  onSrcOpen = (err, sourceHandle) => {
    if (err) {
      return this.onError(err)
    }
    if (this.onDestroy) {
      return
    }
    const { src } = this
    const th = this

    th.srcHandle = sourceHandle

    src.fstat(th.srcHandle, this.tryStat)
  }

  tryStat = (err, attrs) => {
    const { src, dst, srcPath, dstPath } = this
    const th = this
    if (err) {
      if (src !== fs) {
        // Try stat() for sftp servers that may not support fstat() for
        // whatever reason
        src.stat(srcPath, (err_, attrs_) => {
          if (err_) {
            return th.onError(err_)
          }
          this.tryStat(null, attrs_)
        })
        return
      }
      return th.onError(err)
    }
    this.fsize = attrs.size
    // Store source mtime (in ms) for preserving after transfer
    // attrs.mtime is a Date for local fs, but a number (seconds) for SFTP
    this.srcMtime = attrs.mtime instanceof Date
      ? attrs.mtime.getTime()
      : attrs.mtime * 1000
    if (this.startOffset > this.fsize) {
      const error = new Error('Transfer checkpoint exceeds source size')
      error.code = 'TRANSFER_CHECKPOINT_INVALID'
      return this.onError(error)
    }
    const openDestination = () => {
      dst.open(
        dstPath,
        this.startOffset > 0 ? 'r+' : 'w',
        this.onDstOpen
      )
    }
    if (this.startOffset <= 0) {
      return openDestination()
    }
    dst.stat(dstPath, (statError, targetAttrs) => {
      if (statError) return this.onError(statError)
      if (Number(targetAttrs?.size) !== this.startOffset) {
        const error = new Error('Transfer partial size no longer matches checkpoint')
        error.code = 'TRANSFER_PARTIAL_CHANGED'
        return this.onError(error)
      }
      openDestination()
    })
  }

  onDstOpen = (err, destHandle) => {
    if (err) {
      return this.onError(err)
    }

    if (this.onDestroy) {
      return
    }

    let {
      concurrency,
      chunkSize,
      mode
    } = this
    const onstep = this.onData
    const { src, dst, dstPath } = this
    const th = this

    // internal state variables
    let pdst = this.startOffset
    let total = this.startOffset
    let bufsize = chunkSize * concurrency

    const { fsize } = this

    th.dstHandle = destHandle
    th.transferred = total

    let hadError = false

    function onerror (err) {
      if (hadError) return
      hadError = true
      const canCloseSrc = th.srcHandle && (src === fs || (src.outgoing && src.outgoing.state === 'open'))
      const canCloseDst = th.dstHandle && (dst === fs || (dst.outgoing && dst.outgoing.state === 'open'))

      const closeHandles = () => {
        let left = 0
        if (canCloseSrc) ++left
        if (canCloseDst) ++left
        const finish = () => {
          if (--left === 0) {
            if (err) th.onError(err)
            else th.finishSuccessfulTransfer()
          }
        }
        if (left === 0) {
          if (err) th.onError(err)
          else th.finishSuccessfulTransfer()
          return
        }
        if (canCloseSrc) {
          src.close(th.srcHandle, () => {
            th.srcHandle = undefined
            finish()
          })
        }
        if (canCloseDst) {
          dst.close(th.dstHandle, () => {
            th.dstHandle = undefined
            finish()
          })
        }
      }

      // Preserve source file mtime on destination after successful transfer
      if (!err && th.srcMtime && canCloseDst) {
        const mtimeDate = new Date(th.srcMtime)
        dst.futimes(th.dstHandle, mtimeDate, mtimeDate, (utimesErr) => {
          if (utimesErr) {
            // Try utimes() as fallback for sftp servers that may not support futimes()
            dst.utimes(dstPath, mtimeDate, mtimeDate, () => {
              closeHandles()
            })
            return
          }
          closeHandles()
        })
        return
      }

      closeHandles()
    }

    if (fsize <= 0 || total === fsize) {
      return onerror()
    }

    // Use less memory where possible
    const remaining = fsize - total
    while (bufsize > remaining) {
      if (concurrency === 1) {
        bufsize = remaining
        break
      }
      bufsize -= chunkSize
      --concurrency
    }

    const readbuf = th.tryCreateBuffer(bufsize)
    if (readbuf instanceof Error) {
      return th.onError(readbuf)
    }

    if (mode !== undefined) {
      dst.fchmod(th.dstHandle, mode, function tryAgain (err) {
        if (err) {
          // Try chmod() for sftp servers that may not support fchmod() for
          // whatever reason
          dst.chmod(dstPath, mode, function (err_) {
            tryAgain()
          })
          return
        }
        startReads()
      })
    } else {
      startReads()
    }

    function onread (err, nb, data, dstpos, datapos, origChunkLen) {
      if (hadError) {
        return
      }
      if (err) {
        th.inFlightOperations = Math.max(0, th.inFlightOperations - 1)
        return onerror(err)
      }

      if (th.onDestroy) {
        th.inFlightOperations = Math.max(0, th.inFlightOperations - 1)
        return
      }

      datapos = datapos || 0

      dst.write(th.dstHandle, readbuf, datapos, nb, dstpos, writeCb)

      function writeCb (err) {
        th.inFlightOperations = Math.max(0, th.inFlightOperations - 1)
        if (hadError) {
          return
        }
        if (err) {
          return onerror(err)
        }

        total += nb
        th.transferred = total
        onstep && onstep({
          transferred: total,
          chunk: nb,
          total: fsize
        })

        if (nb < origChunkLen) {
          return singleRead(datapos, dstpos + nb, origChunkLen - nb)
        }

        if (total === fsize) {
          return onerror()
        }

        if (pdst >= fsize) {
          return
        }

        const chunk = (pdst + chunkSize > fsize ? fsize - pdst : chunkSize)
        singleRead(datapos, pdst, chunk)
        pdst += chunk
        th.maybeAcknowledgePause()
      }
    }

    function makeCb (psrc, pdst, chunk) {
      return function (err, nb, data) {
        onread(err, nb, data, pdst, psrc, chunk)
      }
    }

    function singleRead (psrc, pdst, chunk) {
      if (th.onDestroy || hadError) {
        return
      }
      if (th.pausing) {
        th.pausedReads.set(psrc + ':' + pdst, {
          psrc,
          pdst,
          chunk
        })
        th.maybeAcknowledgePause()
        return
      }
      th.inFlightOperations += 1
      src.read(
        th.srcHandle,
        readbuf,
        psrc,
        chunk,
        pdst,
        makeCb(psrc, pdst, chunk)
      )
    }

    th.resumePausedReads = () => {
      const reads = [...th.pausedReads.values()]
      th.pausedReads.clear()
      reads.forEach(({ psrc, pdst, chunk }) => {
        singleRead(psrc, pdst, chunk)
      })
    }

    function startReads () {
      let reads = 0
      let psrc = 0
      while (pdst < fsize && reads < concurrency) {
        const chunk = (pdst + chunkSize > fsize ? fsize - pdst : chunkSize)
        singleRead(psrc, pdst, chunk)
        psrc += chunk
        pdst += chunk
        ++reads
      }
    }
  }

  onEnd = (data = null, id = this.id, ws = this.ws) => {
    ws?.s({
      id: 'transfer:end:' + id,
      data
    })
  }

  onError = (err = '', id = this.id, ws = this.ws) => {
    if (!err) {
      return this.finishSuccessfulTransfer()
    }
    if (this.keepPartial && isRecoverableTransferError(err)) {
      this.stopReason = 'connection-lost'
    }
    Promise.resolve(this.cleanupAfterStop()).finally(() => {
      ws && ws.s({
        id: 'transfer:err:' + id,
        error: {
          message: err.message,
          stack: err.stack
        }
      })
    })
  }

  shouldKeepPartial = () => {
    return this.keepPartial &&
      ['paused', 'interrupted', 'connection-lost'].includes(this.stopReason)
  }

  cleanupAfterStop = () => {
    return this.shouldKeepPartial()
      ? Promise.resolve()
      : this.cleanupAtomicUpload()
  }

  maybeAcknowledgePause = () => {
    if (
      !this.pausing ||
      this.pauseAcknowledged ||
      this.inFlightOperations > 0
    ) {
      return
    }
    this.pauseAcknowledged = true
    this.stopReason = 'paused'
    this.ws?.s({
      id: 'transfer:paused:' + this.id,
      data: {
        offset: this.transferred,
        total: this.fsize,
        partialPath: this.atomicUpload ? this.dstPath : null,
        source: {
          size: this.fsize,
          mtimeMs: this.srcMtime
        }
      }
    })
  }

  pause = () => {
    this.pausing = true
    this.scpTransfer && this.scpTransfer.pause && this.scpTransfer.pause()
    this.maybeAcknowledgePause()
  }

  resume = () => {
    this.pausing = false
    this.pauseAcknowledged = false
    this.stopReason = null
    this.scpTransfer && this.scpTransfer.resume && this.scpTransfer.resume()
    this.resumePausedReads?.()
  }

  kill = () => {
    if (this.src && this.srcHandle && this.src.close) {
      this.src.close(this.srcHandle, log.error)
    }
    if (this.dst && this.dstHandle && this.dst.close) {
      this.dst.close(this.dstHandle, log.error)
    }
    this.src = null
    this.dst = null
    this.srcHandle = null
    this.dstHandle = null
  }

  cancel = () => {
    this.stopReason = 'cancelled'
    this.destroy()
  }

  interrupt = () => {
    this.stopReason = 'interrupted'
    this.destroy()
  }

  destroy = () => {
    if (!this.stopReason) {
      this.stopReason = this.keepPartial ? 'interrupted' : 'cancelled'
    }
    this.onDestroy = true
    this.scpTransfer && this.scpTransfer.destroy && this.scpTransfer.destroy()
    this.cleanupAfterStop()
    setTimeout(this.kill, 200)
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    if (this.timers) {
      Object.keys(this.timers).forEach(k => {
        clearTimeout(this.timers[k])
        this.timers[k] = null
      })
      this.timers = null
    }
  }

  // end
}

module.exports = {
  Transfer,
  atomicUploadPath,
  validateAtomicPartialPath,
  transferKeys: [
    'pause',
    'resume',
    'cancel',
    'interrupt',
    'destroy'
  ]
}
