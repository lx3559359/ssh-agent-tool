const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/ui-theme-tokens.js'
)).href
const defaultsModuleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/theme-defaults.js'
)).href

const tokenKeys = [
  'page',
  'surface',
  'surfaceSubtle',
  'surfaceInset',
  'surfaceElevated',
  'highlightTop',
  'text',
  'textMuted',
  'textDisabled',
  'border',
  'borderStrong',
  'primary',
  'primarySoft',
  'success',
  'info',
  'warning',
  'danger',
  'radiusControl',
  'radiusCard',
  'radiusOverlay',
  'shadowControl',
  'shadowCard',
  'shadowOverlay',
  'motionFast',
  'motionNormal'
]
const colorTokenKeys = [
  'page', 'surface', 'surfaceSubtle', 'surfaceInset', 'surfaceElevated',
  'text', 'textMuted', 'textDisabled', 'border', 'borderStrong',
  'primary', 'primarySoft', 'success', 'info', 'warning', 'danger'
]
const minimumTextContrast = 4.5

function toCssVariable (key) {
  const cssKey = key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)
  return `--sp-${cssKey}`
}

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
  const values = [
    relativeLuminance(foreground),
    relativeLuminance(background)
  ].sort((left, right) => right - left)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

function assertReadable (foreground, background, label) {
  const ratio = contrastRatio(foreground, background)
  assert.ok(
    ratio >= minimumTextContrast,
    `${label} contrast ${ratio.toFixed(3)} is below ${minimumTextContrast}:1`
  )
}

test('expands legacy three-digit colors in the real built-in UI themes', async () => {
  const [
    { deriveSecondaryThemeTokens },
    { defaultTheme, defaultThemeLight }
  ] = await Promise.all([import(moduleUrl), import(defaultsModuleUrl)])

  const dark = deriveSecondaryThemeTokens(defaultTheme().uiThemeConfig)
  assert.equal(dark.page, '#121214')
  assert.equal(dark.surface, '#2E3338')
  assert.equal(dark.text, '#DDDDDD')
  assert.equal(dark.primary, '#0088CC')

  const light = deriveSecondaryThemeTokens(defaultThemeLight().uiThemeConfig)
  assert.equal(light.page, '#EDEDED')
  assert.equal(light.surface, '#FEFEFE')
  assert.equal(light.text, '#555555')
  assert.equal(light.primary, '#0088CC')

  const short = deriveSecondaryThemeTokens({
    main: '#000',
    'main-light': '#111',
    text: '#fff',
    'text-dark': '#aaa',
    'text-disabled': '#777',
    primary: '#08c'
  })
  assert.equal(short.page, '#000000')
  assert.equal(short.surface, '#111111')
  assert.equal(short.text, '#FFFFFF')
  assert.equal(short.textMuted, '#AAAAAA')
  assert.equal(short.textDisabled, '#777777')
  assert.equal(short.primary, '#0088CC')
})

