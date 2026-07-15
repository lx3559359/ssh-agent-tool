const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/terminal/terminal-context-menu.js')
).href

function actionKeys (items) {
  return items
    .filter(item => item.type !== 'divider')
    .map(item => item.key)
}

function menuSignature (items) {
  return items.map(item => item.type === 'divider' ? '|' : item.key)
}

function assertNormalizedDividers (items) {
  assert.notEqual(items[0]?.type, 'divider')
  assert.notEqual(items.at(-1)?.type, 'divider')
  for (let index = 1; index < items.length; index++) {
    assert.equal(
      items[index - 1].type === 'divider' && items[index].type === 'divider',
      false,
      'context menu must not contain adjacent dividers'
    )
  }
}

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

  assert.deepEqual(actionKeys(items), [
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
    'onOpenSessionLogFolder',
    'onRecord'
  ])
  assert.equal(items.find(item => item.key === 'copyCurrentPath').disabled, false)
  assert.equal(items.find(item => item.key === 'explainWithAi').disabled, false)
  assert.equal(items.find(item => item.key === 'analyzeTerminalWithAi').labelKey, 'shellpilotTerminalAnalyzeWithAi')
  assert.equal(items.find(item => item.key === 'onResetTerminalFontSize').disabled, true)
  assert.equal(items.find(item => item.key === 'copyCurrentPath').labelKey, 'shellpilotTerminalCopyCurrentPath')
  assert.equal(items.find(item => item.key === 'onZoomInTerminal').labelKey, 'shellpilotTerminalZoomIn')
  assert.equal(items.find(item => item.key === 'onZoomOutTerminal').labelKey, 'shellpilotTerminalZoomOut')
  assert.equal(items.find(item => item.key === 'onResetTerminalFontSize').labelKey, 'shellpilotTerminalZoomReset')
  assert.equal(items.find(item => item.key === 'onOpenSessionLogFolder').labelKey, 'shellpilotTerminalOpenLogFolder')
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
  assert.equal(items.find(item => item.key === 'onOpenSessionLogFolder').disabled, false)
})

test('terminal context menu keeps serial transfer actions only for serial sessions', async () => {
  const { buildTerminalContextMenuItems } = await import(moduleUrl)

  const normalKeys = actionKeys(buildTerminalContextMenuItems({ isSerial: false }))
  const serialKeys = actionKeys(buildTerminalContextMenuItems({ isSerial: true }))

  assert.equal(normalKeys.includes('onXmodemSend'), false)
  assert.equal(serialKeys.includes('onXmodemSend'), true)
  assert.equal(serialKeys.includes('onXmodemReceive'), true)
})

test('terminal context menu exposes bilingual label keys for serial transfer actions', async () => {
  const { buildTerminalContextMenuItems } = await import(moduleUrl)

  const items = buildTerminalContextMenuItems({ isSerial: true })

  assert.equal(items.find(item => item.key === 'onXmodemSend').labelKey, 'shellpilotXmodemSend')
  assert.equal(items.find(item => item.key === 'onXmodemReceive').labelKey, 'shellpilotXmodemReceive')
})

test('terminal implements opening the current session log location', () => {
  const terminalSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/terminal/terminal.jsx'),
    'utf8'
  )

  assert.match(terminalSource, /onOpenSessionLogFolder\s*=/)
  assert.match(terminalSource, /window\.pre\.showItemInFolder/)
  assert.match(terminalSource, /recordingFilePath\s*\|\|\s*this\.state\.logPath/)
  assert.match(terminalSource, /overlayClassName:\s*'shellpilot-context-menu'/)
  assert.match(terminalSource, /danger:\s*menuItem\.danger/)
  assert.match(terminalSource, /onContextMenu = \(\{ key \}\) => \{\s*this\[key\]\(\)\s*\}/)
  assert.doesNotMatch(terminalSource, /typeof this\[key\]/)
})

test('terminal context menu adds normalized visual groups without changing baseline actions', async () => {
  const { buildTerminalContextMenuItems } = await import(moduleUrl)
  const common = [
    'onCopy', 'onPaste', 'onPasteSelected', 'onSelectAll', '|',
    'explainWithAi', 'analyzeTerminalWithAi', 'copyCurrentPath', '|',
    'onClear', 'onZoomInTerminal', 'onZoomOutTerminal', 'onResetTerminalFontSize', '|',
    'onReconnect', 'onDisconnect', '|',
    'toggleSearch', 'onSaveTerminalLog', 'onOpenSessionLogFolder'
  ]
  const cases = [
    {
      args: {},
      signature: [...common, 'onRecord']
    },
    {
      args: { recording: true },
      signature: [...common, 'onStopRecord']
    },
    {
      args: { isSerial: true },
      signature: [...common, 'onRecord', '|', 'onXmodemSend', 'onXmodemReceive']
    },
    {
      args: { recording: true, isSerial: true },
      signature: [...common, 'onStopRecord', '|', 'onXmodemSend', 'onXmodemReceive']
    }
  ]

  for (const { args, signature } of cases) {
    const items = buildTerminalContextMenuItems(args)
    assert.deepEqual(menuSignature(items), signature)
    assertNormalizedDividers(items)
    assert.equal(items.filter(item => item.type === 'divider').some(item => 'key' in item), false)
  }
})

test('terminal disconnect is the only dangerous action and disabled matrix remains stable', async () => {
  const { buildTerminalContextMenuItems } = await import(moduleUrl)
  const items = buildTerminalContextMenuItems({
    hasSelection: false,
    currentPath: '',
    fontSizeChanged: false
  })

  assert.deepEqual(
    items.filter(item => item.danger).map(item => item.key),
    ['onDisconnect']
  )
  assert.equal(items.find(item => item.key === 'onCopy').disabled, true)
  assert.equal(items.find(item => item.key === 'copyCurrentPath').disabled, true)
  assert.equal(items.find(item => item.key === 'onResetTerminalFontSize').disabled, true)
})
