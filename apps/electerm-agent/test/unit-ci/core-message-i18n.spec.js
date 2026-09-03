const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const componentRoot = path.resolve(__dirname, '../../src/client/components')
const sources = {
  sftp: fs.readFileSync(path.join(componentRoot, 'sftp/sftp-entry.jsx'), 'utf8'),
  terminal: fs.readFileSync(path.join(componentRoot, 'terminal/terminal.jsx'), 'utf8'),
  upgrade: fs.readFileSync(path.join(componentRoot, 'main/upgrade.jsx'), 'utf8')
}

function countMatches (source, pattern) {
  return [...source.matchAll(pattern)].length
}

test('core runtime feedback uses the required translation keys', () => {
  assert.match(sources.sftp, /message\.warning\(e\('shellpilotSftpSelectRemoteTargets'\)\)/)
  assert.match(sources.sftp, /\? e\('shellpilotSftpBackupUncertain'\)\s*: e\('shellpilotSftpBackupFailedUnchanged'\)/)
  assert.match(sources.sftp, /message\.warning\(formatShellPilotTranslation\(e, 'shellpilotSftpReconnectBeforeRestore', \{\s*host: record\.host\s*\}\)\)/)
  assert.match(sources.sftp, /\? e\('shellpilotSftpRestoreUncertain'\)\s*: e\('shellpilotSftpRestoreFailedVerify'\)/)
  assert.match(sources.sftp, /message\.success\(e\('shellpilotSftpRestoreCompletedPreserved'\)\)/)
  assert.match(sources.sftp, /message\.info\(e\('shellpilotSftpNoRecoveryRecord'\)\)/)

  assert.match(sources.terminal, /cd = \(p\) => \{\s*if \(isUnsafeFilename\(p\)\) \{\s*return message\.error\(e\('shellpilotTerminalUnsafeFilename'\)\)/)
  assert.match(sources.terminal, /const notSafeMsg = e\('shellpilotTerminalUnsafeFilename'\)/)
  assert.equal(
    countMatches(sources.terminal, /message\.warning\(e\('shellpilotTerminalTransferInProgress'\)\)/g),
    3
  )

  assert.match(sources.upgrade, /checked\.message \|\| e\('shellpilotUpdateUnavailableOnline'\)/)
  assert.match(sources.upgrade, /downloadState\.message \|\| e\('shellpilotUpdateDownloadUnavailable'\)/)
  assert.match(sources.upgrade, /finalState\?\.error \|\| e\('shellpilotUpdateDownloadIncomplete'\)/)
  assert.match(sources.upgrade, /message\.success\(e\('shellpilotUpdateDownloadedRestart'\)\)/)
  assert.match(sources.upgrade, /err\?\.message \|\| e\('shellpilotUpdateOnlineFailed'\)/)
  assert.match(sources.upgrade, /message\.info\(e\('shellpilotUpdateChecking'\), 0\)/)
  assert.match(sources.upgrade, /err\?\.message \|\| e\('shellpilotUpdateCheckFailed'\)/)
})

test('audited core component sources contain none of the replaced hardcoded literals', () => {
  const auditedLiterals = {
    sftp: [
      '请先在远程 SFTP 面板选择文件或文件夹。',
      '远端备份可能已完成，但恢复记录未能持久化；请先核对再继续。',
      'SFTP 备份失败，原文件未改动。',
      '请先连接服务器 $' + '{record.host} 后再恢复。',
      '恢复结果不确定；恢复前内容可能位于记录的 displaced 路径，请在安全中心核对。',
      '恢复失败；远端内容未宣告安全，请在重试前核对恢复记录。',
      '恢复完成；恢复前的当前内容也已另行保留。',
      '当前文件没有可用的备份或安全删除记录。'
    ],
    terminal: [
      'File name contains unsafe characters',
      'A transfer is already in progress'
    ],
    upgrade: [
      '当前版本暂时不能在线更新。',
      '该版本暂时不能在线更新。',
      '更新文件尚未下载完成，请稍后重试。',
      '更新已下载完成，重启客户端即可完成更新。',
      '在线更新失败，请稍后重试。',
      '正在检查更新...',
      '检查更新失败，请稍后重试。'
    ]
  }

  for (const [name, literals] of Object.entries(auditedLiterals)) {
    for (const literal of literals) {
      assert.equal(
        sources[name].includes(literal),
        false,
        `${name} must not contain hardcoded runtime copy: ${literal}`
      )
    }
  }
})
