const fss = require('fs/promises')
const fs = require('fs')
const crypto = require('crypto')
const log = require('../common/log')
const path = require('path')
const { isWin, isMac, tempDir } = require('../common/runtime-constants')
const uid = require('../common/uid')
const { promisify } = require('util')
const { exec, spawn } = require('child_process')
const execAsync = promisify(exec)
const { getSizeCount, getSizeCountWin } = require('../common/get-folder-size-and-file-count.js')
const {
  normalizePreviewMaxBytes,
  createTextFilePreview
} = require('../common/file-preview')
const { readTextRange } = require('../common/file-range')
const {
  listArchive,
  readArchiveTextEntry
} = require('../common/archive-reader')
const { searchTextReader } = require('../common/log-search')

const ROOT_PATH = '/'
const TRANSFER_DIGEST_CHUNK_BYTES = 64 * 1024
const TRANSFER_DIGEST_ALGORITHM = 'SHELLPILOT-SHA-256-CHAIN-V1'
const TRANSFER_DESCRIPTOR_LIMITS = Object.freeze({
  maxDepth: 128,
  maxNodes: 10000,
  maxTotalBytes: 1024 * 1024 * 1024 * 1024,
  maxManifestBytes: 256 * 1024
})

function boundedPositiveInteger (value, fallback) {
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, fallback)
    : fallback
}

function transferDescriptorLimits (options = {}) {
  return Object.fromEntries(Object.entries(TRANSFER_DESCRIPTOR_LIMITS).map(([key, value]) => [
    key,
    boundedPositiveInteger(options[key], value)
  ]))
}

function uint64Bytes (value) {
  const result = Buffer.alloc(8)
  result.writeBigUInt64BE(BigInt(value))
  return result
}

class TransferBoundedDigest {
  constructor () {
    this.state = Buffer.alloc(32)
    this.block = Buffer.alloc(TRANSFER_DIGEST_CHUNK_BYTES)
    this.used = 0
    this.size = 0
  }

  update (value) {
    const bytes = Buffer.from(value)
    let offset = 0
    while (offset < bytes.length) {
      const length = Math.min(this.block.length - this.used, bytes.length - offset)
      bytes.copy(this.block, this.used, offset, offset + length)
      this.used += length
      this.size += length
      offset += length
      if (this.used === this.block.length) {
        this.state = crypto.createHash('sha256')
          .update(this.state)
          .update(Buffer.from([0]))
          .update(this.block)
          .digest()
        this.used = 0
      }
    }
  }

  finish () {
    return {
      size: this.size,
      digest: crypto.createHash('sha256')
        .update(this.state)
        .update(Buffer.from([1]))
        .update(this.block.subarray(0, this.used))
        .update(uint64Bytes(this.size))
        .digest('hex'),
      digestAlgorithm: TRANSFER_DIGEST_ALGORITHM
    }
  }
}

function stableLocalStat (stat) {
  return [
    stat.dev,
    stat.ino,
    stat.size,
    stat.mode,
    stat.mtimeMs,
    stat.ctimeMs
  ].join(':')
}

