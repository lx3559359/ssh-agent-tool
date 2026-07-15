import { compactMenuGroups } from '../common/context-menu-items.js'

const defaultShortcuts = {}

function item ({
  key,
  labelKey,
  labelText,
  iconKey,
  disabled,
  danger,
  extra
}) {
  return {
    key,
    labelKey,
    labelText,
    iconKey,
    disabled: Boolean(disabled),
    ...(danger ? { danger: true } : {}),
    extra
  }
}

export function buildTerminalContextMenuItems ({
  hasSelection = false,
  recording = false,
  currentPath = '',
  shortcuts = defaultShortcuts,
  isSerial = false,
  fontSizeChanged = false
} = {}) {
  const items = [
    item({
      key: 'onCopy',
      iconKey: 'CopyOutlined',
      labelKey: 'copy',
      disabled: !hasSelection,
      extra: shortcuts.copy
    }),
    item({
      key: 'onPaste',
      iconKey: 'SwitcherOutlined',
      labelKey: 'paste',
      extra: shortcuts.paste
    }),
    item({
      key: 'onPasteSelected',
      iconKey: 'SwitcherOutlined',
      labelKey: 'pasteSelected',
      disabled: !hasSelection
    }),
    item({
      key: 'onSelectAll',
      iconKey: 'CheckSquareOutlined',
      labelKey: 'selectall',
      extra: shortcuts.selectAll
    }),
    item({
      key: 'explainWithAi',
      iconKey: 'AIIcon',
      labelKey: 'explainWithAi',
      disabled: !hasSelection
    }),
    item({
      key: 'analyzeTerminalWithAi',
      iconKey: 'AIIcon',
      labelKey: 'shellpilotTerminalAnalyzeWithAi'
    }),
    item({
      key: 'copyCurrentPath',
      iconKey: 'CopyOutlined',
      labelKey: 'shellpilotTerminalCopyCurrentPath',
      disabled: !currentPath
    }),
    item({
      key: 'onClear',
      iconKey: 'ReloadOutlined',
      labelKey: 'clear',
      extra: shortcuts.clear
    }),
    item({
      key: 'onZoomInTerminal',
      iconKey: 'PlusCircleOutlined',
      labelKey: 'shellpilotTerminalZoomIn'
    }),
    item({
      key: 'onZoomOutTerminal',
      iconKey: 'MinusCircleOutlined',
      labelKey: 'shellpilotTerminalZoomOut'
    }),
    item({
      key: 'onResetTerminalFontSize',
      iconKey: 'AimOutlined',
      labelKey: 'shellpilotTerminalZoomReset',
      disabled: !fontSizeChanged
    }),
    item({
      key: 'onReconnect',
      iconKey: 'RetweetOutlined',
      labelKey: 'reload'
    }),
    item({
      key: 'onDisconnect',
      iconKey: 'CloseCircleOutlined',
      labelKey: 'disconnect',
      danger: true
    }),
    item({
      key: 'toggleSearch',
      iconKey: 'SearchOutlined',
      labelKey: 'search',
      extra: shortcuts.search
    }),
    item({
      key: 'onSaveTerminalLog',
      iconKey: 'SaveOutlined',
      labelKey: 'saveTerminalLogToFile'
    }),
    item({
      key: 'onOpenSessionLogFolder',
      iconKey: 'FolderOpenOutlined',
      labelKey: 'shellpilotTerminalOpenLogFolder'
    }),
    item({
      key: recording ? 'onStopRecord' : 'onRecord',
      iconKey: recording ? 'StopOutlined' : 'PlayCircleFilled',
      labelKey: recording ? 'stopRecord' : 'record'
    })
  ]

  const groups = [
    items.slice(0, 4),
    items.slice(4, 7),
    items.slice(7, 11),
    items.slice(11, 13),
    items.slice(13)
  ]

  if (isSerial) {
    groups.push([
      item({
        key: 'onXmodemSend',
        iconKey: 'CloudUploadOutlined',
        labelKey: 'shellpilotXmodemSend'
      }),
      item({
        key: 'onXmodemReceive',
        iconKey: 'CloudDownloadOutlined',
        labelKey: 'shellpilotXmodemReceive'
      })
    ])
  }

  return compactMenuGroups(groups)
}
