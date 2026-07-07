import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("layout resizers support keyboard width adjustment", () => {
  assert.match(app, /function handleLayoutResizeKeyDown\(side,\s*event\)/);
  assert.match(app, /adjustLayoutColumn\(side,\s*delta\)/);
  assert.match(app, /event\.key === "ArrowLeft"/);
  assert.match(app, /event\.key === "ArrowRight"/);
  assert.match(app, /event\.key === "Home"/);
  assert.match(app, /event\.key === "End"/);
  assert.match(app, /event\.key === "0"/);
  assert.match(app, /onKeyDown=\{\(event\) => handleLayoutResizeKeyDown\("left", event\)\}/);
  assert.match(app, /onKeyDown=\{\(event\) => handleLayoutResizeKeyDown\("right", event\)\}/);
  assert.match(app, /tabIndex=\{0\}/);
  assert.match(app, /aria-valuenow=\{layoutColumns\.left\}/);
  assert.match(app, /aria-valuenow=\{layoutColumns\.right\}/);
  assert.match(styles, /\.layout-resizer:focus-visible[\s\S]*outline/);
});

test("layout resizers can reset panel widths by double click", () => {
  assert.match(app, /function resetLayoutColumn\(side\)/);
  assert.match(app, /setLayoutColumn\(side,\s*DEFAULT_LAYOUT_COLUMNS\[side\]\)/);
  assert.match(app, /title="拖动调整左侧面板宽度，双击恢复默认宽度"/);
  assert.match(app, /title="拖动调整右侧 Agent 面板宽度，双击恢复默认宽度"/);
  assert.match(app, /onDoubleClick=\{\(\) => resetLayoutColumn\("left"\)\}/);
  assert.match(app, /onDoubleClick=\{\(\) => resetLayoutColumn\("right"\)\}/);
  assert.match(styles, /\.layout-resizer::after[\s\S]*background:\s*transparent/);
});
