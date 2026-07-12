/**
 * terminal/sftp/serial class
 */

exports.commonExtends = function (Cls) {
  Cls.prototype.customEnv = function (envs) {
    if (!envs) {
      return {}
    }
    return envs.split(' ').reduce((p, k) => {
      const [key, value] = k.split('=')
      if (key && value) {
        p[key] = value
      }
      return p
    }, {})
  }

  Cls.prototype.getEnv = function (initOptions = this.initOptions) {
    return {
      LANG: initOptions.envLang || 'en_US.UTF-8',
      ...this.customEnv(initOptions.setEnv)
    }
  }

  Cls.prototype.getExecOpts = function () {
    return {
      env: this.getEnv()
    }
  }

  Cls.prototype.runCmd = function (cmd, conn, options = {}) {
    return new Promise((resolve, reject) => {
      const client = conn || this.conn || this.client
      client.exec(cmd, this.getExecOpts(), (err, stream) => {
        if (err) {
          reject(err)
          return
        }
        if (stream) {
          let r = ''
          let settled = false
          let timer
          const finish = (callback, value) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            callback(value)
          }
          const timeoutMs = Number(options.timeoutMs)
          if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            timer = setTimeout(() => {
              const error = new Error(`Command timed out after ${timeoutMs}ms`)
              error.name = 'RunCmdTimeoutError'
              finish(reject, error)
              if (typeof stream.close === 'function') stream.close()
              else if (typeof stream.destroy === 'function') stream.destroy()
            }, timeoutMs)
          }
          stream
            .on('data', function (data) {
              const d = data.toString()
              r = r + d
            })
            .on('error', error => {
              finish(reject, error)
            })
            .on('close', (code, signal) => {
              finish(resolve, r)
            })
        } else {
          resolve('')
        }
      })
    })
  }
  return Cls
}
