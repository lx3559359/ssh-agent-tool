import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function contextMenuSource() {
  const start = app.indexOf("function ContextMenu");
  const end = app.indexOf("function RenameTerminalTabModal", start + 1);
  assert.notEqual(start, -1, "ContextMenu component should exist");
  assert.notEqual(end, -1, "RenameTerminalTabModal should follow ContextMenu");
  return app.slice(start, end);
}

test("ContextMenu behaves like a desktop menu and closes on Escape or outside click", () => {
  const source = contextMenuSource();

  assert.match(source, /const menuRef = useRef\(null\)/);
  assert.match(source, /useEffect\(\(\) => \{/);
  assert.match(source, /window\.addEventListener\("keydown",\s*handleKeyDown\)/);
  assert.match(source, /window\.addEventListener\("pointerdown",\s*handlePointerDown,\s*true\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /menuRef\.current\.contains\(event\.target\)/);
  assert.match(source, /onClose\?\.\(\)/);
  assert.match(source, /window\.removeEventListener\("keydown",\s*handleKeyDown\)/);
  assert.match(source, /window\.removeEventListener\("pointerdown",\s*handlePointerDown,\s*true\)/);
  assert.match(source, /ref=\{menuRef\}/);
});

test("ContextMenu supports desktop keyboard focus and arrow navigation", () => {
  const source = contextMenuSource();

  assert.match(source, /function getEnabledMenuButtons\(\)/);
  assert.match(source, /button:not\(:disabled\)/);
  assert.match(source, /window\.requestAnimationFrame\?\.\(\(\) => getEnabledMenuButtons\(\)\[0\]\?\.focus\?\.\(\)\)/);
  assert.match(source, /function handleMenuKeyDown\(event\)/);
  assert.match(source, /event\.key === "ArrowDown"/);
  assert.match(source, /event\.key === "ArrowUp"/);
  assert.match(source, /event\.key === "Home"/);
  assert.match(source, /event\.key === "End"/);
  assert.match(source, /document\.activeElement/);
  assert.match(source, /buttons\[nextIndex\]\?\.focus\?\.\(\)/);
  assert.match(source, /onKeyDown=\{handleMenuKeyDown\}/);
});

test("ContextMenu renders shortcut hints separately from the action label", () => {
  const source = contextMenuSource();

  assert.match(source, /item\.shortcut/);
  assert.match(source, /className="context-menu-shortcut"/);
  assert.match(source, /aria-hidden="true"/);
});
