const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { test } = require('node:test')

const root = path.resolve(__dirname, '../..')

test('new SSH connections use the beginner connection wizard while advanced settings remain available', () => {
  const menu = fs.readFileSync(path.join(root, 'src/client/store/system-menu.js'), 'utf8')
  const topbar = fs.readFileSync(path.join(root, 'src/client/components/main/aigshell-topbar.jsx'), 'utf8')
  const wizard = fs.readFileSync(path.join(root, 'src/client/components/tabs/quick-connect-wizard.jsx'), 'utf8')

  assert.match(menu, /shellpilot-open-connect-wizard/)
  assert.match(menu, /Store\.prototype\.openAdvancedSsh/)
  assert.match(topbar, /<QuickConnectWizard/)
  assert.match(wizard, /shellpilotConnectionWizardHostStep/)
  assert.match(wizard, /shellpilotConnectionWizardAuthStep/)
  assert.match(wizard, /shellpilotConnectionWizardConfirmStep/)
  assert.match(wizard, /shellpilotConnectionWizardOpenAdvanced/)
  assert.doesNotMatch(wizard, /value: 'sshAgent'/)
})

test('narrow viewports automatically collapse only the AI panel', async () => {
  const {
    getAIGShellGeometry
  } = await import(pathToFileURL(path.join(
    root,
    'src/client/components/main/aigshell-layout.js'
  )))
  const common = {
    width: 1024,
    height: 768,
    footerHeight: 32,
    sidebarWidth: 72,
    leftSidebarWidth: 0,
    openedSideBar: false,
    pinned: false,
    rightPanelWidth: 420,
    rightPanelVisible: true,
    rightPanelPinned: true,
    pinnedQuickCommandBar: false,
    inActiveTerminal: true
  }
  const ai = getAIGShellGeometry({ ...common, rightPanelTab: 'ai' })
  const info = getAIGShellGeometry({ ...common, rightPanelTab: 'info' })
  const explicitAi = getAIGShellGeometry({
    ...common,
    rightPanelTab: 'ai',
    rightPanelAutoExpanded: true
  })

  assert.equal(ai.rightPanel.visible, false)
  assert.equal(ai.rightPanel.autoCollapsed, true)
  assert.equal(info.rightPanel.visible, true)
  assert.equal(info.rightPanel.autoCollapsed, false)
  assert.equal(explicitAi.rightPanel.visible, true)
})
