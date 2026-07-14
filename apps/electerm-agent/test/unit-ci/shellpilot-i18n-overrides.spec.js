const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const i18nPath = path.resolve(
  __dirname,
  '../../src/client/common/shellpilot-i18n-overrides.js'
)
const moduleUrl = pathToFileURL(i18nPath).href

const expectedCatalogs = {
  zh_cn: {
    bookmarks: '书签',
    history: '历史',
    ssh: '终端',
    sftp: 'SFTP',
    widgets: '工具中心',
    settingsCenter: '设置中心',
    searchSettings: '搜索设置、选项或功能',
    autoSaved: '已自动保存',
    generalSettings: '常规设置',
    generalSettingsDescription: '配置 ShellPilot 的启动、连接、网络与显示行为',
    startupAndConnection: '启动与连接',
    startupAndConnectionDescription: '配置启动会话、连接超时和保活行为',
    networkAndUpdates: '网络与更新',
    networkAndUpdatesDescription: '配置代理、更新通道和更新来源',
    interfaceAndLanguage: '界面与语言',
    interfaceAndLanguageDescription: '配置界面主题、透明度和自定义样式',
    advancedSettings: '高级设置',
    advancedSettingsDescription: '配置外部程序、二次验证和兼容选项',
    terminalSettings: '终端设置',
    aiAndModels: 'AI 与模型',
    syncAndBackup: '同步与备份',
    keyboardShortcuts: '快捷键',
    passwordManager: '密码管理',
    themeLibrary: '主题库',
    themePreview: '实时预览',
    themeFilterAll: '全部',
    themeFilterLight: '浅色',
    themeFilterDark: '深色',
    themeReadonly: '只读',
    themeViewDetails: '查看主题',
    themeApplied: '已应用',
    themeApplyFailed: '主题应用失败，请检查当前主题设置',
    themeUpdateChannel: '更新通道',
    themeContextMenu: '上下文菜单',
    advancedColorEditor: '高级颜色编辑',
    shellpilotThemeOcean: '海湾蓝',
    shellpilotThemeOceanDesc: '专业清晰，适合日常服务器管理。',
    shellpilotThemeJade: '翡翠绿',
    shellpilotThemeJadeDesc: '舒缓稳重，状态色更加自然。',
    shellpilotThemeIndigo: '云境紫',
    shellpilotThemeIndigoDesc: '具有 AI 产品感和品牌辨识度。',
    shellpilotThemeAmber: '暖砂橙',
    shellpilotThemeAmberDesc: '温暖低压，弱化工具软件的冰冷感。',
    shellpilotThemeGraphite: '石墨夜',
    shellpilotThemeGraphiteDesc: '夜间使用，配置卡片仍保持清晰。',
    terminalBackgroundLocked: '终端背景已锁定为近黑色',
    restorePageDefaults: '恢复本页默认值',
    themeNameRequired: '请输入主题名称',
    themeMaxChars: '主题名称不能超过 30 个字符',
    themeConfigRequired: '请输入主题配置',
    themeMissingProperty: '主题配置缺少必需属性',
    themeInvalidColor: '颜色格式无效',
    themeUnsupportedProperty: '不支持的主题属性',
    testConfiguration: '测试配置',
    connectionHealthy: '连接正常',
    moveToSafeTrash: '移到安全回收站'
  },
  en_us: {
    bookmarks: 'Bookmarks',
    history: 'History',
    ssh: 'Terminal',
    sftp: 'SFTP',
    widgets: 'Tool Center',
    settingsCenter: 'Settings Center',
    searchSettings: 'Search settings, options, or features',
    autoSaved: 'Automatically saved',
    generalSettings: 'General',
    generalSettingsDescription: 'Configure ShellPilot startup, connection, network, and display behavior.',
    startupAndConnection: 'Startup and Connection',
    startupAndConnectionDescription: 'Configure startup sessions, connection timeouts, and keepalive behavior.',
    networkAndUpdates: 'Network and Updates',
    networkAndUpdatesDescription: 'Configure proxies, update channels, and update sources.',
    interfaceAndLanguage: 'Interface and Language',
    interfaceAndLanguageDescription: 'Configure UI themes, opacity, and custom styles.',
    advancedSettings: 'Advanced Settings',
    advancedSettingsDescription: 'Configure external programs, two-factor prompts, and compatibility options.',
    terminalSettings: 'Terminal',
    aiAndModels: 'AI and Models',
    syncAndBackup: 'Sync and Backup',
    keyboardShortcuts: 'Keyboard Shortcuts',
    passwordManager: 'Password Manager',
    themeLibrary: 'Theme Library',
    themePreview: 'Live Preview',
    themeFilterAll: 'All',
    themeFilterLight: 'Light',
    themeFilterDark: 'Dark',
    themeReadonly: 'Read-only',
    themeViewDetails: 'View theme',
    themeApplied: 'Applied',
    themeApplyFailed: 'Unable to apply theme. Check the current theme settings.',
    themeUpdateChannel: 'Update channel',
    themeContextMenu: 'Context menu',
    advancedColorEditor: 'Advanced Color Editor',
    shellpilotThemeOcean: 'Ocean Blue',
    shellpilotThemeOceanDesc: 'Clear and professional for daily server administration.',
    shellpilotThemeJade: 'Jade Green',
    shellpilotThemeJadeDesc: 'Calm and stable with natural status colors.',
    shellpilotThemeIndigo: 'Cloud Indigo',
    shellpilotThemeIndigoDesc: 'A distinctive palette suited to AI-assisted workflows.',
    shellpilotThemeAmber: 'Warm Amber',
    shellpilotThemeAmberDesc: 'A warmer, lower-pressure interface for long sessions.',
    shellpilotThemeGraphite: 'Graphite Night',
    shellpilotThemeGraphiteDesc: 'A dark palette with clear configuration hierarchy.',
    terminalBackgroundLocked: 'Terminal background is locked to near-black',
    restorePageDefaults: 'Restore page defaults',
    themeNameRequired: 'Theme name is required',
    themeMaxChars: 'Theme name cannot exceed 30 characters',
    themeConfigRequired: 'Theme configuration is required',
    themeMissingProperty: 'Theme configuration is missing a required property',
    themeInvalidColor: 'Invalid color format',
    themeUnsupportedProperty: 'Unsupported theme property',
    testConfiguration: 'Test Configuration',
    connectionHealthy: 'Connection healthy',
    moveToSafeTrash: 'Move to Safe Trash'
  }
}

