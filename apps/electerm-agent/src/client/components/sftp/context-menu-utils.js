const defaultMenuItemHeight = 32
const defaultMinItemsBeforeSplit = 6

function currentMoreLabel () {
  if (typeof window !== 'undefined' && typeof window.translate === 'function') {
    const translated = window.translate('more')
    if (typeof translated === 'string' && translated.trim() && translated !== 'more') {
      return translated
    }
  }
  return 'More'
}

function compactMenuItems (items) {
  const result = []
  for (const item of items) {
    if (!item) continue
    if (item.type === 'divider' && (
      result.length === 0 || result.at(-1)?.type === 'divider'
    )) continue
    result.push(item)
  }
  if (result.at(-1)?.type === 'divider') result.pop()
  return result
}

export function groupSftpContextItems ({
  items = [],
  isRemote = false,
  isRealFile = false,
  translate = key => key
} = {}) {
  const take = func => items.find(item => item.func === func)
  const directFunctions = [
    'doEnterDirectory',
    'doTransferSelected',
    'gotoFolderInTerminal',
    'doTransfer',
    'transferOrEnterDirectory',
    'showInDefaultFileManager',
    'downloadFromBrowser',
    'askAiAboutFile',
    'editFile'
  ]
  const reserved = new Set([
    ...directFunctions,
    'del',
    'quickDelete',
    'doRename',
    'onCopyPath',
    'quickBackup',
    'restoreLatestBackup',
    'openSafetyCenter'
  ])
  const backup = [
    'quickBackup',
    'restoreLatestBackup',
    'openSafetyCenter'
  ].map(take).filter(Boolean)
  const more = items.filter(item => !reserved.has(item.func))
  return compactMenuItems([
    ...directFunctions.map(take).filter(Boolean),
    isRealFile ? { type: 'divider' } : null,
    take('del'),
    isRemote ? take('quickDelete') : null,
    isRealFile ? { type: 'divider' } : null,
    take('doRename'),
    take('onCopyPath'),
    backup.length
      ? {
          func: 'backupRecoveryMenu',
          icon: 'SaveOutlined',
          text: translate('shellpilotSftpBackupRecoveryMenu'),
          children: backup
        }
      : null,
    more.length
      ? {
          func: 'moreActionsMenu',
          icon: 'AppstoreOutlined',
          text: translate('shellpilotSftpMoreActionsMenu'),
          children: more
        }
      : null
  ])
}

export function splitOverflowMenu ({
  items = [],
  clientY,
  windowHeight,
  menuItemHeight = defaultMenuItemHeight,
  minItemsBeforeSplit = defaultMinItemsBeforeSplit,
  moreLabel = currentMoreLabel()
} = {}) {
  if (!clientY || !windowHeight || items.length <= minItemsBeforeSplit) {
    return items
  }

  const estimatedMenuHeight = items.length * menuItemHeight
  const availableHeight = windowHeight - clientY

  if (estimatedMenuHeight <= availableHeight) {
    return items
  }

  const splitIndex = Math.ceil(items.length / 2)
  return [
    ...items.slice(0, splitIndex),
    {
      key: 'more-submenu',
      label: moreLabel,
      popupClassName: 'shellpilot-context-menu',
      children: items.slice(splitIndex)
    }
  ]
}
