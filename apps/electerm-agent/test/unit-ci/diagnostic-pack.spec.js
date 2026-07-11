const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')

const {
  buildDiagnosticReport,
  exportDiagnosticPack,
  redactDiagnosticText
} = require(path.resolve(__dirname, '../../src/app/lib/diagnostic-pack'))
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const tar = require('tar')

async function extractDiagnosticPack (archivePath, parentDir) {
  const extractDir = await fsp.mkdtemp(path.join(parentDir, 'extracted-'))
  await tar.x({ file: archivePath, cwd: extractDir })
  return extractDir
}

async function readExtractedFile (extractDir, relativePath) {
  return fsp.readFile(path.join(extractDir, ...relativePath.split('/')), 'utf8')
}

async function listPackingTempDirs (tempRoot) {
  return (await fsp.readdir(tempRoot))
    .filter(name => name.startsWith('aigshell-diagnostic-'))
}

test('redacts secrets and local user paths from diagnostic text', () => {
  const text = [
    'Authorization: Bearer sk-live-secret',
    'apiKeyAI=abc123',
    'password: "root-password"',
    'C:\\Users\\alice\\AppData\\Roaming\\electerm\\users\\default_user',
    '/Users/alice/.ssh/id_rsa'
  ].join('\n')

  const redacted = redactDiagnosticText(text, {
    homeDir: 'C:\\Users\\alice',
    userName: 'alice'
  })

  assert.equal(redacted.includes('sk-live-secret'), false)
  assert.equal(redacted.includes('abc123'), false)
  assert.equal(redacted.includes('root-password'), false)
  assert.equal(redacted.includes('C:\\Users\\alice'), false)
  assert.equal(redacted.includes('/Users/alice'), false)
  assert.match(redacted, /\[已脱敏\]/)
})

test('redacts ssh private key blocks from diagnostic text', () => {
  const text = [
    'loading key',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ==',
    '-----END OPENSSH PRIVATE KEY-----',
    'done'
  ].join('\n')

  const redacted = redactDiagnosticText(text)

  assert.equal(redacted.includes('b3BlbnNzaC1rZXktdjE'), false)
  assert.equal(redacted.includes('BEGIN OPENSSH PRIVATE KEY'), false)
  assert.equal(redacted.includes('END OPENSSH PRIVATE KEY'), false)
  assert.match(redacted, /\[已脱敏\]/)
  assert.match(redacted, /loading key/)
  assert.match(redacted, /done/)
})

test('redacts passwords embedded in diagnostic URLs', () => {
  const text = [
    'ssh://root:server-password@10.0.1.23:22',
    'socks5://proxy-user:proxy-password@127.0.0.1:1080',
    'https://api-user:api-password@example.com/v1'
  ].join('\n')

  const redacted = redactDiagnosticText(text)

  assert.equal(redacted.includes('server-password'), false)
  assert.equal(redacted.includes('proxy-password'), false)
  assert.equal(redacted.includes('api-password'), false)
  assert.match(redacted, /ssh:\/\/root:\[已脱敏\]@10\.0\.1\.23:22/)
  assert.match(redacted, /socks5:\/\/proxy-user:\[已脱敏\]@127\.0\.0\.1:1080/)
  assert.match(redacted, /https:\/\/api-user:\[已脱敏\]@example\.com\/v1/)
})

test('redacts cookie and inline key material from diagnostic text', () => {
  const text = [
    'Cookie: session=browser-cookie-secret; csrf=csrf-secret',
    'Set-Cookie: token=session-cookie-secret; HttpOnly',
    'privateKey=inline-private-key-secret',
    'certificate: "inline-certificate-secret"',
    'proxyPassword=proxy-password-secret'
  ].join('\n')

  const redacted = redactDiagnosticText(text)

  assert.equal(redacted.includes('browser-cookie-secret'), false)
  assert.equal(redacted.includes('csrf-secret'), false)
  assert.equal(redacted.includes('session-cookie-secret'), false)
  assert.equal(redacted.includes('inline-private-key-secret'), false)
  assert.equal(redacted.includes('inline-certificate-secret'), false)
  assert.equal(redacted.includes('proxy-password-secret'), false)
  assert.notEqual(redacted, text)
})

