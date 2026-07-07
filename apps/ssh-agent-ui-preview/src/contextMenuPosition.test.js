import assert from "node:assert/strict";
import test from "node:test";

import { getContextMenuPosition } from "./contextMenuPosition.js";

test("getContextMenuPosition default width matches the rendered context menu", () => {
  const position = getContextMenuPosition({
    clientX: 990,
    clientY: 20,
    viewportWidth: 1000,
    viewportHeight: 600,
    menuHeight: 120,
  });

  assert.equal(position.x, 656);
  assert.equal(position.maxHeight, "572px");
});

test("getContextMenuPosition keeps menus inside the desktop viewport", () => {
  const position = getContextMenuPosition({
    clientX: 990,
    clientY: 760,
    viewportWidth: 1000,
    viewportHeight: 800,
    menuWidth: 206,
    menuHeight: 340,
  });

  assert.deepEqual(position, { x: 786, y: 452, maxHeight: "340px" });
});

test("getContextMenuPosition uses the tall compact default menu height", () => {
  const position = getContextMenuPosition({
    clientX: 990,
    clientY: 760,
    viewportWidth: 1000,
    viewportHeight: 800,
  });

  assert.deepEqual(position, { x: 656, y: 272, maxHeight: "520px" });
});

test("getContextMenuPosition preserves a visible margin on tiny windows", () => {
  const position = getContextMenuPosition({
    clientX: 400,
    clientY: 300,
    viewportWidth: 180,
    viewportHeight: 140,
    menuWidth: 206,
    menuHeight: 340,
  });

  assert.deepEqual(position, { x: 8, y: 8, maxHeight: "124px" });
});
