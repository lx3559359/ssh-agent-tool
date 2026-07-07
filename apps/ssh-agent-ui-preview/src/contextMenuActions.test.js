import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSftpContextActionModel, buildTerminalContextActionModel } from "./contextMenuActions.js";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function menuText(model) {
  return [
    model.title,
    ...(model.items || []).map((item) => item.label),
  ].filter(Boolean).join("\n");
}

function assertNoMojibake(text) {
  assert.doesNotMatch(text, /(?:缁堢|澶嶅|鍙戦|閲嶈|鎼滅|鏍囩|鏂囦欢|涓嬭浇|棰勮|鐩綍|閸|闁|鐎|瑜|娑撳|婢跺)/);
}

test("terminal context menu labels stay readable Chinese", () => {
  const model = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    session: { sessionId: "ssh-1" },
    tab: { pinned: false },
    tabCount: 2,
    tabIndex: 0,
    hasTerminalOutput: true,
    hasTerminalTextSelection: true,
    hasCommandDraft: true,
    hasSelectedCommandBlock: true,
    isCustomServer: true,
  });
  const text = menuText(model);

  assert.match(text, /基础操作/);
  assert.match(text, /复制选中内容|复制终端输出/);
  assert.match(text, /发送 Ctrl\+C \/ 中断/);
  assert.match(text, /重新连接并清屏/);
  assert.match(text, /搜索终端输出/);
  assert.match(text, /标签管理/);
  assertNoMojibake(text);
});

test("terminal context menu exposes output search as a visible basic action", () => {
  const withOutput = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    hasTerminalOutput: true,
  });
  const withoutOutput = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    hasTerminalOutput: false,
  });

  assert.equal(withOutput.items.find((item) => item.id === "search-terminal-output")?.label, "搜索终端输出");
  assert.equal(withOutput.items.find((item) => item.id === "search-terminal-output")?.disabled, false);
  assert.equal(withoutOutput.items.find((item) => item.id === "search-terminal-output")?.disabled, true);
});

test("terminal context menu exposes select all output as a visible basic action", () => {
  const withOutput = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    hasTerminalOutput: true,
  });
  const withoutOutput = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    hasTerminalOutput: false,
  });

  assert.equal(withOutput.items.find((item) => item.id === "select-all-output")?.label, "全选终端输出");
  assert.equal(withOutput.items.find((item) => item.id === "select-all-output")?.disabled, false);
  assert.equal(withoutOutput.items.find((item) => item.id === "select-all-output")?.disabled, true);
});

test("terminal context menu can save the current command draft as a snippet", () => {
  const withDraft = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    hasCommandDraft: true,
  });
  const withoutDraft = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    hasCommandDraft: false,
  });

  assert.equal(withDraft.items.find((item) => item.id === "save-command-snippet")?.label, "保存为命令片段");
  assert.equal(withDraft.items.find((item) => item.id === "save-command-snippet")?.disabled, false);
  assert.equal(withoutDraft.items.find((item) => item.id === "save-command-snippet")?.disabled, true);
});

test("terminal context menu annotates common SSH client shortcuts without changing labels", () => {
  const model = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    session: { sessionId: "ssh-1" },
    hasTerminalOutput: true,
    hasTerminalTextSelection: true,
    hasCommandDraft: true,
  });

  assert.deepEqual(
    Object.fromEntries(
      model.items
        .filter((item) => item.shortcut)
        .map((item) => [item.id, { label: item.label, shortcut: item.shortcut }]),
    ),
    {
      "copy-selection-or-output": { label: "复制选中内容", shortcut: "Ctrl+Shift+C / Ctrl+Insert" },
      "select-all-output": { label: "全选终端输出", shortcut: "Ctrl+Shift+A" },
      "paste-to-terminal": { label: "粘贴到 SSH", shortcut: "Ctrl+V / Shift+Insert" },
      "search-terminal-output": { label: "搜索终端输出", shortcut: "Ctrl+F" },
      "clear-terminal-output": { label: "清空终端显示", shortcut: "Ctrl+Shift+L" },
      "interrupt-terminal-command": { label: "发送 Ctrl+C / 中断", shortcut: "Ctrl+C" },
      "send-alt-left": { label: "发送 Alt+Left", shortcut: "Alt+Left" },
      "send-alt-right": { label: "发送 Alt+Right", shortcut: "Alt+Right" },
      "send-alt-b": { label: "发送 Alt+B", shortcut: "Alt+B" },
      "send-alt-f": { label: "发送 Alt+F", shortcut: "Alt+F" },
      "send-alt-d": { label: "发送 Alt+D", shortcut: "Alt+D" },
      "send-ctrl-left": { label: "发送 Ctrl+Left", shortcut: "Ctrl+Left" },
      "send-ctrl-right": { label: "发送 Ctrl+Right", shortcut: "Ctrl+Right" },
      "reconnect-terminal-session": { label: "重连 SSH 会话", shortcut: "Ctrl+Shift+R" },
      "disconnect-terminal-session": { label: "断开当前会话", shortcut: "Ctrl+Shift+D" },
      "export-terminal-output": { label: "导出终端记录", shortcut: "Ctrl+Shift+S" },
      "open-session-logs": { label: "查看会话日志", shortcut: "Ctrl+Shift+H" },
      "edit-terminal-connection": { label: "复制为自定义连接并编辑", shortcut: "Ctrl+Shift+I" },
    },
  );
});

