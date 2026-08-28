const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('operations store separates preview SSH exec from task PTY discovery', () => {
  const source = read('src/client/store/operations-toolkit.js')
  const runtimeStart = source.indexOf('function createRuntime')
  const runtimeEnd = source.indexOf('export default Store', runtimeStart)
  const runtimeSource = source.slice(runtimeStart, runtimeEnd)
  const refreshStart = source.indexOf('Store.prototype.refreshOperationsCapabilities')
  const refreshEnd = source.indexOf('Store.prototype.cancelOperationsTask', refreshStart)
  const refreshSource = source.slice(refreshStart, refreshEnd)

  assert.match(source, /createPtyTaskChannel/)
  assert.match(source, /executeOperationsDiscoveryThroughPty/)
  assert.match(source, /previewOperationsCapabilities/)
  assert.doesNotMatch(runtimeSource, /createSshTaskChannel/)
  assert.match(runtimeSource, /getTerminal:\s*tabId\s*=>\s*refs\.get\('term-' \+ tabId\)/)
  assert.match(runtimeSource, /discover:\s*executeOperationsDiscoveryThroughPty/)
  assert.match(refreshSource, /previewOperationsCapabilities\(endpoint\)/)
  assert.match(source, /runCmd\(endpoint\.pid,\s*command/)
  assert.match(source, /context\.execute\(\{/)
  assert.match(source, /context\.onIdentity\(result\.identity\)/)
})

test('operations endpoint is projected from the exact verified terminal session', () => {
  const store = read('src/client/store/operations-toolkit.js')
  const terminal = read('src/client/components/terminal/terminal-safety-controller.js')

  assert.match(store, /terminal\.getTerminalSafetyEndpoint\(\)/)
  assert.match(store, /connectionUsername:\s*safetyEndpoint\.username/)
  assert.match(store, /hostKeyFingerprint/)
  assert.match(store, /sshSessionGeneration/)
  assert.match(store, /sshTerminalPid/)
  assert.match(store, /terminalPid/)
  assert.match(store, /sessionType/)
  assert.doesNotMatch(store, /runtimeIdentity[^\n]*(?:currentTab|props\.tab|SFTP)/i)
  assert.match(terminal, /connectionUsername:\s*username/)
})

test('terminal exposes a fixed root-file request lease on the operations controller lock', () => {
  const terminal = read('src/client/components/terminal/terminal.jsx')
  const methodStart = terminal.indexOf('acquireRemoteFilePtyTask')
  const methodEnd = terminal.indexOf('handleManagedPtyInput', methodStart)
  const method = terminal.slice(methodStart, methodEnd)

  assert.match(terminal, /createPrivilegedFileProtocol/)
  assert.match(terminal, /createPrivilegedFileRequest/)
  assert.match(method, /operationsPtyTaskController\.acquire/)
  assert.match(method, /root-file:/)
  assert.match(method, /createPrivilegedFileProtocol\(\)/)
  assert.match(method, /createPrivilegedFileRequest\(/)
  assert.doesNotMatch(method, /script/)
  assert.match(terminal, /acquireOperationsPtyTask\s*=\s*ownerId\s*=>\s*\{[\s\S]*?operationsPtyTaskController\.acquire\(ownerId\)/)
})

test('SFTP reads its safety endpoint from the same-tab SSH terminal', () => {
  const sftpEntry = read('src/client/components/sftp/sftp-entry.jsx')
  const methodStart = sftpEntry.indexOf('getSftpSafetyEndpoint = () =>')
  const methodEnd = sftpEntry.indexOf('assertSftpSafetyOperationEndpoint', methodStart)
  const method = sftpEntry.slice(methodStart, methodEnd)

  assert.match(method, /refs\.get\('term-' \+ this\.props\.tab\.id\)/)
  assert.match(method, /terminal\?\.getTerminalSafetyEndpoint\?\.\(\)/)
  assert.match(method, /terminalEndpoint/)
})

test('task panel labels login and effective shell identities separately', () => {
  const taskPanel = read(
    'src/client/components/operations-toolkit/workspace/task-panel.jsx'
  )

  assert.match(taskPanel, /shellpilotOperationsLoginUser/)
  assert.match(taskPanel, /shellpilotOperationsCurrentShell/)
  assert.match(taskPanel, /runtimeIdentity\?\.effectiveUsername/)
  assert.match(taskPanel, /endpoint\?\.connectionUsername/)
  assert.match(taskPanel, /cancellation-unknown/)
  assert.match(taskPanel, /shellpilotOperationsCancellationUnknown/)
  assert.doesNotMatch(
    taskPanel,
    /endpoint\.(?:username|connectionUsername)\s*=\s*runtimeIdentity/
  )
})

test('history displays legacy unknown identity and current terminal execution copy', () => {
  const resultViewer = read(
    'src/client/components/operations-toolkit/workspace/result-viewer.jsx'
  )
  const workspace = read(
    'src/client/components/operations-toolkit/workspace/operations-workspace.jsx'
  )

  assert.match(resultViewer, /shellpilotOperationsLoginUser/)
  assert.match(resultViewer, /shellpilotOperationsCurrentShell/)
  assert.match(resultViewer, /shellpilotOperationsEffectiveIdentityUnknown/)
  assert.match(resultViewer, /cancellation-unknown/)
  assert.match(workspace, /shellpilotOperationsCurrentTerminalTaskHint/)
  assert.doesNotMatch(workspace, /shellpilotOperationsIndependentTaskHint/)
})

test('effective identity and PTY recovery copy is complete in both languages', () => {
  const i18n = read('src/client/common/shellpilot-i18n-overrides.js')
  const keys = [
    'shellpilotOperationsLoginUser',
    'shellpilotOperationsCurrentShell',
    'shellpilotOperationsEffectiveIdentityUnknown',
    'shellpilotOperationsCurrentTerminalTaskHint',
    'shellpilotOperationsTerminalBusy',
    'shellpilotOperationsCancellationUnknown',
    'shellpilotOperationsShellRearmFailed'
  ]

  for (const key of keys) {
    assert.equal((i18n.match(new RegExp(`${key}:`, 'g')) || []).length, 2, key)
  }
  assert.match(i18n, /登录用户：\{username\}/)
  assert.match(i18n, /当前 Shell：\{username\}/)
  assert.match(i18n, /Login user: \{username\}/)
  assert.match(i18n, /Current shell: \{username\}/)
})
