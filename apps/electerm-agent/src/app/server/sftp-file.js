/**
 * sftp read/write file
 */

const { Readable, Writable } = require('stream')
const {
  normalizePreviewMaxBytes,
  createTextFilePreview
} = require('../common/file-preview')

function createReadStreamFromString (str) {
  const s = new Readable()
  s._read = () => {}
  s.push(str)
  s.push(null)
  return s
}

class FakeWrite extends Writable {
  constructor (opts) {
    super(opts)
    this.opts = opts
  }

  _write (data, encoding, done) {
    this.opts.onData(data)
    done()
  }
}

function writeRemoteFile (sftp, path, str, mode) {
  return new Promise((resolve, reject) => {
    const writeStream = sftp.createWriteStream(path, {
      highWaterMark: 64 * 1024 * 4 * 4,
      mode
    })
    writeStream.on('close', () => {
      resolve('ok')
    })
    writeStream.on('error', (e) => {
      reject(e)
    })
    createReadStreamFromString(str).pipe(writeStream)
  })
}

function readRemoteFile (sftp, path) {
  return new Promise((resolve, reject) => {
    let final = Buffer.alloc(0)
    let readClosed = false
    let writeFinished = false
    let settled = false
    const settle = (err) => {
      if (settled) {
        return
      }
      if (err) {
        settled = true
        reject(err)
        return
      }
      if (readClosed && writeFinished) {
        settled = true
        resolve(final.toString())
      }
    }
    const writeStream = new FakeWrite({
      onData: data => {
        final = Buffer.concat(
          [final, data]
        )
      }
    })
    writeStream.on('finish', () => {
      writeFinished = true
      settle()
    })
    writeStream.on('error', (e) => {
      settle(e)
    })
    const readStream = sftp.createReadStream(path, {
      highWaterMark: 64 * 1024 * 4 * 4
    })
    readStream.on('close', () => {
      readClosed = true
      settle()
    })
    readStream.on('error', (e) => {
      settle(e)
    })
    readStream.pipe(writeStream)
  })
}

function readRemoteFilePreview (sftp, path, maxBytes) {
  const limit = normalizePreviewMaxBytes(maxBytes)
  return new Promise((resolve, reject) => {
    const maxCollectedBytes = limit + 1
    const chunks = []
    let collectedBytes = 0
    let settled = false
    const readStream = sftp.createReadStream(path, {
      start: 0,
      end: limit,
      highWaterMark: Math.min(limit + 1, 64 * 1024)
    })

    const cleanup = () => {
      readStream?.removeListener('data', onData)
      readStream?.removeListener('end', onEnd)
      readStream?.removeListener('close', onClose)
      readStream?.removeListener('error', onError)
    }
    const settle = (err) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (err) {
        reject(err)
        return
      }
      const value = Buffer.concat(chunks)
      resolve(createTextFilePreview(value, {
        maxBytes: limit,
        truncated: collectedBytes > limit
      }))
    }
    const stopStream = () => {
      if (typeof readStream?.destroy === 'function') {
        readStream.once('error', () => {})
        readStream.destroy()
      } else {
        readStream?.pause?.()
      }
    }
    const onData = data => {
      if (settled || collectedBytes >= maxCollectedBytes) {
        return
      }
      const value = Buffer.from(data)
      const remaining = maxCollectedBytes - collectedBytes
      const part = value.subarray(0, remaining)
      if (part.length) {
        chunks.push(part)
        collectedBytes += part.length
      }
      if (collectedBytes >= maxCollectedBytes) {
        settle()
        stopStream()
      }
    }
    const onEnd = () => settle()
    const onClose = () => {
      settle(new Error('SFTP 文件预览流提前关闭'))
    }
    const onError = err => settle(err)

    readStream.on('data', onData)
    readStream.on('end', onEnd)
    readStream.on('close', onClose)
    readStream.on('error', onError)
  })
}

module.exports = {
  readRemoteFile,
  readRemoteFilePreview,
  writeRemoteFile
}
