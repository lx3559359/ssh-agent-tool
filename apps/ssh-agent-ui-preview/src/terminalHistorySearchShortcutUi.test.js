import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function terminalWorkspaceSource() {
  const start = app.indexOf("function TerminalWorkspace");
  const end = app.indexOf("function LegacyAgentPanel", start);
  assert.notEqual(start, -1, "TerminalWorkspace should exist");
  assert.notEqual(end, -1, "LegacyAgentPanel should follow TerminalWorkspace");
  return app.slice(start, end);
}

test("app startup persists normalized command history back to local storage", () => {
  assert.match(app, /function readStoredCommandHistories\(\)/);
  const helperStart = app.indexOf("function readStoredCommandHistories()");
  const helperEnd = app.indexOf("function readLocalJson", helperStart);
  assert.notEqual(helperStart, -1, "readStoredCommandHistories should exist");
  assert.notEqual(helperEnd, -1, "readLocalJson should follow stored command history helper");
  const helper = app.slice(helperStart, helperEnd);

  assert.match(helper, /const raw = readLocalJson\("sshAgentCommandHistories",\s*\{\}\)/);
  assert.match(helper, /const normalized = normalizeCommandHistories\(raw\)/);
  assert.match(helper, /JSON\.stringify\(raw\) !== JSON\.stringify\(normalized\)/);
  assert.match(helper, /writeLocalJson\("sshAgentCommandHistories",\s*normalized\)/);
  assert.match(app, /useState\(\(\) => readStoredCommandHistories\(\)\)/);
});

test("Ctrl+R opens local command history search without stealing remote shell Ctrl+R", () => {
  const source = terminalWorkspaceSource();
  const handler = source.slice(source.indexOf("function handleCommandInputKeyDown"), source.indexOf("function handleTerminalSearchKeyDown"));

  assert.match(source, /const historySearchInputRef = useRef\(null\)/);
  assert.match(source, /function focusCommandHistorySearchShortcut\(event\)/);
  assert.match(source, /setHistoryPanelOpen\(true\)/);
  assert.match(source, /historySearchInputRef\.current\?\.focus\(\)/);
  assert.match(source, /<input ref=\{historySearchInputRef\}/);
  assert.match(source, /title="命令历史 Ctrl\+R"/);

  const connectedInputIndex = handler.indexOf("const connectedShellInput = buildConnectedShellInput");
  const localHistoryIndex = handler.indexOf("if (focusCommandHistorySearchShortcut(event)) return;");
  const appShortcutIndex = handler.indexOf("if (onTerminalShortcutKeyDown?.(event)) return;");

  assert.notEqual(connectedInputIndex, -1, "connected shell input should still be handled");
  assert.notEqual(localHistoryIndex, -1, "local history search shortcut should be handled");
  assert.notEqual(appShortcutIndex, -1, "app shortcut fallback should still be handled");
  assert.ok(connectedInputIndex < localHistoryIndex, "remote shell Ctrl+R must win when connected and input is empty");
  assert.ok(localHistoryIndex < appShortcutIndex, "local Ctrl+R history search should run before generic app shortcuts");
});

test("command history search supports Enter to use first result and Escape to close", () => {
  const source = terminalWorkspaceSource();
  const handler = source.slice(source.indexOf("function handleCommandHistorySearchKeyDown"), source.indexOf("function handleTerminalSearchKeyDown"));

  assert.match(source, /function handleCommandHistorySearchKeyDown\(event\)/);
  assert.match(handler, /event\.key === "Enter"/);
  assert.match(handler, /handleHistoryUse\(filteredCommandHistory\[historySelectionIndex\] \|\| filteredCommandHistory\[0\]\)/);
  assert.match(handler, /event\.key === "Escape"/);
  assert.match(handler, /setHistoryPanelOpen\(false\)/);
  assert.match(handler, /setHistoryFilter\(""\)/);
  assert.match(source, /onKeyDown=\{handleCommandHistorySearchKeyDown\}/);
});

test("terminal output search Escape clears search and returns focus to the SSH command input", () => {
  const source = terminalWorkspaceSource();
  const handler = source.slice(source.indexOf("function handleTerminalSearchKeyDown"), source.indexOf("function jumpTerminalSearch"));

  assert.match(source, /function handleTerminalSearchKeyDown\(event\)/);
  assert.match(handler, /event\.preventDefault\(\)/);
  assert.match(handler, /action === "blur-search"/);
  assert.match(handler, /terminalSearchInputRef\.current\?\.blur\(\)/);
  assert.match(handler, /setTerminalSearchQuery\(""\)/);
  assert.match(handler, /commandInputRef\.current\?\.focus\(\)/);
  assert.match(source, /onKeyDown=\{handleTerminalSearchKeyDown\}/);
});

