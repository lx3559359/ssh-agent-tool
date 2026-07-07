const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  buildDiagnosticReport,
  redactDiagnosticText
} = require(path.resolve(__dirname, '../../src/app/lib/diagnostic-pack'))
const fs = require('node:fs')

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

test('main process exposes diagnostic pack export through async IPC globals', () => {
  const ipcSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/app/lib/ipc.js'),
    'utf8'
  )

  assert.match(ipcSource, /exportDiagnosticPack/)
  assert.match(ipcSource, /log\.transports\.file\.getFile/)
})
