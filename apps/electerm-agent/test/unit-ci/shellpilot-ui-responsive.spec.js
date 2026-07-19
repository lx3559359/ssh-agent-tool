const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function readClient (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../src/client', relativePath), 'utf8')
}

function readClientIfExists (relativePath) {
  const filePath = path.resolve(__dirname, '../../src/client', relativePath)
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
}

function readProject (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8')
}

test('ShellPilot top bar and AI panel use theme variables in day and night modes', () => {
  const topbar = readClient('components/main/aigshell-topbar.styl')
  const panel = readClient('components/side-panel-r/right-side-panel.styl')
  const ai = readClient('components/ai/ai.styl')

  assert.match(topbar, /background var\(--main-light\)/)
  assert.match(topbar, /color var\(--text\)/)
  assert.match(panel, /background var\(--main-light\)/)
  assert.match(panel, /color var\(--text\)/)
  assert.match(ai, /\.ai-chat-input[\s\S]*background var\(--main-light\)/)
  assert.match(ai, /\.ai-context-action[\s\S]*color var\(--text\)/)
})

test('top bar has a narrow-window fallback that keeps icon commands available', () => {
  const source = readClient('components/main/aigshell-topbar.styl')

  assert.match(source, /@media \(max-width: 1440px\)/)
  assert.match(source, /\.aigshell-topbar-action-label[\s\S]*display none/)
  assert.match(source, /@media \(max-width: 900px\)/)
  assert.match(source, /z-index 4\d{2}/)
})

test('right panel width and SFTP list height are bounded for small windows', () => {
  const layout = readClient('components/main/aigshell-layout.js')
  const panel = readClient('components/side-panel-r/side-panel-r.jsx')
  const sftp = readClient('components/sftp/list-table-ui.jsx')

  assert.match(layout, /minRightPanelWidth = 320/)
  assert.match(layout, /getMaxRightPanelWidth/)
  assert.match(layout, /Math\.max\(0, width - left - right\)/)
  assert.match(panel, /getMaxRightPanelWidth/)
  assert.match(sftp, /Math\.max\(0, height - 42 - 30 - 32 - 90\)/)
})

test('AI panel reports tested model state instead of claiming it is always online', () => {
  const panel = readClient('components/side-panel-r/side-panel-r.jsx')
  const header = readClient('components/side-panel-r/right-side-panel-ai-header.jsx')
  const source = `${panel}\n${header}`
  const style = readClient('components/side-panel-r/right-side-panel.styl')

  assert.match(source, /aiConfigured/)
  assert.match(source, /getAIModelStatus/)
  assert.match(source, /right-panel-model-status/)
  assert.doesNotMatch(source, />在线</)
  assert.match(source, /right-side-panel-content-ai/)
  assert.match(source, /right-panel-ai-config-card/)
  assert.match(source, /right-panel-title-controls/)
  assert.match(style, /\.right-side-panel[\s\S]*display flex/)
  assert.match(style, /\.right-side-panel-content[\s\S]*position static/)
  assert.match(style, /\.right-panel-ai-config-card/)
})

test('settings sections expose a reusable semantic card contract', () => {
  const source = readClientIfExists('components/setting-panel/setting-section.jsx')

  assert.match(source, /export default function SettingSection/)
  assert.match(source, /<section className=\{`sp-card sp-setting-section \$\{className\}`\.trim\(\)\}>/)
  assert.match(source, /<header className='sp-setting-section-header'>/)
  assert.match(source, /<h2>\{title\}<\/h2>/)
  assert.match(source, /description\s*\?\s*<p>\{description\}<\/p>\s*:\s*null/)
  assert.match(source, /<div className='sp-setting-section-body'>\s*\{children\}\s*<\/div>/)
})