test("terminal surface Ctrl+F opens output search before remote control bytes", () => {
  const source = terminalWorkspaceSource();
  const handler = source.slice(source.indexOf("function handleTerminalShellKeyDown"), source.indexOf("function handleHistoryUse"));

  const pasteShortcutIndex = handler.indexOf("if (pasteTerminalShortcut(event)) return;");
  const searchShortcutIndex = handler.indexOf("if (focusTerminalSearchShortcut(event)) return;");
  const directControlIndex = handler.indexOf("if (sendConnectedShellSurfaceDirectControlInput(event)) return;");
  const appShortcutIndex = handler.indexOf("if (onTerminalShortcutKeyDown(event)) return;");

  assert.notEqual(pasteShortcutIndex, -1, "paste shortcut should still be handled first");
  assert.notEqual(searchShortcutIndex, -1, "terminal surface should handle output search shortcut");
  assert.notEqual(directControlIndex, -1, "terminal surface should still support remote control bytes");
  assert.notEqual(appShortcutIndex, -1, "generic terminal shortcuts should still be available");
  assert.ok(pasteShortcutIndex < searchShortcutIndex, "paste must still win before search handling");
  assert.ok(searchShortcutIndex < directControlIndex, "Ctrl+F should open local output search before it can be sent as remote Ctrl+F");
  assert.ok(directControlIndex < appShortcutIndex, "other direct remote controls should still win before generic app shortcuts");
});

test("command history search supports arrow selection before Enter", () => {
  const source = terminalWorkspaceSource();
  const handler = source.slice(source.indexOf("function handleCommandHistorySearchKeyDown"), source.indexOf("function handleTerminalSearchKeyDown"));

  assert.match(source, /const \[historySelectionIndex,\s*setHistorySelectionIndex\] = useState\(0\)/);
  assert.match(source, /setHistorySelectionIndex\(0\)/);
  assert.match(handler, /event\.key === "ArrowDown"/);
  assert.match(handler, /event\.key === "ArrowUp"/);
  assert.match(handler, /filteredCommandHistory\.length/);
  assert.match(handler, /handleHistoryUse\(filteredCommandHistory\[historySelectionIndex\] \|\| filteredCommandHistory\[0\]\)/);
  assert.match(source, /className=\{`terminal-history-item history-command \$\{index === historySelectionIndex \? "active" : ""\}`\}/);
});

test("command history search keeps styled rows and shows an empty state", () => {
  const source = terminalWorkspaceSource();

  assert.match(source, /className=\{`terminal-history-item history-command \$\{index === historySelectionIndex \? "active" : ""\}`\}/);
  assert.match(source, /filteredCommandHistory\.length === 0/);
  assert.match(source, /没有匹配的历史命令/);
});

test("command history search can delete a single history command", () => {
  const source = terminalWorkspaceSource();
  const appRemoveStart = app.indexOf("function removeSelectedCommandHistoryItem");
  const appRemoveEnd = app.indexOf("function getTerminalLinesForSession", appRemoveStart);
  assert.notEqual(appRemoveStart, -1, "removeSelectedCommandHistoryItem should exist");
  assert.notEqual(appRemoveEnd, -1, "getTerminalLinesForSession should follow removeSelectedCommandHistoryItem");
  const removeSource = app.slice(appRemoveStart, appRemoveEnd);

  assert.match(source, /onRemoveHistoryCommand/);
  assert.match(source, /className="terminal-history-row"/);
  assert.match(source, /className=\{`terminal-history-item history-command \$\{index === historySelectionIndex \? "active" : ""\}`\}/);
  assert.match(source, /className="terminal-history-remove"/);
  assert.match(source, /onClick=\{\(\) => onRemoveHistoryCommand\?\.\(command\)\}/);
  assert.match(source, /aria-label=\{`删除历史命令 \$\{command\}`\}/);
  assert.match(removeSource, /removeCommandFromHistoryForServer\(commandHistories,\s*selectedServer,\s*command\)/);
  assert.match(removeSource, /writeLocalJson\("sshAgentCommandHistories",\s*nextHistories\)/);
  assert.match(removeSource, /setHistoryCursors\(\(current\) => \(\{ \.\.\.current,\s*\[selectedCommandInputKey\]: createHistoryCursor\(commandInputs\[selectedCommandInputKey\] \|\| ""\) \}\)\)/);
  assert.match(app, /onRemoveHistoryCommand=\{removeSelectedCommandHistoryItem\}/);
});

test("command history search can save a single history command as a snippet", () => {
  const source = terminalWorkspaceSource();
  const appSaveStart = app.indexOf("function saveCommandSnippetFromText");
  const appSaveEnd = app.indexOf("function saveCurrentCommandSnippet", appSaveStart);
  assert.notEqual(appSaveStart, -1, "saveCommandSnippetFromText should exist");
  assert.notEqual(appSaveEnd, -1, "saveCurrentCommandSnippet should follow saveCommandSnippetFromText");
  const saveSource = app.slice(appSaveStart, appSaveEnd);

  assert.match(source, /onSaveHistoryCommandSnippet/);
  assert.match(source, /className="terminal-history-save"/);
  assert.match(source, /onClick=\{\(\) => onSaveHistoryCommandSnippet\?\.\(command\)\}/);
  assert.match(source, /aria-label=\{`保存历史命令为片段 \$\{command\}`\}/);
  assert.match(saveSource, /validateCustomCommandSnippet\(command\)/);
  assert.match(saveSource, /addCustomCommandSnippet\(customCommandSnippets,\s*command\)/);
  assert.match(saveSource, /writeLocalJson\("sshAgentCustomCommandSnippets",\s*nextSnippets\)/);
  assert.match(saveSource, /persistAppConfig\(customServers,\s*modelConfig,\s*customAgentCapabilities,\s*modelProfiles,\s*activeModelProfileId,\s*hiddenBuiltinServers,\s*portForwardPresets,\s*nextSnippets\)/);
  assert.match(app, /onSaveHistoryCommandSnippet=\{saveCommandSnippetFromText\}/);
});
