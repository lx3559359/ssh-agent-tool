import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function terminalWorkspaceSource() {
  const start = app.indexOf("function TerminalWorkspace");
  const end = app.indexOf("function LegacyAgentPanel", start + 1);
  assert.notEqual(start, -1, "TerminalWorkspace component should exist");
  assert.notEqual(end, -1, "LegacyAgentPanel component should follow TerminalWorkspace");
  return app.slice(start, end);
}

function cssBlock(selector) {
  const start = styles.indexOf(selector);
  assert.notEqual(start, -1, `${selector} CSS block should exist`);
  const open = styles.indexOf("{", start);
  const close = styles.indexOf("}", open);
  assert.notEqual(open, -1, `${selector} CSS block should open`);
  assert.notEqual(close, -1, `${selector} CSS block should close`);
  return styles.slice(open + 1, close);
}

test("Terminal command input expands for multiline pasted commands without taking over the layout", () => {
  const source = terminalWorkspaceSource();

  assert.match(source, /terminalCommandInputRows/);
  assert.match(source, /Math\.min\(\s*5\s*,\s*Math\.max\(\s*1\s*,\s*String\(commandValue\s*\|\|\s*""\)\.split\("\\n"\)\.length\s*\)\s*\)/);
  assert.match(source, /rows=\{terminalCommandInputRows\}/);
  assert.doesNotMatch(source, /rows=\{1\}|rows="1"/);

  const commandBarBlock = cssBlock(".terminal-command-bar");
  assert.match(commandBarBlock, /grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s+auto/);
  assert.match(commandBarBlock, /align-items:\s*end/);

  const textareaBlock = cssBlock(".terminal-command-bar textarea");
  assert.match(textareaBlock, /max-height:\s*118px/);
  assert.match(textareaBlock, /overflow-y:\s*auto/);
  assert.match(textareaBlock, /resize:\s*none/);
  assert.match(textareaBlock, /line-height:\s*1\.45/);
});

test("Terminal command input inserts multiline draft breaks with Shift Enter or Alt Enter", () => {
  const source = terminalWorkspaceSource();
  const handlerStart = source.indexOf("function handleCommandInputKeyDown");
  const handlerEnd = source.indexOf("function applyCommandEditShortcut", handlerStart);
  assert.notEqual(handlerStart, -1, "command input key handler should exist");
  assert.notEqual(handlerEnd, -1, "edit shortcut helper should follow command key handler");
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /if \(insertCommandInputNewline\(event\)\) return;/);
  assert.ok(
    handler.indexOf("if (insertCommandInputNewline(event)) return;") < handler.indexOf("const connectedShellInput = buildConnectedShellInput"),
    "multiline edit shortcut must run before connected shell direct input",
  );
  assert.ok(
    handler.indexOf("if (insertCommandInputNewline(event)) return;") < handler.indexOf('event.key === "Enter" && !event.shiftKey'),
    "multiline edit shortcut must run before Enter sends the command",
  );

  const insertStart = source.indexOf("function insertCommandInputNewline");
  const insertEnd = source.indexOf("function applyCommandEditShortcut", insertStart);
  assert.notEqual(insertStart, -1, "newline insertion helper should exist");
  assert.notEqual(insertEnd, -1, "edit shortcut helper should follow newline insertion helper");
  const insertSource = source.slice(insertStart, insertEnd);
  assert.match(insertSource, /event\.key !== "Enter"/);
  assert.match(insertSource, /!\(event\.shiftKey \|\| event\.altKey\)/);
  assert.match(insertSource, /selectionStart/);
  assert.match(insertSource, /selectionEnd/);
  assert.match(insertSource, /onCommandChange\?\.\(nextValue\)/);
  assert.match(insertSource, /setSelectionRange\?\.\(cursor,\s*cursor\)/);
});

test("Terminal command input does not send while IME composition is active", () => {
  const source = terminalWorkspaceSource();
  const handlerStart = source.indexOf("function handleCommandInputKeyDown");
  const handlerEnd = source.indexOf("function applyCommandEditShortcut", handlerStart);
  assert.notEqual(handlerStart, -1, "command input key handler should exist");
  assert.notEqual(handlerEnd, -1, "edit shortcut helper should follow command key handler");
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /if \(event\.isComposing \|\| event\.nativeEvent\?\.isComposing\) return;/);
  assert.ok(
    handler.indexOf("if (event.isComposing || event.nativeEvent?.isComposing) return;") < handler.indexOf('event.key === "Enter" && !event.shiftKey'),
    "IME composition guard must run before Enter can submit the SSH command",
  );
});

