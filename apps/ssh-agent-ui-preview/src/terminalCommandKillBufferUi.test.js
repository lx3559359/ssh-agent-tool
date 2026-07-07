import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function terminalWorkspaceSource() {
  const start = app.indexOf("function TerminalWorkspace");
  const end = app.indexOf("function LegacyAgentPanel", start + 1);
  assert.notEqual(start, -1, "TerminalWorkspace should exist");
  assert.notEqual(end, -1, "LegacyAgentPanel should follow TerminalWorkspace");
  return app.slice(start, end);
}

function appSource() {
  const start = app.indexOf("export function App()");
  assert.notEqual(start, -1, "App should exist");
  return app.slice(start);
}

test("terminal command input stores shell kill buffer for Ctrl+Y yank", () => {
  const source = terminalWorkspaceSource();
  const editStart = source.indexOf("function applyCommandEditShortcut");
  const editEnd = source.indexOf("function handleTerminalCtrlCButtonClick", editStart);
  assert.notEqual(editStart, -1, "terminal workspace edit handler should exist");
  assert.notEqual(editEnd, -1, "Ctrl+C button handler should follow edit handler");
  const editSource = source.slice(editStart, editEnd);

  assert.match(source, /const \[commandKillBuffer,\s*setCommandKillBuffer\] = useState\(""\)/);
  assert.match(editSource, /trackKillBuffer:\s*true/);
  assert.match(editSource, /killBuffer:\s*commandKillBuffer/);
  assert.match(editSource, /if \(Object\.prototype\.hasOwnProperty\.call\(edit,\s*"killBuffer"\)\)/);
  assert.match(editSource, /setCommandKillBuffer\(edit\.killBuffer\)/);
});

test("outer terminal command history handler keeps kill buffer per command input", () => {
  const source = appSource();
  const handlerStart = source.indexOf("function handleCommandHistoryKeyDown");
  const handlerEnd = source.indexOf("function useCommandSnippet", handlerStart);
  assert.notEqual(handlerStart, -1, "outer command history handler should exist");
  assert.notEqual(handlerEnd, -1, "useCommandSnippet should follow outer command history handler");
  const handlerSource = source.slice(handlerStart, handlerEnd);

  assert.match(source, /const \[commandKillBuffers,\s*setCommandKillBuffers\] = useState\(\{\}\)/);
  assert.match(handlerSource, /trackKillBuffer:\s*true/);
  assert.match(handlerSource, /killBuffer:\s*commandKillBuffers\[inputKey\] \|\| ""/);
  assert.match(handlerSource, /if \(Object\.prototype\.hasOwnProperty\.call\(edit,\s*"killBuffer"\)\)/);
  assert.match(handlerSource, /setCommandKillBuffers\(\(current\) => \(\{ \.\.\.current,\s*\[inputKey\]: edit\.killBuffer \}\)\)/);
});
