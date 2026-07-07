import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildTerminalContextActionModel } from "./contextMenuActions.js";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function terminalContextMenuSource() {
  const start = app.indexOf("function openTerminalContextMenu");
  const end = app.indexOf("function openTerminalTabContextMenu", start);
  assert.notEqual(start, -1, "openTerminalContextMenu should exist");
  assert.notEqual(end, -1, "openTerminalTabContextMenu should follow openTerminalContextMenu");
  return app.slice(start, end);
}

function functionSource(name, nextName) {
  const start = app.indexOf(`function ${name}`);
  const end = app.indexOf(`function ${nextName}`, start);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return app.slice(start, end);
}

function constantSource(name, nextMarker) {
  const start = app.indexOf(`const ${name}`);
  const end = app.indexOf(nextMarker, start);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextMarker} should follow ${name}`);
  return app.slice(start, end);
}

test("terminal visible control buttons include common clear and word editing keys", () => {
  const source = constantSource("TERMINAL_INTERACTIVE_CONTROL_BUTTONS", "function isConnectedShellFlowControlKey");

  assert.match(source, /\{\s*label:\s*"Ctrl\+L",\s*text:\s*"\\x0c",\s*title:\s*"发送 Ctrl\+L，清屏"\s*\}/);
  assert.match(source, /\{\s*label:\s*"Ctrl\+W",\s*text:\s*"\\x17",\s*title:\s*"发送 Ctrl\+W，删除前一个单词"\s*\}/);
});

test("terminal visible control buttons expose Ctrl+Y yank", () => {
  const source = constantSource("TERMINAL_INTERACTIVE_CONTROL_BUTTONS", "function isConnectedShellFlowControlKey");

  assert.match(source, /label:\s*"Ctrl\+Y",\s*text:\s*"\\x19"/);
});

test("terminal visible control buttons expose Ctrl+G cancel control", () => {
  const source = constantSource("TERMINAL_INTERACTIVE_CONTROL_BUTTONS", "function isConnectedShellFlowControlKey");

  assert.match(source, /label:\s*"Ctrl\+G",\s*text:\s*"\\x07"/);
});

test("terminal visible control buttons expose Ctrl+B and Ctrl+F cursor controls", () => {
  const source = constantSource("TERMINAL_INTERACTIVE_CONTROL_BUTTONS", "function isConnectedShellFlowControlKey");

  assert.match(source, /label:\s*"Ctrl\+B",\s*text:\s*"\\x02"/);
  assert.match(source, /label:\s*"Ctrl\+F",\s*text:\s*"\\x06"/);
});

test("terminal context menu labels a clean connect action when no SSH session exists", () => {
  const model = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    session: {},
  });

  assert.equal(model.items.find((item) => item.id === "reconnect-terminal-session").label, "连接 SSH 会话");
});

test("terminal context menu removes duplicate paste connect and Ctrl+C actions", () => {
  const source = terminalContextMenuSource();

  assert.doesNotMatch(source, /id:\s*"paste"/);
  assert.doesNotMatch(source, /id:\s*"stop-command"/);
  assert.doesNotMatch(source, /id:\s*"connect-or-reconnect-terminal"/);
  assert.doesNotMatch(source, /id:\s*"send-ctrl-c"/);
  assert.match(source, /"paste-to-terminal":\s*\(\) => pasteClipboardToCommandInput\(\{ sendToConnectedSession:\s*true,\s*targetName:\s*contextServer,\s*sessionKey:\s*contextSessionKey \}\)/);
  assert.match(source, /"interrupt-terminal-command":\s*\(\) => sendTerminalControlSignal\("interrupt",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
});

test("terminal context menu saves the active command draft as a reusable snippet", () => {
  const source = terminalContextMenuSource();

  assert.match(source, /"save-command-snippet":\s*\(\) => saveCurrentCommandSnippet\(commandInputKey\)/);
  assert.match(source, /hasCommandDraft,\s*\n\s*hasSelectedCommandBlock/);
});

test("terminal context menu reconnect action really reconnects an active SSH session", () => {
  const source = terminalContextMenuSource();

  assert.match(source, /const terminalSessionShouldReconnect = Boolean\(terminalSession\.sessionId \|\| terminalSessionReconnectable\)/);
  assert.match(source, /"reconnect-terminal-session":\s*\(\) => terminalSessionShouldReconnect \? reconnectSelectedSession\(contextServer,\s*\{ sessionKey: contextSessionKey \}\) : openSelectedSession\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
});

test("terminal context menu can manually check the active SSH session health", () => {
  const connectedModel = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    session: { sessionId: "ssh-1" },
  });
  const disconnectedModel = buildTerminalContextActionModel({
    serverName: "prod-web-01",
    session: {},
  });
  const source = terminalContextMenuSource();

  assert.equal(connectedModel.items.find((item) => item.id === "check-terminal-session-health")?.disabled, false);
  assert.equal(disconnectedModel.items.find((item) => item.id === "check-terminal-session-health")?.disabled, true);
  assert.match(source, /"check-terminal-session-health":\s*\(\) => checkSelectedSessionHealth\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
});

test("terminal context menu Ctrl+D sends EOF and leaves interactive mode", () => {
  const menuSource = terminalContextMenuSource();
  const signalSource = functionSource("sendTerminalControlSignal", "clearSelectedTerminalOutput");

  assert.match(menuSource, /id:\s*"send-ctrl-d"[\s\S]{0,220}sendTerminalControlSignal\("eof",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(signalSource, /finishInteractiveMode:\s*\["eof",\s*"suspend",\s*"quit"\]\.includes\(signal\)/);
});

test("terminal context menu Ctrl+Z and Ctrl+Backslash leave interactive mode", () => {
  const menuSource = terminalContextMenuSource();
  const signalSource = functionSource("sendTerminalControlSignal", "clearSelectedTerminalOutput");

  assert.match(menuSource, /id:\s*"send-ctrl-z"[\s\S]{0,220}sendTerminalControlSignal\("suspend",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-ctrl-backslash"[\s\S]{0,220}sendTerminalControlSignal\("quit",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(signalSource, /finishInteractiveMode:\s*\["eof",\s*"suspend",\s*"quit"\]\.includes\(signal\)/);
});

test("terminal context menu can send Ctrl+RightBracket escape control", () => {
  const menuSource = terminalContextMenuSource();
  const signalSource = functionSource("sendTerminalControlSignal", "clearSelectedTerminalOutput");

  assert.match(menuSource, /id:\s*"send-ctrl-right-bracket"[\s\S]{0,220}sendTerminalControlSignal\("escape-control",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(signalSource, /"escape-control":\s*"\\x1d"/);
});

test("terminal context menu can send Ctrl+A and Ctrl+E line navigation", () => {
  const menuSource = terminalContextMenuSource();
  const signalSource = functionSource("sendTerminalControlSignal", "clearSelectedTerminalOutput");

  assert.match(menuSource, /id:\s*"send-ctrl-a"[\s\S]{0,220}sendTerminalControlSignal\("line-start",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-ctrl-e"[\s\S]{0,220}sendTerminalControlSignal\("line-end",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(signalSource, /"line-start":\s*"\\x01"/);
  assert.match(signalSource, /"line-end":\s*"\\x05"/);
});

test("terminal context menu can send Enter Tab and Esc to the active SSH session", () => {
  const menuSource = terminalContextMenuSource();
  const signalSource = functionSource("sendTerminalControlSignal", "clearSelectedTerminalOutput");

  assert.match(menuSource, /id:\s*"send-enter"[\s\S]{0,220}sendTerminalControlSignal\("enter",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-tab"[\s\S]{0,220}sendTerminalControlSignal\("tab",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-escape"[\s\S]{0,220}sendTerminalControlSignal\("escape",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(signalSource, /"enter":\s*"\\r"/);
  assert.match(signalSource, /"tab":\s*"\\t"/);
  assert.match(signalSource, /"escape":\s*"\\x1b"/);
});

test("terminal context menu can send navigation keys to remote TUI programs", () => {
  const menuSource = terminalContextMenuSource();
  const signalSource = functionSource("sendTerminalControlSignal", "clearSelectedTerminalOutput");

  assert.match(menuSource, /id:\s*"send-page-up"[\s\S]{0,220}sendTerminalControlSignal\("page-up",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-page-down"[\s\S]{0,220}sendTerminalControlSignal\("page-down",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-home"[\s\S]{0,220}sendTerminalControlSignal\("home",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-end"[\s\S]{0,220}sendTerminalControlSignal\("end",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-delete"[\s\S]{0,220}sendTerminalControlSignal\("delete",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-insert"[\s\S]{0,220}sendTerminalControlSignal\("insert",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(signalSource, /"page-up":\s*"\\x1b\[5~"/);
  assert.match(signalSource, /"page-down":\s*"\\x1b\[6~"/);
  assert.match(signalSource, /"home":\s*"\\x1b\[H"/);
  assert.match(signalSource, /"end":\s*"\\x1b\[F"/);
  assert.match(signalSource, /"delete":\s*"\\x1b\[3~"/);
  assert.match(signalSource, /"insert":\s*"\\x1b\[2~"/);
});

test("terminal context menu can send function keys to remote TUI programs", () => {
  const menuSource = terminalContextMenuSource();
  const signalSource = functionSource("sendTerminalControlSignal", "clearSelectedTerminalOutput");

  for (const key of ["f1", "f2", "f3", "f4", "f5", "f8", "f10", "f12"]) {
    const label = key.toUpperCase();
    assert.match(menuSource, new RegExp(`id:\\s*"send-${key}"[\\s\\S]{0,220}sendTerminalControlSignal\\("${key}",\\s*contextServer,\\s*\\{ sessionKey: contextSessionKey \\}\\)`));
    assert.match(menuSource, new RegExp(`label:\\s*"发送 ${label}"`));
  }

  assert.match(signalSource, /f1:\s*"\\x1bOP"/);
  assert.match(signalSource, /f2:\s*"\\x1bOQ"/);
  assert.match(signalSource, /f3:\s*"\\x1bOR"/);
  assert.match(signalSource, /f4:\s*"\\x1bOS"/);
  assert.match(signalSource, /f5:\s*"\\x1b\[15~"/);
  assert.match(signalSource, /f10:\s*"\\x1b\[21~"/);
  assert.match(signalSource, /f12:\s*"\\x1b\[24~"/);
});

test("terminal context menu hides advanced send-key controls until an SSH session is connected", () => {
  const menuSource = terminalContextMenuSource();

  assert.match(menuSource, /if \(terminalSession\.sessionId\) \{\s*extraItems\.push\(/);
  assert.match(menuSource, /id:\s*"send-enter"/);
  assert.ok(
    menuSource.indexOf("if (terminalSession.sessionId)") < menuSource.indexOf('id: "send-enter"'),
    "advanced terminal controls should be added only after a connected-session guard",
  );
});

test("terminal context menu groups advanced send-key controls into compact desktop sections", () => {
  const menuSource = terminalContextMenuSource();

  assert.match(menuSource, /section:\s*true,\s*label:\s*"发送按键"/);
  assert.match(menuSource, /section:\s*true,\s*label:\s*"编辑控制"/);
  assert.match(menuSource, /section:\s*true,\s*label:\s*"历史与屏幕"/);
  assert.ok(menuSource.indexOf('label: "发送按键"') < menuSource.indexOf('id: "send-enter"'));
  assert.ok(menuSource.indexOf('label: "编辑控制"') < menuSource.indexOf('id: "send-ctrl-a"'));
  assert.ok(menuSource.indexOf('label: "历史与屏幕"') < menuSource.indexOf('id: "send-ctrl-r"'));
});

test("terminal context menu can send Ctrl+U Ctrl+K and Ctrl+W editing controls", () => {
  const menuSource = terminalContextMenuSource();
  const signalSource = functionSource("sendTerminalControlSignal", "clearSelectedTerminalOutput");

  assert.match(menuSource, /id:\s*"send-ctrl-u"[\s\S]{0,220}sendTerminalControlSignal\("clear-before-cursor",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-ctrl-k"[\s\S]{0,220}sendTerminalControlSignal\("clear-after-cursor",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-ctrl-w"[\s\S]{0,220}sendTerminalControlSignal\("delete-previous-word",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-ctrl-y"[\s\S]{0,220}sendTerminalControlSignal\("yank-kill-buffer",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-alt-backspace"[\s\S]{0,220}sendTerminalControlSignal\("alt-backspace",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-alt-b"[\s\S]{0,220}sendTerminalControlSignal\("alt-b",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-alt-f"[\s\S]{0,220}sendTerminalControlSignal\("alt-f",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-alt-d"[\s\S]{0,220}sendTerminalControlSignal\("alt-d",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(signalSource, /"clear-before-cursor":\s*"\\x15"/);
  assert.match(signalSource, /"clear-after-cursor":\s*"\\x0b"/);
  assert.match(signalSource, /"delete-previous-word":\s*"\\x17"/);
  assert.match(signalSource, /"yank-kill-buffer":\s*"\\x19"/);
  assert.match(signalSource, /"alt-backspace":\s*"\\x1b\\x7f"/);
  assert.match(signalSource, /"alt-b":\s*"\\x1bb"/);
  assert.match(signalSource, /"alt-f":\s*"\\x1bf"/);
  assert.match(signalSource, /"alt-d":\s*"\\x1bd"/);
});

test("terminal context menu can send Ctrl+G to cancel remote readline state", () => {
  const menuSource = terminalContextMenuSource();
  const signalSource = functionSource("sendTerminalControlSignal", "clearSelectedTerminalOutput");

  assert.match(menuSource, /id:\s*"send-ctrl-g"[\s\S]{0,220}sendTerminalControlSignal\("cancel-readline",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(signalSource, /"cancel-readline":\s*"\\x07"/);
});

test("terminal context menu can send Ctrl+B and Ctrl+F cursor controls", () => {
  const menuSource = terminalContextMenuSource();
  const signalSource = functionSource("sendTerminalControlSignal", "clearSelectedTerminalOutput");

  assert.match(menuSource, /id:\s*"send-ctrl-b"[\s\S]{0,220}sendTerminalControlSignal\("cursor-left-char",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(menuSource, /id:\s*"send-ctrl-f"[\s\S]{0,220}sendTerminalControlSignal\("cursor-right-char",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(signalSource, /"cursor-left-char":\s*"\\x02"/);
  assert.match(signalSource, /"cursor-right-char":\s*"\\x06"/);
});

test("terminal context menu only enables leave interactive mode while a program is running", () => {
  const source = terminalContextMenuSource();

  assert.match(source, /id:\s*"finish-interactive-mode"[\s\S]{0,180}disabled:\s*!\(terminalSession\.busy && terminalSession\.sessionId\)/);
});
