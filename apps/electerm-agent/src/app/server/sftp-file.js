/**
 * sftp read/write file
 */

const fs = require('fs')
const fss = require('fs/promises')
const os = require('os')
const pathLib = require('path')
const { Readable, Writable } = require('stream')
const { pipeline } = require('stream/promises')
const {
  normalizePreviewMaxBytes,
  createTextFilePreview
} = require('../common/file-preview')
const { readTextRange } = require('../common/file-range')
const {
  listArchive,
  readArchiveTextEntry
} = require('../common/archive-reader')
const uid = require('../common/uid')

const MAX_REMOTE_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024

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

function openRemoteFile (sftp, path) {
  return new Promise((resolve, reject) => {
    sftp.open(path, 'r', (err, fileHandle) => {
      if (err) {
        reject(err)
        return
      }
      resolve(fileHandle)
    })
  })
}

function statRemoteFile (sftp, path, fileHandle) {
  return new Promise((resolve, reject) => {
    const callback = (err, stat) => {
      if (err) {
        reject(err)
        return
      }
      resolve(stat)
    }
    if (typeof sftp.fstat === 'function') {
      sftp.fstat(fileHandle, callback)
      return
    }
    sftp.stat(path, callback)
  })
}

function readRemoteFileHandle (sftp, fileHandle, offset, length) {
  return new Promise((resolve, reject) => {
    const buffer = Buffer.alloc(length)
    let totalRead = 0
    const readNext = () => {
      if (totalRead >= buffer.length) {
        resolve(buffer.subarray(0, totalRead))
        return
      }
      sftp.read(
        fileHandle,
        buffer,
        totalRead,
        buffer.length - totalRead,
        offset + totalRead,
        (err, bytesRead) => {
          if (err) {
            reject(err)
            return
          }
          if (!bytesRead) {
            resolve(buffer.subarray(0, totalRead))
            return
          }
          totalRead += bytesRead
          readNext()
        }
      )
    }
    readNext()
  })
}

function closeRemoteFile (sftp, fileHandle) {
  return new Promise((resolve, reject) => {
    sftp.close(fileHandle, err => {
      if (err) {
        reject(err)
        return
      }
      resolve(true)
    })
  })
}

function statRemotePath (sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stat) => {
      if (err) {
        reject(err)
        return
      }
      resolve(stat)
    })
  })
}

function getArchiveExtension (remotePath) {
  const value = String(remotePath || '').toLowerCase()
  if (value.endsWith('.tar.gz')) {
    return '.tar.gz'
  }
  if (value.endsWith('.tgz')) {
    return '.tgz'
  }
  if (value.endsWith('.zip')) {
    return '.zip'
  }
  if (value.endsWith('.gz')) {
    return '.gz'
  }
  return ''
}

function getGzipEntryPath (remotePath) {
  const base = pathLib.basename(String(remotePath || ''))
  return base.toLowerCase().endsWith('.gz')
    ? base.slice(0, -3)
    : base
}

function getArchiveOptions (remotePath, options = {}) {
  return getArchiveExtension(remotePath) === '.gz'
    ? {
        ...options,
        gzipEntryPath: getGzipEntryPath(remotePath)
      }
    : options
}

async function withRemoteArchiveTempFile (sftp, remotePath, options, action) {
  const maxArchiveBytes = options?.maxArchiveBytes || MAX_REMOTE_ARCHIVE_BYTES
  const stat = await statRemotePath(sftp, remotePath)
  if (stat.size > maxArchiveBytes) {
    throw new Error('远程压缩包超过读取上限')
  }
  const tempPath = pathLib.join(
    os.tmpdir(),
    `shellpilot-archive-${uid()}${getArchiveExtension(remotePath)}`
  )
  try {
    await pipeline(
      sftp.createReadStream(remotePath),
      fs.createWriteStream(tempPath)
    )
    return await action(tempPath)
  } finally {
    await fss.rm(tempPath, { force: true }).catch(() => {})
  }
}

async function readRemoteFileRange (sftp, path, options) {
  const fileHandle = await openRemoteFile(sftp, path)
  let readError
  let closeError
  let result
  try {
    result = await readTextRange({
      async size () {
        const stat = await statRemoteFile(sftp, path, fileHandle)
        return stat.size
      },
      async read (offset, length) {
        return readRemoteFileHandle(sftp, fileHandle, offset, length)
      }
    }, options)
  } catch (err) {
    readError = err
  }
  try {
    await closeRemoteFile(sftp, fileHandle)
  } catch (err) {
    closeError = err
  }
  if (readError) {
    throw readError
  }
  if (closeError) {
    throw closeError
  }
  return result
}

async function readRemoteFileChunk (sftp, path, options = {}) {
  const offset = Number.isSafeInteger(options.offset) && options.offset >= 0
    ? options.offset
    : 0
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
    ? Math.min(options.maxBytes, 64 * 1024)
    : 64 * 1024
  const fileHandle = await openRemoteFile(sftp, path)
  let readError
  let closeError
  let result
  try {
    const stat = await statRemoteFile(sftp, path, fileHandle)
    const totalBytes = Math.max(0, Number(stat.size) || 0)
    const safeOffset = Math.min(offset, totalBytes)
    const length = Math.min(maxBytes, totalBytes - safeOffset)
    const value = length
      ? await readRemoteFileHandle(sftp, fileHandle, safeOffset, length)
      : Buffer.alloc(0)
    const nextOffset = safeOffset + value.length
    result = {
      base64: value.toString('base64'),
      offset: safeOffset,
      nextOffset,
      bytesRead: value.length,
      totalBytes,
      hasMore: nextOffset < totalBytes
    }
  } catch (err) {
    readError = err
  }
  try {
    await closeRemoteFile(sftp, fileHandle)
  } catch (err) {
    closeError = err
  }
  if (readError) throw readError
  if (closeError) throw closeError
  return result
}

function listRemoteArchive (sftp, remotePath, options = {}) {
  const archiveOptions = getArchiveOptions(remotePath, options)
  return withRemoteArchiveTempFile(
    sftp,
    remotePath,
    options,
    tempPath => listArchive(tempPath, archiveOptions)
  )
}

function readRemoteArchiveTextEntry (sftp, remotePath, entryPath, options = {}) {
  const archiveOptions = getArchiveOptions(remotePath, options)
  return withRemoteArchiveTempFile(
    sftp,
    remotePath,
    options,
    tempPath => readArchiveTextEntry(tempPath, entryPath, archiveOptions)
  )
}

module.exports = {
  readRemoteFile,
  readRemoteFilePreview,
  readRemoteFileRange,
  readRemoteFileChunk,
  listRemoteArchive,
  readRemoteArchiveTextEntry,
  writeRemoteFile
}