async function describeTransferEntryInternal (filePath, budget, depth) {
  if (depth > budget.maxDepth) {
    throw new Error('本地上传目录超过允许的深度上限。')
  }
  if (budget.remainingNodes <= 0) {
    throw new Error('本地上传目录超过允许的节点上限。')
  }
  budget.remainingNodes -= 1
  const before = await fss.lstat(filePath)
  if (before.isSymbolicLink()) {
    throw new Error('本地上传源包含符号链接，已拒绝受保护传输。')
  }
  if (!before.isFile() && !before.isDirectory()) {
    throw new Error('本地上传源包含特殊文件，已拒绝受保护传输。')
  }
  const descriptor = {
    type: before.isDirectory() ? 'directory' : 'file',
    mode: Number(before.mode) & 0o7777,
    uid: Number.isSafeInteger(before.uid) ? before.uid : 0,
    gid: Number.isSafeInteger(before.gid) ? before.gid : 0
  }
  if (before.isFile()) {
    if (budget.totalBytes + before.size > budget.maxTotalBytes) {
      throw new Error('本地上传源超过允许的总字节上限。')
    }
    budget.totalBytes += before.size
    const digest = new TransferBoundedDigest()
    for await (const chunk of fs.createReadStream(filePath, {
      highWaterMark: TRANSFER_DIGEST_CHUNK_BYTES
    })) {
      digest.update(chunk)
    }
    const result = digest.finish()
    const after = await fss.lstat(filePath)
    if (stableLocalStat(before) !== stableLocalStat(after) || result.size !== before.size) {
      throw new Error('本地上传源在摘要计算期间发生变化。')
    }
    return { ...descriptor, ...result }
  }

  const names = await fss.readdir(filePath)
  descriptor.entries = []
  for (const name of names.sort((left, right) => left.localeCompare(right))) {
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
      throw new Error('本地上传目录包含无效条目名称。')
    }
    descriptor.entries.push({
      name,
      entry: await describeTransferEntryInternal(
        path.join(filePath, name),
        budget,
        depth + 1
      )
    })
  }
  const after = await fss.lstat(filePath)
  if (stableLocalStat(before) !== stableLocalStat(after)) {
    throw new Error('本地上传目录在摘要计算期间发生变化。')
  }
  return descriptor
}

async function describeTransferEntry (filePath, options = {}) {
  const limits = transferDescriptorLimits(options)
  const descriptor = await describeTransferEntryInternal(filePath, {
    ...limits,
    remainingNodes: limits.maxNodes,
    totalBytes: 0
  }, 0)
  if (Buffer.byteLength(JSON.stringify(descriptor), 'utf8') > limits.maxManifestBytes) {
    throw new Error('本地上传目录清单超过允许的大小上限。')
  }
  return descriptor
}

function encodeUtf8Base64 (value) {
  return Buffer.from(String(value), 'utf8').toString('base64')
}

async function readFilePreview (filePath, maxBytes) {
  const limit = normalizePreviewMaxBytes(maxBytes)
  const handle = await fss.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(limit + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const value = buffer.subarray(0, bytesRead)
    return createTextFilePreview(value, {
      maxBytes: limit,
      truncated: bytesRead > limit
    })
  } finally {
    await handle.close()
  }
}

async function readFileRange (filePath, options) {
  const handle = await fss.open(filePath, 'r')
  try {
    return await readTextRange({
      async size () {
        const stat = await handle.stat()
        return stat.size
      },
      async read (offset, length) {
        const buffer = Buffer.alloc(length)
        let totalRead = 0
        while (totalRead < buffer.length) {
          const { bytesRead } = await handle.read(
            buffer,
            totalRead,
            buffer.length - totalRead,
            offset + totalRead
          )
          if (bytesRead === 0) {
            break
          }
          totalRead += bytesRead
        }
        return buffer.subarray(0, totalRead)
      }
    }, options)
  } finally {
    await handle.close()
  }
}

function searchFileText (filePath, options) {
  return searchTextReader({
    readFileRange: rangeOptions => readFileRange(filePath, rangeOptions)
  }, options)
}

// Encoding function
function encodeUint8Array (uint8Arr) {
  return Buffer.from(uint8Arr).toString('base64')
}

// Decoding function
function decodeBase64String (base64String) {
  return new Uint8Array(Buffer.from(base64String, 'base64'))
}

const isWinDrive = function (path) {
  return /^\w+:$/.test(path)
}

/**
 * run cmd
 * @param {string} cmd
 */
const run = (cmd) => {
  const { Bash } = require('node-bash')
  const ps = new Bash({
    executableOptions: {
      '--login': true
    }
  })
  return ps.invokeCommand(cmd)
    .then(s => s.stdout.toString())
}

/**
 * run windows cmd
 * @param {string} cmd
 */
const runWinCmd = (cmd) => {
  return execAsync(`powershell.exe -Command "${cmd}"`)
}

function spawnDetachedCommand (command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: false,
      stdio: ['ignore', 'ignore', 'pipe'],
      ...options
    })
    let stderr = ''

    child.stderr.on('data', data => {
      stderr += data.toString()
    })
    child.on('error', reject)

    let settled = false
    const settle = (err) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      child.unref()
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    }

    child.on('close', code => {
      if (code !== 0) {
        settle(new Error(stderr.trim() || `Command exited with code ${code}`))
      } else {
        settle(null)
      }
    })

    const timer = setTimeout(() => settle(null), 5000)
  })
}

