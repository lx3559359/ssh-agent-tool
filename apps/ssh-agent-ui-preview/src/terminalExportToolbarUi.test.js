import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function componentSource(name, nextName) {
  const start = app.indexOf(`function ${name}`);
  const end = app.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} component should exist`);
  assert.notEqual(end, -1, `${nextName} component should follow ${name}`);
  return app.slice(start, end);
}

test("terminal toolbar exposes one-click terminal output export", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const appRender = app.slice(app.indexOf("<TerminalWorkspace"), app.indexOf("<AgentPanel", app.indexOf("<TerminalWorkspace")));

  assert.match(source, /onExportTerminal/);
  assert.match(source, /aria-label="导出终端记录"/);
  assert.match(source, /title="导出终端记录 Ctrl\+Shift\+S"/);
  assert.match(source, /onClick=\{onExportTerminal\}/);
  assert.match(appRender, /onExportTerminal=\{exportSelectedTerminalOutput\}/);
});

test("terminal toolbar can copy the selected server SSH command without passing click events", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const appRender = app.slice(app.indexOf("<TerminalWorkspace"), app.indexOf("<AgentPanel", app.indexOf("<TerminalWorkspace")));

  assert.match(source, /onCopySshCommand/);
  assert.match(source, /aria-label="复制 SSH 命令"/);
  assert.match(source, /title="复制 SSH 命令 Ctrl\+Shift\+Y"/);
  assert.match(source, /onClick=\{\(\) => onCopySshCommand\?\.\(selectedServer\)\}/);
  assert.match(appRender, /onCopySshCommand=\{copyServerSshCommand\}/);
});

test("terminal toolbar exposes clear terminal display with shortcut hint", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const appRender = app.slice(app.indexOf("<TerminalWorkspace"), app.indexOf("<AgentPanel", app.indexOf("<TerminalWorkspace")));

  assert.match(source, /onClearTerminal/);
  assert.match(source, /aria-label="清空终端显示"/);
  assert.match(source, /title="清空终端显示 Ctrl\+Shift\+L"/);
  assert.match(source, /onClick=\{\(\) => onClearTerminal\?\.\(selectedServer\)\}/);
  assert.match(appRender, /onClearTerminal=\{clearSelectedTerminalOutput\}/);
});

test("terminal shortcut Ctrl Shift Y copies the selected server SSH command", () => {
  const start = app.indexOf("function runTerminalShortcutAction");
  const end = app.indexOf("function handleTerminalShortcutKeyDown", start);
  assert.notEqual(start, -1, "terminal shortcut dispatcher should exist");
  assert.notEqual(end, -1, "terminal shortcut dispatcher should end before handler");
  const source = app.slice(start, end);

  assert.match(source, /if \(action === "copy-ssh-command"\)/);
  assert.match(source, /copyServerSshCommand\(selectedServer\)/);
});
