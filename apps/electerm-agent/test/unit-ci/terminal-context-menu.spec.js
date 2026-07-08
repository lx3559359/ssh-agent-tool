const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/terminal/terminal-context-menu.js')
).href

test('terminal context menu includes daily SSH operations and copy current path', async () => {
  const { buildTerminalContextMenuItems } = await import(moduleUrl)

  const items = buildTerminalContextMenuItems({
    hasSelection: true,
    recording: false,
    currentPath: '/var/www/app',
    shortcuts: {
      copy: 'ctrl+shift+c',
      paste: 'ctrl+shift+v',
      clear: 'ctrl+l',
      search: 'ctrl+f',
      selectAll: 'ctrl+shift+a'
    }
  })

  assert.deepEqual(items.map(item => item.key), [
    'onCopy',
    'onPaste',
    'onPasteSelected',
    'onSelectAll',
    'explainWithAi',
    'analyzeTerminalWithAi',
    'copyCurrentPath',
    'onClear',
    'onZoomInTerminal',
    'onZoomOutTerminal',
    'onResetTerminalFontSize',
    'onReconnect',
    'onDisconnect',
    'toggleSearch',
    'onSaveTerminalLog',
    'onRecord'
  ])
  assert.equal(items.find(item => item.key === 'copyCurrentPath').disabled, false)
  assert.equal(items.find(item => item.key === 'explainWithAi').disabled, false)
  assert.equal(items.find(item => item.key === 'analyzeTerminalWithAi').labelText, 'AI 分析当前终端')
  assert.equal(items.find(item => item.key === 'onResetTerminalFontSize').disabled, true)
})

test('terminal context menu disables selection and cwd actions when unavailable', async () => {
  const { buildTerminalContextMenuItems } = await import(moduleUrl)

  const items = buildTerminalContextMenuItems({
    hasSelection: false,
    recording: true,
    currentPath: '',
    fontSizeChanged: true
  })

  assert.equal(items.find(item => item.key === 'onCopy').disabled, true)
  assert.equal(items.find(item => item.key === 'explainWithAi').disabled, true)
  assert.equal(items.find(item => item.key === 'analyzeTerminalWithAi').disabled, false)
  assert.equal(items.find(item => item.key === 'copyCurrentPath').disabled, true)
  assert.equal(items.find(item => item.key === 'onResetTerminalFontSize').disabled, false)
  assert.equal(items.find(item => item.key === 'onStopRecord').labelKey, 'stopRecord')
})

test('terminal context menu keeps serial transfer actions only for serial sessions', async () => {
  const { buildTerminalContextMenuItems } = await import(moduleUrl)

  const normalKeys = buildTerminalContextMenuItems({ isSerial: false }).map(item => item.key)
  const serialKeys = buildTerminalContextMenuItems({ isSerial: true }).map(item => item.key)

  assert.equal(normalKeys.includes('onXmodemSend'), false)
  assert.equal(serialKeys.includes('onXmodemSend'), true)
  assert.equal(serialKeys.includes('onXmodemReceive'), true)
})
