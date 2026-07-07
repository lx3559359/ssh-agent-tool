import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function terminalWorkspaceSource() {
  const start = app.indexOf("function TerminalWorkspace");
  const end = app.indexOf("function LegacyAgentPanel", start + 1);
  assert.notEqual(start, -1, "TerminalWorkspace component should exist");
  assert.notEqual(end, -1, "LegacyAgentPanel component should follow TerminalWorkspace");
  return app.slice(start, end);
}

test("terminal surface review keys scroll local output before sending remote shell keys", () => {
  const source = terminalWorkspaceSource();
  const handlerStart = source.indexOf("function handleTerminalShellKeyDown");
  const handlerEnd = source.indexOf("function handleHistoryUse", handlerStart);
  assert.notEqual(handlerStart, -1, "terminal surface key handler should exist");
  assert.notEqual(handlerEnd, -1, "history handler should follow terminal surface key handler");
  const handler = source.slice(handlerStart, handlerEnd);

  const scrollIndex = handler.indexOf("if (scrollTerminalOutputByKey(event)) return;");
  const connectedShellIndex = handler.indexOf("if (sendConnectedShellSurfaceInput(event)) return;");

  assert.notEqual(scrollIndex, -1, "terminal surface should support local scroll review keys");
  assert.notEqual(connectedShellIndex, -1, "terminal surface should still send normal keys to the remote shell");
  assert.ok(scrollIndex < connectedShellIndex, "PageUp/PageDown/Home/End should review local SSH output before they can be sent to the remote shell");
});

test("terminal surface forwards connected shell function keys before local shortcuts", () => {
  const source = terminalWorkspaceSource();
  const handlerStart = source.indexOf("function handleTerminalShellKeyDown");
  const handlerEnd = source.indexOf("function handleHistoryUse", handlerStart);
  assert.notEqual(handlerStart, -1, "terminal surface key handler should exist");
  assert.notEqual(handlerEnd, -1, "history handler should follow terminal surface key handler");
  const handler = source.slice(handlerStart, handlerEnd);

  const connectedShellIndex = handler.indexOf("if (sendConnectedShellSurfaceInput(event)) return;");
  const shortcutIndex = handler.indexOf("if (onTerminalShortcutKeyDown(event)) return;");

  assert.notEqual(connectedShellIndex, -1, "terminal surface should send supported SSH keys to the remote shell");
  assert.notEqual(shortcutIndex, -1, "terminal surface should still support local client shortcuts");
  assert.ok(
    connectedShellIndex < shortcutIndex,
    "connected SSH shell keys such as F2/F11 should reach remote TUI programs before local shortcuts run",
  );
});
