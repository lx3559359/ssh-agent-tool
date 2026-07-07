import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = app.indexOf(`async function ${name}`);
  const end = app.indexOf(nextName, start);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return app.slice(start, end);
}

test("password prompts submit the next line as raw SSH input without command history", () => {
  const source = functionSource("sendSelectedCommand", "  return (");
  const promptBranchStart = source.indexOf("shouldSubmitAsSensitiveTerminalInput");
  const historyStart = source.indexOf("const nextHistory = addCommandToHistory");

  assert.notEqual(promptBranchStart, -1, "sendSelectedCommand should detect sensitive remote prompts");
  assert.notEqual(historyStart, -1, "normal command history branch should still exist");
  assert.ok(promptBranchStart < historyStart, "sensitive prompt input must bypass command history");

  const promptBranch = source.slice(promptBranchStart, historyStart);
  assert.match(promptBranch, /terminalAppends\[sessionKey\]/);
  assert.match(promptBranch, /sendSelectedSessionInput\(event,\s*\{\s*text:\s*rawCommand,\s*submit:\s*true/);
  assert.match(promptBranch, /clearInput:\s*true/);
  assert.match(promptBranch, /sensitiveInput:\s*true/);
  assert.doesNotMatch(promptBranch, /appendTerminalLines\(name,\s*\[`/);
  assert.doesNotMatch(promptBranch, /addCommandToHistory/);
});
