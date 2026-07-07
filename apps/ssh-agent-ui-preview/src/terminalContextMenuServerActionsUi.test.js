import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function terminalContextMenuSource() {
  const start = app.indexOf("function openTerminalContextMenu");
  const end = app.indexOf("function openTerminalTabContextMenu", start);
  assert.notEqual(start, -1, "openTerminalContextMenu should exist");
  assert.notEqual(end, -1, "openTerminalTabContextMenu should follow openTerminalContextMenu");
  return app.slice(start, end);
}

test("terminal context menu can delete custom servers or hide builtin servers", () => {
  const source = terminalContextMenuSource();

  assert.match(source, /buildTerminalContextActionModel\(\{/);
  assert.match(source, /"delete-terminal-server":\s*\(\) => customServers\[contextServer\] \? deleteSelectedHost\(contextServer\) : hideBuiltinServer\(contextServer\)/);
});

test("terminal context menu marks copy action as selected text when output text is selected", () => {
  const source = terminalContextMenuSource();

  assert.match(source, /const selectedTerminalText = String\(window\.getSelection\?\.\(\)\?\.toString\?\.\(\) \|\| ""\)\.trim\(\)/);
  assert.match(source, /hasTerminalTextSelection:\s*Boolean\(selectedTerminalText\)/);
});

test("terminal context menu recovery copy actions use the right-clicked tab context", () => {
  const source = terminalContextMenuSource();

  assert.match(source, /id:\s*"copy-terminal-error-detail"[\s\S]{0,180}copySelectedSessionErrorDetail\(contextServer,\s*contextSessionKey\)/);
  assert.match(source, /id:\s*"copy-terminal-diagnostic-summary"[\s\S]{0,180}copySelectedSessionDiagnosticSummary\(contextServer,\s*contextSessionKey\)/);
  assert.match(source, /disabled:\s*!terminalSessionReconnectable/);
});

test("terminal context menu keeps SSH diagnostic summary available for healthy sessions", () => {
  const source = terminalContextMenuSource();
  const itemMatch = source.match(/\{ id:\s*"copy-terminal-diagnostic-summary"[\s\S]*?\},/);

  assert.ok(itemMatch, "copy-terminal-diagnostic-summary menu item should exist");
  assert.doesNotMatch(itemMatch[0], /disabled:/);
});

test("terminal diagnostic summary includes session identity and status for bug reports", () => {
  const start = app.indexOf("async function copySelectedSessionDiagnosticSummary");
  const end = app.indexOf("async function runTerminalSessionRecoveryAction", start);
  assert.notEqual(start, -1, "copySelectedSessionDiagnosticSummary should exist");
  assert.notEqual(end, -1, "runTerminalSessionRecoveryAction should follow copySelectedSessionDiagnosticSummary");
  const source = app.slice(start, end);

  assert.match(source, /`会话键：\$\{sessionKey \|\| "--"\}`/);
  assert.match(source, /`后端会话：\$\{session\.sessionId \|\| "--"\}`/);
  assert.match(source, /`连接状态：\$\{session\.status \|\| "unknown"\}`/);
  assert.match(source, /`交互模式：\$\{isTerminalInteractiveMode\(session\) \? "是" : "否"\}`/);
  assert.match(source, /const currentWorkingDirectory = normalizeSftpPath\(sessionWorkingDirectories\[sessionKey\] \|\| sessionWorkingDirectories\[name\] \|\| server\?\.cwd \|\| ""\)/);
  assert.match(source, /const terminalHealthText = buildTerminalHealthText\(session,\s*server\)/);
  assert.match(source, /const recentTerminalLines = getTerminalLinesForSession\(name,\s*\{ sessionKey \}\)\.slice\(-20\)/);
  assert.match(source, /const recentTerminalOutput = formatTerminalClipboardText\(recentTerminalLines,\s*20\)/);
  assert.match(source, /最近终端输出/);
  assert.match(source, /`当前远程目录：\$\{currentWorkingDirectory \|\| "--"\}`/);
  assert.match(source, /`健康检查：\$\{terminalHealthText\}`/);
  assert.match(source, /session\.healthMessage \? `健康消息：\$\{session\.healthMessage\}` : ""/);
});

test("terminal context menu reconnect actions use the right-clicked tab session key", () => {
  const source = terminalContextMenuSource();

  assert.match(source, /"reconnect-terminal-session":\s*\(\) => terminalSessionShouldReconnect \? reconnectSelectedSession\(contextServer,\s*\{ sessionKey: contextSessionKey \}\) : openSelectedSession\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(source, /"reconnect-and-clear-session":\s*\(\) => reconnectAndClearSelectedSession\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
});

test("terminal context menu clear and disconnect actions use the right-clicked tab session key", () => {
  const source = terminalContextMenuSource();
  const closeSource = app.slice(app.indexOf("async function closeSelectedSession"), app.indexOf("async function reconnectSelectedSession"));

  assert.match(source, /"clear-terminal-output":\s*\(\) => clearSelectedTerminalOutput\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(source, /"disconnect-terminal-session":\s*\(\) => closeSelectedSession\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(closeSource, /async function closeSelectedSession\(targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(closeSource, /const sessionKey = options\.sessionKey \|\| resolveTerminalSessionKey\(targetName\)/);
  assert.match(closeSource, /closeSessionByName\(targetName,\s*"SSH 会话已断开",\s*\{ sessionKey,\s*actor:\s*"user" \}\)/);
});

test("terminal context menu output copy and export actions use the right-clicked tab output", () => {
  const source = terminalContextMenuSource();
  const helperSource = app.slice(app.indexOf("function getTerminalLinesForSession"), app.indexOf("async function copySelectedTerminalOutput"));
  const lineCopySource = app.slice(app.indexOf("async function copyTerminalLineOutput"), app.indexOf("async function exportSelectedTerminalOutput"));
  const copySource = app.slice(app.indexOf("async function copySelectedTerminalOutput"), app.indexOf("async function copyRecentTerminalOutput"));
  const recentSource = app.slice(app.indexOf("async function copyRecentTerminalOutput"), app.indexOf("function scrollCurrentTerminalOutput"));
  const blockCopySource = app.slice(app.indexOf("async function copyTerminalLineCommandOutputBlock"), app.indexOf("async function exportSelectedTerminalOutput"));
  const exportSource = app.slice(app.indexOf("async function exportSelectedTerminalOutput"), app.indexOf("async function exportTerminalLineCommandOutputBlock"));
  const blockExportSource = app.slice(app.indexOf("async function exportTerminalLineCommandOutputBlock"), app.indexOf("function draftAgentTerminalAnalysis"));

  assert.match(helperSource, /function getTerminalLinesForSession\(targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(helperSource, /const sessionKey = options\.sessionKey \|\| resolveTerminalSessionKey\(name\)/);
  assert.match(helperSource, /buildVisibleTerminalLines\(\{/);
  assert.match(source, /const outputLineElement = event\.target\?\.closest\?\.\("\[data-terminal-line\]"\)/);
  assert.match(source, /const contextOutputLineIndex = Number\.isInteger\(clickedOutputLineIndex\) \? clickedOutputLineIndex : Math\.max\(0,\s*contextTerminalLines\.length - 1\)/);
  assert.match(source, /const contextOutputCommand = extractTerminalCommandFromLine\(contextTerminalLines\[contextOutputLineIndex\] \|\| ""\)/);
  assert.match(source, /hasCurrentTerminalLine:\s*Number\.isInteger\(clickedOutputLineIndex\)/);
  assert.match(source, /hasCurrentTerminalCommand:\s*Boolean\(contextOutputCommand\)/);
  assert.match(source, /"copy-selection-or-output":\s*\(\) => copySelectedTerminalTextOrOutput\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(source, /"copy-current-line":\s*\(\) => copyTerminalLineOutput\(contextOutputLineIndex,\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(source, /"use-current-line-command":\s*\(\) => useTerminalLineCommand\(contextOutputLineIndex,\s*contextServer,\s*\{ sessionKey: contextSessionKey,\s*commandInputKey \}\)/);
  assert.match(source, /"copy-command-block":\s*\(\) => copyTerminalLineCommandOutputBlock\(contextOutputLineIndex,\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(source, /"export-terminal-output":\s*\(\) => exportSelectedTerminalOutput\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(source, /id:\s*"copy-recent-output"[\s\S]{0,180}copyRecentTerminalOutput\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(source, /const contextTerminalLines = getTerminalLinesForSession\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(lineCopySource, /async function copyTerminalLineOutput\(lineIndex,\s*targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(lineCopySource, /getTerminalLinesForSession\(targetName,\s*options\)/);
  assert.match(lineCopySource, /formatTerminalClipboardText\(\[line\]\)/);
  assert.match(blockCopySource, /async function copyTerminalLineCommandOutputBlock\(lineIndex,\s*targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(blockCopySource, /const block = buildTerminalCommandOutputBlock\(terminalLines,\s*Number\(lineIndex\)\)/);
  assert.match(blockCopySource, /await copyTextToClipboard\(content,\s*"当前命令块已复制"\)/);
  assert.match(copySource, /getTerminalLinesForSession\(targetName,\s*options\)/);
  assert.match(recentSource, /copySelectedTerminalOutput\(80,\s*targetName,\s*options\)/);
  assert.match(exportSource, /getTerminalLinesForSession\(targetName,\s*options\)/);
  assert.match(blockExportSource, /getTerminalLinesForSession\(targetName,\s*options\)/);
});

test("terminal context menu can reuse a right-clicked command line in the matching input", () => {
  const source = terminalContextMenuSource();
  const useSource = app.slice(app.indexOf("function useTerminalLineCommand"), app.indexOf("async function exportSelectedTerminalOutput"));

  assert.match(useSource, /function useTerminalLineCommand\(lineIndex,\s*targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(useSource, /const terminalLines = getTerminalLinesForSession\(targetName,\s*options\)/);
  assert.match(useSource, /const command = extractTerminalCommandFromLine\(terminalLines\[Number\(lineIndex\)\] \|\| ""\)/);
  assert.match(useSource, /const inputKey = options\.commandInputKey \|\| resolveCommandInputKey\(targetName,\s*\{ sessionKey: options\.sessionKey \}\)/);
  assert.match(useSource, /updateCommandInput\(inputKey,\s*command\)/);
  assert.match(source, /"use-current-line-command":\s*\(\) => useTerminalLineCommand\(contextOutputLineIndex,\s*contextServer,\s*\{ sessionKey: contextSessionKey,\s*commandInputKey \}\)/);
});

test("terminal context menu paste action uses the right-clicked tab session key", () => {
  const source = terminalContextMenuSource();

  assert.match(source, /"paste-to-terminal":\s*\(\) => pasteClipboardToCommandInput\(\{ sendToConnectedSession:\s*true,\s*targetName:\s*contextServer,\s*sessionKey:\s*contextSessionKey \}\)/);
});

test("terminal context menu can focus local output search", () => {
  const source = terminalContextMenuSource();
  const focusStart = app.indexOf('function focusTerminalSearch(query = "")');
  const focusEnd = app.indexOf("function scrollCurrentTerminalOutput", focusStart);
  const focusSource = focusStart >= 0 && focusEnd >= 0 ? app.slice(focusStart, focusEnd) : "";
  const workspaceSource = app.slice(app.indexOf("function TerminalWorkspace"), app.indexOf("function LegacyAgentPanel"));

  assert.match(focusSource, /function focusTerminalSearch\(query = ""\)/);
  assert.match(focusSource, /const searchQuery = String\(query \|\| ""\)\.trim\(\)\.slice\(0,\s*160\)/);
  assert.match(focusSource, /setTerminalSearchFocusRequest\(\(current\) => \(\{ tick: current\.tick \+ 1,\s*query: searchQuery \}\)\)/);
  assert.match(workspaceSource, /terminalSearchFocusRequest\s*=\s*\{ tick: 0,\s*query: "" \}/);
  assert.match(workspaceSource, /const requestedSearchQuery = String\(terminalSearchFocusRequest\?\.query \|\| ""\)/);
  assert.match(workspaceSource, /setTerminalSearchQuery\(requestedSearchQuery\)/);
  assert.match(workspaceSource, /terminalSearchInputRef\.current\?\.focus\?\.\(\)/);
  assert.match(source, /"search-terminal-output":\s*\(\) => focusTerminalSearch\(selectedTerminalText\)/);
});

test("terminal context menu can select all visible terminal output", () => {
  const source = terminalContextMenuSource();
  const selectStart = app.indexOf("function selectCurrentTerminalOutput");
  const selectEnd = app.indexOf("function readSelectedTerminalText", selectStart);
  const selectSource = selectStart >= 0 && selectEnd >= 0 ? app.slice(selectStart, selectEnd) : "";

  assert.match(selectSource, /function selectCurrentTerminalOutput\(\)/);
  assert.match(selectSource, /document\.querySelector\("\.terminal-shell \.terminal-output"\)/);
  assert.match(selectSource, /document\.createRange\(\)/);
  assert.match(selectSource, /range\.selectNodeContents\(target\)/);
  assert.match(selectSource, /selection\.removeAllRanges\(\)/);
  assert.match(selectSource, /selection\.addRange\(range\)/);
  assert.match(source, /"select-all-output":\s*\(\) => selectCurrentTerminalOutput\(\)/);
});

test("terminal shortcut Ctrl+Shift+A selects all visible terminal output", () => {
  const start = app.indexOf("function runTerminalShortcutAction");
  const end = app.indexOf("function handleTerminalShortcutKeyDown", start);
  assert.notEqual(start, -1, "runTerminalShortcutAction should exist");
  assert.notEqual(end, -1, "handleTerminalShortcutKeyDown should follow runTerminalShortcutAction");
  const source = app.slice(start, end);

  assert.match(source, /const action = getTerminalShortcutAction\(event,\s*commandInputs\[selectedCommandInputKey\] \|\| ""\)/);
  assert.match(source, /if \(action === "select-all-output"\) \{\s*selectCurrentTerminalOutput\(\);\s*return true;\s*\}/);
});

test("terminal context menu cwd actions use the right-clicked tab session key", () => {
  const source = terminalContextMenuSource();
  const openSource = app.slice(app.indexOf("async function openCurrentWorkingDirectoryInSftp"), app.indexOf("async function copyCurrentWorkingDirectory"));
  const copySource = app.slice(app.indexOf("async function copyCurrentWorkingDirectory"), app.indexOf("async function refreshSelectedSftp"));

  assert.match(source, /id:\s*"copy-terminal-cwd"[\s\S]{0,180}copyCurrentWorkingDirectory\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(source, /id:\s*"open-terminal-cwd-in-sftp"[\s\S]{0,180}openCurrentWorkingDirectoryInSftp\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(source, /id:\s*"open-terminal-cwd-in-sftp"[\s\S]{0,220}shortcut:\s*"Ctrl\+Shift\+O"/);
  assert.match(openSource, /async function openCurrentWorkingDirectoryInSftp\(name = selectedServer,\s*options = \{\}\)/);
  assert.match(openSource, /const sessionKey = options\.sessionKey \|\| resolveTerminalSessionKey\(name\)/);
  assert.match(openSource, /sessionWorkingDirectories\[sessionKey\] \|\| sessionWorkingDirectories\[name\]/);
  assert.match(copySource, /async function copyCurrentWorkingDirectory\(name = selectedServer,\s*options = \{\}\)/);
  assert.match(copySource, /const sessionKey = options\.sessionKey \|\| resolveTerminalSessionKey\(name\)/);
  assert.match(copySource, /sessionWorkingDirectories\[sessionKey\] \|\| sessionWorkingDirectories\[name\]/);
});

test("terminal context menu shows the existing auth center shortcut", () => {
  const source = terminalContextMenuSource();

  assert.match(source, /id:\s*"terminal-auth-center"[\s\S]{0,180}openAuthCenter\(contextServer\)/);
  assert.match(source, /id:\s*"terminal-auth-center"[\s\S]{0,220}shortcut:\s*"Ctrl\+Shift\+K"/);
});

test("terminal context menu shows the existing tool log shortcut", () => {
  const source = terminalContextMenuSource();

  assert.match(source, /id:\s*"terminal-tool-logs"[\s\S]{0,180}openToolLogs\(\{ query: contextServer \}\)/);
  assert.match(source, /id:\s*"terminal-tool-logs"[\s\S]{0,220}shortcut:\s*"Ctrl\+Shift\+G"/);
});

test("terminal context menu Agent analysis uses the right-clicked tab output", () => {
  const source = terminalContextMenuSource();
  const analysisSource = app.slice(app.indexOf("function draftAgentTerminalAnalysis"), app.indexOf("function draftAgentTerminalLineAnalysis"));
  const lineSource = app.slice(app.indexOf("function draftAgentTerminalLineAnalysis"), app.indexOf("function draftAgentTerminalCommandOutputAnalysis"));
  const blockSource = app.slice(app.indexOf("function draftAgentTerminalCommandOutputAnalysis"), app.indexOf("function draftAgentSftpPreviewAnalysis"));

  assert.match(source, /"send-command-to-agent":\s*\(\) => draftAgentTerminalAnalysis\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(analysisSource, /function draftAgentTerminalAnalysis\(targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(analysisSource, /getTerminalLinesForSession\(targetName,\s*options\)/);
  assert.match(lineSource, /function draftAgentTerminalLineAnalysis\(lineIndex,\s*targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(lineSource, /getTerminalLinesForSession\(targetName,\s*options\)/);
  assert.match(blockSource, /function draftAgentTerminalCommandOutputAnalysis\(lineIndex,\s*targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(blockSource, /getTerminalLinesForSession\(targetName,\s*options\)/);
  assert.match(source, /id:\s*"explain-current-line"[\s\S]{0,220}draftAgentTerminalLineAnalysis\(contextOutputLineIndex,\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  assert.match(source, /id:\s*"explain-command-block"[\s\S]{0,220}draftAgentTerminalCommandOutputAnalysis\(contextOutputLineIndex,\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
});

test("terminal context menu control key actions use the right-clicked tab session key", () => {
  const source = terminalContextMenuSource();

  assert.match(source, /"interrupt-terminal-command":\s*\(\) => sendTerminalControlSignal\("interrupt",\s*contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
  for (const signal of ["eof", "suspend", "quit", "line-start", "line-end", "backspace-control", "clear-before-cursor", "clear-after-cursor", "delete-previous-word", "yank-kill-buffer", "alt-backspace", "alt-b", "alt-f", "alt-d", "history-search", "history-previous", "history-next", "clear-remote-screen", "pause-output", "resume-output", "alt-left", "alt-right", "ctrl-left", "ctrl-right"]) {
    const escapedSignal = signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`sendTerminalControlSignal\\("${escapedSignal}",\\s*contextServer,\\s*\\{ sessionKey: contextSessionKey \\}\\)`));
  }
  assert.match(source, /finishSelectedInteractiveMode\(contextServer,\s*\{ sessionKey: contextSessionKey \}\)/);
});