function getFolderSizeWin (folderPath) {
  return runWinCmd(
    `Get-ChildItem -Path "${folderPath}" -Recurse | Where-Object { ! $_.PSIsContainer } | Measure-Object -Property Length -Sum`
  ).then(res => getSizeCountWin(res.stdout))
}

function getFolderSize (folderPath) {
  if (isWin) {
    return getFolderSizeWin(folderPath)
  }
  return run(`du -sh "${folderPath}" && find "${folderPath}" -type f | wc -l`)
    .then(getSizeCount)
}

/**
 * rm -rf directory
 * @param {string} localFolderPath absolute path of directory
 */
const rmrf = (localFolderPath) => {
  return fss.rm(localFolderPath, { recursive: true, force: true })
}

/**
 * Recursive copy helper for Node.js < 16.7.0 (where fs.cp doesn't exist)
 */
async function cpRecursive (src, dest) {
  const stat = await fss.stat(src)
  if (stat.isDirectory()) {
    await fss.mkdir(dest, { recursive: true })
    const entries = await fss.readdir(src)
    for (const entry of entries) {
      await cpRecursive(path.join(src, entry), path.join(dest, entry))
    }
  } else {
    await fss.copyFile(src, dest)
  }
}

/**
 * cp from to
 * @param {string} from absolute source path
 * @param {string} to absolute destination path
 */
const cp = async (from, to) => {
  if (typeof fss.cp === 'function') {
    return fss.cp(from, to, { recursive: true, force: true })
  }
  return cpRecursive(from, to)
}

/**
 * mv from to
 * @param {string} from absolute source path
 * @param {string} to absolute destination path
 */
const mv = async (from, to) => {
  try {
    await fss.rename(from, to)
  } catch (error) {
    if (!error || error.code !== 'EXDEV') {
      throw error
    }
    // Cross-device move: copy then remove
    await cp(from, to)
    await fss.rm(from, { recursive: true, force: true })
  }
  return true
}

/**
 * touch file
 * @param {string} localFolderPath absolute path
 */
const touch = (localFilePath) => {
  return fss.writeFile(localFilePath, '')
}

/**
 * open file
 * @param {string} localFolderPath absolute path
 */
const openFile = (localFilePath) => {
  if (isWin) {
    const script = '$path = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:ELECTERM_OPEN_FILE_PATH_B64)); Invoke-Item -LiteralPath $path'
    return spawnDetachedCommand('powershell.exe', [
      '-NoLogo',
      '-NonInteractive',
      '-Command',
      script
    ], {
      windowsHide: true,
      env: {
        ...process.env,
        ELECTERM_OPEN_FILE_PATH_B64: encodeUtf8Base64(localFilePath)
      }
    })
  }
  return spawnDetachedCommand(isMac ? 'open' : 'xdg-open', [localFilePath])
}

/**
 * zip file
 * @param {string} localFolerPath absolute path of a folder
 */
const zipFolder = (localFolerPath) => {
  const n = uid()
  const p = path.resolve(tempDir, `electerm-temp-${n}.tar`)
  const cwd = path.dirname(localFolerPath)
  const file = path.basename(localFolerPath)
  const tar = require('tar')
  return tar.c({
    gzip: false,
    file: p,
    cwd
  }, [file])
    .then(() => p)
}

const handleWindowsDrive = async (localFilePath, targetFolderPath) => {
  const tar = require('tar')
  const tempExtractDir = path.join(tempDir, `electerm-unzip-${uid()}`)
  await fss.mkdir(tempExtractDir, { recursive: true })

  try {
    await tar.x({ file: localFilePath, C: tempExtractDir })
    const items = await fss.readdir(tempExtractDir)

    await Promise.all(items.map(async (item) => {
      const from = path.join(tempExtractDir, item)
      const to = path.join(targetFolderPath, item)
      await mv(from, to)
    }))
  } finally {
    await rmrf(tempExtractDir).catch(log.error)
  }
}

/**
 * unzip file
 * @param {string} localFilePath absolute path of a zip file
 * @param {string} targetFolderPath absolute path of unzip target folder
 */
