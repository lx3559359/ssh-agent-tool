const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('renderer error diagnostics hide local paths and stack traces', async () => {
  const modulePath = path.resolve(
    __dirname,
    '../../src/client/common/error-diagnostics.js'
  )
  const { createSafeErrorDiagnostic } = await import(pathToFileURL(modulePath))
  const diagnostic = createSafeErrorDiagnostic(
    new Error('Cannot read C:\\Users\\tester\\secret\\config.json\nfile:///C:/Users/tester/app.js:10'),
    {
      version: '0.4.3',
      os: 'windows',
      now: '2026-07-17T10:20:30.000Z'
    }
  )

  assert.match(diagnostic.id, /^SP-20260717-[A-F0-9]{8}$/)
  assert.match(diagnostic.text, /0\.4\.3/)
  assert.match(diagnostic.text, /windows/)
  assert.doesNotMatch(diagnostic.text, /C:\\Users|file:\/\/\/|config\.json|at /)
  assert.doesNotMatch(diagnostic.safeMessage, /C:\\Users|file:\/\/\//)

  const spacedPath = createSafeErrorDiagnostic(
    new Error('Cannot load C:\\Program Files\\ShellPilot\\resources\\app.asar'),
    {
      version: '0.4.3',
      os: 'windows',
      now: '2026-07-17T10:20:30.000Z'
    }
  )
  assert.doesNotMatch(spacedPath.text, /Program Files|app\.asar/)
})

test('error boundary shows a safe error number and copyable diagnostics only', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/main/error-wrapper.jsx'
  ), 'utf8')

  assert.match(source, /createSafeErrorDiagnostic/)
  assert.match(source, /shellpilotCopyDiagnostic/)
  assert.doesNotMatch(source, /const \{ stack, message \}/)
  assert.doesNotMatch(source, /userDataPath|electerm_data\.db|electerm\.data\.nedb/)
})

test('requested secondary modules are loaded lazily', () => {
  const main = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/main/main.jsx'
  ), 'utf8')
  const topbar = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/main/aigshell-topbar.jsx'
  ), 'utf8')
  const sidePanel = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/side-panel-r/side-panel-r.jsx'
  ), 'utf8')

  assert.match(main, /lazy\(\(\) => import\('\.\.\/fleet-status\/fleet-status-workspace'\)\)/)
  assert.match(main, /lazy\(\(\) => import\('\.\/upgrade'\)\)/)
  assert.match(main, /lazy\(\(\) => import\('\.\.\/ai\/ai-config-modal'\)\)/)
  assert.doesNotMatch(main, /import FleetStatusWorkspace from/)
  assert.doesNotMatch(main, /import UpdateCheck from/)
  assert.doesNotMatch(main, /import AIConfigModal from/)

  assert.match(topbar, /lazy\(\(\) => import\('\.\/update-center-modal'\)\)/)
  assert.match(topbar, /lazy\(\(\) => import\('\.\/help-center-modal'\)\)/)
  assert.match(topbar, /lazy\(\(\) => import\('\.\.\/server-status\/server-status-modal'\)\)/)
  assert.match(sidePanel, /lazy\(\(\) => import\('\.\/right-side-panel-ai-header'\)\)/)
  assert.doesNotMatch(sidePanel, /from '\.\.\/ai\/ai-profiles'/)
  assert.doesNotMatch(sidePanel, /from '\.\.\/ai\/ai-health-coordinator'/)
})

test('settings center loads only the active lazy tab', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/setting-panel/setting-modal.jsx'
  ), 'utf8')

  assert.match(source, /function renderActiveTab/)
  assert.match(source, /const settingTabLoaders =/)
  assert.match(source, /\[settingMap\.bookmarks\]: \(\) => import\('\.\/tab-bookmarks'\)/)
  assert.match(source, /\[settingMap\.quickCommands\]: \(\) => import\('\.\/tab-quick-commands'\)/)
  assert.match(source, /<ActiveSettingTab/)
  assert.doesNotMatch(source, /\blazy\(/)
  assert.doesNotMatch(source, /<TabQuickCommands[\s\S]*<TabBookmarks[\s\S]*<TabSettings/)
})

test('frontend builds remove stale generated chunks before writing new hashes', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../build/bin/build.js'
  ), 'utf8')

  assert.match(source, /cleanGeneratedFrontendAssets/)
  assert.match(source, /const targets = \['chunk', 'js', 'css'\]/)
  assert.match(source, /fs\.rmSync\(target/)
})

test('quick command editor and text search use ShellPilot localized copy', () => {
  const quickList = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/quick-commands/quick-commands-list-form.jsx'
  ), 'utf8')
  const quickForm = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/quick-commands/quick-commands-form-elem.jsx'
  ), 'utf8')
  const editor = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/text-editor/simple-editor.jsx'
  ), 'utf8')

  assert.match(quickList, /shellpilotQuickCommandDelay/)
  assert.match(quickForm, /shellpilotQuickCommandLabels/)
  assert.match(quickForm, /shellpilotQuickCommandTemplates/)
  assert.match(editor, /shellpilotSearchInText/)
  assert.doesNotMatch(editor, /Search in text\.\.\./)
})
