import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("SSH command input uses Tab for local command completion before focus can move", () => {
  const handler = app.slice(app.indexOf("function handleCommandHistoryKeyDown"), app.indexOf("function clearSelectedCommandInput"));

  assert.match(app, /completeCommandDraft/);
  assert.match(handler, /event\.key === "Tab"/);
  assert.match(handler, /event\.preventDefault\(\)/);
  assert.match(handler, /completeCommandDraft\(commandValue,\s*commandHistories\[selectedServer\] \|\| \[\],\s*commandSnippets\)/);
  assert.match(handler, /setCommandInputs/);
  assert.match(handler, /setSelectionRange\?\.\(completion\.value\.length,\s*completion\.value\.length\)/);
  assert.match(handler, /completion\.source === "multiple"/);
  assert.match(handler, /命令补全候选/);
  assert.match(handler, /没有匹配的命令补全/);
});