test('provides the complete ShellPilot catalog in Simplified Chinese and English', async () => {
  const {
    getShellPilotCatalogKeys,
    getShellPilotTranslation
  } = await import(moduleUrl)

  for (const [langId, expectedCatalog] of Object.entries(expectedCatalogs)) {
    const expectedKeys = Object.keys(expectedCatalog).sort()
    assert.deepEqual(getShellPilotCatalogKeys(langId), expectedKeys)

    const actualCatalog = Object.fromEntries(expectedKeys.map(key => [
      key,
      getShellPilotTranslation(key, langId)
    ]))
    assert.deepEqual(actualCatalog, expectedCatalog)
  }

  assert.deepEqual(
    getShellPilotCatalogKeys('zh_cn'),
    getShellPilotCatalogKeys('en_us')
  )
})

test('catalog values are non-empty strings without obvious encoding corruption', async () => {
  const {
    getShellPilotCatalogKeys,
    getShellPilotTranslation
  } = await import(moduleUrl)

  for (const langId of ['zh_cn', 'en_us']) {
    for (const key of getShellPilotCatalogKeys(langId)) {
      const value = getShellPilotTranslation(key, langId)
      assert.equal(typeof value, 'string', `${langId}.${key} must be a string`)
      assert.equal(value.trim(), value, `${langId}.${key} must not have surrounding whitespace`)
      assert.notEqual(value, '', `${langId}.${key} must not be empty`)
      assert.doesNotMatch(value, /\uFFFD|锟斤拷/)
    }
  }
})

