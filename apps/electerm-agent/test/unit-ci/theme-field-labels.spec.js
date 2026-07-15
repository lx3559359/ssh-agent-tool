const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')
const { pathToFileURL } = require('node:url')

const clientDir = path.resolve(__dirname, '../../src/client')
const commonDir = path.join(clientDir, 'common')
const labelsUrl = pathToFileURL(path.join(commonDir, 'theme-field-labels.js'))
const validationUrl = pathToFileURL(path.join(commonDir, 'theme-validation.js'))
const i18nUrl = pathToFileURL(path.join(commonDir, 'shellpilot-i18n-overrides.js'))
const constraintsUrl = pathToFileURL(path.join(commonDir, 'shellpilot-theme-constraints.js'))
const terminalThemeUrl = pathToFileURL(path.join(commonDir, 'terminal-theme.js'))

registerHooks({
  resolve (specifier, context, nextResolve) {
    if (context.parentURL === terminalThemeUrl.href) {
      if (specifier === '../common/constants') {
        return {
          shortCircuit: true,
          url: 'data:text/javascript,export const settingMap = {}'
        }
      }
      if (specifier === '../common/download') {
        return {
          shortCircuit: true,
          url: 'data:text/javascript,export default function download () {}'
        }
      }
      if (specifier === './theme-defaults') {
        return {
          shortCircuit: true,
          url: 'data:text/javascript,export function defaultTheme () { return { themeConfig: {} } }'
        }
      }
    }
    return nextResolve(specifier, context)
  }
})

global.window = {
  translate: value => value
}

