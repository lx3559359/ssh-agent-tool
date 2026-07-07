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

test("Terminal command input lets paste shortcuts win before connected shell control bytes", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const handlerStart = source.indexOf("function handleCommandInputKeyDown");
  const handlerEnd = source.indexOf("function handleTerminalSearchKeyDown", handlerStart);
  assert.notEqual(handlerStart, -1, "command input key handler should exist");
  assert.notEqual(handlerEnd, -1, "search key handler should follow command input handler");
  const handler = source.slice(handlerStart, handlerEnd);

  const pasteShortcutIndex = handler.indexOf("if (pasteTerminalShortcut(event)) return;");
  const shortcutIndex = handler.indexOf("if (onTerminalShortcutKeyDown?.(event)) return;");
  const connectedInputIndex = handler.indexOf("const connectedShellInput = buildConnectedShellInput");

  assert.match(source, /function pasteTerminalShortcut\(event\)/);
  assert.notEqual(pasteShortcutIndex, -1, "command input should check paste shortcuts first");
  assert.notEqual(connectedInputIndex, -1, "command input should still support direct connected shell keys");
  assert.notEqual(shortcutIndex, -1, "command input should still check other desktop terminal shortcuts");
  assert.ok(pasteShortcutIndex < connectedInputIndex, "Ctrl+V and Shift+Insert must paste before Ctrl+V can be sent as a PTY control byte");
  assert.ok(connectedInputIndex < shortcutIndex, "non-paste control keys such as Ctrl+L should still reach the PTY before local shortcuts");
});

test("Terminal surface lets paste shortcuts win before connected shell control bytes", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const handlerStart = source.indexOf("function handleTerminalShellKeyDown");
  const handlerEnd = source.indexOf("function handleHistoryUse", handlerStart);
  assert.notEqual(handlerStart, -1, "terminal surface key handler should exist");
  assert.notEqual(handlerEnd, -1, "history handler should follow terminal surface key handler");
  const handler = source.slice(handlerStart, handlerEnd);

  const pasteShortcutIndex = handler.indexOf("if (pasteTerminalShortcut(event)) return;");
  const directControlIndex = handler.indexOf("if (sendConnectedShellSurfaceDirectControlInput(event)) return;");
  const normalInputIndex = handler.indexOf("if (sendConnectedShellSurfaceInput(event)) return;");

  assert.match(source, /function pasteTerminalShortcut\(event\)/);
  assert.notEqual(pasteShortcutIndex, -1, "terminal surface should check paste shortcuts");
  assert.notEqual(directControlIndex, -1, "terminal surface should still support direct SSH control bytes");
  assert.notEqual(normalInputIndex, -1, "terminal surface should still support normal connected shell input");
  assert.ok(pasteShortcutIndex < directControlIndex, "Ctrl+V must paste before it can be sent as a PTY control byte");
  assert.ok(directControlIndex < normalInputIndex, "non-paste direct controls should still reach SSH before normal text input");
});

test("Terminal paste shortcut returns focus to the command input after a handled paste", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const helperStart = source.indexOf("function pasteTerminalShortcut(event)");
  const helperEnd = source.indexOf("function focusCommandHistorySearchShortcut", helperStart);
  assert.notEqual(helperStart, -1, "paste shortcut helper should exist");
  assert.notEqual(helperEnd, -1, "history shortcut helper should follow paste helper");
  const helper = source.slice(helperStart, helperEnd);

  assert.match(helper, /const handled = Boolean\(onTerminalShortcutKeyDown\?\.\(event\)\)/);
  assert.match(helper, /if \(!handled\) return false/);
  assert.match(helper, /window\.requestAnimationFrame\?\.\(\(\) => commandInputRef\.current\?\.focus\?\.\(\)\)/);
  assert.match(helper, /return true/);
});

test("Terminal toolbar exposes paste with the same safe clipboard flow as shortcuts", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const appRender = app.slice(app.indexOf("<TerminalWorkspace"), app.indexOf("<AgentPanel", app.indexOf("<TerminalWorkspace")));

  assert.match(source, /onPasteTerminal/);
  assert.match(source, /aria-label="粘贴到终端"/);
  assert.match(source, /title="粘贴 Ctrl\+V \/ Ctrl\+Shift\+V \/ Shift\+Insert"/);
  assert.match(source, /onClick=\{onPasteTerminal\}/);
  assert.match(appRender, /onPasteTerminal=\{\(\) => pasteClipboardToCommandInput\(\{ sendToConnectedSession: true \}\)\}/);
});

