/**
 * log ssh output to file
 */

const { resolve } = require('path')
const { mkdirSync, openSync, fstatSync, closeSync, createWriteStream } = require('fs')
const { redactLogValue } = require('../lib/log-redaction')

function mkLogDir (logDir) {
  mkdirSync(logDir, { recursive: true })
}

class SessionLog {
  constructor (options) {
    this.options = options
    const { logDir } = options
    const logPath = resolve(logDir, options.fileName)
    mkLogDir(logDir)
    const fd = openSync(logPath, 'a')
    if (!fstatSync(fd).isFile()) {
      closeSync(fd)
      const error = new Error(`EISDIR: illegal operation on a directory, open '${logPath}'`)
      error.code = 'EISDIR'
      throw error
    }
    try {
      this.stream = createWriteStream(logPath, {
        fd,
        flags: 'a',
        autoClose: true
      })
    } catch (error) {
      closeSync(fd)
      throw error
    }
    this.error = null
    this.stream.on('error', error => {
      this.error = error
      if (typeof options.onError === 'function') {
        options.onError(error)
      }
    })
  }

  write (text) {
    if (this.error) {
      throw this.error
    }
    this.stream.write(typeof text === 'string' ? redactLogValue(text) : text)
  }

  destroy () {
    this.stream.destroy()
  }
}

module.exports = SessionLog
