const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const tar = require('tar')
const yauzl = require('yauzl')
const {
  normalizeRangeOptions,
  readTextRange
} = require('./file-range')

const ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 5000,
  maxEntryBytes: 100 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024,
  maxPreviewBytes: 1024 * 1024
})

function getLimits (options = {}) {
  return {
    maxEntries: options.maxEntries || ARCHIVE_LIMITS.maxEntries,
    maxEntryBytes: options.maxEntryBytes || ARCHIVE_LIMITS.maxEntryBytes,
    maxTotalBytes: options.maxTotalBytes || ARCHIVE_LIMITS.maxTotalBytes,
    maxPreviewBytes: options.maxPreviewBytes || ARCHIVE_LIMITS.maxPreviewBytes
  }
}

function detectArchiveType (filePath) {
  const value = String(filePath || '').toLowerCase()
  if (value.endsWith('.tar.gz') || value.endsWith('.tgz')) {
    return 'tar.gz'
  }
  if (value.endsWith('.zip')) {
    return 'zip'
  }
  if (value.endsWith('.gz')) {
    return 'gz'
  }
  throw new Error('只支持 .gz、.zip 和 .tar.gz 压缩日志')
}

function validateArchiveEntryPath (entryPath) {
  const normalized = String(entryPath || '').replace(/\\/g, '/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:\//.test(normalized)
  ) {
    throw new Error('压缩成员路径无效')
  }
  if (normalized.split('/').includes('..')) {
    throw new Error('压缩成员包含路径穿越')
  }
  return normalized
}

function getGzipEntryPath (filePath) {
  const base = path.basename(filePath)
  return base.toLowerCase().endsWith('.gz')
    ? base.slice(0, -3)
    : base
}

function assertEntryWithinLimits (entry, limits) {
  if (entry.size > limits.maxEntryBytes) {
    throw new Error('压缩成员超过单文件读取上限')
  }
}

function assertArchiveListWithinLimits (entries, totalBytes, limits) {
  if (entries.length > limits.maxEntries) {
    throw new Error('压缩成员数量超过上限')
  }
  if (totalBytes > limits.maxTotalBytes) {
    throw new Error('压缩包解压总量超过上限')
  }
}

function getReadCollectLimit (options, limits, knownSize) {
  const normalized = normalizeRangeOptions(options)
  const requestedEnd = normalized.offset + normalized.maxBytes + 5
  const sizeLimit = Number.isSafeInteger(knownSize)
    ? Math.min(knownSize, limits.maxEntryBytes)
    : limits.maxEntryBytes
  return Math.min(sizeLimit, requestedEnd, limits.maxPreviewBytes)
}

function collectStreamPrefix (stream, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let settled = false
    const cleanup = () => {
      stream.removeListener('data', onData)
      stream.removeListener('end', onEnd)
      stream.removeListener('error', onError)
    }
    const settle = (err, result) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (err) {
        reject(err)
      } else {
        resolve(result)
      }
    }
    const onData = chunk => {
      const value = Buffer.from(chunk)
      const remaining = limit - total
      if (remaining <= 0) {
        settle(null, {
          buffer: Buffer.concat(chunks),
          truncated: true
        })
        stream.destroy?.()
        return
      }
      if (value.length > remaining) {
        chunks.push(value.subarray(0, remaining))
        total += remaining
        settle(null, {
          buffer: Buffer.concat(chunks),
          truncated: true
        })
        stream.destroy?.()
        return
      }
      chunks.push(value)
      total += value.length
    }
    const onEnd = () => {
      settle(null, {
        buffer: Buffer.concat(chunks),
        truncated: false
      })
    }
    const onError = err => settle(err)

    stream.on('data', onData)
    stream.on('end', onEnd)
    stream.on('error', onError)
  })
}

async function rangeFromBuffer ({
  buffer,
  options,
  archiveType,
  entryPath,
  totalBytes
}) {
  const result = await readTextRange({
    async size () {
      return totalBytes
    },
    async read (offset, length) {
      return buffer.subarray(offset, offset + length)
    }
  }, options)
  return {
    ...result,
    archiveType,
    entryPath
  }
}

function openZip (filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, {
      lazyEntries: true,
      validateEntrySizes: true
    }, (err, zipfile) => {
      if (err) {
        reject(err)
        return
      }
      resolve(zipfile)
    })
  })
}

function openZipEntryStream (zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) {
        reject(err)
        return
      }
      resolve(stream)
    })
  })
}

async function listZipArchive (filePath, options) {
  const limits = getLimits(options)
  const zipfile = await openZip(filePath)
  return new Promise((resolve, reject) => {
    const entries = []
    let totalUncompressedBytes = 0
    let settled = false
    const finish = (err) => {
      if (settled) {
        return
      }
      settled = true
      zipfile.close()
      if (err) {
        reject(err)
      } else {
        resolve({
          type: 'zip',
          entries,
          totalUncompressedBytes,
          truncated: false
        })
      }
    }
    zipfile.on('entry', entry => {
      try {
        const entryPath = validateArchiveEntryPath(entry.fileName)
        if (!entryPath.endsWith('/')) {
          const item = {
            path: entryPath,
            size: entry.uncompressedSize,
            compressedSize: entry.compressedSize
          }
          assertEntryWithinLimits(item, limits)
          entries.push(item)
          totalUncompressedBytes += item.size
          assertArchiveListWithinLimits(entries, totalUncompressedBytes, limits)
        }
        zipfile.readEntry()
      } catch (err) {
        finish(err)
      }
    })
    zipfile.on('end', () => finish())
    zipfile.on('error', finish)
    zipfile.readEntry()
  })
}

