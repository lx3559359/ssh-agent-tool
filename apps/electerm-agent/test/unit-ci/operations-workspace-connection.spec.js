const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const source = fs.readFileSync(
  path.resolve(__dirname, '../../src/client/components/operations-toolkit/workspace/operations-workspace.jsx'),
  'utf8'
)

test('disconnected operations workspace offers a direct connection action', () => {
  const statusStart = source.indexOf("<div className='operations-connection-status'>")
  const statusEnd = source.indexOf('{store.operationsDiscoveryError', statusStart)
  const statusSource = source.slice(statusStart, statusEnd)

  assert.match(statusSource, /shellpilotOperationsConnectServer/)
  assert.match(statusSource, /onClick=\{\(\) => window\.store\.onNewSsh\(\)\}/)
})

test('operations labels use the same maintenance terminology as the top navigation', () => {
  const i18n = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/common/shellpilot-i18n-overrides.js'),
    'utf8'
  )

  assert.match(i18n, /shellpilotOperationsQuickActions: '常用操作'/)
  assert.match(i18n, /shellpilotOperationsConnectServer: '连接服务器'/)
})