test('builds a diagnostic report with safe metadata and truncated logs', () => {
  const report = buildDiagnosticReport({
    now: '2026-07-08T00:00:00.000Z',
    packInfo: {
      name: 'ssh-agent-tool',
      productName: 'AIGShell',
      version: '3.15.105'
    },
    platform: 'win32',
    arch: 'x64',
    versions: {
      electron: '41.2.0',
      chrome: '142.0.0',
      node: '24.0.0'
    },
    appPath: 'F:\\SSH工具开发\\apps\\electerm-agent',
    exePath: 'C:\\Users\\alice\\Desktop\\AIGShell.exe',
    isPortable: false,
    logFilePath: 'C:\\Users\\alice\\AppData\\Roaming\\AIGShell\\logs\\main.log',
    logText: 'first line\nAuthorization: Bearer secret-token\nlast line',
    maxLogChars: 22,
    homeDir: 'C:\\Users\\alice',
    userName: 'alice'
  })

  assert.equal(report.manifest.app.productName, 'AIGShell')
  assert.equal(report.manifest.app.version, '3.15.105')
  assert.equal(report.manifest.runtime.platform, 'win32')
  assert.equal(report.manifest.paths.exePath.includes('alice'), false)
  assert.equal(report.files['logs/main.log'].includes('secret-token'), false)
  assert.equal(report.files['logs/main.log'].startsWith('[日志已截断'), true)
  assert.equal(report.files['manifest.json'].includes('secret-token'), false)
})

test('builds a diagnostic report with redacted session and update logs', () => {
  const report = buildDiagnosticReport({
    logText: 'main log',
    additionalLogs: [
      {
        name: 'session/prod-web-01.log',
        text: 'ssh://root:server-password@10.0.1.23\nterminal output'
      },
      {
        name: 'update/update.log',
        text: 'Authorization: Bearer update-secret\nupdate failed'
      }
    ]
  })

  assert.match(report.files['logs/session/prod-web-01.log'], /terminal output/)
  assert.equal(report.files['logs/session/prod-web-01.log'].includes('server-password'), false)
  assert.match(report.files['logs/update/update.log'], /update failed/)
  assert.equal(report.files['logs/update/update.log'].includes('update-secret'), false)
})

