const zhCnOverrides = {
  bookmarks: '书签',
  history: '历史',
  ssh: '终端',
  sftp: 'SFTP',
  widgets: '工具中心'
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
