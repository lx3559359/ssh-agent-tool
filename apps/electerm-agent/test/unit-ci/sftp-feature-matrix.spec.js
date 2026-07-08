const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readFile (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8')
}

function assertEvidence (source, pattern, label) {
  assert.match(source, pattern, `Missing SFTP feature evidence: ${label}`)
}

test('SFTP 基础功能矩阵覆盖常规文件客户端流程', () => {
  const sessionSftp = readFile('session-sftp.spec.js')
  const navigation = readFile('sftp-navigation-ui.spec.js')
  const refresh = readFile('sftp-refresh-behavior.spec.js')
  const transferProgress = readFile('transfer-progress.spec.js')
  const transferRetry = readFile('sftp-transfer-retry.spec.js')
  const contextMenu = readFile('sftp-context-menu.spec.js')
  const fileNameValidation = readFile('sftp-file-name-validation.spec.js')
  const all = [
    sessionSftp,
    navigation,
    refresh,
    transferProgress,
    transferRetry,
    contextMenu,
    fileNameValidation
  ].join('\n')

  assertEvidence(sessionSftp, /performs core SFTP file operations over an SSH session/, 'upload download delete rename mkdir')
  assertEvidence(sessionSftp, /handles unicode paths and large text files over an SSH SFTP session/, 'unicode paths and large text files')
  assertEvidence(sessionSftp, /uploads and downloads large binary files over the SSH SFTP transfer path/, 'large binary upload download')
  assertEvidence(sessionSftp, /resolves remote paths and lists nested directories for navigation/, 'realpath nested directory navigation')
  assertEvidence(navigation, /sftp file list double click delegates to the file entry action/, 'double click delegates to file item')
  assertEvidence(navigation, /sftp double click enters directories before opening or transferring files/, 'double click enters directories first')
  assertEvidence(navigation, /sftp address bar supports Enter navigation and reload-or-jump button actions/, 'address bar enter reload and jump')
  assertEvidence(refresh, /sftp file item refresh reloads the active side list/, 'refresh reloads active side list')
  assertEvidence(transferProgress, /file transfer progress includes transferred bytes, chunk bytes, and total size/, 'upload progress')
  assertEvidence(transferProgress, /file transfer downloads large binary files with progress and byte integrity/, 'download progress')
  assertEvidence(transferRetry, /sftp transfer retry policy retries transient failures only within the limit/, 'transient failure retry')
  assertEvidence(transferRetry, /file transfer component wires retry policy before marking a transfer failed/, 'retry wired into transfer component')
  assertEvidence(contextMenu, /sftp context menu keeps all items when there is enough viewport space/, 'context menu operation availability')
  assertEvidence(fileNameValidation, /sftp file item validates blur names before create or rename operations/, 'safe create rename validation')
  assertEvidence(all, /mkdir|rename|rmFolder|rm|writeFile|readFile/, 'core file operation APIs')
})
