import { compactMenuGroups } from '../common/context-menu-items.js'

const defaultGroupId = 'default'
const englishLabels = Object.freeze({
  shellpilotBookmarkOpenAll: 'Open All',
  shellpilotBookmarkEditGroup: 'Edit Group',
  shellpilotBookmarkAddSubgroup: 'Add Subgroup',
  shellpilotBookmarkMoveGroup: 'Move Group',
  shellpilotBookmarkDeleteGroup: 'Delete Group',
  shellpilotBookmarkOpenConnection: 'Open Connection',
  shellpilotBookmarkTestConnection: 'Test Connection',
  shellpilotBookmarkEditConnection: 'Edit Connection',
  shellpilotBookmarkViewConnectionInfo: 'View Connection Information',
  shellpilotBookmarkExportConnection: 'Export Current Connection',
  shellpilotBookmarkCopyConnectionInfo: 'Copy Connection Information',
  shellpilotBookmarkCopySshCommand: 'Copy SSH Command',
  shellpilotBookmarkDeleteConnection: 'Delete Connection',
  shellpilotBookmarkUnfavorite: 'Remove from Favorites',
  shellpilotBookmarkFavorite: 'Add to Favorites',
  shellpilotBookmarkDuplicateConnection: 'Duplicate Connection',
  shellpilotBookmarkMoveToGroup: 'Move to Group',
  shellpilotBookmarkFieldName: 'Name',
  shellpilotBookmarkFieldType: 'Type',
  shellpilotBookmarkFieldHost: 'Host',
  shellpilotBookmarkFieldPort: 'Port',
  shellpilotBookmarkFieldUser: 'User',
  shellpilotBookmarkFieldLabels: 'Labels',
  shellpilotBookmarkFieldNotes: 'Notes'
})

function translateLabel (key, translate) {
  const value = typeof translate === 'function' ? translate(key) : ''
  return typeof value === 'string' && value.trim() && value !== key
    ? value
    : englishLabels[key] || key
}

function menuItem (key, labelKey, translate, extra = {}) {
  return {
    key,
    labelKey,
    label: translateLabel(labelKey, translate),
    ...extra
  }
}

function isDefaultGroup (item) {
  return item?.id === defaultGroupId
}

function shellArg (value) {
  const text = String(value ?? '').trim()
  if (!text) {
    return ''
  }
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) {
    return text
  }
  return `"${text.replace(/(["\\])/g, '\\$1')}"`
}

export function formatBookmarkSshCommand (bookmark = {}) {
  const type = bookmark.type || 'ssh'
  if (type !== 'ssh') {
    return ''
  }
  const host = bookmark.host || bookmark.hostname || bookmark.url || bookmark.path
  if (!host) {
    return ''
  }
  const username = bookmark.username || bookmark.user
  const target = username ? `${username}@${host}` : host
  const parts = ['ssh']
  if (bookmark.privateKey) {
    parts.push('-i', shellArg(bookmark.privateKey))
  }
  if (bookmark.port) {
    parts.push('-p', String(bookmark.port))
  }
  parts.push(shellArg(target))
  return parts.join(' ')
}

export function formatBookmarkPublicInfo (bookmark = {}, translate) {
  const lines = [
    ['shellpilotBookmarkFieldName', bookmark.title],
    ['shellpilotBookmarkFieldType', bookmark.type],
    ['shellpilotBookmarkFieldHost', bookmark.host || bookmark.hostname || bookmark.url || bookmark.path],
    ['shellpilotBookmarkFieldPort', bookmark.port],
    ['shellpilotBookmarkFieldUser', bookmark.username || bookmark.user],
    ['shellpilotBookmarkFieldLabels', [...(bookmark.labels || []), ...(bookmark.tags || [])].join(', ')],
    ['shellpilotBookmarkFieldNotes', bookmark.description]
  ]
  return lines
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([key, value]) => `${translateLabel(key, translate)}: ${value}`)
    .join('\n')
}

export function buildBookmarkContextMenuItems ({
  item,
  isGroup,
  staticList,
  translate
}) {
  if (!item) {
    return []
  }

  if (isGroup) {
    if (staticList) {
      return compactMenuGroups([[
        menuItem('openAll', 'shellpilotBookmarkOpenAll', translate)
      ]])
    }
    if (!isDefaultGroup(item)) {
      return compactMenuGroups([
        [menuItem('openAll', 'shellpilotBookmarkOpenAll', translate)],
        [
          menuItem('edit', 'shellpilotBookmarkEditGroup', translate),
          menuItem('addSubCat', 'shellpilotBookmarkAddSubgroup', translate),
          menuItem('move', 'shellpilotBookmarkMoveGroup', translate)
        ],
        [menuItem('delete', 'shellpilotBookmarkDeleteGroup', translate, { danger: true })]
      ])
    }
    return []
  }

  const connectionInfo = [
    menuItem('viewConnectionInfo', 'shellpilotBookmarkViewConnectionInfo', translate),
    menuItem('exportConnection', 'shellpilotBookmarkExportConnection', translate),
    menuItem('copyPublicInfo', 'shellpilotBookmarkCopyConnectionInfo', translate),
    menuItem('copySshCommand', 'shellpilotBookmarkCopySshCommand', translate, {
      disabled: item.type && item.type !== 'ssh'
    })
  ]
  const openActions = [
    menuItem('open', 'shellpilotBookmarkOpenConnection', translate),
    menuItem('testConnection', 'shellpilotBookmarkTestConnection', translate)
  ]
  const removeAction = [
    menuItem('delete', 'shellpilotBookmarkDeleteConnection', translate, { danger: true })
  ]

  if (staticList) {
    return compactMenuGroups([
      openActions,
      [menuItem('edit', 'shellpilotBookmarkEditConnection', translate)],
      connectionInfo,
      removeAction
    ])
  }

  return compactMenuGroups([
    openActions,
    [
      menuItem('edit', 'shellpilotBookmarkEditConnection', translate),
      menuItem(
        'toggleFavorite',
        item.favorite ? 'shellpilotBookmarkUnfavorite' : 'shellpilotBookmarkFavorite',
        translate
      ),
      menuItem('duplicate', 'shellpilotBookmarkDuplicateConnection', translate),
      menuItem('move', 'shellpilotBookmarkMoveToGroup', translate)
    ],
    connectionInfo,
    removeAction
  ])
}
