const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function readSource (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8')
}

test('topbar exposes one global safety center with filters and rollback actions', () => {
  const topbar = readSource('src/client/components/main/aigshell-topbar.jsx')
  const modal = readSource('src/client/components/main/safety-operation-center-modal.jsx')

  assert.match(topbar, /SafetyOperationCenterModal/)
  assert.match(topbar, /安全中心/)
  assert.match(modal, /filterSafetyOperationRecords/)
  assert.match(modal, /服务器/)
  assert.match(modal, /来源/)
  assert.match(modal, /状态/)
  assert.match(modal, /立即恢复/)
  assert.match(modal, /立即回滚/)
  assert.match(modal, /保留新配置/)
  assert.match(modal, /重试恢复/)
  assert.match(modal, /assertVerifiedQuickCommandRollbackResult/)
  assert.match(modal, /findSafetyOperationSession/)
  assert.match(modal, /runningRef/)
})

test('SFTP and quick-command operations use encrypted unified safety history', () => {
  const sftp = readSource('src/client/components/sftp/sftp-entry.jsx')
  const quickCommands = readSource('src/client/components/quick-commands/quick-commands-box.jsx')

  assert.match(sftp, /readSafetyOperationRecords/)
  assert.match(sftp, /writeSafetyOperationRecords/)
  assert.match(sftp, /shellpilot-open-safety-center/)
  assert.match(quickCommands, /createQuickCommandSafetyRecord/)
  assert.match(quickCommands, /writeSafetyOperationRecords/)
  assert.match(quickCommands, /assertVerifiedQuickCommandRollbackResult/)
  assert.match(quickCommands, /findSafetyOperationSession/)
  assert.match(quickCommands, /rollbackRunningRef/)
  assert.doesNotMatch(quickCommands, /window\.store\.runQuickCommand\(command/)
  assert.doesNotMatch(quickCommands, /clearRollbackRecord\(\)/)
  assert.match(sftp, /rollbackStatus: 'failed'/)
})