test('derives canonical secondary tokens from a legacy UI theme', async () => {
  const { deriveSecondaryThemeTokens } = await import(moduleUrl)
  const tokens = deriveSecondaryThemeTokens({
    main: '#ededed',
    'main-light': '#fefefe',
    'main-dark': '#cccccc',
    text: '#555555',
    'text-dark': '#444444',
    'text-disabled': '#888888',
    primary: '#0088cc',
    success: '#06D6A0',
    error: '#EF476F',
    warn: '#E55934',
    info: '#FFD166'
  })

  assert.equal(tokens.page, '#EDEDED')
  assert.equal(tokens.surface, '#FEFEFE')
  assert.equal(tokens.primary, '#0088CC')
  assert.match(tokens.border, /^#[0-9A-F]{6}$/)
  assert.match(tokens.primarySoft, /^#[0-9A-F]{6}$/)
  assert.equal(tokens.radiusCard, '10px')
})

test('uses brightness-aware readable fallbacks for malformed themes', async t => {
  const { deriveSecondaryThemeTokens } = await import(moduleUrl)
  const arrayTheme = []
  arrayTheme.main = '#000000'
  const cases = [
    { name: 'empty object', value: {}, dark: false, text: '#253249' },
    {
      name: 'dark page missing surface',
      value: { main: '#000000', text: '#FFFFFF' },
      dark: true,
      text: '#FFFFFF'
    },
    {
      name: 'dark page missing text',
      value: { main: '#121214' },
      dark: true,
      text: '#FFFFFF'
    },
    {
      name: 'light page missing text',
      value: { main: '#FFFFFF' },
      dark: false,
      text: '#253249'
    },
    { name: 'null', value: null, dark: false, text: '#253249' },
    { name: 'array', value: arrayTheme, dark: false, text: '#253249' },
    { name: 'string', value: 'invalid', dark: false, text: '#253249' },
    {
      name: 'invalid property types',
      value: {
        main: 123,
        'main-light': {},
        text: false,
        primary: []
      },
      dark: false,
      text: '#253249'
    },
    {
      name: 'invalid color strings',
      value: {
        main: 'invalid',
        'main-light': '#12',
        text: 'not-a-color',
        'text-dark': '#12345G',
        primary: '#12345',
        error: 'red'
      },
      dark: false,
      text: '#253249'
    }
  ]

  for (const item of cases) {
    await t.test(item.name, () => {
      let tokens
      assert.doesNotThrow(() => {
        tokens = deriveSecondaryThemeTokens(item.value)
      })
      assert.deepEqual(Object.keys(tokens), tokenKeys)
      for (const key of colorTokenKeys) {
        assert.match(tokens[key], /^#[0-9A-F]{6}$/, key)
      }
      assert.equal(relativeLuminance(tokens.page) < 0.5, item.dark)
      assert.equal(relativeLuminance(tokens.surface) < 0.5, item.dark)
      assert.ok(contrastRatio(tokens.page, tokens.surface) < 2)
      assert.equal(tokens.text, item.text)
      assertReadable(tokens.text, tokens.page, `${item.name} text/page`)
      assertReadable(tokens.text, tokens.surface, `${item.name} text/surface`)
    })
  }
})

test('keeps muted and danger text readable on secondary page and card surfaces', async t => {
  const [
    { deriveSecondaryThemeTokens },
    { defaultTheme, defaultThemeLight }
  ] = await Promise.all([import(moduleUrl), import(defaultsModuleUrl)])
  const cases = [
    { name: 'default dark', value: defaultTheme().uiThemeConfig },
    { name: 'default light', value: defaultThemeLight().uiThemeConfig },
    {
      name: 'pure dark',
      value: {
        main: '#000000',
        'main-light': '#111111',
        text: '#FFFFFF',
        'text-dark': '#777777',
        error: '#EF476F'
      }
    },
    {
      name: 'pure light',
      value: {
        main: '#FFFFFF',
        'main-light': '#F7F7F7',
        text: '#000000',
        'text-dark': '#888888',
        error: '#EF476F'
      }
    }
  ]

  for (const item of cases) {
    await t.test(item.name, () => {
      const tokens = deriveSecondaryThemeTokens(item.value)
      for (const key of ['textMuted', 'danger']) {
        assertReadable(tokens[key], tokens.page, `${item.name} ${key}/page`)
        assertReadable(tokens[key], tokens.surface, `${item.name} ${key}/surface`)
      }
    })
  }
})

test('derives restrained four-level depth values for light and dark themes', async () => {
  const { deriveSecondaryThemeTokens } = await import(moduleUrl)
  const light = deriveSecondaryThemeTokens({
    main: '#F2F6FA',
    'main-light': '#F8FAFC',
    text: '#253249',
    primary: '#2878E6'
  })
  const dark = deriveSecondaryThemeTokens({
    main: '#10161E',
    'main-light': '#151D27',
    text: '#E8EEF6',
    primary: '#4C93F4'
  })
  for (const tokens of [light, dark]) {
    assert.notEqual(tokens.surfaceElevated, tokens.surface)
    assert.notEqual(tokens.surfaceInset, tokens.surface)
    assert.match(tokens.highlightTop, /^rgba\(/)
    assert.match(tokens.shadowControl, /^0 2px/)
    assert.match(tokens.shadowCard, /^0 (?:7|8)px/)
    assert.match(tokens.shadowOverlay, /^0 (?:18|20)px/)
    assert.equal(tokens.radiusOverlay, '10px')
    assert.equal(tokens.motionFast, '120ms')
    assert.equal(tokens.motionNormal, '180ms')
  }
  assert.notEqual(light.shadowCard, dark.shadowCard)
  assert.notEqual(light.shadowOverlay, dark.shadowOverlay)
})

test('serializes the exact twenty-five-token secondary UI contract', async () => {
  const { deriveSecondaryThemeTokens, buildUiThemeCss } = await import(moduleUrl)
  const tokens = deriveSecondaryThemeTokens()
  const css = buildUiThemeCss({
    main: '#111111',
    text: '#eeeeee',
    primary: '#2878e6'
  })
  const variables = Array.from(
    css.matchAll(/^\s*(--sp-[a-z-]+):/gm),
    match => match[1]
  )

  assert.deepEqual(Object.keys(tokens), tokenKeys)
  assert.deepEqual(variables, tokenKeys.map(toCssVariable))
  assert.equal(new Set(variables).size, 25)
  assert.match(css, /--sp-primary: #2878E6;/)
  assert.match(css, /--sp-radius-card: 10px;/)
  assert.equal((css.match(/:root/g) || []).length, 1)
})

test('keeps legacy and semantic variables together in the theme injector', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/main/ui-theme.jsx'
  ), 'utf8')

  assert.match(source, /import \{ buildUiThemeCss \} from '\.\.\/\.\.\/common\/ui-theme-tokens'/)
  assert.match(source, /--\$\{key\}-contrast:/)
  assert.match(source, /--\$\{key\}-darker:/)
  assert.match(source, /--\$\{key\}-lighter:/)
  assert.match(source, /const legacyCss = themeCss/)
  assert.match(source, /\$\{legacyCss\}\$\{buildUiThemeCss\(themeConfig\)\}/)
})
