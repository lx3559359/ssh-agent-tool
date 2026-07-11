const path = require('path')
const os = require('os')
const fsp = require('fs/promises')

const REDACTED = '[已脱敏]'
const DEFAULT_MAX_LOG_CHARS = 200 * 1024
const DEFAULT_MAX_ADDITIONAL_LOG_FILES = 8

const SECRET_PATTERNS = [
  /(Authorization\s*:\s*Bearer\s+)[^\s"'`]+/ig,
  /(Authorization\s*:\s*)[^\r\n]+/ig,
  /((?:Set-)?Cookie\s*:\s*)[^\r\n]+/ig,
  /((?:api[-_ ]?key|apikey|apiKeyAI|token|secret|password|passphrase|private[-_ ]?key|proxy[-_ ]?password|certificate)\s*[:=]\s*["']?)[^"'\r\n]+/ig
]

const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
const URL_PASSWORD_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)([^@\s/]+)(@)/ig

function escapeRegExp (value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function redactPath (text, value) {
  const raw = String(value || '')
  if (!raw) {
    return text
  }
  let next = text.replace(new RegExp(escapeRegExp(raw), 'g'), REDACTED)
  if (raw.includes('\\')) {
    next = next.replace(new RegExp(escapeRegExp(raw.replace(/\\/g, '/')), 'g'), REDACTED)
  }
  if (raw.includes('/')) {
    next = next.replace(new RegExp(escapeRegExp(raw.replace(/\//g, '\\')), 'g'), REDACTED)
  }
  return next
}

function redactDiagnosticText (text, options = {}) {
  let next = String(text || '')
  next = next.replace(PRIVATE_KEY_BLOCK_PATTERN, REDACTED)
  next = next.replace(URL_PASSWORD_PATTERN, `$1${REDACTED}$3`)
  for (const pattern of SECRET_PATTERNS) {
    next = next.replace(pattern, `$1${REDACTED}`)
  }

  const paths = [
    options.homeDir,
    options.userProfile,
    options.appDataPath
  ]
  for (const p of paths) {
    next = redactPath(next, p)
  }

  const userName = String(options.userName || '').trim()
  if (userName) {
    next = next
      .replace(new RegExp(`/Users/${escapeRegExp(userName)}(?=/|$)`, 'g'), `/Users/${REDACTED}`)
      .replace(new RegExp(`C:\\\\Users\\\\${escapeRegExp(userName)}(?=\\\\|$)`, 'g'), `C:\\Users\\${REDACTED}`)
  }

  return next
}

function redactObject (value, options = {}) {
  if (Array.isArray(value)) {
    return value.map(item => redactObject(item, options))
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string'
      ? redactDiagnosticText(value, options)
      : value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (/api[-_ ]?key|apikey|token|secret|password|passphrase|private/i.test(key)) {
        return [key, REDACTED]
      }
      return [key, redactObject(item, options)]
    })
  )
}

function limitLogText (logText, maxLogChars = DEFAULT_MAX_LOG_CHARS) {
  const text = String(logText || '')
  if (text.length <= maxLogChars) {
    return text
  }
  return `[日志已截断，仅保留最后 ${maxLogChars} 个字符]\n` + text.slice(-maxLogChars)
}

function sanitizeDiagnosticPath (name) {
  const parts = String(name || '')
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.trim())
    .filter(part => part && part !== '.' && part !== '..' && part !== 'logs')
    .map(part => [...part].map(char => {
      return '<>:"|?*'.includes(char) || char.charCodeAt(0) < 32
        ? '_'
        : char
    }).join(''))

  return parts.length
    ? path.posix.join('logs', ...parts)
    : ''
}

function buildDiagnosticSummary (included = [], omitted = []) {
  const lines = [
    'Included files:',
    ...included.map(name => `- ${name}`),
    '',
    'Omitted files:'
  ]
  if (!omitted.length) {
    lines.push('- None')
  } else {
    lines.push(...omitted.map(item => `- ${item.path}: ${item.reason}`))
  }
  return lines.join('\n') + '\n'
}

function buildDiagnosticReport (options = {}) {
  const redactOptions = {
    homeDir: options.homeDir || os.homedir(),
    userName: options.userName || os.userInfo().username,
    userProfile: process.env.USERPROFILE,
    appDataPath: process.env.APPDATA
  }
  const manifest = redactObject({
    createdAt: options.now || new Date().toISOString(),
    app: {
      name: options.packInfo?.name,
      productName: options.packInfo?.productName || 'AIGShell',
      version: options.packInfo?.version
    },
    runtime: {
      platform: options.platform || process.platform,
      arch: options.arch || process.arch,
      versions: options.versions || process.versions
    },
    paths: {
      appPath: options.appPath,
      exePath: options.exePath,
      logFilePath: options.logFilePath
    },
    install: {
      isPortable: !!options.isPortable
    }
  }, redactOptions)

  const safeLog = limitLogText(
    redactDiagnosticText(options.logText, redactOptions),
    options.maxLogChars
  )
  const logFiles = {
    'logs/main.log': safeLog
  }

  for (const item of options.additionalLogs || []) {
    const fileName = sanitizeDiagnosticPath(item?.name)
    if (!fileName || logFiles[fileName]) {
      continue
    }
    logFiles[fileName] = limitLogText(
      redactDiagnosticText(item.text, redactOptions),
      options.maxLogChars
    )
  }

  const omitted = (options.omissions || []).map(item => ({
    path: sanitizeDiagnosticPath(item?.path) || 'logs/unknown.log',
    reason: String(item?.reason || 'unknown')
  }))
  const included = ['manifest.json', 'summary.txt', ...Object.keys(logFiles)]
  manifest.files = { included, omitted }
  const files = {
    'manifest.json': JSON.stringify(manifest, null, 2),
    'summary.txt': buildDiagnosticSummary(included, omitted),
    ...logFiles
  }

  return {
    manifest,
    files
  }
}

async function readLogText (logFilePath) {
  if (!logFilePath) {
    return ''
  }
  try {
    return await fsp.readFile(logFilePath, 'utf8')
  } catch {
    return ''
  }
}

async function collectRecentLogFiles (logDir, prefix, options = {}) {
  const logs = []
  const omissions = []
  if (!logDir) {
    return { logs, omissions }
  }
  let entries
  try {
    entries = await fsp.readdir(logDir, { withFileTypes: true })
  } catch {
    omissions.push({
      path: sanitizeDiagnosticPath(path.posix.join(prefix, 'directory.log')),
      reason: 'directory_read_failed'
    })
    return { logs, omissions }
  }

  const files = []
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    const diagnosticPath = sanitizeDiagnosticPath(path.posix.join(prefix, entry.name))
    if (path.extname(entry.name).toLowerCase() !== '.log') {
      omissions.push({ path: diagnosticPath, reason: 'unsupported_file_type' })
      continue
    }
    try {
      const fullPath = path.join(logDir, entry.name)
      const stat = await fsp.stat(fullPath)
      files.push({
        name: path.posix.join(prefix, entry.name),
        diagnosticPath,
        fullPath,
        mtimeMs: stat.mtimeMs
      })
    } catch {
      omissions.push({ path: diagnosticPath, reason: 'read_failed' })
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const limit = Number(options.additionalLogLimit || DEFAULT_MAX_ADDITIONAL_LOG_FILES)
  for (const item of files.slice(limit)) {
    omissions.push({ path: item.diagnosticPath, reason: 'file_limit_exceeded' })
  }
  for (const item of files.slice(0, limit)) {
    try {
      logs.push({ name: item.name, text: await fsp.readFile(item.fullPath, 'utf8') })
    } catch {
      omissions.push({ path: item.diagnosticPath, reason: 'read_failed' })
    }
  }
  return { logs, omissions }
}

async function readRecentLogFiles (logDir, prefix, options = {}) {
  return (await collectRecentLogFiles(logDir, prefix, options)).logs
}

async function exportDiagnosticPack (options = {}) {
  const logFilePath = options.logFilePath
  const logText = options.logText ?? await readLogText(logFilePath)
  const collected = await collectRecentLogFiles(options.sessionLogDir, 'session', options)
  const additionalLogs = [
    ...(options.additionalLogs || []),
    ...collected.logs
  ]
  const report = buildDiagnosticReport({
    ...options,
    logText,
    additionalLogs,
    omissions: [...(options.omissions || []), ...collected.omissions]
  })
  const outputPath = options.outputPath || path.join(
    os.tmpdir(),
    `AIGShell-diagnostic-${Date.now()}.tar`
  )
  const tempRoot = options.tempRoot || os.tmpdir()
  const tempDir = await fsp.mkdtemp(path.join(tempRoot, 'aigshell-diagnostic-'))

  try {
    await Promise.all(
      Object.entries(report.files).map(([name, content]) => {
        const target = path.join(tempDir, name)
        return fsp.mkdir(path.dirname(target), { recursive: true })
          .then(() => fsp.writeFile(target, content, 'utf8'))
      })
    )

    const tar = require('tar')
    await tar.c({
      gzip: false,
      file: outputPath,
      cwd: tempDir
    }, Object.keys(report.files))

    const omittedCount = report.manifest.files.omitted.length
    return {
      outputPath,
      files: Object.keys(report.files),
      hasOmissions: omittedCount > 0,
      omittedCount
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true })
  }
}

module.exports = {
  buildDiagnosticReport,
  exportDiagnosticPack,
  limitLogText,
  readRecentLogFiles,
  collectRecentLogFiles,
  redactDiagnosticText
}
