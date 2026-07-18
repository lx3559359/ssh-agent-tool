const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const guardUrl = pathToFileURL(path.join(
  root,
  'src/client/common/session-resource-guard.js'
)).href

test('session resource guard filters lists and rejects cross-tab mutation', async () => {
  const {
    assertSessionResourceTabId,
    filterSessionResourcesByTabId
  } = await import(guardUrl)
  const resources = [
    { id: 'a', tabId: 'tab-a' },
    { id: 'b', tabId: 'tab-b' },
    { id: 'legacy-a', fromFile: { tabId: 'tab-a' } }
  ]

  assert.deepEqual(
    filterSessionResourcesByTabId(resources, 'tab-a').map(item => item.id),
    ['a', 'legacy-a']
  )
  assert.doesNotThrow(() => assertSessionResourceTabId(resources[0], 'tab-a'))
  assert.throws(
    () => assertSessionResourceTabId(resources[1], 'tab-a'),
    error => error.code === 'AI_SESSION_RESOURCE_MISMATCH'
  )
})

test('Agent binds transfer and background resources to its source SSH tab', () => {
  const runtimeSource = fs.readFileSync(path.join(
    root,
    'src/client/components/ai/agent-runtime-context.js'
  ), 'utf8')
  const toolsSource = fs.readFileSync(path.join(
    root,
    'src/client/components/ai/agent-tools.js'
  ), 'utf8')
  const storeSource = fs.readFileSync(path.join(
    root,
    'src/client/store/mcp-handler.js'
  ), 'utf8')

  for (const tool of [
    'sftp_transfer_list',
    'sftp_transfer_history',
    'get_background_task_status',
    'get_background_task_log',
    'cancel_background_task'
  ]) {
    assert.match(runtimeSource, new RegExp(`'${tool}'`))
  }
  assert.match(toolsSource, /mcpSftpTransferList\(args\)/)
  assert.match(toolsSource, /mcpSftpTransferHistory\(args\)/)
  assert.match(storeSource, /assertSessionResourceTabId/)
  assert.match(storeSource, /filterSessionResourcesByTabId/)
  assert.match(storeSource, /mcpCancelBackgroundTask[\s\S]*?args\.tabId/)
})
