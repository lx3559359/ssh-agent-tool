import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'

function format (translate, key, values = {}) {
  return formatShellPilotTranslation(translate, key, values)
}

export function buildSftpFileContextItems (options = {}) {
  const {
    file = {},
    selectedFiles = new Set(),
    tab = {},
    isWin = false,
    isWebApp = false,
    isFtp = false,
    canPaste = false,
    hasRecovery = false,
    maxEditFileSize = 0,
    shortcutModifier = 'ctrl',
    translate = key => key
  } = options
  const {
    type,
    isDirectory,
    size,
    id,
    isEmpty,
    isParent
  } = file
  const isRealFile = !isEmpty && !isParent
  const hasHost = Boolean(tab.host)
  const { enableSsh } = tab
  const isLocal = type === 'local'
  const isRemote = type === 'remote'
  const transferText = translate(isLocal ? 'upload' : 'download')
  const iconType = isLocal ? 'CloudUploadOutlined' : 'CloudDownloadOutlined'
  const selectedCount = selectedFiles.size
  const selected = Boolean(id && selectedCount > 1 && selectedFiles.has(id))
  const deleteText = isRemote
    ? format(
      translate,
      selected ? 'shellpilotSftpSafeDeleteSelected' : 'shellpilotSftpSafeDeleteRecoverable',
      { count: selectedCount }
    )
    : (selected
        ? `${translate('del')}:${translate('selected')}(${selectedCount})`
        : translate('del'))
  const showEdit = !isDirectory && id && size < maxEditFileSize
  const result = []

  if (isDirectory && isRealFile) {
    result.push({ func: 'doEnterDirectory', icon: 'EnterOutlined', text: translate('enter') })
  }
  if (selected && hasHost) {
    result.push({
      func: 'doTransferSelected',
      icon: iconType,
      text: `${translate('selected')}(${selectedCount})`
    })
  }
  if (
    isDirectory &&
    ((hasHost && enableSsh !== false && isRemote) || (isLocal && !hasHost)) &&
    !isFtp
  ) {
    result.push({
      func: 'gotoFolderInTerminal',
      icon: 'CodeOutlined',
      text: translate('gotoFolderInTerminal')
    })
  }
  if (isRealFile && hasHost && !selected) {
    result.push({ func: 'doTransfer', icon: iconType, text: transferText })
  }
  if (!isDirectory && isRealFile && isLocal) {
    result.push({
      func: 'transferOrEnterDirectory',
      icon: 'ArrowRightOutlined',
      text: translate('open')
    })
  }
  if (isRealFile && isLocal) {
    result.push({
      func: 'showInDefaultFileManager',
      icon: 'ContainerOutlined',
      text: translate('showInDefaultFileMananger')
    })
  }
  if (isLocal && isRealFile && isWebApp) {
    result.push({
      func: 'downloadFromBrowser',
      icon: 'DownloadOutlined',
      text: translate('downloadFromBrowser')
    })
  }
  if (!isDirectory && isRealFile && id) {
    result.push({
      func: 'askAiAboutFile',
      icon: 'CodeOutlined',
      text: format(translate, 'shellpilotSftpAnalyzeFileWithAi')
    })
  }
  if (isRemote && isRealFile) {
    result.push({
      func: 'quickBackup',
      icon: 'SaveOutlined',
      text: format(
        translate,
        selected ? 'shellpilotSftpBackupSelected' : 'shellpilotSftpQuickBackup',
        { count: selectedCount }
      )
    })
    result.push({
      func: 'restoreLatestBackup',
      icon: 'RetweetOutlined',
      text: format(translate, 'shellpilotSftpRestoreLatestBackup'),
      disabled: !hasRecovery
    })
    result.push({
      func: 'openSafetyCenter',
      icon: 'AppstoreOutlined',
      text: format(translate, 'shellpilotSftpSafetyCenter')
    })
  }
  if (showEdit) {
    result.push({ func: 'editFile', icon: 'EditOutlined', text: translate('edit') })
  }
  if (isRealFile) {
    result.push({
      func: 'del',
      icon: 'CloseCircleOutlined',
      text: deleteText,
      requireConfirm: true
    })
    result.push({
      func: 'onCopy',
      icon: 'CopyOutlined',
      text: translate('copy'),
      subText: `${shortcutModifier}+c`
    })
    result.push({
      func: 'onCut',
      icon: 'FileExcelOutlined',
      text: translate('cut'),
      subText: `${shortcutModifier}+x`
    })
  }
  result.push({
    func: 'onPaste',
    icon: 'CopyOutlined',
    text: translate('paste'),
    disabled: !canPaste,
    subText: `${shortcutModifier}+v`
  })
  if (isRealFile) {
    result.push({ func: 'doRename', icon: 'EditOutlined', text: translate('rename') })
    result.push({ func: 'onCopyPath', icon: 'CopyOutlined', text: translate('copyFilePath') })
  }
  if (enableSsh !== false || isLocal) {
    result.push({ func: 'newFile', icon: 'FileAddOutlined', text: translate('newFile') })
    result.push({ func: 'newDirectory', icon: 'FolderAddOutlined', text: translate('newFolder') })
  }
  result.push({
    func: 'selectAll',
    icon: 'CheckSquareOutlined',
    text: translate('selectAll'),
    subText: `${shortcutModifier}+a`
  })
  result.push({ func: 'refresh', icon: 'ReloadOutlined', text: translate('refresh') })
  if (isRealFile && (isRemote || !isWin) && !isFtp) {
    result.push({
      func: 'editPermission',
      icon: 'LockOutlined',
      text: translate('editPermission')
    })
  }
  if (isRealFile) {
    result.push({ func: 'showInfo', icon: 'InfoCircleOutlined', text: translate('info') })
  }
  return result
}
