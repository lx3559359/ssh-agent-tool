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

test('test clients skip automatic update network traffic', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/store/load-data.js'
  ), 'utf8')

  assert.match(
    source,
    /if \(store\.config\.checkUpdateOnStart && !window\.pre\.isTest\)/
  )
})

test('settings center loads only the active lazy tab', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/setting-panel/setting-modal.jsx'
  ), 'utf8')

  assert.match(source, /function renderActiveTab/)
  assert.match(source, /const SettingModalContent = auto\(function SettingModalContent/)
  assert.match(source, /const settingContent = useMemo\(\(\) => \(/)
  assert.match(source, /\{settingContent\}/)
  assert.match(source, /const settingTabLoaders =/)
  assert.match(source, /\[settingMap\.bookmarks\]: \(\) => import\('\.\/tab-bookmarks'\)/)
  assert.match(source, /\[settingMap\.quickCommands\]: \(\) => import\('\.\/tab-quick-commands'\)/)
  assert.match(source, /<ActiveSettingTab/)
  assert.match(source, /function SettingsTabNavigation/)
  assert.match(source, /className='setting-tabs-native-list'/)
  assert.match(source, /role='tablist'/)
  assert.match(source, /event\.key === 'ArrowRight'/)
  assert.match(source, /event\.key === 'Home'/)
  assert.match(source, /tabIndex=\{item\.key === activeKey \? 0 : -1\}/)
  assert.match(source, /aria-controls=\{`setting-panel-\$\{item\.key\}`\}/)
  assert.match(source, /role='tabpanel'/)
  assert.match(source, /className='setting-tab-panel'/)
  assert.match(source, /aria-labelledby=\{`setting-tab-\$\{settingTab\}`\}/)
  assert.match(source, /activeTabReadyKey/)
  assert.match(source, /onActiveTabReady/)
  assert.match(source, /state\.settingTab === settingTab && state\.Component/)
  assert.match(source, /function preloadInitialSettingTab/)
  assert.match(source, /preloadInitialSettingTab\(settingMap\.setting\)/)
  assert.match(source, /window\.requestIdleCallback/)
  assert.match(source, /}, 800\)/)
  assert.match(source, /const settingTabComponents = new Map\(\)/)
  assert.match(source, /function getInitialSettingTabState/)
  assert.match(source, /settingTabComponents\.set\(settingTab, Component\)/)
  assert.match(source, /formatShellPilotTranslation\(\s*e,\s*'shellpilotModuleLoadFailed'/)
  assert.doesNotMatch(source, /Unknown settings tab/)
  assert.doesNotMatch(source, /<Tabs/)
  assert.doesNotMatch(source, /__shellpilotSettingsPerfVariant/)
  assert.doesNotMatch(source, /\blazy\(/)
  assert.doesNotMatch(source, /<TabQuickCommands[\s\S]*<TabBookmarks[\s\S]*<TabSettings/)

  const header = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/setting-panel/setting-header.jsx'
  ), 'utf8')
  const style = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/setting-panel/setting-wrap.styl'
  ), 'utf8')
  const settingWrap = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/setting-panel/setting-wrap.jsx'
  ), 'utf8')
  const drawer = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/common/drawer.jsx'
  ), 'utf8')
  assert.match(source, /const hasOpenedRef = useRef\(false\)/)
  assert.match(source, /if \(!hasOpenedRef\.current\)/)
  assert.match(settingWrap, /keepMounted: true/)
  assert.match(drawer, /if \(!open && !keepMounted\)/)
  assert.match(drawer, /opacity: open \? 1 : 0/)
  assert.match(drawer, /willChange: keepMounted \? 'opacity' : undefined/)
  assert.doesNotMatch(drawer, /visibility: open/)
  assert.match(drawer, /pointerEvents: open \? 'auto' : 'none'/)
  assert.match(drawer, /overlay\.setAttribute\('inert', ''\)/)
  assert.match(drawer, /overlay\.setAttribute\('aria-hidden', 'true'\)/)
  assert.match(drawer, /overlay\.removeAttribute\('inert'\)/)
  assert.match(drawer, /overlay\.removeAttribute\('aria-hidden'\)/)
  assert.match(drawer, /useLayoutEffect\(\(\) => \{[\s\S]{0,180}if \(!open\) return/)
  assert.doesNotMatch(drawer, /hidden=\{!open\}/)
  assert.match(header, /className='setting-header-language-select'/)
  assert.match(header, /<option key=\{language\.id\} value=\{language\.id\}>/)
  assert.doesNotMatch(header, /secondaryControlsReady/)
  assert.doesNotMatch(header, /<Select/)
  assert.match(header, /className='setting-header-search-field'/)
  assert.match(header, /<input/)
  assert.match(header, /<button\s+className='setting-header-search-toggle'/)
  assert.match(header, /<button\s+className='close-setting-wrap close-setting-wrap-icon'/)
  assert.doesNotMatch(header, /<Input/)
  assert.match(style, /\.setting-header-language-select/)
  assert.match(
    style,
    /\.setting-tab-panel\r?\n[\s\S]{0,180}display flex[\s\S]{0,180}flex-direction column[\s\S]{0,180}flex 1 1 auto[\s\S]{0,180}min-height 0[\s\S]{0,180}overflow hidden/
  )
})

