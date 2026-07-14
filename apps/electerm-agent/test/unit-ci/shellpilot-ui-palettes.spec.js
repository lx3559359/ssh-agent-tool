const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const commonDir = path.resolve(__dirname, '../../src/client/common')
const paletteModuleUrl = pathToFileURL(path.join(
  commonDir,
  'shellpilot-ui-palettes.js'
)).href
const tokensModuleUrl = pathToFileURL(path.join(
  commonDir,
  'ui-theme-tokens.js'
)).href
const isColorDarkModuleUrl = pathToFileURL(path.join(
  commonDir,
  'is-color-dark.js'
)).href
const expectedPalettes = [
  {
    id: 'shellpilot-ocean',
    name: 'Ocean Blue',
    nameKey: 'shellpilotThemeOcean',
    descriptionKey: 'shellpilotThemeOceanDesc',
    mode: 'light',
    uiThemeConfig: {
      main: '#F3F6FB',
      'main-light': '#FFFFFF',
      'main-dark': '#DDE5EF',
      text: '#253249',
      'text-light': '#526176',
      'text-dark': '#667489',
      'text-disabled': '#98A3B3',
      primary: '#1E63C6',
      info: '#1E63C6',
      success: '#0E6B59',
      error: '#B42338',
      warn: '#9A4A10'
    }
  },
  {
    id: 'shellpilot-jade',
    name: 'Jade Green',
    nameKey: 'shellpilotThemeJade',
    descriptionKey: 'shellpilotThemeJadeDesc',
    mode: 'light',
    uiThemeConfig: {
      main: '#EFF7F5',
      'main-light': '#FFFFFF',
      'main-dark': '#DDE5EF',
      text: '#203A36',
      'text-light': '#526176',
      'text-dark': '#667489',
      'text-disabled': '#98A3B3',
      primary: '#0E6B59',
      info: '#1E63C6',
      success: '#0E6B59',
      error: '#B42338',
      warn: '#9A4A10'
    }
  },
  {
    id: 'shellpilot-indigo',
    name: 'Cloud Indigo',
    nameKey: 'shellpilotThemeIndigo',
    descriptionKey: 'shellpilotThemeIndigoDesc',
    mode: 'light',
    uiThemeConfig: {
      main: '#F4F2FA',
      'main-light': '#FFFFFF',
      'main-dark': '#DDE5EF',
      text: '#302C45',
      'text-light': '#526176',
      'text-dark': '#667489',
      'text-disabled': '#98A3B3',
      primary: '#5B43C3',
      info: '#1E63C6',
      success: '#0E6B59',
      error: '#B42338',
      warn: '#9A4A10'
    }
  },
  {
    id: 'shellpilot-amber',
    name: 'Warm Amber',
    nameKey: 'shellpilotThemeAmber',
    descriptionKey: 'shellpilotThemeAmberDesc',
    mode: 'light',
    uiThemeConfig: {
      main: '#F7F3EB',
      'main-light': '#FFFDFA',
      'main-dark': '#DDE5EF',
      text: '#3D3528',
      'text-light': '#526176',
      'text-dark': '#667489',
      'text-disabled': '#98A3B3',
      primary: '#9A4A10',
      info: '#1E63C6',
      success: '#0E6B59',
      error: '#B42338',
      warn: '#9A4A10'
    }
  },
  {
    id: 'shellpilot-graphite',
    name: 'Graphite Night',
    nameKey: 'shellpilotThemeGraphite',
    descriptionKey: 'shellpilotThemeGraphiteDesc',
    mode: 'dark',
    uiThemeConfig: {
      main: '#10161F',
      'main-light': '#19212C',
      'main-dark': '#0B1018',
      text: '#DBE4EF',
      'text-light': '#FFFFFF',
      'text-dark': '#91A0B5',
      'text-disabled': '#66758A',
      primary: '#55A8FF',
      info: '#6DB7FF',
      success: '#4FD1B5',
      error: '#FF7185',
      warn: '#F0A45D'
    }
  }
]

