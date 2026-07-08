const path = require('path')
const os = require('os')
const fsp = require('fs/promises')

const REDACTED = '[已脱敏]'
const DEFAULT_MAX_LOG_CHARS = 200 * 1024

const SECRET_PATTERNS = [
  /(Authorization\s*:\s*Bearer\s+)[^\s"'`]+/ig,
  /(Authorization\s*:\s*)[^\r\n]+/ig,
  /((?:api[-_ ]?key|apikey|apiKeyAI|token|secret|password|passphrase)\s*[:=]\s*["']?)[^"'\r\n]+/ig
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
  const manifestText = JSON.stringify(manifest, null, 2)

  return {
    manifest,
    files: {
      'manifest.json': manifestText,
      'logs/main.log': safeLog
    }
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

async function exportDiagnosticPack (options = {}) {
  const logFilePath = options.logFilePath
  const logText = options.logText ?? await readLogText(logFilePath)
  const report = buildDiagnosticReport({
    ...options,
    logText
  })
  const outputPath = options.outputPath || path.join(
    os.tmpdir(),
    `AIGShell-diagnostic-${Date.now()}.tar`
  )
  const tempDir = path.join(os.tmpdir(), `aigshell-diagnostic-${Date.now()}`)
  await fsp.mkdir(path.join(tempDir, 'logs'), { recursive: true })
  await Promise.all(
    Object.entries(report.files).map(([name, content]) => {
      return fsp.writeFile(path.join(tempDir, name), content, 'utf8')
    })
  )

  const tar = require('tar')
  await tar.c({
    gzip: false,
    file: outputPath,
    cwd: tempDir
  }, Object.keys(report.files))
  await fsp.rm(tempDir, { recursive: true, force: true })

  return {
    outputPath,
    files: Object.keys(report.files)
  }
}

module.exports = {
  buildDiagnosticReport,
  exportDiagnosticPack,
  limitLogText,
  redactDiagnosticText
}
