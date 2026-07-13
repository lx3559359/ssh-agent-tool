const zhCnOverrides = {
  bookmarks: '书签',
  history: '历史',
  ssh: '终端',
  sftp: 'SFTP',
  widgets: '工具中心',
  terminalSafetyProtection: 'SSH 终端安全保护',
  terminalSafetyProtectionHelp: '仅在已有可靠 Shell Integration 时于 Enter 检查完整命令；不会为安全保护向 forced command 或 TUI 自动注入脚本。'
}

export function getShellPilotTranslation (key, langId = 'zh_cn') {
  if (langId !== 'zh_cn') {
    return undefined
  }
  return zhCnOverrides[key]
}

export function resolveShellPilotTranslation (key, langId = 'zh_cn', localeValue) {
  const override = getShellPilotTranslation(key, langId)
  return override || localeValue
}
