const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '../..')
const clientRoot = path.join(appRoot, 'src/client')
const planPath = path.resolve(
  appRoot,
  '../../docs/superpowers/plans/2026-08-02-shellpilot-v0.4.27-ui-accessibility-optimization.md'
)

function readClient (relativePath) {
  return fs.readFileSync(path.join(clientRoot, relativePath), 'utf8')
}

test('v0.4.27 preserves the approved top-bar action order', () => {
  const topbar = readClient('components/main/aigshell-topbar.jsx')
  const actionsSource = topbar.match(/const actions = \[([\s\S]*?)\n {2}\]/)?.[1] || ''
  const expectedTopbarActions = [
    'serverStatus', 'new', 'quick', 'quickCommands', 'sshTunnel', 'ai',
    'model', 'backup', 'connections', 'safetyCenter', 'update', 'theme',
    'setting', 'help'
  ]

  assert.deepEqual(
    [...actionsSource.matchAll(/key: '([^']+)'/g)].map(match => match[1]),
    expectedTopbarActions
  )
})

test('v0.4.27 preserves connection-wizard and AI-panel behavior', () => {
  const wizard = readClient('components/tabs/quick-connect-wizard.jsx')
  const aiChat = readClient('components/ai/ai-chat.jsx')
  const stepItems = wizard.match(/const stepItems = \[([\s\S]*?)\n {2}\]/)?.[1] || ''

  assert.equal((stepItems.match(/title:/g) || []).length, 3)
  assert.match(wizard, /saveAsBookmark:\s*true/)
  assert.match(wizard, /<Button type='primary' icon=\{<ArrowRightOutlined \/>\} onClick=\{handleConnect\}>/)
  assert.doesNotMatch(aiChat, /autoCollapse|autoCloseRightPanel/)
})

test('v0.4.27 preserves Operations tabs and SFTP interaction handlers', () => {
  const operations = readClient('components/operations-toolkit/workspace/operations-workspace.jsx')
  const operationTabs = operations.match(/const tabs = \[([\s\S]*?)\n\]/)?.[1] || ''
  const listTable = readClient('components/sftp/list-table-ui.jsx')
  const fileItem = readClient('components/sftp/file-item.jsx')

  assert.deepEqual(
    [...operationTabs.matchAll(/value: '([^']+)'/g)].map(match => match[1]),
    ['quick', 'diagnostic', 'maintenance', 'custom', 'history']
  )
  assert.match(listTable, /onClick: this\.handleClick/)
  assert.match(listTable, /onDoubleClick: this\.handleDoubleClick/)
  assert.match(listTable, /onDragOver: this\.onDragOver/)
  assert.match(listTable, /onDrop: this\.onDrop/)
  assert.match(fileItem, /onContextMenu=\{this\.handleContextMenuCapture\}/)
  assert.match(fileItem, /transferOrEnterDirectory = async/)
  assert.match(fileItem, /this\.transfer\(\)/)
})

test('the UI plan does not add protected behavior-layer files', () => {
  const plan = fs.readFileSync(planPath, 'utf8')
  const namedFiles = plan
    .split(/\r?\n/)
    .filter(line => /^- (?:Create|Modify): `/.test(line))
    .join('\n')

  assert.doesNotMatch(namedFiles, /(?:^|\/)store\//)
  assert.doesNotMatch(namedFiles, /src\/app\/server\//)
  assert.doesNotMatch(namedFiles, /command-template|persistence-key|ipc/i)
})
