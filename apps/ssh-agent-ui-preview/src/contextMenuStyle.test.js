import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function block(selector) {
  const start = styles.indexOf(selector);
  assert.notEqual(start, -1, `${selector} should exist`);
  const open = styles.indexOf("{", start);
  const close = styles.indexOf("}", open);
  return styles.slice(open + 1, close);
}

test("context menu keeps compact text readable and clips long Chinese actions", () => {
  const menuBlock = block(".context-menu {");
  const titleBlock = block(".context-menu-title {");
  const sectionBlock = block(".context-menu-section {");
  const buttonBlock = block(".context-menu button {");
  const svgBlock = block(".context-menu button svg {");
  const spanBlock = block(".context-menu button span {");
  const shortcutBlock = block(".context-menu-shortcut {");

  assert.match(menuBlock, /width:\s*min\(336px,\s*calc\(100vw - 16px\)\)/);
  assert.match(menuBlock, /max-height:\s*calc\(100vh - 8px\)/);
  assert.match(menuBlock, /overflow:\s*auto/);
  assert.match(menuBlock, /scrollbar-width:\s*thin/);
  assert.match(titleBlock, /padding:\s*2px 6px 1px/);
  assert.match(titleBlock, /font-size:\s*8px/);
  assert.match(sectionBlock, /padding:\s*2px 6px 1px/);
  assert.match(sectionBlock, /font-size:\s*8px/);
  assert.match(buttonBlock, /min-height:\s*16px/);
  assert.match(buttonBlock, /grid-template-columns:\s*10px minmax\(0,\s*1fr\) auto/);
  assert.match(buttonBlock, /padding:\s*1px 5px/);
  assert.match(buttonBlock, /font-size:\s*8px/);
  assert.match(buttonBlock, /line-height:\s*1\.1/);
  assert.match(svgBlock, /width:\s*10px/);
  assert.match(svgBlock, /height:\s*10px/);
  assert.match(spanBlock, /white-space:\s*nowrap/);
  assert.match(spanBlock, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(spanBlock, /-webkit-line-clamp/);
  assert.match(shortcutBlock, /max-width:\s*92px/);
  assert.match(shortcutBlock, /font-size:\s*7px/);
  assert.match(shortcutBlock, /white-space:\s*nowrap/);
});
