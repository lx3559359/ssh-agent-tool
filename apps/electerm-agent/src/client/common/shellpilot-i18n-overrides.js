const zhCnOverrides = {
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
