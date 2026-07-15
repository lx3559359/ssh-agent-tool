const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const clientRoot = path.resolve(__dirname, '../../src/client')
const searchIndexPath = path.join(clientRoot, 'common/setting-search-index.js')
const searchIndexUrl = pathToFileURL(searchIndexPath).href

async function loadSearchIndex () {
  return import(searchIndexUrl)
}

function readClientSource (relativePath) {
  return fs.readFileSync(path.join(clientRoot, relativePath), 'utf8')
}

function getStringConstant (source, name) {
  const match = source.match(new RegExp(`export const ${name} = '([^']+)'`))
  assert.ok(match, `${name} must remain a string constant`)
  return match[1]
}

test('settings search maps Chinese and English terms to current tabs and items', async () => {
  const { searchSettings } = await loadSearchIndex()
  const cases = [
    ['终端', 'setting', 'setting-terminal'],
    ['model', 'setting', 'setting-ai'],
    ['backup', 'setting', 'setting-sync'],
    ['书签', 'bookmarks', ''],
    ['theme', 'terminalThemes', ''],
    ['quick command', 'quickCommands', ''],
    ['profile', 'profiles', ''],
    ['widget', 'widgets', '']
  ]

  for (const [query, tab, itemId] of cases) {
    const [result] = searchSettings(query)
    assert.ok(result, `${query} should find a setting`)
    assert.equal(result.tab, tab)
    assert.equal(result.itemId, itemId)
  }
})

test('settings search normalizes empty whitespace case and multiple tokens', async () => {
  const { searchSettings } = await loadSearchIndex()

  assert.deepEqual(searchSettings(''), [])
  assert.deepEqual(searchSettings('   \t\n '), [])
  assert.deepEqual(searchSettings('  MODEL  '), searchSettings('model'))

  const [result] = searchSettings('  terminal   palette ')
  assert.ok(result)
  assert.equal(result.tab, 'terminalThemes')
})

test('settings search exposes frozen static metadata only', async () => {
  const { settingSearchEntries, searchSettings } = await loadSearchIndex()
  const allowedKeys = ['itemId', 'labelKey', 'tab', 'terms']

  assert.equal(Object.isFrozen(settingSearchEntries), true)
  assert.equal(searchSettings.length, 1)
  for (const entry of settingSearchEntries) {
    assert.deepEqual(Object.keys(entry).sort(), allowedKeys)
    assert.equal(Object.isFrozen(entry), true)
    assert.equal(Object.isFrozen(entry.terms), true)
    assert.equal(Object.hasOwn(entry, 'value'), false)
    assert.equal(Object.hasOwn(entry, 'config'), false)
    assert.equal(Object.hasOwn(entry, 'currentValue'), false)
  }

  const serialized = JSON.stringify(settingSearchEntries)
  assert.doesNotMatch(serialized, /hunter2|supersecret|api[_-]?key[_-]?value|192\.168\.|10\.0\.0\./i)
  assert.deepEqual(
    searchSettings('runtime-only-secret', {
      password: 'runtime-only-secret',
      host: '192.168.1.20'
    }),
    []
  )
})

test('settings search metadata agrees with the current constants contract', async () => {
  const { settingSearchEntries } = await loadSearchIndex()
  const constantsSource = readClientSource('common/constants.js')
  const settingMapBlock = constantsSource.match(/export const settingMap = buildConst\(\[([\s\S]*?)\]\)/)
  assert.ok(settingMapBlock)

  const actualTabs = new Set(
    Array.from(settingMapBlock[1].matchAll(/'([^']+)'/g), match => match[1])
  )
  const actualItemIds = new Set([
    '',
    'settingCommonId',
    'settingTerminalId',
    'settingShortcutsId',
    'settingSyncId',
    'settingAiId',
    'settingPasswordsId'
  ].map(name => name ? getStringConstant(constantsSource, name) : ''))

  for (const entry of settingSearchEntries) {
    assert.equal(actualTabs.has(entry.tab), true, `${entry.tab} must exist in settingMap`)
    assert.equal(actualItemIds.has(entry.itemId), true, `${entry.itemId} must use a current setting item id`)
  }
})

