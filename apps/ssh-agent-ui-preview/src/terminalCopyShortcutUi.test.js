import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = app.indexOf(`function ${name}`);
  const end = nextName ? app.indexOf(`function ${nextName}`, start) : app.length;
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return app.slice(start, end);
}

test("terminal copy shortcut prefers selected text before falling back to full output", () => {
  const shortcutSource = functionSource("runTerminalShortcutAction", "handleTerminalShortcutKeyDown");

  assert.match(app, /async function copySelectedTerminalTextOrOutput\(targetName = selectedServer,\s*options = \{\}\)/);
  assert.match(app, /function hasSelectedTerminalText\(\)/);
  assert.match(shortcutSource, /if \(action === "copy-output"\)/);
  assert.match(shortcutSource, /copySelectedTerminalTextOrOutput\(\)/);
  assert.doesNotMatch(shortcutSource, /copySelectedTerminalOutput\(\)/);
});

test("terminal toolbar copy uses the same selected-text-first copy flow", () => {
  const renderStart = app.indexOf("export function App()");
  assert.notEqual(renderStart, -1, "App render source should exist");
  const renderSource = app.slice(renderStart);

  assert.match(app, /label:\s*"复制选中\/输出"/);
  assert.match(app, /aria-label="复制选中\/输出"/);
  assert.match(app, /title="复制选中\/输出 Ctrl\+Shift\+C \/ Ctrl\+Insert"/);
  assert.match(renderSource, /onCopyTerminal=\{copySelectedTerminalTextOrOutput\}/);
  assert.doesNotMatch(renderSource, /onCopyTerminal=\{copySelectedTerminalOutput\}/);
});