const unzipFile = async (localFilePath, targetFolderPath) => {
  const tar = require('tar')
  if (isWin && isWinDrive(targetFolderPath)) {
    await handleWindowsDrive(localFilePath, targetFolderPath)
  } else {
    await tar.x({ file: localFilePath, C: targetFolderPath })
  }
  return 1
}

async function listWindowsRootPath () {
  const drives = await new Promise((resolve, reject) => {
    const { exec } = require('child_process')
    const command = 'powershell.exe -Command "Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root"'

    exec(command, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      if (stderr) {
        reject(new Error(stderr))
        return
      }
      const drives = stdout.split('\r\n')
        .map(line => line.trim())
        // Accept any valid Windows path that ends with backslash
        .filter(line => /^[^<>:"/\\|?*]+:\\$/.test(line))
        .map(drive => drive.slice(0, -1)) // Remove trailing backslash
      resolve(drives)
    })
  })
  const distros = await listWslDistros()
  return [...drives, ...distros]
}

async function listWslDistros () {
  try {
    const { stdout } = await execAsync('wsl.exe -l -q', { encoding: 'buffer' })
    const output = Buffer.from(stdout).toString('utf16le').replace(/^\uFEFF/, '')
    const distros = output.split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(name => '\\\\wsl.localhost\\' + name)
    return distros
  } catch {
    return []
  }
}

const readCustom = (p1, len, ...args) => {
  return new Promise((resolve, reject) => {
    fs.read(p1, new Uint8Array(len), ...args, (err, n, buffer) => {
      if (err) {
        return reject(err)
      }
      return resolve({ n, newArr: encodeUint8Array(buffer) })
    })
  })
}

const writeCustom = (p1, arr) => {
  return new Promise((resolve, reject) => {
    const narr = decodeBase64String(arr)
    fs.write(p1, narr, (err, n) => {
      if (err) {
        return reject(err)
      }
      return resolve(1)
    })
  })
}

const openCustom = async (...args) => {
  return new Promise((resolve, reject) => {
    fs.open(...args, (err, n) => {
      if (err) {
        return reject(err)
      }
      return resolve(n)
    })
  })
}

const closeCustom = async (...args) => {
  return new Promise((resolve, reject) => {
    fs.close(...args, (err) => {
      if (err) {
        return reject(err)
      }
      return resolve(true)
    })
  })
}

const statCustom = async (...args) => {
  const st = await fss.stat(...args)
  st.isD = st.isDirectory()
  st.isF = st.isFile()
  return st
}

const fsExport = Object.assign(
  {},
  fss,
  {
    getFolderSize,
    run,
    runWinCmd,
    rmrf,
    touch,
    cp,
    mv,
    openFile,
    zipFolder,
    unzipFile,
    readCustom,
    writeCustom,
    openCustom,
    closeCustom,
    statCustom,
    describeTransferEntry
  },
  {
    readdirAsync: (_path) => {
      if (_path === ROOT_PATH && isWin) {
        return listWindowsRootPath()
      }
      let path = _path
      if (isWin && isWinDrive(path)) {
        path = path + '\\'
      }
      return fss.readdir(path)
    },
    statAsync: (...args) => {
      return fss.stat(...args)
        .then(res => {
          return {
            ...res,
            isDirectory: res.isDirectory()
          }
        })
    },
    lstatAsync: (...args) => {
      return fss.lstat(...args)
        .then(res => {
          return {
            ...res,
            isDirectory: res.isDirectory(),
            isSymbolicLink: res.isSymbolicLink()
          }
        })
    },
    readFilePreview,
    readFileRange,
    searchFileText,
    listArchive,
    readArchiveTextEntry,
    readFile: (...args) => {
      return fss.readFile(...args, 'utf8')
    },
    readFileAsBase64: (...args) => {
      return fss.readFile(...args)
        .then(res => {
          return res.toString('base64')
        })
    },
    writeFile: (path, txt, mode) => {
      return fss.writeFile(path, txt, { mode })
        .then(() => true)
        .catch((e) => {
          log.error('fs.writeFile', e)
          return false
        })
    }
  }
)

module.exports = {
  fsExport
}
