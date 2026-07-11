const defaultGroupId = 'default'

function label (text) {
  return text
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
export function formatBookmarkPublicInfo (bookmark = {}) {
  const lines = [
    ['名称', bookmark.title],
    ['类型', bookmark.type],
    ['主机', bookmark.host || bookmark.hostname || bookmark.url || bookmark.path],
    ['端口', bookmark.port],
    ['用户', bookmark.username || bookmark.user],
    ['标签', [...(bookmark.labels || []), ...(bookmark.tags || [])].join(', ')],
    ['备注', bookmark.description]
  ]
  return lines
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
}

export function buildBookmarkContextMenuItems ({
  item,
  isGroup,
  staticList
}) {
  if (!item) {
    return []
  }

  if (isGroup) {
    const items = []
    if (staticList) {
      items.push({
        key: 'openAll',
        label: label('全部打开')
      })
    } else if (!isDefaultGroup(item)) {
      items.push(
        {
          key: 'openAll',
          label: label('全部打开')
        },
        {
          key: 'edit',
          label: label('编辑分组')
        },
        {
          key: 'addSubCat',
          label: label('新建子分组')
        },
        {
          key: 'move',
          label: label('移动分组')
        },
        {
          key: 'delete',
          label: label('删除分组'),
          danger: true
        }
      )
    }
    return items
  }

  if (staticList) {
    return [
      {
        key: 'open',
        label: label('打开连接')
      },
      {
        key: 'testConnection',
        label: label('测试连接')
      },
      {
        key: 'edit',
        label: label('编辑连接')
      },
      {
        key: 'viewConnectionInfo',
        label: label('查看连接信息')
      },
      {
        key: 'exportConnection',
        label: label('导出当前连接')
      },
      {
        key: 'copyPublicInfo',
        label: label('复制连接信息')
      },
      {
        key: 'copySshCommand',
        label: label('复制 SSH 命令'),
        disabled: item.type && item.type !== 'ssh'
      },
      {
        key: 'delete',
        label: label('删除连接'),
        danger: true
      }
    ]
  }

  return [
    {
      key: 'open',
      label: label('打开连接')
    },
    {
      key: 'testConnection',
      label: label('测试连接')
    },
    {
      key: 'edit',
      label: label('编辑连接')
    },
    {
      key: 'toggleFavorite',
      label: item.favorite ? label('取消收藏') : label('收藏')
    },
    {
      key: 'duplicate',
      label: label('复制连接')
    },
    {
      key: 'move',
      label: label('移动到分组')
    },
    {
      key: 'viewConnectionInfo',
      label: label('查看连接信息')
    },
    {
      key: 'exportConnection',
      label: label('导出当前连接')
    },
    {
      key: 'copyPublicInfo',
      label: label('复制连接信息')
    },
    {
      key: 'copySshCommand',
      label: label('复制 SSH 命令'),
      disabled: item.type && item.type !== 'ssh'
    },
    {
      key: 'delete',
      label: label('删除连接'),
      danger: true
    }
  ]
}
