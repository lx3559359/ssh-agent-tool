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

test("terminal surface focuses command input after click without stealing output text selection", () => {
  const source = componentSource("TerminalWorkspace", "LegacyAgentPanel");
  const focusStart = source.indexOf("function focusCommandInputFromTerminalSurface");
  const focusEnd = source.indexOf("function sendConnectedShellSurfaceInput", focusStart);
  assert.notEqual(focusStart, -1, "terminal surface focus handler should exist");
  assert.notEqual(focusEnd, -1, "next terminal handler should follow focus handler");
  const focusSource = source.slice(focusStart, focusEnd);

  assert.match(source, /onMouseUp=\{focusCommandInputFromTerminalSurface\}/);
  assert.doesNotMatch(source, /onMouseDown=\{focusCommandInputFromTerminalSurface\}/);
  assert.match(focusSource, /window\.getSelection\?\.\(\)/);
  assert.match(focusSource, /selection\.toString\?\.\(\)/);
  assert.match(focusSource, /selection\.isCollapsed/);
  assert.match(focusSource, /requestAnimationFrame/);
});