test("Terminal command input forwards Home End and Page keys to connected SSH programs", () => {
  const source = terminalWorkspaceSource();
  const handlerStart = source.indexOf("function handleCommandInputKeyDown");
  const handlerEnd = source.indexOf("function applyCommandEditShortcut", handlerStart);
  assert.notEqual(handlerStart, -1, "command input key handler should exist");
  assert.notEqual(handlerEnd, -1, "edit shortcut helper should follow command key handler");
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /buildConnectedShellInput\(event,\s*commandValue \|\| "",\s*\{ connected:\s*isConnected,\s*interactive:\s*isRunningInteractiveCommand,\s*allowScrollKeys:\s*false,\s*forwardReviewKeys:\s*true \}\)/);
});

test("Terminal command input explains that Enter can auto-connect and send", () => {
  const source = terminalWorkspaceSource();

  assert.match(source, /输入 SSH 命令，Enter 发送/);
  assert.match(source, /输入 SSH 命令，Enter 自动连接并发送/);
  assert.doesNotMatch(source, /先连接 SSH 会话|\\u5148\\u8fde\\u63a5 SSH \\u4f1a\\u8bdd/);
});

test("Terminal command input regains focus when switching SSH tabs or servers", () => {
  const source = terminalWorkspaceSource();
  const focusEffect = source.slice(
    source.indexOf("function focusTerminalCommandInput"),
    source.indexOf("function handleOutputScroll"),
  );

  assert.match(focusEffect, /function focusTerminalCommandInput\(\)/);
  assert.match(focusEffect, /window\.requestAnimationFrame\?\.\(\(\) => commandInputRef\.current\?\.focus\?\.\(\)\)/);
  assert.match(focusEffect, /\}, \[selectedTerminalTabId,\s*selectedServer\]\)/);
});

test("Terminal command snippets expose fill copy and custom delete actions", () => {
  const source = terminalWorkspaceSource();
  const snippetStart = source.indexOf('<div className="terminal-snippets">');
  const snippetEnd = source.indexOf("{historyPanelOpen &&", snippetStart);
  assert.notEqual(snippetStart, -1, "terminal snippets block should exist");
  assert.notEqual(snippetEnd, -1, "history panel should follow terminal snippets");
  const snippetSource = source.slice(snippetStart, snippetEnd);

  assert.match(snippetSource, /visibleSnippets\.map\(\(item\) =>/);
  assert.match(snippetSource, /className=\{`terminal-snippet-item \$\{item\.custom \? "custom" : ""\}`\}/);
  assert.match(snippetSource, /className="terminal-snippet-command"[\s\S]{0,180}onClick=\{\(\) => onUseSnippet\?\.\(item\)\}/);
  assert.match(snippetSource, /className="terminal-snippet-copy"[\s\S]{0,180}onClick=\{\(\) => onCopySnippet\?\.\(item\.command\)\}/);
  assert.match(snippetSource, /aria-label=\{`复制命令片段 \$\{item\.label \|\| item\.command\}`\}/);
  assert.match(snippetSource, /\{item\.custom && \(/);
  assert.match(snippetSource, /className="terminal-snippet-remove"[\s\S]{0,220}onClick=\{\(\) => onRemoveSnippet\?\.\(item\.command\)\}/);
  assert.match(snippetSource, /aria-label=\{`删除命令片段 \$\{item\.label \|\| item\.command\}`\}/);
});

test("Rename terminal tab form does not submit while IME composition is active", () => {
  const start = app.indexOf("function RenameTerminalTabModal");
  const end = app.indexOf("function SftpNameModal", start);
  assert.notEqual(start, -1, "RenameTerminalTabModal should exist");
  assert.notEqual(end, -1, "SftpNameModal should follow RenameTerminalTabModal");
  const source = app.slice(start, end);

  assert.match(app, /function ignoreComposingEnterSubmit\(event\)/);
  assert.match(source, /<form className="settings-modal rename-tab-modal"[\s\S]{0,180}onKeyDown=\{ignoreComposingEnterSubmit\}/);
});
