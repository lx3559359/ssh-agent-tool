const defaultShortcuts = {}

function item ({
  key,
  labelKey,
  labelText,
  iconKey,
  disabled,
  extra
}) {
  return {
    key,
    labelKey,
    labelText,
    iconKey,
    disabled: Boolean(disabled),
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
      labelText: 'AI 分析当前终端'
    }),
    item({
      key: 'copyCurrentPath',
      iconKey: 'CopyOutlined',
      labelText: '复制当前路径',
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
      labelText: '放大终端字体'
    }),
    item({
      key: 'onZoomOutTerminal',
      iconKey: 'MinusCircleOutlined',
      labelText: '缩小终端字体'
    }),
    item({
      key: 'onResetTerminalFontSize',
      iconKey: 'AimOutlined',
      labelText: '重置终端字体',
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
      labelKey: 'disconnect'
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
      key: recording ? 'onStopRecord' : 'onRecord',
      iconKey: recording ? 'StopOutlined' : 'PlayCircleFilled',
      labelKey: recording ? 'stopRecord' : 'record'
    })
  ]

  if (isSerial) {
    items.push(
      { type: 'divider' },
      item({
        key: 'onXmodemSend',
        iconKey: 'CloudUploadOutlined',
        labelText: 'XMODEM 发送'
      }),
      item({
        key: 'onXmodemReceive',
        iconKey: 'CloudDownloadOutlined',
        labelText: 'XMODEM 接收'
      })
    )
  }

  return items
}