function escapeRegExp (value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function makeThemeText (requiredThemeProps, replacements = {}, extras = []) {
  return requiredThemeProps
    .map(key => `${key}=${replacements[key] || '#123456'}`)
    .concat(extras)
    .join('\n')
}

test('labels every supported UI, terminal, and ANSI theme field in Chinese and English', async () => {
  const { validThemeProps } = await import(terminalThemeUrl)
  const {
    getThemeFieldLabel,
    themeFieldKeys
  } = await import(labelsUrl)

  assert.deepEqual(
    [...themeFieldKeys].sort(),
    [...validThemeProps].sort()
  )

  for (const key of validThemeProps) {
    const keyPattern = new RegExp(`\\(${escapeRegExp(key)}\\)$`)
    assert.match(getThemeFieldLabel(key, 'zh_cn'), keyPattern, key)
    assert.match(getThemeFieldLabel(key, 'en_us'), keyPattern, key)
    assert.equal(
      getThemeFieldLabel(key, 'fr_fr'),
      getThemeFieldLabel(key, 'en_us'),
      `${key} should use the English label outside Simplified Chinese`
    )
  }

  assert.equal(
    getThemeFieldLabel('primary', 'zh_cn'),
    '主色 / Primary (primary)'
  )
  assert.equal(
    getThemeFieldLabel('primary', 'en_us'),
    'Primary (primary)'
  )
  assert.equal(
    getThemeFieldLabel('terminal:background', 'zh_cn'),
    '终端背景色 / Terminal Background (terminal:background)'
  )
  assert.equal(getThemeFieldLabel('plugin:accent', 'zh_cn'), 'plugin:accent')
  assert.equal(getThemeFieldLabel('__proto__', 'en_us'), '__proto__')
  assert.equal(getThemeFieldLabel('constructor', 'zh_cn'), 'constructor')
  assert.equal(getThemeFieldLabel('', 'en_us'), '')
})

test('uses preview language first without requiring an editor remount', async () => {
  const {
    getThemeEditorLanguage,
    getThemeFieldLabel
  } = await import(labelsUrl)

  assert.equal(getThemeEditorLanguage({
    previewLanguage: 'en_us',
    config: { language: 'zh_cn' }
  }), 'en_us')
  assert.equal(getThemeEditorLanguage({
    previewLanguage: '',
    config: { language: 'zh_cn' }
  }), 'zh_cn')
  assert.equal(getThemeEditorLanguage({
    config: { language: 'de_de' }
  }), 'de_de')
  assert.equal(getThemeEditorLanguage(), 'zh_cn')
  assert.equal(
    getThemeFieldLabel('terminal:brightMagenta', 'de_de'),
    'ANSI Bright Magenta (terminal:brightMagenta)'
  )

  const editorSource = fs.readFileSync(path.join(
    clientDir,
    'components/theme/theme-editor.jsx'
  ), 'utf8')
  const formSource = fs.readFileSync(path.join(
    clientDir,
    'components/theme/theme-form.jsx'
  ), 'utf8')
  assert.doesNotMatch(editorSource, /key=\{(?:language|languageVersion|previewLanguage)/)
  assert.doesNotMatch(formSource, /key=\{(?:language|languageVersion|previewLanguage)/)
})

test('locks only the terminal background and always exposes the normalized value', async () => {
  const {
    getThemeFieldValue,
    isThemeFieldLocked
  } = await import(labelsUrl)
  const {
    normalizeTerminalThemeConfig,
    shellPilotTerminalBackground
  } = await import(constraintsUrl)
  const { convertTheme } = await import(terminalThemeUrl)

  assert.equal(isThemeFieldLocked('terminal:background'), true)
  assert.equal(isThemeFieldLocked('terminal:foreground'), false)
  assert.equal(getThemeFieldValue('terminal:background', '#ffffff'), shellPilotTerminalBackground)
  assert.equal(getThemeFieldValue('terminal:foreground', '#ffffff'), '#ffffff')
  assert.equal(
    normalizeTerminalThemeConfig({ background: '#ffffff' }).background,
    shellPilotTerminalBackground
  )
  assert.equal(
    convertTheme('terminal:background=#ffffff').themeConfig.background,
    shellPilotTerminalBackground
  )

  const editorSource = fs.readFileSync(path.join(
    clientDir,
    'components/theme/theme-editor.jsx'
  ), 'utf8')
  const slotSource = fs.readFileSync(path.join(
    clientDir,
    'components/theme/theme-edit-slot.jsx'
  ), 'utf8')
  assert.match(editorSource, /isThemeFieldLocked/)
  assert.match(editorSource, /disabled=\{disabled \|\| locked\}/)
  assert.match(editorSource, /locked=\{locked\}/)
  assert.match(slotSource, /\{label\}/)
  assert.match(slotSource, /locked\s*\?[^:]*terminalBackgroundLocked/s)
})

test('returns localized validation errors with property interpolation', async () => {
  const { requiredThemeProps } = await import(terminalThemeUrl)
  const {
    getShellPilotTranslation
  } = await import(i18nUrl)
  const {
    validateThemeName,
    validateThemeText
  } = await import(validationUrl)
  const translate = langId => key => getShellPilotTranslation(key, langId) || key
  const validText = makeThemeText(requiredThemeProps)

  assert.deepEqual(
    validateThemeName('x'.repeat(31), translate('zh_cn')),
    ['主题名称不能超过 30 个字符']
  )
  assert.deepEqual(
    validateThemeName('  ', translate('en_us')),
    ['Theme name is required']
  )
  assert.deepEqual(
    validateThemeText('', translate('en_us')),
    ['Theme configuration is required']
  )

  const missingPrimary = makeThemeText(
    requiredThemeProps.filter(key => key !== 'primary')
  )
  assert.ok(
    validateThemeText(missingPrimary, translate('zh_cn'))
      .includes('主题配置缺少必需属性: primary')
  )

  const invalidPrimary = makeThemeText(requiredThemeProps, {
    primary: 'blue'
  })
  assert.ok(
    validateThemeText(invalidPrimary, translate('en_us'))
      .includes('Invalid color format: primary')
  )

  assert.ok(
    validateThemeText(
      `${validText}\nplugin:accent=#abcdef`,
      translate('zh_cn')
    ).includes('不支持的主题属性: plugin:accent')
  )

  assert.ok(
    validateThemeText('x'.repeat(1001), translate('en_us'))
      .includes('Theme configuration cannot exceed 1000 characters')
  )
})

test('reports repeated prototype-like and ordinary unknown properties without prototype pollution', async () => {
  const { requiredThemeProps } = await import(terminalThemeUrl)
  const { getShellPilotTranslation } = await import(i18nUrl)
  const { validateThemeText } = await import(validationUrl)
  const translate = key => getShellPilotTranslation(key, 'en_us') || key
  const probeKey = '__themeValidationPollutionProbe'
  const validText = makeThemeText(requiredThemeProps)
  const dangerousText = [
    validText,
    '__proto__=#abcdef',
    '__proto__=#123456',
    'constructor=#abcdef',
    'prototype=#abcdef',
    `${probeKey}=#abcdef`,
    'plugin:accent=#abcdef'
  ].join('\n')

  assert.equal(Object.prototype[probeKey], undefined)
  const errors = validateThemeText(dangerousText, translate)
  assert.equal(Object.prototype[probeKey], undefined)
  assert.deepEqual(errors, [
    'Unsupported theme property: __proto__',
    'Unsupported theme property: constructor',
    'Unsupported theme property: prototype',
    `Unsupported theme property: ${probeKey}`,
    'Unsupported theme property: plugin:accent'
  ])
})

test('keeps validation catalog keys synchronized and resolves actual Chinese and English copy', async () => {
  const {
    getShellPilotCatalogKeys,
    getShellPilotTranslation,
    resolveShellPilotTranslation
  } = await import(i18nUrl)
  const expected = {
    themeNameRequired: ['请输入主题名称', 'Theme name is required'],
    themeMaxChars: ['主题名称不能超过 30 个字符', 'Theme name cannot exceed 30 characters'],
    themeConfigRequired: ['请输入主题配置', 'Theme configuration is required'],
    themeConfigMaxChars: ['主题配置不能超过 1000 个字符', 'Theme configuration cannot exceed 1000 characters'],
    themeMissingProperty: ['主题配置缺少必需属性', 'Theme configuration is missing a required property'],
    themeInvalidColor: ['颜色格式无效', 'Invalid color format'],
    themeUnsupportedProperty: ['不支持的主题属性', 'Unsupported theme property'],
    terminalBackgroundLocked: ['终端背景已锁定为近黑色', 'Terminal background is locked to near-black']
  }

  assert.deepEqual(
    getShellPilotCatalogKeys('zh_cn'),
    getShellPilotCatalogKeys('en_us')
  )
  for (const [key, [chinese, english]] of Object.entries(expected)) {
    assert.equal(getShellPilotTranslation(key, 'zh_cn'), chinese)
    assert.equal(getShellPilotTranslation(key, 'en_us'), english)
    assert.equal(
      resolveShellPilotTranslation(key, 'zh_cn', key, key, key),
      chinese
    )
    assert.equal(
      resolveShellPilotTranslation(key, 'en_us', key, key, key),
      english
    )
  }
})
