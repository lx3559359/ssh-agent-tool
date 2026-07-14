function createEntry (entry) {
  return Object.freeze({
    ...entry,
    terms: Object.freeze(entry.terms)
  })
}

export const settingSearchEntries = Object.freeze([
  createEntry({
    tab: 'bookmarks',
    itemId: '',
    labelKey: 'bookmarks',
    terms: ['书签', '连接', '服务器', 'bookmark', 'bookmarks', 'connection', 'server', 'ssh', 'host']
  }),
  createEntry({
    tab: 'setting',
    itemId: 'setting-common',
    labelKey: 'generalSettings',
    terms: ['常规', '通用', '启动', '代理', '语言', '更新', 'general', 'common', 'startup', 'proxy', 'language', 'update', 'network', 'appearance']
  }),
  createEntry({
    tab: 'setting',
    itemId: 'setting-terminal',
    labelKey: 'terminalSettings',
    terms: ['终端', 'terminal', 'shell', 'font', 'cursor', 'scrollback', 'bell', 'renderer']
  }),
  createEntry({
    tab: 'setting',
    itemId: 'setting-ai',
    labelKey: 'aiAndModels',
    terms: ['人工智能', '模型', 'ai', 'model', 'mcp', 'agent', 'provider', 'api']
  }),
  createEntry({
    tab: 'setting',
    itemId: 'setting-sync',
    labelKey: 'syncAndBackup',
    terms: ['同步', '备份', 'sync', 'backup', 'webdav', 'gist', 'github', 'gitee', 'cloud']
  }),
  createEntry({
    tab: 'setting',
    itemId: 'setting-shortcuts',
    labelKey: 'keyboardShortcuts',
    terms: ['快捷键', '键盘', 'keyboard', 'shortcut', 'shortcuts', 'hotkey']
  }),
  createEntry({
    tab: 'setting',
    itemId: 'setting-passwords',
    labelKey: 'passwordManager',
    terms: ['密码', '密码管理', '凭据', 'password', 'passwords', 'manager', 'credential', 'credentials']
  }),
  createEntry({
    tab: 'terminalThemes',
    itemId: '',
    labelKey: 'themeLibrary',
    terms: ['主题', '配色', '外观', 'theme', 'terminal theme', 'palette', 'appearance', 'color', 'colors']
  }),
  createEntry({
    tab: 'quickCommands',
    itemId: '',
    labelKey: 'quickCommands',
    terms: ['快捷命令', '命令', 'quick command', 'quick commands', 'command', 'commands', 'snippet']
  }),
  createEntry({
    tab: 'profiles',
    itemId: '',
    labelKey: 'profiles',
    terms: ['配置档案', '连接模板', 'profile', 'profiles', 'connection template']
  }),
  createEntry({
    tab: 'widgets',
    itemId: '',
    labelKey: 'widgets',
    terms: ['工具', '工具中心', '小组件', 'widget', 'widgets', 'tool', 'tools', 'tool center']
  })
])

function normalize (value) {
  return String(value ?? '').trim().toLowerCase()
}

export function searchSettings (query) {
  const normalized = normalize(query)
  if (!normalized) {
    return []
  }
  const tokens = normalized.split(/\s+/)
  return settingSearchEntries.filter(entry => {
    const terms = entry.terms.join(' ').toLowerCase()
    return tokens.every(token => terms.includes(token))
  })
}
