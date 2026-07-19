const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('computes terminal content frame below AIGShell top bar', async () => {
  const {
    aigshellTopBarHeight,
    getAIGShellGeometry
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/main/aigshell-layout.js')))

  const frame = getAIGShellGeometry({
    width: 1600,
    height: 900,
    footerHeight: 36,
    sidebarWidth: 43,
    leftSidebarWidth: 280,
    openedSideBar: 'bookmarks',
    rightPanelWidth: 360,
    pinned: true,
    rightPanelVisible: true,
    rightPanelPinned: true,
    pinnedQuickCommandBar: false,
    inActiveTerminal: true,
    quickCommandBoxHeight: 180,
    resizeTrigger: 0
  }).terminalFrame

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
    getAIGShellGeometry
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/main/aigshell-layout.js')))

  const frame = getAIGShellGeometry({
    width: 1280,
    height: 720,
    footerHeight: 36,
    sidebarWidth: 43,
    leftSidebarWidth: 280,
    openedSideBar: 'bookmarks',
    rightPanelWidth: 320,
    pinned: false,
    rightPanelVisible: false,
    rightPanelPinned: false,
    pinnedQuickCommandBar: true,
    inActiveTerminal: true,
    quickCommandBoxHeight: 180,
    resizeTrigger: 0
  }).terminalFrame

  assert.deepEqual(frame, {
    top: 44,
    left: 43,
    width: 1237,
    height: 460
  })
})

test('keeps a usable terminal frame when a pinned panel cannot fit beside it', async () => {
  const {
    getAIGShellGeometry
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/main/aigshell-layout.js')))

  const frame = getAIGShellGeometry({
    width: 337,
    height: 228,
    footerHeight: 36,
    sidebarWidth: 72,
    leftSidebarWidth: 280,
    openedSideBar: 'bookmarks',
    rightPanelWidth: 320,
    pinned: false,
    rightPanelVisible: true,
    rightPanelPinned: true,
    pinnedQuickCommandBar: false,
    inActiveTerminal: true,
    quickCommandBoxHeight: 180,
    resizeTrigger: 0
  }).terminalFrame

  assert.deepEqual(frame, {
    top: 44,
    left: 72,
    width: 265,
    height: 148
  })
})

test('keeps an overlay sidebar from shifting the terminal footer offscreen', async () => {
  const {
    getAIGShellGeometry
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/main/aigshell-layout.js')))

  const base = {
    width: 1100,
    height: 700,
    footerHeight: 36,
    sidebarWidth: 72,
    leftSidebarWidth: 300,
    rightPanelWidth: 320,
    rightPanelVisible: false,
    rightPanelPinned: false,
    pinnedQuickCommandBar: false,
    inActiveTerminal: true,
    quickCommandBoxHeight: 180
  }
  assert.equal(getAIGShellGeometry({
    ...base,
    openedSideBar: 'bookmarks',
    pinned: false
  }).terminalInsets.left, 72)
  assert.equal(getAIGShellGeometry({
    ...base,
    openedSideBar: 'bookmarks',
    pinned: true
  }).terminalInsets.left, 372)
  assert.equal(getAIGShellGeometry({
    ...base,
    openedSideBar: false,
    pinned: true
  }).terminalInsets.left, 72)
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

test('derives shared absolute insets for overlay and pinned right panels', async () => {
  const module = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/main/aigshell-layout.js')))
  assert.equal(typeof module.getAIGShellGeometry, 'function')

  const base = {
    height: 228,
    footerHeight: 36,
    sidebarWidth: 72,
    leftSidebarWidth: 300,
    rightPanelWidth: 320,
    pinned: false,
    rightPanelVisible: true,
    pinnedQuickCommandBar: false,
    inActiveTerminal: false,
    quickCommandBoxHeight: 180,
    resizeTrigger: 0
  }
  assert.deepEqual(module.getAIGShellGeometry({
    ...base,
    width: 337,
    rightPanelPinned: false
  }).terminalFrame, { top: 44, left: 72, width: 265, height: 148 })
  assert.deepEqual(module.getAIGShellGeometry({
    ...base,
    width: 295,
    height: 200,
    rightPanelPinned: true
  }).terminalFrame, { top: 44, left: 72, width: 223, height: 120 })
  assert.deepEqual(module.getAIGShellGeometry({
    ...base,
    width: 1100,
    height: 700,
    rightPanelPinned: true
  }).terminalFrame, { top: 44, left: 72, width: 708, height: 620 })
  assert.deepEqual(module.getAIGShellGeometry({
    ...base,
    width: 337,
    rightPanelPinned: false
  }).terminalInsets, { top: 44, left: 72, right: 0, bottom: 36 })
  assert.deepEqual(module.getAIGShellGeometry({
    ...base,
    width: 295,
    height: 200,
    rightPanelPinned: true
  }).terminalInsets, { top: 44, left: 72, right: 0, bottom: 36 })
  assert.deepEqual(module.getAIGShellGeometry({
    ...base,
    width: 1100,
    height: 700,
    rightPanelPinned: true
  }).terminalInsets, { top: 44, left: 72, right: 320, bottom: 36 })
})

test('shares one side-by-side geometry for dual pinned panels and the terminal', async () => {
  const module = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/main/aigshell-layout.js')))
  assert.equal(typeof module.getAIGShellGeometry, 'function')

  const geometry = module.getAIGShellGeometry({
    width: 1100,
    height: 700,
    footerHeight: 36,
    sidebarWidth: 72,
    leftSidebarWidth: 300,
    openedSideBar: 'bookmarks',
    pinned: true,
    rightPanelWidth: 1000,
    rightPanelVisible: true,
    rightPanelPinned: true,
    pinnedQuickCommandBar: false,
    inActiveTerminal: true,
    quickCommandBoxHeight: 180,
    resizeTrigger: 0
  })

  assert.deepEqual(geometry.leftPanel, {
    visible: true,
    width: 300,
    reservation: 300,
    overlay: false,
    maxWidth: 1028
  })
  assert.deepEqual(geometry.rightPanel, {
    visible: true,
    width: 408,
    reservation: 408,
    overlay: false,
    minWidth: 320,
    maxWidth: 408
  })
  assert.deepEqual(geometry.terminalFrame, {
    top: 44,
    left: 372,
    width: 320,
    height: 620
  })
  assert.deepEqual(geometry.terminalInsets, {
    top: 44,
    left: 372,
    right: 408,
    bottom: 36
  })
})

test('uses compact left panels as overlays only while keeping their actual width bounded', async () => {
  const { getAIGShellGeometry } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/main/aigshell-layout.js')))
  const base = {
    height: 228,
    footerHeight: 36,
    sidebarWidth: 72,
    leftSidebarWidth: 300,
    openedSideBar: 'bookmarks',
    pinned: true,
    rightPanelWidth: 320,
    rightPanelVisible: false,
    rightPanelPinned: false,
    pinnedQuickCommandBar: false,
    inActiveTerminal: true,
    quickCommandBoxHeight: 180,
    resizeTrigger: 0
  }
  const cases = [
    {
      name: '175 percent opened pinned',
      input: { width: 337 },
      leftPanel: { visible: true, width: 265, reservation: 0, overlay: true, maxWidth: 265 },
      frame: { top: 44, left: 72, width: 265, height: 148 }
    },
    {
      name: '200 percent opened pinned',
      input: { width: 295, height: 200 },
      leftPanel: { visible: true, width: 223, reservation: 0, overlay: true, maxWidth: 223 },
      frame: { top: 44, left: 72, width: 223, height: 120 }
    },
    {
      name: 'closed pinned',
      input: { width: 295, height: 200, openedSideBar: '' },
      leftPanel: { visible: false, width: 0, reservation: 0, overlay: false, maxWidth: 223 },
      frame: { top: 44, left: 72, width: 223, height: 120 }
    },
    {
      name: 'opened unpinned',
      input: { width: 295, height: 200, pinned: false },
      leftPanel: { visible: true, width: 223, reservation: 0, overlay: true, maxWidth: 223 },
      frame: { top: 44, left: 72, width: 223, height: 120 }
    },
    {
      name: 'oversized opened pinned',
      input: { width: 337, leftSidebarWidth: 1000 },
      leftPanel: { visible: true, width: 265, reservation: 0, overlay: true, maxWidth: 265 },
      frame: { top: 44, left: 72, width: 265, height: 148 }
    }
  ]

  for (const item of cases) {
    const geometry = getAIGShellGeometry({ ...base, ...item.input })
    assert.deepEqual(geometry.leftPanel, item.leftPanel, item.name)
    assert.deepEqual(geometry.terminalFrame, item.frame, item.name)
    assert.equal(geometry.terminalInsets.left, item.frame.left, item.name)
  }

  const dualOverlay = getAIGShellGeometry({
    ...base,
    width: 337,
    rightPanelWidth: 1000,
    rightPanelVisible: true,
    rightPanelPinned: true
  })
  assert.deepEqual(dualOverlay.rightPanel, {
    visible: true,
    width: 337,
    reservation: 0,
    overlay: true,
    minWidth: 320,
    maxWidth: 337
  })
  assert.equal(dualOverlay.terminalFrame.width, 265)
})

test('normalizes numeric strings and invalid geometry inputs without NaN or concatenation', async () => {
  const {
    getAIGShellGeometry,
    normalizeRightPanelWidth
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/components/main/aigshell-layout.js')))

  assert.equal(normalizeRightPanelWidth('520.5'), 520.5)
  const numericStrings = getAIGShellGeometry({
    width: '1100',
    height: '700',
    footerHeight: '36',
    sidebarWidth: '72',
    leftSidebarWidth: '300',
    openedSideBar: 'bookmarks',
    pinned: true,
    rightPanelWidth: '1000',
    rightPanelVisible: true,
    rightPanelPinned: true,
    pinnedQuickCommandBar: false,
    inActiveTerminal: true,
    quickCommandBoxHeight: '180',
    resizeTrigger: '1'
  })
  assert.equal(numericStrings.terminalFrame.height, 621)
  assert.equal(numericStrings.terminalFrame.width, 320)

  const invalid = getAIGShellGeometry({
    width: undefined,
    height: Number.NaN,
    footerHeight: -36,
    sidebarWidth: -72,
    leftSidebarWidth: -300,
    openedSideBar: 'bookmarks',
    pinned: true,
    rightPanelWidth: 'invalid',
    rightPanelVisible: true,
    rightPanelPinned: true,
    pinnedQuickCommandBar: true,
    inActiveTerminal: true,
    quickCommandBoxHeight: -180,
    resizeTrigger: '-1'
  })
  const numericValues = [
    invalid.viewport.width,
    invalid.viewport.height,
    invalid.leftPanel.width,
    invalid.leftPanel.reservation,
    invalid.leftPanel.maxWidth,
    invalid.rightPanel.width,
    invalid.rightPanel.reservation,
    invalid.rightPanel.minWidth,
    invalid.rightPanel.maxWidth,
    ...Object.values(invalid.terminalFrame),
    ...Object.values(invalid.terminalInsets)
  ]
  assert.equal(numericValues.every(value => Number.isFinite(value) && value >= 0), true)
  assert.deepEqual(invalid.terminalFrame, { top: 44, left: 0, width: 0, height: 0 })
})