test('closing and reopening common settings preserves the mounted content tree', () => {
  const storeSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/store/setting.js'
  ), 'utf8')
  const modalSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/setting-panel/setting-modal.jsx'
  ), 'utf8')
  const performanceSource = fs.readFileSync(path.resolve(
    __dirname,
    '../e2e/038.client-interaction-performance.spec.js'
  ), 'utf8')

  assert.match(storeSource, /const commonSelected =/)
  assert.match(storeSource, /if \(commonSelected && store\.showModal === modals\.setting\)/)
  assert.match(storeSource, /return store\.hideSettingModal\(true\)/)
  assert.match(storeSource, /if \(!commonSelected\) \{[\s\S]{0,180}store\.setSettingItem/)
  assert.match(storeSource, /Store\.prototype\.hideSettingModal = function \(preserveSelection = false\)/)
  assert.match(storeSource, /if \(!preserveSelection\) \{\s*store\.setSettingItem\(\{\}\)\s*\}/)
  assert.match(modalSource, /store\.hideSettingModal\(true\)/)
  assert.match(performanceSource, /for \(let index = 0; index < 10; index \+= 1\) \{\s*await page\.evaluate\(\(\) => window\.store\.hideSettingModal\(true\)\)/)
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

test('general settings isolate offscreen section rendering with stable size hints', () => {
  const common = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/setting-panel/setting-common.jsx'
  ), 'utf8')
  const style = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/setting-panel/setting.styl'
  ), 'utf8')
  const hotkey = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/setting-panel/hotkey.jsx'
  ), 'utf8')
  const shortcutEditor = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/shortcuts/shortcut-editor.jsx'
  ), 'utf8')
  const nativeNumber = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/setting-panel/native-number-confirm.jsx'
  ), 'utf8')

  assert.match(common, /const className = `sp-setting-section-\$\{name\}`/)
  assert.match(common, /mountedSectionIndexes: \[1\]/)
  assert.match(common, /mountedStartupDetails: \[\]/)
  assert.match(common, /this\.startupDetailsScheduler\.request\('hotkey'\)/)
  assert.match(common, /import \{ flushSync \} from 'react-dom'/)
  assert.match(
    common,
    /onMount: detail => \{[\s\S]{0,100}flushSync\(\(\) => this\.mountStartupDetail\(detail\)\)/
  )
  assert.match(common, /this\.mountStartupDetail\('session'\)/)
  assert.match(common, /this\.mountStartupDetail\('numbers'\)/)
  assert.doesNotMatch(common, /this\.startupDetailsScheduler\.request\('session'\)/)
  assert.doesNotMatch(common, /this\.startupDetailsScheduler\.request\('numbers'\)/)
  assert.match(common, /}, 160\)/)
  assert.match(common, /window\.requestIdleCallback\(mountDetails, \{ timeout: 600 \}\)/)
  assert.match(common, /window\.cancelIdleCallback\(this\.startupDetailsIdleId\)/)
  assert.match(common, /if \(detail === 'hotkey'\)[\s\S]{0,120}this\.scheduleStartupDetails\(\)/)
  assert.doesNotMatch(
    common,
    /startStartupDetailsMount = \(\) => \{[\s\S]{0,400}window\.setTimeout/
  )
  assert.match(common, /sp-setting-startup-session-placeholder/)
  assert.match(common, /sp-setting-startup-numbers-placeholder/)
  assert.match(common, /sp-setting-startup-hotkey-placeholder/)
  assert.doesNotMatch(common, /if \(!ready\)/)
  assert.doesNotMatch(common, /\bready:/)
  assert.doesNotMatch(common, /__shellpilotSettingsPerfVariant/)
  assert.match(common, /this\.sectionScheduler\.request\(index\)/)
  assert.match(common, /this\.sectionRoot = this\.formRoot\?\.closest\('\.setting-col-content'\)/)
  assert.match(common, /ref=\{node => \{ this\.formRoot = node \}\}/)
  assert.doesNotMatch(common, /document\.querySelector\('\.setting-col-content'\)/)
  assert.match(common, /root: this\.sectionRoot/)
  assert.match(common, /rootMargin: '0px 0px -50% 0px'/)
  assert.match(common, /this\.sectionRoot\?\.addEventListener\('scroll'/)
  assert.match(common, /if \(this\.sectionRoot\.scrollTop <= 0\) return/)
  assert.match(common, /this\.sectionMountEnabled = true/)
  assert.match(common, /this\.visibleSectionIndexes/)
  assert.doesNotMatch(common, /maxDelayMs/)
  assert.doesNotMatch(common, /mountThrough/)
  for (const name of ['startup', 'network', 'interface', 'advanced']) {
    assert.match(common, new RegExp(`name: '${name}'`))
    assert.match(style, new RegExp(`\\.sp-setting-section-${name}`))
  }
  assert.match(style, /\.sp-setting-section\r?\n[\s\S]{0,260}content-visibility auto/)
  assert.equal((style.match(/contain-intrinsic-size auto \d+px/g) || []).length, 4)
  assert.match(style, /\.sp-setting-startup-session-placeholder/)
  assert.match(style, /\.sp-setting-startup-numbers-placeholder/)
  assert.match(style, /\.sp-setting-startup-hotkey-placeholder/)
  assert.match(hotkey, /getKeysTaken: \(\) => this\.getKeysTaken\(hotkey\)/)
  assert.match(shortcutEditor, /this\.props\.getKeysTaken/)
  assert.match(shortcutEditor, /keysTaken: keysTaken \|\| \{\}/)
  assert.match(common, /import NativeNumberConfirm from '\.\/native-number-confirm'/)
  assert.match(common, /<NativeNumberConfirm/)
  assert.doesNotMatch(common, /InputNumberConfirm/)
  assert.match(nativeNumber, /type='number'/)
  assert.match(nativeNumber, /onBlur=\{handleBlur\}/)
  assert.match(nativeNumber, /event\.key === 'Enter'/)
  assert.match(nativeNumber, /event\.key === 'Escape'/)
  assert.match(nativeNumber, /min=\{min\}/)
  assert.match(nativeNumber, /max=\{max\}/)
  assert.match(nativeNumber, /step=\{step\}/)
})
