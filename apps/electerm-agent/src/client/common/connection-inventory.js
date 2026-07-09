const maskedSecret = '••••••••'

export const connectionInfoFields = [
  { key: 'title', label: '名称', pick: item => item.title || item.name || '' },
  { key: 'type', label: '类型', pick: item => item.type || 'ssh' },
  { key: 'host', label: 'IP / 主机', pick: item => item.host || item.hostname || item.url || item.path || '' },
  { key: 'port', label: '端口', pick: item => item.port || '' },
  { key: 'username', label: '账号', pick: item => item.username || item.user || '' },
  { key: 'authType', label: '认证方式', pick: item => item.authType || '' },
  { key: 'password', label: '密码', secret: true, pick: item => item.password || '' },
  { key: 'privateKey', label: '私钥', secret: true, pick: item => item.privateKey || '' },
  { key: 'passphrase', label: '私钥口令', secret: true, pick: item => item.passphrase || '' },
  { key: 'profileId', label: '凭据档案', pick: item => item.profile || item.profileId || item.sshProfile || '' },
  { key: 'description', label: '备注', pick: item => item.description || '' }
]

export function getConnectionInfoFields (bookmark = {}, {
  showSecrets = false
} = {}) {
  return connectionInfoFields.map(field => {
    const rawValue = field.pick(bookmark)
    const hasSecret = field.secret && String(rawValue || '').trim() !== ''
    return {
      key: field.key,
      label: field.label,
      rawValue,
      value: hasSecret && !showSecrets ? maskedSecret : rawValue,
      secret: Boolean(field.secret),
      hasValue: String(rawValue ?? '').trim() !== ''
    }
  })
}

export function formatConnectionInfoText (bookmark = {}, options = {}) {
  return getConnectionInfoFields(bookmark, options)
    .filter(field => field.hasValue)
    .map(field => `${field.label}: ${field.value}`)
    .join('\n')
}

function csvCell (value) {
  const text = String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

export function createConnectionInventoryCsv (bookmarks = []) {
  const headers = connectionInfoFields.map(field => field.key)
  const rows = (bookmarks || []).map(item => {
    return connectionInfoFields.map(field => field.pick(item))
  })
  return [
    headers.map(csvCell).join(','),
    ...rows.map(row => row.map(csvCell).join(','))
  ].join('\n')
}
