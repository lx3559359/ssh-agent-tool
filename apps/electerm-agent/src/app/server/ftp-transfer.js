// ftp-transfer.js
/**
 * ftp transfer class
 * Note: basic-ftp only supports one active transfer per client connection
 */

function waitForTerminalPromise (promise, deadline, message) {
  const observed = Promise.resolve(promise)
  const remaining = deadline - Date.now()
  if (remaining <= 0) {
    observed.catch(() => {})
    return Promise.reject(new Error(message))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => settle(new Error(message)), remaining)
    observed.then(
      value => settle(null, value),
      error => settle(error)
    )
  })
}

class Transfer {
  constructor ({
    remotePath,
    localPath,
    options = {},
    id,
    type = 'download',
    ftpSession,
    sftpId,
    ws
  }) {
    this.id = id
    this.ftpSession = ftpSession
    this.ftpClient = null
    this.srcPath = type === 'download' ? remotePath : localPath
    this.dstPath = type === 'download' ? localPath : remotePath
    this.isUpload = type !== 'download'
    this.ws = ws
    this.pausing = false
    this.onDestroy = false
    this.total = 0
    this.startPromise = null
    this.destroyPromise = null
    this.destroyError = null
    this.clientClosePromises = new WeakMap()
    this.terminalJoinTimeout = 10000
    this.src = null
    this.dst = null
    this.start()
  }

  handleProgress = (info) => {
    if (this.pausing) return
    const chunk = info.bytes - this.total
    this.total = info.bytes
    this.onData(this.total, chunk)
  }

  onData = (total, chunk) => {
    if (this.pausing) return
    this.ws?.s({
      id: `transfer:data:${this.id}`,
      data: total
    })
  }

  onEnd = () => {
    this.ws?.s({
      id: `transfer:end:${this.id}`,
      data: null
    })
  }

  onError = (err) => {
    if (!err) {
      return this.onEnd()
    }
    this.ws?.s({
      id: `transfer:err:${this.id}`,
      error: {
        message: err.message,
        stack: err.stack
      }
    })
  }

  trackProgress = () => {
    this.total = 0
    this.ftpClient?.trackProgress(this.handleProgress)
  }

  async start () {
    if (this.startPromise) {
      return this.startPromise
    }
    this.startPromise = this.startTransfer()
    return this.startPromise
  }

  async startTransfer () {
    let ftpClient
    try {
      if (this.onDestroy) {
        return
      }
      ftpClient = await this.ftpSession.createOperationClient()
      if (this.onDestroy) {
        return
      }
      this.ftpClient = ftpClient
      this.trackProgress()
      if (!this.isUpload) {
        await this.ftpClient.downloadTo(this.dstPath, this.srcPath)
      } else {
        await this.ftpClient.uploadFrom(this.srcPath, this.dstPath)
      }
      if (!this.onDestroy) this.onEnd()
    } catch (err) {
      if (!this.onDestroy) this.onError(err)
    } finally {
      if (ftpClient) {
        try {
          await this.closeOperationClient(ftpClient)
        } catch (error) {
          if (this.onDestroy) this.destroyError ||= error
        }
      }
      if (this.ftpClient === ftpClient) this.ftpClient = null
    }
  }

  closeOperationClient (ftpClient) {
    if (!ftpClient) return Promise.resolve(true)
    const current = this.clientClosePromises.get(ftpClient)
    if (current) return current
    const closing = Promise.resolve().then(() => {
      ftpClient.trackProgress?.()
      return ftpClient.close?.()
    }).then(() => true)
    this.clientClosePromises.set(ftpClient, closing)
    return closing
  }

  pause () {
    this.pausing = true
  }

  resume () {
    this.pausing = false
  }

  cancel () {
    return this.destroy()
  }

  interrupt () {
    return this.destroy()
  }

  destroy () {
    if (this.destroyPromise) return this.destroyPromise
    this.onDestroy = true
    const ftpClient = this.ftpClient
    this.destroyPromise = (async () => {
      const deadline = Date.now() + this.terminalJoinTimeout
      let primaryError
      try {
        await waitForTerminalPromise(
          this.closeOperationClient(ftpClient),
          deadline,
          'Timed out waiting for FTP operation client to close'
        )
      } catch (error) {
        primaryError = error
      }
      try {
        await waitForTerminalPromise(
          this.startPromise,
          deadline,
          'Timed out waiting for FTP transfer start to stop'
        )
      } catch (error) {
        primaryError ||= error
      }
      primaryError ||= this.destroyError
      this.ftpClient = null
      this.src = null
      this.dst = null
      if (primaryError) throw primaryError
      return true
    })()
    return this.destroyPromise
  }
}

module.exports = {
  Transfer
}