test('export diagnostic pack records tar contents, omissions, redaction and success cleanup', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'aigshell-diagnostic-test-'))
  const sessionLogDir = path.join(tempRoot, 'session_logs')
  const outputPath = path.join(tempRoot, 'diagnostic.tar')
  await fsp.mkdir(sessionLogDir, { recursive: true })
  await fsp.writeFile(path.join(sessionLogDir, 'prod-web-01.log'), 'Authorization: Bearer session-secret\nssh output', 'utf8')
  await fsp.writeFile(path.join(sessionLogDir, 'notes.txt'), 'password=must-not-be-collected', 'utf8')

  try {
    const result = await exportDiagnosticPack({
      outputPath,
      logText: 'main log\napiKeyAI=main-secret',
      sessionLogDir,
      tempRoot
    })
    const extractDir = await extractDiagnosticPack(outputPath, tempRoot)
    const manifestText = await readExtractedFile(extractDir, 'manifest.json')
    const manifest = JSON.parse(manifestText)
    const summaryText = await readExtractedFile(extractDir, 'summary.txt')
    const mainLog = await readExtractedFile(extractDir, 'logs/main.log')
    const sessionLog = await readExtractedFile(extractDir, 'logs/session/prod-web-01.log')

    assert.deepEqual(manifest.files.included, result.files)
    assert.deepEqual(result.files, [
      'manifest.json',
      'summary.txt',
      'logs/main.log',
      'logs/session/prod-web-01.log'
    ])
    assert.deepEqual(manifest.files.omitted, [
      { path: 'logs/session/notes.txt', reason: 'unsupported_file_type' }
    ])
    assert.equal(result.hasOmissions, true)
    assert.equal(result.omittedCount, 1)
    assert.match(summaryText, /Included files:/)
    assert.match(summaryText, /logs\/session\/prod-web-01\.log/)
    assert.match(summaryText, /Omitted files:/)
    assert.match(summaryText, /logs\/session\/notes\.txt: unsupported_file_type/)
    assert.equal(mainLog.includes('main-secret'), false)
    assert.equal(sessionLog.includes('session-secret'), false)
    assert.equal(manifestText.includes(tempRoot), false)
    assert.equal(manifestText.includes('must-not-be-collected'), false)
    assert.deepEqual(await listPackingTempDirs(tempRoot), [])
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('export diagnostic pack reports unreadable session logs without leaking errors', async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'aigshell-diagnostic-read-failure-'))
  const sessionLogDir = path.join(tempRoot, 'session_logs')
  const outputPath = path.join(tempRoot, 'diagnostic.tar')
  const unreadablePath = path.join(sessionLogDir, 'unreadable.log')
  await fsp.mkdir(sessionLogDir, { recursive: true })
  await fsp.writeFile(unreadablePath, 'session output', 'utf8')
  const originalReadFile = fsp.readFile
  fsp.readFile = async (filePath, ...args) => {
    if (path.resolve(filePath) === path.resolve(unreadablePath)) {
      throw new Error('EACCES: ' + unreadablePath + '; password=read-error-secret')
    }
    return originalReadFile(filePath, ...args)
  }

  try {
    const result = await exportDiagnosticPack({ outputPath, logText: 'main log', sessionLogDir, tempRoot })
    const extractDir = await extractDiagnosticPack(outputPath, tempRoot)
    const manifestText = await readExtractedFile(extractDir, 'manifest.json')
    const manifest = JSON.parse(manifestText)

    assert.equal(result.hasOmissions, true)
    assert.equal(result.omittedCount, 1)
    assert.deepEqual(manifest.files.omitted, [
      { path: 'logs/session/unreadable.log', reason: 'read_failed' }
    ])
    assert.equal(result.files.includes('logs/session/unreadable.log'), false)
    assert.equal(manifestText.includes(tempRoot), false)
    assert.equal(manifestText.includes('read-error-secret'), false)
    assert.deepEqual(await listPackingTempDirs(tempRoot), [])
  } finally {
    fsp.readFile = originalReadFile
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

test('export diagnostic pack cleans its temporary directory when tar creation fails', async () => {
  const testRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'aigshell-diagnostic-tar-failure-'))
  const before = new Set(await listPackingTempDirs(os.tmpdir()))
  let leakedTempDirs = []

  try {
    await assert.rejects(exportDiagnosticPack({
      outputPath: path.join(testRoot, 'missing-parent', 'diagnostic.tar'),
      logText: 'main log',
      tempRoot: os.tmpdir()
    }))
    leakedTempDirs = (await listPackingTempDirs(os.tmpdir()))
      .filter(name => !before.has(name))
    assert.deepEqual(leakedTempDirs, [])
  } finally {
    await Promise.all(leakedTempDirs.map(name => {
      return fsp.rm(path.join(os.tmpdir(), name), { recursive: true, force: true })
    }))
    await fsp.rm(testRoot, { recursive: true, force: true })
  }
})

test('main process exposes diagnostic pack export through async IPC globals', () => {
  const ipcSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/app/lib/ipc.js'),
    'utf8'
  )

  assert.match(ipcSource, /exportDiagnosticPack/)
  assert.match(ipcSource, /log\.transports\.file\.getFile/)
  assert.match(ipcSource, /config\.sessionLogPath/)
  assert.match(ipcSource, /path\.join\(appPath,\s*'AIGShell',\s*'session_logs'\)/)
  assert.match(ipcSource, /sessionLogDir/)
})

test('about dialog exposes diagnostic pack export to users', () => {
  const infoModalSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/sidebar/info-modal.jsx'),
    'utf8'
  )

  assert.match(infoModalSource, /exportDiagnosticPack/)
  assert.match(infoModalSource, /saveDialog/)
  assert.match(infoModalSource, /导出诊断包/)
  assert.match(infoModalSource, /hasOmissions/)
  assert.match(infoModalSource, /诊断包已导出，但有/)
})