async function readZipTextEntry (filePath, entryPath, options) {
  const limits = getLimits(options)
  const targetPath = validateArchiveEntryPath(entryPath)
  const zipfile = await openZip(filePath)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err, result) => {
      if (settled) {
        return
      }
      settled = true
      zipfile.close()
      if (err) {
        reject(err)
      } else {
        resolve(result)
      }
    }
    zipfile.on('entry', async entry => {
      try {
        const currentPath = validateArchiveEntryPath(entry.fileName)
        if (currentPath !== targetPath) {
          zipfile.readEntry()
          return
        }
        const item = {
          path: currentPath,
          size: entry.uncompressedSize,
          compressedSize: entry.compressedSize
        }
        assertEntryWithinLimits(item, limits)
        const stream = await openZipEntryStream(zipfile, entry)
        const collected = await collectStreamPrefix(
          stream,
          getReadCollectLimit(options, limits, item.size)
        )
        const result = await rangeFromBuffer({
          buffer: collected.buffer,
          options,
          archiveType: 'zip',
          entryPath: currentPath,
          totalBytes: item.size
        })
        finish(null, result)
      } catch (err) {
        finish(err)
      }
    })
    zipfile.on('end', () => {
      finish(new Error('未找到指定压缩成员'))
    })
    zipfile.on('error', finish)
    zipfile.readEntry()
  })
}

async function listTarGzArchive (filePath, options) {
  const limits = getLimits(options)
  const entries = []
  let totalUncompressedBytes = 0
  await tar.t({
    file: filePath,
    onentry: entry => {
      const entryPath = validateArchiveEntryPath(entry.path)
      if (entry.type !== 'File') {
        entry.resume()
        return
      }
      const item = {
        path: entryPath,
        size: entry.size
      }
      assertEntryWithinLimits(item, limits)
      entries.push(item)
      totalUncompressedBytes += item.size
      assertArchiveListWithinLimits(entries, totalUncompressedBytes, limits)
      entry.resume()
    }
  })
  return {
    type: 'tar.gz',
    entries,
    totalUncompressedBytes,
    truncated: false
  }
}

async function readTarGzTextEntry (filePath, entryPath, options) {
  const limits = getLimits(options)
  const targetPath = validateArchiveEntryPath(entryPath)
  let found = false
  let result
  await tar.t({
    file: filePath,
    onentry: entry => {
      const currentPath = validateArchiveEntryPath(entry.path)
      if (currentPath !== targetPath) {
        entry.resume()
        return
      }
      found = true
      if (entry.type !== 'File') {
        throw new Error('压缩成员不是普通文件')
      }
      const item = {
        path: currentPath,
        size: entry.size
      }
      assertEntryWithinLimits(item, limits)
      const chunks = []
      let total = 0
      const limit = getReadCollectLimit(options, limits, item.size)
      entry.on('data', chunk => {
        if (total >= limit) {
          return
        }
        const value = Buffer.from(chunk)
        const remaining = limit - total
        const part = value.subarray(0, remaining)
        chunks.push(part)
        total += part.length
      })
      entry.on('end', () => {
        result = Buffer.concat(chunks)
      })
    }
  })
  if (!found) {
    throw new Error('未找到指定压缩成员')
  }
  return rangeFromBuffer({
    buffer: result || Buffer.alloc(0),
    options,
    archiveType: 'tar.gz',
    entryPath: targetPath,
    totalBytes: result && result.length
  })
}

async function listGzipArchive (filePath, options = {}) {
  const entryPath = validateArchiveEntryPath(
    options.gzipEntryPath || getGzipEntryPath(filePath)
  )
  return {
    type: 'gz',
    entries: [{
      path: entryPath,
      size: null
    }],
    totalUncompressedBytes: null,
    truncated: false
  }
}

async function readGzipTextEntry (filePath, entryPath, options) {
  const limits = getLimits(options)
  const expectedPath = validateArchiveEntryPath(
    options.gzipEntryPath || getGzipEntryPath(filePath)
  )
  const targetPath = validateArchiveEntryPath(entryPath || expectedPath)
  if (targetPath !== expectedPath) {
    throw new Error('未找到指定压缩成员')
  }
  const collected = await collectStreamPrefix(
    fs.createReadStream(filePath).pipe(zlib.createGunzip()),
    getReadCollectLimit(options, limits)
  )
  return rangeFromBuffer({
    buffer: collected.buffer,
    options,
    archiveType: 'gz',
    entryPath: targetPath,
    totalBytes: collected.truncated
      ? collected.buffer.length + 1
      : collected.buffer.length
  })
}

function listArchive (filePath, options = {}) {
  const type = detectArchiveType(filePath)
  if (type === 'gz') {
    return listGzipArchive(filePath, options)
  }
  if (type === 'zip') {
    return listZipArchive(filePath, options)
  }
  return listTarGzArchive(filePath, options)
}

function readArchiveTextEntry (filePath, entryPath, options = {}) {
  const type = detectArchiveType(filePath)
  if (type === 'gz') {
    return readGzipTextEntry(filePath, entryPath, options)
  }
  if (type === 'zip') {
    return readZipTextEntry(filePath, entryPath, options)
  }
  return readTarGzTextEntry(filePath, entryPath, options)
}

module.exports = {
  ARCHIVE_LIMITS,
  detectArchiveType,
  validateArchiveEntryPath,
  listArchive,
  readArchiveTextEntry
}