test('settings header keeps language preview temporary and preserves all locale options', () => {
  const headerSource = readClientSource('components/setting-panel/setting-header.jsx')
  const modalSource = readClientSource('components/setting-panel/setting-modal.jsx')
  const initStateSource = readClientSource('store/init-state.js')

  assert.match(initStateSource, /previewLanguage:\s*''/)
  assert.match(headerSource, /import \{ Input, Select, Button \} from 'antd'/)
  assert.match(headerSource, /SearchOutlined[\s\S]*CloseOutlined/)
  assert.match(headerSource, /e\('settingsCenter'\)/)
  assert.match(headerSource, /e\('searchSettings'\)/)
  assert.match(headerSource, /e\('autoSaved'\)/)
  assert.match(headerSource, /function handlePreviewLanguage \(language\) \{\s*store\.previewLanguage = language\s*\}/)
  assert.equal((headerSource.match(/store\.setConfig\(/g) || []).length, 1)
  assert.match(headerSource, /if \(language && language !== store\.config\.language\) \{\s*store\.setConfig\(\{ language \}\)/)
  assert.match(headerSource, /function handleCancelLanguage \(\) \{\s*store\.previewLanguage = ''\s*\}/)
  assert.match(headerSource, /function handleClose \(\) \{\s*store\.previewLanguage = ''\s*onClose\(\)/)
  assert.match(headerSource, /useEffect\(\(\) => \{\s*return \(\) => \{\s*store\.previewLanguage = ''/)
  assert.match(headerSource, /languages\.map\(language =>/)
  assert.doesNotMatch(headerSource, /languages\s*=\s*\[[\s\S]*?zh_cn[\s\S]*?en_us[\s\S]*?\]/)
  assert.match(modalSource, /languages=\{window\.et\.langs \|\| \[\]\}/)
})

test('settings modal rerenders previews and navigates every visible search result through existing store APIs', () => {
  const modalSource = readClientSource('components/setting-panel/setting-modal.jsx')
  const headerSource = readClientSource('components/setting-panel/setting-header.jsx')

  assert.match(modalSource, /const \[query, setQuery\] = useState\(''\)/)
  assert.match(modalSource, /const searchResults = searchSettings\(query\)/)
  assert.match(modalSource, /function openSearchResult \(result = searchResults\[0\]\)/)
  assert.match(modalSource, /store\.handleChangeSettingTab\(result\.tab\)/)
  assert.match(modalSource, /store\.getSidebarList\(result\.tab\)/)
  assert.match(modalSource, /store\.setSettingItem\(item\)/)
  assert.match(modalSource, /searchResults=\{searchResults\}/)
  assert.match(modalSource, /onSelectSearchResult=\{openSearchResult\}/)
  assert.match(modalSource, /event\.(?:ctrlKey \|\| event\.metaKey|metaKey \|\| event\.ctrlKey)/)
  assert.match(modalSource, /event\.key\.toLowerCase\(\) !== 'k'/)
  assert.match(modalSource, /store\.openSetting\(\)/)
  assert.match(headerSource, /role='listbox'/)
  assert.match(headerSource, /role='option'/)
  assert.match(headerSource, /onClick=\{\(\) => onSelectSearchResult\(result\)\}/)
  assert.match(headerSource, /e\(result\.labelKey\)/)
  assert.match(modalSource, /function handleClose \(\) \{[\s\S]*?store\.previewLanguage = ''[\s\S]*?store\.hideSettingModal\(\)/)
  assert.match(modalSource, /<SettingHeader[\s\S]*?onClose=\{handleClose\}/)
  assert.match(modalSource, /onCancel=\{handleClose\}/)
})

test('language previews rerender every tab without changing the content tree identity', () => {
  const modalSource = readClientSource('components/setting-panel/setting-modal.jsx')

  assert.match(modalSource, /const effectiveLanguage = store\.previewLanguage \|\| store\.config\.language/)
  assert.doesNotMatch(modalSource, /key=\{(?:store\.previewLanguage|effectiveLanguage)/)
  assert.equal(
    (modalSource.match(/languageVersion=\{effectiveLanguage\}/g) || []).length,
    6,
    'all six stable tab components must receive the preview version as a normal prop'
  )
})

test('applying a changed preview keeps the existing localized restart prompt', () => {
  const headerSource = readClientSource('components/setting-panel/setting-header.jsx')
  const applySource = headerSource.match(
    /function handleApplyLanguage \(\) \{([\s\S]*?)\n\s{2}function handleCancelLanguage/
  )

  assert.ok(applySource)
  assert.match(headerSource, /import \{ notification \} from '\.\.\/common\/notification'/)
  assert.match(applySource[1], /if \(language && language !== store\.config\.language\) \{[\s\S]*?store\.setConfig\(\{ language \}\)[\s\S]*?store\.previewLanguage = ''[\s\S]*?notification\.info\(/)
  assert.match(applySource[1], /return[\s\S]*?\}\s*store\.previewLanguage = ''/)
  assert.match(headerSource, /e\('saveLang'\)/)
  assert.match(headerSource, /onClick=\{\(\) => window\.location\.reload\(\)\}/)
  assert.match(headerSource, /e\('restartNow'\)/)
})
