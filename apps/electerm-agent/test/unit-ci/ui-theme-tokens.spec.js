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
  'canvas',
  'surface',
  'surfaceSubtle',
  'surfaceSoft',
  'surfaceInset',
  'surfaceElevated',
  'pageBackground',
  'topbarBackground',
  'controlBackground',
  'cardBackground',
  'panelBackground',
  'overlayBackground',
  'flatBackground',
  'highlightTop',
  'highlight',
  'text',
  'textMuted',
  'textDisabled',
  'border',
  'borderStrong',
  'primary',
  'primaryAlt',
  'primarySoft',
  'cyan',
  'success',
  'successSoft',
  'info',
  'infoSoft',
  'warning',
  'warningSoft',
  'danger',
  'dangerSoft',
  'radiusSmall',
  'radiusControl',
  'radiusToolbar',
  'radiusCard',
  'radiusPanel',
  'radiusOverlay',
  'shadowSm',
  'shadowMd',
  'shadowLg',
  'shadowFocus',
  'shadowControl',
  'shadowCard',
  'shadowPanel',
  'shadowOverlay',
  'focusOffset',
  'motionFast',
  'motionNormal'
]
const colorTokenKeys = [
  'page', 'canvas', 'surface', 'surfaceSubtle', 'surfaceSoft',
  'surfaceInset', 'surfaceElevated', 'flatBackground',
  'text', 'textMuted', 'textDisabled', 'border', 'borderStrong',
  'primary', 'primaryAlt', 'primarySoft', 'cyan', 'success', 'successSoft',
  'info', 'infoSoft', 'warning', 'warningSoft', 'danger', 'dangerSoft'
]
const minimumTextContrast = 4.5

function toCssVariable (key) {
  if (key === 'primaryAlt') return '--sp-primary-2'
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
  assert.equal(tokens.radiusCard, '18px')
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

test('keeps muted text readable on secondary page and card surfaces', async t => {
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
      for (const key of ['textMuted']) {
        assertReadable(tokens[key], tokens.page, `${item.name} ${key}/page`)
        assertReadable(tokens[key], tokens.surface, `${item.name} ${key}/surface`)
      }
    })
  }
})

test('derives restrained light and dark depth without changing compatibility aliases', async () => {
  const { deriveSecondaryThemeTokens } = await import(moduleUrl)
  const light = deriveSecondaryThemeTokens({
    main: '#F6F7FF',
    'main-light': '#FFFFFF',
    'surface-soft': '#F0F2FF',
    text: '#111B3F',
    'text-dark': '#69708E',
    primary: '#4D46F5',
    'primary-alt': '#6C63FF',
    cyan: '#149BD7',
    success: '#20B66A',
    warn: '#F2A11D',
    error: '#E5484D',
    border: '#DDE1F3'
  })
  const dark = deriveSecondaryThemeTokens({
    main: '#0B1020',
    'main-light': '#11182A',
    'surface-soft': '#171F35',
    text: '#EDF1FF',
    'text-dark': '#9CA6C4',
    primary: '#746DFF',
    'primary-alt': '#8A82FF',
    cyan: '#2CB7EB',
    success: '#32D583',
    warn: '#F7B84B',
    error: '#FF6B70',
    border: '#28334F'
  })

  assert.deepEqual(
    [light.canvas, light.surface, light.surfaceSoft, light.text, light.textMuted, light.primary, light.primaryAlt, light.cyan, light.success, light.warning, light.danger, light.border],
    ['#F6F7FF', '#FFFFFF', '#F0F2FF', '#111B3F', '#69708E', '#4D46F5', '#6C63FF', '#149BD7', '#20B66A', '#F2A11D', '#E5484D', '#DDE1F3']
  )
  assert.deepEqual(
    [dark.canvas, dark.surface, dark.surfaceSoft, dark.text, dark.textMuted, dark.primary, dark.primaryAlt, dark.cyan, dark.success, dark.warning, dark.danger, dark.border],
    ['#0B1020', '#11182A', '#171F35', '#EDF1FF', '#9CA6C4', '#746DFF', '#8A82FF', '#2CB7EB', '#32D583', '#F7B84B', '#FF6B70', '#28334F']
  )
  assert.deepEqual(
    [
      light.radiusSmall,
      light.radiusControl,
      light.radiusToolbar,
      light.radiusCard,
      light.radiusPanel,
      light.radiusOverlay
    ],
    ['8px', '12px', '16px', '18px', '22px', '24px']
  )
  assert.equal(
    light.shadowControl,
    '0 2px 4px rgba(44, 62, 84, 0.10), 0 7px 15px rgba(54, 77, 103, 0.14)'
  )
  assert.equal(
    light.shadowCard,
    '0 3px 6px rgba(44, 62, 84, 0.13), 0 14px 27px rgba(54, 77, 103, 0.20)'
  )
  assert.equal(
    light.shadowPanel,
    '0 4px 8px rgba(44, 62, 84, 0.15), 0 20px 40px rgba(54, 77, 103, 0.23)'
  )
  assert.equal(
    light.shadowOverlay,
    '0 6px 12px rgba(38, 54, 74, 0.18), 0 28px 52px rgba(49, 70, 96, 0.28)'
  )
  assert.equal(
    light.shadowFocus,
    '0 0 0 3px rgba(92, 91, 233, 0.24), 0 8px 20px rgba(68, 91, 118, 0.14)'
  )
  assert.match(dark.shadowControl, /rgba\(0, 0, 0, 0\.34\)/)
  assert.match(dark.shadowCard, /rgba\(0, 0, 0, 0\.38\)/)
  assert.match(dark.shadowPanel, /rgba\(0, 0, 0, 0\.46\)/)
  assert.match(dark.shadowOverlay, /rgba\(0, 0, 0, 0\.54\)/)
  assert.equal(
    dark.shadowFocus,
    '0 0 0 3px rgba(133, 131, 255, 0.28), 0 10px 24px rgba(0, 0, 0, 0.36)'
  )
  assert.equal(light.shadowSm, light.shadowControl)
  assert.equal(light.shadowMd, light.shadowCard)
  assert.equal(light.shadowLg, light.shadowOverlay)
  assert.equal(light.highlightTop, light.highlight)
  assert.notEqual(light.shadowOverlay, dark.shadowOverlay)
})

