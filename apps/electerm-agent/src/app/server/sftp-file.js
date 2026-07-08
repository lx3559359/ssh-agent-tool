/**
 * sftp read/write file
 */

const { Readable, Writable } = require('stream')

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

module.exports = {
  readRemoteFile,
  writeRemoteFile
}
