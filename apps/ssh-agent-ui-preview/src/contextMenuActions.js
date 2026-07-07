export function buildTerminalContextActionModel(options = {}) {
  const serverName = String(options.serverName || "").trim();
  const session = options.session && typeof options.session === "object" ? options.session : {};
  const tab = options.tab && typeof options.tab === "object" ? options.tab : {};
  const tabIndex = Number.isFinite(Number(options.tabIndex)) ? Number(options.tabIndex) : 0;
  const tabCount = Math.max(0, Number(options.tabCount || 0));
  const isConnected = Boolean(session.sessionId);
  const isBusy = Boolean(session.busy);
  const isRecoverable = Boolean(session.lastError || session.disconnectedAt);
  const isPinned = Boolean(tab.pinned);
  const hasTerminalOutput = Boolean(options.hasTerminalOutput);
  const hasTerminalTextSelection = Boolean(options.hasTerminalTextSelection);
  const hasCurrentTerminalLine = Boolean(options.hasCurrentTerminalLine);
  const hasCurrentTerminalCommand = Boolean(options.hasCurrentTerminalCommand);
  const hasCommandDraft = Boolean(options.hasCommandDraft);
  const hasSelectedCommandBlock = Boolean(options.hasSelectedCommandBlock);
  const hasClosedTabs = Boolean(options.hasClosedTabs);
  const isCustomServer = Boolean(options.isCustomServer);
  const connectionActionLabel = isConnected || isRecoverable ? "重连 SSH 会话" : "连接 SSH 会话";

  return compactMenuModel({
    title: serverName || "SSH 终端",
    items: [
      section("section-terminal-basic", "基础操作"),
      { id: "copy-selection-or-output", label: hasTerminalTextSelection ? "复制选中内容" : "复制终端输出", shortcut: "Ctrl+Shift+C / Ctrl+Insert", disabled: !hasTerminalOutput && !hasTerminalTextSelection },
      { id: "select-all-output", label: "全选终端输出", shortcut: "Ctrl+Shift+A", disabled: !hasTerminalOutput },
      { id: "copy-current-line", label: "复制当前行", disabled: !hasCurrentTerminalLine },
      { id: "use-current-line-command", label: "填入当前命令", disabled: !hasCurrentTerminalCommand },
      { id: "copy-command-block", label: "复制当前命令块", disabled: !hasSelectedCommandBlock },
      { id: "save-command-snippet", label: "保存为命令片段", disabled: !hasCommandDraft },
      { id: "paste-to-terminal", label: isConnected ? "粘贴到 SSH" : "粘贴到命令行", shortcut: "Ctrl+V / Shift+Insert", disabled: !isConnected && !hasCommandDraft },
      { id: "search-terminal-output", label: "搜索终端输出", shortcut: "Ctrl+F", disabled: !hasTerminalOutput },
      { id: "clear-terminal-output", label: "清空终端显示", shortcut: "Ctrl+Shift+L", disabled: !hasTerminalOutput },
      separator("separator-runtime"),
      section("section-terminal-session", "会话控制"),
      { id: "interrupt-terminal-command", label: "发送 Ctrl+C / 中断", shortcut: "Ctrl+C", disabled: !isConnected },
      { id: "send-alt-left", label: "发送 Alt+Left", shortcut: "Alt+Left", disabled: !isConnected },
      { id: "send-alt-right", label: "发送 Alt+Right", shortcut: "Alt+Right", disabled: !isConnected },
      { id: "send-alt-b", label: "发送 Alt+B", shortcut: "Alt+B", disabled: !isConnected },
      { id: "send-alt-f", label: "发送 Alt+F", shortcut: "Alt+F", disabled: !isConnected },
      { id: "send-alt-d", label: "发送 Alt+D", shortcut: "Alt+D", disabled: !isConnected },
      { id: "send-ctrl-left", label: "发送 Ctrl+Left", shortcut: "Ctrl+Left", disabled: !isConnected },
      { id: "send-ctrl-right", label: "发送 Ctrl+Right", shortcut: "Ctrl+Right", disabled: !isConnected },
      { id: "check-terminal-session-health", label: "检查 SSH 会话状态", disabled: !isConnected },
      { id: "reconnect-terminal-session", label: connectionActionLabel, shortcut: "Ctrl+Shift+R", disabled: isBusy },
      { id: "reconnect-and-clear-session", label: "重新连接并清屏", disabled: isBusy || (!isConnected && !isRecoverable) },
      { id: "disconnect-terminal-session", label: isBusy ? "强制断开会话" : "断开当前会话", shortcut: "Ctrl+Shift+D", disabled: !isConnected },
      separator("separator-tabs"),
      section("section-terminal-tabs", "标签管理"),
      { id: "duplicate-terminal-tab", label: "打开同主机新标签" },
      { id: "rename-terminal-tab", label: "重命名标签" },
      { id: "toggle-pin-terminal-tab", label: isPinned ? "取消固定标签" : "固定标签" },
      { id: "move-terminal-tab-left", label: "标签左移", disabled: tabIndex <= 0 },
      { id: "move-terminal-tab-right", label: "标签右移", disabled: tabIndex >= tabCount - 1 },
      { id: "close-current-terminal-tab", label: "关闭当前标签", disabled: isPinned },
      { id: "reopen-closed-terminal-tab", label: "恢复关闭的标签", disabled: !hasClosedTabs },
      { id: "close-other-terminal-tabs", label: "关闭其他标签", disabled: tabCount <= 1 },
      { id: "close-right-terminal-tabs", label: "关闭右侧标签", disabled: tabIndex >= tabCount - 1 },
      separator("separator-tools"),
      section("section-terminal-tools", "工具"),
      { id: "send-command-to-agent", label: "把当前上下文交给 Agent", disabled: !hasTerminalOutput && !hasCommandDraft },
      { id: "export-terminal-output", label: "导出终端记录", shortcut: "Ctrl+Shift+S", disabled: !hasTerminalOutput },
      { id: "open-session-logs", label: "查看会话日志", shortcut: "Ctrl+Shift+H" },
      { id: "edit-terminal-connection", label: isCustomServer ? "编辑当前连接" : "复制为自定义连接并编辑", shortcut: "Ctrl+Shift+I" },
      { id: "delete-terminal-server", label: isCustomServer ? "删除服务器" : "从列表隐藏", danger: true },
    ],
  });
}