test('derives the approved Glacier and Graphite Silver material layers', async () => {
  const { deriveSecondaryThemeTokens } = await import(moduleUrl)
  const light = deriveSecondaryThemeTokens({
    main: '#EDF5FB',
    'main-light': '#F8FBFD',
    'surface-soft': '#E7EEF4',
    text: '#14243F',
    'text-dark': '#65738A',
    primary: '#5C5BE9',
    'primary-alt': '#5547A6',
    'page-dot': '#537EB2',
    'card-start': '#F8FBFD',
    'card-mid': '#E7EEF4',
    'card-end': '#D8E4EC',
    'panel-start': '#F5F9FC',
    'panel-mid': '#E8F0F5',
    'panel-end': '#DAE5ED',
    flat: '#EAF1F6',
    'topbar-start': '#306290',
    'topbar-mid': '#40588E',
    'topbar-end': '#5547A6'
  })
  const dark = deriveSecondaryThemeTokens({
    main: '#101722',
    'main-light': '#2B3745',
    'surface-soft': '#202A37',
    text: '#EDF3FA',
    'text-dark': '#AAB6C5',
    primary: '#8583FF',
    'primary-alt': '#A094FF',
    'page-dot': '#536B8A',
    'card-start': '#2B3745',
    'card-mid': '#202A37',
    'card-end': '#17212C',
    'panel-start': '#27323F',
    'panel-mid': '#1D2733',
    'panel-end': '#141D27',
    flat: '#17212C',
    'topbar-start': '#263F63',
    'topbar-mid': '#37477A',
    'topbar-end': '#493A87'
  })

  assert.equal(
    light.topbarBackground,
    'linear-gradient(100deg, #306290 0%, #40588E 52%, #5547A6 100%)'
  )
  assert.equal(
    light.cardBackground,
    'radial-gradient(110% 90% at 15% 0%, #FFFFFF 0%, rgba(255, 255, 255, 0.72) 34%, transparent 72%), linear-gradient(150deg, #F8FBFD 0%, #E7EEF4 54%, #D8E4EC 100%)'
  )
  assert.equal(
    light.panelBackground,
    'linear-gradient(150deg, #F5F9FC 0%, #E8F0F5 58%, #DAE5ED 100%)'
  )
  assert.equal(light.flatBackground, '#EAF1F6')
  assert.match(light.pageBackground, /rgba\(83, 126, 178, 0\.30\)/)
  assert.match(dark.cardBackground, /#2B3745 0%.*#202A37 54%.*#17212C 100%/)
  assert.doesNotMatch(dark.cardBackground, /#F8FBFD|#E7EEF4|#D8E4EC/)
  assert.equal(dark.flatBackground, '#17212C')
})

test('serializes the exact secondary UI token contract', async () => {
  const { deriveSecondaryThemeTokens, buildUiThemeCss } = await import(moduleUrl)
  const tokens = deriveSecondaryThemeTokens()
  const css = buildUiThemeCss({
    main: '#111111',
    text: '#eeeeee',
    primary: '#2878e6'
  })
  const variables = Array.from(
    css.matchAll(/^\s*(--sp-[a-z0-9-]+):/gm),
    match => match[1]
  )

  assert.deepEqual(Object.keys(tokens), tokenKeys)
  assert.deepEqual(variables, tokenKeys.map(toCssVariable))
  assert.equal(variables.length, tokenKeys.length)
  assert.equal(new Set(variables).size, tokenKeys.length)
  assert.ok(variables.includes('--sp-canvas'))
  assert.ok(variables.includes('--sp-surface-soft'))
  assert.ok(variables.includes('--sp-primary-2'))
  assert.ok(variables.includes('--sp-shadow-focus'))
  assert.ok(variables.includes('--sp-page-background'))
  assert.ok(variables.includes('--sp-topbar-background'))
  assert.ok(variables.includes('--sp-control-background'))
  assert.ok(variables.includes('--sp-card-background'))
  assert.ok(variables.includes('--sp-panel-background'))
  assert.ok(variables.includes('--sp-overlay-background'))
  assert.ok(variables.includes('--sp-flat-background'))
  assert.ok(variables.includes('--sp-shadow-panel'))
  assert.match(css, /--sp-primary: #2878E6;/)
  assert.match(css, /--sp-radius-small: 8px;/)
  assert.match(css, /--sp-radius-control: 12px;/)
  assert.match(css, /--sp-radius-toolbar: 16px;/)
  assert.match(css, /--sp-radius-card: 18px;/)
  assert.match(css, /--sp-radius-panel: 22px;/)
  assert.match(css, /--sp-radius-overlay: 24px;/)
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