function relativeLuminance (hex) {
  const channels = hex.slice(1).match(/.{2}/g).map(value => {
    const channel = parseInt(value, 16) / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio (foreground, background) {
  const luminances = [
    relativeLuminance(foreground),
    relativeLuminance(background)
  ].sort((left, right) => right - left)
  return (luminances[0] + 0.05) / (luminances[1] + 0.05)
}

test('builds the five ShellPilot palettes with complete legacy theme fields', async () => {
  const { buildShellPilotBuiltInThemes } = await import(paletteModuleUrl)
  const themes = buildShellPilotBuiltInThemes({
    foreground: '#dddddd',
    background: '#ffffff'
  })

  assert.equal(themes.length, expectedPalettes.length)
  for (const [index, theme] of themes.entries()) {
    const expected = expectedPalettes[index]
    assert.equal(theme.id, expected.id)
    assert.equal(theme.name, expected.name)
    assert.equal(theme.nameKey, expected.nameKey)
    assert.equal(theme.descriptionKey, expected.descriptionKey)
    assert.equal(theme.mode, expected.mode)
    assert.equal(theme.readonly, true)
    assert.equal(theme.type, 'shellpilot')
    assert.deepEqual(theme.uiThemeConfig, expected.uiThemeConfig)
    assert.equal(theme.themeConfig.background, '#0E0F12')
    assert.equal(theme.themeConfig.foreground, '#dddddd')
  }
})

test('builds independent palette objects without modifying the base terminal theme', async () => {
  const { buildShellPilotBuiltInThemes } = await import(paletteModuleUrl)
  const baseTerminalTheme = {
    foreground: '#dddddd',
    background: '#ffffff',
    cursor: '#123456'
  }
  const originalBaseTerminalTheme = { ...baseTerminalTheme }
  const themes = buildShellPilotBuiltInThemes(baseTerminalTheme)
  const nextThemes = buildShellPilotBuiltInThemes(baseTerminalTheme)

  assert.deepEqual(baseTerminalTheme, originalBaseTerminalTheme)
  assert.equal(new Set(themes.map(theme => theme.themeConfig)).size, themes.length)
  assert.equal(new Set(themes.map(theme => theme.uiThemeConfig)).size, themes.length)
  assert.notStrictEqual(themes[0].themeConfig, nextThemes[0].themeConfig)
  assert.notStrictEqual(themes[0].uiThemeConfig, nextThemes[0].uiThemeConfig)

  themes[0].themeConfig.foreground = '#000000'
  themes[0].uiThemeConfig.main = '#000000'
  assert.equal(themes[1].themeConfig.foreground, '#dddddd')
  assert.equal(themes[1].uiThemeConfig.main, '#EFF7F5')
  assert.equal(nextThemes[0].themeConfig.foreground, '#dddddd')
  assert.equal(nextThemes[0].uiThemeConfig.main, '#F3F6FB')
})

test('derives readable secondary page and card tokens from every palette', async () => {
  const [
    { buildShellPilotBuiltInThemes },
    { deriveSecondaryThemeTokens }
  ] = await Promise.all([
    import(paletteModuleUrl),
    import(tokensModuleUrl)
  ])
  const themes = buildShellPilotBuiltInThemes({ foreground: '#dddddd' })

  for (const theme of themes) {
    const tokens = deriveSecondaryThemeTokens(theme.uiThemeConfig)
    assert.equal(tokens.page, theme.uiThemeConfig.main)
    assert.equal(tokens.surface, theme.uiThemeConfig['main-light'])
    for (const foregroundKey of ['text', 'textMuted', 'danger']) {
      for (const backgroundKey of ['page', 'surface']) {
        const ratio = contrastRatio(
          tokens[foregroundKey],
          tokens[backgroundKey]
        )
        assert.ok(
          ratio >= 4.5,
          `${theme.id} ${foregroundKey}/${backgroundKey} contrast ${ratio}`
        )
      }
    }
  }
})

test('resolves ShellPilot names without translating default or third-party records', async () => {
  const { getThemeDisplayName } = await import(paletteModuleUrl)
  const shellPilotTheme = {
    type: 'shellpilot',
    name: 'Ocean Blue',
    nameKey: 'shellpilotThemeOcean'
  }

  assert.equal(
    getThemeDisplayName(shellPilotTheme, key => key),
    'Ocean Blue'
  )
  assert.equal(
    getThemeDisplayName(shellPilotTheme, key => {
      return key.charAt(0).toUpperCase() + key.slice(1)
    }),
    'Ocean Blue'
  )
  assert.equal(
    getThemeDisplayName(shellPilotTheme, () => '   '),
    'Ocean Blue'
  )
  assert.equal(
    getThemeDisplayName(shellPilotTheme, () => '海湾蓝'),
    '海湾蓝'
  )

  let thirdPartyTranslationCalls = 0
  const translateThirdParty = () => {
    thirdPartyTranslationCalls++
    return 'Translated third party name'
  }
  for (const theme of [
    { id: 'default', name: 'default', nameKey: 'default', type: 'default' },
    { name: 'User theme', nameKey: 'userTheme' },
    { name: 'Imported theme', nameKey: 'importedTheme', type: 'import' },
    { name: 'iTerm theme', nameKey: 'itermTheme', type: 'iterm' }
  ]) {
    assert.equal(
      getThemeDisplayName(theme, translateThirdParty),
      theme.name
    )
  }
  assert.equal(thirdPartyTranslationCalls, 0)
})

test('keeps legacy palette text and primary contrast readable', async () => {
  const [
    { buildShellPilotBuiltInThemes },
    { default: isColorDark }
  ] = await Promise.all([
    import(paletteModuleUrl),
    import(isColorDarkModuleUrl)
  ])
  const themes = buildShellPilotBuiltInThemes({ foreground: '#dddddd' })
  const failures = []

  for (const theme of themes) {
    const uiTheme = theme.uiThemeConfig
    const backgrounds = ['main', 'main-light']
    for (const foregroundKey of ['primary', 'info', 'success', 'error', 'warn']) {
      for (const backgroundKey of backgrounds) {
        const ratio = contrastRatio(
          uiTheme[foregroundKey],
          uiTheme[backgroundKey]
        )
        if (ratio < 4.5) {
          failures.push(
            `${theme.id} ${foregroundKey}/${backgroundKey} ${ratio.toFixed(3)}`
          )
        }
      }
    }
    const primaryContrast = isColorDark(uiTheme.primary)
      ? '#FFFFFF'
      : '#000000'
    const primaryContrastRatio = contrastRatio(
      primaryContrast,
      uiTheme.primary
    )
    if (primaryContrastRatio < 4.5) {
      failures.push(
        `${theme.id} primary-contrast/primary ${primaryContrastRatio.toFixed(3)}`
      )
    }
  }

  assert.deepEqual(failures, [])
})

test('store inserts built-ins before unique persisted user themes', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/store/terminal-theme.js'
  ), 'utf8')

  assert.match(source, /import \{ buildShellPilotBuiltInThemes \} from '\.\.\/common\/shellpilot-ui-palettes\.js'/)
  assert.match(source, /const builtIns = buildShellPilotBuiltInThemes\(t1\.themeConfig\)/)
  assert.match(source, /const reservedIds = new Set\(\[t1\.id, t2\.id, \.\.\.builtIns\.map\(theme => theme\.id\)\]\)/)
  assert.match(source, /!theme \|\| !theme\.id \|\| reservedIds\.has\(theme\.id\)/)
  assert.match(source, /reservedIds\.add\(theme\.id\)/)
  assert.match(source, /t1,\s*t2,\s*\.\.\.builtIns,\s*\.\.\.userThemes/)
})

test('theme list localizes built-in names with fallback and respects readonly records', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/theme/theme-list-item.jsx'
  ), 'utf8')

  assert.match(source, /import \{ getThemeDisplayName \} from '\.\.\/\.\.\/common\/shellpilot-ui-palettes\.js'/)
  assert.match(source, /const displayName = getThemeDisplayName\(item, e\)/)
  assert.match(source, /let title = id === defaultTheme\(\)\.id\s*\? e\(id\)\s*: displayName/)
  assert.match(source, /item\.readonly \|\| id === defaultTheme\(\)\.id \|\| type === 'iterm'/)
})