export function buildSftpContextActionModel(options = {}) {
  const file = options.file && typeof options.file === "object" ? options.file : null;
  const path = String(options.path || "").trim();
  const fileName = String(file?.name || file?.path || "").trim();
  const isFolder = file?.type === "folder";
  const busy = Boolean(options.busy);
  const hasAuth = options.hasAuth !== false;
  const disabled = busy || !hasAuth;
  const hasPreview = Boolean(options.hasPreview);

  return compactMenuModel({
    title: fileName || path || "SFTP 文件",
    items: [
      file && isFolder ? { id: "open-folder", label: "打开目录", disabled } : null,
      file && !isFolder ? { id: "preview", label: "预览文件", disabled } : null,
      file ? { id: "download", label: "下载文件/目录", disabled } : null,
      { id: "copy-sftp-path", label: file ? "复制远程路径" : "复制当前目录路径", disabled: !file && !path },
      file && !isFolder ? { id: "agent-analyze-sftp-preview", label: "让 Agent 分析文件", disabled: disabled || !hasPreview } : null,
      file ? { id: "open-containing-folder", label: "定位所在目录", disabled } : null,
      separator("separator-directory"),
      { id: "parent", label: "上级目录", disabled },
      { id: "refresh", label: "刷新目录", disabled },
      { id: "upload", label: "上传文件", disabled },
      { id: "create-file", label: "新建文件", disabled },
      { id: "mkdir", label: "新建目录", disabled },
      file ? separator("separator-edit") : null,
      file ? { id: "rename", label: "重命名", disabled } : null,
      file ? { id: "delete", label: "删除", danger: true, disabled } : null,
    ],
  });
}

export function mergeContextMenuItems(...sections) {
  const seen = new Set();
  const merged = [];

  for (const sectionItems of sections) {
    for (const item of Array.isArray(sectionItems) ? sectionItems : []) {
      if (!item) continue;
      if (item.separator) {
        if (merged.length && !merged[merged.length - 1].separator) merged.push(item);
        continue;
      }
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }

  while (merged.length && merged[merged.length - 1].separator) {
    merged.pop();
  }

  return merged;
}

function separator(id) {
  return { id, separator: true };
}

function section(id, label) {
  return { id, label, section: true };
}

function compactMenuModel(model) {
  return {
    ...model,
    items: (Array.isArray(model.items) ? model.items : []).filter(Boolean),
  };
}