test("Terminal focus mode button advertises F11 and Alt Enter shortcuts", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");

  assert.match(source, /aria-label="\\u4e13\\u6ce8\\u6a21\\u5f0f"/);
  assert.match(source, /title="\\u4e13\\u6ce8\\u6a21\\u5f0f F11 \/ Alt\+Enter"/);
});

test("Terminal surface supports Alt Enter focus mode without stealing command multiline editing", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const commandHandler = source.slice(
    source.indexOf("function handleCommandInputKeyDown"),
    source.indexOf("function insertCommandInputNewline"),
  );
  const shellHandler = source.slice(
    source.indexOf("function handleTerminalShellKeyDown"),
    source.indexOf("function handleHistoryUse"),
  );

  assert.match(commandHandler, /if \(insertCommandInputNewline\(event\)\) return;/);
  assert.match(shellHandler, /if \(toggleFocusModeShortcut\(event\)\) return;/);
  assert.ok(
    shellHandler.indexOf("if (toggleFocusModeShortcut(event)) return;") < shellHandler.indexOf("if (sendConnectedShellSurfaceDirectControlInput(event)) return;"),
    "Alt+Enter should toggle focus mode before terminal control handling on the output surface",
  );
});

test("Terminal surface uses the shared connected shell input builder", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const helperStart = source.indexOf("function sendConnectedShellSurfaceInput");
  const helperEnd = source.indexOf("function scrollTerminalOutputByKey", helperStart);
  assert.notEqual(helperStart, -1, "terminal surface input helper should exist");
  assert.notEqual(helperEnd, -1, "scroll helper should follow terminal surface input helper");
  const helper = source.slice(helperStart, helperEnd);

  assert.match(helper, /buildConnectedShellInput\(event,\s*commandValue \|\| "",\s*\{ connected:\s*isConnected,\s*interactive:\s*isRunningInteractiveCommand,\s*allowScrollKeys:\s*false \}\)/);
  assert.doesNotMatch(helper, /buildRunningSessionControlInput\(event,\s*""\)/);
  assert.doesNotMatch(helper, /buildRunningSessionMetaInput\(event,\s*""\)/);
  assert.doesNotMatch(helper, /buildRunningSessionKeyInput\(event\.key,\s*"",\s*event\)/);
  assert.doesNotMatch(helper, /buildRunningSessionTextInput\(event,\s*""\)/);
});

test("Terminal command paste writes the prepared next command after review", () => {
  const source = app.slice(app.indexOf("async function pasteClipboardToCommandInput"), app.indexOf("function getSftpRemotePath"));

  assert.match(source, /updateCommandInput\(inputKey,\s*plan\.nextCommand\)/);
  assert.match(source, /prepareClipboardCommandPaste\(text,\s*existing,\s*\{ allowMultiline:\s*true \}\)/);
  assert.match(source, /updateCommandInput\(inputKey,\s*plan\.nextCommand\)/);
  assert.doesNotMatch(source, /plan\.value/);
  assert.doesNotMatch(source, /force:\s*true/);
});

test("Terminal paste can target a specific SSH tab session", () => {
  const source = app.slice(app.indexOf("async function pasteClipboardToCommandInput"), app.indexOf("function getSftpRemotePath"));

  assert.match(source, /const targetName = options\.targetName \|\| selectedServer/);
  assert.match(source, /const sessionKey = options\.sessionKey \|\| resolveTerminalSessionKey\(targetName\)/);
  assert.match(source, /const inputKey = options\.commandInputKey \|\| resolveCommandInputKey\(targetName,\s*\{ sessionKey \}\)/);
  assert.match(source, /const runningSession = sshSessions\[sessionKey\]/);
  assert.match(source, /sendSelectedSessionInput\(null,\s*\{ text: pasteText,\s*submit:\s*false,\s*clearInput:\s*false,\s*sessionKey,\s*targetName \}\)/);
  assert.match(source, /confirmInteractiveClipboardPaste\(text,\s*sessionKey,\s*targetName\)/);
  assert.doesNotMatch(source, /sshSessions\[selectedTerminalSessionKey\]/);
  assert.doesNotMatch(source, /sessionKey:\s*selectedTerminalSessionKey/);
});
