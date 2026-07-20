const maskedSecret = '••••••••'

function valueOf (item = {}, keys = []) {
  const key = keys.find(key => item[key] !== undefined && item[key] !== null && item[key] !== '')
  return key ? item[key] : ''
}

function hostOf (item = {}) {
  return valueOf(item, ['host', 'hostname', 'url', 'path'])
}

function usernameOf (item = {}) {
  return valueOf(item, ['username', 'user'])
}

function portOf (item = {}) {
  return item.port || ''
}

function connectionAddressOf (item = {}) {
  const host = hostOf(item)
  const username = usernameOf(item)
  const port = portOf(item)
  if (!host) {
    return ''
  }
  return `${username ? `${username}@` : ''}${host}${port ? `:${port}` : ''}`
}

function buildGroupParentMap (bookmarkGroups = []) {
  const parents = new Map()
  for (const group of bookmarkGroups || []) {
    for (const childId of group.bookmarkGroupIds || []) {
      parents.set(childId, group.id)
    }
  }
  return parents
}

function buildGroupPath (group, groupsById, parentsById) {
  const path = []
  const visited = new Set()
  let current = group
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    path.unshift(current.title || current.name || current.id)
    current = groupsById.get(parentsById.get(current.id))
  }
  return path.join('/')
}

function groupNameOf (item = {}, context = {}) {
  const bookmarkGroups = context.bookmarkGroups || []
  if (!item.id || !bookmarkGroups.length) {
    return ''
  }
  const group = bookmarkGroups.find(group => {
    return (group.bookmarkIds || []).includes(item.id)
  })
  if (!group) {
    return ''
  }
  const groupsById = new Map(bookmarkGroups.map(group => [group.id, group]))
  return buildGroupPath(group, groupsById, buildGroupParentMap(bookmarkGroups))
}

function hoppingCountOf (item = {}) {
  return Array.isArray(item.connectionHoppings) ? item.connectionHoppings.length : 0
}

export const connectionInfoFields = [
  { key: 'title', label: '名称', labelKey: 'shellpilotConnectionFieldName', pick: item => item.title || item.name || '' },
  { key: 'groupName', label: '所在分组', labelKey: 'shellpilotConnectionFieldGroup', pick: groupNameOf },
  { key: 'type', label: '类型', labelKey: 'shellpilotConnectionFieldType', pick: item => item.type || 'ssh' },
  { key: 'connectionAddress', label: '连接地址', labelKey: 'shellpilotConnectionFieldAddress', pick: connectionAddressOf },
  { key: 'host', label: 'IP / 主机', labelKey: 'shellpilotIpHost', pick: hostOf },
  { key: 'port', label: '端口', labelKey: 'shellpilotPort', pick: portOf },
  { key: 'username', label: '账号', labelKey: 'shellpilotAccount', pick: usernameOf },
  { key: 'authType', label: '认证方式', labelKey: 'shellpilotAuthenticationMethod', pick: item => item.authType || '' },
  { key: 'password', label: '密码', labelKey: 'shellpilotPassword', secret: true, pick: item => item.password || '' },
  { key: 'privateKey', label: '私钥', labelKey: 'shellpilotPrivateKey', secret: true, pick: item => item.privateKey || '' },
  { key: 'passphrase', label: '私钥口令', labelKey: 'shellpilotConnectionFieldPassphrase', secret: true, pick: item => item.passphrase || '' },
  { key: 'profileId', label: '凭据档案', labelKey: 'shellpilotCredentialProfile', pick: item => item.profile || item.profileId || item.sshProfile || '' },
  { key: 'hoppingCount', label: '跳板数量', labelKey: 'shellpilotConnectionFieldHops', pick: hoppingCountOf },
  { key: 'proxy', label: '代理', labelKey: 'shellpilotConnectionFieldProxy', pick: item => item.proxy || '' },
  { key: 'createdAt', label: '创建时间', labelKey: 'shellpilotConnectionFieldCreatedAt', pick: item => item.createdAt || item.createTime || '' },
  { key: 'updatedAt', label: '更新时间', labelKey: 'shellpilotConnectionFieldUpdatedAt', pick: item => item.updatedAt || item.updateTime || '' },
  { key: 'description', label: '备注', labelKey: 'shellpilotConnectionFieldNotes', pick: item => item.description || '' }
]

function fieldLabel (field, translate) {
  const translated = typeof translate === 'function' ? translate(field.labelKey) : ''
  return translated && translated !== field.labelKey ? translated : field.label
}

export function getConnectionInfoFields (bookmark = {}, {
  showSecrets = false,
  bookmarkGroups = [],
  translate
} = {}) {
  const context = { bookmarkGroups }
  return connectionInfoFields.map(field => {
    const rawValue = field.pick(bookmark, context)
    const hasSecret = field.secret && String(rawValue || '').trim() !== ''
    return {
      key: field.key,
      label: fieldLabel(field, translate),
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

export function createConnectionInventoryCsv (bookmarks = [], {
  headerType = 'key',
  bookmarkGroups = [],
  translate
} = {}) {
  const context = { bookmarkGroups }
  const headers = connectionInfoFields.map(field => {
    return headerType === 'label' ? fieldLabel(field, translate) : field.key
  })
  const rows = (bookmarks || []).map(item => {
    return connectionInfoFields.map(field => field.pick(item, context))
  })
  return [
    headers.map(csvCell).join(','),
    ...rows.map(row => row.map(csvCell).join(','))
  ].join('\n')
}