test("terminal context menu shows the existing reconnect shortcut", () => {
  const model = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    session: { sessionId: "ssh-1" },
  });

  assert.equal(model.items.find((item) => item.id === "reconnect-terminal-session")?.shortcut, "Ctrl+Shift+R");
});

test("terminal context menu shows the existing disconnect shortcut", () => {
  const model = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    session: { sessionId: "ssh-1" },
  });

  assert.equal(model.items.find((item) => item.id === "disconnect-terminal-session")?.shortcut, "Ctrl+Shift+D");
});

test("terminal context menu exposes word navigation keys for connected SSH sessions", () => {
  const connected = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    session: { sessionId: "ssh-1" },
  });
  const disconnected = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    session: {},
  });

  for (const [id, shortcut] of [
    ["send-alt-left", "Alt+Left"],
    ["send-alt-right", "Alt+Right"],
    ["send-alt-b", "Alt+B"],
    ["send-alt-f", "Alt+F"],
    ["send-alt-d", "Alt+D"],
    ["send-ctrl-left", "Ctrl+Left"],
    ["send-ctrl-right", "Ctrl+Right"],
  ]) {
    const connectedItem = connected.items.find((item) => item.id === id);
    const disconnectedItem = disconnected.items.find((item) => item.id === id);
    assert.equal(connectedItem?.label, `发送 ${shortcut}`);
    assert.equal(connectedItem?.shortcut, shortcut);
    assert.equal(connectedItem?.disabled, false);
    assert.equal(disconnectedItem?.disabled, true);
  }
});

test("terminal context menu shows existing support tool shortcuts", () => {
  const model = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    session: { sessionId: "ssh-1" },
    isCustomServer: true,
  });

  assert.equal(model.items.find((item) => item.id === "open-session-logs")?.shortcut, "Ctrl+Shift+H");
  assert.equal(model.items.find((item) => item.id === "edit-terminal-connection")?.shortcut, "Ctrl+Shift+I");
});

test("terminal context menu exposes copy current line only for a right clicked output line", () => {
  const withLine = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    hasTerminalOutput: true,
    hasCurrentTerminalLine: true,
  });
  const withoutLine = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    hasTerminalOutput: true,
    hasCurrentTerminalLine: false,
  });

  assert.equal(withLine.items.find((item) => item.id === "copy-current-line")?.label, "复制当前行");
  assert.equal(withLine.items.find((item) => item.id === "copy-current-line")?.disabled, false);
  assert.equal(withoutLine.items.find((item) => item.id === "copy-current-line")?.disabled, true);
});

test("terminal context menu exposes reuse current command only for a command prompt line", () => {
  const withCommand = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    hasCurrentTerminalCommand: true,
  });
  const withoutCommand = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    hasCurrentTerminalCommand: false,
  });

  assert.equal(withCommand.items.find((item) => item.id === "use-current-line-command")?.label, "填入当前命令");
  assert.equal(withCommand.items.find((item) => item.id === "use-current-line-command")?.disabled, false);
  assert.equal(withoutCommand.items.find((item) => item.id === "use-current-line-command")?.disabled, true);
});

test("SFTP context menu labels stay readable Chinese", () => {
  const model = buildSftpContextActionModel({
    file: { name: "nginx.conf", type: "file" },
    path: "/etc/nginx",
    busy: false,
    hasAuth: true,
    hasPreview: true,
  });
  const text = menuText(model);

  assert.match(text, /SFTP 文件|nginx\.conf/);
  assert.match(text, /预览文件/);
  assert.match(text, /下载文件\/目录/);
  assert.match(text, /让 Agent 分析文件/);
  assert.match(text, /新建目录/);
  assertNoMojibake(text);
});

test("SFTP context menu allows downloading remote folders as zip files", () => {
  const model = buildSftpContextActionModel({
    file: { name: "releases", type: "folder", path: "/var/www/app/releases" },
    path: "/var/www/app",
    busy: false,
    hasAuth: true,
  });

  assert.equal(model.items.find((item) => item.id === "open-folder")?.disabled, false);
  assert.equal(model.items.find((item) => item.id === "download")?.label, "下载文件/目录");
  assert.equal(model.items.find((item) => item.id === "download")?.disabled, false);
  assert.equal(model.items.find((item) => item.id === "preview"), undefined);
});

test("SFTP context menu distinguishes current directory path from selected file path", () => {
  const directoryMenu = buildSftpContextActionModel({
    file: null,
    path: "/var/www/app",
    busy: false,
    hasAuth: true,
  });
  const fileMenu = buildSftpContextActionModel({
    file: { name: "nginx.conf", type: "file", path: "/etc/nginx/nginx.conf" },
    path: "/etc/nginx",
    busy: false,
    hasAuth: true,
  });

  assert.equal(directoryMenu.items.find((item) => item.id === "copy-sftp-path")?.label, "复制当前目录路径");
  assert.equal(directoryMenu.items.find((item) => item.id === "copy-sftp-path")?.disabled, false);
  assert.equal(fileMenu.items.find((item) => item.id === "copy-sftp-path")?.label, "复制远程路径");
});

test("SFTP blank-area context menu copies the current directory path", () => {
  const source = app.slice(app.indexOf("function openSftpContextMenu"), app.indexOf("async function exportToolLogs"));

  assert.match(source, /function openSftpContextMenu\(event,\s*file = selectedFile\)/);
  assert.match(source, /"copy-sftp-path":\s*\(\) => copySftpRemotePath\(file\)/);
  assert.match(app, /if \(!item\) return currentSftpPath\(\)/);
});
