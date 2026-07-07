import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = app.indexOf(`function ${name}`);
  const end = app.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return app.slice(start, end);
}

test("server deletion uses the shared terminal tab removal model", () => {
  const source = functionSource("removeClosedServerTab", "renameEditedServerTab");

  assert.match(source, /const terminalState = removeServerTerminalTab\(visibleTerminalTabs,\s*name,\s*selectedServer,\s*remainingServerNames\)/);
  assert.match(source, /saveTerminalTabs\(terminalState\.tabs\)/);
  assert.match(source, /setSelectedTerminalTabId\(terminalState\.selectedTabId \|\| terminalState\.tabs\[0\]\?\.id \|\| ""\)/);
  assert.match(source, /setSelectedServer\(terminalState\.selectedServer \|\| remainingServerNames\[0\] \|\| ""\)/);
});

test("hiding a builtin server removes its terminal selection and session state", () => {
  const source = functionSource("hideBuiltinServer", "openServerBackup");

  assert.match(source, /const nextHidden = \[\.\.\.new Set\(\[\.\.\.\(hiddenBuiltinServers \|\| \[\]\),\s*name\]\)\]/);
  assert.match(source, /await closeRemovedServerSession\(name,\s*"服务器已从列表隐藏"\)/);
  assert.match(source, /const remainingServerNames = Object\.keys\(buildVisibleServerMap\(SERVER_DATA,\s*customServers,\s*nextHidden\)\)/);
  assert.match(source, /removeClosedServerTab\(name,\s*remainingServerNames\)/);
  assert.match(source, /clearRemovedServerState\(name\)/);
});
