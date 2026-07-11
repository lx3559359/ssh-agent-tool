const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('computes terminal content frame below AIGShell top bar', async () => {
  const {
    aigshellTopBarHeight,
    getAIGShellContentFrame
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/main/aigshell-layout.js')))

  const frame = getAIGShellContentFrame({
    width: 1600,
    height: 900,
    footerHeight: 36,
    sidebarWidth: 43,
    leftSidebarWidth: 280,
    rightPanelWidth: 360,
    pinned: true,
    rightPanelVisible: true,
    rightPanelPinned: true,
    pinnedQuickCommandBar: false,
    inActiveTerminal: true,
    quickCommandBoxHeight: 180,
    resizeTrigger: 0
  })

  assert.equal(aigshellTopBarHeight, 44)
  assert.deepEqual(frame, {
    top: 44,
    left: 323,
    width: 917,
    height: 820
  })
})

test('keeps unpinned layout on narrow icon rail only', async () => {
  const {
    getAIGShellContentFrame
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/main/aigshell-layout.js')))

  const frame = getAIGShellContentFrame({
    width: 1280,
    height: 720,
    footerHeight: 36,
    sidebarWidth: 43,
    leftSidebarWidth: 280,
    rightPanelWidth: 320,
    pinned: false,
    rightPanelVisible: false,
    rightPanelPinned: false,
    pinnedQuickCommandBar: true,
    inActiveTerminal: true,
    quickCommandBoxHeight: 180,
    resizeTrigger: 0
  })

  assert.deepEqual(frame, {
    top: 44,
    left: 43,
    width: 1237,
    height: 460
  })
})

test('clamps invalid right panel width so AI chat remains visible', async () => {
  const {
    normalizeRightPanelWidth
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/main/aigshell-layout.js')))

  assert.equal(normalizeRightPanelWidth(0), 320)
  assert.equal(normalizeRightPanelWidth(120), 320)
  assert.equal(normalizeRightPanelWidth('abc'), 320)
  assert.equal(normalizeRightPanelWidth(520), 520)
  assert.equal(normalizeRightPanelWidth(1600), 1000)
})
