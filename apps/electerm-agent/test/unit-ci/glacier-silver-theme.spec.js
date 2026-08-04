const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const clientCommon = path.resolve(__dirname, '../../src/client/common')

test('new installations default to Glacier Silver without changing terminal colors', () => {
  const config = require('../../src/app/common/config-default.js')
  assert.equal(config.theme, 'shellpilot-glacier')
  assert.equal(config.terminalTheme, 'default')
})

test('Glacier Silver and Graphite Silver form a reversible pair', async () => {
  const pairing = await import(pathToFileURL(path.join(
    clientCommon,
    'ui-theme-pairing.js'
  )).href)
  assert.equal(
    pairing.getThemeToggleTarget('shellpilot-glacier'),
    'shellpilot-graphite-silver'
  )
  assert.equal(
    pairing.getThemeToggleTarget('shellpilot-graphite-silver'),
    'shellpilot-glacier'
  )
  assert.equal(pairing.getThemeToggleTarget('defaultLight'), 'default')
  assert.equal(pairing.getThemeToggleTarget('shellpilot-ocean'), 'defaultLight')
})

test('mode detection uses built-in metadata and safe legacy fallbacks', async () => {
  const pairing = await import(pathToFileURL(path.join(
    clientCommon,
    'ui-theme-pairing.js'
  )).href)
  const themes = [
    { id: 'shellpilot-glacier', mode: 'light' },
    { id: 'shellpilot-graphite-silver', mode: 'dark' }
  ]
  assert.equal(pairing.isLightUiTheme('shellpilot-glacier', themes), true)
  assert.equal(pairing.isLightUiTheme('shellpilot-graphite-silver', themes), false)
  assert.equal(pairing.isLightUiTheme('shellpilot-glacier', []), true)
  assert.equal(pairing.isLightUiTheme('shellpilot-graphite-silver', []), false)
  assert.equal(pairing.isLightUiTheme('defaultLight', []), true)
  assert.equal(pairing.isLightUiTheme('custom-theme', []), false)
})

test('new theme names and descriptions are localized in Chinese and English', async () => {
  const i18n = await import(pathToFileURL(path.join(
    clientCommon,
    'shellpilot-i18n-overrides.js'
  )).href)
  assert.equal(i18n.getShellPilotTranslation('shellpilotThemeGlacier', 'zh_cn'), '冰川冷银')
  assert.equal(i18n.getShellPilotTranslation('shellpilotThemeGraphiteSilver', 'zh_cn'), '石墨冷银')
  assert.equal(i18n.getShellPilotTranslation('shellpilotThemeGlacier', 'en_us'), 'Glacier Silver')
  assert.equal(i18n.getShellPilotTranslation('shellpilotThemeGraphiteSilver', 'en_us'), 'Graphite Silver')
  assert.match(i18n.getShellPilotTranslation('shellpilotThemeGlacierDesc', 'zh_cn'), /冷银/)
  assert.match(i18n.getShellPilotTranslation('shellpilotThemeGraphiteSilverDesc', 'en_us'), /dark companion/i)
})

test('latest-client topbar delegates mode and target resolution to the pairing helper', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/main/aigshell-topbar.jsx'
  ), 'utf8')
  assert.match(source, /settingMap/)
  assert.match(source, /getThemeToggleTarget/)
  assert.match(source, /isLightUiTheme/)
  assert.match(source, /getSidebarList\(settingMap\.terminalThemes\)/)
  assert.match(source, /setTheme\(getThemeToggleTarget\(store\.config\.theme\)\)/)
  assert.doesNotMatch(source, /store\.config\.theme === 'defaultLight'/)
})