test('common settings keep every control while grouping them into four cards', () => {
  const source = readClient('components/setting-panel/setting-common.jsx')
  const preservedConfigKeys = [
    'hotkey',
    'onStartSessions',
    'sshReadyTimeout',
    'keepaliveInterval',
    'enableGlobalProxy',
    'proxy',
    'updateChannel',
    'updateSource',
    'opacity',
    'customCss',
    'execWindows',
    'execMac',
    'execLinux',
    'keyword2FA',
    'autoRefreshWhenSwitchToSftp',
    'showHiddenFilesOnSftpStart',
    'screenReaderMode',
    'initDefaultTabOnStart',
    'disableConnectionHistory',
    'disableTransferHistory',
    'checkUpdateOnStart',
    'useSystemTitleBar',
    'confirmBeforeExit',
    'hideIP',
    'allowMultiInstance',
    'disableDeveloperTool',
    'debug'
  ]

  assert.match(source, /import SettingSection from '\.\/setting-section'/)
  assert.match(source, /className='form-wrap sp-settings-form'/)
  assert.match(source, /e\('generalSettings'\)/)
  assert.match(source, /e\('generalSettingsDescription'\)/)
  assert.equal((source.match(/<SettingSection/g) || []).length, 4)
  for (const key of [
    'startupAndConnection',
    'networkAndUpdates',
    'interfaceAndLanguage',
    'advancedSettings'
  ]) {
    assert.match(source, new RegExp(`title=\\{e\\('${key}'\\)\\}`))
    assert.match(source, new RegExp(`description=\\{e\\('${key}Description'\\)\\}`))
  }
  for (const key of preservedConfigKeys) {
    assert.match(source, new RegExp(`['"]${key}['"]|\\.${key}\\b`), `${key} must remain wired`)
  }
  assert.match(source, /renderProxy \(\)/)
  assert.match(source, /renderUpdateChannel \(\)/)
  assert.match(source, /renderUpdateSource \(\)/)
  assert.match(source, /renderAppearanceFields/)
  assert.match(source, /renderAdvancedFields/)
  assert.match(source, /const agrsProp = `\$\{name\}Args`/)
  assert.match(source, /const \{[\s\S]*?hotkey,[\s\S]*?theme,[\s\S]*?customCss[\s\S]*?\} = props\.config/)
  assert.match(source, /<HotkeySetting/)
  assert.match(source, /<StartSession/)
  assert.match(source, /<DeepLinkControl \/>/)
  assert.match(source, /renderLoginPass\(\)/)
  assert.match(source, /renderReset\(\)/)
  assert.match(source, /getThemeDisplayName\(l, e\)/)
})