test('resolves namespaced theme gallery copy in Simplified Chinese and English', async () => {
  const {
    getShellPilotTranslation,
    resolveShellPilotTranslation
  } = await import(moduleUrl)
  const expected = {
    themeFilterAll: ['全部', 'All'],
    themeFilterLight: ['浅色', 'Light'],
    themeFilterDark: ['深色', 'Dark'],
    themeReadonly: ['只读', 'Read-only'],
    themeViewDetails: ['查看主题', 'View theme'],
    themeApplied: ['已应用', 'Applied'],
    themeApplyFailed: [
      '主题应用失败，请检查当前主题设置',
      'Unable to apply theme. Check the current theme settings.'
    ],
    themeUpdateChannel: ['更新通道', 'Update channel'],
    themeContextMenu: ['上下文菜单', 'Context menu']
  }

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

test('catalog inspection does not expose mutable internals or inherited keys', async () => {
  const {
    getShellPilotCatalogKeys,
    getShellPilotTranslation
  } = await import(moduleUrl)
  const keys = getShellPilotCatalogKeys('zh_cn')

  assert.equal(Object.isFrozen(keys), true)
  assert.throws(() => keys.push('extra'), TypeError)
  assert.equal(getShellPilotTranslation('toString', 'zh_cn'), undefined)
  assert.deepEqual(getShellPilotCatalogKeys('__proto__'), [])
})

test('resolves through ShellPilot overrides, upstream locales, English, defaults, and key', async () => {
  const { resolveShellPilotTranslation } = await import(moduleUrl)

  assert.equal(
    resolveShellPilotTranslation('bookmarks', 'zh_cn', '上游书签', 'Upstream Bookmarks'),
    '书签'
  )
  assert.equal(
    resolveShellPilotTranslation('unknown', 'zh_cn', '当前语言文案', 'English fallback'),
    '当前语言文案'
  )
  assert.equal(
    resolveShellPilotTranslation('unknown', 'fr_fr', 'Texte français', 'English fallback'),
    'Texte français'
  )
  assert.equal(
    resolveShellPilotTranslation('settingsCenter', 'fr_fr', undefined, 'Upstream Settings'),
    'Settings Center'
  )
  assert.equal(
    resolveShellPilotTranslation('unknown', 'fr_fr', undefined, 'English fallback'),
    'English fallback'
  )
  assert.equal(
    resolveShellPilotTranslation('unknown', 'fr_fr', undefined, undefined, 'Readable default'),
    'Readable default'
  )
  assert.equal(
    resolveShellPilotTranslation('unknown', 'fr_fr'),
    'unknown'
  )
})

test('ignores blank or non-string candidates throughout the fallback chain', async () => {
  const { resolveShellPilotTranslation } = await import(moduleUrl)

  assert.equal(
    resolveShellPilotTranslation('unknown', 'fr_fr', '  ', 42, '\t'),
    'unknown'
  )
  assert.equal(
    resolveShellPilotTranslation('', 'fr_fr', undefined, undefined, undefined),
    ''
  )
})

test('basic entry resolves preview language and upstream English without changing getLang', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/entry/basic.js'
  ), 'utf8')

  assert.match(source, /window\.store\?\.previewLanguage \|\| window\.store\?\.config\.language \|\| 'zh_cn'/)
  assert.match(source, /const lang = window\.getLang\(langId\)/)
  assert.match(source, /const english = window\.getLang\('en_us'\)/)
  assert.match(source, /resolveShellPilotTranslation\([\s\S]*?_get\(lang, `\[\$\{txt\}\]`\)[\s\S]*?_get\(english, `\[\$\{txt\}\]`\)[\s\S]*?txt[\s\S]*?\)/)
  assert.match(source, /return window\.capitalizeFirstLetter\(value\)/)
})
