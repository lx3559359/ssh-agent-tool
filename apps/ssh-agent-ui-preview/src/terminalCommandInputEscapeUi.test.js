import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function commandHistoryKeyDownSource() {
  const start = app.indexOf("function handleCommandHistoryKeyDown");
  const end = app.indexOf("function useCommandSnippet", start);
  assert.notEqual(start, -1, "handleCommandHistoryKeyDown should exist");
  assert.notEqual(end, -1, "useCommandSnippet should follow handleCommandHistoryKeyDown");
  return app.slice(start, end);
}

test("Terminal command input Escape clears an unsent draft when there is no history cursor", () => {
  const source = commandHistoryKeyDownSource();
  const restoreBlock = source.slice(source.indexOf('if (historyKeyAction === "restore")'), source.indexOf("if (history.length === 0) return;"));

  assert.match(restoreBlock, /event\.preventDefault\(\)/);
  assert.match(restoreBlock, /historyCursors\[inputKey\]\?\.draft\s*\?\?\s*""/);
  assert.doesNotMatch(restoreBlock, /historyCursors\[inputKey\]\?\.draft\s*\?\?\s*commandInputs\[inputKey\]/);
  assert.match(restoreBlock, /setCommandInputs\(\(current\) => \(\{ \.\.\.current, \[inputKey\]: draft \}\)\)/);
  assert.match(restoreBlock, /createHistoryCursor\(draft\)/);
});