test('settings header is the only language and close entry point', () => {
  const common = readClient('components/setting-panel/setting-common.jsx')
  const header = readClient('components/setting-panel/setting-header.jsx')
  const modal = readClient('components/setting-panel/setting-modal.jsx')
  const wrap = readClient('components/setting-panel/setting-wrap.jsx')
  const bookmarksE2E = readProject('test/e2e/007.basic.bookmarks.spec.js')
  const settingsE2E = readProject('test/e2e/02.2.init.setting.spec.js')

  assert.doesNotMatch(common, /handleChangeLang|createEditLangLink|const \{\s*langs\s*=|e\('language'\)/)
  assert.match(header, /handlePreviewLanguage/)
  assert.match(header, /handleApplyLanguage/)
  assert.match(header, /handleCancelLanguage/)
  assert.match(header, /aria-label=\{e\('close'\)\}/)
  assert.match(header, /className='close-setting-wrap close-setting-wrap-icon'/)
  assert.equal((header.match(/close-setting-wrap-icon/g) || []).length, 1)
  assert.equal((header.match(/className='close-setting-wrap close-setting-wrap-icon'/g) || []).length, 1)
  assert.match(bookmarksE2E, /\.setting-wrap \.close-setting-wrap-icon/)
  assert.match(settingsE2E, /\.setting-wrap \.close-setting-wrap/)
  assert.match(modal, /languageVersion:\s*effectiveLanguage/)
  assert.doesNotMatch(wrap, /CloseCircleOutlined|close-setting-wrap/)
  assert.match(wrap, /<Drawer/)
  assert.match(wrap, /this\.props\.useSystemTitleBar \? null : <AppDrag \/>/)
})

test('settings layout replaces fixed coordinates with bounded responsive regions', () => {
  const source = readClient('components/setting-panel/setting-wrap.styl')
  const pageContainer = source.match(/\.setting-wrap\r?\n([\s\S]*?)\r?\n\.setting-header/)
  const searchOverlay = source.match(/ {2}\.setting-search-results\r?\n[\s\S]*?\r?\n {2}\.ant-select/)

  assert.ok(pageContainer)
  assert.ok(searchOverlay)
  assert.match(source, /\.setting-wrap[\s\S]*background var\(--sp-page\)[\s\S]*color var\(--sp-text\)/)
  assert.match(searchOverlay[0], /position absolute/)
  assert.doesNotMatch(source.replace(searchOverlay[0], ''), /position absolute/)
  assert.match(source, /\.setting-header[\s\S]*position sticky[\s\S]*top 0[\s\S]*z-index 10/)
  assert.match(source, /\.setting-tabs[\s\S]*position sticky/)
  assert.match(source, /\.setting-col[\s\S]*display grid[\s\S]*grid-template-columns 226px minmax\(0, 1fr\)/)
  assert.match(source, /\.setting-row[\s\S]*box-sizing border-box/)
  assert.match(source, /\.setting-row-right[\s\S]*overflow-x (?:hidden|clip)/)
  assert.match(source, /@media \(max-width: 820px\)/)
  assert.match(source, /@media \(max-width: 680px\)/)
  assert.match(source, /@media \(max-width: 820px\)[\s\S]*\.setting-col[\s\S]*display block/)
  assert.match(source, /@media \(max-width: 820px\)[\s\S]*\.setting-row-left[\s\S]*overflow-x auto/)
  assert.doesNotMatch(pageContainer[1], /overflow-x auto/)
})

test('settings depth tokens stay scoped to cards, inset controls and selected navigation', () => {
  const setting = readClient('components/setting-panel/setting.styl')
  const wrap = readClient('components/setting-panel/setting-wrap.styl')
  const section = setting.match(/\.sp-setting-section\r?\n([\s\S]*?)\r?\n\.sp-setting-section-header/)
  const form = setting.match(/\.sp-settings-form\r?\n([\s\S]*?)\r?\n\.sp-settings-page-header/)
  const insetControls = form && form[1].match(/ {2}\.ant-input\r?\n {2}\.ant-input-affix-wrapper\r?\n {2}\.ant-input-number\r?\n {2}\.ant-select-selector\r?\n {2}textarea\r?\n((?: {4}.+(?:\r?\n|$))+)/)
  const shell = wrap.match(/\.setting-wrap\r?\n([\s\S]*?)\r?\n\.setting-header/)
  const header = wrap.match(/\.setting-header\r?\n([\s\S]*?)\r?\n\.setting-tabs/)
  const tabs = wrap.match(/\.setting-tabs\r?\n([\s\S]*?)\r?\n\.setting-tabs-setting/)

  assert.ok(section)
  assert.ok(form)
  assert.ok(insetControls)
  assert.ok(shell)
  assert.ok(header)
  assert.ok(tabs)
  assert.match(section[1], /min-width 0/)
  assert.match(section[1], /background var\(--sp-surface-elevated\)/)
  assert.match(section[1], /border 1px solid var\(--sp-border\)/)
  assert.match(section[1], /border-radius var\(--sp-radius-card\)/)
  assert.match(section[1], /box-shadow inset 0 1px 0 var\(--sp-highlight-top\), var\(--sp-shadow-card\)/)
  assert.match(insetControls[1], /background var\(--sp-surface-inset\) !important/)
  assert.match(insetControls[1], /border-color var\(--sp-border\) !important/)
  assert.match(insetControls[1], /box-shadow inset 0 2px 4px rgba\(0, 0, 0, \.08\)/)
  assert.match(shell[1], /background var\(--sp-page\)/)
  assert.match(header[1], /background var\(--sp-surface\)/)
  assert.match(tabs[1], /\.ant-tabs-tab-active[\s\S]*background var\(--sp-primary-soft\)/)
})

test('settings depth migration preserves compact wrapping and internal scrolling contracts', () => {
  const setting = readClient('components/setting-panel/setting.styl')
  const wrap = readClient('components/setting-panel/setting-wrap.styl')
  const compact820 = wrap.match(/@media \(max-width: 820px\)([\s\S]*?)@media \(max-width: 680px\)/)
  const compact590 = wrap.match(/@media \(max-width: 680px\)([\s\S]*?)@media \(max-width: 820px\) and \(max-height: 360px\)/)

  assert.ok(compact820)
  assert.ok(compact590, 'the 590px viewport must retain the <=680px compact contract')
  assert.match(setting, /\.sp-setting-actions[\s\S]*flex-wrap wrap[\s\S]*min-width 0/)
  assert.match(wrap, /\.setting-col-content[\s\S]*min-width 0[\s\S]*overflow-y auto/)
  assert.match(compact820[1], /\.setting-col[\s\S]*display block/)
  assert.match(compact820[1], /\.setting-row-left[\s\S]*overflow-x auto[\s\S]*overflow-y hidden/)
  assert.match(compact820[1], /\.setting-col-content[\s\S]*overflow-x hidden[\s\S]*overflow-y auto/)
  assert.match(compact590[1], /\.setting-header[\s\S]*flex-wrap wrap/)
  assert.match(compact590[1], /\.ant-select[\s\S]*min-width 0/)
  assert.match(compact590[1], /\.ant-btn[\s\S]*min-width 0[\s\S]*height auto/)
})

test('590px settings header keeps a mouse-accessible search icon and expands without squeezing actions', () => {
  const header = readClient('components/setting-panel/setting-header.jsx')
  const source = readClient('components/setting-panel/setting-wrap.styl')
  const narrow = source.match(/@media \(max-width: 680px\)([\s\S]*)/)

  assert.ok(narrow, 'the 590px viewport must use the <=680px contract')
  assert.match(header, /className='setting-header-search-toggle'/)
  assert.match(header, /className=\{`setting-header-search[^`]*\$\{searchExpanded \? 'is-expanded' : ''\}`\.trim\(\)\}/)
  assert.match(narrow[1], /\.setting-header[\s\S]*flex-wrap wrap/)
  assert.match(narrow[1], /\.setting-header-search-toggle[\s\S]*display inline-flex/)
  assert.match(narrow[1], /\.setting-header-search(?!-)[\s\S]*display none/)
  assert.match(narrow[1], /\.setting-header-search(?!-)[\s\S]*flex-basis 100%/)
  assert.match(narrow[1], /&\.is-expanded[\s\S]*display block/)
  assert.match(narrow[1], /\.ant-select[\s\S]*min-width 0/)
  assert.match(narrow[1], /\.ant-btn[\s\S]*min-width 0/)
  assert.match(narrow[1], /\.ant-btn[\s\S]*height auto/)
})

test('settings text wraps naturally and only horizontal rails may scroll', () => {
  const wrap = readClient('components/setting-panel/setting-wrap.styl')
  const setting = readClient('components/setting-panel/setting.styl')
  const list = readClient('components/setting-panel/list.styl')

  assert.match(setting, /\.sp-settings-form[\s\S]*max-width 1120px/)
  assert.match(setting, /\.sp-setting-section[\s\S]*min-width 0/)
  assert.match(setting, /\.sp-setting-section-header[\s\S]*h2[\s\S]*overflow-wrap break-word/)
  assert.match(setting, /\.sp-setting-section-header[\s\S]*p[\s\S]*overflow-wrap break-word/)
  assert.match(setting, /\.sp-setting-section-body[\s\S]*min-width 0/)
  assert.match(setting, /\.sp-setting-field[\s\S]*min-width 0/)
  assert.match(setting, /\.sp-setting-actions[\s\S]*flex-wrap wrap/)
  assert.match(setting, /\.ant-btn > span[\s\S]*white-space normal/)
  assert.match(setting, /@media \(max-width: 680px\)[\s\S]*\.sp-setting-field[\s\S]*display block/)
  assert.match(wrap, /h2[\s\S]*white-space normal/)
  assert.match(list, /\.list-item-title[\s\S]*white-space normal[\s\S]*text-overflow clip/)
  assert.match(list, /&\.active[\s\S]*background var\(--sp-primary-soft\)[\s\S]*color var\(--sp-text\)/)
  assert.match(list, /&:focus-within[\s\S]*background var\(--sp-primary-soft\)[\s\S]*outline/)
  assert.match(list, /&:hover[\s\S]*\.list-item-title[\s\S]*padding-right 84px/)
})

test('effective zoom widths keep settings rails inside the document', () => {
  const wrap = readClient('components/setting-panel/setting-wrap.styl')
  const list = readClient('components/setting-panel/list.styl')

  assert.match(wrap, /\.setting-tabs[\s\S]*max-width 100%[\s\S]*overflow-x hidden/)
  assert.match(wrap, /\.ant-tabs-nav-wrap[\s\S]*min-width 0[\s\S]*max-width 100%[\s\S]*overflow-x auto/)
  assert.match(list, /@media \(max-width: 820px\)[\s\S]*\.setting-row-left[\s\S]*\.item-list[\s\S]*width 100%[\s\S]*min-width 0[\s\S]*max-width 100%/)
  assert.match(list, /@media \(max-width: 820px\)[\s\S]*\.item-list-wrap[\s\S]*flex 1 1 auto[\s\S]*min-width 0[\s\S]*max-width 100%[\s\S]*overflow-x auto/)
})

test('narrow list rail excludes the bookmark virtual tree scroll container', () => {
  const list = readClient('components/setting-panel/list.styl')
  const bookmarksTab = readClient('components/setting-panel/tab-bookmarks.jsx')
  const tree = readClient('components/tree-list/tree-list.jsx')
  const narrow = list.match(/@media \(max-width: 820px\)([\s\S]*)/)

  assert.ok(narrow)
  assert.match(bookmarksTab, /className='setting-tabs-bookmarks'/)
  assert.match(tree, /className='item-list-wrap'[\s\S]*ref=\{this\.listRef\}/)
  assert.match(tree, /listWrap\.scrollTop/)
  assert.match(tree, /listWrap\.clientHeight/)
  assert.match(narrow[1], /\.setting-tabs-setting[\s\S]*\.setting-row-left[\s\S]*\.item-list-wrap[\s\S]*display flex[\s\S]*overflow-x auto/)
  assert.doesNotMatch(narrow[1], /^ {2}\.setting-row-left[\s\S]*?\.item-list-wrap/m)
  assert.match(narrow[1], /\.setting-tabs-bookmarks[\s\S]*\.tree-list[\s\S]*flex-direction column/)
  assert.match(narrow[1], /\.setting-tabs-bookmarks[\s\S]*\.item-list-wrap[\s\S]*display block[\s\S]*overflow-x hidden[\s\S]*overflow-y auto/)
})

test('all ordinary management tabs opt into the narrow horizontal rail explicitly', () => {
  const list = readClient('components/setting-panel/list.styl')
  const narrow = list.match(/@media \(max-width: 820px\)([\s\S]*)/)
  const railGroup = narrow && narrow[1].match(/((?: {2}\.setting-tabs-[^\n]+\n)+) {4}\.setting-row-left/)
  const wrapperSources = [
    ['setting-tabs-setting', 'components/setting-panel/tab-settings.jsx'],
    ['setting-tabs-terminal-themes', 'components/setting-panel/tab-themes.jsx'],
    ['setting-tabs-quick-commands', 'components/setting-panel/tab-quick-commands.jsx'],
    ['setting-tabs-profile', 'components/setting-panel/tab-profiles.jsx']
  ]

  assert.ok(railGroup)
  for (const [wrapper, sourcePath] of wrapperSources) {
    assert.match(readClient(sourcePath), new RegExp(`className='${wrapper}'`))
    assert.match(railGroup[1], new RegExp(`\\.${wrapper}`), `${wrapper} must opt into the rail`)
  }
  assert.doesNotMatch(railGroup[1], /\.setting-tabs-bookmarks/)
  assert.match(narrow[1], /\.item-list-wrap[\s\S]*display flex[\s\S]*flex-direction row[\s\S]*overflow-x auto[\s\S]*overflow-y hidden/)
})

test('tool center uses a vertically reachable compact layout instead of the ordinary rail', () => {
  const wrap = readClient('components/setting-panel/setting-wrap.styl')
  const widgets = readClient('components/widgets/widgets.styl')
  const widgetsTab = readClient('components/setting-panel/tab-widgets.jsx')
  const compact = wrap.match(/@media \(max-width: 820px\)([\s\S]*?)@media \(max-width: 680px\)/)

  assert.ok(compact)
  assert.match(widgetsTab, /className='setting-tabs-widgets'/)
  assert.match(wrap, /\.setting-tabs-widgets[\s\S]*flex 1 1 auto[\s\S]*overflow hidden/)
  assert.match(compact[1], /\.setting-tabs-widgets[\s\S]*overflow-x hidden[\s\S]*overflow-y auto/)
  assert.match(compact[1], /\.setting-tabs-widgets[\s\S]*\.setting-col[\s\S]*height auto[\s\S]*overflow visible/)
  assert.match(compact[1], /\.setting-tabs-widgets[\s\S]*\.setting-row-left[\s\S]*height auto[\s\S]*overflow visible/)
  assert.match(widgets, /\.widgets-shell[\s\S]*min-width 0[\s\S]*width 100%/)
  assert.match(widgets, /@media \(max-width: 820px\)[\s\S]*\.setting-tabs-widgets[\s\S]*\.widgets-card-list[\s\S]*min-width 0[\s\S]*max-height clamp\(180px, 45vh, 360px\)[\s\S]*overflow-y auto/)
  assert.doesNotMatch(widgetsTab, /className='setting-tabs-profile'/)
})

test('bookmark narrow layout reserves a usable vertical viewport and keeps the editor visible', () => {
  const wrap = readClient('components/setting-panel/setting-wrap.styl')
  const list = readClient('components/setting-panel/list.styl')
  const compact = wrap.match(/@media \(max-width: 820px\)([\s\S]*?)@media \(max-width: 680px\)/)
  const pageContainer = wrap.match(/\.setting-wrap\r?\n([\s\S]*?)\r?\n\.setting-header/)
  const heightAt590x400 = Math.min(190, Math.max(132, 400 * 0.36))

  assert.ok(compact)
  assert.equal(heightAt590x400, 144)
  assert.ok(heightAt590x400 >= 26 * 3 + 60, 'toolbar plus at least three bookmark rows must fit')
  assert.match(compact[1], /\.setting-tabs-bookmarks[\s\S]*\.setting-row-left[\s\S]*height clamp\(132px, 36vh, 190px\)[\s\S]*overflow-x hidden/)
  assert.match(compact[1], /\.setting-tabs-bookmarks[\s\S]*\.setting-row-right[\s\S]*height calc\(100% - clamp\(132px, 36vh, 190px\)\)/)
  assert.match(list, /\.setting-tabs-bookmarks[\s\S]*\.item-list-wrap[\s\S]*overflow-y auto/)
  assert.match(pageContainer[1], /overflow-x hidden/)
  assert.doesNotMatch(pageContainer[1], /overflow-x auto/)
})

test('low viewport bookmarks stack inside a vertical scroller with two usable regions', () => {
  const wrap = readClient('components/setting-panel/setting-wrap.styl')
  const lowViewport = wrap.match(/@media \(max-width: 820px\) and \(max-height: 360px\)([\s\S]*)$/)

  assert.ok(lowViewport)
  assert.match(lowViewport[1], /\.setting-tabs-bookmarks[\s\S]*overflow-x hidden[\s\S]*overflow-y auto/)
  assert.match(lowViewport[1], /\.setting-col[\s\S]*height auto[\s\S]*overflow visible/)
  assert.match(lowViewport[1], /\.setting-row-left[\s\S]*min-height 132px/)
  assert.match(lowViewport[1], /\.setting-row-right[\s\S]*height auto[\s\S]*min-height 160px/)
  assert.doesNotMatch(lowViewport[1], /height calc\(100% - clamp/)
})

test('secondary UI work leaves the main terminal footer layout contract untouched', () => {
  const footer = readClient('components/footer/footer.styl')
  const flexBlock = footer.match(/\.terminal-footer-flex\r?\n([\s\S]*?)\r?\n\.terminal-footer-unit/)

  assert.ok(flexBlock)
  assert.doesNotMatch(flexBlock[1], /overflow-x|overflow-y|::-webkit-scrollbar/)
  assert.doesNotMatch(flexBlock[1], /width 100%|max-width 100%/)
})

test('secondary surface overflow is compared with main chrome immediately before that surface opens', () => {
  const matrix = readProject('test/e2e/022.secondary-ui-visual-matrix.spec.js')
  const runner = matrix.match(/async function runSurfaceCase \([\s\S]*?\n}/)

  assert.ok(runner)
  const resetIndex = runner[0].indexOf('await resetSurface')
  const baselineIndex = runner[0].indexOf('await inspectDocumentBaseline')
  const openIndex = runner[0].indexOf('await surface.open')
  assert.ok(resetIndex >= 0)
  assert.ok(baselineIndex > resetIndex)
  assert.ok(openIndex > baselineIndex)
})
