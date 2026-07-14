const catalogs = Object.freeze({
  zh_cn: Object.freeze({
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
  }),
  en_us: Object.freeze({
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
  })
})

const catalogKeys = Object.freeze({
  zh_cn: Object.freeze(Object.keys(catalogs.zh_cn).sort()),
  en_us: Object.freeze(Object.keys(catalogs.en_us).sort())
})
const emptyCatalogKeys = Object.freeze([])

function hasOwn (object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function isMeaningfulString (value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function getShellPilotCatalogKeys (langId = 'zh_cn') {
  return hasOwn(catalogKeys, langId) ? catalogKeys[langId] : emptyCatalogKeys
}

export function getShellPilotTranslation (key, langId = 'zh_cn') {
  if (!hasOwn(catalogs, langId)) {
    return undefined
  }
  return hasOwn(catalogs[langId], key) ? catalogs[langId][key] : undefined
}

export function resolveShellPilotTranslation (key, langId = 'zh_cn', localeValue, englishValue, readableDefault) {
  const candidates = [
    getShellPilotTranslation(key, langId),
    localeValue,
    getShellPilotTranslation(key, 'en_us'),
    englishValue,
    readableDefault,
    key
  ]

  return candidates.find(isMeaningfulString) || ''
}
